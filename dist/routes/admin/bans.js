"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const Ban_1 = require("../../models/Ban");
const router = (0, express_1.Router)();
const createBanSchema = zod_1.z.object({
    email: zod_1.z.string().email().optional(),
    ip: zod_1.z.string().trim().min(3).max(100).optional(),
    deviceId: zod_1.z.string().trim().min(3).max(200).optional(),
    reason: zod_1.z.string().trim().max(500).optional(),
    expiresAt: zod_1.z.string().datetime().optional(),
});
// List bans
router.get("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = parseInt(String(req.query.page || 1));
        const limit = Math.min(100, parseInt(String(req.query.limit || 20)));
        const skip = (page - 1) * limit;
        const total = await Ban_1.Ban.countDocuments();
        const bans = await Ban_1.Ban.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
        return res.json({ bans, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    }
    catch (e) {
        return res.status(500).json({ error: "Ban listesi getirilemedi" });
    }
});
// Create ban (by email, IP or deviceId)
router.post("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const parsed = createBanSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: parsed.error.flatten() });
        const { email, ip, deviceId, reason, expiresAt } = parsed.data;
        if (!email && !ip && !deviceId)
            return res.status(400).json({ error: "email, ip veya deviceId gerekli" });
        const doc = { reason, active: true };
        if (email)
            doc.email = email;
        if (ip)
            doc.ip = ip;
        if (deviceId)
            doc.mac = deviceId; // reuse mac field to store deviceId
        if (expiresAt)
            doc.expiresAt = new Date(expiresAt);
        const ban = await Ban_1.Ban.create(doc);
        return res.status(201).json({ ban });
    }
    catch (e) {
        return res.status(500).json({ error: "Ban oluşturulamadı" });
    }
});
// Delete/disable ban
router.delete("/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const ban = await Ban_1.Ban.findByIdAndDelete(id);
        if (!ban)
            return res.status(404).json({ error: "Bulunamadı" });
        return res.json({ ok: true });
    }
    catch (e) {
        return res.status(500).json({ error: "Ban silinemedi" });
    }
});
// Toggle active
router.patch("/:id/toggle", auth_1.requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const ban = await Ban_1.Ban.findById(id);
        if (!ban)
            return res.status(404).json({ error: "Bulunamadı" });
        ban.active = !ban.active;
        await ban.save();
        return res.json({ ban });
    }
    catch (e) {
        return res.status(500).json({ error: "Ban güncellenemedi" });
    }
});
exports.default = router;
