import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
import { Link, Click } from "../models/Link";
import { Pricing } from "../models/Pricing";
import { User } from "../models/User";
import { requireAuth } from "../middleware/auth";
import { getCountryFromIP, getClientIP } from "../services/geoService";
import { encodeToken, decodeToken, getSecretOrThrow, rememberNonce, isNonceUsed, getOrCreateAdSession, clearAdSession } from "../utils/linkToken";

const router = Router();
// =============================
// Pricing helpers (country-based per click)
// =============================
type CountryRateCache = { updatedAt: number; countryToRate: Record<string, number> };
let pricingCache: CountryRateCache | null = null;

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
  return cache.countryToRate[countryCode.toUpperCase()] ?? fallback;
}
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

router.get("/", requireAuth, async (req, res) => {
  const ownerId = (req as any).user.sub;
  const links = await Link.find({ ownerId }).sort({ createdAt: -1 }).limit(200);
  return res.json({ links });
});

router.get("/stats", requireAuth, perUserLimiter, async (req, res) => {
  const ownerId = (req as any).user.sub;
  const links = await Link.find({ ownerId }).select("_id clicks disabled createdAt slug targetUrl");
  const totalClicks = links.reduce((sum, l) => sum + (l.clicks || 0), 0);
  // Compute earnings by country using Clicks aggregation and pricing table
  let totalEarnings = 0;
  if (links.length > 0) {
    const linkIds = links.map((l:any)=>l._id);
    const grouped = await Click.aggregate([
      { $match: { linkId: { $in: linkIds } } },
      { $group: { _id: "$country", clicks: { $sum: 1 } } },
    ]);
    const cache = await loadPricingCache();
    for (const row of grouped) {
      const cc = String(row._id || '').toUpperCase();
      const count = Number(row.clicks || 0);
      const rate = cache.countryToRate[cc] ?? Number(process.env.EARNING_PER_CLICK ?? 0.02);
      totalEarnings += count * rate;
    }
    totalEarnings = Number(totalEarnings.toFixed(4));
  }
  return res.json({
    totalClicks,
    totalEarnings,
    earningPerClick: Number(process.env.EARNING_PER_CLICK ?? 0.02),
    links: links.map((l) => ({
      id: l._id,
      slug: l.slug,
      clicks: l.clicks,
      disabled: l.disabled,
      createdAt: l.createdAt,
      targetUrl: l.targetUrl,
      // Note: per-link earnings require per-country breakdown; keep simple estimate here
      earnings: Number(((l.clicks || 0) * Number(process.env.EARNING_PER_CLICK ?? 0.02)).toFixed(4)),
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
    const days = Math.min(Math.max(parseInt(String(req.query.days || 30)), 1), 180);
    
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
    const pipeline: any[] = [
      { $match: { linkId: { $in: linkIds }, clickedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
      { $project: { _id: 0, date: "$_id", clicks: 1 } },
      { $sort: { date: 1 } },
    ];
    const results = await Click.aggregate(pipeline);
    
    // Fill in missing days with 0 clicks
    const trend = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const existingData = results.find(r => r.date === dateStr);
      trend.push({
        date: dateStr,
        clicks: existingData ? existingData.clicks : 0
      });
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

router.get("/slug/:slug", async (req, res) => {
  const slug = req.params.slug;
  const link = await Link.findOne({ slug });
  if (!link || link.disabled || (link.expiresAt && link.expiresAt < new Date())) return res.status(404).json({ error: "Not found" });
  return res.json({ id: link._id, slug: link.slug, targetUrl: link.targetUrl });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const ownerId = (req as any).user.sub;
  const link = await Link.findOne({ _id: id, ownerId });
  if (!link) return res.status(404).json({ error: "Not found" });
  return res.json({ link });
});

router.get("/:id/stats", requireAuth, async (req, res) => {
  const { id } = req.params;
  const ownerId = (req as any).user.sub;
  const link = await Link.findOne({ _id: id, ownerId }).select("clicks lastClickedAt createdAt slug targetUrl disabled");
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
  const ownerId = (req as any).user.sub;
  
  // Check cache first
  const cacheKey = `analytics_${id}_${ownerId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }
  
  const link = await Link.findOne({ _id: id, ownerId });
  if (!link) return res.status(404).json({ error: "Not found" });
  
  // Get click analytics grouped by country
  const clicks = await Click.find({ linkId: id }).sort({ clickedAt: -1 });
  
  // Group by country
  const countryStats = clicks.reduce((acc: any, click) => {
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
    });
    return acc;
  }, {});
  
  // Convert to array and sort by count
  const countryBreakdown = Object.entries(countryStats)
    .map(([country, data]: [string, any]) => ({
      country,
      count: data.count,
      percentage: ((data.count / clicks.length) * 100).toFixed(1),
      clicks: data.clicks,
    }))
    .sort((a, b) => b.count - a.count);
  
  // Get daily trend for this specific link (last 7 days)
  const days = 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const mongoose = await import('mongoose');
  const linkObjectId = new mongoose.Types.ObjectId(id);
  const pipeline: any[] = [
    { $match: { linkId: linkObjectId, clickedAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
    { $project: { _id: 0, date: "$_id", clicks: 1 } },
    { $sort: { date: 1 } },
  ];
  const trendResults = await Click.aggregate(pipeline);
  
  // Fill in missing days with 0 clicks
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const existingData = trendResults.find(r => r.date === dateStr);
    trend.push({
      date: dateStr,
      clicks: existingData ? existingData.clicks : 0
    });
  }
  
  const data = {
    linkId: id,
    totalClicks: clicks.length,
    countryBreakdown,
    recentClicks: clicks.slice(0, 10), // Last 10 clicks
    trend, // Daily trend data
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
  
  // Log detailed click data
  await Click.create({
    linkId: id,
    ip: clientIP,
    country,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer,
  });
  
  // Update link click count
  link.clicks += 1;
  link.lastClickedAt = new Date();
  await link.save();
  
  // Kullanıcıya kazanç ekle (her tıklama için)
  const earningRate = await getPerClickRate(country);
  await User.findByIdAndUpdate(link.ownerId, { 
    $inc: { earned_balance: earningRate } 
  });
  
  // Invalidate caches so stats/trend update immediately
  invalidateAnalyticsCacheForLink(String(link._id), String(link.ownerId));

  return res.json({ ok: true });
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
        
        await Click.create({
          linkId: session.linkId,
          ip: ip,
          country,
          userAgent: ua,
          referer: req.headers.referer,
        });
        
        // Update link click count
        link.clicks = (link.clicks || 0) + 1;
        link.lastClickedAt = new Date();
        await link.save();
        
        // Kullanıcıya kazanç ekle (her tıklama için)
        const earningRate = await getPerClickRate(country);
        await User.findByIdAndUpdate(link.ownerId, { 
          $inc: { earned_balance: earningRate } 
        });
        // Invalidate caches so stats/trend update immediately
        invalidateAnalyticsCacheForLink(String(link._id), String(link.ownerId));
      }
      
      return res.json({ ok: true, done: true, redirect: link?.targetUrl || null, linkId: session.linkId, suspicious, ip, ua, metrics });
    }

    return res.json({ ok: true, done: false, suspicious, ip, ua, metrics, already });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'impression-failed' });
  }
});

export default router;


