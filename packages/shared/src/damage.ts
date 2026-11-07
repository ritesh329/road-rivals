/**
 * ROAD RIVALS – collision damage model (pure TypeScript).
 *
 * Client: `ImpactDetector` watches the chassis velocity change every physics step and
 * emits an `Impact` (magnitude + direction in the car's local frame) when a collision happens.
 * Both client (live effect) and server (authoritative, persisted) fold impacts into component
 * health with the SAME `applyImpacts`, so they always agree. Armour (`durability`) is looked up
 * on the server from the installed parts – the client's multiplier is never trusted.
 *
 * Health values are 0..100 per DamageComponent. `computeDamageEffects` (vehicle.ts) turns the
 * health into real physics penalties (power, grip, braking, suspension, gearbox, cooling).
 */
import { z } from "zod";
import { DAMAGE_COMPONENTS, G, type DamageComponentKey } from "./vehicle";

export type HealthMap = Record<DamageComponentKey, number>;

export const fullHealth = (): HealthMap =>
  Object.fromEntries(DAMAGE_COMPONENTS.map((c) => [c, 100])) as HealthMap;

export function normalizeHealth(h: Partial<Record<string, number>> = {}): HealthMap {
  const out = fullHealth();
  for (const c of DAMAGE_COMPONENTS) {
    const v = h[c];
    if (typeof v === "number" && Number.isFinite(v)) out[c] = Math.min(100, Math.max(0, v));
  }
  return out;
}

/** Collision in the car's local frame. +z = forward, +x = right-hand side (FL wheel sits at -x, see RaycastVehicle). */
export interface Impact {
  /** Magnitude of the velocity change in m/s. */
  mag: number;
  /** Direction of the velocity change applied to the car, local frame (need not be unit-length). */
  lx: number; ly: number; lz: number;
}

export const IMPACT_LIMITS = {
  /** per-step |Δv| (m/s) above which a collision window opens (hard driving never exceeds ~0.3) */
  startDv: 0.45,
  /** collisions below this total Δv (m/s ≈ 9 km/h) are scrapes and ignored */
  minMag: 2.5,
  /** maximum plausible magnitude accepted from clients (m/s) */
  absoluteMax: 160,
  maxPerReport: 40,
} as const;

type Zone = "front" | "rear" | "side" | "vert";
const ZONE_COEFF: Record<Zone, Partial<Record<DamageComponentKey, number>>> = {
  front: { FRONT_BUMPER: 1.0, RADIATOR: 0.55, ENGINE: 0.3, SUSPENSION: 0.2, WHEELS: 0.12, BRAKES: 0.08 },
  rear: { REAR_BUMPER: 1.0, TRANSMISSION: 0.35, SUSPENSION: 0.15, BRAKES: 0.05 },
  side: { DOORS: 1.0, WHEELS: 0.3, SUSPENSION: 0.3, TYRES: 0.2 },
  vert: { SUSPENSION: 0.9, TYRES: 0.35, WHEELS: 0.3, BRAKES: 0.12 },
};
/** Internals only start taking damage once the hit is hard enough (base health points). */
const THRESHOLD: Partial<Record<DamageComponentKey, number>> = { ENGINE: 12, TRANSMISSION: 12, BRAKES: 10, RADIATOR: 4 };

/** Health points lost per component for one impact. `durability` < 1 = armoured. */
export function impactDamage(imp: Impact, durability = 1): Partial<HealthMap> {
  const n = Math.hypot(imp.lx, imp.ly, imp.lz) || 1;
  const ux = imp.lx / n, uy = imp.ly / n, uz = imp.lz / n;
  const w: Record<Zone, number> = {
    front: uz < 0 ? -uz : 0,
    rear: uz > 0 ? uz : 0,
    side: Math.abs(ux),
    vert: Math.abs(uy),
  };
  const base = Math.pow(Math.max(0, imp.mag - 2), 1.3) * 1.7 * Math.max(0, durability);
  const out: Partial<HealthMap> = {};
  for (const zone of Object.keys(w) as Zone[]) {
    if (w[zone] <= 0) continue;
    for (const [comp, k] of Object.entries(ZONE_COEFF[zone]) as [DamageComponentKey, number][]) {
      const eff = Math.max(0, base - (THRESHOLD[comp] ?? 0));
      if (eff <= 0) continue;
      out[comp] = (out[comp] ?? 0) + eff * k * w[zone];
    }
  }
  return out;
}

/** Fold impacts into a health map (pure; returns a new object). */
export function applyImpacts(health: Partial<Record<string, number>>, impacts: Impact[], durability = 1): HealthMap {
  const h = normalizeHealth(health);
  for (const imp of impacts) {
    const d = impactDamage(imp, durability);
    for (const c of DAMAGE_COMPONENTS) if (d[c]) h[c] = Math.max(0, h[c] - d[c]!);
  }
  return h;
}

export const overallCondition = (h: Partial<Record<string, number>>) => {
  const n = normalizeHealth(h);
  return DAMAGE_COMPONENTS.reduce((s, c) => s + n[c], 0) / DAMAGE_COMPONENTS.length;
};

/* ---------------------------------------------------------------- detector */

interface V3 { x: number; y: number; z: number }
interface Q4 { x: number; y: number; z: number; w: number }

/** Rotate world vector into the local frame of quaternion q (i.e. apply q⁻¹). */
export function worldToLocal(v: V3, q: Q4): V3 {
  // q* (conjugate) applied to v
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}

/**
 * Collision detector. Feed it the chassis velocity + orientation after every fixed physics step.
 * Gravity is subtracted so free-fall isn't a "collision"; normal driving (≤ ~1.5 g) stays under
 * `startDv` per step at 60 Hz. A collision window stays open until two quiet steps, then yields
 * one `Impact` with the summed velocity change.
 */
export class ImpactDetector {
  private prev: V3 | null = null;
  private acc: V3 = { x: 0, y: 0, z: 0 };
  private open = false;
  private quiet = 0;
  private t = 0;

  /** Call after teleports / respawns / body rebuilds so the jump isn't read as a crash. */
  reset(velocity?: V3) {
    this.prev = velocity ? { ...velocity } : null;
    this.acc = { x: 0, y: 0, z: 0 }; this.open = false; this.quiet = 0; this.t = 0;
  }

  step(vel: V3, rot: Q4, dt: number): Impact | null {
    if (!this.prev) { this.prev = { ...vel }; return null; }
    // world-frame change, gravity removed
    const dw = { x: vel.x - this.prev.x, y: vel.y - this.prev.y + G * dt, z: vel.z - this.prev.z };
    this.prev = { ...vel };
    const m = Math.hypot(dw.x, dw.y, dw.z);
    const dl = worldToLocal(dw, rot);

    if (m > IMPACT_LIMITS.startDv) {
      this.open = true; this.quiet = 0;
      this.acc.x += dl.x; this.acc.y += dl.y; this.acc.z += dl.z;
    } else if (this.open) {
      this.quiet++;
    }
    if (this.open) this.t += dt;
    if (this.open && (this.quiet >= 2 || this.t >= 0.25)) return this.finish();
    return null;
  }

  private finish(): Impact | null {
    const a = this.acc;
    const mag = Math.hypot(a.x, a.y, a.z);
    this.acc = { x: 0, y: 0, z: 0 }; this.open = false; this.quiet = 0; this.t = 0;
    if (mag < IMPACT_LIMITS.minMag) return null;
    return { mag, lx: a.x / mag, ly: a.y / mag, lz: a.z / mag };
  }
}

/* ------------------------------------------------------- report validation */

export const impactSchema = z.object({
  mag: z.number().finite().min(IMPACT_LIMITS.minMag).max(IMPACT_LIMITS.absoluteMax),
  lx: z.number().finite().min(-1.5).max(1.5),
  ly: z.number().finite().min(-1.5).max(1.5),
  lz: z.number().finite().min(-1.5).max(1.5),
});

export const damageReportSchema = z.object({
  ownershipId: z.string().min(1).max(64),
  impacts: z.array(impactSchema).min(1).max(IMPACT_LIMITS.maxPerReport),
});
export type DamageReport = z.infer<typeof damageReportSchema>;

/** Largest believable impact for a car: head-on with another car at top speed (2x) plus margin. */
export const maxPlausibleImpact = (topSpeedKmh: number) => Math.min(IMPACT_LIMITS.absoluteMax, (topSpeedKmh / 3.6) * 2 + 10);
