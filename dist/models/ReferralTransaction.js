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
exports.ReferralTransaction = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const referralTransactionSchema = new mongoose_1.Schema({
    // Referans eden kullanıcı
    referrer: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    // Referans edilen kullanıcı
    referee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    // İşlem türü
    action: {
        type: String,
        enum: ["registration", "click"],
        required: true
    },
    // Kazanç miktarı
    amount: { type: Number, required: true, min: 0 },
    // Yüzde oranı
    percentage: { type: Number, required: true, min: 0, max: 100 },
    // Hangi işlemden kazanç elde edildi (link ID, kampanya ID vb.)
    sourceId: { type: String },
    sourceType: {
        type: String,
        enum: ["link", "campaign", "registration", "other"]
    },
    // İşlem durumu
    status: {
        type: String,
        enum: ["pending", "completed", "cancelled", "refunded"],
        default: "pending"
    },
    // Ödeme durumu
    paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed"],
        default: "pending"
    },
    // Ödeme tarihi
    paidAt: { type: Date },
    // Admin notları
    adminNotes: { type: String, maxlength: 500 },
    // İşlem açıklaması
    description: { type: String, maxlength: 200 }
}, { timestamps: true });
// Index'ler
referralTransactionSchema.index({ referrer: 1, createdAt: -1 });
referralTransactionSchema.index({ referee: 1, createdAt: -1 });
referralTransactionSchema.index({ status: 1 });
referralTransactionSchema.index({ paymentStatus: 1 });
exports.ReferralTransaction = mongoose_1.default.models.ReferralTransaction || mongoose_1.default.model("ReferralTransaction", referralTransactionSchema);
