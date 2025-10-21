"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const ReferralSettings_1 = require("../../models/ReferralSettings");
const ReferralTransaction_1 = require("../../models/ReferralTransaction");
const auth_1 = require("../../middleware/auth");
const security_1 = require("../../middleware/security");
const referralService_1 = require("../../services/referralService");
const router = (0, express_1.Router)();
// Referans ayarlarını getir
router.get("/settings", auth_1.requireAdmin, async (req, res) => {
    try {
        let settings = await ReferralSettings_1.ReferralSettings.findOne().sort({ createdAt: -1 });
        // Eğer ayar yoksa varsayılan oluştur
        if (!settings) {
            const adminId = req.user.sub;
            settings = await ReferralSettings_1.ReferralSettings.create({
                lastUpdatedBy: adminId,
                isActive: true,
                referrerPercentage: 10,
                refereePercentage: 5,
                minReferralEarning: 0.01,
                maxReferralEarning: 0,
                payoutSchedule: "immediate",
                eligibleActions: ["registration"],
                status: "active"
            });
        }
        res.json({ settings });
    }
    catch (error) {
        console.error("Error fetching referral settings:", error);
        res.status(500).json({ error: "Failed to fetch referral settings" });
    }
});
// Referans ayarlarını güncelle
const updateSettingsSchema = zod_1.z.object({
    isActive: zod_1.z.boolean().optional(),
    referrerPercentage: zod_1.z.number().min(0).max(100).optional(),
    minReferralEarning: zod_1.z.number().min(0).optional(),
    maxReferralEarning: zod_1.z.number().min(0).optional(),
    adminNotes: zod_1.z.string().max(500).optional(),
    status: zod_1.z.enum(["active", "paused", "maintenance"]).optional()
});
router.put("/settings", auth_1.requireAdmin, async (req, res) => {
    try {
        const parsed = updateSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.flatten() });
        }
        const adminId = req.user.sub;
        const updateData = {
            ...parsed.data,
            lastUpdatedBy: adminId
        };
        const settings = await ReferralSettings_1.ReferralSettings.findOneAndUpdate({}, updateData, { upsert: true, new: true });
        // Ayarlar güncellendiğinde cache'i temizle
        referralService_1.referralService.clearSettingsCache();
        res.json({ settings });
    }
    catch (error) {
        console.error("Error updating referral settings:", error);
        res.status(500).json({ error: "Failed to update referral settings" });
    }
});
// Referans işlemlerini listele
router.get("/transactions", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || 1)));
        const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
        const skip = (page - 1) * limit;
        const status = String(req.query.status || "");
        const paymentStatus = String(req.query.paymentStatus || "");
        // Filtre oluştur
        const filter = {};
        if (status)
            filter.status = status;
        if (paymentStatus)
            filter.paymentStatus = paymentStatus;
        const total = await ReferralTransaction_1.ReferralTransaction.countDocuments(filter);
        const transactions = await ReferralTransaction_1.ReferralTransaction.find(filter)
            .populate('referrer', 'name email referralCode')
            .populate('referee', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        res.json({
            transactions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1,
            }
        });
    }
    catch (error) {
        console.error("Error fetching referral transactions:", error);
        res.status(500).json({ error: "Failed to fetch referral transactions" });
    }
});
// Referans işlemini güncelle
const updateTransactionSchema = zod_1.z.object({
    status: zod_1.z.enum(["pending", "completed", "cancelled", "refunded"]).optional(),
    paymentStatus: zod_1.z.enum(["pending", "paid", "failed"]).optional(),
    adminNotes: zod_1.z.string().max(500).optional()
});
router.patch("/transactions/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const parsed = updateTransactionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.flatten() });
        }
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid transaction ID" });
        }
        const updateData = { ...parsed.data };
        if (updateData.paymentStatus === "paid") {
            updateData.paidAt = new Date();
        }
        const transaction = await ReferralTransaction_1.ReferralTransaction.findByIdAndUpdate(id, updateData, { new: true }).populate('referrer', 'name email referralCode')
            .populate('referee', 'name email');
        if (!transaction) {
            return res.status(404).json({ error: "Transaction not found" });
        }
        res.json({ transaction });
    }
    catch (error) {
        console.error("Error updating referral transaction:", error);
        res.status(500).json({ error: "Failed to update referral transaction" });
    }
});
// Referans istatistikleri
router.get("/stats", auth_1.requireAdmin, async (req, res) => {
    try {
        const totalReferrals = await ReferralTransaction_1.ReferralTransaction.countDocuments();
        const completedReferrals = await ReferralTransaction_1.ReferralTransaction.countDocuments({ status: "completed" });
        const pendingReferrals = await ReferralTransaction_1.ReferralTransaction.countDocuments({ status: "pending" });
        const paidReferrals = await ReferralTransaction_1.ReferralTransaction.countDocuments({ paymentStatus: "paid" });
        // Toplam ödenen miktar
        const totalPaid = await ReferralTransaction_1.ReferralTransaction.aggregate([
            { $match: { paymentStatus: "paid" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        // Bekleyen ödeme miktarı
        const pendingAmount = await ReferralTransaction_1.ReferralTransaction.aggregate([
            { $match: { status: "completed", paymentStatus: "pending" } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        // En çok referans yapan kullanıcılar
        const topReferrers = await ReferralTransaction_1.ReferralTransaction.aggregate([
            { $match: { status: "completed" } },
            { $group: {
                    _id: "$referrer",
                    count: { $sum: 1 },
                    totalAmount: { $sum: "$amount" }
                } },
            { $sort: { count: -1 } },
            { $limit: 10 },
            { $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "user"
                } },
            { $unwind: "$user" },
            { $project: {
                    userId: "$_id",
                    name: "$user.name",
                    email: "$user.email",
                    referralCode: "$user.referralCode",
                    count: 1,
                    totalAmount: 1
                } }
        ]);
        res.json({
            totalReferrals,
            completedReferrals,
            pendingReferrals,
            paidReferrals,
            totalPaid: totalPaid[0]?.total || 0,
            pendingAmount: pendingAmount[0]?.total || 0,
            topReferrers
        });
    }
    catch (error) {
        console.error("Error fetching referral stats:", error);
        res.status(500).json({ error: "Failed to fetch referral stats" });
    }
});
// Toplu işlem - bekleyen ödemeleri tamamla
router.post("/bulk-pay", auth_1.requireAdmin, async (req, res) => {
    try {
        const { transactionIds } = req.body;
        if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
            return res.status(400).json({ error: "Transaction IDs required" });
        }
        // Geçerli ObjectId'leri kontrol et
        const validIds = transactionIds.filter(id => security_1.mongoSanitize.isValidObjectId(id));
        if (validIds.length === 0) {
            return res.status(400).json({ error: "No valid transaction IDs provided" });
        }
        const result = await ReferralTransaction_1.ReferralTransaction.updateMany({ _id: { $in: validIds }, status: "completed" }, {
            paymentStatus: "paid",
            paidAt: new Date()
        });
        res.json({
            message: `${result.modifiedCount} transactions marked as paid`,
            modifiedCount: result.modifiedCount
        });
    }
    catch (error) {
        console.error("Error bulk paying transactions:", error);
        res.status(500).json({ error: "Failed to bulk pay transactions" });
    }
});
exports.default = router;
