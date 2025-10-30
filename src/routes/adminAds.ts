import { Router } from "express";
import crypto from "crypto";
import { requireAdmin } from "../middleware/auth";
import { AdminAd } from "../models/AdminAd";
import { AdminAdsConfig } from "../models/AdminAdsConfig";
import { AdminAdHit } from "../models/AdminAdHit";
import { getClientIP, getCountryFromIP } from "../services/geoService";
import { getSecretOrThrow } from "../utils/linkToken";

const router = Router();

router.get("/current", requireAdmin, async (_req, res) => {
  const ad = await AdminAd.findOne({ active: true }).sort({ updatedAt: -1 });
  if (!ad) return res.json({ ad: null });
  return res.json({ ad: { id: ad._id, url: ad.url, remaining: ad.remaining, initialLimit: ad.initialLimit, active: ad.active, updatedAt: ad.updatedAt } });
});

// Admin: list all ads (most recent first)
router.get("/list", requireAdmin, async (_req, res) => {
  const ads = await AdminAd.find().sort({ createdAt: -1 });
  return res.json({
    ads: ads.map(a => ({ id: a._id, url: a.url, remaining: a.remaining, initialLimit: a.initialLimit, served: a.served, active: a.active, createdAt: a.createdAt, updatedAt: a.updatedAt }))
  });
});

// Admin: get selection config
router.get('/config', requireAdmin, async (_req, res) => {
  const cfg = await AdminAdsConfig.findOne().sort({ updatedAt: -1 });
  return res.json({ mode: cfg?.mode || 'random', priorityAdId: cfg?.priorityAdId || null });
});

// Admin: set selection config
router.post('/config', requireAdmin, async (req, res) => {
  const { mode, priorityAdId } = req.body || {};
  if (!['random', 'priority'].includes(mode)) return res.status(400).json({ error: 'invalid-mode' });
  let payload: any = { mode };
  if (mode === 'priority') payload.priorityAdId = priorityAdId || null;
  const existing = await AdminAdsConfig.findOne().sort({ updatedAt: -1 });
  if (existing) {
    existing.mode = mode;
    existing.priorityAdId = payload.priorityAdId || null;
    await existing.save();
    return res.json({ mode: existing.mode, priorityAdId: existing.priorityAdId });
  } else {
    const created = await AdminAdsConfig.create(payload);
    return res.json({ mode: created.mode, priorityAdId: created.priorityAdId });
  }
});

// Admin: analytics for a specific ad (trend + geo)
router.get('/:adId/analytics', requireAdmin, async (req, res) => {
  try {
    const { adId } = req.params as any;
    const daysParam = req.query.days ? Math.min(Math.max(parseInt(String(req.query.days)), 1), 365) : 7;

    // Verify ad exists
    const ad = await AdminAd.findById(adId).select('_id');
    if (!ad) return res.status(404).json({ error: 'not-found' });

    const days = daysParam;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const mongoose = await import('mongoose');
    const adObjectId = new mongoose.Types.ObjectId(adId);

    let trend: Array<{ date: string; clicks: number }> = [];
    if (days === 1) {
      const pipeline: any[] = [
        { $match: { adId: adObjectId, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$createdAt" } }, clicks: { $sum: 1 } } },
        { $project: { _id: 0, date: "$_id", clicks: 1 } },
        { $sort: { date: 1 } },
      ];
      const results = await AdminAdHit.aggregate(pipeline);
      for (let i = 23; i >= 0; i--) {
        const dt = new Date(Date.now() - i * 60 * 60 * 1000);
        dt.setUTCMinutes(0, 0, 0);
        const isoHour = dt.toISOString().slice(0, 13) + ":00:00Z";
        const existing = results.find((r: any) => r.date === isoHour);
        trend.push({ date: isoHour, clicks: existing ? existing.clicks : 0 });
      }
    } else {
      const pipeline: any[] = [
        { $match: { adId: adObjectId, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, clicks: { $sum: 1 } } },
        { $project: { _id: 0, date: "$_id", clicks: 1 } },
        { $sort: { date: 1 } },
      ];
      const results = await AdminAdHit.aggregate(pipeline);
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const existingData = results.find((r: any) => r.date === dateStr);
        trend.push({ date: dateStr, clicks: existingData ? existingData.clicks : 0 });
      }
    }

    // Geo breakdown
    const geoGrouped = await AdminAdHit.aggregate([
      { $match: { adId: adObjectId, createdAt: { $gte: since } } },
      { $group: { _id: "$country", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const total = geoGrouped.reduce((s, g)=> s + (g.count || 0), 0) || 1;
    const countryBreakdown = geoGrouped.map((g:any)=>({ country: g._id || 'Unknown', count: g.count || 0, percentage: ((100 * (g.count || 0) / total).toFixed(1)) }));

    return res.json({ days, trend, countryBreakdown });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'analytics-failed' });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const { url, limit } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "invalid-url" });
    const remaining = Math.max(0, Number(limit ?? 0));
    // Allow multiple active ads for rotation
    const ad = await AdminAd.create({ url, remaining, initialLimit: remaining, active: true });
    return res.status(201).json({ id: ad._id, url: ad.url, remaining: ad.remaining, initialLimit: ad.initialLimit, active: ad.active });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "create-failed" });
  }
});

// Public consume endpoint: per-IP only once, decrement remaining atomically
router.post("/consume", async (req, res) => {
  try {
    // Load selection config
    const config = await AdminAdsConfig.findOne().sort({ updatedAt: -1 });
    const mode = config?.mode || 'random';
    const ip = getClientIP(req) || "unknown";
    const ipHash = crypto.createHash("sha256").update(`${getSecretOrThrow()}|${ip}`).digest("hex");

    let ad: any = null;
    if (mode === 'priority' && config?.priorityAdId) {
      // Only the priority ad is eligible in priority mode
      const candidate = await AdminAd.findOne({ _id: config.priorityAdId, remaining: { $gt: 0 } });
      if (candidate) {
        const exists = await AdminAdHit.findOne({ adId: candidate._id, ipHash }).select('_id');
        if (!exists) ad = candidate;
        console.log("consume: mode=priority", { candidate: String(candidate?._id), exists: !!exists, ip });
      }
    }

    if (!ad) {
      // random mode (balanced): choose first candidate this IP hasn't consumed yet (server-side filter)
      const mongoose = await import('mongoose');
      const AdminAdModel = mongoose.model('AdminAd');
      const AdminAdHitModel = mongoose.model('AdminAdHit');
      // DEBUG: list candidates and hit status for this IP
      try {
        const dbgCandidates = await AdminAdModel.find({ active: true, remaining: { $gt: 0 } }).sort({ served: 1, updatedAt: 1 }).lean();
        for (const c of dbgCandidates) {
          const ex = await AdminAdHitModel.findOne({ adId: c._id, ipHash }).select('_id');
          console.log('consume: candidate', { id: String(c._id), url: (c as any).url, remaining: (c as any).remaining, served: (c as any).served, hitForIp: !!ex });
        }
      } catch (e) { console.log('consume: debug list error', e); }
      const results = await AdminAdModel.aggregate([
        { $match: { active: true, remaining: { $gt: 0 } } },
        { $sort: { served: 1, updatedAt: 1 } },
        { $lookup: {
            from: AdminAdHitModel.collection.name,
            let: { adId: '$_id' },
            pipeline: [
              { $match: { $expr: { $and: [ { $eq: ['$adId', '$$adId'] }, { $eq: ['$ipHash', ipHash] } ] } } },
              { $limit: 1 }
            ],
            as: 'hitsForIp'
        }},
        { $match: { hitsForIp: { $size: 0 } } },
        { $limit: 1 }
      ]);
      if (results && results.length > 0) {
        ad = results[0];
        console.log('consume: mode=random pick via agg', { picked: String(ad._id), served: ad.served, ip });
      } else {
        console.log('consume: mode=random no eligible via agg', { ip });
      }
    }

    if (!ad) { console.log("consume: no eligible ad for ip", ip); return res.json({ openUrl: false, remaining: 0 }); }

    // Try to decrement remaining only if > 0
    const updated = await AdminAd.findOneAndUpdate(
      { _id: ad._id, remaining: { $gt: 0 } },
      { $inc: { remaining: -1, served: 1 } },
      { new: true }
    );
    if (!updated) {
      return res.json({ openUrl: false, remaining: 0 });
    }

    // Record hit (unique on adId+ipHash)
    try {
      await AdminAdHit.create({ adId: ad._id, ipHash, ip, country: getCountryFromIP(ip) });
    } catch (_) {
      // Unique violation: revert decrement by increasing back by 1
      await AdminAd.findByIdAndUpdate(ad._id, { $inc: { remaining: 1 } });
      return res.json({ openUrl: false, remaining: updated.remaining });
    }

    return res.json({ openUrl: true, url: ad.url, remaining: updated.remaining });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "consume-failed" });
  }
});

export default router;
// Admin-only: list recent hits for current or specified ad
router.get("/hits", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || 20))));
    const skip = (page - 1) * limit;

    const adId = req.query.adId as string | undefined;
    let targetAdId = adId;
    if (!targetAdId) {
      const ad = await AdminAd.findOne({ active: true }).sort({ updatedAt: -1 }).select('_id');
      if (!ad) return res.json({ hits: [], pagination: { page, limit, total: 0, totalPages: 0 } });
      targetAdId = String(ad._id);
    }

    const query = { adId: targetAdId } as any;
    const total = await AdminAdHit.countDocuments(query);
    const hits = await AdminAdHit.find(query)
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
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'hits-failed' });
  }
});


