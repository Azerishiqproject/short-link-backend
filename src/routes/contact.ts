import { Router } from "express";
import { z } from "zod";
import { Contact } from "../models/Contact";
import rateLimit from "express-rate-limit";
import { mongoSanitize } from "../middleware/security";

const router = Router();

// Rate limiting for contact form - 5 requests per 15 minutes per IP
const contactFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schema for contact form
const contactSchema = z.object({
  name: z.string().min(1, "Ad Soyad gereklidir").max(100, "Ad Soyad çok uzun"),
  email: z.string().email("Geçerli bir e-posta adresi giriniz").max(100, "E-posta çok uzun"),
  subject: z.string().min(1, "Konu gereklidir").max(200, "Konu çok uzun"),
  message: z.string().min(1, "Mesaj gereklidir").max(2000, "Mesaj çok uzun"),
});

// Public contact form endpoint - no authentication required
router.post("/submit", contactFormLimiter, async (req, res) => {
  try {
    const parsed = contactSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Geçersiz veri", 
        details: parsed.error.issues 
      });
    }

    // Sanitize inputs
    const sanitizedData = {
      name: mongoSanitize.sanitizeInput(parsed.data.name),
      email: mongoSanitize.sanitizeInput(parsed.data.email),
      subject: mongoSanitize.sanitizeInput(parsed.data.subject),
      message: mongoSanitize.sanitizeInput(parsed.data.message),
    };

    // Get IP address and user agent for security/analytics
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
    const userAgent = req.get("user-agent") || "unknown";

    // Create contact message
    const contact = await Contact.create({
      ...sanitizedData,
      ipAddress,
      userAgent,
      readByAdmin: false,
      replied: false,
    });

    return res.status(201).json({ 
      message: "Mesajınız başarıyla gönderildi. En kısa sürede size dönüş yapacağız.",
      id: contact._id 
    });
  } catch (error) {
    console.error("Error creating contact message:", error);
    return res.status(500).json({ error: "Mesaj gönderilemedi. Lütfen tekrar deneyin." });
  }
});

export default router;

