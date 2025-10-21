import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/auth";
import { Payment } from "../../models/Payment";
import { User } from "../../models/User";
import { mongoSanitize } from "../../middleware/security";

const router = Router();

// Validation schemas
const updatePaymentStatusSchema = z.object({
  status: z.enum(["pending", "paid", "failed", "refunded", "approved", "rejected"]),
});

// Get all payments (admin)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const category = req.query.category as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    let query: any = {};
    
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

    const totalPayments = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
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
  } catch (error) {
    console.error("Error fetching payments:", error);
    return res.status(500).json({ error: "Failed to fetch payments" });
  }
});

// Get single payment (admin)
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const payment = await Payment.findById(id).populate('ownerId', 'name email');
    
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    return res.json(payment);
  } catch (error) {
    console.error("Error fetching payment:", error);
    return res.status(500).json({ error: "Failed to fetch payment" });
  }
});

// Update payment status (admin)
router.put("/:id/status", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const validatedData = updatePaymentStatusSchema.parse(req.body);
    
    const payment = await Payment.findByIdAndUpdate(
      id, 
      { status: validatedData.status },
      { new: true }
    ).populate('ownerId', 'name email');
    
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    return res.json(payment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    console.error("Error updating payment status:", error);
    return res.status(500).json({ error: "Failed to update payment status" });
  }
});

// Get payment statistics (admin)
router.get("/stats/overview", requireAdmin, async (req, res) => {
  try {
    const totalPayments = await Payment.countDocuments();
    const totalAmount = await Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    
    const statusCounts = await Payment.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    
    const categoryCounts = await Payment.aggregate([
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
  } catch (error) {
    console.error("Error fetching payment stats:", error);
    return res.status(500).json({ error: "Failed to fetch payment statistics" });
  }
});

export default router;
