import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { Campaign } from "../models/Campaign";
import { User } from "../models/User";

const router = Router();

// List campaigns for current user
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub as string;
    const status = String((req.query.status as string) || "active");
    const filter: any = { ownerId: userId };
    if (status === "active") filter.status = "active";
    else if (status === "completed") filter.status = "completed";
    const items = await Campaign.find(filter).sort({ createdAt: -1 });
    return res.json({ campaigns: items });
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  name: z.string().min(2).max(100).optional().default("Kampanya"),
  type: z.enum(["google_review", "website_traffic", "video_views", "like_follow"]),
  target: z.number().int().min(1),
  country: z.string().min(2),
  budget: z.number().min(0),
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const userId = (req as any).user.sub as string;
    // Reserve budget atomically
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const spendable = (user.available_balance || 0) - (user.reserved_balance || 0);
    if (spendable < parsed.data.budget) {
      return res.status(400).json({ error: "Yetersiz bakiye" });
    }
    // Reserve only: don't touch available_balance here
    user.reserved_balance = (user.reserved_balance || 0) + parsed.data.budget;
    await user.save();
    const doc = await Campaign.create({ ownerId: userId, ...parsed.data });
    return res.status(201).json({ campaign: doc });
  } catch (e) {
    next(e);
  }
});

// Spend from campaign reserved
const spendSchema = z.object({ amount: z.number().positive() });
router.put("/:id/spend", requireAuth, async (req, res, next) => {
  try {
    const parsed = spendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const user = await User.findById(campaign.ownerId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if ((user.reserved_balance || 0) < parsed.data.amount) return res.status(400).json({ error: "Yetersiz rezerve" });
    user.reserved_balance = (user.reserved_balance || 0) - parsed.data.amount;
    // Each spend permanently reduces available balance
    user.available_balance = Math.max((user.available_balance || 0) - parsed.data.amount, 0);
    await user.save();
    campaign.spent = (campaign.spent || 0) + parsed.data.amount;
    await campaign.save();
    return res.json({ campaign });
  } catch (e) { next(e); }
});

// Release leftover budget back to available
router.post("/:id/release", requireAuth, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const user = await User.findById(campaign.ownerId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const reservedForThis = Math.max((campaign.budget || 0) - (campaign.spent || 0), 0);
    if (reservedForThis > 0) {
      // Release only zeroes reserved for this campaign. available already adjusted on spend.
      user.reserved_balance = Math.max((user.reserved_balance || 0) - reservedForThis, 0);
      await user.save();
    }
    campaign.status = "paused";
    await campaign.save();
    return res.json({ campaign });
  } catch (e) { next(e); }
});

// End campaign: finalize spend and zero out reserved for this campaign
router.post("/:id/end", requireAuth, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const user = await User.findById(campaign.ownerId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const reservedForThis = Math.max((campaign.budget || 0) - (campaign.spent || 0), 0);
    // Remove reserved for this campaign entirely (available already reduced during spend)
    if (reservedForThis > 0) {
      user.reserved_balance = Math.max((user.reserved_balance || 0) - reservedForThis, 0);
    }
    await user.save();
    campaign.status = "completed";
    await campaign.save();
    return res.json({ campaign });
  } catch (e) { next(e); }
});

export default router;

// Admin: summary for a user's campaigns
router.get("/admin/user/:id/summary", requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const items = await Campaign.find({ ownerId: userId }).sort({ createdAt: -1 }).lean();
    const totalSpent = items.reduce((sum, c) => sum + (c.spent || 0), 0);
    const totalBudget = items.reduce((sum, c) => sum + (c.budget || 0), 0);
    return res.json({
      campaigns: items.map((c) => ({ _id: c._id, name: c.name, type: c.type, budget: c.budget, spent: c.spent, status: c.status, createdAt: c.createdAt })),
      totals: { count: items.length, totalBudget, totalSpent }
    });
  } catch (e) {
    next(e);
  }
});


