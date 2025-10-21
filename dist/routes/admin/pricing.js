"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const Pricing_1 = require("../../models/Pricing");
const router = (0, express_1.Router)();
// Validation schema
const pricingEntrySchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required"),
    price: zod_1.z.number().min(0, "Price must be positive"),
    features: zod_1.z.array(zod_1.z.string()).min(1, "At least one feature is required"),
    isPopular: zod_1.z.boolean().default(false),
    isActive: zod_1.z.boolean().default(true),
});
const upsertPricingSchema = zod_1.z.object({
    entries: zod_1.z.array(pricingEntrySchema).min(1, "At least one pricing entry is required"),
});
// Get pricing table (admin)
router.get("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const doc = await Pricing_1.Pricing.findOne();
        return res.json({ entries: doc?.entries || [] });
    }
    catch (error) {
        console.error("Error fetching pricing:", error);
        return res.status(500).json({ error: "Failed to fetch pricing" });
    }
});
// Update pricing table (admin)
router.put("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const validatedData = upsertPricingSchema.parse(req.body);
        const doc = await Pricing_1.Pricing.findOneAndUpdate({}, { entries: validatedData.entries }, { upsert: true, new: true });
        return res.json({ entries: doc.entries });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error updating pricing:", error);
        return res.status(500).json({ error: "Failed to update pricing" });
    }
});
exports.default = router;
