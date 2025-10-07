"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function getJwtSecret() {
    const s = process.env.JWT_SECRET;
    if (!s) {
        throw new Error("Missing JWT_SECRET env");
    }
    return s;
}
function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer "))
            return res.status(401).json({ error: "Missing token" });
        const token = header.slice(7);
        const secret = getJwtSecret();
        const payload = jsonwebtoken_1.default.verify(token, secret);
        req.user = payload;
        next();
    }
    catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
}
function requireAdmin(req, res, next) {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer "))
            return res.status(401).json({ error: "Missing token" });
        const token = header.slice(7);
        const secret = getJwtSecret();
        const payload = jsonwebtoken_1.default.verify(token, secret);
        if (payload.role !== "admin")
            return res.status(403).json({ error: "Forbidden" });
        req.user = payload;
        next();
    }
    catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
}
