"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const Pricing_1 = require("../models/Pricing");
const router = (0, express_1.Router)();
// Get pricing table
router.get("/", async (_req, res, next) => {
    try {
        const doc = await Pricing_1.Pricing.findOne();
        return res.json({ entries: doc?.entries || [] });
    }
    catch (e) {
        next(e);
    }
});
// Upsert pricing (admin)
const upsertSchema = zod_1.z.object({
    entries: zod_1.z.array(zod_1.z.object({
        audience: zod_1.z.enum(["user", "advertiser"]),
        country: zod_1.z.string().min(2),
        unit: zod_1.z.literal("per_1000").optional(),
        rates: zod_1.z.object({
            google_review: zod_1.z.number().min(0),
            website_traffic: zod_1.z.number().min(0),
            video_views: zod_1.z.number().min(0),
            like_follow: zod_1.z.number().min(0),
        })
    }))
});
router.put("/", auth_1.requireAdmin, async (req, res, next) => {
    try {
        const parsed = upsertSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        const doc = await Pricing_1.Pricing.findOneAndUpdate({}, { entries: parsed.data.entries }, { new: true, upsert: true });
        return res.json({ entries: doc.entries });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
