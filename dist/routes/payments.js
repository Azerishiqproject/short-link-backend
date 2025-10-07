"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const User_1 = require("../models/User");
const Payment_1 = require("../models/Payment");
const router = (0, express_1.Router)();
// Schemas
const createSchema = zod_1.z.object({
    amount: zod_1.z.number().min(0),
    currency: zod_1.z.string().default("TRY"),
    method: zod_1.z.string().default("credit_card"),
    description: zod_1.z.string().optional(),
    metadata: zod_1.z.any().optional(),
    category: zod_1.z.enum(["payment", "withdrawal"]).optional(),
    audience: zod_1.z.enum(["user", "advertiser"]).optional(),
    iban: zod_1.z.string().optional(),
    fullName: zod_1.z.string().optional()
});
const statusSchema = zod_1.z.object({ status: zod_1.z.enum(["pending", "paid", "failed", "refunded", "approved", "rejected"]) });
// List my payments (advertiser)
router.get("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.sub;
        const items = await Payment_1.Payment.find({ ownerId: userId }).sort({ createdAt: -1 });
        return res.json({ payments: items });
    }
    catch (e) {
        next(e);
    }
});
// Create payment record (after visual payment)
router.post("/", auth_1.requireAuth, async (req, res, next) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        const ownerId = req.user.sub;
        // Kullanıcı çekim isteği için özel kontrol
        if (parsed.data.category === "withdrawal" && parsed.data.audience === "user") {
            const user = await User_1.User.findById(ownerId);
            if (!user)
                return res.status(404).json({ error: "User not found" });
            // Minimum çekim kontrolü (50 TL)
            if (parsed.data.amount < 50) {
                return res.status(400).json({ error: "Minimum çekim tutarı 50 TL'dir" });
            }
            // Yeterli bakiye kontrolü (rezerve edilmemiş kısım)
            const availableEarnedBalance = (user.earned_balance || 0) - (user.reserved_earned_balance || 0);
            if (availableEarnedBalance < parsed.data.amount) {
                return res.status(400).json({ error: "Yetersiz kazanç bakiyesi" });
            }
            // IBAN kontrolü
            if (!parsed.data.iban || !parsed.data.fullName) {
                return res.status(400).json({ error: "IBAN ve tam ad bilgileri gereklidir" });
            }
        }
        const status = parsed.data.category === "withdrawal" ? "pending" : "paid";
        const doc = await Payment_1.Payment.create({ ownerId, ...parsed.data, status });
        // Credit wallet on paid top-ups
        if (doc.category === "payment" && doc.status === "paid") {
            await User_1.User.findByIdAndUpdate(ownerId, { $inc: { available_balance: doc.amount } });
        }
        // Kullanıcı çekim isteği için rezerve et
        if (doc.category === "withdrawal" && doc.audience === "user") {
            await User_1.User.findByIdAndUpdate(ownerId, {
                $inc: { reserved_earned_balance: doc.amount }
            });
        }
        return res.status(201).json({ payment: doc });
    }
    catch (e) {
        next(e);
    }
});
// Admin: list all payments
router.get("/admin/all", auth_1.requireAdmin, async (_req, res, next) => {
    try {
        const items = await Payment_1.Payment.find().sort({ createdAt: -1 }).limit(500);
        return res.json({ payments: items });
    }
    catch (e) {
        next(e);
    }
});
// Admin: change status
router.put("/:id/status", auth_1.requireAdmin, async (req, res, next) => {
    try {
        const parsed = statusSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        const payment = await Payment_1.Payment.findById(req.params.id);
        if (!payment)
            return res.status(404).json({ error: "Payment not found" });
        // Kullanıcı çekim onayı için özel işlem
        if (payment.category === "withdrawal" && payment.audience === "user" && parsed.data.status === "approved") {
            // Rezerve edilen parayı kazanç bakiyesinden düş
            await User_1.User.findByIdAndUpdate(payment.ownerId, {
                $inc: {
                    earned_balance: -payment.amount,
                    reserved_earned_balance: -payment.amount
                }
            });
        }
        // Reddedilen çekim için rezerve edilen parayı geri ver
        if (payment.category === "withdrawal" && payment.audience === "user" && parsed.data.status === "rejected") {
            await User_1.User.findByIdAndUpdate(payment.ownerId, {
                $inc: { reserved_earned_balance: -payment.amount }
            });
        }
        const updated = await Payment_1.Payment.findByIdAndUpdate(req.params.id, { status: parsed.data.status }, { new: true });
        return res.json({ payment: updated });
    }
    catch (e) {
        next(e);
    }
});
// Admin: get user withdrawal requests
router.get("/admin/withdrawals", auth_1.requireAdmin, async (req, res, next) => {
    try {
        const items = await Payment_1.Payment.find({
            category: "withdrawal",
            audience: "user",
            status: { $in: ["pending", "approved", "rejected"] }
        })
            .populate("ownerId", "email name fullName iban")
            .sort({ createdAt: -1 })
            .limit(100);
        return res.json({ payments: items });
    }
    catch (e) {
        next(e);
    }
});
// Admin: update withdrawal with notes
router.put("/:id/admin-notes", auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { adminNotes } = req.body;
        const updated = await Payment_1.Payment.findByIdAndUpdate(req.params.id, { adminNotes }, { new: true });
        return res.json({ payment: updated });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
