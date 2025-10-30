"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const Contact_1 = require("../../models/Contact");
const security_1 = require("../../middleware/security");
const router = (0, express_1.Router)();
// Get all contact messages (admin only)
router.get("/messages", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const read = req.query.read;
        const search = req.query.search;
        const skip = (page - 1) * limit;
        let query = {};
        if (read === 'true' || read === 'false') {
            query.readByAdmin = read === 'true';
        }
        if (search) {
            const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { subject: searchRegex },
                { message: searchRegex }
            ];
        }
        const total = await Contact_1.Contact.countDocuments(query);
        const messages = await Contact_1.Contact.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        return res.json({
            messages,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1,
            }
        });
    }
    catch (error) {
        console.error("Error fetching contact messages:", error);
        return res.status(500).json({ error: "Mesajlar alınamadı" });
    }
});
// Get single contact message (admin only)
router.get("/messages/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Geçersiz mesaj ID" });
        }
        const message = await Contact_1.Contact.findById(id);
        if (!message) {
            return res.status(404).json({ error: "Mesaj bulunamadı" });
        }
        return res.json(message);
    }
    catch (error) {
        console.error("Error fetching contact message:", error);
        return res.status(500).json({ error: "Mesaj alınamadı" });
    }
});
// Mark contact message as read (admin only)
router.put("/messages/:id/read", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Geçersiz mesaj ID" });
        }
        const message = await Contact_1.Contact.findByIdAndUpdate(id, { readByAdmin: true }, { new: true });
        if (!message) {
            return res.status(404).json({ error: "Mesaj bulunamadı" });
        }
        return res.json(message);
    }
    catch (error) {
        console.error("Error updating contact message:", error);
        return res.status(500).json({ error: "Mesaj güncellenemedi" });
    }
});
// Mark contact message as replied (admin only)
router.put("/messages/:id/replied", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Geçersiz mesaj ID" });
        }
        const message = await Contact_1.Contact.findByIdAndUpdate(id, { replied: true }, { new: true });
        if (!message) {
            return res.status(404).json({ error: "Mesaj bulunamadı" });
        }
        return res.json(message);
    }
    catch (error) {
        console.error("Error updating contact message:", error);
        return res.status(500).json({ error: "Mesaj güncellenemedi" });
    }
});
// Delete contact message (admin only)
router.delete("/messages/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Geçersiz mesaj ID" });
        }
        const message = await Contact_1.Contact.findByIdAndDelete(id);
        if (!message) {
            return res.status(404).json({ error: "Mesaj bulunamadı" });
        }
        return res.json({ message: "Mesaj silindi" });
    }
    catch (error) {
        console.error("Error deleting contact message:", error);
        return res.status(500).json({ error: "Mesaj silinemedi" });
    }
});
// Get contact statistics (admin only)
router.get("/stats", auth_1.requireAdmin, async (req, res) => {
    try {
        const total = await Contact_1.Contact.countDocuments();
        const unread = await Contact_1.Contact.countDocuments({ readByAdmin: false });
        const replied = await Contact_1.Contact.countDocuments({ replied: true });
        const unreplied = await Contact_1.Contact.countDocuments({ replied: false });
        const recentMessages = await Contact_1.Contact.find()
            .sort({ createdAt: -1 })
            .limit(10);
        return res.json({
            total,
            unread,
            replied,
            unreplied,
            recentMessages,
        });
    }
    catch (error) {
        console.error("Error fetching contact stats:", error);
        return res.status(500).json({ error: "İstatistikler alınamadı" });
    }
});
exports.default = router;
