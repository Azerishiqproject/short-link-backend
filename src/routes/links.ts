import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
import { Link, Click } from "../models/Link";
import { Pricing } from "../models/Pricing";
import { User } from "../models/User";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getCountryFromIP, getClientIP } from "../services/geoService";
import { encodeToken, decodeToken, getSecretOrThrow, rememberNonce, isNonceUsed, getOrCreateAdSession, clearAdSession } from "../utils/linkToken";
import { commonSchemas, mongoSanitize } from "../middleware/security";
import { referralService } from "../services/referralService";

const router = Router();
// =============================
// Pricing helpers (country-based per click)
// =============================
type CountryRateCache = { updatedAt: number; countryToRate: Record<string, number> };
let pricingCache: CountryRateCache | null = null;

// IP earnings cache - IP -> { lastEarningTime, earnings }
const ipEarningsCache = new Map<string, { lastEarningTime: number; earnings: number }>();
const IP_CACHE_TTL = 60 * 60 * 1000; // 1 saat

async function loadPricingCache(): Promise<CountryRateCache> {
  // Cache for 60 seconds to limit DB reads under traffic
  const needsRefresh = !pricingCache || (Date.now() - pricingCache.updatedAt) > 60_000;
  if (!needsRefresh) return pricingCache as CountryRateCache;
  const doc = await Pricing.findOne().lean();
  const map: Record<string, number> = {};
  if (doc?.entries?.length) {
    for (const e of doc.entries as any[]) {
      // Use audience 'user' and website_traffic as the default basis; unit is per_1000
      if (e && (e.audience === 'user') && e.country && e.rates && typeof e.rates.website_traffic === 'number') {
        const perClick = Number(e.rates.website_traffic) / 1000; // convert per_1000 to per click
        map[e.country.toUpperCase()] = perClick;
      }
    }
  }
  pricingCache = { updatedAt: Date.now(), countryToRate: map };
  return pricingCache;
}

async function getPerClickRate(countryCode: string | undefined): Promise<number> {
  const fallback = Number(process.env.EARNING_PER_CLICK ?? 0.02);
  if (!countryCode) return fallback;
  const cache = await loadPricingCache();
  
  // Önce belirli ülke kodunu ara
  let rate = cache.countryToRate[countryCode.toUpperCase()];
  
    // Eğer bulunamazsa DF (default) ülke kodunu ara
    if (rate === undefined) {
      rate = cache.countryToRate['DF'];
    }
  
  // Eğer DF de yoksa environment variable'ı kullan
  return rate ?? fallback;
}

// Duplicate click kontrolü - aynı IP'den 1 saat içinde aynı linke tıklama var mı?
async function isDuplicateClick(linkId: string, ip: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const existingClick = await Click.findOne({
    linkId: linkId,
    ip: ip,
    clickedAt: { $gte: oneHourAgo }
  });
  
  return !!existingClick;
}

// IP bazlı global kazanç kontrolü - cache'li versiyon
async function hasIPEarnedRecently(ip: string): Promise<boolean> {
  const now = Date.now();
  
  // Cache'den kontrol et
  const cached = ipEarningsCache.get(ip);
  if (cached) {
    const timeDiff = now - cached.lastEarningTime;
    if (timeDiff < IP_CACHE_TTL) {
      return true; // 1 saat içinde para kazanmış
    } else {
      // Cache expired, temizle
      ipEarningsCache.delete(ip);
    }
  }
  
  // Cache'de yoksa database'den kontrol et
  const oneHourAgo = new Date(now - IP_CACHE_TTL);
  
  const recentEarning = await Click.findOne({
    ip: ip,
    clickedAt: { $gte: oneHourAgo },
    earnings: { $gt: 0 }
  });
  
  if (recentEarning) {
    // Cache'e ekle
    ipEarningsCache.set(ip, {
      lastEarningTime: recentEarning.clickedAt.getTime(),
      earnings: recentEarning.earnings
    });
    return true;
  }
  
  return false;
}

// IP'ye para kazandırıldığında cache'i güncelle
function updateIPEarningsCache(ip: string, earnings: number): void {
  ipEarningsCache.set(ip, {
    lastEarningTime: Date.now(),
    earnings: earnings
  });
}

// Cache temizleme - expired entry'leri temizle
function cleanupIPEarningsCache(): void {
  const now = Date.now();
  for (const [ip, data] of ipEarningsCache.entries()) {
    if (now - data.lastEarningTime > IP_CACHE_TTL) {
      ipEarningsCache.delete(ip);
    }
  }
}

// Her 5 dakikada bir cache temizleme
setInterval(cleanupIPEarningsCache, 5 * 60 * 1000);

// Per-user rate limiter: max 10 requests per minute
const perUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => (req?.user?.sub ? String(req.user.sub) : ipKeyGenerator(req)),
});

const urlRegex = /^https?:\/\//i;
const createSchema = z.object({
  targetUrl: z.string().url().refine((u) => urlRegex.test(u), "Must be http/https"),
  customSlug: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  expiresAt: z.string().datetime().optional(),
});

// Bulk create schema
const bulkCreateSchema = z.object({
  urls: z.array(z.string().url().refine((u) => urlRegex.test(u), "Must be http/https")).min(1).max(100)
});

function generateSlug(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

router.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { targetUrl, customSlug, expiresAt } = parsed.data as any;
  let slug = customSlug?.toString();
  if (slug) {
    const exists = await Link.findOne({ slug });
    if (exists) return res.status(409).json({ error: "Slug already in use" });
  } else {
    for (let i = 0; i < 5; i++) {
      const candidate = generateSlug();
      const exists = await Link.findOne({ slug: candidate });
      if (!exists) { slug = candidate; break; }
    }
    if (!slug) return res.status(500).json({ error: "Failed to allocate slug" });
  }
  const ownerId = (req as any).user.sub;
  const link = await Link.create({ slug, targetUrl, ownerId, expiresAt });
  return res.status(201).json({ id: link._id, slug: link.slug, shortUrl: `/r/${link.slug}`, targetUrl: link.targetUrl });
});

// Bulk create links
router.post("/bulk", requireAuth, perUserLimiter, async (req, res) => {
  try {
    // Allow both { urls: string[] } and { text: string }
    let payload: any = req.body || {};
    if (!payload.urls && typeof payload.text === 'string') {
      const parts = String(payload.text)
        .split(/[\n,]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);
      payload = { urls: parts };
    }
    const parsed = bulkCreateSchema.safeParse(payload);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { urls } = parsed.data;
    const ownerId = (req as any).user.sub;

    async function allocateUniqueSlug(): Promise<string> {
      for (let i = 0; i < 8; i++) {
        const candidate = generateSlug();
        const exists = await Link.findOne({ slug: candidate }).select('_id');
        if (!exists) return candidate;
      }
      throw new Error('Failed to allocate slug');
    }

    const creations = urls.map(async (targetUrl) => {
      const slug = await allocateUniqueSlug();
      const link = await Link.create({ slug, targetUrl, ownerId });
      return { id: link._id, slug: link.slug, shortUrl: `/r/${link.slug}`, targetUrl: link.targetUrl };
    });

    const links = await Promise.all(creations);
    return res.status(201).json({ links });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'bulk-failed' });
  }
});

router.get("/", requireAuth, async (req, res) => {
  const ownerId = (req as any).user.sub;
  const page = Math.max(1, parseInt(String(req.query.page || 1)));
  const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 10))));
  const skip = (page - 1) * limit;

  const total = await Link.countDocuments({ ownerId });
  const links = await Link.find({ ownerId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  return res.json({
    links,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
});

// Get all links (admin)
router.get("/admin/all", requireAdmin, async (req, res) => {
  try {
    const links = await Link.find().populate('ownerId', 'email name').sort({ createdAt: -1 });
    return res.json({ links });
  } catch (e) { 
    console.error("Admin links fetch error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get user's links by user ID (admin)
router.get("/admin/user/:userId", requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    
    const links = await Link.find({ ownerId: userId })
      .select("_id slug targetUrl clicks earnings disabled createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));
    
    const total = await Link.countDocuments({ ownerId: userId });
    
    return res.json({ 
      links,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
        hasNext: skip + Number(limit) < total,
        hasPrev: Number(page) > 1
      }
    });
  } catch (e) { 
    console.error("Admin user links fetch error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get link clicks by link ID (admin)
router.get("/:linkId/clicks", requireAdmin, async (req, res) => {
  try {
    const { linkId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    
    const link = await Link.findById(linkId);
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }
    
    // Link'in click detaylarını al
    const clicks = link.clicks || [];
    const totalClicks = clicks.length;
    const paginatedClicks = clicks.slice(skip, skip + Number(limit));
    
    return res.json({
      clicks: paginatedClicks,
      total: totalClicks,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalClicks,
        totalPages: Math.ceil(totalClicks / Number(limit)),
        hasNext: skip + Number(limit) < totalClicks,
        hasPrev: Number(page) > 1
      }
    });
  } catch (e) {
    console.error("Link clicks fetch error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/stats", requireAuth, perUserLimiter, async (req, res) => {
  const ownerId = (req as any).user.sub;
  const links = await Link.find({ ownerId }).select("_id clicks earnings disabled createdAt slug targetUrl");
  const totalClicks = links.reduce((sum, l) => sum + (l.clicks || 0), 0);
  // Use link earnings directly (already calculated per country)
  const totalEarnings = links.reduce((sum, l) => sum + (l.earnings || 0), 0);
  return res.json({
    totalClicks,
    totalEarnings: Number(totalEarnings.toFixed(4)),
    earningPerClick: Number(process.env.EARNING_PER_CLICK ?? 0.02),
    links: links.map((l) => ({
      id: l._id,
      slug: l.slug,
      clicks: l.clicks,
      disabled: l.disabled,
      createdAt: l.createdAt,
      targetUrl: l.targetUrl,
      earnings: Number((l.earnings || 0).toFixed(4)),
    })),
  });
});

// Simple in-memory cache
const cache = new Map();
// Use shorter TTL in development to reflect updates faster
const CACHE_TTL = process.env.NODE_ENV === 'production' ? (5 * 60 * 1000) : (30 * 1000);

function invalidateTrendCacheForOwner(ownerId: string) {
  // Delete all trend cache entries for this owner
  for (const key of Array.from(cache.keys())) {
    if (typeof key === 'string' && key.startsWith(`trend_${ownerId}_`)) {
      cache.delete(key);
    }
  }
}

function invalidateAnalyticsCacheForLink(linkId: string, ownerId?: string) {
  const keys = Array.from(cache.keys());
  for (const key of keys) {
    // analytics cache key pattern: analytics_${id}_${ownerId}
    if (typeof key === 'string' && key.startsWith('analytics_')) {
      const parts = key.split('_');
      // ['analytics', '<linkId>', '<ownerId>']
      if (parts.length >= 3) {
        const cachedLinkId = parts[1];
        if (cachedLinkId === String(linkId)) {
          cache.delete(key);
        }
      }
    }
  }
  if (ownerId) invalidateTrendCacheForOwner(ownerId);
}

// Daily click trend for current user across all links (placed BEFORE /:id routes)
router.get("/trend", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const ownerId = (req as any).user.sub;
    const days = Math.min(Math.max(parseInt(String(req.query.days || 30)), 1), 365);
    
    // Check cache first
    const cacheKey = `trend_${ownerId}_${days}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }
    
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const ids = await Link.find({ ownerId }).select("_id").lean();
    const linkIds = ids.map((d:any)=>d._id);
    if (!linkIds.length) return res.json({ days, trend: [] });
    // If requesting last 24 hours, group by hour; otherwise group by day
    let trend: Array<{ date: string; clicks: number }> = [];
    if (days === 1) {
      const pipeline: any[] = [
        { $match: { linkId: { $in: linkIds }, clickedAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
        { $project: { _id: 0, date: "$_id", clicks: 1 } },
        { $sort: { date: 1 } },
      ];
      const results = await Click.aggregate(pipeline);
      // Fill missing hours (last 24 hours) using UTC-safe ISO format like YYYY-MM-DDTHH:00:00Z
      for (let i = 23; i >= 0; i--) {
        const dt = new Date(Date.now() - i * 60 * 60 * 1000);
        dt.setUTCMinutes(0, 0, 0); // zero minutes/seconds/millis in UTC to avoid TZ shifts
        const isoHour = dt.toISOString().slice(0, 13) + ":00:00Z"; // match group format (no milliseconds)
        const existing = results.find((r: any) => r.date === isoHour);
        trend.push({ date: isoHour, clicks: existing ? existing.clicks : 0 });
      }
    } else {
      const pipeline: any[] = [
        { $match: { linkId: { $in: linkIds }, clickedAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
        { $project: { _id: 0, date: "$_id", clicks: 1 } },
        { $sort: { date: 1 } },
      ];
      const results = await Click.aggregate(pipeline);
      // Fill in missing days with 0 clicks
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const existingData = results.find((r: any) => r.date === dateStr);
        trend.push({
          date: dateStr,
          clicks: existingData ? existingData.clicks : 0,
        });
      }
    }
    
    const data = { days, trend };
    
    // Cache the result
    cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    return res.json(data);
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || 'trend-failed' });
  }
});

// Overview: geographic distribution across all user's links
router.get("/geo", requireAuth, perUserLimiter, async (req, res) => {
  try {
    const ownerId = (req as any).user.sub;
    const days = req.query.days ? Math.min(Math.max(parseInt(String(req.query.days)), 1), 365) : null;
    const ids = await Link.find({ ownerId }).select("_id").lean();
    const linkIds = ids.map((d:any)=>d._id);
    if (!linkIds.length) return res.json({ countryBreakdown: [] });
    const match: any = { linkId: { $in: linkIds } };
    if (days) {
      match.clickedAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }
    const grouped = await Click.aggregate([
      { $match: match },
      { $group: { _id: "$country", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const total = grouped.reduce((s, g)=> s + (g.count || 0), 0) || 1;
    const countryBreakdown = grouped.map((g:any)=>({
      country: g._id || 'Unknown',
      count: g.count || 0,
      percentage: ((100 * (g.count || 0) / total).toFixed(1)),
    }));
    return res.json({ countryBreakdown });
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || 'geo-failed' });
  }
});

router.get("/slug/:slug", async (req, res) => {
  const slug = req.params.slug;
  const link = await Link.findOne({ slug });
  if (!link || link.disabled || (link.expiresAt && link.expiresAt < new Date())) return res.status(404).json({ error: "Not found" });
  return res.json({ id: link._id, slug: link.slug, targetUrl: link.targetUrl });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  
  // Validate ObjectId format to prevent injection
  if (!mongoSanitize.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid link ID format" });
  }
  
  const ownerId = (req as any).user.sub;
  const sanitizedQuery = mongoSanitize.sanitizeQuery({ _id: id, ownerId });
  const link = await Link.findOne(sanitizedQuery);
  if (!link) return res.status(404).json({ error: "Not found" });
  return res.json({ link });
});

router.get("/:id/stats", requireAuth, async (req, res) => {
  const { id } = req.params;
  
  // Validate ObjectId format to prevent injection
  if (!mongoSanitize.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid link ID format" });
  }
  
  const ownerId = (req as any).user.sub;
  const sanitizedQuery = mongoSanitize.sanitizeQuery({ _id: id, ownerId });
  const link = await Link.findOne(sanitizedQuery).select("clicks lastClickedAt createdAt slug targetUrl disabled");
  if (!link) return res.status(404).json({ error: "Not found" });
  const rate = Number(process.env.EARNING_PER_CLICK ?? 0.02);
  const earnings = Number(((link.clicks || 0) * rate).toFixed(4));
  return res.json({
    id: link._id,
    slug: link.slug,
    targetUrl: link.targetUrl,
    clicks: link.clicks,
    lastClickedAt: link.lastClickedAt,
    createdAt: link.createdAt,
    disabled: link.disabled,
    earningPerClick: rate,
    earnings,
  });
});

router.get("/:id/analytics", requireAuth, async (req, res) => {
  const { id } = req.params;
  const requester: any = (req as any).user;
  const ownerId = requester.sub;
  const isAdmin = requester.role === "admin";
  
  // Pagination parameters
  const page = Math.max(1, parseInt(String(req.query.page || 1)));
  const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 10))));
  const skip = (page - 1) * limit;
  // Optional range filter (days)
  const daysParam = req.query.days ? Math.min(Math.max(parseInt(String(req.query.days)), 1), 365) : null;
  
  // Check cache first (include pagination and days in cache key)
  const cacheKey = `analytics_${id}_${ownerId}_${page}_${limit}_${daysParam ?? 'all'}_${isAdmin ? 'admin' : 'user'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }
  
  const link = isAdmin ? await Link.findById(id) : await Link.findOne({ _id: id, ownerId });
  if (!link) return res.status(404).json({ error: "Not found" });
  
  console.log("Analytics request for link:", id, "ownerId:", ownerId, "isAdmin:", isAdmin);
  console.log("Link found:", !!link);
  
  // Build time filter if provided
  const sinceFilter: any = daysParam ? { clickedAt: { $gte: new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000) } } : {};
  // Get total click count for pagination
  const totalClicks = await Click.countDocuments({ linkId: id, ...sinceFilter });
  
  console.log("Total clicks found:", totalClicks);
  console.log("Since filter:", sinceFilter);
  
  // Get click analytics grouped by country (filtered by days if provided)
  const allClicks = await Click.find({ linkId: id, ...sinceFilter }).sort({ clickedAt: -1 });
  
  // Get paginated recent clicks
  const recentClicks = await Click.find({ linkId: id, ...sinceFilter })
    .sort({ clickedAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Group by country (using all clicks for country breakdown)
  const countryStats = allClicks.reduce((acc: any, click) => {
    const country = click.country;
    if (!acc[country]) {
      acc[country] = { count: 0, clicks: [] };
    }
    acc[country].count += 1;
    acc[country].clicks.push({
      ip: click.ip,
      userAgent: click.userAgent,
      referer: click.referer,
      clickedAt: click.clickedAt,
      earnings: click.earnings || 0,
    });
    return acc;
  }, {});
  
  // Convert to array and sort by count
  const countryBreakdown = Object.entries(countryStats)
    .map(([country, data]: [string, any]) => ({
      country,
      count: data.count,
      percentage: ((data.count / allClicks.length) * 100).toFixed(1),
      clicks: data.clicks,
    }))
    .sort((a, b) => b.count - a.count);
  
  // Get trend for this specific link (range)
  const days = daysParam ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const mongoose = await import('mongoose');
  const linkObjectId = new mongoose.Types.ObjectId(id);

  let trend: Array<{ date: string; clicks: number }> = [];
  if (days === 1) {
    // Hourly grouping for last 24 hours
    const pipeline: any[] = [
      { $match: { linkId: linkObjectId, clickedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
      { $project: { _id: 0, date: "$_id", clicks: 1 } },
      { $sort: { date: 1 } },
    ];
    const results = await Click.aggregate(pipeline);
    for (let i = 23; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 60 * 60 * 1000);
      dt.setUTCMinutes(0, 0, 0);
      const isoHour = dt.toISOString().slice(0, 13) + ":00:00Z";
      const existing = results.find((r: any) => r.date === isoHour);
      trend.push({ date: isoHour, clicks: existing ? existing.clicks : 0 });
    }
  } else {
    // Daily grouping for last N days
    const pipeline: any[] = [
      { $match: { linkId: linkObjectId, clickedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
      { $project: { _id: 0, date: "$_id", clicks: 1 } },
      { $sort: { date: 1 } },
    ];
    const results = await Click.aggregate(pipeline);
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const existingData = results.find((r: any) => r.date === dateStr);
      trend.push({
        date: dateStr,
        clicks: existingData ? existingData.clicks : 0
      });
    }
  }
  
  const data = {
    linkId: id,
    totalClicks,
    countryBreakdown,
    recentClicks: recentClicks.map(click => ({
      ip: click.ip,
      country: click.country,
      userAgent: click.userAgent,
      referer: click.referer,
      clickedAt: click.clickedAt,
      earnings: click.earnings || 0,
    })),
    trend, // Daily trend data
    pagination: {
      page,
      limit,
      total: totalClicks,
      totalPages: Math.ceil(totalClicks / limit),
      hasNext: page < Math.ceil(totalClicks / limit),
      hasPrev: page > 1,
    },
  };
  
  // Cache the result
  cache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
  
  return res.json(data);
});

// Daily click trend for current user across all links
// moved above

router.patch("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const ownerId = (req as any).user.sub;
  const link = await Link.findOne({ _id: id, ownerId });
  if (!link) return res.status(404).json({ error: "Not found" });
  
  const { targetUrl, disabled } = req.body;
  if (targetUrl) {
    if (!urlRegex.test(targetUrl)) return res.status(400).json({ error: "Invalid URL" });
    link.targetUrl = targetUrl;
  }
  if (typeof disabled === "boolean") link.disabled = disabled;
  
  await link.save();
  return res.json({ link });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const ownerId = (req as any).user.sub;
  const link = await Link.findOneAndDelete({ _id: id, ownerId });
  if (!link) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

router.post('/:id/click', async (req, res) => {
  const { id } = req.params;
  const link = await Link.findById(id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  
  // Get client IP and country
  const clientIP = getClientIP(req);
  const country = getCountryFromIP(clientIP);
  
  // Duplicate click kontrolü - aynı IP'den 1 saat içinde aynı linke tıklama var mı?
  const isDuplicate = await isDuplicateClick(id, clientIP);
  
  // IP bazlı global kazanç kontrolü - aynı IP'den 1 saat içinde herhangi bir linke para gitmiş mi?
  const hasEarnedRecently = await hasIPEarnedRecently(clientIP);
  
  // Kullanıcıya kazanç ekle (sadece ilk tıklama ve IP kısıtlaması yoksa)
  const earningRate = (isDuplicate || hasEarnedRecently) ? 0 : await getPerClickRate(country);
  
  // Log detailed click data with earnings (her zaman logla)
  await Click.create({
    linkId: id,
    ip: clientIP,
    country,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer,
    earnings: earningRate,
  });
  
  // Update link click count (her zaman artır) ve earnings (sadece ilk tıklama için)
  link.clicks += 1;
  if (!isDuplicate) {
    link.earnings = (link.earnings || 0) + earningRate;
  }
  link.lastClickedAt = new Date();
  await link.save();
  
  // Kullanıcı bakiyesini güncelle (sadece ilk tıklama için)
  if (!isDuplicate && !hasEarnedRecently) {
    await User.findByIdAndUpdate(link.ownerId, { 
      $inc: { earned_balance: earningRate, available_balance: earningRate } 
    });
    
    // Referans kazanç işlemini başlat (sadece ilk tıklama için)
    referralService.processClickReferral(link.ownerId, String(link._id), earningRate).catch(error => {
      console.error("Click referral processing error:", error);
    });
    
    // IP earnings cache'ini güncelle
    if (earningRate > 0) {
      updateIPEarningsCache(clientIP, earningRate);
    }
  }
  
  // Invalidate caches so stats/trend update immediately
  invalidateAnalyticsCacheForLink(String(link._id), String(link.ownerId));

  return res.json({ 
    ok: true, 
    duplicate: isDuplicate,
    ipEarnedRecently: hasEarnedRecently,
    earnings: earningRate 
  });
});

// =============================
// Signed Token APIs
// =============================

// Issue token for a slug
router.post('/issue-token', async (req, res) => {
  try {
    const { slug, userId } = req.body || {};
    if (!slug) return res.status(400).json({ error: 'missing-slug' });
    const link = await Link.findOne({ slug }).select('_id slug targetUrl');
    if (!link) return res.status(404).json({ error: 'not-found' });
    const nonce = crypto.randomBytes(16).toString('hex');
    const exp = Math.floor(Date.now() / 1000) + 10 * 60; // 10 minutes
    // Bind to requester IP via hash (soft check)
    const ip = getClientIP(req);
    const ipHash = crypto.createHash('sha256').update(`${getSecretOrThrow()}|${ip || 'unknown'}`).digest('hex');
    const token = encodeToken({ shortLinkId: String(link._id), slug: link.slug, userId: userId || null, nonce, exp, ipHash });
    rememberNonce(nonce, 10 * 60 * 1000);
    // initialize multi-ad session window
    getOrCreateAdSession(nonce, String(link._id), 10 * 60 * 1000);
    const adBase = process.env.AD_SITE_BASE_URL;
    return res.json({ token, exp, targetUrl: adBase });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'issue-failed' });
  }
});

// Receive impression with token and metrics
router.post('/impression', async (req, res) => {
  try {
    const { token, metrics, stage } = req.body || {};
    if (!token) return res.status(400).json({ error: 'missing-token' });
    const decoded = decodeToken(token);
    if (!decoded.valid || !decoded.payload) {
      return res.status(400).json({ error: 'invalid-token', reason: decoded.reason });
    }
    const payload = decoded.payload;
    if (payload.exp * 1000 < Date.now()) return res.status(400).json({ error: 'expired' });
    // For multi-stage: do not block by used nonce; we guard with session stages.

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'] || '';
    const computedIpHash = crypto.createHash('sha256').update(`${getSecretOrThrow()}|${ip || 'unknown'}`).digest('hex');

    // TODO: add anti-fraud checks (webdriver, ASN etc.)
    let suspicious = false;
    if (payload.ipHash && payload.ipHash !== computedIpHash) {
      suspicious = true; // IP değişmiş: şüphe puanı ver
    }

    // session progress update (require stage 1 or 2)
    const stageNum = Number(stage) || 1;
    if (![1,2].includes(stageNum)) return res.status(400).json({ error: 'invalid-stage' });
    const session = getOrCreateAdSession(payload.nonce, payload.shortLinkId, 10 * 60 * 1000);
    const already = session.stagesDone.has(stageNum);
    session.stagesDone.add(stageNum);

    // TODO: persist impression record if desired

    // If both stages completed, respond with redirect target
    if (session.stagesDone.size >= 2) {
      // Optional: expire session immediately to prevent further reuse
      clearAdSession(payload.nonce);
      const link = await Link.findById(session.linkId);
      
      // Log click with real client IP (from impression request)
      if (link) {
        const country = getCountryFromIP(ip);
        
        // Duplicate click kontrolü - aynı IP'den 1 saat içinde aynı linke tıklama var mı?
        const isDuplicate = await isDuplicateClick(session.linkId, ip);
        
        // IP bazlı global kazanç kontrolü - aynı IP'den 1 saat içinde herhangi bir linke para gitmiş mi?
        const hasEarnedRecently = await hasIPEarnedRecently(ip);
        
        // Kullanıcıya kazanç ekle (sadece ilk tıklama ve IP kısıtlaması yoksa)
        const earningRate = (isDuplicate || hasEarnedRecently) ? 0 : await getPerClickRate(country);
        
        await Click.create({
          linkId: session.linkId,
          ip: ip,
          country,
          userAgent: ua,
          referer: req.headers.referer,
          earnings: earningRate,
        });
        
        // Update link click count (her zaman artır) ve earnings (sadece ilk tıklama için)
        link.clicks = (link.clicks || 0) + 1;
        if (!isDuplicate) {
          link.earnings = (link.earnings || 0) + earningRate;
        }
        link.lastClickedAt = new Date();
        await link.save();
        
        // Kullanıcı bakiyesini güncelle (sadece ilk tıklama için)
        if (!isDuplicate && !hasEarnedRecently) {
          await User.findByIdAndUpdate(link.ownerId, { 
            $inc: { earned_balance: earningRate, available_balance: earningRate } 
          });
          
          // Referans kazanç işlemini başlat (sadece ilk tıklama için)
          referralService.processClickReferral(link.ownerId, String(link._id), earningRate).catch(error => {
            console.error("Click referral processing error:", error);
          });
          
          // IP earnings cache'ini güncelle
          if (earningRate > 0) {
            updateIPEarningsCache(ip, earningRate);
          }
        }
        
        // Invalidate caches so stats/trend update immediately
        invalidateAnalyticsCacheForLink(String(link._id), String(link.ownerId));
      }
      
      return res.json({ 
        ok: true, 
        done: true, 
        redirect: link?.targetUrl || null, 
        linkId: session.linkId, 
        suspicious, 
        ip, 
        ua, 
        metrics,
        duplicate: link ? await isDuplicateClick(session.linkId, ip) : false,
        ipEarnedRecently: link ? await hasIPEarnedRecently(ip) : false
      });
    }

    return res.json({ ok: true, done: false, suspicious, ip, ua, metrics, already });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'impression-failed' });
  }
});

export default router;



