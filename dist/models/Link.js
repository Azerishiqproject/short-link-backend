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
exports.Link = exports.Click = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const clickSchema = new mongoose_1.Schema({
    linkId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Link", required: true, index: true },
    ip: { type: String, required: true },
    country: { type: String, required: true },
    userAgent: { type: String },
    referer: { type: String },
    clickedAt: { type: Date, default: Date.now },
}, { timestamps: true });
const linkSchema = new mongoose_1.Schema({
    slug: { type: String, required: true, unique: true, index: true },
    targetUrl: { type: String, required: true },
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    disabled: { type: Boolean, default: false },
    clicks: { type: Number, default: 0 },
    lastClickedAt: { type: Date },
    expiresAt: { type: Date },
}, { timestamps: true });
exports.Click = mongoose_1.default.models.Click || mongoose_1.default.model("Click", clickSchema);
exports.Link = mongoose_1.default.models.Link || mongoose_1.default.model("Link", linkSchema);
