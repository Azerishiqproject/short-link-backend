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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferralSettings = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const referralSettingsSchema = new mongoose_1.Schema({
    // Referans sistemi aktif mi?
    isActive: { type: Boolean, default: true },
    // Referans eden kişiye verilecek yüzde (0-100)
    referrerPercentage: { type: Number, default: 10, min: 0, max: 100 },
    // Minimum referans kazanç miktarı
    minReferralEarning: { type: Number, default: 0.01 },
    // Maksimum referans kazanç miktarı (0 = sınırsız)
    maxReferralEarning: { type: Number, default: 0 },
    // Admin notları
    adminNotes: { type: String, maxlength: 500 },
    // Son güncelleme yapan admin
    lastUpdatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    // Sistem durumu
    status: {
        type: String,
        enum: ["active", "paused", "maintenance"],
        default: "active"
    }
}, { timestamps: true });
exports.ReferralSettings = mongoose_1.default.models.ReferralSettings || mongoose_1.default.model("ReferralSettings", referralSettingsSchema);
