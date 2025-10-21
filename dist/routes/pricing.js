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
        // Expect ISO-3166 alpha-2 code directly (e.g., TR, AZ)
        country: zod_1.z.string().regex(/^[A-Za-z]{2,3}$/),
        unit: zod_1.z.literal("per_1000").optional(),
        rates: zod_1.z.object({
            website_traffic: zod_1.z.number().min(0),
        })
    }))
});
// Add single pricing entry (admin)
const addEntrySchema = zod_1.z.object({
    audience: zod_1.z.enum(["user", "advertiser"]),
    country: zod_1.z.string().regex(/^[A-Za-z]{2,3}$/),
    unit: zod_1.z.literal("per_1000").optional(),
    rates: zod_1.z.object({
        website_traffic: zod_1.z.number().min(0),
    })
});
router.post("/", auth_1.requireAdmin, async (req, res, next) => {
    try {
        console.log("Pricing add entry request body:", JSON.stringify(req.body, null, 2));
        const parsed = addEntrySchema.safeParse(req.body);
        if (!parsed.success) {
            console.log("Validation error:", parsed.error.flatten());
            return res.status(400).json({ error: parsed.error.flatten() });
        }
        const doc = await Pricing_1.Pricing.findOne();
        if (!doc) {
            // İlk entry ise yeni document oluştur
            const newDoc = new Pricing_1.Pricing({
                entries: [{ ...parsed.data, country: parsed.data.country.toUpperCase(), unit: parsed.data.unit || "per_1000" }]
            });
            await newDoc.save();
            return res.json({ entries: newDoc.entries });
        }
        // Mevcut document'e ekle
        const newEntry = { ...parsed.data, country: parsed.data.country.toUpperCase(), unit: parsed.data.unit || "per_1000" };
        doc.entries.push(newEntry);
        await doc.save();
        return res.json({ entries: doc.entries });
    }
    catch (e) {
        console.log("Pricing add entry error:", e);
        next(e);
    }
});
router.put("/", auth_1.requireAdmin, async (req, res, next) => {
    try {
        console.log("Pricing upsert request body:", JSON.stringify(req.body, null, 2));
        const parsed = upsertSchema.safeParse(req.body);
        if (!parsed.success) {
            console.log("Validation error:", parsed.error.flatten());
            return res.status(400).json({ error: parsed.error.flatten() });
        }
        // Save as provided, enforcing ISO-2 via schema; default unit
        const entries = parsed.data.entries.map((e) => ({ ...e, country: e.country.toUpperCase(), unit: e.unit || "per_1000" }));
        const doc = await Pricing_1.Pricing.findOneAndUpdate({}, { entries }, { new: true, upsert: true });
        return res.json({ entries: doc.entries });
    }
    catch (e) {
        console.log("Pricing upsert error:", e);
        next(e);
    }
});
// Delete specific pricing entry (admin)
router.delete("/:audience/:country", auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { audience, country } = req.params;
        const doc = await Pricing_1.Pricing.findOne();
        if (!doc)
            return res.status(404).json({ error: "Pricing not found" });
        // Filter out the entry to delete
        const filteredEntries = doc.entries.filter((entry) => !(entry.audience === audience && entry.country.toUpperCase() === country.toUpperCase()));
        doc.entries = filteredEntries;
        await doc.save();
        return res.json({ entries: doc.entries });
    }
    catch (e) {
        next(e);
    }
});
// Update specific pricing entry (admin)
const updateSchema = zod_1.z.object({
    audience: zod_1.z.enum(["user", "advertiser"]),
    country: zod_1.z.string().regex(/^[A-Za-z]{2,3}$/),
    unit: zod_1.z.literal("per_1000").optional(),
    rates: zod_1.z.object({
        website_traffic: zod_1.z.number().min(0),
    })
});
router.patch("/:audience/:country", auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { audience, country } = req.params;
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        const doc = await Pricing_1.Pricing.findOne();
        if (!doc)
            return res.status(404).json({ error: "Pricing not found" });
        // Find and update the specific entry
        const entryIndex = doc.entries.findIndex((entry) => entry.audience === audience && entry.country.toUpperCase() === country.toUpperCase());
        if (entryIndex === -1)
            return res.status(404).json({ error: "Pricing entry not found" });
        // Update the entry
        doc.entries[entryIndex] = {
            ...parsed.data,
            country: parsed.data.country.toUpperCase(),
            unit: parsed.data.unit || "per_1000"
        };
        await doc.save();
        return res.json({ entries: doc.entries });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
