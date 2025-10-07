"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecretOrThrow = getSecretOrThrow;
exports.encodeToken = encodeToken;
exports.decodeToken = decodeToken;
exports.rememberNonce = rememberNonce;
exports.isNonceUsed = isNonceUsed;
exports.getOrCreateAdSession = getOrCreateAdSession;
exports.clearAdSession = clearAdSession;
const crypto_1 = __importDefault(require("crypto"));
// ----------------------
// HMAC helpers
// ----------------------
function getSecretOrThrow() {
    const secret = process.env.LINK_TOKEN_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;
    if (!secret)
        throw new Error("Missing LINK_TOKEN_SECRET");
    return secret;
}
function base64url(input) {
    return Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}
function signHmacSHA256(message, secret) {
    return base64url(crypto_1.default.createHmac("sha256", secret).update(message).digest());
}
function encodeToken(payload) {
    const header = { alg: "HS256", typ: "JWT" };
    const h = base64url(JSON.stringify(header));
    const p = base64url(JSON.stringify(payload));
    const s = signHmacSHA256(`${h}.${p}`, getSecretOrThrow());
    return `${h}.${p}.${s}`;
}
function decodeToken(token) {
    try {
        const [h, p, s] = token.split(".");
        if (!h || !p || !s)
            return { valid: false, reason: "malformed" };
        const expected = signHmacSHA256(`${h}.${p}`, getSecretOrThrow());
        if (s !== expected)
            return { valid: false, reason: "bad-signature" };
        const json = JSON.parse(Buffer.from(p, "base64").toString("utf8"));
        return { valid: true, payload: json };
    }
    catch (e) {
        return { valid: false, reason: "error" };
    }
}
// ----------------------
// Nonce/session utilities
// ----------------------
// in-memory "used nonce" store with TTL to prevent replay
const usedNonces = new Map(); // nonce -> expiryMs
function rememberNonce(nonce, ttlMs) {
    usedNonces.set(nonce, Date.now() + ttlMs);
}
function isNonceUsed(nonce) {
    const exp = usedNonces.get(nonce);
    if (!exp)
        return false;
    if (Date.now() > exp) {
        usedNonces.delete(nonce);
        return false;
    }
    return true;
}
// multi-ad session progress: sessionNonce -> { stagesDone, linkId, expiry }
const adSessions = new Map();
function getOrCreateAdSession(sessionNonce, linkId, ttlMs) {
    const now = Date.now();
    let s = adSessions.get(sessionNonce);
    if (!s || s.expiryMs < now) {
        s = { stagesDone: new Set(), linkId, expiryMs: now + ttlMs };
        adSessions.set(sessionNonce, s);
    }
    return s;
}
function clearAdSession(sessionNonce) {
    adSessions.delete(sessionNonce);
}
