import { Router } from "express";
import { z } from "zod";
import { ReferralSettings } from "../../models/ReferralSettings";
import { ReferralTransaction } from "../../models/ReferralTransaction";
import { User } from "../../models/User";
import { requireAdmin } from "../../middleware/auth";
import { mongoSanitize } from "../../middleware/security";
import { referralService } from "../../services/referralService";

const router = Router();

// Referans ayarlarını getir
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    let settings = await ReferralSettings.findOne().sort({ createdAt: -1 });
    
    // Eğer ayar yoksa varsayılan oluştur
    if (!settings) {
      const adminId = (req as any).user.sub;
      settings = await ReferralSettings.create({
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
  } catch (error) {
    console.error("Error fetching referral settings:", error);
    res.status(500).json({ error: "Failed to fetch referral settings" });
  }
});

// Referans ayarlarını güncelle
const updateSettingsSchema = z.object({
  isActive: z.boolean().optional(),
  referrerPercentage: z.number().min(0).max(100).optional(),
  minReferralEarning: z.number().min(0).optional(),
  maxReferralEarning: z.number().min(0).optional(),
  adminNotes: z.string().max(500).optional(),
  status: z.enum(["active", "paused", "maintenance"]).optional()
});

router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    
    const adminId = (req as any).user.sub;
    const updateData = {
      ...parsed.data,
      lastUpdatedBy: adminId
    };
    
    const settings = await ReferralSettings.findOneAndUpdate(
      {},
      updateData,
      { upsert: true, new: true }
    );
    
    // Ayarlar güncellendiğinde cache'i temizle
    referralService.clearSettingsCache();
    
    res.json({ settings });
  } catch (error) {
    console.error("Error updating referral settings:", error);
    res.status(500).json({ error: "Failed to update referral settings" });
  }
});

// Referans işlemlerini listele
router.get("/transactions", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
    const skip = (page - 1) * limit;
    const status = String(req.query.status || "");
    const paymentStatus = String(req.query.paymentStatus || "");
    
    // Filtre oluştur
    const filter: any = {};
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    
    const total = await ReferralTransaction.countDocuments(filter);
    const transactions = await ReferralTransaction.find(filter)
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
  } catch (error) {
    console.error("Error fetching referral transactions:", error);
    res.status(500).json({ error: "Failed to fetch referral transactions" });
  }
});

// Referans işlemini güncelle
const updateTransactionSchema = z.object({
  status: z.enum(["pending", "completed", "cancelled", "refunded"]).optional(),
  paymentStatus: z.enum(["pending", "paid", "failed"]).optional(),
  adminNotes: z.string().max(500).optional()
});

router.patch("/transactions/:id", requireAdmin, async (req, res) => {
  try {
    const parsed = updateTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    
    const { id } = req.params;
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid transaction ID" });
    }
    
    const updateData: any = { ...parsed.data };
    if (updateData.paymentStatus === "paid") {
      updateData.paidAt = new Date();
    }
    
    const transaction = await ReferralTransaction.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('referrer', 'name email referralCode')
     .populate('referee', 'name email');
    
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    
    res.json({ transaction });
  } catch (error) {
    console.error("Error updating referral transaction:", error);
    res.status(500).json({ error: "Failed to update referral transaction" });
  }
});

// Referans istatistikleri
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const totalReferrals = await ReferralTransaction.countDocuments();
    const completedReferrals = await ReferralTransaction.countDocuments({ status: "completed" });
    const pendingReferrals = await ReferralTransaction.countDocuments({ status: "pending" });
    const paidReferrals = await ReferralTransaction.countDocuments({ paymentStatus: "paid" });
    
    // Toplam ödenen miktar
    const totalPaid = await ReferralTransaction.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    
    // Bekleyen ödeme miktarı
    const pendingAmount = await ReferralTransaction.aggregate([
      { $match: { status: "completed", paymentStatus: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    
    // En çok referans yapan kullanıcılar
    const topReferrers = await ReferralTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { 
        _id: "$referrer", 
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" }
      }},
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user"
      }},
      { $unwind: "$user" },
      { $project: {
        userId: "$_id",
        name: "$user.name",
        email: "$user.email",
        referralCode: "$user.referralCode",
        count: 1,
        totalAmount: 1
      }}
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
  } catch (error) {
    console.error("Error fetching referral stats:", error);
    res.status(500).json({ error: "Failed to fetch referral stats" });
  }
});

// Toplu işlem - bekleyen ödemeleri tamamla
router.post("/bulk-pay", requireAdmin, async (req, res) => {
  try {
    const { transactionIds } = req.body;
    
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: "Transaction IDs required" });
    }
    
    // Geçerli ObjectId'leri kontrol et
    const validIds = transactionIds.filter(id => mongoSanitize.isValidObjectId(id));
    
    if (validIds.length === 0) {
      return res.status(400).json({ error: "No valid transaction IDs provided" });
    }
    
    const result = await ReferralTransaction.updateMany(
      { _id: { $in: validIds }, status: "completed" },
      { 
        paymentStatus: "paid",
        paidAt: new Date()
      }
    );
    
    res.json({ 
      message: `${result.modifiedCount} transactions marked as paid`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error("Error bulk paying transactions:", error);
    res.status(500).json({ error: "Failed to bulk pay transactions" });
  }
});

export default router;
