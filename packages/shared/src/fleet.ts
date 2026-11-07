/**
 * ROAD RIVALS – car catalogue, progression, tiers, achievements, avatars (pure data + rules).
 *
 * Single source of truth: `prisma/seedCore.ts` writes VEHICLES into the Vehicle table, the server
 * validates every purchase against the DB rows (price / level come from here), the showroom
 * renders them, and the physics are built from `baseStats` exactly like any other car.
 */
import { tierForLevel } from "./index";
import type { VehicleCategoryKey } from "./catalog";

export interface VehicleDef {
  slug: string; name: string; category: VehicleCategoryKey; requiredLevel: number; price: number;
  baseStats: { massKg: number; engineHp: number; topSpeedKmh: number; grip: number; brakeTorque: number };
  blurb: string;
}

/** Unlock ladder from the design doc: L1 hatch · L5 sports · L10 muscle · L15 supercar · L20 racing GT · L30 hypercar · L40 legend · L50 ultimate. */
export const VEHICLES: VehicleDef[] = [
  { slug: "starter-hatch", name: "Rival Hatch", category: "HATCHBACK", requiredLevel: 1, price: 0, baseStats: { massKg: 1100, engineHp: 100, topSpeedKmh: 170, grip: 1.0, brakeTorque: 1.0 }, blurb: "Everybody's first car. Light, forgiving, upgradable." },
  { slug: "metro-sedan", name: "Metro Sedan", category: "SEDAN", requiredLevel: 3, price: 9000, baseStats: { massKg: 1400, engineHp: 150, topSpeedKmh: 200, grip: 1.05, brakeTorque: 1.1 }, blurb: "Comfortable and stable – the grown-up daily." },
  { slug: "apex-sport", name: "Apex Sport", category: "SPORTS", requiredLevel: 5, price: 25000, baseStats: { massKg: 1250, engineHp: 180, topSpeedKmh: 220, grip: 1.1, brakeTorque: 1.15 }, blurb: "Rear-drive fun with sharp steering." },
  { slug: "dune-runner", name: "Dune Runner", category: "OFFROAD", requiredLevel: 7, price: 38000, baseStats: { massKg: 1700, engineHp: 260, topSpeedKmh: 210, grip: 1.15, brakeTorque: 1.15 }, blurb: "All-wheel drive and a tall stance – shrugs off kerbs and ramps." },
  { slug: "bruiser-muscle", name: "Bruiser GT", category: "MUSCLE", requiredLevel: 10, price: 60000, baseStats: { massKg: 1650, engineHp: 400, topSpeedKmh: 250, grip: 0.95, brakeTorque: 1.1 }, blurb: "V8 thunder. Straight-line king, handful in the corners." },
  { slug: "vortex-super", name: "Vortex SC", category: "SUPERCAR", requiredLevel: 15, price: 150000, baseStats: { massKg: 1400, engineHp: 550, topSpeedKmh: 310, grip: 1.25, brakeTorque: 1.3 }, blurb: "Mid-engine AWD supercar." },
  { slug: "meridian-gt", name: "Meridian GT", category: "RACING_GT", requiredLevel: 20, price: 280000, baseStats: { massKg: 1300, engineHp: 620, topSpeedKmh: 325, grip: 1.35, brakeTorque: 1.4 }, blurb: "Homologated race car with licence plates." },
  { slug: "zenith-h1", name: "Zenith H1", category: "HYPERCAR", requiredLevel: 30, price: 600000, baseStats: { massKg: 1350, engineHp: 750, topSpeedKmh: 340, grip: 1.4, brakeTorque: 1.5 }, blurb: "Hybrid hypercar: 750 hp and active aero." },
  { slug: "phantom-legend", name: "Phantom Legend", category: "HYPERCAR", requiredLevel: 40, price: 1_200_000, baseStats: { massKg: 1300, engineHp: 850, topSpeedKmh: 350, grip: 1.45, brakeTorque: 1.55 }, blurb: "A legend among legends. Limited-run V12." },
  { slug: "apex-ultima", name: "Apex Ultima", category: "SUPERCAR", requiredLevel: 50, price: 2_500_000, baseStats: { massKg: 1250, engineHp: 950, topSpeedKmh: 360, grip: 1.5, brakeTorque: 1.6 }, blurb: "The ultimate supercar. Reserved for Legend drivers." },
];
export const VEHICLE_BY_SLUG = new Map(VEHICLES.map((v) => [v.slug, v]));

/* ------------------------------------------------------------------ progression */

export const TIER_INFO = {
  BRONZE: { label: "Bronze", color: "#cd7f32", from: 1 },
  SILVER: { label: "Silver", color: "#c0c0c0", from: 5 },
  GOLD: { label: "Gold", color: "#facc15", from: 15 },
  PLATINUM: { label: "Platinum", color: "#67e8f9", from: 25 },
  DIAMOND: { label: "Diamond", color: "#a5b4fc", from: 40 },
  LEGEND: { label: "Legend", color: "#f43f5e", from: 50 },
} as const;
export type TierKey = keyof typeof TIER_INFO;

/** Coins paid once for reaching `level` (server pays each level exactly once, even when several are gained at once). */
export const levelUpBonus = (level: number) => 100 + 50 * level;

/** Next tier and the level it starts at (null at Legend). */
export function nextTier(level: number): { tier: TierKey; level: number } | null {
  const order = Object.entries(TIER_INFO) as [TierKey, (typeof TIER_INFO)[TierKey]][];
  const n = order.find(([, t]) => t.from > level);
  return n ? { tier: n[0], level: n[1].from } : null;
}
export const tierOf = (level: number) => tierForLevel(level) as TierKey;

export interface BuyCheck { ok: boolean; code?: "OWNED" | "LEVEL" | "COINS"; message: string }
export function canBuyVehicle(v: Pick<VehicleDef, "price" | "requiredLevel" | "name">, level: number, coins: number, owned: boolean): BuyCheck {
  if (owned) return { ok: false, code: "OWNED", message: "You already own this car" };
  if (level < v.requiredLevel) return { ok: false, code: "LEVEL", message: `Reach level ${v.requiredLevel} to unlock the ${v.name}` };
  if (coins < v.price) return { ok: false, code: "COINS", message: `You need ${(v.price - coins).toLocaleString()} more coins` };
  return { ok: true, message: "Ready to buy" };
}

/* ------------------------------------------------------------------ achievements */

export interface PlayerStats { racesPlayed: number; racesWon: number; level: number; distanceKm: number; vehiclesOwned: number }
export interface AchievementDef { code: string; title: string; description: string; category: "Racing" | "Exploration" | "Collection" | "Progress"; rewardCoins: number; rewardXp: number; test: (s: PlayerStats) => boolean; goal: (s: PlayerStats) => [number, number] }
const A = (code: string, title: string, description: string, category: AchievementDef["category"], rewardCoins: number, rewardXp: number, pick: (s: PlayerStats) => number, target: number): AchievementDef =>
  ({ code, title, description, category, rewardCoins, rewardXp, test: (s) => pick(s) >= target, goal: (s) => [Math.min(pick(s), target), target] });

export const ACHIEVEMENTS: AchievementDef[] = [
  A("first_race", "On the Grid", "Finish your first race", "Racing", 200, 50, (s) => s.racesPlayed, 1),
  A("race_10", "Regular", "Take part in 10 races", "Racing", 600, 120, (s) => s.racesPlayed, 10),
  A("race_50", "Veteran", "Take part in 50 races", "Racing", 2500, 400, (s) => s.racesPlayed, 50),
  A("first_win", "Winner", "Win a race against other drivers", "Racing", 400, 100, (s) => s.racesWon, 1),
  A("win_10", "Dominator", "Win 10 races", "Racing", 2000, 300, (s) => s.racesWon, 10),
  A("win_50", "Champion", "Win 50 races", "Racing", 10000, 1000, (s) => s.racesWon, 50),
  A("dist_50", "Tourist", "Drive 50 km in multiplayer sessions", "Exploration", 500, 100, (s) => s.distanceKm, 50),
  A("dist_250", "Explorer", "Drive 250 km in multiplayer sessions", "Exploration", 3000, 400, (s) => s.distanceKm, 250),
  A("cars_3", "Garage Starter", "Own 3 cars", "Collection", 1000, 150, (s) => s.vehiclesOwned, 3),
  A("cars_6", "Collector", "Own 6 cars", "Collection", 6000, 600, (s) => s.vehiclesOwned, 6),
  A("level_5", "Rising Star", "Reach level 5", "Progress", 500, 0, (s) => s.level, 5),
  A("level_15", "Gold Driver", "Reach level 15", "Progress", 2500, 0, (s) => s.level, 15),
  A("level_30", "Hypercar Pilot", "Reach level 30", "Progress", 8000, 0, (s) => s.level, 30),
  A("level_50", "Living Legend", "Reach level 50", "Progress", 25000, 0, (s) => s.level, 50),
];
export const ACHIEVEMENT_BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));
export const earnedAchievements = (s: PlayerStats) => ACHIEVEMENTS.filter((a) => a.test(s)).map((a) => a.code);

/* ------------------------------------------------------------------------ avatars */
export const AVATARS = { default: "🏎️", flame: "🔥", bolt: "⚡", skull: "💀", crown: "👑", wolf: "🐺", star: "⭐", ghost: "👻" } as const;
export type AvatarKey = keyof typeof AVATARS;
export const AVATAR_KEYS = Object.keys(AVATARS) as [AvatarKey, ...AvatarKey[]];
