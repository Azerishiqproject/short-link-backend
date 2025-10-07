import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth";
import { Pricing } from "../models/Pricing";

const router = Router();

// Get pricing table
router.get("/", async (_req, res, next) => {
  try {
    const doc = await Pricing.findOne();
    return res.json({ entries: doc?.entries || [] });
  } catch (e) { next(e); }
});

// Upsert pricing (admin)
const upsertSchema = z.object({
  entries: z.array(z.object({
    audience: z.enum(["user", "advertiser"]),
    country: z.string().min(2),
    unit: z.literal("per_1000").optional(),
    rates: z.object({
      google_review: z.number().min(0),
      website_traffic: z.number().min(0),
      video_views: z.number().min(0),
      like_follow: z.number().min(0),
    })
  }))
});

router.put("/", requireAdmin, async (req, res, next) => {
  try {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const doc = await Pricing.findOneAndUpdate({}, { entries: parsed.data.entries }, { new: true, upsert: true });
    return res.json({ entries: doc.entries });
  } catch (e) { next(e); }
});

export default router;


