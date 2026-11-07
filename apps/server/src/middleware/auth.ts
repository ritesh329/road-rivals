import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../utils/config";

export const COOKIE_NAME = "rr_token";
export type AuthedRequest = Request & { userId: string };

export const signToken = (userId: string) => jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" });
export const verifyToken = (token: string): string | null => {
  try { return (jwt.verify(token, config.jwtSecret) as { sub: string }).sub; } catch { return null; }
};
export const cookieOptions = {
  httpOnly: true, sameSite: "lax" as const, secure: config.isProd, maxAge: 7 * 24 * 3600 * 1000, path: "/",
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  const userId = token ? verifyToken(token) : null;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  (req as AuthedRequest).userId = userId;
  next();
}
