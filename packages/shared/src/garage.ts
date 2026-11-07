/**
 * ROAD RIVALS – garage rules shared by the server (authoritative) and the UI (previews).
 *
 * - repair services, what each one fixes and how it is priced
 * - which garage kinds offer which features
 * - proximity check used when a request comes from the 3D world
 */
import { DAMAGE_COMPONENTS, type DamageComponentKey } from "./vehicle";
import { normalizeHealth, type HealthMap } from "./damage";

export type GarageKindKey = "REPAIR" | "ENGINE_SHOP" | "WORKSHOP" | "FUEL";

export interface RepairService {
  code: string; name: string; description: string; basePrice: number;
  components: DamageComponentKey[];
  /** EMERGENCY only lifts components to this health instead of 100, for free. */
  floor?: number;
}

const BODY: DamageComponentKey[] = ["FRONT_BUMPER", "REAR_BUMPER", "DOORS"];
const INTERNALS: DamageComponentKey[] = ["ENGINE", "RADIATOR", "TRANSMISSION"];

export const REPAIR_SERVICES: RepairService[] = [
  { code: "MINOR", name: "Minor Repair", description: "Bumpers and door panels", basePrice: 500, components: BODY },
  { code: "MEDIUM", name: "Medium Repair", description: "Body panels, suspension, brakes and wheels", basePrice: 1500, components: [...BODY, "SUSPENSION", "BRAKES", "WHEELS"] },
  { code: "ENGINE", name: "Engine Repair", description: "Engine, radiator and transmission", basePrice: 3000, components: INTERNALS },
  { code: "TYRES", name: "Tyre Replacement", description: "Tyres and wheels", basePrice: 2000, components: ["TYRES", "WHEELS"] },
  { code: "FULL", name: "Full Repair", description: "Everything restored to factory condition", basePrice: 5000, components: [...DAMAGE_COMPONENTS] },
  { code: "EMERGENCY", name: "Emergency Patch", description: "Free roadside fix: mechanicals back to 35% – only when you cannot afford a full repair", basePrice: 0,
    components: ["ENGINE", "RADIATOR", "TRANSMISSION", "SUSPENSION", "BRAKES", "TYRES", "WHEELS"], floor: 35 },
];
export const SERVICE_BY_CODE: Record<string, RepairService> = Object.fromEntries(REPAIR_SERVICES.map((s) => [s.code, s]));
export const HOME_REPAIR_MULT = 1.5;
export const EMERGENCY_COOLDOWN_MS = 10 * 60 * 1000;

export interface GarageCaps { repairs: string[]; parts: boolean; customize: boolean }
const ALL_REPAIRS = REPAIR_SERVICES.map((s) => s.code);
/** What each kind of garage offers in the open world. "Home" (the /garage page) offers everything at a repair premium. */
export const GARAGE_CAPS: Record<GarageKindKey, GarageCaps> = {
  REPAIR: { repairs: ALL_REPAIRS, parts: false, customize: false },
  ENGINE_SHOP: { repairs: ["ENGINE", "FULL", "EMERGENCY"], parts: true, customize: false },
  WORKSHOP: { repairs: ALL_REPAIRS, parts: true, customize: true },
  FUEL: { repairs: ["MINOR", "TYRES", "EMERGENCY"], parts: false, customize: false },
};
export const HOME_CAPS: GarageCaps = { repairs: ALL_REPAIRS, parts: true, customize: true };

/** Larger / pricier cars cost more to fix. Starter car = 1.0, a 150k supercar = 2.5. */
export const vehicleCostMult = (vehiclePrice: number) => 1 + Math.max(0, vehiclePrice) / 100_000;

export interface RepairChange { component: DamageComponentKey; from: number; to: number }
export interface RepairQuote {
  code: string; cost: number; needed: boolean; missingPct: number;
  changes: RepairChange[]; after: HealthMap;
}

export function quoteRepair(
  code: string, healthIn: Partial<Record<string, number>>,
  opts: { vehiclePrice?: number; home?: boolean; basePrice?: number } = {},
): RepairQuote | null {
  const svc = SERVICE_BY_CODE[code];
  if (!svc) return null;
  const health = normalizeHealth(healthIn);
  const after = { ...health };
  const changes: RepairChange[] = [];
  let missing = 0;
  for (const c of svc.components) {
    const target = svc.floor !== undefined ? Math.max(health[c], svc.floor) : 100;
    missing += (100 - health[c]) / 100;
    if (target > health[c] + 1e-6) { changes.push({ component: c, from: health[c], to: target }); after[c] = target; }
  }
  const needed = changes.length > 0;
  const missingPct = (missing / svc.components.length) * 100;
  const base = opts.basePrice ?? svc.basePrice;
  let cost = 0;
  if (needed && base > 0) {
    cost = Math.round(base * (missingPct / 100) * vehicleCostMult(opts.vehiclePrice ?? 0) * (opts.home ? HOME_REPAIR_MULT : 1));
    cost = Math.max(25, cost);
  }
  return { code, cost, needed, missingPct, changes, after };
}

export const emergencyAllowed = (coins: number, fullRepairCost: number) => fullRepairCost > 0 && coins < fullRepairCost;

export function garageProximityOk(g: { x: number; z: number; radius: number }, pos: { x: number; z: number }, slack = 6) {
  return Math.hypot(g.x - pos.x, g.z - pos.z) <= g.radius + slack;
}
