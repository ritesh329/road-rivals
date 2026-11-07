import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { computeDamageEffects, estimatePerformance, getCityLayout } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { earn, isUniqueViolation } from "../services/wallet";
import { awardXp } from "../services/progress";
import { recordEvents } from "../services/missions";
import { healthOf, loadOwned, physicsOf } from "../services/vehicles";

export const rewardsRouter = Router();
rewardsRouter.use(requireAuth);

export const LAP_REWARD = { coins: 120, xp: 40, dailyCap: 30, realTimeFactor: 0.85 } as const;

/** Straight-line length of the checkpoint loop – a hard lower bound on the real distance driven. */
export function circuitLengthM() {
  const cps = getCityLayout().checkpoints;
  let len = 0;
  for (let i = 0; i < cps.length; i++) { const a = cps[i], b = cps[(i + 1) % cps.length]; len += Math.hypot(a.x - b.x, a.z - b.z); }
  return len;
}

/**
 * Minimal earn loop for the free-roam checkpoint circuit (full economy arrives in Phase 6).
 * Anti-abuse that works without a server simulation: (1) the lap can't be faster than this exact
 * car could physically cover the loop, (2) laps can't be claimed faster than real time passes,
 * (3) a daily cap. Authoritative race validation comes in Phase 5.
 */
rewardsRouter.post("/lap", wrap(async (req, res) => {
  const body = z.object({ ownershipId: z.string().min(1).max(64), lapMs: z.number().int().min(1000).max(3_600_000) }).parse(req.body);
  const userId = (req as AuthedRequest).userId;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  try {
    const out = await prisma.$transaction(async (tx) => {
      const own = await loadOwned(tx, userId, body.ownershipId);
      const top = estimatePerformance(physicsOf(own), computeDamageEffects(healthOf(own))).topSpeedKmh / 3.6;
      const minLapMs = (circuitLengthM() / (top * 1.15)) * 1000 * 0.9; // generous: ramps/nitro/slipstream-free
      if (body.lapMs < minLapMs) throw new HttpError(422, "Lap time is not physically possible for this car", { minLapMs: Math.round(minLapMs) });

      const last = await tx.transaction.findFirst({ where: { userId, idempotencyKey: { startsWith: `lap:${userId}:` } }, orderBy: { createdAt: "desc" } });
      if (last && Date.now() - last.createdAt.getTime() < body.lapMs * LAP_REWARD.realTimeFactor)
        throw new HttpError(429, "Lap claimed faster than real time");

      const count = await tx.transaction.count({ where: { userId, idempotencyKey: { startsWith: `lap:${userId}:${day}:` } } });
      if (count >= LAP_REWARD.dailyCap) throw new HttpError(429, "Daily lap reward limit reached");

      const coins = await earn(tx, userId, LAP_REWARD.coins, "RACE_REWARD", `lap:${userId}:${day}:${count + 1}`,
        { kind: "lap", lapMs: body.lapMs, ownershipId: own.id } as Prisma.InputJsonValue);
      const progress = await awardXp(tx, userId, LAP_REWARD.xp);
      await recordEvents(tx, userId, [{ event: "LAP", amount: 1 }]);
      return { ok: true, coinsAwarded: LAP_REWARD.coins, xpAwarded: LAP_REWARD.xp, coins, ...progress, lapsToday: count + 1 };
    });
    res.json(out);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(429, "Duplicate lap claim");
    throw e;
  }
}));
