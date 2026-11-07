/**
 * ROAD RIVALS – race rules (pure TypeScript, time is always passed in → fully unit-testable).
 *
 * The SERVER runs a `RaceTracker` per race, fed only with positions it already validated
 * (plausibleMove / sanitizeState). Clients never report checkpoints, laps, drift scores or
 * results – they only drive; the tracker decides what counted.
 */
import { crossedCheckpoint, getCityLayout, type Checkpoint } from "./world";

export const RACE_MODE_KEYS = ["MULTIPLAYER", "QUICK", "PRIVATE", "TIME_TRIAL", "DRIFT", "CHECKPOINT", "TOURNAMENT", "SURVIVAL"] as const;
export type RaceModeKey = (typeof RACE_MODE_KEYS)[number];
export type RaceKind = "laps" | "drift" | "checkpoint" | "survival";

export interface ModeDef {
  key: RaceModeKey; name: string; blurb: string; kind: RaceKind;
  /** can be started alone (solo room) */
  solo: boolean;
  /** players needed to start */
  minPlayers: number;
  laps: number;
  /** drift / checkpoint modes: race length (checkpoint mode: starting time, extended per gate) */
  timeLimitMs?: number;
  rounds?: number;
}

export const RACE_MODES: Record<RaceModeKey, ModeDef> = {
  MULTIPLAYER: { key: "MULTIPLAYER", name: "Multiplayer Race", blurb: "3 laps of the Neon circuit. Best position wins.", kind: "laps", solo: false, minPlayers: 2, laps: 3 },
  QUICK: { key: "QUICK", name: "Quick Race", blurb: "One fast lap – perfect after a quick match.", kind: "laps", solo: false, minPlayers: 2, laps: 1 },
  PRIVATE: { key: "PRIVATE", name: "Private Race", blurb: "2 laps with friends (invite only, friendly rewards).", kind: "laps", solo: false, minPlayers: 2, laps: 2 },
  TIME_TRIAL: { key: "TIME_TRIAL", name: "Time Trial", blurb: "Solo. 3 laps against the clock for gold, silver or bronze.", kind: "laps", solo: true, minPlayers: 1, laps: 3 },
  DRIFT: { key: "DRIFT", name: "Drift Challenge", blurb: "90 seconds. Slide through the city – the longer the drift, the bigger the combo.", kind: "drift", solo: true, minPlayers: 1, laps: 0, timeLimitMs: 90_000 },
  CHECKPOINT: { key: "CHECKPOINT", name: "Checkpoint Race", blurb: "Start with 45 s, every gate adds 12 s. How far can you get?", kind: "checkpoint", solo: true, minPlayers: 1, laps: 0, timeLimitMs: 45_000 },
  TOURNAMENT: { key: "TOURNAMENT", name: "Tournament", blurb: "3 rounds of 2 laps. Points per round, best total wins.", kind: "laps", solo: false, minPlayers: 2, laps: 2, rounds: 3 },
  SURVIVAL: { key: "SURVIVAL", name: "Survival Race", blurb: "Last place is eliminated every 20 s. Be the last car standing.", kind: "survival", solo: false, minPlayers: 2, laps: 0 },
};
export const isRaceMode = (m: unknown): m is RaceModeKey => typeof m === "string" && (RACE_MODE_KEYS as readonly string[]).includes(m);

export const RACE_TUNING = {
  /** the race starts / finishes at this gate of the shared checkpoint loop */
  startCp: 3,
  countdownMs: 5000,
  /** after the first finisher, everybody else has this long (or 35 % of the winner's time, whichever is longer) */
  finishWindowMs: 60_000,
  maxRaceMs: 25 * 60_000,
  checkpointBonusMs: 12_000,
  survivalGraceMs: 30_000, survivalEveryMs: 20_000,
  /** drift scoring */
  drift: { minSpeedKmh: 35, minSlipDeg: 14, maxSlipDeg: 100, comboStepMs: 2000, maxCombo: 5, resetAfterMs: 1200, pointsPerMs: 0.0075 },
  tournamentPoints: [10, 7, 5, 3, 2],
  tournamentBreakMs: 15_000,
  resultsHoldMs: 12_000,
} as const;

/* ------------------------------------------------------------------ geometry */

/** Length of one lap of the checkpoint loop (straight legs – a lower bound of the driven distance). */
export function circuitLength(cps: Checkpoint[] = getCityLayout().checkpoints) {
  let len = 0;
  for (let i = 0; i < cps.length; i++) { const a = cps[i], b = cps[(i + 1) % cps.length]; len += Math.hypot(a.x - b.x, a.z - b.z); }
  return len;
}

/** Which gate the racer must cross next, given how many gates they already passed. */
export function targetGate(passed: number, n = getCityLayout().checkpoints.length, start = RACE_TUNING.startCp) {
  return (start + 1 + (passed % n)) % n;
}

/** Starting grid: two columns behind the start gate, facing the direction of travel. */
export function gridPose(seat: number) {
  const L = getCityLayout();
  const cp = L.checkpoints[RACE_TUNING.startCp];
  const fx = Math.sin(cp.yaw), fz = Math.cos(cp.yaw), rx = Math.cos(cp.yaw), rz = -Math.sin(cp.yaw);
  const row = Math.floor(seat / 2), side = seat % 2 === 0 ? -1 : 1;
  const back = 10 + row * 9, lat = side * 3.4;
  return { x: cp.x - fx * back + rx * lat, y: 1, z: cp.z - fz * back + rz * lat, yaw: cp.yaw };
}

/* ------------------------------------------------------------ drift (server-side) */

export interface MotionSample { vx: number; vz: number; qx: number; qy: number; qz: number; qw: number; speed: number }

/** Angle (deg) between where the car points and where it actually travels – computed from the validated state, not from a client flag. */
export function slipAngleDeg(s: MotionSample): number {
  // forward vector = q · (0,0,1)
  const fx = 2 * (s.qx * s.qz + s.qw * s.qy), fz = 1 - 2 * (s.qx * s.qx + s.qy * s.qy);
  const fl = Math.hypot(fx, fz), vl = Math.hypot(s.vx, s.vz);
  if (fl < 1e-6 || vl < 1) return 0;
  const cos = Math.max(-1, Math.min(1, (fx * s.vx + fz * s.vz) / (fl * vl)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * The reported velocity must roughly match how the reported position actually moved between two
 * accepted states, otherwise somebody is faking velocity/orientation to fake a drift.
 */
export function velocityConsistent(prev: { x: number; z: number }, next: { x: number; z: number; vx: number; vz: number }, dtMs: number) {
  if (dtMs < 30 || dtMs > 400) return true; // no usable reference → don't punish
  const mx = (next.x - prev.x) / (dtMs / 1000), mz = (next.z - prev.z) / (dtMs / 1000);
  return Math.hypot(mx - next.vx, mz - next.vz) <= 8 + 0.4 * Math.hypot(next.vx, next.vz);
}

/* ------------------------------------------------------------------- tracker */

export interface Standing {
  id: string; name: string; position: number;
  /** lap modes: finish time; checkpoint/drift: time survived / total time */
  timeMs: number | null;
  finished: boolean; dnf: boolean; eliminated: boolean;
  /** gates passed (all modes) */
  gates: number; lap: number; bestLapMs: number | null;
  /** drift score */
  score: number;
}
export type RaceEvent =
  | { type: "gate"; id: string; gates: number; lap: number; at: number }
  | { type: "lap"; id: string; lap: number; lapMs: number; at: number }
  | { type: "finish"; id: string; position: number; timeMs: number; at: number }
  | { type: "eliminated"; id: string; at: number }
  | { type: "timeup"; id: string; at: number }
  | { type: "over"; at: number };

interface Racer {
  id: string; name: string; gates: number; lastPos: { x: number; z: number } | null; lastAt: number;
  finishedAt: number | null; eliminatedAt: number | null; timeUpAt: number | null; dnf: boolean;
  lapStartAt: number; bestLapMs: number | null; lapsDone: number; lastGateAt: number;
  score: number; combo: number; comboMs: number; lastDriftAt: number; driftPoints: number;
  deadline: number; // checkpoint mode
}

export interface TrackerOpts {
  mode: RaceModeKey; laps?: number; startAt: number;
  players: { id: string; name: string }[];
  cps?: Checkpoint[];
}

export class RaceTracker {
  readonly def: ModeDef;
  readonly laps: number;
  readonly startAt: number;
  private cps: Checkpoint[];
  private racers = new Map<string, Racer>();
  private finishOrder: string[] = [];
  private elimOrder: string[] = [];
  private firstFinishAt: number | null = null;
  private lastElimAt: number;
  over = false;
  overAt: number | null = null;

  constructor(o: TrackerOpts) {
    this.def = RACE_MODES[o.mode];
    this.laps = o.laps ?? this.def.laps;
    this.startAt = o.startAt;
    this.lastElimAt = o.startAt + RACE_TUNING.survivalGraceMs - RACE_TUNING.survivalEveryMs;
    this.cps = o.cps ?? getCityLayout().checkpoints;
    for (const p of o.players) this.racers.set(p.id, {
      id: p.id, name: p.name, gates: 0, lastPos: null, lastAt: o.startAt, finishedAt: null, eliminatedAt: null, timeUpAt: null, dnf: false,
      lapStartAt: o.startAt, bestLapMs: null, lapsDone: 0, lastGateAt: o.startAt, score: 0, combo: 0, comboMs: 0, lastDriftAt: 0, driftPoints: 0,
      deadline: o.startAt + (this.def.timeLimitMs ?? 0),
    });
  }

  has(id: string) { return this.racers.has(id); }
  ids() { return [...this.racers.keys()]; }
  private active(r: Racer) { return r.finishedAt === null && r.eliminatedAt === null && r.timeUpAt === null && !r.dnf; }

  /** Remove a player who left the session (counts as DNF; the race can still end for the others). */
  drop(id: string, now: number): RaceEvent[] {
    const r = this.racers.get(id); if (!r || !this.active(r)) return [];
    r.dnf = true;
    return this.tick(now);
  }

  /** Server-validated position update. `speedKmh`/slip are derived by the caller from the same validated state. */
  update(id: string, next: { x: number; z: number }, now: number, drift?: { slipDeg: number; speedKmh: number }): RaceEvent[] {
    const r = this.racers.get(id);
    const ev: RaceEvent[] = [];
    if (!r || this.over || now < this.startAt) { if (r) { r.lastPos = { ...next }; r.lastAt = now; } return ev; }
    if (!this.active(r)) { r.lastPos = { ...next }; r.lastAt = now; return ev; }
    const prev = r.lastPos; const dt = Math.min(Math.max(now - r.lastAt, 0), 250);
    r.lastPos = { ...next }; r.lastAt = now;

    // ---- drift scoring (every mode keeps drift points for missions; drift mode ranks by it)
    if (drift) {
      const D = RACE_TUNING.drift;
      const sliding = drift.speedKmh >= D.minSpeedKmh && drift.slipDeg >= D.minSlipDeg && drift.slipDeg <= D.maxSlipDeg;
      if (sliding) {
        r.comboMs += dt; r.lastDriftAt = now;
        r.combo = Math.min(D.maxCombo, 1 + Math.floor(r.comboMs / D.comboStepMs));
        const pts = dt * D.pointsPerMs * drift.speedKmh * r.combo * Math.min(1.5, drift.slipDeg / 35);
        r.score += pts; r.driftPoints += pts;
      } else if (now - r.lastDriftAt > D.resetAfterMs) { r.combo = 0; r.comboMs = 0; }
    }

    // ---- gates
    if (prev && this.def.kind !== "drift") {
      const gi = targetGate(r.gates, this.cps.length, RACE_TUNING.startCp);
      if (crossedCheckpoint(prev.x, prev.z, next.x, next.z, this.cps[gi])) {
        r.gates++; r.lastGateAt = now;
        const lap = Math.floor(r.gates / this.cps.length);
        ev.push({ type: "gate", id, gates: r.gates, lap: lap + 1, at: now });
        if (this.def.kind === "checkpoint") r.deadline += RACE_TUNING.checkpointBonusMs;
        if (r.gates % this.cps.length === 0) {
          const lapMs = now - r.lapStartAt; r.lapStartAt = now; r.lapsDone++;
          r.bestLapMs = r.bestLapMs === null ? lapMs : Math.min(r.bestLapMs, lapMs);
          ev.push({ type: "lap", id, lap: r.lapsDone, lapMs, at: now });
          if (this.def.kind === "laps" && r.lapsDone >= this.laps) {
            r.finishedAt = now; this.finishOrder.push(id);
            if (this.firstFinishAt === null) this.firstFinishAt = now;
            ev.push({ type: "finish", id, position: this.finishOrder.length, timeMs: now - this.startAt, at: now });
          }
        }
      }
    }
    return [...ev, ...this.tick(now)];
  }

  /** Time based rules: deadlines, eliminations, DNF window, end of race. Call at least once a second. */
  tick(now: number): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.over) return ev;
    const all = [...this.racers.values()];
    const k = this.def.kind;

    if (k === "drift") {
      if (now >= this.startAt + (this.def.timeLimitMs ?? 0)) for (const r of all) if (this.active(r)) { r.timeUpAt = this.startAt + this.def.timeLimitMs!; ev.push({ type: "timeup", id: r.id, at: now }); }
    } else if (k === "checkpoint") {
      for (const r of all) if (this.active(r) && now >= r.deadline) { r.timeUpAt = r.deadline; ev.push({ type: "timeup", id: r.id, at: now }); }
    } else if (k === "survival") {
      const alive = all.filter((r) => this.active(r));
      if (alive.length > 1 && now - this.lastElimAt >= RACE_TUNING.survivalEveryMs && now >= this.startAt + RACE_TUNING.survivalGraceMs) {
        this.lastElimAt = now;
        const last = this.rank(alive)[alive.length - 1];
        last.eliminatedAt = now; this.elimOrder.push(last.id); ev.push({ type: "eliminated", id: last.id, at: now });
      }
      const left = all.filter((r) => this.active(r));
      if (left.length <= 1 && all.length >= 1) { if (left[0]) { left[0].finishedAt = now; this.finishOrder.push(left[0].id); ev.push({ type: "finish", id: left[0].id, position: 1, timeMs: now - this.startAt, at: now }); } this.end(now, ev); return ev; }
    } else if (this.firstFinishAt !== null) {
      const first = this.firstFinishAt - this.startAt;
      const window = Math.max(RACE_TUNING.finishWindowMs, first * 0.35);
      if (now - this.firstFinishAt >= window) for (const r of all) if (this.active(r)) r.dnf = true;
    }
    if (now - this.startAt >= RACE_TUNING.maxRaceMs) for (const r of all) if (this.active(r)) r.dnf = true;
    if (all.every((r) => !this.active(r))) this.end(now, ev);
    return ev;
  }

  private end(now: number, ev: RaceEvent[]) { if (!this.over) { this.over = true; this.overAt = now; ev.push({ type: "over", at: now }); } }

  /** Progress ordering for racers still running: more gates first, then who is closer to the next gate. */
  private rank(list: Racer[]): Racer[] {
    const dist = (r: Racer) => {
      if (!r.lastPos) return Infinity;
      const g = this.cps[targetGate(r.gates, this.cps.length, RACE_TUNING.startCp)];
      return Math.hypot(r.lastPos.x - g.x, r.lastPos.z - g.z);
    };
    return [...list].sort((a, b) => b.gates - a.gates || dist(a) - dist(b));
  }

  standings(now = this.overAt ?? this.startAt): Standing[] {
    const all = [...this.racers.values()];
    const k = this.def.kind;
    let ordered: Racer[];
    if (k === "drift") ordered = [...all].sort((a, b) => b.score - a.score);
    else if (k === "checkpoint") ordered = [...all].sort((a, b) => b.gates - a.gates || a.lastGateAt - b.lastGateAt);
    else if (k === "survival") {
      const alive = this.rank(all.filter((r) => r.eliminatedAt === null && !r.dnf));
      const out = [...all.filter((r) => r.eliminatedAt !== null)].sort((a, b) => b.eliminatedAt! - a.eliminatedAt!);
      const gone = all.filter((r) => r.dnf && r.eliminatedAt === null);
      ordered = [...alive, ...out, ...gone];
    } else {
      const fin = this.finishOrder.map((id) => this.racers.get(id)!);
      const rest = this.rank(all.filter((r) => r.finishedAt === null && !r.dnf));
      ordered = [...fin, ...rest, ...all.filter((r) => r.dnf && r.finishedAt === null)];
    }
    return ordered.map((r, i): Standing => ({
      id: r.id, name: r.name, position: i + 1,
      timeMs: r.finishedAt !== null ? r.finishedAt - this.startAt : r.timeUpAt !== null ? r.timeUpAt - this.startAt : null,
      finished: r.finishedAt !== null || r.timeUpAt !== null, dnf: r.dnf && r.finishedAt === null, eliminated: r.eliminatedAt !== null,
      gates: r.gates, lap: Math.min(this.laps || 99, Math.floor(r.gates / this.cps.length) + 1), bestLapMs: r.bestLapMs,
      score: Math.round(r.score),
    })).map((s) => (now < this.startAt ? { ...s, timeMs: null } : s));
  }

  /** Mission/XP relevant totals for one racer. */
  stats(id: string) { const r = this.racers.get(id); return r ? { gates: r.gates, laps: r.lapsDone, driftPoints: Math.round(r.driftPoints) } : null; }
}

/* ------------------------------------------------------------------- rewards */

const POSITION_MULT = [1, 0.65, 0.45, 0.3, 0.2];
export const TIME_TRIAL_MEDALS = { gold: 42, silver: 34, bronze: 26 } as const; // average m/s over the loop

export type Medal = "GOLD" | "SILVER" | "BRONZE" | null;
export function timeTrialMedal(timeMs: number, laps: number): Medal {
  const base = circuitLength() * laps;
  const avg = base / (timeMs / 1000);
  return avg >= TIME_TRIAL_MEDALS.gold ? "GOLD" : avg >= TIME_TRIAL_MEDALS.silver ? "SILVER" : avg >= TIME_TRIAL_MEDALS.bronze ? "BRONZE" : null;
}

export interface Reward { coins: number; xp: number; /** leaderboard points */ points: number; won: boolean; medal?: Medal }

/**
 * Coins / XP / leaderboard points for one finished racer. Pure function of the validated result.
 * Smaller fields and friendly modes pay less so private lobbies cannot be farmed.
 */
export function computeReward(mode: RaceModeKey, s: Standing, fieldSize: number, ctx: { laps: number }): Reward {
  const def = RACE_MODES[mode];
  const pm = POSITION_MULT[Math.min(s.position, 5) - 1] ?? 0.15;
  const field = Math.min(5, Math.max(1, fieldSize));
  const fieldScale = field === 1 ? 0.5 : 0.5 + 0.125 * field; // 2 → 0.75 … 5 → 1.125
  const round = (n: number) => Math.max(0, Math.round(n));
  const lose = s.dnf || (def.kind !== "drift" && def.kind !== "checkpoint" && !s.finished && !s.eliminated);
  let coins = 0, xp = 0, points = 0, medal: Medal | undefined;

  switch (def.kind) {
    case "laps": {
      if (mode === "TIME_TRIAL") {
        if (!s.finished || s.timeMs === null) break;
        medal = timeTrialMedal(s.timeMs, ctx.laps);
        coins = { GOLD: 500, SILVER: 300, BRONZE: 150, null: 50 }[String(medal) as "GOLD"];
        xp = { GOLD: 120, SILVER: 80, BRONZE: 40, null: 15 }[String(medal) as "GOLD"];
        points = { GOLD: 60, SILVER: 40, BRONZE: 20, null: 5 }[String(medal) as "GOLD"];
        break;
      }
      const base = { MULTIPLAYER: [600, 150], QUICK: [300, 80], PRIVATE: [200, 60], TOURNAMENT: [0, 0] }[mode as "QUICK"] ?? [0, 0];
      const lapScale = Math.max(1, ctx.laps) / def.laps;
      coins = base[0] * pm * fieldScale * lapScale; xp = base[1] * pm * fieldScale * lapScale;
      points = 100 * pm * fieldScale;
      if (lose) { coins *= 0.1; xp *= 0.15; points = 0; }
      break;
    }
    case "drift": {
      coins = Math.min(800, s.score / 22) * (field === 1 ? 1 : fieldScale * (0.6 + 0.4 * pm));
      xp = Math.min(220, s.score / 70) * (field === 1 ? 1 : 0.6 + 0.4 * pm);
      points = Math.min(120, s.score / 80);
      break;
    }
    case "checkpoint": {
      coins = Math.min(700, s.gates * 28) * (field === 1 ? 1 : 0.6 + 0.4 * pm);
      xp = Math.min(260, s.gates * 9) * (field === 1 ? 1 : 0.6 + 0.4 * pm);
      points = Math.min(100, s.gates * 3);
      break;
    }
    case "survival": {
      const base = { coins: 800, xp: 200 };
      coins = base.coins * pm * fieldScale; xp = base.xp * pm * fieldScale; points = 120 * pm * fieldScale;
      break;
    }
  }
  const won = s.position === 1 && !lose && (def.kind === "laps" ? s.finished : true) && (field > 1 || mode === "TIME_TRIAL" || def.kind === "drift" || def.kind === "checkpoint");
  return { coins: round(coins), xp: round(xp), points: round(points), won, ...(medal !== undefined ? { medal } : {}) };
}

/** Tournament: championship points per round + final reward for the overall standing. */
export function tournamentRoundPoints(position: number, finished: boolean) {
  return finished ? RACE_TUNING.tournamentPoints[position - 1] ?? 1 : 0;
}
export function tournamentFinalReward(position: number, field: number): Reward {
  const pm = POSITION_MULT[Math.min(position, 5) - 1] ?? 0.15;
  const scale = 0.5 + 0.125 * Math.min(5, Math.max(2, field));
  return { coins: Math.round(1500 * pm * scale), xp: Math.round(400 * pm * scale), points: Math.round(200 * pm * scale), won: position === 1 };
}

/** 1 → "1st", 2 → "2nd" … */
export const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;
