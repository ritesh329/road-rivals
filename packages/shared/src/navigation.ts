/**
 * ROAD RIVALS – GPS navigation over the real road network (pure TypeScript, no dependencies).
 *
 * The city's roads are the 11 × 11 grid of centre-lines at multiples of PITCH (see world.ts).
 * `routeBetween` snaps start and destination onto the nearest road, runs A* over the intersection
 * graph (so the route follows roads, never a straight line through buildings or the canal) and
 * returns a polyline + turn-by-turn steps. `progressOnRoute` tells the HUD how far along the
 * route the car is, how far to the next turn and whether the car left the route (→ re-route).
 */
import { GRID_MAX, GRID_MIN, PITCH } from "./world";

const N = GRID_MAX - GRID_MIN + 1;          // 11 road lines per axis
const NODES = N * N;                         // 121 intersections
const S_NODE = NODES, T_NODE = NODES + 1;   // virtual start / target nodes sitting on a road segment

export interface Pt { x: number; z: number }
const nodeId = (a: number, b: number) => (a - GRID_MIN) * N + (b - GRID_MIN);
const nodeA = (id: number) => Math.floor(id / N) + GRID_MIN;
const nodeB = (id: number) => (id % N) + GRID_MIN;
const nodePt = (id: number): Pt => ({ x: nodeA(id) * PITCH, z: nodeB(id) * PITCH });
const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const EXTENT = GRID_MAX * PITCH;

/** A point on a road: the road segment it lies on (between two adjacent intersections) and its exact position. */
export interface RoadSnap { x: number; z: number; a: number; b: number; ends: [number, number]; offRoad: number }

/** Snap any world position to the nearest point of the road network. */
export function snapToRoad(x: number, z: number): RoadSnap {
  // candidate on the nearest north-south road (x = a·PITCH) and on the nearest east-west road (z = b·PITCH)
  const a = clamp(Math.round(x / PITCH), GRID_MIN, GRID_MAX);
  const b = clamp(Math.round(z / PITCH), GRID_MIN, GRID_MAX);
  const vz = clamp(z, -EXTENT, EXTENT), hx = clamp(x, -EXTENT, EXTENT);
  const dv = Math.hypot(x - a * PITCH, z - vz);
  const dh = Math.hypot(x - hx, z - b * PITCH);
  if (dv <= dh) {
    // on the road x = a·PITCH, running along z: segment between b0 and b0+1
    const b0 = clamp(Math.floor(vz / PITCH), GRID_MIN, GRID_MAX - 1);
    return { x: a * PITCH, z: vz, a, b: b0, ends: [nodeId(a, b0), nodeId(a, b0 + 1)], offRoad: dv };
  }
  const a0 = clamp(Math.floor(hx / PITCH), GRID_MIN, GRID_MAX - 1);
  return { x: hx, z: b * PITCH, a: a0, b, ends: [nodeId(a0, b), nodeId(a0 + 1, b)], offRoad: dh };
}

function neighbours(id: number): number[] {
  const a = nodeA(id), b = nodeB(id), out: number[] = [];
  if (a > GRID_MIN) out.push(nodeId(a - 1, b));
  if (a < GRID_MAX) out.push(nodeId(a + 1, b));
  if (b > GRID_MIN) out.push(nodeId(a, b - 1));
  if (b < GRID_MAX) out.push(nodeId(a, b + 1));
  return out;
}

export type Maneuver = "start" | "straight" | "left" | "right" | "uturn" | "arrive";
export interface RouteStep { maneuver: Maneuver; x: number; z: number; /** metres from the start of the route to this step */ at: number }
export interface Route {
  /** polyline: start → road → … → road → destination */
  points: Pt[];
  /** cumulative length at every point */
  cum: number[];
  length: number;
  steps: RouteStep[];
  /** straight-line distance start → destination (for "x m away" labels) */
  crowFlies: number;
}

/**
 * Shortest road route between two world positions. Never returns null: every position snaps to
 * some road and the grid is fully connected. Cost is road distance + the short off-road hops.
 */
export function routeBetween(from: Pt, to: Pt): Route {
  const s = snapToRoad(from.x, from.z), t = snapToRoad(to.x, to.z);
  const sP: Pt = { x: s.x, z: s.z }, tP: Pt = { x: t.x, z: t.z };
  const sameSeg = s.ends[0] === t.ends[0] && s.ends[1] === t.ends[1];

  const pos = (id: number): Pt => (id === S_NODE ? sP : id === T_NODE ? tP : nodePt(id));
  const edges = (id: number): number[] => {
    if (id === S_NODE) return sameSeg ? [...s.ends, T_NODE] : s.ends;
    if (id === T_NODE) return sameSeg ? [...t.ends, S_NODE] : t.ends;
    const out = neighbours(id);
    if (!sameSeg && s.ends.includes(id)) out.push(S_NODE);
    else if (sameSeg && s.ends.includes(id)) out.push(S_NODE, T_NODE);
    if (!sameSeg && t.ends.includes(id)) out.push(T_NODE);
    return out;
  };

  // A* (euclidean heuristic is admissible on an axis-aligned grid)
  const g = new Map<number, number>([[S_NODE, 0]]);
  const prev = new Map<number, number>();
  const open: { id: number; f: number }[] = [{ id: S_NODE, f: dist(sP, tP) }];
  const done = new Set<number>();
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { id } = open.splice(bi, 1)[0];
    if (done.has(id)) continue;
    if (id === T_NODE) break;
    done.add(id);
    for (const nb of edges(id)) {
      if (done.has(nb)) continue;
      const ng = g.get(id)! + dist(pos(id), pos(nb));
      if (ng < (g.get(nb) ?? Infinity)) { g.set(nb, ng); prev.set(nb, id); open.push({ id: nb, f: ng + dist(pos(nb), tP) }); }
    }
  }

  const ids: number[] = [];
  for (let c: number | undefined = T_NODE; c !== undefined; c = prev.get(c)) { ids.push(c); if (c === S_NODE) break; }
  ids.reverse();

  // polyline: the real start, then the road path, then the real destination (drop zero-length hops)
  const pts: Pt[] = [{ x: from.x, z: from.z }, ...ids.map(pos), { x: to.x, z: to.z }];
  const points: Pt[] = [];
  for (const p of pts) { const l = points[points.length - 1]; if (!l || dist(l, p) > 0.01) points.push(p); }
  if (points.length === 1) points.push({ x: points[0].x, z: points[0].z });
  const cum = [0]; for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));

  return { points, cum, length: cum[cum.length - 1], steps: buildSteps(points, cum), crowFlies: dist(from, to) };
}

function buildSteps(points: Pt[], cum: number[]): RouteStep[] {
  const steps: RouteStep[] = [{ maneuver: "start", x: points[0].x, z: points[0].z, at: 0 }];
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x, az = points[i].z - points[i - 1].z;
    const bx = points[i + 1].x - points[i].x, bz = points[i + 1].z - points[i].z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 0.5 || lb < 0.5) continue;
    const cross = (ax * bz - az * bx) / (la * lb), dot = (ax * bx + az * bz) / (la * lb);
    // x east, z south: cross > 0 is a right turn when looking at the map with north up
    const m: Maneuver = dot < -0.9 ? "uturn" : Math.abs(cross) < 0.3 ? "straight" : cross > 0 ? "right" : "left";
    if (m !== "straight") steps.push({ maneuver: m, x: points[i].x, z: points[i].z, at: cum[i] });
  }
  const last = points[points.length - 1];
  steps.push({ maneuver: "arrive", x: last.x, z: last.z, at: cum[cum.length - 1] });
  return steps;
}

export interface RouteProgress {
  /** metres of route still to drive */
  remaining: number;
  /** metres from the car to the next turn / arrival */
  toNext: number;
  next: RouteStep;
  /** distance from the car to the route line – large means the driver left the route */
  offRoute: number;
  /** distance along the route (m) of the closest point */
  along: number;
}

/** Project the car onto the route polyline. */
export function progressOnRoute(route: Route, x: number, z: number): RouteProgress {
  let best = Infinity, along = 0;
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1], q = route.points[i];
    const dx = q.x - p.x, dz = q.z - p.z, len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : clamp(((x - p.x) * dx + (z - p.z) * dz) / len2, 0, 1);
    const d = Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t));
    if (d < best) { best = d; along = route.cum[i - 1] + Math.sqrt(len2) * t; }
  }
  const next = route.steps.find((s) => s.at > along + 1) ?? route.steps[route.steps.length - 1];
  return { remaining: Math.max(0, route.length - along), toNext: Math.max(0, next.at - along), next, offRoute: best, along };
}

/** Human text for a step, e.g. "Turn left in 120 m". */
export function describeStep(step: RouteStep, toNext: number): string {
  const d = toNext >= 1000 ? `${(toNext / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(toNext / 10) * 10)} m`;
  switch (step.maneuver) {
    case "left": return `Turn left in ${d}`;
    case "right": return `Turn right in ${d}`;
    case "uturn": return `Make a U-turn in ${d}`;
    case "arrive": return toNext < 25 ? "You have arrived" : `Destination in ${d}`;
    default: return `Continue for ${d}`;
  }
}

export const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 5) * 5} m`);
/** Points where the driver is considered to have arrived. */
export const ARRIVE_RADIUS = 18;
/** Re-route when the car is this far from the planned route. */
export const REROUTE_DISTANCE = 35;
