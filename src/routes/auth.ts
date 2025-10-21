import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "../models/User";
import { Campaign } from "../models/Campaign";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { sendMail, verifySmtp } from "../services/mailer";
import { commonSchemas, mongoSanitize } from "../middleware/security";
import { generateUniqueReferralCode, validateReferralCode } from "../utils/referralCode";
import { referralService } from "../services/referralService";

const router = Router();

// In-memory failed login tracker by IP
// Key: IP address, Value: counters and timers
const failedLoginTracker: Map<string, { count: number; firstMs: number; lockUntilMs?: number }> = new Map();
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const FAILED_LOGIN_MAX_ATTEMPTS = 5; // after 5 failed attempts -> lock for window

// In-memory registration tracker by IP
const registrationTracker: Map<string, { count: number; firstMs: number; lockUntilMs?: number }> = new Map();
const REGISTRATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const REGISTRATION_MAX_ATTEMPTS = 3; // after 3 registration attempts -> lock for window

function getClientIp(req: any): string {
  const xf = (req.headers["x-forwarded-for"] as string) || "";
  const forwarded = xf.split(",")[0].trim();
  return forwarded || req.ip || req.connection?.remoteAddress || "unknown";
}

// Simple ping + one-time SMTP verification
router.get("/ping", (_req, res) => res.json({ ok: true }));
verifySmtp().catch(() => {});

// Helpers
const getJwtSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET env");
  return s;
};
const signAccess = (payload: any) => jwt.sign(payload, getJwtSecret(), { expiresIn: "15m" });
const signRefresh = (payload: any) => jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });

// Compute display wallet values based on spend
async function walletView(userId: string) {
  // Validate ObjectId format to prevent injection
  if (!mongoSanitize.isValidObjectId(userId)) {
    throw new Error("Invalid user ID format");
  }
  
  const sanitizedUserId = mongoSanitize.sanitizeQuery({ _id: userId });
  const user = await User.findById(sanitizedUserId._id).select("email name role createdAt available_balance reserved_balance earned_balance reserved_earned_balance referral_earned reserved_referral_earned iban fullName paymentDescription referralCode referralCount referredBy").lean();
  if (!user) return null;
  
  const sanitizedOwnerQuery = mongoSanitize.sanitizeQuery({ ownerId: userId });
  const campaigns = await Campaign.find(sanitizedOwnerQuery).select("budget spent").lean();
  const totalSpent = campaigns.reduce((s, c) => s + (c.spent || 0), 0);
  const u: any = user as any;
  const display_available = Math.max(0, (u.available_balance || 0) - totalSpent);
  const display_reserved = Math.max(0, (u.reserved_balance || 0) - totalSpent);
  return { ...user, display_available, display_reserved };
}

const registerSchema = z.object({
  email: commonSchemas.email,
  password: commonSchemas.password,
  name: commonSchemas.text.min(2).max(50).optional(),
  // role: z.enum(["user", "advertiser"]).optional(), // Reklam veren rolü geçici olarak devre dışı
  referralCode: z.string().length(6).optional(), // 6 karakterli referans kodu (opsiyonel)
});

router.post("/register", async (req, res) => {
  const ip = getClientIp(req);
  const deviceIdHeader = req.headers["x-device-id"];
  const deviceId = typeof deviceIdHeader === "string" ? deviceIdHeader.trim() : Array.isArray(deviceIdHeader) ? deviceIdHeader[0]?.trim() : undefined;
  const tracker = registrationTracker.get(ip);
  const now = Date.now();
  
  // If IP is currently locked out, short-circuit
  if (tracker?.lockUntilMs && tracker.lockUntilMs > now) {
    const retryAfterSec = Math.max(1, Math.ceil((tracker.lockUntilMs - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: `Çok fazla kayıt denemesi. Lütfen ${retryAfterSec} saniye sonra tekrar deneyin.` });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  
  // Güvenlik: Request body'den role field'ını tamamen temizle
  const { email, password, name, referralCode } = parsed.data;
  
  // Ek güvenlik: Eğer request body'de role varsa reddet
  if (req.body.role) {
    return res.status(400).json({ error: "Role field is not allowed in registration" });
  }

  // Check for bans before registration
  try {
    const Ban = require('../models/Ban').Ban;
    const banNow = new Date();
    const baseExpiry = { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: banNow } }] };
    
    const banConds: any[] = [];
    if (ip) banConds.push({ ip, active: true, ...baseExpiry });
    if (deviceId) banConds.push({ mac: deviceId, active: true, ...baseExpiry });
    banConds.push({ email, active: true, ...baseExpiry });
    
    const banned = await Ban.findOne({ $or: banConds }).lean();
    if (banned) {
      return res.status(403).json({ error: "Erişim engellendi" });
    }
  } catch (e) {
    // Continue if ban check fails
  }
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: "Email already in use" });
  
  // Referans kodu kontrolü
  let referrer = null;
  if (referralCode) {
    const referralValidation = await validateReferralCode(referralCode);
    if (!referralValidation.isValid) {
      return res.status(400).json({ error: "Geçersiz referans kodu" });
    }
    referrer = referralValidation.referrer;
  }
  
  // Count registration attempt
  const prev = registrationTracker.get(ip);
  if (!prev || now - prev.firstMs > REGISTRATION_WINDOW_MS) {
    registrationTracker.set(ip, { count: 1, firstMs: now });
  } else {
    const nextCount = prev.count + 1;
    const next: any = { count: nextCount, firstMs: prev.firstMs };
    if (nextCount >= REGISTRATION_MAX_ATTEMPTS) {
      next.lockUntilMs = now + REGISTRATION_WINDOW_MS;
    }
    registrationTracker.set(ip, next);
    if (next.lockUntilMs) {
      const retryAfterSec = Math.max(1, Math.ceil((next.lockUntilMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: `Çok fazla kayıt denemesi. Lütfen ${retryAfterSec} saniye sonra tekrar deneyin.` });
    }
  }
  
  const passwordHash = await bcrypt.hash(password, 10);
  
  // Benzersiz referans kodu oluştur
  const userReferralCode = await generateUniqueReferralCode();
  
  // Kullanıcı oluştur - Reklam veren rolü geçici olarak devre dışı
  const user = await User.create({ 
    email, 
    passwordHash, 
    name, 
    role: "user", // role || "user" yerine sadece "user" - reklam veren kaldırıldı
    available_balance: 0, 
    reserved_balance: 0,
    referralCode: userReferralCode,
    referredBy: referrer ? referrer._id : undefined,
    registrationIp: ip,
    registrationDeviceId: deviceId,
  });
  
  // Referans eden kullanıcının referans sayısını artır
  if (referrer) {
    await User.findByIdAndUpdate(referrer._id, { 
      $inc: { referralCount: 1 } 
    });
    
    // Referans kazanç işlemini başlat (asenkron)
    referralService.processRegistrationReferral(user._id.toString()).catch(error => {
      console.error("Registration referral processing error:", error);
    });
  }
  
  const token = signAccess({ sub: String(user._id), role: user.role });
  const refresh = signRefresh({ sub: String(user._id) });
  return res.status(201).json({ 
    token, 
    refreshToken: refresh, 
    user: { 
      id: user._id, 
      email: user.email, 
      name: user.name, 
      role: user.role, 
      available_balance: user.available_balance, 
      reserved_balance: user.reserved_balance,
      referralCode: user.referralCode
    } 
  });
});

const loginSchema = z.object({ 
  email: commonSchemas.email, 
  password: z.string().min(1).max(128) // Basic validation for login
});

router.post("/login", async (req, res) => {
  const ip = getClientIp(req);
  const deviceIdHeader = req.headers["x-device-id"];
  const deviceId = typeof deviceIdHeader === "string" ? deviceIdHeader.trim() : Array.isArray(deviceIdHeader) ? deviceIdHeader[0]?.trim() : undefined;
  const tracker = failedLoginTracker.get(ip);
  const now = Date.now();
  // If IP is currently locked out, short-circuit
  if (tracker?.lockUntilMs && tracker.lockUntilMs > now) {
    const retryAfterSec = Math.max(1, Math.ceil((tracker.lockUntilMs - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: `Çok fazla hatalı giriş denemesi. Lütfen ${retryAfterSec} saniye sonra tekrar deneyin.` });
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  // Check for bans before login
  try {
    const Ban = require('../models/Ban').Ban;
    const banNow = new Date();
    const baseExpiry = { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: banNow } }] };
    
    const banConds: any[] = [];
    if (ip) banConds.push({ ip, active: true, ...baseExpiry });
    if (deviceId) banConds.push({ mac: deviceId, active: true, ...baseExpiry });
    banConds.push({ email, active: true, ...baseExpiry });
    
    const banned = await Ban.findOne({ $or: banConds }).lean();
    if (banned) {
      return res.status(403).json({ error: "Erişim engellendi" });
    }
  } catch (e) {
    // Continue if ban check fails
  }
  const user = await User.findOne({ email });
  if (!user) {
    // Count failed attempt
    const prev = failedLoginTracker.get(ip);
    if (!prev || now - prev.firstMs > FAILED_LOGIN_WINDOW_MS) {
      failedLoginTracker.set(ip, { count: 1, firstMs: now });
    } else {
      const nextCount = prev.count + 1;
      const next: any = { count: nextCount, firstMs: prev.firstMs };
      if (nextCount >= FAILED_LOGIN_MAX_ATTEMPTS) {
        next.lockUntilMs = now + FAILED_LOGIN_WINDOW_MS;
      }
      failedLoginTracker.set(ip, next);
      if (next.lockUntilMs) {
        const retryAfterSec = Math.max(1, Math.ceil((next.lockUntilMs - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: `Çok fazla hatalı giriş denemesi. Lütfen ${retryAfterSec} saniye sonra tekrar deneyin.` });
      }
    }
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    // Count failed attempt
    const prev = failedLoginTracker.get(ip);
    if (!prev || now - prev.firstMs > FAILED_LOGIN_WINDOW_MS) {
      failedLoginTracker.set(ip, { count: 1, firstMs: now });
    } else {
      const nextCount = prev.count + 1;
      const next: any = { count: nextCount, firstMs: prev.firstMs };
      if (nextCount >= FAILED_LOGIN_MAX_ATTEMPTS) {
        next.lockUntilMs = now + FAILED_LOGIN_WINDOW_MS;
      }
      failedLoginTracker.set(ip, next);
      if (next.lockUntilMs) {
        const retryAfterSec = Math.max(1, Math.ceil((next.lockUntilMs - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: `Çok fazla hatalı giriş denemesi. Lütfen ${retryAfterSec} saniye sonra tekrar deneyin.` });
      }
    }
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // Successful login clears counters
  if (tracker) failedLoginTracker.delete(ip);
  // Update last IP and device history (best-effort)
  try {
    const updates: any = { lastLoginIp: ip };
    if (deviceId && (!Array.isArray(user.deviceIds) || !user.deviceIds.includes(deviceId))) {
      updates.$addToSet = { deviceIds: deviceId };
    }
    await User.findByIdAndUpdate(user._id, updates, { new: false });
  } catch (e) {
    // ignore telemetry errors
  }
  const token = signAccess({ sub: String(user._id), role: user.role });
  const refresh = signRefresh({ sub: String(user._id) });
  return res.json({ token, refreshToken: refresh, user: { id: user._id, email: user.email, name: user.name, role: user.role, available_balance: user.available_balance, reserved_balance: user.reserved_balance } });
});

router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ error: "Missing refreshToken" });
    const decoded = jwt.verify(refreshToken, getJwtSecret()) as { sub: string };
    const token = signAccess({ sub: decoded.sub });
    return res.json({ token });
  } catch (e) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = (req as any).user.sub as string;
  const view = await walletView(userId);
  return res.json({ user: view });
});

// Update profile (name, email, IBAN info)
const updateProfileSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
  iban: z.string().max(26).optional(),
  fullName: z.string().max(100).optional(),
  paymentDescription: z.string().max(100).optional(),
});
router.put("/me", requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = (req as any).user.sub as string;
  const updates: any = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.email !== undefined) {
    const exists = await User.findOne({ email: parsed.data.email, _id: { $ne: userId } });
    if (exists) return res.status(409).json({ error: "Email already in use" });
    updates.email = parsed.data.email;
  }
  if (parsed.data.iban !== undefined) updates.iban = parsed.data.iban;
  if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
  if (parsed.data.paymentDescription !== undefined) updates.paymentDescription = parsed.data.paymentDescription;
  const user = await User.findByIdAndUpdate(userId, updates, { new: true }).select("email name role createdAt available_balance reserved_balance iban fullName paymentDescription");
  return res.json({ user });
});

router.get("/admin/users", requireAdmin, async (req, res) => {
  // Pagination parameters
  const page = Math.max(1, parseInt(String(req.query.page || 1)));
  const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
  const skip = (page - 1) * limit;
  const search = String(req.query.search || "").trim();
  const role = String(req.query.role || "").trim();

  // Build search query
  let searchQuery: any = {};
  
  // Role filter
  if (role && role !== "all") {
    searchQuery.role = role;
  }
  
  // Search filter
  if (search) {
    // Search by name, email, or _id (only if it's a valid ObjectId)
    const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const searchConditions: any[] = [
      { name: searchRegex },
      { email: searchRegex }
    ];
    
    // Only add _id search if it looks like a valid ObjectId (24 hex characters)
    if (/^[0-9a-fA-F]{24}$/.test(search)) {
      searchConditions.push({ _id: search });
    }
    
    // Combine role and search filters
    if (Object.keys(searchQuery).length > 0) {
      searchQuery = { $and: [searchQuery, { $or: searchConditions }] };
    } else {
      searchQuery = { $or: searchConditions };
    }
  }

  // Get banned user IDs to exclude them
  const Ban = require('../models/Ban').Ban;
  const now = new Date();
  const baseExpiry = { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }] };
  
  const bannedUsers = await Ban.find({ 
    active: true, 
    ...baseExpiry,
    $or: [
      { userId: { $exists: true } },
      { email: { $exists: true } }
    ]
  }).select('userId email').lean();
  
  const bannedUserIds = bannedUsers
    .map((b: any) => b.userId)
    .filter((id: any) => id)
    .map((id: any) => new mongoose.Types.ObjectId(id));
  
  const bannedEmails = bannedUsers
    .map((b: any) => b.email)
    .filter((email: any) => email);
  
  // Add ban exclusions to search query
  if (bannedUserIds.length > 0 || bannedEmails.length > 0) {
    const excludeConditions: any[] = [];
    if (bannedUserIds.length > 0) {
      excludeConditions.push({ _id: { $nin: bannedUserIds } });
    }
    if (bannedEmails.length > 0) {
      excludeConditions.push({ email: { $nin: bannedEmails } });
    }
    
    if (Object.keys(searchQuery).length > 0) {
      searchQuery = { $and: [searchQuery, ...excludeConditions] };
    } else {
      searchQuery = { $and: excludeConditions };
    }
  }

  const totalUsers = await User.countDocuments(searchQuery);
  const ids = await User.find(searchQuery).select("_id").sort({ createdAt: -1 }).skip(skip).limit(limit);
  const views = await Promise.all(ids.map((u:any)=>walletView(String(u._id))));
  
  return res.json({ 
    users: views,
    pagination: {
      page,
      limit,
      total: totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
      hasNext: page < Math.ceil(totalUsers / limit),
      hasPrev: page > 1,
    }
  });
});

// Admin: set user balance
const balanceSchema = z.object({ userId: z.string().min(1), amount: z.number() });
router.post("/admin/set-balance", requireAdmin, async (req, res) => {
  const parsed = balanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { userId, amount } = parsed.data;
  const user = await User.findByIdAndUpdate(userId, { available_balance: amount }, { new: true }).select("email name role createdAt available_balance reserved_balance");
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user });
});

// Admin: update user
const updateUserSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
  role: z.enum(["user", "advertiser", "admin"]).optional(),
  balance: z.number().min(0).optional(),
  available_balance: z.number().min(0).optional(),
  reserved_balance: z.number().min(0).optional(),
  earned_balance: z.number().min(0).optional(),
  reserved_earned_balance: z.number().min(0).optional(),
});
router.patch("/admin/users/:userId", requireAdmin, async (req, res) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    
    const { userId } = req.params;
    const updates: any = {};
    
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.email !== undefined) {
      const exists = await User.findOne({ email: parsed.data.email, _id: { $ne: userId } });
      if (exists) return res.status(409).json({ error: "Email already in use" });
      updates.email = parsed.data.email;
    }
    if (parsed.data.role !== undefined) updates.role = parsed.data.role;
    if (parsed.data.balance !== undefined) updates.balance = parsed.data.balance;
    if (parsed.data.available_balance !== undefined) updates.available_balance = parsed.data.available_balance;
    if (parsed.data.reserved_balance !== undefined) updates.reserved_balance = parsed.data.reserved_balance;
    if (parsed.data.earned_balance !== undefined) updates.earned_balance = parsed.data.earned_balance;
    if (parsed.data.reserved_earned_balance !== undefined) updates.reserved_earned_balance = parsed.data.reserved_earned_balance;
    
    const user = await User.findByIdAndUpdate(userId, updates, { new: true }).select("email name role createdAt balance available_balance reserved_balance earned_balance reserved_earned_balance");
    if (!user) return res.status(404).json({ error: "User not found" });
    
    return res.json({ user });
  } catch (e) {
    console.error("User update error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});
// Change password (auth required)
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) });
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const userId = (req as any).user.sub as string;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid current password" });
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await User.findByIdAndUpdate(userId, { passwordHash });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Password reset
const forgotSchema = z.object({ email: z.string().email() });
router.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email } = parsed.data;
  const user = await User.findOne({ email });
  // Avoid user enumeration: always respond success
  if (!user) return res.json({ ok: true });
  const secret = getJwtSecret();
  const token = jwt.sign({ sub: String(user._id), type: "reset" }, secret, { expiresIn: "15m" });
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const mailFromName = process.env.MAIL_FROM?.split('<')[0].trim() || "Tr.link";
  const primaryColor = process.env.EMAIL_PRIMARY_COLOR || "#4f46e5"; // Default indigo-600

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background: linear-gradient(to right, #6366f1, #a855f7); padding: 20px; text-align: center; color: #ffffff; border-bottom: 1px solid #e0e0e0;">
        <h1 style="margin: 0; font-size: 24px;">${mailFromName}</h1>
      </div>
      <div style="padding: 30px; text-align: center;">
        <h2 style="color: #333333; font-size: 22px; margin-bottom: 20px;">Şifre Sıfırlama İsteği</h2>
        <p style="color: #555555; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
          Merhaba ${user.name || ''},
          <br><br>
          Şifrenizi sıfırlamak için bir istek aldık. Aşağıdaki butona tıklayarak yeni bir şifre belirleyebilirsiniz:
        </p>
        <a href="${resetUrl}" style="background-color: ${primaryColor}; color: #ffffff; padding: 12px 25px; border-radius: 25px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);">
          Şifreyi Sıfırla
        </a>
        <p style="color: #777777; font-size: 13px; margin-top: 30px;">
          Bu bağlantı 15 dakika boyunca geçerlidir. Eğer şifre sıfırlama isteğini siz yapmadıysanız, bu e-postayı dikkate almayabilirsiniz.
        </p>
        <p style="color: #999999; font-size: 12px; margin-top: 20px;">
          Sorularınız için lütfen bizimle iletişime geçin.
        </p>
      </div>
      <div style="background-color: #f8f8f8; padding: 20px; text-align: center; color: #888888; font-size: 11px; border-top: 1px solid #e0e0e0;">
        &copy; ${new Date().getFullYear()} ${mailFromName}. Tüm hakları saklıdır.
      </div>
    </div>
  `;
  try {
    await sendMail({ to: email, subject: "Şifre Sıfırlama", html });
  } catch (e) {
    console.error("SMTP error:", e);
  }
  return res.json({ ok: true });
});

const resetSchema = z.object({ token: z.string().min(10), password: z.string().min(6) });
router.post("/reset-password", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { token, password } = parsed.data;
  try {
  const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as { sub: string; type?: string };
    if (decoded.type !== "reset") return res.status(400).json({ error: "Invalid token" });
    const passwordHash = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(decoded.sub, { passwordHash });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }
});

// Admin: Kullanıcı rolünü değiştir (sadece admin yetkisi)
const updateUserRoleSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  role: z.enum(["user", "admin", "advertiser"])
});

router.put("/admin/users/:userId/role", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const parsed = updateUserRoleSchema.safeParse({
      userId,
      ...req.body
    });
    
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    
    const { role } = parsed.data;
    
    // Güvenlik: Kendi rolünü değiştirmeyi engelle
    const currentUserId = (req as any).user.sub;
    if (userId === currentUserId) {
      return res.status(400).json({ error: "Cannot change your own role" });
    }
    
    // Kullanıcıyı bul ve güncelle
    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    ).select("email name role createdAt");
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    return res.json({ 
      message: "User role updated successfully",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error("Error updating user role:", error);
    return res.status(500).json({ error: "Failed to update user role" });
  }
});

// Switch to CommonJS export to avoid default interop issues
module.exports = router;
