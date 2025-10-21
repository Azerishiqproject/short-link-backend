import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/auth";
import { Campaign } from "../../models/Campaign";
import { User } from "../../models/User";
import { mongoSanitize } from "../../middleware/security";

const router = Router();

// Validation schemas
const updateCampaignStatusSchema = z.object({
  status: z.enum(["active", "paused", "completed", "cancelled"]),
});

// Get all campaigns (admin)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    let query: any = {};
    
    if (status) {
      query.status = status;
    }
    
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex }
      ];
    }

    const totalCampaigns = await Campaign.countDocuments(query);
    const campaigns = await Campaign.find(query)
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.json({
      campaigns,
      pagination: {
        page,
        limit,
        total: totalCampaigns,
        totalPages: Math.ceil(totalCampaigns / limit),
        hasNext: page < Math.ceil(totalCampaigns / limit),
        hasPrev: page > 1,
      }
    });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// Get single campaign (admin)
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const campaign = await Campaign.findById(id).populate('ownerId', 'name email');
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    return res.json(campaign);
  } catch (error) {
    console.error("Error fetching campaign:", error);
    return res.status(500).json({ error: "Failed to fetch campaign" });
  }
});

// Update campaign status (admin)
router.put("/:id/status", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const validatedData = updateCampaignStatusSchema.parse(req.body);
    
    const campaign = await Campaign.findByIdAndUpdate(
      id, 
      { status: validatedData.status },
      { new: true }
    ).populate('ownerId', 'name email');
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    return res.json(campaign);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    console.error("Error updating campaign status:", error);
    return res.status(500).json({ error: "Failed to update campaign status" });
  }
});

// Get campaign statistics (admin)
router.get("/stats/overview", requireAdmin, async (req, res) => {
  try {
    const totalCampaigns = await Campaign.countDocuments();
    const totalBudget = await Campaign.aggregate([
      { $group: { _id: null, total: { $sum: "$budget" } } }
    ]);
    
    const statusCounts = await Campaign.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const recentCampaigns = await Campaign.find()
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .limit(5);

    return res.json({
      totalCampaigns,
      totalBudget: totalBudget[0]?.total || 0,
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      recentCampaigns,
    });
  } catch (error) {
    console.error("Error fetching campaign stats:", error);
    return res.status(500).json({ error: "Failed to fetch campaign statistics" });
  }
});

export default router;
