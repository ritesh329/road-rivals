import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { registerSchema, loginSchema, STARTING_COINS } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { COOKIE_NAME, cookieOptions, signToken, requireAuth, type AuthedRequest } from "../middleware/auth";

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const COMPONENTS = ["ENGINE","FRONT_BUMPER","REAR_BUMPER","DOORS","WHEELS","TYRES","SUSPENSION","BRAKES","RADIATOR","TRANSMISSION"] as const;

authRouter.post("/register", limiter, wrap(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, username, password } = parsed.data;

  const exists = await prisma.user.findFirst({ where: { OR: [{ email: email.toLowerCase() }, { username }] } });
  if (exists) return res.status(409).json({ error: "Email or username already taken" });

  const starter = await prisma.vehicle.findUnique({ where: { slug: "starter-hatch" } });
  if (!starter) return res.status(500).json({ error: "Database not seeded. Run: npm run db:seed" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: email.toLowerCase(), username, passwordHash } });
    const own = await tx.vehicleOwnership.create({ data: {
      userId: u.id, vehicleId: starter.id,
      configuration: { create: {} },
      damage: { create: COMPONENTS.map((component) => ({ component })) },
    } });
    await tx.playerProfile.create({ data: { userId: u.id, activeOwnershipId: own.id } });
    await tx.playerWallet.create({ data: { userId: u.id, coins: STARTING_COINS } });
    await tx.transaction.create({ data: { userId: u.id, type: "SIGNUP_BONUS", amount: STARTING_COINS,
      balanceAfter: STARTING_COINS, idempotencyKey: `signup:${u.id}` } });
    return u;
  });

  res.cookie(COOKIE_NAME, signToken(user.id), cookieOptions);
  res.status(201).json({ id: user.id, username: user.username });
}));

authRouter.post("/login", limiter, wrap(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  const ok = user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!user || !ok) return res.status(401).json({ error: "Invalid email or password" });
  res.cookie(COOKIE_NAME, signToken(user.id), cookieOptions);
  res.json({ id: user.id, username: user.username });
}));

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

/** Cross-origin Socket.IO (web and API on different hosts) can't see the httpOnly cookie, so hand the logged-in user a fresh token to pass as socket auth. */
authRouter.get("/socket-token", requireAuth, (req, res) => {
  res.json({ token: signToken((req as AuthedRequest).userId) });
});
