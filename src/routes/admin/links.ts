import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/auth";
import { Link } from "../../models/Link";
import { User } from "../../models/User";
import { mongoSanitize } from "../../middleware/security";

const router = Router();

// Validation schemas
const updateLinkSchema = z.object({
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

// Get all links (admin)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const isActive = req.query.isActive as string;
    const skip = (page - 1) * limit;

    let query: any = {};
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { slug: searchRegex },
        { targetUrl: searchRegex }
      ];
    }

    const totalLinks = await Link.countDocuments(query);
    const links = await Link.find(query)
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.json({
      links,
      pagination: {
        page,
        limit,
        total: totalLinks,
        totalPages: Math.ceil(totalLinks / limit),
        hasNext: page < Math.ceil(totalLinks / limit),
        hasPrev: page > 1,
      }
    });
  } catch (error) {
    console.error("Error fetching links:", error);
    return res.status(500).json({ error: "Failed to fetch links" });
  }
});

// Get single link (admin)
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid link ID" });
    }

    const link = await Link.findById(id).populate('ownerId', 'name email');
    
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    return res.json(link);
  } catch (error) {
    console.error("Error fetching link:", error);
    return res.status(500).json({ error: "Failed to fetch link" });
  }
});

// Update link (admin)
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid link ID" });
    }

    const validatedData = updateLinkSchema.parse(req.body);
    
    const updateData: any = {};
    if (validatedData.isActive !== undefined) {
      updateData.isActive = validatedData.isActive;
    }
    if (validatedData.expiresAt) {
      updateData.expiresAt = new Date(validatedData.expiresAt);
    }
    
    const link = await Link.findByIdAndUpdate(
      id, 
      updateData,
      { new: true }
    ).populate('ownerId', 'name email');
    
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    return res.json(link);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    console.error("Error updating link:", error);
    return res.status(500).json({ error: "Failed to update link" });
  }
});

// Delete link (admin)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid link ID" });
    }

    const link = await Link.findByIdAndDelete(id);
    
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    return res.json({ message: "Link deleted successfully" });
  } catch (error) {
    console.error("Error deleting link:", error);
    return res.status(500).json({ error: "Failed to delete link" });
  }
});

// Get link statistics (admin)
router.get("/stats/overview", requireAdmin, async (req, res) => {
  try {
    const totalLinks = await Link.countDocuments();
    const activeLinks = await Link.countDocuments({ isActive: true });
    const expiredLinks = await Link.countDocuments({ 
      expiresAt: { $lt: new Date() } 
    });
    
    const recentLinks = await Link.find()
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    const topLinks = await Link.aggregate([
      { $sort: { clickCount: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: 'ownerId', foreignField: '_id', as: 'owner' } },
      { $unwind: '$owner' },
      { $project: { slug: 1, targetUrl: 1, clickCount: 1, owner: { name: 1, email: 1 } } }
    ]);

    return res.json({
      totalLinks,
      activeLinks,
      expiredLinks,
      recentLinks,
      topLinks,
    });
  } catch (error) {
    console.error("Error fetching link stats:", error);
    return res.status(500).json({ error: "Failed to fetch link statistics" });
  }
});

export default router;
