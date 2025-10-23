"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityHeaders = exports.mongoSanitize = exports.logDbOperations = exports.commonSchemas = exports.rateLimitDbOperations = exports.sanitizeInput = void 0;
exports.banGuard = banGuard;
const zod_1 = require("zod");
const Ban_1 = require("../models/Ban");
// Input sanitization and validation middleware
const sanitizeInput = (req, res, next) => {
    // Sanitize string inputs to prevent XSS and injection attacks
    const sanitizeString = (str) => {
        if (typeof str !== 'string')
            return str;
        return str
            .replace(/[<>]/g, '') // Remove potential HTML tags
            .replace(/['"]/g, '') // Remove quotes that could break queries
            .replace(/[;]/g, '') // Remove semicolons
            .replace(/[--]/g, '') // Remove SQL comment patterns
            .replace(/\/\*/g, '') // Remove SQL comment starts
            .replace(/\*\//g, '') // Remove SQL comment ends
            .trim();
    };
    // Recursively sanitize object properties
    const sanitizeObject = (obj) => {
        if (obj === null || obj === undefined)
            return obj;
        if (typeof obj === 'string')
            return sanitizeString(obj);
        if (Array.isArray(obj))
            return obj.map(sanitizeObject);
        if (typeof obj === 'object') {
            const sanitized = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    sanitized[key] = sanitizeObject(obj[key]);
                }
            }
            return sanitized;
        }
        return obj;
    };
    // Sanitize request body, query, and params
    if (req.body)
        req.body = sanitizeObject(req.body);
    if (req.query)
        req.query = sanitizeObject(req.query);
    if (req.params)
        req.params = sanitizeObject(req.params);
    next();
};
exports.sanitizeInput = sanitizeInput;
// Rate limiting for database operations
const dbOperationTracker = new Map();
const DB_OPERATION_WINDOW_MS = 60 * 1000; // 1 minute
const DB_OPERATION_MAX_ATTEMPTS = 100; // Max 100 DB operations per minute per IP
const rateLimitDbOperations = (req, res, next) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const tracker = dbOperationTracker.get(ip);
    if (!tracker || now - tracker.firstMs > DB_OPERATION_WINDOW_MS) {
        dbOperationTracker.set(ip, { count: 1, firstMs: now });
    }
    else {
        const nextCount = tracker.count + 1;
        if (nextCount > DB_OPERATION_MAX_ATTEMPTS) {
            return res.status(429).json({
                error: "Çok fazla veritabanı işlemi. Lütfen bir dakika bekleyin."
            });
        }
        dbOperationTracker.set(ip, { count: nextCount, firstMs: tracker.firstMs });
    }
    next();
};
exports.rateLimitDbOperations = rateLimitDbOperations;
async function banGuard(req, res, next) {
    try {
        const now = new Date();
        const ip = getClientIp(req);
        const macHeader = req.headers["x-device-mac"];
        const mac = typeof macHeader === "string" ? macHeader.trim() : Array.isArray(macHeader) ? macHeader[0]?.trim() : undefined;
        const deviceIdHeader = req.headers["x-device-id"];
        const deviceId = typeof deviceIdHeader === "string" ? deviceIdHeader.trim() : Array.isArray(deviceIdHeader) ? deviceIdHeader[0]?.trim() : undefined;
        const baseExpiry = { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }] };
        const orConds = [];
        // Eski sistem banları (tek değer)
        if (ip)
            orConds.push({ ip, active: true, ...baseExpiry });
        if (mac)
            orConds.push({ mac, active: true, ...baseExpiry });
        if (deviceId)
            orConds.push({ mac: deviceId, active: true, ...baseExpiry });
        const userId = req?.user?.sub;
        if (userId)
            orConds.push({ userId, active: true, ...baseExpiry });
        // Check for email ban if user is authenticated
        if (userId) {
            try {
                const User = require('../models/User').User;
                const user = await User.findById(userId).select('email').lean();
                if (user?.email) {
                    orConds.push({ email: user.email, active: true, ...baseExpiry });
                }
            }
            catch (e) {
                // Ignore email check errors
            }
        }
        // Yeni comprehensive ban kontrolü
        const comprehensiveConds = [];
        // IP kontrolü - comprehensive ban'larda
        if (ip) {
            comprehensiveConds.push({
                ips: ip,
                active: true,
                banType: "comprehensive",
                ...baseExpiry
            });
        }
        // Device ID kontrolü - comprehensive ban'larda
        if (deviceId) {
            comprehensiveConds.push({
                deviceIds: deviceId,
                active: true,
                banType: "comprehensive",
                ...baseExpiry
            });
        }
        // Email kontrolü - comprehensive ban'larda
        if (userId) {
            try {
                const User = require('../models/User').User;
                const user = await User.findById(userId).select('email').lean();
                if (user?.email) {
                    comprehensiveConds.push({
                        emails: user.email,
                        active: true,
                        banType: "comprehensive",
                        ...baseExpiry
                    });
                }
            }
            catch (e) {
                // Ignore email check errors
            }
        }
        // Tüm koşulları birleştir
        const allConds = [...orConds, ...comprehensiveConds];
        if (allConds.length === 0)
            return next();
        const banned = await Ban_1.Ban.findOne({ $or: allConds }).lean();
        if (banned) {
            return res.status(403).json({ error: "Erişim engellendi" });
        }
        next();
    }
    catch (e) {
        return res.status(500).json({ error: "Ban kontrolü başarısız" });
    }
}
// Enhanced input validation schemas
exports.commonSchemas = {
    // ObjectId validation
    objectId: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, "Geçersiz ID formatı"),
    // Email validation with additional security
    email: zod_1.z.string()
        .email("Geçersiz email formatı")
        .max(100, "Email çok uzun")
        .refine((email) => {
        // Additional email security checks
        const suspiciousPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,
            /data:/i,
            /vbscript:/i
        ];
        return !suspiciousPatterns.some(pattern => pattern.test(email));
    }, "Email güvenlik kontrolünden geçemedi"),
    // Password validation with security requirements
    password: zod_1.z.string()
        .min(8, "Şifre en az 8 karakter olmalı")
        .max(128, "Şifre çok uzun")
        .refine((password) => {
        // Check for common weak passwords
        const weakPasswords = ['password', '123456', 'admin', 'qwerty', 'letmein'];
        return !weakPasswords.includes(password.toLowerCase());
    }, "Güvenli olmayan şifre")
        .refine((password) => {
        // Check for SQL injection patterns
        const sqlPatterns = [
            /[';]|--|\/\*|\*\/|\||&|%/i
        ];
        return !sqlPatterns.some(pattern => pattern.test(password));
    }, "Şifre güvenlik kontrolünden geçemedi"),
    // URL validation with security checks
    url: zod_1.z.string()
        .url("Geçersiz URL formatı")
        .max(2048, "URL çok uzun")
        .refine((url) => {
        // Check for suspicious URL patterns
        const suspiciousPatterns = [
            /javascript:/i,
            /data:/i,
            /vbscript:/i,
            /file:/i,
            /ftp:/i
        ];
        return !suspiciousPatterns.some(pattern => pattern.test(url));
    }, "Güvenli olmayan URL"),
    // Text input validation
    text: zod_1.z.string()
        .max(1000, "Metin çok uzun")
        .refine((text) => {
        // Check for potential injection patterns
        const injectionPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,
            /('|(\\')|(;)|(\-\-)|(\/\*)|(\*\/))/i
        ];
        return !injectionPatterns.some(pattern => pattern.test(text));
    }, "Metin güvenlik kontrolünden geçemedi")
};
// Database query logging for security monitoring
const logDbOperations = (req, res, next) => {
    const originalSend = res.send;
    const startTime = Date.now();
    res.send = function (data) {
        const duration = Date.now() - startTime;
        const ip = getClientIp(req);
        // Log suspicious database operations
        if (duration > 5000) { // Operations taking more than 5 seconds
            console.warn(`[SECURITY] Slow DB operation detected:`, {
                ip,
                method: req.method,
                url: req.url,
                duration: `${duration}ms`,
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            });
        }
        // Log high-frequency operations
        const tracker = dbOperationTracker.get(ip);
        if (tracker && tracker.count > 50) {
            console.warn(`[SECURITY] High-frequency DB operations:`, {
                ip,
                count: tracker.count,
                method: req.method,
                url: req.url,
                timestamp: new Date().toISOString()
            });
        }
        return originalSend.call(this, data);
    };
    next();
};
exports.logDbOperations = logDbOperations;
// Helper function to get client IP
function getClientIp(req) {
    const xf = req.headers["x-forwarded-for"] || "";
    const forwarded = xf.split(",")[0].trim();
    return forwarded || req.ip || req.connection?.remoteAddress || "unknown";
}
// MongoDB injection prevention helpers
exports.mongoSanitize = {
    // Sanitize MongoDB query operators
    sanitizeQuery: (query) => {
        if (!query || typeof query !== 'object')
            return query;
        const sanitized = {};
        for (const key in query) {
            if (query.hasOwnProperty(key)) {
                // Remove potentially dangerous MongoDB operators
                if (key.startsWith('$') && !['$and', '$or', '$nor', '$not', '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex', '$text', '$where'].includes(key)) {
                    continue; // Skip unknown operators
                }
                if (typeof query[key] === 'object' && query[key] !== null) {
                    sanitized[key] = exports.mongoSanitize.sanitizeQuery(query[key]);
                }
                else if (typeof query[key] === 'string') {
                    // Sanitize string values
                    sanitized[key] = query[key].replace(/[<>'";]/g, '');
                }
                else {
                    sanitized[key] = query[key];
                }
            }
        }
        return sanitized;
    },
    // Validate ObjectId format
    isValidObjectId: (id) => {
        return /^[0-9a-fA-F]{24}$/.test(id);
    }
};
// Content Security Policy headers
const securityHeaders = (req, res, next) => {
    // Prevent XSS attacks
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Content Security Policy
    res.setHeader('Content-Security-Policy', "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self' data:; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none';");
    // Prevent MIME type sniffing
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
};
exports.securityHeaders = securityHeaders;
