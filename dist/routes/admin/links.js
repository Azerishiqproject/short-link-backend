"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const Link_1 = require("../../models/Link");
const security_1 = require("../../middleware/security");
const router = (0, express_1.Router)();
// Validation schemas
const updateLinkSchema = zod_1.z.object({
    isActive: zod_1.z.boolean().optional(),
    expiresAt: zod_1.z.string().datetime().optional(),
});
// Get all links (admin)
router.get("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search;
        const isActive = req.query.isActive;
        const skip = (page - 1) * limit;
        let query = {};
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
        const totalLinks = await Link_1.Link.countDocuments(query);
        const links = await Link_1.Link.find(query)
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
    }
    catch (error) {
        console.error("Error fetching links:", error);
        return res.status(500).json({ error: "Failed to fetch links" });
    }
});
// Get single link (admin)
router.get("/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid link ID" });
        }
        const link = await Link_1.Link.findById(id).populate('ownerId', 'name email');
        if (!link) {
            return res.status(404).json({ error: "Link not found" });
        }
        return res.json(link);
    }
    catch (error) {
        console.error("Error fetching link:", error);
        return res.status(500).json({ error: "Failed to fetch link" });
    }
});
// Update link (admin)
router.put("/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid link ID" });
        }
        const validatedData = updateLinkSchema.parse(req.body);
        const updateData = {};
        if (validatedData.isActive !== undefined) {
            updateData.isActive = validatedData.isActive;
        }
        if (validatedData.expiresAt) {
            updateData.expiresAt = new Date(validatedData.expiresAt);
        }
        const link = await Link_1.Link.findByIdAndUpdate(id, updateData, { new: true }).populate('ownerId', 'name email');
        if (!link) {
            return res.status(404).json({ error: "Link not found" });
        }
        return res.json(link);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error updating link:", error);
        return res.status(500).json({ error: "Failed to update link" });
    }
});
// Delete link (admin)
router.delete("/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid link ID" });
        }
        const link = await Link_1.Link.findByIdAndDelete(id);
        if (!link) {
            return res.status(404).json({ error: "Link not found" });
        }
        return res.json({ message: "Link deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting link:", error);
        return res.status(500).json({ error: "Failed to delete link" });
    }
});
// Get link statistics (admin)
router.get("/stats/overview", auth_1.requireAdmin, async (req, res) => {
    try {
        const totalLinks = await Link_1.Link.countDocuments();
        const activeLinks = await Link_1.Link.countDocuments({ isActive: true });
        const expiredLinks = await Link_1.Link.countDocuments({
            expiresAt: { $lt: new Date() }
        });
        const recentLinks = await Link_1.Link.find()
            .populate('ownerId', 'name email')
            .sort({ createdAt: -1 })
            .limit(10);
        const topLinks = await Link_1.Link.aggregate([
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
    }
    catch (error) {
        console.error("Error fetching link stats:", error);
        return res.status(500).json({ error: "Failed to fetch link statistics" });
    }
});
exports.default = router;
