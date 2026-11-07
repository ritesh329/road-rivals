/**
 * ROAD RIVALS – upgrade parts catalogue.
 *
 * Single source of truth: `prisma/seed.ts` writes these rows into VehiclePart, the server
 * validates purchases against the DB rows (which came from here), and the garage UI renders
 * them with live physics previews computed from `physicsModifiers` (see performance.ts).
 * Modifier keys are documented at the top of vehicle.ts. Every part changes real simulation
 * parameters – nothing here is cosmetic.
 */

export const VEHICLE_CATEGORIES = ["HATCHBACK", "SEDAN", "MUSCLE", "SPORTS", "RACING_GT", "SUPERCAR", "HYPERCAR", "OFFROAD"] as const;
export type VehicleCategoryKey = (typeof VEHICLE_CATEGORIES)[number];

export const PART_TYPES = [
  "ENGINE", "TURBO", "TYRES", "BRAKES", "SUSPENSION", "GEARBOX",
  "SPOILER", "ARMOR", "NITRO", "COOLING", "DIFFERENTIAL", "AERO",
] as const;
export type PartTypeKey = (typeof PART_TYPES)[number];

export const PART_TYPE_LABEL: Record<PartTypeKey, string> = {
  ENGINE: "Engine", TURBO: "Turbo", TYRES: "Tyres", BRAKES: "Brakes", SUSPENSION: "Suspension", GEARBOX: "Gearbox",
  SPOILER: "Spoiler", ARMOR: "Armor", NITRO: "Nitro", COOLING: "Cooling", DIFFERENTIAL: "Differential", AERO: "Aero kit",
};

export interface PartDef {
  slug: string;
  type: PartTypeKey;
  tier: number;
  name: string;
  price: number;
  requiredLevel: number;
  physicsModifiers: Record<string, number>;
  compatibleCategories: VehicleCategoryKey[];
  /** One-line player-facing summary of the physical effect. */
  blurb: string;
}

const ALL = [...VEHICLE_CATEGORIES];
const NOT_ECONOMY = ALL.filter((c) => c !== "HATCHBACK" && c !== "SEDAN");

const engine = (slug: string, name: string, tier: number, price: number, hp: number, level: number, cats = ALL, extra: Record<string, number> = {}): PartDef => ({
  slug, type: "ENGINE", tier, name, price, requiredLevel: level,
  physicsModifiers: { peakTorqueNm: hp * 1.6, powerHp: hp, ...extra }, compatibleCategories: cats,
  blurb: `${hp} hp / ${Math.round(hp * 1.6)} Nm – more torque at every rpm`,
});

export const PARTS_CATALOG: PartDef[] = [
  // ---- engines (slugs/torque convention kept from Phase 1; prices rebalanced for the earn loop)
  engine("engine-standard", "Standard 100HP", 1, 0, 100, 1),
  engine("engine-sport", "Sport 180HP", 2, 3500, 180, 1),
  engine("engine-v6t", "V6 Turbo 280HP", 3, 12000, 280, 2),
  engine("engine-v8", "V8 400HP", 4, 30000, 400, 4),
  engine("engine-v10", "V10 550HP", 5, 70000, 550, 7, NOT_ECONOMY),
  engine("engine-hyper", "Hyper 750HP", 6, 160000, 750, 10, NOT_ECONOMY),

  // ---- turbo (boost builds with rpm; lag = spoolRpm)
  { slug: "turbo-mini", type: "TURBO", tier: 1, name: "Mini Turbo", price: 2500, requiredLevel: 1, physicsModifiers: { boostTorqueMult: 1.2, spoolRpm: 3500 }, compatibleCategories: ALL, blurb: "+20% torque once spooled (3500 rpm)" },
  { slug: "turbo-twin", type: "TURBO", tier: 2, name: "Twin-Scroll Turbo", price: 9000, requiredLevel: 3, physicsModifiers: { boostTorqueMult: 1.35, spoolRpm: 3000 }, compatibleCategories: ALL, blurb: "+35% torque, spools earlier" },
  { slug: "turbo-big", type: "TURBO", tier: 3, name: "Big Single Turbo", price: 26000, requiredLevel: 6, physicsModifiers: { boostTorqueMult: 1.55, spoolRpm: 3800 }, compatibleCategories: ALL, blurb: "+55% torque, noticeable lag" },

  // ---- tyres (grip, side stiffness, rear break-away for drifting)
  { slug: "tyres-street", type: "TYRES", tier: 1, name: "Street Grip", price: 900, requiredLevel: 1, physicsModifiers: { frictionMult: 1.08, sideStiffnessMult: 1.05, driftRearMult: 1 }, compatibleCategories: ALL, blurb: "+8% grip" },
  { slug: "tyres-sport", type: "TYRES", tier: 2, name: "Sport Compound", price: 3200, requiredLevel: 1, physicsModifiers: { frictionMult: 1.2, sideStiffnessMult: 1.15, driftRearMult: 1 }, compatibleCategories: ALL, blurb: "+20% grip, sharper turn-in" },
  { slug: "tyres-drift", type: "TYRES", tier: 3, name: "Drift Spec", price: 4500, requiredLevel: 2, physicsModifiers: { frictionMult: 1.05, sideStiffnessMult: 0.95, driftRearMult: 0.8 }, compatibleCategories: ALL, blurb: "Rear lets go earlier on handbrake – easier slides" },
  { slug: "tyres-slick", type: "TYRES", tier: 4, name: "Racing Slick", price: 11000, requiredLevel: 4, physicsModifiers: { frictionMult: 1.38, sideStiffnessMult: 1.3, driftRearMult: 1.1 }, compatibleCategories: ALL, blurb: "+38% grip, hard to break loose" },

  // ---- brakes
  { slug: "brakes-sport", type: "BRAKES", tier: 1, name: "Sport Pads", price: 800, requiredLevel: 1, physicsModifiers: { brakeMult: 1.15 }, compatibleCategories: ALL, blurb: "+15% braking force" },
  { slug: "brakes-perf", type: "BRAKES", tier: 2, name: "Performance Discs", price: 3000, requiredLevel: 1, physicsModifiers: { brakeMult: 1.35 }, compatibleCategories: ALL, blurb: "+35% braking force" },
  { slug: "brakes-carbon", type: "BRAKES", tier: 3, name: "Carbon-Ceramic", price: 12000, requiredLevel: 5, physicsModifiers: { brakeMult: 1.6 }, compatibleCategories: ALL, blurb: "+60% braking force" },

  // ---- suspension (stiffness, damping, ride height)
  { slug: "susp-sport", type: "SUSPENSION", tier: 1, name: "Sport Springs", price: 1000, requiredLevel: 1, physicsModifiers: { stiffnessMult: 1.25, dampingMult: 1.1, rideHeightDelta: -0.03 }, compatibleCategories: ALL, blurb: "Stiffer, 3 cm lower – less roll" },
  { slug: "susp-coil", type: "SUSPENSION", tier: 2, name: "Coilovers", price: 4000, requiredLevel: 2, physicsModifiers: { stiffnessMult: 1.5, dampingMult: 1.3, rideHeightDelta: -0.05 }, compatibleCategories: ALL, blurb: "Much stiffer, 5 cm lower" },
  { slug: "susp-race", type: "SUSPENSION", tier: 3, name: "Race Suspension", price: 14000, requiredLevel: 5, physicsModifiers: { stiffnessMult: 1.8, dampingMult: 1.5, rideHeightDelta: -0.07 }, compatibleCategories: ALL, blurb: "Track setup: minimal roll, 7 cm lower" },

  // ---- gearbox
  { slug: "gear-short", type: "GEARBOX", tier: 1, name: "Short-Throw Box", price: 1500, requiredLevel: 1, physicsModifiers: { accelMult: 1.1, topSpeedMult: 0.97, shiftTimeMult: 0.8 }, compatibleCategories: ALL, blurb: "Shorter 1st gear, quicker shifts, slightly lower top speed" },
  { slug: "gear-sport", type: "GEARBOX", tier: 2, name: "Sport Gearbox", price: 6000, requiredLevel: 3, physicsModifiers: { accelMult: 1.12, topSpeedMult: 1.08, shiftTimeMult: 0.65 }, compatibleCategories: ALL, blurb: "Wider ratios + faster shifts" },
  { slug: "gear-seq", type: "GEARBOX", tier: 3, name: "Sequential Race Box", price: 18000, requiredLevel: 6, physicsModifiers: { accelMult: 1.15, topSpeedMult: 1.15, shiftTimeMult: 0.4 }, compatibleCategories: ALL, blurb: "Near-instant shifts, long top gear" },

  // ---- aero
  { slug: "spoiler-lip", type: "SPOILER", tier: 1, name: "Lip Spoiler", price: 700, requiredLevel: 1, physicsModifiers: { dragMult: 1.02, downforceMult: 1.5 }, compatibleCategories: ALL, blurb: "+50% downforce, tiny drag cost" },
  { slug: "spoiler-gt", type: "SPOILER", tier: 2, name: "GT Wing", price: 2800, requiredLevel: 1, physicsModifiers: { dragMult: 1.08, downforceMult: 2.4 }, compatibleCategories: ALL, blurb: "2.4× downforce, +8% drag" },
  { slug: "spoiler-race", type: "SPOILER", tier: 3, name: "Race Wing", price: 8000, requiredLevel: 4, physicsModifiers: { dragMult: 1.15, downforceMult: 3.4 }, compatibleCategories: ALL, blurb: "3.4× downforce, +15% drag" },
  { slug: "aero-diffuser", type: "AERO", tier: 1, name: "Underbody Diffuser", price: 3500, requiredLevel: 2, physicsModifiers: { dragMult: 0.97, downforceMult: 1.6 }, compatibleCategories: ALL, blurb: "More downforce AND less drag" },
  { slug: "aero-kit", type: "AERO", tier: 2, name: "Full Aero Kit", price: 12000, requiredLevel: 5, physicsModifiers: { dragMult: 0.95, downforceMult: 2.4 }, compatibleCategories: ALL, blurb: "2.4× downforce, −5% drag" },

  // ---- armor (mass vs durability)
  { slug: "armor-bumpers", type: "ARMOR", tier: 1, name: "Reinforced Bumpers", price: 1200, requiredLevel: 1, physicsModifiers: { massAdd: 40, durabilityMult: 1.35 }, compatibleCategories: ALL, blurb: "+40 kg, takes 26% less crash damage" },
  { slug: "armor-cage", type: "ARMOR", tier: 2, name: "Steel Roll Cage", price: 4500, requiredLevel: 2, physicsModifiers: { massAdd: 90, durabilityMult: 1.9 }, compatibleCategories: ALL, blurb: "+90 kg, takes 47% less crash damage" },
  { slug: "armor-plating", type: "ARMOR", tier: 3, name: "Armored Plating", price: 12000, requiredLevel: 5, physicsModifiers: { massAdd: 180, durabilityMult: 3.0 }, compatibleCategories: ALL, blurb: "+180 kg, takes 67% less crash damage" },

  // ---- nitro (stock cars already carry a 1.45× / 4 s bottle; kits beat it)
  { slug: "nitro-1", type: "NITRO", tier: 1, name: "Nitro Kit", price: 2000, requiredLevel: 1, physicsModifiers: { torqueMult: 1.5, durationS: 5 }, compatibleCategories: ALL, blurb: "1.5× torque for 5 s" },
  { slug: "nitro-2", type: "NITRO", tier: 2, name: "Pro Nitro", price: 7000, requiredLevel: 3, physicsModifiers: { torqueMult: 1.65, durationS: 6.5 }, compatibleCategories: ALL, blurb: "1.65× torque for 6.5 s" },
  { slug: "nitro-3", type: "NITRO", tier: 3, name: "Race Nitro", price: 20000, requiredLevel: 6, physicsModifiers: { torqueMult: 1.85, durationS: 8 }, compatibleCategories: ALL, blurb: "1.85× torque for 8 s" },

  // ---- cooling (heat rejection – see thermal model in vehicle.ts)
  { slug: "cooling-sport", type: "COOLING", tier: 1, name: "Sport Radiator", price: 1800, requiredLevel: 1, physicsModifiers: { coolingMult: 1.5 }, compatibleCategories: ALL, blurb: "+50% heat rejection" },
  { slug: "cooling-race", type: "COOLING", tier: 2, name: "Race Cooling Pack", price: 6500, requiredLevel: 3, physicsModifiers: { coolingMult: 2.2 }, compatibleCategories: ALL, blurb: "2.2× heat rejection – keeps big engines cool" },
  { slug: "cooling-oil", type: "COOLING", tier: 3, name: "Oil Cooler + Intercooler", price: 15000, requiredLevel: 6, physicsModifiers: { coolingMult: 3.0 }, compatibleCategories: ALL, blurb: "3× heat rejection" },

  // ---- differential (traction)
  { slug: "diff-lsd", type: "DIFFERENTIAL", tier: 1, name: "Limited-Slip Diff", price: 2200, requiredLevel: 1, physicsModifiers: { tractionMult: 1.05 }, compatibleCategories: ALL, blurb: "+5% drive force reaches the road" },
  { slug: "diff-race", type: "DIFFERENTIAL", tier: 2, name: "Race Diff", price: 8000, requiredLevel: 4, physicsModifiers: { tractionMult: 1.1 }, compatibleCategories: ALL, blurb: "+10% drive force reaches the road" },
];

export const PARTS_BY_SLUG: Record<string, PartDef> = Object.fromEntries(PARTS_CATALOG.map((p) => [p.slug, p]));
export const partsOfType = (t: PartTypeKey) => PARTS_CATALOG.filter((p) => p.type === t).sort((a, b) => a.tier - b.tier);

/** A part is the stock/default one when it costs nothing (only engine-standard). */
export const isStockPart = (p: { price: number }) => p.price === 0;

export type InstallCheck = { ok: true } | { ok: false; code: "LEVEL" | "COMPAT"; message: string };

/** Level + category compatibility (used identically by the server and the UI). */
export function canInstall(part: { requiredLevel: number; compatibleCategories: readonly string[]; name: string }, vehicleCategory: string, playerLevel: number): InstallCheck {
  if (!part.compatibleCategories.includes(vehicleCategory))
    return { ok: false, code: "COMPAT", message: `${part.name} does not fit a ${vehicleCategory.toLowerCase().replace("_", " ")}` };
  if (playerLevel < part.requiredLevel)
    return { ok: false, code: "LEVEL", message: `${part.name} needs level ${part.requiredLevel}` };
  return { ok: true };
}
