"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const Support_1 = require("../models/Support");
const security_1 = require("../middleware/security");
const router = (0, express_1.Router)();
// Create a brand new support thread explicitly (allows multiple threads)
const createSchema = zod_1.z.object({ subject: zod_1.z.string().max(200).optional() });
router.post("/threads", auth_1.requireAuth, async (req, res) => {
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const userId = req.user.sub;
    const doc = await Support_1.Support.create({ userId, status: "open", subject: parsed.data.subject || undefined, lastMessageAt: new Date(), lastMessageBy: "user" });
    return res.status(201).json({ thread: doc });
});
// User: open or get active support record (but do not create on GET)
router.post("/thread/open", auth_1.requireAuth, async (req, res) => {
    const userId = req.user.sub;
    let doc = await Support_1.Support.findOne({ userId, status: "open" });
    if (!doc) {
        doc = await Support_1.Support.create({ userId, status: "open", lastMessageAt: new Date(), lastMessageBy: "user" });
    }
    return res.json({ thread: doc });
});
// User: list my threads
router.get("/threads/me", auth_1.requireAuth, async (req, res) => {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
    const skip = (page - 1) * limit;
    const total = await Support_1.Support.countDocuments({ userId });
    const items = await Support_1.Support.find({ userId }).select("status subject lastMessageAt lastMessageBy").sort({ lastMessageAt: -1 }).skip(skip).limit(limit);
    return res.json({ threads: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});
// Admin: list threads with pagination
router.get("/admin/threads", auth_1.requireAdmin, async (req, res) => {
    const status = String(req.query.status || "open");
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
    const skip = (page - 1) * limit;
    const filter = {};
    if (["open", "closed"].includes(status))
        filter.status = status;
    const total = await Support_1.Support.countDocuments(filter);
    const items = await Support_1.Support.find(filter).select("status subject lastMessageAt lastMessageBy userId").sort({ lastMessageAt: -1 }).skip(skip).limit(limit).populate("userId", "email name");
    return res.json({ threads: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});
// Get messages for a thread (owner or admin) with pagination
router.get("/threads/:id/messages", auth_1.requireAuth, async (req, res) => {
    const id = req.params.id;
    if (!security_1.mongoSanitize.isValidObjectId(id))
        return res.status(400).json({ error: "Invalid thread id" });
    const user = req.user;
    const thread = await Support_1.Support.findById(id).select("userId status messages lastMessageAt lastMessageBy subject");
    if (!thread)
        return res.status(404).json({ error: "Not found" });
    const isOwner = String(thread.userId) === String(user.sub);
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin)
        return res.status(403).json({ error: "Forbidden" });
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
    const total = (thread.messages || []).length;
    const start = Math.max(0, total - page * limit);
    const end = Math.min(total, start + limit);
    const slice = (thread.messages || []).slice(Math.max(0, start), Math.max(0, end));
    // mark read
    if (isOwner) {
        slice.forEach((m) => { if (!m.readByUser)
            m.readByUser = true; });
    }
    else if (isAdmin) {
        slice.forEach((m) => { if (!m.readByAdmin)
            m.readByAdmin = true; });
    }
    await thread.save();
    return res.json({
        thread: { _id: thread._id, status: thread.status, subject: thread.subject, lastMessageAt: thread.lastMessageAt, lastMessageBy: thread.lastMessageBy },
        messages: slice,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
});
// Post message to a thread (owner or admin)
const messageSchema = zod_1.z.object({ content: zod_1.z.string().min(1).max(4000) });
router.post("/threads/:id/messages", auth_1.requireAuth, async (req, res) => {
    const id = req.params.id;
    if (!security_1.mongoSanitize.isValidObjectId(id))
        return res.status(400).json({ error: "Invalid thread id" });
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const user = req.user;
    const thread = await Support_1.Support.findById(id);
    if (!thread)
        return res.status(404).json({ error: "Not found" });
    const isOwner = String(thread.userId) === String(user.sub);
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin)
        return res.status(403).json({ error: "Forbidden" });
    const msg = {
        role: isAdmin ? "admin" : "user",
        content: parsed.data.content,
        createdAt: new Date(),
        readByAdmin: isAdmin,
        readByUser: isOwner,
    };
    thread.messages.push(msg);
    thread.lastMessageAt = new Date();
    thread.lastMessageBy = msg.role;
    await thread.save();
    const created = thread.messages[thread.messages.length - 1];
    return res.status(201).json({ message: created });
});
// Admin: close a thread
router.post("/admin/threads/:id/close", auth_1.requireAdmin, async (req, res) => {
    const id = req.params.id;
    if (!security_1.mongoSanitize.isValidObjectId(id))
        return res.status(400).json({ error: "Invalid thread id" });
    const updated = await Support_1.Support.findByIdAndUpdate(id, { status: "closed" }, { new: true });
    if (!updated)
        return res.status(404).json({ error: "Not found" });
    return res.json({ thread: updated });
});
// Admin: delete a single message from a support thread
router.delete("/admin/threads/:threadId/messages/:messageId", auth_1.requireAdmin, async (req, res) => {
    const { threadId, messageId } = req.params;
    if (!security_1.mongoSanitize.isValidObjectId(threadId) || !security_1.mongoSanitize.isValidObjectId(messageId)) {
        return res.status(400).json({ error: "Invalid id" });
    }
    const doc = await Support_1.Support.findById(threadId);
    if (!doc)
        return res.status(404).json({ error: "Not found" });
    const before = (doc.messages || []).length;
    doc.messages = (doc.messages || []).filter((m) => String(m._id) !== String(messageId));
    const after = doc.messages.length;
    if (after === before)
        return res.status(404).json({ error: "Message not found" });
    if (after > 0) {
        const last = doc.messages[after - 1];
        doc.lastMessageAt = last.createdAt || new Date();
        doc.lastMessageBy = last.role || 'user';
    }
    await doc.save();
    return res.json({ ok: true });
});
exports.default = router;
