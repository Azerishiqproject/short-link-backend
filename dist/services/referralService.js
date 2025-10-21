"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.referralService = exports.ReferralService = void 0;
const ReferralSettings_1 = require("../models/ReferralSettings");
const ReferralTransaction_1 = require("../models/ReferralTransaction");
const User_1 = require("../models/User");
/**
 * Referans kazanç hesaplama ve işleme servisi
 */
class ReferralService {
    constructor() {
        this.settings = null;
    }
    static getInstance() {
        if (!ReferralService.instance) {
            ReferralService.instance = new ReferralService();
        }
        return ReferralService.instance;
    }
    /**
     * Referans ayarlarını yükle
     */
    async loadSettings() {
        // Her seferinde en güncel ayarı al (updatedAt öncelikli)
        this.settings = await ReferralSettings_1.ReferralSettings.findOne().sort({ updatedAt: -1, createdAt: -1 });
        return this.settings;
    }
    /**
     * Ayarlar cache'ini temizle (ayarlar güncellendiğinde çağrılmalı)
     */
    clearSettingsCache() {
        this.settings = null;
    }
    /**
     * Referans kazanç hesapla
     */
    async calculateReferralEarning(baseAmount, percentage, minEarning, maxEarning) {
        let earning = (baseAmount * percentage) / 100;
        // Minimum kazanç kontrolü
        if (earning < minEarning) {
            earning = minEarning;
        }
        // Maksimum kazanç kontrolü (0 = sınırsız)
        if (maxEarning > 0 && earning > maxEarning) {
            earning = maxEarning;
        }
        return Math.round(earning * 100) / 100; // 2 ondalık basamak
    }
    /**
     * Referans işlemi oluştur
     */
    async createReferralTransaction(referrerId, refereeId, action, baseAmount, percentage, sourceId, sourceType, description) {
        const settings = await this.loadSettings();
        if (!settings) {
            throw new Error("Referans ayarları bulunamadı");
        }
        const amount = await this.calculateReferralEarning(baseAmount, percentage, settings.minReferralEarning, settings.maxReferralEarning);
        const transaction = await ReferralTransaction_1.ReferralTransaction.create({
            referrer: referrerId,
            referee: refereeId,
            action,
            amount,
            percentage,
            sourceId,
            sourceType,
            description,
            status: "pending",
            paymentStatus: "pending"
        });
        // Anında ödeme yap
        await this.processReferralPayment(transaction._id.toString());
        return transaction;
    }
    /**
     * Referans ödemesini işle
     */
    async processReferralPayment(transactionId) {
        const transaction = await ReferralTransaction_1.ReferralTransaction.findById(transactionId);
        if (!transaction) {
            throw new Error("Referans işlemi bulunamadı");
        }
        if (transaction.status !== "pending") {
            return; // Zaten işlenmiş
        }
        // Referans eden kullanıcının bakiyesini artır
        await User_1.User.findByIdAndUpdate(transaction.referrer, {
            $inc: {
                referral_earned: transaction.amount,
                available_balance: transaction.amount
            }
        });
        // İşlemi tamamlandı olarak işaretle
        await ReferralTransaction_1.ReferralTransaction.findByIdAndUpdate(transactionId, {
            status: "completed",
            paymentStatus: "paid",
            paidAt: new Date()
        });
    }
    /**
     * Kayıt referansı işle
     */
    async processRegistrationReferral(refereeId) {
        const settings = await this.loadSettings();
        if (!settings || !settings.isActive || settings.status !== "active") {
            return; // Referans sistemi aktif değil
        }
        const referee = await User_1.User.findById(refereeId);
        if (!referee || !referee.referredBy) {
            return; // Referans eden yok
        }
        const referrer = await User_1.User.findById(referee.referredBy);
        if (!referrer) {
            return; // Referans eden kullanıcı bulunamadı
        }
        // Kayıt bonusu için temel miktar (örneğin 1 TL)
        const baseAmount = 1.0;
        try {
            await this.createReferralTransaction(referrer._id.toString(), refereeId, "registration", baseAmount, settings.referrerPercentage, undefined, "registration", "Yeni kullanıcı kaydı referans bonusu");
        }
        catch (error) {
            console.error("Registration referral processing error:", error);
        }
    }
    /**
     * Link tıklama referansı işle
     * BB kullanıcısı para kazandığında, AA kullanıcısının referral_earned'ına yazılır
     */
    async processClickReferral(linkOwnerId, // BB kullanıcısı (link sahibi)
    linkId, clickValue = 0.01) {
        const settings = await this.loadSettings();
        if (!settings || !settings.isActive || settings.status !== "active") {
            return;
        }
        // BB kullanıcısının referans eden kişisini bul (AA kullanıcısı)
        const linkOwner = await User_1.User.findById(linkOwnerId);
        if (!linkOwner || !linkOwner.referredBy) {
            return; // BB kullanıcısının referans edeni yok
        }
        try {
            await this.createReferralTransaction(linkOwner.referredBy.toString(), // AA kullanıcısı (referans eden)
            linkOwnerId, // BB kullanıcısı (referans edilen)
            "click", clickValue, settings.referrerPercentage, linkId, "link", "Link tıklama referans bonusu");
        }
        catch (error) {
            console.error("Click referral processing error:", error);
        }
    }
    /**
     * Bekleyen referans ödemelerini işle (cron job için)
     */
    async processPendingReferrals() {
        const settings = await this.loadSettings();
        if (!settings || !settings.isActive) {
            return;
        }
        const pendingTransactions = await ReferralTransaction_1.ReferralTransaction.find({
            status: "completed",
            paymentStatus: "pending"
        });
        for (const transaction of pendingTransactions) {
            try {
                await this.processReferralPayment(transaction._id.toString());
            }
            catch (error) {
                console.error(`Error processing referral payment ${transaction._id}:`, error);
            }
        }
    }
    /**
     * Referans istatistiklerini getir
     */
    async getReferralStats(userId) {
        const [totalEarnings, totalReferrals, pendingEarnings, paidEarnings] = await Promise.all([
            ReferralTransaction_1.ReferralTransaction.aggregate([
                { $match: { referrer: userId, status: "completed" } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            ReferralTransaction_1.ReferralTransaction.countDocuments({ referrer: userId, status: "completed" }),
            ReferralTransaction_1.ReferralTransaction.aggregate([
                { $match: { referrer: userId, status: "completed", paymentStatus: "pending" } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            ReferralTransaction_1.ReferralTransaction.aggregate([
                { $match: { referrer: userId, status: "completed", paymentStatus: "paid" } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ])
        ]);
        return {
            totalEarnings: totalEarnings[0]?.total || 0,
            totalReferrals,
            pendingEarnings: pendingEarnings[0]?.total || 0,
            paidEarnings: paidEarnings[0]?.total || 0
        };
    }
}
exports.ReferralService = ReferralService;
exports.referralService = ReferralService.getInstance();
