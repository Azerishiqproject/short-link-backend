import crypto from "crypto";

// Token payload used for impression flow
export type TokenPayload = {
  shortLinkId: string;
  slug: string;
  userId?: string | null;
  nonce: string;        // unique per session
  exp: number;          // unix seconds expiry
  ipHash?: string;      // optional ip-bound hash (soft check)
};

// ----------------------
// HMAC helpers
// ----------------------
export function getSecretOrThrow(): string {
  const secret = process.env.LINK_TOKEN_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing LINK_TOKEN_SECRET");
  return secret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signHmacSHA256(message: string, secret: string) {
  return base64url(crypto.createHmac("sha256", secret).update(message).digest());
}

export function encodeToken(payload: TokenPayload): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const s = signHmacSHA256(`${h}.${p}`, getSecretOrThrow());
  return `${h}.${p}.${s}`;
}

export function decodeToken(token: string): { valid: boolean; payload?: TokenPayload; reason?: string } {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return { valid: false, reason: "malformed" };
    const expected = signHmacSHA256(`${h}.${p}`, getSecretOrThrow());
    if (s !== expected) return { valid: false, reason: "bad-signature" };
    const json = JSON.parse(Buffer.from(p, "base64").toString("utf8"));
    return { valid: true, payload: json };
  } catch (e) {
    return { valid: false, reason: "error" };
  }
}

// ----------------------
// Nonce/session utilities
// ----------------------

// in-memory "used nonce" store with TTL to prevent replay
const usedNonces = new Map<string, number>(); // nonce -> expiryMs
export function rememberNonce(nonce: string, ttlMs: number) {
  usedNonces.set(nonce, Date.now() + ttlMs);
}
export function isNonceUsed(nonce: string) {
  const exp = usedNonces.get(nonce);
  if (!exp) return false;
  if (Date.now() > exp) {
    usedNonces.delete(nonce);
    return false;
  }
  return true;
}

// multi-ad session progress: sessionNonce -> { stagesDone, linkId, expiry }
const adSessions = new Map<string, { stagesDone: Set<number>; linkId: string; expiryMs: number }>();
export function getOrCreateAdSession(sessionNonce: string, linkId: string, ttlMs: number) {
  const now = Date.now();
  let s = adSessions.get(sessionNonce);
  if (!s || s.expiryMs < now) {
    s = { stagesDone: new Set<number>(), linkId, expiryMs: now + ttlMs };
    adSessions.set(sessionNonce, s);
  }
  return s;
}
export function clearAdSession(sessionNonce: string) {
  adSessions.delete(sessionNonce);
}


