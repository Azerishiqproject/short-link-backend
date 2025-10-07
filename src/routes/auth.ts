import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { Campaign } from "../models/Campaign";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { sendMail, verifySmtp } from "../services/mailer";

const router = Router();

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
  const user = await User.findById(userId).select("email name role createdAt available_balance reserved_balance earned_balance reserved_earned_balance iban fullName paymentDescription").lean();
  if (!user) return null;
  const campaigns = await Campaign.find({ ownerId: userId }).select("budget spent").lean();
  const totalSpent = campaigns.reduce((s, c) => s + (c.spent || 0), 0);
  const u: any = user as any;
  const display_available = Math.max(0, (u.available_balance || 0) - totalSpent);
  const display_reserved = Math.max(0, (u.reserved_balance || 0) - totalSpent);
  return { ...user, display_available, display_reserved };
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2).max(50).optional(),
  role: z.enum(["user", "advertiser"]).optional(),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, name, role } = parsed.data;
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: "Email already in use" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash, name, role: role || "user", available_balance: 0, reserved_balance: 0 });
  const token = signAccess({ sub: String(user._id), role: user.role });
  const refresh = signRefresh({ sub: String(user._id) });
  return res.status(201).json({ token, refreshToken: refresh, user: { id: user._id, email: user.email, name: user.name, role: user.role, available_balance: user.available_balance, reserved_balance: user.reserved_balance } });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
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

router.get("/admin/users", requireAdmin, async (_req, res) => {
  const ids = await User.find().select("_id").sort({ createdAt: -1 }).limit(200);
  const views = await Promise.all(ids.map((u:any)=>walletView(String(u._id))));
  return res.json({ users: views });
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

// Switch to CommonJS export to avoid default interop issues
module.exports = router;
