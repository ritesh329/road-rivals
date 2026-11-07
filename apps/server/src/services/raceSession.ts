/**
 * ROAD RIVALS – server-side race orchestration.
 *
 * This file has NO database / socket imports on purpose: everything it needs from the outside
 * (clock, timers, emitting events, teleporting a car, persisting results) is injected via
 * `RaceDeps`, so the whole race life-cycle (countdown → running → results → next tournament
 * round) is unit-tested with a fake clock (apps/server/tests/raceSession.test.ts).
 *
 * Authority: clients only drive. They never send checkpoints, laps, drift points or results –
 * `RaceTracker` derives them from the positions the server already validated.
 */
import {
  RACE_MODES, RACE_TUNING, RaceTracker, computeReward, gridPose, slipAngleDeg, targetGate, tournamentFinalReward, tournamentRoundPoints,
  velocityConsistent, getCityLayout,
  type MissionEvent, type RaceEvent, type RaceModeKey, type Reward, type Standing,
} from "@road-rivals/shared";

export class RaceError extends Error { constructor(public status: number, message: string) { super(message); } }

export interface Racer { userId: string; username: string; seat: number }
export interface RowOutcome extends Standing {
  userId: string; laps: number; driftPoints: number; field: number;
  coins: number; xp: number; points: number; won: boolean; medal?: Reward["medal"];
}
export interface RoundResult {
  roomId: string; code: string; mode: RaceModeKey; laps: number; round: number; rounds: number;
  startAt: number; endedAt: number; rows: RowOutcome[];
  missionEvents: { userId: string; event: MissionEvent; amount: number }[];
  /** tournament: championship table after this round */
  table?: { userId: string; username: string; points: number; position: number }[];
  /** tournament: set on the last round – bonus reward per player */
  finalRewards?: { userId: string; position: number; coins: number; xp: number; points: number; won: boolean }[];
}
export interface Persisted { userId: string; coinsAwarded: number; xpAwarded: number; capped: boolean; level?: number; leveledUp?: boolean }

export interface RaceDeps {
  now(): number;
  emit(roomId: string, event: string, payload: unknown): void;
  emitUser(userId: string, event: string, payload: unknown): void;
  /** snap a player's car (and the server's plausibility baseline) to a pose */
  teleport(roomId: string, userId: string, pose: { x: number; y: number; z: number; yaw: number }): void;
  /** players currently inside the shared world of the room */
  present(roomId: string): Racer[];
  persist(r: RoundResult): Promise<Persisted[]>;
  every(fn: () => void, ms: number): () => void;
  after(fn: () => void, ms: number): () => void;
}

type Phase = "COUNTDOWN" | "RUNNING" | "RESULTS";
interface Session {
  roomId: string; code: string; mode: RaceModeKey; laps: number; phase: Phase;
  round: number; rounds: number; startAt: number; tracker: RaceTracker;
  racers: Map<string, Racer>; respawn: Map<string, { x: number; y: number; z: number; yaw: number }>;
  champ: Map<string, number>; names: Map<string, string>;
  last: Map<string, { x: number; z: number; at: number }>;
  stopTick: () => void; cancels: (() => void)[]; finishing: boolean;
  results: unknown | null;
}

export class RaceOrchestrator {
  private sessions = new Map<string, Session>();
  constructor(private d: RaceDeps) {}

  get(roomId: string) { return this.sessions.get(roomId) ?? null; }
  isActive(roomId: string) { const s = this.sessions.get(roomId); return !!s && s.phase !== "RESULTS"; }
  summary(roomId: string) {
    const s = this.sessions.get(roomId); if (!s) return null;
    return { mode: s.mode, phase: s.phase, round: s.round, rounds: s.rounds, startAt: s.startAt, laps: s.laps, racers: [...s.racers.values()].map((r) => ({ id: r.userId, name: r.username })), standings: s.tracker.standings(this.d.now()), results: s.results };
  }

  /** Start a race (or the first round of a tournament) for everybody currently in the world. */
  start(room: { id: string; code: string; mode: RaceModeKey }, opts: { carryChampionship?: Session } = {}) {
    const existing = this.sessions.get(room.id);
    if (existing && existing.phase !== "RESULTS") throw new RaceError(409, "A race is already running");
    if (existing) this.dispose(room.id);
    const def = RACE_MODES[room.mode];
    if (!def) throw new RaceError(400, "Unknown race mode");
    const present = this.d.present(room.id);
    if (present.length < def.minPlayers) throw new RaceError(409, def.minPlayers > 1 ? `${def.name} needs at least ${def.minPlayers} drivers in the session` : "No driver in the session");
    const now = this.d.now();
    const startAt = now + RACE_TUNING.countdownMs;
    const carry = opts.carryChampionship;
    const s: Session = {
      roomId: room.id, code: room.code, mode: room.mode, laps: def.laps, phase: "COUNTDOWN", round: (carry?.round ?? 0) + 1, rounds: def.rounds ?? 1,
      startAt, tracker: new RaceTracker({ mode: room.mode, startAt, players: present.map((p) => ({ id: p.userId, name: p.username })) }),
      racers: new Map(present.map((p) => [p.userId, p])), respawn: new Map(), champ: carry?.champ ?? new Map(), names: carry?.names ?? new Map(),
      last: new Map(), stopTick: () => undefined, cancels: [], finishing: false, results: null,
    };
    for (const p of present) { s.names.set(p.userId, p.username); if (!s.champ.has(p.userId)) s.champ.set(p.userId, 0); }
    this.sessions.set(room.id, s);

    // everybody to the grid, frozen by the client until `startAt`
    for (const p of present) { const pose = gridPose(p.seat); s.respawn.set(p.userId, pose); this.d.teleport(room.id, p.userId, pose); }
    this.d.emit(room.id, "race:countdown", {
      mode: room.mode, name: def.name, kind: def.kind, laps: s.laps, round: s.round, rounds: s.rounds, startAt, serverNow: now,
      timeLimitMs: def.timeLimitMs ?? null, gates: getCityLayout().checkpoints.length,
      racers: present.map((p) => ({ id: p.userId, name: p.username, seat: p.seat })),
    });
    s.cancels.push(this.d.after(() => { if (s.phase === "COUNTDOWN") { s.phase = "RUNNING"; this.d.emit(s.roomId, "race:go", { startAt: s.startAt }); } }, RACE_TUNING.countdownMs));
    s.stopTick = this.d.every(() => this.tickSession(s), 400);
    return { startAt, racers: present.length };
  }

  /** Validated position of a racer (called by the socket layer after sanitize + plausibility). */
  onState(roomId: string, userId: string, st: { x: number; z: number; vx: number; vz: number; qx: number; qy: number; qz: number; qw: number; speed: number }, now: number) {
    const s = this.sessions.get(roomId);
    if (!s || s.phase === "RESULTS" || !s.tracker.has(userId)) return;
    if (s.phase === "COUNTDOWN" && now < s.startAt) { s.last.set(userId, { x: st.x, z: st.z, at: now }); return; }
    const prev = s.last.get(userId);
    s.last.set(userId, { x: st.x, z: st.z, at: now });
    // drift is judged from physics we can verify (heading vs travel direction), not from a client flag
    let drift: { slipDeg: number; speedKmh: number } | undefined;
    const speedKmh = Math.hypot(st.vx, st.vz) * 3.6;
    if (prev && velocityConsistent(prev, { x: st.x, z: st.z, vx: st.vx, vz: st.vz }, now - prev.at)) drift = { slipDeg: slipAngleDeg(st), speedKmh: Math.min(speedKmh, st.speed + 20) };
    this.handle(s, s.tracker.update(userId, { x: st.x, z: st.z }, now, drift));
  }

  /** The car must go back to the last gate it really passed (or the grid) – never to a client-chosen spot. */
  respawnPose(roomId: string, userId: string) {
    const s = this.sessions.get(roomId);
    if (!s || s.phase === "RESULTS" || !s.respawn.has(userId)) return null;
    return s.respawn.get(userId)!;
  }

  drop(roomId: string, userId: string) {
    const s = this.sessions.get(roomId); if (!s) return;
    if (s.phase !== "RESULTS") this.handle(s, s.tracker.drop(userId, this.d.now()));
    s.racers.delete(userId);
    if (s.phase === "RESULTS" && !this.d.present(roomId).length) this.dispose(roomId);
  }

  /** Host ends the race early (everybody DNF) or the room closes. */
  abort(roomId: string, reason = "The host ended the race") {
    const s = this.sessions.get(roomId); if (!s) return;
    this.d.emit(roomId, "race:aborted", { reason }); this.dispose(roomId);
  }
  dispose(roomId: string) {
    const s = this.sessions.get(roomId); if (!s) return;
    s.stopTick(); s.cancels.forEach((c) => c()); this.sessions.delete(roomId);
  }

  /* ------------------------------------------------------------------ internals */

  private tickSession(s: Session) {
    const now = this.d.now();
    if (s.phase === "RUNNING") this.handle(s, s.tracker.tick(now));
    if (s.phase === "RESULTS") return;
    const timeLeft = s.tracker.def.kind === "drift" ? Math.max(0, s.startAt + (s.tracker.def.timeLimitMs ?? 0) - now) : null;
    this.d.emit(s.roomId, "race:standings", { t: now, phase: s.phase, round: s.round, rounds: s.rounds, timeLeftMs: timeLeft, standings: s.tracker.standings(now) });
  }

  private handle(s: Session, events: RaceEvent[]) {
    for (const e of events) {
      if (e.type === "gate") {
        // checkpoint = new respawn point (stand just behind the gate, facing travel direction)
        const L = getCityLayout().checkpoints; const gi = (targetGate(e.gates - 1, L.length)); const cp = L[gi];
        s.respawn.set(e.id, { x: cp.x + Math.sin(cp.yaw) * 4, y: 1, z: cp.z + Math.cos(cp.yaw) * 4, yaw: cp.yaw });
      }
      if (e.type === "lap" || e.type === "finish" || e.type === "eliminated" || e.type === "timeup") {
        this.d.emit(s.roomId, "race:event", { ...e, name: s.names.get((e as { id: string }).id) ?? "?" });
      }
      if (e.type === "over" && !s.finishing) { s.finishing = true; void this.finish(s); }
    }
  }

  private async finish(s: Session) {
    s.stopTick(); s.phase = "RESULTS";
    const endedAt = this.d.now();
    const standings = s.tracker.standings(endedAt);
    const def = RACE_MODES[s.mode];
    const stats = (id: string) => s.tracker.stats(id) ?? { gates: 0, laps: 0, driftPoints: 0 };
    // only drivers who actually took part count towards the field size (blocks "join and idle" farming)
    const field = Math.max(1, standings.filter((x) => x.gates > 0 || x.score > 0).length);
    const rows: RowOutcome[] = standings.map((st) => {
      const rw = computeReward(s.mode, st, field, { laps: s.laps });
      const t = stats(st.id);
      return { ...st, userId: st.id, laps: t.laps, driftPoints: t.driftPoints, field, coins: rw.coins, xp: rw.xp, points: rw.points, won: rw.won, medal: rw.medal };
    });

    // championship (tournament)
    let table: RoundResult["table"]; let finalRewards: RoundResult["finalRewards"]; const finalRound = s.round >= s.rounds;
    if (s.mode === "TOURNAMENT") {
      for (const r of rows) s.champ.set(r.userId, (s.champ.get(r.userId) ?? 0) + tournamentRoundPoints(r.position, r.finished));
      const order = [...s.champ.entries()].sort((a, b) => b[1] - a[1] || (rows.find((r) => r.userId === a[0])?.position ?? 9) - (rows.find((r) => r.userId === b[0])?.position ?? 9));
      table = order.map(([userId, points], i) => ({ userId, username: s.names.get(userId) ?? "?", points, position: i + 1 }));
      if (finalRound) finalRewards = table.filter((t) => rows.some((r) => r.userId === t.userId && !r.dnf)).map((t) => ({ userId: t.userId, position: t.position, ...tournamentFinalReward(t.position, table!.length) }));
    }

    const missionEvents: RoundResult["missionEvents"] = [];
    for (const r of rows) {
      if (r.dnf && r.laps === 0 && r.gates === 0 && r.score === 0) continue; // never raced
      if (!r.dnf) missionEvents.push({ userId: r.userId, event: "RACE_FINISHED", amount: 1 });
      if (r.won && field > 1) { missionEvents.push({ userId: r.userId, event: "RACE_WON", amount: 1 }); if (def.kind === "survival") missionEvents.push({ userId: r.userId, event: "SURVIVAL_WON", amount: 1 }); }
      if (r.laps > 0) missionEvents.push({ userId: r.userId, event: "LAP", amount: r.laps });
      if (r.gates > 0 && def.kind !== "drift") missionEvents.push({ userId: r.userId, event: "GATES", amount: r.gates });
      if (r.driftPoints > 0) missionEvents.push({ userId: r.userId, event: "DRIFT_POINTS", amount: r.driftPoints });
    }
    if (finalRewards) for (const f of finalRewards) missionEvents.push({ userId: f.userId, event: "TOURNAMENT_FINISHED", amount: 1 });

    const round: RoundResult = { roomId: s.roomId, code: s.code, mode: s.mode, laps: s.laps, round: s.round, rounds: s.rounds, startAt: s.startAt, endedAt, rows, missionEvents, table, finalRewards };
    let persisted: Persisted[] = [];
    try { persisted = await this.d.persist(round); } catch (e) { console.error("race persist failed", e); }
    const byUser = new Map(persisted.map((p) => [p.userId, p]));
    const payload = {
      mode: s.mode, name: def.name, laps: s.laps, round: s.round, rounds: s.rounds, finalRound, field,
      rows: rows.map((r) => ({ ...r, paid: byUser.get(r.userId) ?? null })), table: table ?? null,
      finalRewards: finalRewards ?? null, next: s.mode === "TOURNAMENT" && !finalRound ? { inMs: RACE_TUNING.tournamentBreakMs } : null,
    };
    s.results = payload;
    this.d.emit(s.roomId, "race:results", payload);

    if (s.mode === "TOURNAMENT" && !finalRound) {
      s.cancels.push(this.d.after(() => {
        const cur = this.sessions.get(s.roomId); if (cur !== s) return;
        const present = this.d.present(s.roomId);
        if (present.length < def.minPlayers) { this.d.emit(s.roomId, "race:aborted", { reason: "Not enough drivers left to continue the tournament" }); this.dispose(s.roomId); return; }
        try { this.start({ id: s.roomId, code: s.code, mode: s.mode }, { carryChampionship: s }); } catch (e) { this.d.emit(s.roomId, "race:aborted", { reason: (e as Error).message }); this.dispose(s.roomId); }
      }, RACE_TUNING.tournamentBreakMs));
    }
  }
}
