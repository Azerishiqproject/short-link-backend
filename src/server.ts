import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
// import authRoutes from "./routes/auth";
const authRoutes = require("./routes/auth");
import linkRoutes from "./routes/links";
import campaignRoutes from "./routes/campaigns";
import pricingRoutes from "./routes/pricing";
import paymentRoutes from "./routes/payments";
import { 
  sanitizeInput, 
  rateLimitDbOperations, 
  logDbOperations, 
  securityHeaders 
} from "./middleware/security";

const app = express();
// Respect X-Forwarded-* headers (for real client IP behind proxies)
// Trust proxy settings for better IP detection (single proxy like Render)
app.set("trust proxy", 1);

// CORS configuration to allow specific origins incl. http://localhost:3001 with credentials
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001,http://localhost:3002").split(",").map(s=>s.trim().replace(/\/$/, ""));

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return false;
  const o = origin.replace(/\/$/, "");
  if (allowedOrigins.includes(o)) return true;
  // common dev aliases
  const mapLocal = (x: string) => x.replace("127.0.0.1", "localhost");
  if (allowedOrigins.includes(mapLocal(o))) return true;
  return false;
}
// DEV: Fully open CORS
app.use(cors());
app.options(/.*/, cors());
app.use(helmet());
app.use(securityHeaders);
app.use(sanitizeInput);
app.use(rateLimitDbOperations);
app.use(logDbOperations);
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
// Optional root response for uptime checks
app.get("/", (_req, res) => res.send("Backend API is running"));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/links", linkRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/payments", paymentRoutes);

async function start() {
  const mongoUri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/shortlink";
  await mongoose.connect(mongoUri);
  console.log("MongoDB connected:", mongoUri);
  const port = Number(process.env.PORT ?? 5050);
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}

start().catch((err) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});


