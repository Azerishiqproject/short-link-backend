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
    ip: { type: String, index: true },
    mac: { type: String, index: true },
    reason: { type: String },
    expiresAt: { type: Date },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
    active: { type: Boolean, default: true },
}, { timestamps: true });
banSchema.index({ email: 1, active: 1 });
banSchema.index({ ip: 1, active: 1 });
banSchema.index({ mac: 1, active: 1 });
banSchema.index({ userId: 1, active: 1 });
exports.Ban = mongoose_1.default.models.Ban || mongoose_1.default.model("Ban", banSchema);
