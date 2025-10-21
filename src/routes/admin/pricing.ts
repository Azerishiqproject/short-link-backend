import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/auth";
import { Pricing } from "../../models/Pricing";

const router = Router();

// Validation schema
const pricingEntrySchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().min(0, "Price must be positive"),
  features: z.array(z.string()).min(1, "At least one feature is required"),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const upsertPricingSchema = z.object({
  entries: z.array(pricingEntrySchema).min(1, "At least one pricing entry is required"),
});

// Get pricing table (admin)
router.get("/", requireAdmin, async (req, res) => {
  try {
    const doc = await Pricing.findOne();
    return res.json({ entries: doc?.entries || [] });
  } catch (error) {
    console.error("Error fetching pricing:", error);
    return res.status(500).json({ error: "Failed to fetch pricing" });
  }
});

// Update pricing table (admin)
router.put("/", requireAdmin, async (req, res) => {
  try {
    const validatedData = upsertPricingSchema.parse(req.body);
    
    const doc = await Pricing.findOneAndUpdate(
      {},
      { entries: validatedData.entries },
      { upsert: true, new: true }
    );
    
    return res.json({ entries: doc.entries });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    console.error("Error updating pricing:", error);
    return res.status(500).json({ error: "Failed to update pricing" });
  }
});

export default router;

