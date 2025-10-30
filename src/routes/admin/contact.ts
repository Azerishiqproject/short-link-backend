import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/auth";
import { Contact } from "../../models/Contact";
import { mongoSanitize } from "../../middleware/security";

const router = Router();

// Get all contact messages (admin only)
router.get("/messages", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const read = req.query.read as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    let query: any = {};
    
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

    const total = await Contact.countDocuments(query);
    const messages = await Contact.find(query)
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
  } catch (error) {
    console.error("Error fetching contact messages:", error);
    return res.status(500).json({ error: "Mesajlar alınamadı" });
  }
});

// Get single contact message (admin only)
router.get("/messages/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Geçersiz mesaj ID" });
    }

    const message = await Contact.findById(id);
    
    if (!message) {
      return res.status(404).json({ error: "Mesaj bulunamadı" });
    }

    return res.json(message);
  } catch (error) {
    console.error("Error fetching contact message:", error);
    return res.status(500).json({ error: "Mesaj alınamadı" });
  }
});

// Mark contact message as read (admin only)
router.put("/messages/:id/read", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Geçersiz mesaj ID" });
    }

    const message = await Contact.findByIdAndUpdate(
      id,
      { readByAdmin: true },
      { new: true }
    );
    
    if (!message) {
      return res.status(404).json({ error: "Mesaj bulunamadı" });
    }

    return res.json(message);
  } catch (error) {
    console.error("Error updating contact message:", error);
    return res.status(500).json({ error: "Mesaj güncellenemedi" });
  }
});

// Mark contact message as replied (admin only)
router.put("/messages/:id/replied", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Geçersiz mesaj ID" });
    }

    const message = await Contact.findByIdAndUpdate(
      id,
      { replied: true },
      { new: true }
    );
    
    if (!message) {
      return res.status(404).json({ error: "Mesaj bulunamadı" });
    }

    return res.json(message);
  } catch (error) {
    console.error("Error updating contact message:", error);
    return res.status(500).json({ error: "Mesaj güncellenemedi" });
  }
});

// Delete contact message (admin only)
router.delete("/messages/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Geçersiz mesaj ID" });
    }

    const message = await Contact.findByIdAndDelete(id);
    
    if (!message) {
      return res.status(404).json({ error: "Mesaj bulunamadı" });
    }

    return res.json({ message: "Mesaj silindi" });
  } catch (error) {
    console.error("Error deleting contact message:", error);
    return res.status(500).json({ error: "Mesaj silinemedi" });
  }
});

// Get contact statistics (admin only)
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const total = await Contact.countDocuments();
    const unread = await Contact.countDocuments({ readByAdmin: false });
    const replied = await Contact.countDocuments({ replied: true });
    const unreplied = await Contact.countDocuments({ replied: false });
    
    const recentMessages = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(10);

    return res.json({
      total,
      unread,
      replied,
      unreplied,
      recentMessages,
    });
  } catch (error) {
    console.error("Error fetching contact stats:", error);
    return res.status(500).json({ error: "İstatistikler alınamadı" });
  }
});

export default router;

