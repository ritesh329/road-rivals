import type { PrismaClient } from "@prisma/client";
import { GARAGES, PARTS_CATALOG, REPAIR_SERVICES, VEHICLES } from "@road-rivals/shared";
/** Idempotent catalogue seed (vehicles, parts, garages, repair services). Used by `npm run db:seed` and by the server tests. */
export async function seedCatalog(prisma: PrismaClient) {
  // Cars: single source of truth is packages/shared/src/fleet.ts (price / level gate / stats re-sync on every seed;
  // owned cars, installed parts and damage are untouched).
  for (const v of VEHICLES) {
    const data = { name: v.name, category: v.category, requiredLevel: v.requiredLevel, price: v.price, baseStats: v.baseStats as object };
    await prisma.vehicle.upsert({ where: { slug: v.slug }, update: data, create: { slug: v.slug, ...data } });
  }

  // Parts: single source of truth is packages/shared/src/catalog.ts. Re-running the seed re-syncs
  // prices / modifiers / level gates (existing installed parts and inventory are untouched).
  for (const p of PARTS_CATALOG) {
    const data = {
      type: p.type, tier: p.tier, name: p.name, price: p.price, requiredLevel: p.requiredLevel,
      physicsModifiers: p.physicsModifiers as object, compatibleCategories: p.compatibleCategories,
    };
    await prisma.vehiclePart.upsert({ where: { slug: p.slug }, update: data, create: { slug: p.slug, ...data } });
  }

  // Garage positions come from the shared city layout so DB, map and 3D world always agree.
  const garages = GARAGES.map(({ slug, name, kind, x, y, z }) => ({ slug, name, kind, x, y, z }));
  const services = REPAIR_SERVICES.map((r) => [r.code, r.name, r.basePrice] as const);
  for (const g of garages) {
    const garage = await prisma.garage.upsert({ where: { slug: g.slug }, update: { name: g.name, kind: g.kind, x: g.x, y: g.y, z: g.z }, create: g });
    for (const [code, name, basePrice] of services)
      await prisma.garageService.upsert({ where: { garageId_code: { garageId: garage.id, code } }, update: { name, basePrice }, create: { garageId: garage.id, code, name, basePrice } });
  }
}
