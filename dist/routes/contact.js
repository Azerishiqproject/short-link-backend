"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const Contact_1 = require("../models/Contact");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const security_1 = require("../middleware/security");
const router = (0, express_1.Router)();
// Rate limiting for contact form - 5 requests per 15 minutes per IP
const contactFormLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: "Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.",
    standardHeaders: true,
    legacyHeaders: false,
});
// Validation schema for contact form
const contactSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Ad Soyad gereklidir").max(100, "Ad Soyad çok uzun"),
    email: zod_1.z.string().email("Geçerli bir e-posta adresi giriniz").max(100, "E-posta çok uzun"),
    subject: zod_1.z.string().min(1, "Konu gereklidir").max(200, "Konu çok uzun"),
    message: zod_1.z.string().min(1, "Mesaj gereklidir").max(2000, "Mesaj çok uzun"),
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
            name: security_1.mongoSanitize.sanitizeInput(parsed.data.name),
            email: security_1.mongoSanitize.sanitizeInput(parsed.data.email),
            subject: security_1.mongoSanitize.sanitizeInput(parsed.data.subject),
            message: security_1.mongoSanitize.sanitizeInput(parsed.data.message),
        };
        // Get IP address and user agent for security/analytics
        const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
        const userAgent = req.get("user-agent") || "unknown";
        // Create contact message
        const contact = await Contact_1.Contact.create({
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
    }
    catch (error) {
        console.error("Error creating contact message:", error);
        return res.status(500).json({ error: "Mesaj gönderilemedi. Lütfen tekrar deneyin." });
    }
});
exports.default = router;
