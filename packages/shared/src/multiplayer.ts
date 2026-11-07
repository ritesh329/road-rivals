/**
 * ROAD RIVALS – multiplayer protocol helpers shared by server and client (pure TypeScript).
 *  - room codes / chat sanitising
 *  - NetState: what a client broadcasts 20×/s, validated + plausibility-checked on the server
 *  - SnapshotBuffer: client-side interpolation so remote cars move smoothly despite network jitter
 */
import { z } from "zod";
import { getCityLayout } from "./world";

export const MP = {
  maxPlayers: 5,
  sendHz: 20,
  /** remote cars are rendered this far in the past so there is always a snapshot to interpolate to */
  interpDelayMs: 120,
  extrapolateMs: 200,
  chatMax: 140,
  minStateIntervalMs: 30,   // server drops faster-than-33 Hz spam
} as const;

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function generateRoomCode(randInt: (maxExclusive: number) => number, len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += ROOM_CODE_ALPHABET[randInt(ROOM_CODE_ALPHABET.length)];
  return s;
}
export const normalizeRoomCode = (c: string) => c.trim().toUpperCase();
export const isRoomCode = (c: string) => new RegExp(`^[${ROOM_CODE_ALPHABET}]{6}$`).test(c);

/** Strip control chars / collapse whitespace; null when empty. */
export function cleanChat(text: unknown): string | null {
  if (typeof text !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MP.chatMax);
  return t.length ? t : null;
}

export interface NetState {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  steer: number;            // -1..1, drives the front wheels of the remote model
  speed: number;            // km/h (HUD name tags)
  nitro: boolean; braking: boolean; drifting: boolean;
}

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
export const netStateSchema = z.object({
  x: num(-2000, 2000), y: num(-60, 200), z: num(-2000, 2000),
  qx: num(-1.01, 1.01), qy: num(-1.01, 1.01), qz: num(-1.01, 1.01), qw: num(-1.01, 1.01),
  vx: num(-250, 250), vy: num(-250, 250), vz: num(-250, 250),
  steer: num(-1, 1), speed: num(-400, 400),
  nitro: z.boolean(), braking: z.boolean(), drifting: z.boolean(),
}).strict();

/** Validate + normalise the quaternion. Returns null for anything malformed. */
export function sanitizeState(raw: unknown): NetState | null {
  const p = netStateSchema.safeParse(raw);
  if (!p.success) return null;
  const s = p.data;
  const n = Math.hypot(s.qx, s.qy, s.qz, s.qw);
  if (n < 0.5) return null;
  return { ...s, qx: s.qx / n, qy: s.qy / n, qz: s.qz / n, qw: s.qw / n };
}

/**
 * Plausibility of a position update (until a full authoritative sim exists): the car can't cover
 * ground faster than ~1.5× its own top speed (+ margin for ramps / falls / collisions pushing it).
 * Legit teleports (respawn, garage) must go through the `game:respawn` event.
 */
export function plausibleMove(prev: { x: number; y: number; z: number; at: number }, next: { x: number; y: number; z: number }, nowMs: number, topSpeedMs: number) {
  const dt = Math.max(nowMs - prev.at, 50) / 1000;
  const speed = Math.hypot(next.x - prev.x, next.z - prev.z) / dt;
  return { ok: speed <= topSpeedMs * 1.5 + 25, speed };
}

/** Where seat 0..4 spawns (same grid the single-player spawn uses). */
export function seatPose(seat: number) {
  const sp = getCityLayout().spawns;
  return sp[((seat % sp.length) + sp.length) % sp.length];
}

/* ------------------------------------------------------- interpolation */

function slerp(a: [number, number, number, number], b: [number, number, number, number], t: number): [number, number, number, number] {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
  let s0: number, s1: number;
  if (dot > 0.9995) { s0 = 1 - t; s1 = t; }
  else { const th = Math.acos(dot), sn = Math.sin(th); s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn; }
  const q: [number, number, number, number] = [s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw];
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Time-ordered snapshots; `sample(t)` interpolates (or briefly extrapolates) at render time t. */
export class SnapshotBuffer {
  private snaps: { t: number; s: NetState }[] = [];
  constructor(private max = 40) {}
  get length() { return this.snaps.length; }
  clear() { this.snaps = []; }
  push(t: number, s: NetState) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && t <= last.t) return; // out-of-order / duplicate
    this.snaps.push({ t, s });
    if (this.snaps.length > this.max) this.snaps.shift();
  }
  sample(t: number): NetState | null {
    const a = this.snaps;
    if (!a.length) return null;
    if (t <= a[0].t) return a[0].s;
    const last = a[a.length - 1];
    if (t >= last.t) {
      const dt = Math.min(t - last.t, MP.extrapolateMs) / 1000;
      return { ...last.s, x: last.s.x + last.s.vx * dt, y: last.s.y + last.s.vy * dt, z: last.s.z + last.s.vz * dt };
    }
    let i = a.length - 1;
    while (i > 0 && a[i - 1].t > t) i--;
    const p = a[i - 1], q = a[i];
    const k = (t - p.t) / (q.t - p.t);
    const L = (u: number, v: number) => u + (v - u) * k;
    const [qx, qy, qz, qw] = slerp([p.s.qx, p.s.qy, p.s.qz, p.s.qw], [q.s.qx, q.s.qy, q.s.qz, q.s.qw], k);
    return {
      x: L(p.s.x, q.s.x), y: L(p.s.y, q.s.y), z: L(p.s.z, q.s.z), qx, qy, qz, qw,
      vx: L(p.s.vx, q.s.vx), vy: L(p.s.vy, q.s.vy), vz: L(p.s.vz, q.s.vz),
      steer: L(p.s.steer, q.s.steer), speed: L(p.s.speed, q.s.speed),
      nitro: q.s.nitro, braking: q.s.braking, drifting: q.s.drifting,
    };
  }
}

/** Appearance the server sends for each player (loaded from the DB – never trusted from the client). */
export interface PlayerAppearance {
  name: string; category: string; baseStats: Record<string, number>;
  parts: { type: string; tier: number }[]; config: Record<string, string | null>;
  damage: Record<string, number>;
}
export interface NetPlayer { id: string; username: string; seat: number; appearance: PlayerAppearance; state: NetState | null }
