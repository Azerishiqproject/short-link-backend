"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const Support_1 = require("../../models/Support");
const security_1 = require("../../middleware/security");
const router = (0, express_1.Router)();
// Validation schemas
const updateSupportStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["open", "in_progress", "resolved", "closed"]),
});
const replyToSupportSchema = zod_1.z.object({
    message: zod_1.z.string().min(1, "Message is required"),
    isInternal: zod_1.z.boolean().default(false),
});
// Get all support threads (admin)
router.get("/threads", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;
        const search = req.query.search;
        const skip = (page - 1) * limit;
        let query = {};
        if (status) {
            query.status = status;
        }
        if (search) {
            const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [
                { subject: searchRegex },
                { 'messages.content': searchRegex }
            ];
        }
        const totalThreads = await Support_1.Support.countDocuments(query);
        const threads = await Support_1.Support.find(query)
            .populate('userId', 'name email')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit);
        return res.json({
            threads,
            pagination: {
                page,
                limit,
                total: totalThreads,
                totalPages: Math.ceil(totalThreads / limit),
                hasNext: page < Math.ceil(totalThreads / limit),
                hasPrev: page > 1,
            }
        });
    }
    catch (error) {
        console.error("Error fetching support threads:", error);
        return res.status(500).json({ error: "Failed to fetch support threads" });
    }
});
// Get single support thread (admin)
router.get("/threads/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid thread ID" });
        }
        const thread = await Support_1.Support.findById(id).populate('userId', 'name email');
        if (!thread) {
            return res.status(404).json({ error: "Support thread not found" });
        }
        return res.json(thread);
    }
    catch (error) {
        console.error("Error fetching support thread:", error);
        return res.status(500).json({ error: "Failed to fetch support thread" });
    }
});
// Update support thread status (admin)
router.put("/threads/:id/status", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid thread ID" });
        }
        const validatedData = updateSupportStatusSchema.parse(req.body);
        const thread = await Support_1.Support.findByIdAndUpdate(id, { status: validatedData.status }, { new: true }).populate('userId', 'name email');
        if (!thread) {
            return res.status(404).json({ error: "Support thread not found" });
        }
        return res.json(thread);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error updating support thread status:", error);
        return res.status(500).json({ error: "Failed to update support thread status" });
    }
});
// Reply to support thread (admin)
router.post("/threads/:id/reply", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid thread ID" });
        }
        const validatedData = replyToSupportSchema.parse(req.body);
        const adminId = req.user.sub;
        const thread = await Support_1.Support.findById(id);
        if (!thread) {
            return res.status(404).json({ error: "Support thread not found" });
        }
        const newMessage = {
            content: validatedData.message,
            senderId: adminId,
            isAdmin: true,
            isInternal: validatedData.isInternal,
            timestamp: new Date(),
        };
        thread.messages.push(newMessage);
        thread.updatedAt = new Date();
        await thread.save();
        await thread.populate('userId', 'name email');
        return res.json(thread);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error replying to support thread:", error);
        return res.status(500).json({ error: "Failed to reply to support thread" });
    }
});
// Get support statistics (admin)
router.get("/stats/overview", auth_1.requireAdmin, async (req, res) => {
    try {
        const totalThreads = await Support_1.Support.countDocuments();
        const openThreads = await Support_1.Support.countDocuments({ status: "open" });
        const inProgressThreads = await Support_1.Support.countDocuments({ status: "in_progress" });
        const resolvedThreads = await Support_1.Support.countDocuments({ status: "resolved" });
        const recentThreads = await Support_1.Support.find()
            .populate('userId', 'name email')
            .sort({ updatedAt: -1 })
            .limit(10);
        const statusCounts = await Support_1.Support.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        return res.json({
            totalThreads,
            openThreads,
            inProgressThreads,
            resolvedThreads,
            recentThreads,
            statusCounts: statusCounts.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
        });
    }
    catch (error) {
        console.error("Error fetching support stats:", error);
        return res.status(500).json({ error: "Failed to fetch support statistics" });
    }
});
exports.default = router;
