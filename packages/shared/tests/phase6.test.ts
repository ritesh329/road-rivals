import {
  ACHIEVEMENTS, AVATAR_KEYS, TIER_INFO, VEHICLES, VEHICLE_BY_SLUG, VEHICLE_CATEGORIES, buildPhysicsParams, canBuyVehicle, earnedAchievements, estimatePerformance,
  levelUpBonus, nextTier, tierOf, xpForNextLevel, type PlayerStats,
} from "../src/index";

let failed = 0; const rows: string[] = [];
const check = (n: string, ok: boolean, d = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };

check("catalogue: unique slugs, starter is free at level 1", new Set(VEHICLES.map((v) => v.slug)).size === VEHICLES.length && VEHICLE_BY_SLUG.get("starter-hatch")!.price === 0 && VEHICLE_BY_SLUG.get("starter-hatch")!.requiredLevel === 1);
check("every one of the 8 categories has at least one car", VEHICLE_CATEGORIES.every((c) => VEHICLES.some((v) => v.category === c)), VEHICLE_CATEGORIES.filter((c) => !VEHICLES.some((v) => v.category === c)).join());
const want: Record<string, number> = { "starter-hatch": 1, "apex-sport": 5, "bruiser-muscle": 10, "vortex-super": 15, "meridian-gt": 20, "zenith-h1": 30, "phantom-legend": 40, "apex-ultima": 50 };
check("unlock ladder matches the design doc (1/5/10/15/20/30/40/50)", Object.entries(want).every(([s, l]) => VEHICLE_BY_SLUG.get(s)?.requiredLevel === l));
const byLevel = [...VEHICLES].sort((a, b) => a.requiredLevel - b.requiredLevel);
check("price rises with level (progression makes sense)", byLevel.every((v, i) => i === 0 || v.price > byLevel[i - 1].price));
const perf = (s: string) => { const v = VEHICLE_BY_SLUG.get(s)!; return estimatePerformance(buildPhysicsParams(v.baseStats, [], v.category)); };
check("physics: every car is drivable (0-100 and top speed finite) and stronger cars are faster", VEHICLES.every((v) => { const p = perf(v.slug); return Number.isFinite(p.zeroTo100) && p.topSpeedKmh > 120; }) && perf("apex-ultima").zeroTo100 < perf("vortex-super").zeroTo100 && perf("vortex-super").zeroTo100 < perf("apex-sport").zeroTo100 && perf("apex-sport").zeroTo100 < perf("starter-hatch").zeroTo100, VEHICLES.map((v) => `${v.slug}:${perf(v.slug).zeroTo100.toFixed(1)}s/${Math.round(perf(v.slug).topSpeedKmh)}`).join(" "));
check("stats are in the physics-tested envelope (hp ≤ 950, top ≤ 360)", VEHICLES.every((v) => v.baseStats.engineHp <= 950 && v.baseStats.topSpeedKmh <= 360 && v.baseStats.massKg >= 1000));

check("buy rules: owned / level / coins / ok, in that priority", canBuyVehicle({ price: 100, requiredLevel: 5, name: "X" }, 9, 999, true).code === "OWNED" && canBuyVehicle({ price: 100, requiredLevel: 5, name: "X" }, 4, 999, false).code === "LEVEL" && canBuyVehicle({ price: 100, requiredLevel: 5, name: "X" }, 5, 99, false).code === "COINS" && canBuyVehicle({ price: 100, requiredLevel: 5, name: "X" }, 5, 100, false).ok);

check("tiers: bronze→legend thresholds match tierForLevel", [[1, "BRONZE"], [5, "SILVER"], [15, "GOLD"], [25, "PLATINUM"], [40, "DIAMOND"], [50, "LEGEND"]].every(([l, t]) => tierOf(l as number) === t && TIER_INFO[t as keyof typeof TIER_INFO].from === l));
check("next tier: level 7 → Gold at 15; Legend has none", nextTier(7)?.tier === "GOLD" && nextTier(7)?.level === 15 && nextTier(50) === null);
check("level-up bonus grows with level; XP curve strictly increases", levelUpBonus(2) < levelUpBonus(10) && levelUpBonus(2) === 200 && [1, 2, 10, 49].every((l) => xpForNextLevel(l + 1) > xpForNextLevel(l)));

const S = (o: Partial<PlayerStats> = {}): PlayerStats => ({ racesPlayed: 0, racesWon: 0, level: 1, distanceKm: 0, vehiclesOwned: 1, ...o });
check("achievements: unique codes, none earned by a fresh account", new Set(ACHIEVEMENTS.map((a) => a.code)).size === ACHIEVEMENTS.length && earnedAchievements(S()).length === 0);
check("achievements unlock exactly at their thresholds", earnedAchievements(S({ racesPlayed: 1 })).join() === "first_race" && earnedAchievements(S({ racesPlayed: 10, racesWon: 1 })).sort().join() === "first_race,first_win,race_10" && earnedAchievements(S({ vehiclesOwned: 3 })).join() === "cars_3" && earnedAchievements(S({ level: 15 })).sort().join() === "level_15,level_5" && earnedAchievements(S({ distanceKm: 49.9 })).length === 0);
check("achievement progress reports value/target", ACHIEVEMENTS.find((a) => a.code === "race_10")!.goal(S({ racesPlayed: 4 })).join("/") === "4/10");
check("8+ avatars to choose from", AVATAR_KEYS.length >= 8);

console.log(rows.join("\n")); console.log(failed ? `\n${failed} FAILED` : `\nALL ${rows.length} PASSED`); process.exit(failed ? 1 : 0);
