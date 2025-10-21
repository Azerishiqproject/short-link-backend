"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const Payment_1 = require("../../models/Payment");
const security_1 = require("../../middleware/security");
const router = (0, express_1.Router)();
// Validation schemas
const updatePaymentStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["pending", "paid", "failed", "refunded", "approved", "rejected"]),
});
// Get all payments (admin)
router.get("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;
        const category = req.query.category;
        const search = req.query.search;
        const skip = (page - 1) * limit;
        let query = {};
        if (status) {
            query.status = status;
        }
        if (category) {
            query.category = category;
        }
        if (search) {
            const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [
                { description: searchRegex },
                { fullName: searchRegex },
                { iban: searchRegex }
            ];
        }
        const totalPayments = await Payment_1.Payment.countDocuments(query);
        const payments = await Payment_1.Payment.find(query)
            .populate('ownerId', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        return res.json({
            payments,
            pagination: {
                page,
                limit,
                total: totalPayments,
                totalPages: Math.ceil(totalPayments / limit),
                hasNext: page < Math.ceil(totalPayments / limit),
                hasPrev: page > 1,
            }
        });
    }
    catch (error) {
        console.error("Error fetching payments:", error);
        return res.status(500).json({ error: "Failed to fetch payments" });
    }
});
// Get single payment (admin)
router.get("/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid payment ID" });
        }
        const payment = await Payment_1.Payment.findById(id).populate('ownerId', 'name email');
        if (!payment) {
            return res.status(404).json({ error: "Payment not found" });
        }
        return res.json(payment);
    }
    catch (error) {
        console.error("Error fetching payment:", error);
        return res.status(500).json({ error: "Failed to fetch payment" });
    }
});
// Update payment status (admin)
router.put("/:id/status", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid payment ID" });
        }
        const validatedData = updatePaymentStatusSchema.parse(req.body);
        const payment = await Payment_1.Payment.findByIdAndUpdate(id, { status: validatedData.status }, { new: true }).populate('ownerId', 'name email');
        if (!payment) {
            return res.status(404).json({ error: "Payment not found" });
        }
        return res.json(payment);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error updating payment status:", error);
        return res.status(500).json({ error: "Failed to update payment status" });
    }
});
// Get payment statistics (admin)
router.get("/stats/overview", auth_1.requireAdmin, async (req, res) => {
    try {
        const totalPayments = await Payment_1.Payment.countDocuments();
        const totalAmount = await Payment_1.Payment.aggregate([
            { $match: { status: "paid" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const statusCounts = await Payment_1.Payment.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        const categoryCounts = await Payment_1.Payment.aggregate([
            { $group: { _id: "$category", count: { $sum: 1 } } }
        ]);
        return res.json({
            totalPayments,
            totalAmount: totalAmount[0]?.total || 0,
            statusCounts: statusCounts.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            categoryCounts: categoryCounts.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
        });
    }
    catch (error) {
        console.error("Error fetching payment stats:", error);
        return res.status(500).json({ error: "Failed to fetch payment statistics" });
    }
});
exports.default = router;
