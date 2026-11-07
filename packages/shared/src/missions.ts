/**
 * ROAD RIVALS – mission catalogue + progress rules (pure TypeScript).
 * Progress is only ever added by the SERVER from validated events (finished race, validated lap
 * claim, validated garage purchase, validated driven distance). The client can only ask to claim.
 */
export const MISSION_EVENTS = [
  "RACE_FINISHED", "RACE_WON", "LAP", "DISTANCE_M", "DRIFT_POINTS", "GARAGE_SERVICE", "GATES", "TOURNAMENT_FINISHED", "SURVIVAL_WON", "COINS_EARNED",
] as const;
export type MissionEvent = (typeof MISSION_EVENTS)[number];
export type MissionPeriodKey = "DAILY" | "WEEKLY";

export interface MissionDef {
  code: string; title: string; description: string; period: MissionPeriodKey;
  event: MissionEvent; target: number; rewardCoins: number; rewardXp: number;
}

export const MISSIONS: MissionDef[] = [
  { code: "d_race3", title: "Warm-up", description: "Finish 3 races (any mode)", period: "DAILY", event: "RACE_FINISHED", target: 3, rewardCoins: 400, rewardXp: 100 },
  { code: "d_win1", title: "Taste of Victory", description: "Win a race", period: "DAILY", event: "RACE_WON", target: 1, rewardCoins: 600, rewardXp: 150 },
  { code: "d_laps5", title: "Lap Collector", description: "Complete 5 laps of the Neon circuit", period: "DAILY", event: "LAP", target: 5, rewardCoins: 500, rewardXp: 120 },
  { code: "d_dist10", title: "City Cruiser", description: "Drive 10 km in a multiplayer session", period: "DAILY", event: "DISTANCE_M", target: 10_000, rewardCoins: 300, rewardXp: 80 },
  { code: "d_drift3k", title: "Sideways", description: "Score 3,000 drift points", period: "DAILY", event: "DRIFT_POINTS", target: 3000, rewardCoins: 450, rewardXp: 120 },
  { code: "d_garage1", title: "Pit Stop", description: "Pay for a garage service (repair, part or customization)", period: "DAILY", event: "GARAGE_SERVICE", target: 1, rewardCoins: 200, rewardXp: 50 },
  { code: "d_gates30", title: "Gate Runner", description: "Pass 30 race checkpoints", period: "DAILY", event: "GATES", target: 30, rewardCoins: 350, rewardXp: 90 },
  { code: "w_win5", title: "Podium Regular", description: "Win 5 races this week", period: "WEEKLY", event: "RACE_WON", target: 5, rewardCoins: 3000, rewardXp: 500 },
  { code: "w_race15", title: "Always Racing", description: "Finish 15 races this week", period: "WEEKLY", event: "RACE_FINISHED", target: 15, rewardCoins: 2500, rewardXp: 450 },
  { code: "w_laps40", title: "Endurance", description: "Complete 40 laps this week", period: "WEEKLY", event: "LAP", target: 40, rewardCoins: 3500, rewardXp: 600 },
  { code: "w_dist100", title: "Road Warrior", description: "Drive 100 km in multiplayer sessions", period: "WEEKLY", event: "DISTANCE_M", target: 100_000, rewardCoins: 2500, rewardXp: 400 },
  { code: "w_drift20k", title: "Drift King", description: "Score 20,000 drift points", period: "WEEKLY", event: "DRIFT_POINTS", target: 20_000, rewardCoins: 3000, rewardXp: 500 },
  { code: "w_tourney", title: "Tournament Player", description: "Finish a tournament", period: "WEEKLY", event: "TOURNAMENT_FINISHED", target: 1, rewardCoins: 2500, rewardXp: 600 },
  { code: "w_survive", title: "Last One Standing", description: "Win a Survival race", period: "WEEKLY", event: "SURVIVAL_WON", target: 1, rewardCoins: 2500, rewardXp: 550 },
];
export const MISSION_BY_CODE = new Map(MISSIONS.map((m) => [m.code, m]));
export const missionsForEvent = (e: MissionEvent) => MISSIONS.filter((m) => m.event === e);

/** UTC day key, e.g. 20261107 */
export const dailyKey = (d: Date = new Date()) => `D${d.toISOString().slice(0, 10).replace(/-/g, "")}`;

/** ISO-8601 week key (weeks start Monday, UTC), e.g. W2026-45 */
export function weeklyKey(d: Date = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `W${t.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}
export const periodKey = (p: MissionPeriodKey, d: Date = new Date()) => (p === "DAILY" ? dailyKey(d) : weeklyKey(d));

/** When the current period ends (UTC) – shown as a countdown. */
export function periodEnds(p: MissionPeriodKey, d: Date = new Date()) {
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (p === "DAILY") return new Date(day + 86_400_000);
  const dow = new Date(day).getUTCDay() || 7;
  return new Date(day + (8 - dow) * 86_400_000);
}

/** New progress after an event; never exceeds the target and never goes down. */
export const addProgress = (current: number, target: number, amount: number) => Math.min(target, current + Math.max(0, Math.floor(amount)));
