"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const Link_1 = require("../models/Link");
const Pricing_1 = require("../models/Pricing");
const User_1 = require("../models/User");
const auth_1 = require("../middleware/auth");
const geoService_1 = require("../services/geoService");
const linkToken_1 = require("../utils/linkToken");
const security_1 = require("../middleware/security");
const router = (0, express_1.Router)();
let pricingCache = null;
async function loadPricingCache() {
    // Cache for 60 seconds to limit DB reads under traffic
    const needsRefresh = !pricingCache || (Date.now() - pricingCache.updatedAt) > 60000;
    if (!needsRefresh)
        return pricingCache;
    const doc = await Pricing_1.Pricing.findOne().lean();
    const map = {};
    if (doc?.entries?.length) {
        for (const e of doc.entries) {
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
async function getPerClickRate(countryCode) {
    const fallback = Number(process.env.EARNING_PER_CLICK ?? 0.02);
    if (!countryCode)
        return fallback;
    const cache = await loadPricingCache();
    return cache.countryToRate[countryCode.toUpperCase()] ?? fallback;
}
// Per-user rate limiter: max 10 requests per minute
const perUserLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req?.user?.sub ? String(req.user.sub) : (0, express_rate_limit_1.ipKeyGenerator)(req)),
});
const urlRegex = /^https?:\/\//i;
const createSchema = zod_1.z.object({
    targetUrl: zod_1.z.string().url().refine((u) => urlRegex.test(u), "Must be http/https"),
    customSlug: zod_1.z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    expiresAt: zod_1.z.string().datetime().optional(),
});
function generateSlug(length = 6) {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let s = "";
    for (let i = 0; i < length; i++)
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
}
router.post("/", auth_1.requireAuth, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { targetUrl, customSlug, expiresAt } = parsed.data;
    let slug = customSlug?.toString();
    if (slug) {
        const exists = await Link_1.Link.findOne({ slug });
        if (exists)
            return res.status(409).json({ error: "Slug already in use" });
    }
    else {
        for (let i = 0; i < 5; i++) {
            const candidate = generateSlug();
            const exists = await Link_1.Link.findOne({ slug: candidate });
            if (!exists) {
                slug = candidate;
                break;
            }
        }
        if (!slug)
            return res.status(500).json({ error: "Failed to allocate slug" });
    }
    const ownerId = req.user.sub;
    const link = await Link_1.Link.create({ slug, targetUrl, ownerId, expiresAt });
    return res.status(201).json({ id: link._id, slug: link.slug, shortUrl: `/r/${link.slug}`, targetUrl: link.targetUrl });
});
router.get("/", auth_1.requireAuth, async (req, res) => {
    const ownerId = req.user.sub;
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 10))));
    const skip = (page - 1) * limit;
    const total = await Link_1.Link.countDocuments({ ownerId });
    const links = await Link_1.Link.find({ ownerId })
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
router.get("/stats", auth_1.requireAuth, perUserLimiter, async (req, res) => {
    const ownerId = req.user.sub;
    const links = await Link_1.Link.find({ ownerId }).select("_id clicks earnings disabled createdAt slug targetUrl");
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
function invalidateTrendCacheForOwner(ownerId) {
    // Delete all trend cache entries for this owner
    for (const key of Array.from(cache.keys())) {
        if (typeof key === 'string' && key.startsWith(`trend_${ownerId}_`)) {
            cache.delete(key);
        }
    }
}
function invalidateAnalyticsCacheForLink(linkId, ownerId) {
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
    if (ownerId)
        invalidateTrendCacheForOwner(ownerId);
}
// Daily click trend for current user across all links (placed BEFORE /:id routes)
router.get("/trend", auth_1.requireAuth, perUserLimiter, async (req, res) => {
    try {
        const ownerId = req.user.sub;
        const days = Math.min(Math.max(parseInt(String(req.query.days || 30)), 1), 365);
        // Check cache first
        const cacheKey = `trend_${ownerId}_${days}`;
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json(cached.data);
        }
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const ids = await Link_1.Link.find({ ownerId }).select("_id").lean();
        const linkIds = ids.map((d) => d._id);
        if (!linkIds.length)
            return res.json({ days, trend: [] });
        const pipeline = [
            { $match: { linkId: { $in: linkIds }, clickedAt: { $gte: since } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
            { $project: { _id: 0, date: "$_id", clicks: 1 } },
            { $sort: { date: 1 } },
        ];
        const results = await Link_1.Click.aggregate(pipeline);
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
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'trend-failed' });
    }
});
// Overview: geographic distribution across all user's links
router.get("/geo", auth_1.requireAuth, perUserLimiter, async (req, res) => {
    try {
        const ownerId = req.user.sub;
        const days = req.query.days ? Math.min(Math.max(parseInt(String(req.query.days)), 1), 365) : null;
        const ids = await Link_1.Link.find({ ownerId }).select("_id").lean();
        const linkIds = ids.map((d) => d._id);
        if (!linkIds.length)
            return res.json({ countryBreakdown: [] });
        const match = { linkId: { $in: linkIds } };
        if (days) {
            match.clickedAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
        }
        const grouped = await Link_1.Click.aggregate([
            { $match: match },
            { $group: { _id: "$country", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]);
        const total = grouped.reduce((s, g) => s + (g.count || 0), 0) || 1;
        const countryBreakdown = grouped.map((g) => ({
            country: g._id || 'Unknown',
            count: g.count || 0,
            percentage: ((100 * (g.count || 0) / total).toFixed(1)),
        }));
        return res.json({ countryBreakdown });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'geo-failed' });
    }
});
router.get("/slug/:slug", async (req, res) => {
    const slug = req.params.slug;
    const link = await Link_1.Link.findOne({ slug });
    if (!link || link.disabled || (link.expiresAt && link.expiresAt < new Date()))
        return res.status(404).json({ error: "Not found" });
    return res.json({ id: link._id, slug: link.slug, targetUrl: link.targetUrl });
});
router.get("/:id", auth_1.requireAuth, async (req, res) => {
    const { id } = req.params;
    // Validate ObjectId format to prevent injection
    if (!security_1.mongoSanitize.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid link ID format" });
    }
    const ownerId = req.user.sub;
    const sanitizedQuery = security_1.mongoSanitize.sanitizeQuery({ _id: id, ownerId });
    const link = await Link_1.Link.findOne(sanitizedQuery);
    if (!link)
        return res.status(404).json({ error: "Not found" });
    return res.json({ link });
});
router.get("/:id/stats", auth_1.requireAuth, async (req, res) => {
    const { id } = req.params;
    // Validate ObjectId format to prevent injection
    if (!security_1.mongoSanitize.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid link ID format" });
    }
    const ownerId = req.user.sub;
    const sanitizedQuery = security_1.mongoSanitize.sanitizeQuery({ _id: id, ownerId });
    const link = await Link_1.Link.findOne(sanitizedQuery).select("clicks lastClickedAt createdAt slug targetUrl disabled");
    if (!link)
        return res.status(404).json({ error: "Not found" });
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
router.get("/:id/analytics", auth_1.requireAuth, async (req, res) => {
    const { id } = req.params;
    const ownerId = req.user.sub;
    // Pagination parameters
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 10))));
    const skip = (page - 1) * limit;
    // Optional range filter (days)
    const daysParam = req.query.days ? Math.min(Math.max(parseInt(String(req.query.days)), 1), 365) : null;
    // Check cache first (include pagination and days in cache key)
    const cacheKey = `analytics_${id}_${ownerId}_${page}_${limit}_${daysParam ?? 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json(cached.data);
    }
    const link = await Link_1.Link.findOne({ _id: id, ownerId });
    if (!link)
        return res.status(404).json({ error: "Not found" });
    // Build time filter if provided
    const sinceFilter = daysParam ? { clickedAt: { $gte: new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000) } } : {};
    // Get total click count for pagination
    const totalClicks = await Link_1.Click.countDocuments({ linkId: id, ...sinceFilter });
    // Get click analytics grouped by country (filtered by days if provided)
    const allClicks = await Link_1.Click.find({ linkId: id, ...sinceFilter }).sort({ clickedAt: -1 });
    // Get paginated recent clicks
    const recentClicks = await Link_1.Click.find({ linkId: id, ...sinceFilter })
        .sort({ clickedAt: -1 })
        .skip(skip)
        .limit(limit);
    // Group by country (using all clicks for country breakdown)
    const countryStats = allClicks.reduce((acc, click) => {
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
        .map(([country, data]) => ({
        country,
        count: data.count,
        percentage: ((data.count / allClicks.length) * 100).toFixed(1),
        clicks: data.clicks,
    }))
        .sort((a, b) => b.count - a.count);
    // Get daily trend for this specific link (range)
    const days = daysParam ?? 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const mongoose = await Promise.resolve().then(() => __importStar(require('mongoose')));
    const linkObjectId = new mongoose.Types.ObjectId(id);
    const pipeline = [
        { $match: { linkId: linkObjectId, clickedAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$clickedAt" } }, clicks: { $sum: 1 } } },
        { $project: { _id: 0, date: "$_id", clicks: 1 } },
        { $sort: { date: 1 } },
    ];
    const trendResults = await Link_1.Click.aggregate(pipeline);
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
router.patch("/:id", auth_1.requireAuth, async (req, res) => {
    const { id } = req.params;
    const ownerId = req.user.sub;
    const link = await Link_1.Link.findOne({ _id: id, ownerId });
    if (!link)
        return res.status(404).json({ error: "Not found" });
    const { targetUrl, disabled } = req.body;
    if (targetUrl) {
        if (!urlRegex.test(targetUrl))
            return res.status(400).json({ error: "Invalid URL" });
        link.targetUrl = targetUrl;
    }
    if (typeof disabled === "boolean")
        link.disabled = disabled;
    await link.save();
    return res.json({ link });
});
router.delete("/:id", auth_1.requireAuth, async (req, res) => {
    const { id } = req.params;
    const ownerId = req.user.sub;
    const link = await Link_1.Link.findOneAndDelete({ _id: id, ownerId });
    if (!link)
        return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
});
router.post('/:id/click', async (req, res) => {
    const { id } = req.params;
    const link = await Link_1.Link.findById(id);
    if (!link)
        return res.status(404).json({ error: 'Not found' });
    // Get client IP and country
    const clientIP = (0, geoService_1.getClientIP)(req);
    const country = (0, geoService_1.getCountryFromIP)(clientIP);
    // Kullanıcıya kazanç ekle (her tıklama için)
    const earningRate = await getPerClickRate(country);
    // Log detailed click data with earnings
    await Link_1.Click.create({
        linkId: id,
        ip: clientIP,
        country,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
        earnings: earningRate,
    });
    // Update link click count and earnings
    link.clicks += 1;
    link.earnings = (link.earnings || 0) + earningRate;
    link.lastClickedAt = new Date();
    await link.save();
    await User_1.User.findByIdAndUpdate(link.ownerId, {
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
        if (!slug)
            return res.status(400).json({ error: 'missing-slug' });
        const link = await Link_1.Link.findOne({ slug }).select('_id slug targetUrl');
        if (!link)
            return res.status(404).json({ error: 'not-found' });
        const nonce = crypto_1.default.randomBytes(16).toString('hex');
        const exp = Math.floor(Date.now() / 1000) + 10 * 60; // 10 minutes
        // Bind to requester IP via hash (soft check)
        const ip = (0, geoService_1.getClientIP)(req);
        const ipHash = crypto_1.default.createHash('sha256').update(`${(0, linkToken_1.getSecretOrThrow)()}|${ip || 'unknown'}`).digest('hex');
        const token = (0, linkToken_1.encodeToken)({ shortLinkId: String(link._id), slug: link.slug, userId: userId || null, nonce, exp, ipHash });
        (0, linkToken_1.rememberNonce)(nonce, 10 * 60 * 1000);
        // initialize multi-ad session window
        (0, linkToken_1.getOrCreateAdSession)(nonce, String(link._id), 10 * 60 * 1000);
        const adBase = process.env.AD_SITE_BASE_URL;
        return res.json({ token, exp, targetUrl: adBase });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'issue-failed' });
    }
});
// Receive impression with token and metrics
router.post('/impression', async (req, res) => {
    try {
        const { token, metrics, stage } = req.body || {};
        if (!token)
            return res.status(400).json({ error: 'missing-token' });
        const decoded = (0, linkToken_1.decodeToken)(token);
        if (!decoded.valid || !decoded.payload) {
            return res.status(400).json({ error: 'invalid-token', reason: decoded.reason });
        }
        const payload = decoded.payload;
        if (payload.exp * 1000 < Date.now())
            return res.status(400).json({ error: 'expired' });
        // For multi-stage: do not block by used nonce; we guard with session stages.
        const ip = (0, geoService_1.getClientIP)(req);
        const ua = req.headers['user-agent'] || '';
        const computedIpHash = crypto_1.default.createHash('sha256').update(`${(0, linkToken_1.getSecretOrThrow)()}|${ip || 'unknown'}`).digest('hex');
        // TODO: add anti-fraud checks (webdriver, ASN etc.)
        let suspicious = false;
        if (payload.ipHash && payload.ipHash !== computedIpHash) {
            suspicious = true; // IP değişmiş: şüphe puanı ver
        }
        // session progress update (require stage 1 or 2)
        const stageNum = Number(stage) || 1;
        if (![1, 2].includes(stageNum))
            return res.status(400).json({ error: 'invalid-stage' });
        const session = (0, linkToken_1.getOrCreateAdSession)(payload.nonce, payload.shortLinkId, 10 * 60 * 1000);
        const already = session.stagesDone.has(stageNum);
        session.stagesDone.add(stageNum);
        // TODO: persist impression record if desired
        // If both stages completed, respond with redirect target
        if (session.stagesDone.size >= 2) {
            // Optional: expire session immediately to prevent further reuse
            (0, linkToken_1.clearAdSession)(payload.nonce);
            const link = await Link_1.Link.findById(session.linkId);
            // Log click with real client IP (from impression request)
            if (link) {
                const country = (0, geoService_1.getCountryFromIP)(ip);
                // Kullanıcıya kazanç ekle (her tıklama için)
                const earningRate = await getPerClickRate(country);
                await Link_1.Click.create({
                    linkId: session.linkId,
                    ip: ip,
                    country,
                    userAgent: ua,
                    referer: req.headers.referer,
                    earnings: earningRate,
                });
                // Update link click count and earnings
                link.clicks = (link.clicks || 0) + 1;
                link.earnings = (link.earnings || 0) + earningRate;
                link.lastClickedAt = new Date();
                await link.save();
                await User_1.User.findByIdAndUpdate(link.ownerId, {
                    $inc: { earned_balance: earningRate }
                });
                // Invalidate caches so stats/trend update immediately
                invalidateAnalyticsCacheForLink(String(link._id), String(link.ownerId));
            }
            return res.json({ ok: true, done: true, redirect: link?.targetUrl || null, linkId: session.linkId, suspicious, ip, ua, metrics });
        }
        return res.json({ ok: true, done: false, suspicious, ip, ua, metrics, already });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'impression-failed' });
    }
});
exports.default = router;
