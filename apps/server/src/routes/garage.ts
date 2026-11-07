import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  EMERGENCY_COOLDOWN_MS, GARAGE_CAPS, HOME_CAPS, PARTS_BY_SLUG, SERVICE_BY_CODE, canInstall, customizeSchema, emergencyAllowed,
  normalizeConfig, quoteCustomization, quoteRepair, type GarageKindKey,
} from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { spend } from "../services/wallet";
import { idempotent } from "../services/idempotent";
import { ensureDamageRows, healthOf, loadOwned, serializeVehicle, writeHealth } from "../services/vehicles";
import { garageFields, resolveContext } from "../services/garageContext";

export const garageRouter = Router();
garageRouter.use(requireAuth);
garageRouter.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" }));

const uid = (req: unknown) => (req as AuthedRequest).userId;
const requestId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const ownershipId = z.string().min(1).max(64);

/* ------------------------------------------------------------------ reads */

garageRouter.get("/overview", wrap(async (req, res) => {
  const userId = uid(req);
  const [wallet, profile, owned, garages] = await Promise.all([
    prisma.playerWallet.findUnique({ where: { userId } }),
    prisma.playerProfile.findUnique({ where: { userId } }),
    prisma.vehicleOwnership.findMany({ where: { userId }, include: { vehicle: true, configuration: true, damage: true, upgrades: { include: { part: true } } } }),
    prisma.garage.findMany({ include: { services: true } }),
  ]);
  if (!wallet || !profile) throw new HttpError(404, "Profile not found");
  res.json({
    coins: wallet.coins, level: profile.level, activeOwnershipId: profile.activeOwnershipId,
    vehicles: owned.map((o) => serializeVehicle(o, profile.activeOwnershipId)),
    garages: garages.map((g) => ({
      slug: g.slug, name: g.name, kind: g.kind, x: g.x, z: g.z,
      caps: GARAGE_CAPS[g.kind as GarageKindKey],
      services: g.services.map((s) => ({ code: s.code, name: s.name, basePrice: s.basePrice })),
    })),
    home: { caps: HOME_CAPS },
  });
}));

garageRouter.get("/parts", wrap(async (req, res) => {
  const userId = uid(req);
  const [parts, inv] = await Promise.all([
    prisma.vehiclePart.findMany({ orderBy: [{ type: "asc" }, { tier: "asc" }] }),
    prisma.playerInventory.findMany({ where: { userId } }),
  ]);
  const qty = new Map(inv.map((i) => [i.partId, i.quantity]));
  res.json({
    parts: parts.map((p) => ({
      slug: p.slug, type: p.type, tier: p.tier, name: p.name, price: p.price, requiredLevel: p.requiredLevel,
      physicsModifiers: p.physicsModifiers, compatibleCategories: p.compatibleCategories,
      blurb: PARTS_BY_SLUG[p.slug]?.blurb ?? "", owned: qty.get(p.id) ?? 0,
    })),
  });
}));

/* ----------------------------------------------------------- active vehicle */

garageRouter.post("/active", wrap(async (req, res) => {
  const { ownershipId: id } = z.object({ ownershipId }).parse(req.body);
  const userId = uid(req);
  await loadOwned(prisma, userId, id);
  await prisma.playerProfile.update({ where: { userId }, data: { activeOwnershipId: id } });
  res.json({ ok: true, activeOwnershipId: id });
}));

/* ------------------------------------------------------------------ repair */

const repairBody = z.object({
  ownershipId, service: z.string().min(1).max(24), expectedCost: z.number().int().min(0).optional(), requestId, ...garageFields,
});

garageRouter.post("/repair", wrap(async (req, res) => {
  const body = repairBody.parse(req.body);
  const userId = uid(req);
  const emergency = body.service === "EMERGENCY";
  const key = emergency ? `emergency:${body.ownershipId}:${body.requestId}` : `repair:${userId}:${body.requestId}`;

  const out = await idempotent(key, () => prisma.$transaction(async (tx) => {
    const ctx = await resolveContext(tx, body, "repair");
    if (!SERVICE_BY_CODE[body.service]) throw new HttpError(400, "Unknown service");
    if (!ctx.caps.repairs.includes(body.service)) throw new HttpError(403, "This garage does not offer that service");

    const own = await loadOwned(tx, userId, body.ownershipId);
    await ensureDamageRows(tx, own);
    const health = healthOf(own);
    const priceFor = async (code: string) => {
      if (!ctx.garage) return undefined; // home: shared base price
      const row = await tx.garageService.findUnique({ where: { garageId_code: { garageId: ctx.garage.id, code } } });
      return row?.basePrice;
    };
    const opts = { vehiclePrice: own.vehicle.price, home: ctx.home };
    const quote = quoteRepair(body.service, health, { ...opts, basePrice: await priceFor(body.service) });
    if (!quote) throw new HttpError(400, "Unknown service");
    if (!quote.needed) throw new HttpError(409, "Nothing to repair for that service");

    if (emergency) {
      const wallet = await tx.playerWallet.findUnique({ where: { userId } });
      const full = quoteRepair("FULL", health, { ...opts, basePrice: await priceFor("FULL") });
      if (!wallet || !emergencyAllowed(wallet.coins, full?.cost ?? 0))
        throw new HttpError(403, "Emergency patch is only for drivers who cannot afford a full repair");
      const last = await tx.transaction.findFirst({ where: { userId, idempotencyKey: { startsWith: `emergency:${body.ownershipId}:` } }, orderBy: { createdAt: "desc" } });
      if (last && Date.now() - last.createdAt.getTime() < EMERGENCY_COOLDOWN_MS) {
        const wait = Math.ceil((EMERGENCY_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
        throw new HttpError(429, `Emergency patch available again in ${wait}s`, { retryAfterS: wait });
      }
    }
    if (body.expectedCost !== undefined && body.expectedCost !== quote.cost)
      throw new HttpError(409, "The price changed – please review and confirm again", { code: "PRICE_CHANGED", cost: quote.cost });

    const coins = await spend(tx, userId, quote.cost, "REPAIR", key, {
      service: body.service, ownershipId: own.id, garage: ctx.garage?.slug ?? "home", components: quote.changes.map((c) => c.component),
    } as Prisma.InputJsonValue);
    await writeHealth(tx, own, quote.after);
    return { ok: true, cost: quote.cost, coins, damage: quote.after };
  }), async () => {
    const own = await loadOwned(prisma, userId, body.ownershipId);
    const w = await prisma.playerWallet.findUnique({ where: { userId } });
    return { ok: true, replayed: true, cost: 0, coins: w?.coins ?? 0, damage: healthOf(own) };
  });
  res.json(out);
}));

/* ------------------------------------------------------------------- parts */

type Tx = Prisma.TransactionClient;

async function installFromInventory(tx: Tx, userId: string, ownId: string, slug: string) {
  const own = await loadOwned(tx, userId, ownId);
  const part = await tx.vehiclePart.findUnique({ where: { slug } });
  if (!part) throw new HttpError(404, "Part not found");
  const profile = await tx.playerProfile.findUnique({ where: { userId } });
  const chk = canInstall(part, own.vehicle.category, profile?.level ?? 1);
  if (!chk.ok) throw new HttpError(403, chk.message, { code: chk.code });
  const current = own.upgrades.find((u) => u.slot === part.type);
  if (current?.partId === part.id) throw new HttpError(409, "That part is already installed");

  if (part.price > 0) {
    // atomic take-one-from-inventory (cannot go negative even with parallel requests)
    const taken = await tx.playerInventory.updateMany({ where: { userId, partId: part.id, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
    if (taken.count !== 1) throw new HttpError(409, "You don't own that part – buy it first");
  }
  if (current && current.part.price > 0) {
    await tx.playerInventory.upsert({
      where: { userId_partId: { userId, partId: current.partId } },
      update: { quantity: { increment: 1 } }, create: { userId, partId: current.partId, quantity: 1 },
    });
  }
  await tx.vehicleUpgrade.upsert({
    where: { ownershipId_slot: { ownershipId: own.id, slot: part.type } },
    update: { partId: part.id, installedAt: new Date() }, create: { ownershipId: own.id, partId: part.id, slot: part.type },
  });
  return { part, replaced: current?.part.slug ?? null };
}

const buyBody = z.object({ partSlug: z.string().min(1).max(64), install: z.boolean().optional(), ownershipId: ownershipId.optional(), requestId, ...garageFields });

garageRouter.post("/parts/buy", wrap(async (req, res) => {
  const body = buyBody.parse(req.body);
  const userId = uid(req);
  if (body.install && !body.ownershipId) throw new HttpError(400, "ownershipId required to install");
  const key = `part:${userId}:${body.requestId}`;
  const out = await idempotent(key, () => prisma.$transaction(async (tx) => {
    await resolveContext(tx, body, "parts");
    const part = await tx.vehiclePart.findUnique({ where: { slug: body.partSlug } });
    if (!part) throw new HttpError(404, "Part not found");
    const profile = await tx.playerProfile.findUnique({ where: { userId } });
    if ((profile?.level ?? 1) < part.requiredLevel) throw new HttpError(403, `${part.name} needs level ${part.requiredLevel}`, { code: "LEVEL" });
    if (body.ownershipId) {
      const own = await loadOwned(tx, userId, body.ownershipId);
      const chk = canInstall(part, own.vehicle.category, profile?.level ?? 1);
      if (!chk.ok) throw new HttpError(403, chk.message, { code: chk.code });
    }
    // price always comes from the database row – the client cannot influence it
    const coins = await spend(tx, userId, part.price, "PURCHASE_PART", key, { part: part.slug, price: part.price } as Prisma.InputJsonValue);
    await tx.playerInventory.upsert({
      where: { userId_partId: { userId, partId: part.id } },
      update: { quantity: { increment: 1 } }, create: { userId, partId: part.id, quantity: 1 },
    });
    let installed: string | null = null;
    if (body.install && body.ownershipId) { await installFromInventory(tx, userId, body.ownershipId, part.slug); installed = part.slug; }
    return { ok: true, coins, price: part.price, installed };
  }), async () => {
    const w = await prisma.playerWallet.findUnique({ where: { userId } });
    return { ok: true, replayed: true, coins: w?.coins ?? 0, price: 0, installed: null };
  });
  res.json(out);
}));

const installBody = z.object({ ownershipId, partSlug: z.string().min(1).max(64), ...garageFields });
garageRouter.post("/parts/install", wrap(async (req, res) => {
  const body = installBody.parse(req.body);
  const userId = uid(req);
  const out = await prisma.$transaction(async (tx) => {
    await resolveContext(tx, body, "parts");
    return installFromInventory(tx, userId, body.ownershipId, body.partSlug);
  });
  res.json({ ok: true, installed: out.part.slug, replaced: out.replaced });
}));

const uninstallBody = z.object({ ownershipId, slot: z.string().min(1).max(24), ...garageFields });
garageRouter.post("/parts/uninstall", wrap(async (req, res) => {
  const body = uninstallBody.parse(req.body);
  const userId = uid(req);
  await prisma.$transaction(async (tx) => {
    await resolveContext(tx, body, "parts");
    const own = await loadOwned(tx, userId, body.ownershipId);
    const cur = own.upgrades.find((u) => u.slot === body.slot);
    if (!cur) throw new HttpError(404, "Nothing installed in that slot");
    if (cur.part.price > 0)
      await tx.playerInventory.upsert({
        where: { userId_partId: { userId, partId: cur.partId } },
        update: { quantity: { increment: 1 } }, create: { userId, partId: cur.partId, quantity: 1 },
      });
    await tx.vehicleUpgrade.delete({ where: { ownershipId_slot: { ownershipId: own.id, slot: cur.slot } } });
  });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ customization */

const customizeBody = z.object({ ownershipId, changes: customizeSchema, expectedCost: z.number().int().min(0).optional(), requestId, ...garageFields });

garageRouter.post("/customize", wrap(async (req, res) => {
  const body = customizeBody.parse(req.body);
  const userId = uid(req);
  const key = `custom:${userId}:${body.requestId}`;
  const out = await idempotent(key, () => prisma.$transaction(async (tx) => {
    await resolveContext(tx, body, "customize");
    const own = await loadOwned(tx, userId, body.ownershipId);
    const quote = quoteCustomization(own.configuration as unknown as Record<string, string | null> | null, body.changes);
    if (quote.items.length === 0) throw new HttpError(409, "No changes to apply");
    if (body.expectedCost !== undefined && body.expectedCost !== quote.cost)
      throw new HttpError(409, "The price changed – please review and confirm again", { code: "PRICE_CHANGED", cost: quote.cost });
    const coins = await spend(tx, userId, quote.cost, "CUSTOMIZATION", key, { ownershipId: own.id, items: quote.items.map((i) => ({ key: i.key, to: i.to, price: i.price })) } as Prisma.InputJsonValue);
    const n = quote.next;
    await tx.vehicleConfiguration.upsert({
      where: { ownershipId: own.id },
      update: { ...n }, create: { ownershipId: own.id, ...n },
    });
    return { ok: true, cost: quote.cost, coins, config: n };
  }), async () => {
    const own = await loadOwned(prisma, userId, body.ownershipId);
    const w = await prisma.playerWallet.findUnique({ where: { userId } });
    return { ok: true, replayed: true, cost: 0, coins: w?.coins ?? 0, config: normalizeConfig(own.configuration as unknown as Record<string, string | null> | null) };
  });
  res.json(out);
}));
