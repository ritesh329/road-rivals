import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { DAMAGE_COMPONENTS, VEHICLE_CATEGORIES, canBuyVehicle } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { spend } from "../services/wallet";
import { idempotent } from "../services/idempotent";
import { evaluateAchievements } from "../services/achievements";
import { VEHICLES } from "@road-rivals/shared";

/** The showroom works even if `db:seed` was not re-run after an update: missing catalogue cars are inserted on demand. */
async function ensureCatalog() {
  const have = new Set((await prisma.vehicle.findMany({ select: { slug: true } })).map((v) => v.slug));
  for (const v of VEHICLES) if (!have.has(v.slug)) {
    try { await prisma.vehicle.create({ data: { slug: v.slug, name: v.name, category: v.category, requiredLevel: v.requiredLevel, price: v.price, baseStats: v.baseStats as object } }); }
    catch { /* a parallel request inserted it first */ }
  }
}

export const showroomRouter = Router();
showroomRouter.use(requireAuth);
showroomRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" }));
const uid = (req: unknown) => (req as AuthedRequest).userId;

async function view(userId: string) {
  await ensureCatalog();
  const [profile, wallet, vehicles, owned] = await Promise.all([
    prisma.playerProfile.findUnique({ where: { userId } }),
    prisma.playerWallet.findUnique({ where: { userId } }),
    prisma.vehicle.findMany({ orderBy: [{ requiredLevel: "asc" }, { price: "asc" }] }),
    prisma.vehicleOwnership.findMany({ where: { userId } }),
  ]);
  if (!profile || !wallet) throw new HttpError(404, "Profile not found");
  const own = new Map(owned.map((o) => [o.vehicleId, o]));
  return {
    coins: wallet.coins, level: profile.level, categories: VEHICLE_CATEGORIES, activeOwnershipId: profile.activeOwnershipId,
    vehicles: vehicles.map((v) => {
      const o = own.get(v.id);
      const chk = canBuyVehicle({ price: v.price, requiredLevel: v.requiredLevel, name: v.name }, profile.level, wallet.coins, !!o);
      return {
        slug: v.slug, name: v.name, category: v.category, price: v.price, requiredLevel: v.requiredLevel, baseStats: v.baseStats,
        owned: !!o, ownershipId: o?.id ?? null, active: !!o && o.id === profile.activeOwnershipId,
        locked: profile.level < v.requiredLevel, affordable: wallet.coins >= v.price, canBuy: chk.ok, reason: chk.ok ? null : chk.message,
      };
    }),
  };
}

showroomRouter.get("/", wrap(async (req, res) => { res.json(await view(uid(req))); }));

const buyBody = z.object({
  vehicleSlug: z.string().min(1).max(64), requestId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  expectedPrice: z.number().int().min(0).optional(), setActive: z.boolean().optional(),
});

/**
 * Buy a car. Everything that matters is decided here: price and level gate come from the DB row, the
 * coins are taken by a conditional UPDATE (cannot overspend), the ownership is unique per user+car,
 * and a repeated requestId (double click / retry) never charges twice.
 */
showroomRouter.post("/buy", wrap(async (req, res) => {
  const body = buyBody.parse(req.body);
  const userId = uid(req);
  await ensureCatalog();
  const key = `vehicle:${userId}:${body.requestId}`;
  const out = await idempotent(key, () => prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.findUnique({ where: { slug: body.vehicleSlug } });
    if (!v) throw new HttpError(404, "Car not found");
    const profile = await tx.playerProfile.findUnique({ where: { userId } });
    if (!profile) throw new HttpError(404, "Profile not found");
    if (await tx.vehicleOwnership.findUnique({ where: { userId_vehicleId: { userId, vehicleId: v.id } } })) throw new HttpError(409, "You already own this car", { code: "OWNED" });
    if (profile.level < v.requiredLevel) throw new HttpError(403, `Reach level ${v.requiredLevel} to unlock the ${v.name}`, { code: "LEVEL", requiredLevel: v.requiredLevel });
    if (body.expectedPrice !== undefined && body.expectedPrice !== v.price) throw new HttpError(409, "The price changed – please review and confirm again", { code: "PRICE_CHANGED", price: v.price });

    const coins = await spend(tx, userId, v.price, "PURCHASE_VEHICLE", key, { vehicle: v.slug, price: v.price } as Prisma.InputJsonValue);
    const own = await tx.vehicleOwnership.create({
      data: { userId, vehicleId: v.id, configuration: { create: {} }, damage: { create: DAMAGE_COMPONENTS.map((component) => ({ component })) } },
    });
    if (body.setActive) await tx.playerProfile.update({ where: { userId }, data: { activeOwnershipId: own.id } });
    const unlocked = await evaluateAchievements(tx, userId);
    return { ok: true, ownershipId: own.id, coins, active: !!body.setActive, unlocked: unlocked.map((a) => ({ code: a.code, title: a.title, rewardCoins: a.rewardCoins })) };
  }), async () => {
    const w = await prisma.playerWallet.findUnique({ where: { userId } });
    return { ok: true, replayed: true, coins: w?.coins ?? 0 };
  });
  res.json(out);
}));
