import { create } from "zustand";
import { RACE_MODES, getCityLayout, gridPose, targetGate, type RaceKind, type RaceModeKey, type Standing } from "@road-rivals/shared";
import { useNet } from "../net/netStore";

export interface RaceInfo {
  mode: RaceModeKey; name: string; kind: RaceKind; laps: number; round: number; rounds: number;
  timeLimitMs: number | null; gates: number; racers: { id: string; name: string; seat: number }[];
}
export interface ResultRow extends Standing {
  userId: string; coins: number; xp: number; points: number; won: boolean; medal?: "GOLD" | "SILVER" | "BRONZE" | null; field: number;
  paid: { coinsAwarded: number; xpAwarded: number; capped: boolean; level?: number; leveledUp?: boolean } | null;
}
export interface RaceResults {
  mode: RaceModeKey; name: string; laps: number; round: number; rounds: number; finalRound: boolean; field: number;
  rows: ResultRow[]; table: { userId: string; username: string; points: number; position: number }[] | null;
  finalRewards: { userId: string; position: number; coins: number; xp: number; points: number; won: boolean }[] | null;
  next: { inMs: number } | null;
}
export interface FeedItem { id: number; text: string; kind: "good" | "bad" | "info" }
export type RacePhase = "idle" | "countdown" | "running" | "results";

interface RaceStore {
  /** this /game session belongs to a room */
  inSession: boolean; isHost: boolean; solo: boolean; roomMode: RaceModeKey | null;
  phase: RacePhase; info: RaceInfo | null;
  /** local clock time of "GO" */
  startLocal: number;
  standings: Standing[]; myGates: number; nextGate: number;
  timeLeftMs: number | null; timeLeftAt: number;
  feed: FeedItem[]; results: RaceResults | null; nextAtLocal: number | null; error: string | null;
  applyJoin: (j: any) => void;
  set: (p: Partial<RaceStore>) => void;
  pushFeed: (text: string, kind?: FeedItem["kind"]) => void;
  reset: () => void;
}
const base = {
  inSession: false, isHost: false, solo: false, roomMode: null, phase: "idle" as RacePhase, info: null, startLocal: 0, standings: [], myGates: 0, nextGate: targetGate(0),
  timeLeftMs: null, timeLeftAt: 0, feed: [], results: null, nextAtLocal: null, error: null,
};
let feedId = 1;

export const useRace = create<RaceStore>((set) => ({
  ...base,
  set: (p) => set(p),
  reset: () => set({ ...base }),
  pushFeed: (text, kind = "info") => {
    const id = feedId++;
    set((s) => ({ feed: [...s.feed, { id, text, kind }].slice(-4) }));
    setTimeout(() => set((s) => ({ feed: s.feed.filter((f) => f.id !== id) })), 5000);
  },
  /** called with the `game:join` acknowledgement (late joiners get the running race too) */
  applyJoin: (j) => {
    set({ inSession: true, isHost: !!j.isHost, solo: j.solo === true, roomMode: j.mode ?? null });
    const r = j.race;
    if (!r) return;
    const phase: RacePhase = r.phase === "COUNTDOWN" ? "countdown" : r.phase === "RUNNING" ? "running" : "results";
    const serverNow = j.serverTime as number, off = Date.now() - serverNow;
    set({
      phase, startLocal: r.startAt + off, standings: r.standings ?? [], results: r.results ?? null,
      info: { mode: r.mode, name: RACE_MODES[r.mode as RaceModeKey]?.name ?? r.mode, kind: RACE_MODES[r.mode as RaceModeKey]?.kind ?? "laps", laps: r.laps, round: r.round, rounds: r.rounds, timeLimitMs: null, gates: getCityLayout().checkpoints.length, racers: r.racers.map((x: any, i: number) => ({ ...x, seat: i })) },
    });
  },
}));

/** True while the countdown is running: the car is held on the grid. */
export const raceFrozen = () => { const r = useRace.getState(); return r.phase === "countdown" && Date.now() < r.startLocal; };
/** A race is on (grid → finish): free-roam circuit & lap rewards are off. */
export const raceActive = () => { const p = useRace.getState().phase; return p === "countdown" || p === "running"; };

/** Where the server will put the car after a respawn: just behind the last gate we passed, or the grid. */
export function raceRespawnPose(seat: number) {
  const r = useRace.getState();
  if (r.myGates <= 0) return gridPose(seat);
  const L = getCityLayout().checkpoints;
  const cp = L[targetGate(r.myGates - 1, L.length)];
  return { x: cp.x + Math.sin(cp.yaw) * 4, y: 1, z: cp.z + Math.cos(cp.yaw) * 4, yaw: cp.yaw };
}
export const selfStanding = () => { const id = useNet.getState().selfId; return useRace.getState().standings.find((s) => s.id === id) ?? null; };
