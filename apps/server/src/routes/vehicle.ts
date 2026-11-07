import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  IMPACT_LIMITS, applyImpacts, damageReportSchema, estimatePerformance, maxPlausibleImpact, computeDamageEffects,
} from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { ensureDamageRows, healthOf, loadOwned, physicsOf, writeHealth } from "../services/vehicles";

export const vehicleRouter = Router();
vehicleRouter.use(requireAuth);
vehicleRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" }));

const MIN_REPORT_INTERVAL_MS = 1000;
const lastReport = new Map<string, number>();
export const resetDamageThrottle = () => lastReport.clear();

/**
 * Client sends the collisions it detected; the SERVER recomputes damage with the shared model and
 * the armour of the parts it has on record – the client never sends health values, and damage can
 * only go down through this endpoint (repairs happen exclusively in the paid /garage/repair flow).
 * Until the authoritative simulation exists (Phase 5) a modified client could still omit impacts;
 * that only ever hurts the cheater's own car.
 */
vehicleRouter.post("/damage", wrap(async (req, res) => {
  const body = damageReportSchema.parse(req.body);
  const userId = (req as AuthedRequest).userId;
  const now = Date.now();
  if (now - (lastReport.get(userId) ?? 0) < MIN_REPORT_INTERVAL_MS) throw new HttpError(429, "Damage reports too frequent");
  lastReport.set(userId, now);

  const result = await prisma.$transaction(async (tx) => {
    const own = await loadOwned(tx, userId, body.ownershipId);
    await ensureDamageRows(tx, own);
    const params = physicsOf(own);
    const maxMag = maxPlausibleImpact(estimatePerformance(params, computeDamageEffects(healthOf(own))).topSpeedKmh);
    const impacts = body.impacts.slice(0, IMPACT_LIMITS.maxPerReport).map((i) => ({ ...i, mag: Math.min(i.mag, maxMag) }));
    const next = applyImpacts(healthOf(own), impacts, params.durability);
    await writeHealth(tx, own, next);
    return { damage: next, applied: impacts.length };
  });
  res.json({ ok: true, ...result });
}));
