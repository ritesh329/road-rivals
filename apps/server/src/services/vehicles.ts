import type { Prisma } from "@prisma/client";
import {
  DAMAGE_COMPONENTS, buildPhysicsParams, normalizeConfig, normalizeHealth,
  type BaseStats, type HealthMap, type InstalledPart,
} from "@road-rivals/shared";
import { HttpError } from "../utils/errors";

type Db = Prisma.TransactionClient;

const OWNED_INCLUDE = { vehicle: true, configuration: true, damage: true, upgrades: { include: { part: true } } } as const;
export type OwnedVehicle = Prisma.VehicleOwnershipGetPayload<{ include: typeof OWNED_INCLUDE }>;

/** Loads a vehicle the player owns (404 for anyone else's – never leaks existence). */
export async function loadOwned(db: Db, userId: string, ownershipId: string): Promise<OwnedVehicle> {
  const own = await db.vehicleOwnership.findUnique({ where: { id: ownershipId }, include: OWNED_INCLUDE });
  if (!own || own.userId !== userId) throw new HttpError(404, "Vehicle not found");
  return own;
}

export const healthOf = (own: OwnedVehicle): HealthMap =>
  normalizeHealth(Object.fromEntries(own.damage.map((d) => [d.component, d.health])));

export const partsOf = (own: OwnedVehicle): InstalledPart[] =>
  own.upgrades.map((u) => ({ type: u.slot, physicsModifiers: u.part.physicsModifiers as Record<string, number> }));

export const physicsOf = (own: OwnedVehicle) =>
  buildPhysicsParams(own.vehicle.baseStats as unknown as Partial<BaseStats>, partsOf(own), own.vehicle.category);

/** Older accounts / future purchases may lack a damage row – create whatever is missing (100 %). */
export async function ensureDamageRows(db: Db, own: OwnedVehicle) {
  const have = new Set(own.damage.map((d) => d.component));
  for (const component of DAMAGE_COMPONENTS)
    if (!have.has(component)) await db.vehicleDamage.create({ data: { ownershipId: own.id, component, health: 100 } });
}

export async function writeHealth(db: Db, own: OwnedVehicle, next: HealthMap) {
  const cur = healthOf(own);
  for (const c of DAMAGE_COMPONENTS) {
    if (Math.abs(next[c] - cur[c]) < 1e-9) continue;
    await db.vehicleDamage.upsert({
      where: { ownershipId_component: { ownershipId: own.id, component: c } },
      update: { health: next[c] },
      create: { ownershipId: own.id, component: c, health: next[c] },
    });
  }
}

export function serializeVehicle(own: OwnedVehicle, activeId: string | null) {
  return {
    ownershipId: own.id, vehicleId: own.vehicleId, slug: own.vehicle.slug, name: own.vehicle.name,
    category: own.vehicle.category, price: own.vehicle.price, baseStats: own.vehicle.baseStats,
    active: own.id === activeId,
    config: normalizeConfig(own.configuration as unknown as Record<string, string | null> | null),
    upgrades: own.upgrades.map((u) => ({
      slot: u.slot, partSlug: u.part.slug, name: u.part.name, tier: u.part.tier,
      physicsModifiers: u.part.physicsModifiers as Record<string, number>,
    })),
    damage: healthOf(own),
  };
}
