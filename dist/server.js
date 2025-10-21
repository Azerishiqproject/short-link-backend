"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const mongoose_1 = __importDefault(require("mongoose"));
// import authRoutes from "./routes/auth";
const authRoutes = require("./routes/auth");
const links_1 = __importDefault(require("./routes/links"));
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const pricing_1 = __importDefault(require("./routes/pricing"));
const payments_1 = __importDefault(require("./routes/payments"));
const support_1 = __importDefault(require("./routes/support"));
const blog_1 = __importDefault(require("./routes/blog"));
const blog_2 = __importDefault(require("./routes/admin/blog"));
const pricing_2 = __importDefault(require("./routes/admin/pricing"));
const payments_2 = __importDefault(require("./routes/admin/payments"));
const campaigns_2 = __importDefault(require("./routes/admin/campaigns"));
const links_2 = __importDefault(require("./routes/admin/links"));
const referrals_1 = __importDefault(require("./routes/admin/referrals"));
const bans_1 = __importDefault(require("./routes/admin/bans"));
const security_1 = require("./middleware/security");
const app = (0, express_1.default)();
// Respect X-Forwarded-* headers (for real client IP behind proxies)
// Trust proxy settings for better IP detection (single proxy like Render)
app.set("trust proxy", 1);
// CORS configuration to allow specific origins incl. http://localhost:3001 with credentials
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001,http://localhost:3002").split(",").map(s => s.trim().replace(/\/$/, ""));
function isAllowedOrigin(origin) {
    if (!origin)
        return false;
    const o = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(o))
        return true;
    // common dev aliases
    const mapLocal = (x) => x.replace("127.0.0.1", "localhost");
    if (allowedOrigins.includes(mapLocal(o)))
        return true;
    return false;
}
// DEV: Fully open CORS
app.use((0, cors_1.default)());
app.options(/.*/, (0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use(express_1.default.json());
app.use((0, morgan_1.default)("dev"));
// Helper function to check if user is admin
function isAdminUser(req) {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer "))
            return false;
        const token = header.slice(7);
        const secret = process.env.JWT_SECRET;
        if (!secret)
            return false;
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(token, secret);
        return payload.role === "admin";
    }
    catch (err) {
        return false;
    }
}
// Ban check must be early
app.use(security_1.banGuard);
// Global rate limit, but skip admin users and support endpoints
app.use((0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    skip: (req) => {
        // Skip rate limiting for admin users
        if (isAdminUser(req))
            return true;
        // Skip rate limiting for support endpoints
        if (req.path?.startsWith("/api/support") === true)
            return true;
        return false;
    }
}));
// Optional root response for uptime checks
app.get("/", (_req, res) => res.send("Backend API is running"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/links", links_1.default);
app.use("/api/campaigns", campaigns_1.default);
app.use("/api/pricing", pricing_1.default);
app.use("/api/payments", payments_1.default);
app.use("/api/support", support_1.default);
app.use("/api/blog", blog_1.default);
app.use("/api/admin/support", support_1.default);
app.use("/api/admin/blog", blog_2.default);
app.use("/api/admin/pricing", pricing_2.default);
app.use("/api/admin/payments", payments_2.default);
app.use("/api/admin/campaigns", campaigns_2.default);
app.use("/api/admin/links", links_2.default);
app.use("/api/admin/referrals", referrals_1.default);
app.use("/api/admin/bans", bans_1.default);
async function start() {
    const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/shortlink";
    await mongoose_1.default.connect(mongoUri);
    const port = Number(process.env.PORT ?? 5050);
    app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}
start().catch((err) => {
    console.error("Fatal startup error", err);
    process.exit(1);
});
