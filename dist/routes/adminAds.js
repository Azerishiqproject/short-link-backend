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
const crypto_1 = __importDefault(require("crypto"));
const auth_1 = require("../middleware/auth");
const AdminAd_1 = require("../models/AdminAd");
const AdminAdsConfig_1 = require("../models/AdminAdsConfig");
const AdminAdHit_1 = require("../models/AdminAdHit");
const geoService_1 = require("../services/geoService");
const linkToken_1 = require("../utils/linkToken");
const router = (0, express_1.Router)();
router.get("/current", auth_1.requireAdmin, async (_req, res) => {
    const ad = await AdminAd_1.AdminAd.findOne({ active: true }).sort({ updatedAt: -1 });
    if (!ad)
        return res.json({ ad: null });
    return res.json({ ad: { id: ad._id, url: ad.url, remaining: ad.remaining, initialLimit: ad.initialLimit, active: ad.active, updatedAt: ad.updatedAt } });
});
// Admin: list all ads (most recent first)
router.get("/list", auth_1.requireAdmin, async (_req, res) => {
    const ads = await AdminAd_1.AdminAd.find().sort({ createdAt: -1 });
    return res.json({
        ads: ads.map(a => ({ id: a._id, url: a.url, remaining: a.remaining, initialLimit: a.initialLimit, served: a.served, active: a.active, createdAt: a.createdAt, updatedAt: a.updatedAt }))
    });
});
// Admin: get selection config
router.get('/config', auth_1.requireAdmin, async (_req, res) => {
    const cfg = await AdminAdsConfig_1.AdminAdsConfig.findOne().sort({ updatedAt: -1 });
    return res.json({ mode: cfg?.mode || 'random', priorityAdId: cfg?.priorityAdId || null });
});
// Admin: set selection config
router.post('/config', auth_1.requireAdmin, async (req, res) => {
    const { mode, priorityAdId } = req.body || {};
    if (!['random', 'priority'].includes(mode))
        return res.status(400).json({ error: 'invalid-mode' });
    let payload = { mode };
    if (mode === 'priority')
        payload.priorityAdId = priorityAdId || null;
    const existing = await AdminAdsConfig_1.AdminAdsConfig.findOne().sort({ updatedAt: -1 });
    if (existing) {
        existing.mode = mode;
        existing.priorityAdId = payload.priorityAdId || null;
        await existing.save();
        return res.json({ mode: existing.mode, priorityAdId: existing.priorityAdId });
    }
    else {
        const created = await AdminAdsConfig_1.AdminAdsConfig.create(payload);
        return res.json({ mode: created.mode, priorityAdId: created.priorityAdId });
    }
});
// Admin: analytics for a specific ad (trend + geo)
router.get('/:adId/analytics', auth_1.requireAdmin, async (req, res) => {
    try {
        const { adId } = req.params;
        const daysParam = req.query.days ? Math.min(Math.max(parseInt(String(req.query.days)), 1), 365) : 7;
        // Verify ad exists
        const ad = await AdminAd_1.AdminAd.findById(adId).select('_id');
        if (!ad)
            return res.status(404).json({ error: 'not-found' });
        const days = daysParam;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const mongoose = await Promise.resolve().then(() => __importStar(require('mongoose')));
        const adObjectId = new mongoose.Types.ObjectId(adId);
        let trend = [];
        if (days === 1) {
            const pipeline = [
                { $match: { adId: adObjectId, createdAt: { $gte: since } } },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$createdAt" } }, clicks: { $sum: 1 } } },
                { $project: { _id: 0, date: "$_id", clicks: 1 } },
                { $sort: { date: 1 } },
            ];
            const results = await AdminAdHit_1.AdminAdHit.aggregate(pipeline);
            for (let i = 23; i >= 0; i--) {
                const dt = new Date(Date.now() - i * 60 * 60 * 1000);
                dt.setUTCMinutes(0, 0, 0);
                const isoHour = dt.toISOString().slice(0, 13) + ":00:00Z";
                const existing = results.find((r) => r.date === isoHour);
                trend.push({ date: isoHour, clicks: existing ? existing.clicks : 0 });
            }
        }
        else {
            const pipeline = [
                { $match: { adId: adObjectId, createdAt: { $gte: since } } },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, clicks: { $sum: 1 } } },
                { $project: { _id: 0, date: "$_id", clicks: 1 } },
                { $sort: { date: 1 } },
            ];
            const results = await AdminAdHit_1.AdminAdHit.aggregate(pipeline);
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                const existingData = results.find((r) => r.date === dateStr);
                trend.push({ date: dateStr, clicks: existingData ? existingData.clicks : 0 });
            }
        }
        // Geo breakdown
        const geoGrouped = await AdminAdHit_1.AdminAdHit.aggregate([
            { $match: { adId: adObjectId, createdAt: { $gte: since } } },
            { $group: { _id: "$country", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]);
        const total = geoGrouped.reduce((s, g) => s + (g.count || 0), 0) || 1;
        const countryBreakdown = geoGrouped.map((g) => ({ country: g._id || 'Unknown', count: g.count || 0, percentage: ((100 * (g.count || 0) / total).toFixed(1)) }));
        return res.json({ days, trend, countryBreakdown });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'analytics-failed' });
    }
});
router.post("/", auth_1.requireAdmin, async (req, res) => {
    try {
        const { url, limit } = req.body || {};
        if (!url || typeof url !== "string")
            return res.status(400).json({ error: "invalid-url" });
        const remaining = Math.max(0, Number(limit ?? 0));
        // Allow multiple active ads for rotation
        const ad = await AdminAd_1.AdminAd.create({ url, remaining, initialLimit: remaining, active: true });
        return res.status(201).json({ id: ad._id, url: ad.url, remaining: ad.remaining, initialLimit: ad.initialLimit, active: ad.active });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || "create-failed" });
    }
});
// Public consume endpoint: per-IP only once, decrement remaining atomically
router.post("/consume", async (req, res) => {
    try {
        // Load selection config
        const config = await AdminAdsConfig_1.AdminAdsConfig.findOne().sort({ updatedAt: -1 });
        const mode = config?.mode || 'random';
        const ip = (0, geoService_1.getClientIP)(req) || "unknown";
        const ipHash = crypto_1.default.createHash("sha256").update(`${(0, linkToken_1.getSecretOrThrow)()}|${ip}`).digest("hex");
        let ad = null;
        if (mode === 'priority' && config?.priorityAdId) {
            // Only the priority ad is eligible in priority mode
            const candidate = await AdminAd_1.AdminAd.findOne({ _id: config.priorityAdId, remaining: { $gt: 0 } });
            if (candidate) {
                const exists = await AdminAdHit_1.AdminAdHit.findOne({ adId: candidate._id, ipHash }).select('_id');
                if (!exists)
                    ad = candidate;
                console.log("consume: mode=priority", { candidate: String(candidate?._id), exists: !!exists, ip });
            }
        }
        if (!ad) {
            // random mode (balanced): choose first candidate this IP hasn't consumed yet (server-side filter)
            const mongoose = await Promise.resolve().then(() => __importStar(require('mongoose')));
            const AdminAdModel = mongoose.model('AdminAd');
            const AdminAdHitModel = mongoose.model('AdminAdHit');
            // DEBUG: list candidates and hit status for this IP
            try {
                const dbgCandidates = await AdminAdModel.find({ active: true, remaining: { $gt: 0 } }).sort({ served: 1, updatedAt: 1 }).lean();
                for (const c of dbgCandidates) {
                    const ex = await AdminAdHitModel.findOne({ adId: c._id, ipHash }).select('_id');
                    console.log('consume: candidate', { id: String(c._id), url: c.url, remaining: c.remaining, served: c.served, hitForIp: !!ex });
                }
            }
            catch (e) {
                console.log('consume: debug list error', e);
            }
            const results = await AdminAdModel.aggregate([
                { $match: { active: true, remaining: { $gt: 0 } } },
                { $sort: { served: 1, updatedAt: 1 } },
                { $lookup: {
                        from: AdminAdHitModel.collection.name,
                        let: { adId: '$_id' },
                        pipeline: [
                            { $match: { $expr: { $and: [{ $eq: ['$adId', '$$adId'] }, { $eq: ['$ipHash', ipHash] }] } } },
                            { $limit: 1 }
                        ],
                        as: 'hitsForIp'
                    } },
                { $match: { hitsForIp: { $size: 0 } } },
                { $limit: 1 }
            ]);
            if (results && results.length > 0) {
                ad = results[0];
                console.log('consume: mode=random pick via agg', { picked: String(ad._id), served: ad.served, ip });
            }
            else {
                console.log('consume: mode=random no eligible via agg', { ip });
            }
        }
        if (!ad) {
            console.log("consume: no eligible ad for ip", ip);
            return res.json({ openUrl: false, remaining: 0 });
        }
        // Try to decrement remaining only if > 0
        const updated = await AdminAd_1.AdminAd.findOneAndUpdate({ _id: ad._id, remaining: { $gt: 0 } }, { $inc: { remaining: -1, served: 1 } }, { new: true });
        if (!updated) {
            return res.json({ openUrl: false, remaining: 0 });
        }
        // Record hit (unique on adId+ipHash)
        try {
            await AdminAdHit_1.AdminAdHit.create({ adId: ad._id, ipHash, ip, country: (0, geoService_1.getCountryFromIP)(ip) });
        }
        catch (_) {
            // Unique violation: revert decrement by increasing back by 1
            await AdminAd_1.AdminAd.findByIdAndUpdate(ad._id, { $inc: { remaining: 1 } });
            return res.json({ openUrl: false, remaining: updated.remaining });
        }
        return res.json({ openUrl: true, url: ad.url, remaining: updated.remaining });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || "consume-failed" });
    }
});
exports.default = router;
// Admin-only: list recent hits for current or specified ad
router.get("/hits", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || 1)));
        const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
        const skip = (page - 1) * limit;
        const adId = req.query.adId;
        let targetAdId = adId;
        if (!targetAdId) {
            const ad = await AdminAd_1.AdminAd.findOne({ active: true }).sort({ updatedAt: -1 }).select('_id');
            if (!ad)
                return res.json({ hits: [], pagination: { page, limit, total: 0, totalPages: 0 } });
            targetAdId = String(ad._id);
        }
        const query = { adId: targetAdId };
        const total = await AdminAdHit_1.AdminAdHit.countDocuments(query);
        const hits = await AdminAdHit_1.AdminAdHit.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
        return res.json({
            hits: hits.map(h => ({ id: h._id, ip: h.ip || null, country: h.country || 'Unknown', createdAt: h.createdAt })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'hits-failed' });
    }
});
