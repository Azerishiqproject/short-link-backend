import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type JwtPayload = { sub: string; role: "user" | "admin" };

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error("Missing JWT_SECRET env");
  }
  return s;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
    const token = header.slice(7);
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as JwtPayload;
    (req as any).user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
    const token = header.slice(7);
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as JwtPayload;
    if (payload.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    (req as any).user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}


