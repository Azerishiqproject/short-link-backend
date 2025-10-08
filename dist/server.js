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
app.use(security_1.securityHeaders);
app.use(security_1.sanitizeInput);
app.use(security_1.rateLimitDbOperations);
app.use(security_1.logDbOperations);
app.use(express_1.default.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, morgan_1.default)("dev"));
app.use((0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, max: 200 }));
// Optional root response for uptime checks
app.get("/", (_req, res) => res.send("Backend API is running"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/links", links_1.default);
app.use("/api/campaigns", campaigns_1.default);
app.use("/api/pricing", pricing_1.default);
app.use("/api/payments", payments_1.default);
async function start() {
    const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/shortlink";
    await mongoose_1.default.connect(mongoUri);
    console.log("MongoDB connected:", mongoUri);
    const port = Number(process.env.PORT ?? 5050);
    app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}
start().catch((err) => {
    console.error("Fatal startup error", err);
    process.exit(1);
});
