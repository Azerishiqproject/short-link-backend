"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ban = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const banSchema = new mongoose_1.default.Schema({
    userId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
    email: { type: String, index: true },
    emails: { type: [String], default: [] }, // Birden fazla email için
    ip: { type: String, index: true }, // Tek IP için (eski sistem uyumluluğu)
    ips: { type: [String], default: [] }, // Birden fazla IP için
    mac: { type: String, index: true }, // Tek cihaz için (eski sistem uyumluluğu)
    deviceIds: { type: [String], default: [] }, // Birden fazla cihaz için
    reason: { type: String },
    expiresAt: { type: Date },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
    active: { type: Boolean, default: true },
    banType: { type: String, enum: ["single", "comprehensive"], default: "single" }, // Ban tipi
}, { timestamps: true });
banSchema.index({ email: 1, active: 1 });
banSchema.index({ emails: 1, active: 1 });
banSchema.index({ ip: 1, active: 1 });
banSchema.index({ ips: 1, active: 1 });
banSchema.index({ mac: 1, active: 1 });
banSchema.index({ deviceIds: 1, active: 1 });
banSchema.index({ userId: 1, active: 1 });
banSchema.index({ banType: 1, active: 1 });
exports.Ban = mongoose_1.default.models.Ban || mongoose_1.default.model("Ban", banSchema);
