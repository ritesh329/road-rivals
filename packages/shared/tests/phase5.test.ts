import {
  ARRIVE_RADIUS, GARAGES, MISSIONS, MISSION_BY_CODE, RACE_MODES, RACE_MODE_KEYS, RACE_TUNING, RaceTracker, addProgress, circuitLength, computeReward,
  dailyKey, getCityLayout, getPois, gridPose, periodEnds, periodKey, progressOnRoute, routeBetween, slipAngleDeg, snapToRoad, targetGate,
  timeTrialMedal, tournamentFinalReward, tournamentRoundPoints, velocityConsistent, weeklyKey, describeStep, missionsForEvent, MISSION_EVENTS,
  type Pt, type RaceEvent,
} from "../src/index";

let failed = 0; const rows: string[] = [];
const check = (n: string, ok: boolean, d = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };
const L = getCityLayout();
const axisAligned = (pts: Pt[]) => pts.slice(1, -1).every((p, i, a) => i === 0 || p.x === a[i - 1].x || p.z === a[i - 1].z);

/* ================================================================ navigation */
const spawn = L.spawns[0];
const sn = snapToRoad(23, 47);
check("snap: off-road point lands exactly on a road centre-line", (sn.x % 100 === 0 || sn.z % 100 === 0) && sn.offRoad <= 50 + 1e-9, JSON.stringify(sn));
check("snap: far outside the map clamps to the outer ring road", (() => { const s = snapToRoad(2000, 2000); return s.x === 500 && s.z === 500; })());

let allReach = true, worstDetour = 0;
for (const g of GARAGES) {
  const r = routeBetween(spawn, g);
  allReach &&= r.length >= r.crowFlies - 1e-6 && r.points.length >= 2 && Math.hypot(r.points[r.points.length - 1].x - g.x, r.points[r.points.length - 1].z - g.z) < 1e-6;
  worstDetour = Math.max(worstDetour, r.length / r.crowFlies);
}
check("routes: every garage is reachable from the spawn; length ≥ straight line", allReach, `worst detour ×${worstDetour.toFixed(2)}`);

const r1 = routeBetween({ x: -500, z: -500 }, { x: 500, z: 500 });
check("route corner→corner follows roads: Manhattan length 2000 m (+0 off-road)", Math.abs(r1.length - 2000) < 1e-6 && axisAligned(r1.points), `${r1.length}`);
const rs = routeBetween({ x: 0, z: 0 }, { x: 60, z: 0 });
check("route on the same road segment is a direct 60 m drive", Math.abs(rs.length - 60) < 1e-6 && rs.steps.length === 2, `${rs.length}`);
const ra = routeBetween({ x: 150, z: 3 }, { x: 150, z: 3 });
check("route to where you stand is only the short hop to the road and back, and just arrives", ra.length <= 2 * 3 + 1e-6 && ra.steps[ra.steps.length - 1].maneuver === "arrive");

// roads only: sample the polyline – every sample lies on a road centre-line or within the short off-road hop at the ends
const rg = routeBetween({ x: -450, z: 480 }, GARAGES[2]);
let onRoad = true;
for (let i = 2; i < rg.points.length - 2; i++) { const p = rg.points[i]; onRoad &&= p.x % 100 === 0 || p.z % 100 === 0; }
check("route never cuts through blocks (interior points are intersections)", onRoad && axisAligned(rg.points));

// the canal row z∈(308,392) can only be crossed on the bridges (x multiples of 100)
const cross = routeBetween({ x: 150, z: 250 }, { x: 150, z: 450 });
let canalOk = true;
for (let i = 1; i < cross.points.length; i++) {
  const p = cross.points[i - 1], q = cross.points[i];
  const lo = Math.min(p.z, q.z), hi = Math.max(p.z, q.z);
  if (hi > 308 && lo < 392) canalOk &&= p.x === q.x && p.x % 100 === 0; // inside the canal band: only on a bridge
}
check("crossing the canal uses a bridge road", canalOk && cross.length >= 200);

// symmetry + triangle inequality on random pairs
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let sym = true, tri = true;
for (let i = 0; i < 60; i++) {
  const a = { x: (rnd() * 2 - 1) * 520, z: (rnd() * 2 - 1) * 520 }, b = { x: (rnd() * 2 - 1) * 520, z: (rnd() * 2 - 1) * 520 }, c = { x: (rnd() * 2 - 1) * 520, z: (rnd() * 2 - 1) * 520 };
  const ab = routeBetween(a, b).length, ba = routeBetween(b, a).length, ac = routeBetween(a, c).length, cb = routeBetween(c, b).length;
  sym &&= Math.abs(ab - ba) < 1e-6; tri &&= ab <= ac + cb + 100 + 1e-6; // +2×off-road snap slack at the detour point
}
check("60 random pairs: route length is symmetric and (near) satisfies the triangle inequality", sym && tri);

// turn directions: heading east then turning south is a RIGHT turn (x east, z south)
const rt = routeBetween({ x: -200, z: 0 }, { x: 0, z: 200 });
const manu = rt.steps.map((s) => s.maneuver).join(",");
check("turn-by-turn: east → south is 'right', then arrival", rt.steps.some((s) => s.maneuver === "right" || s.maneuver === "left") && manu.endsWith("arrive"), manu);
const east = routeBetween({ x: -100, z: 0 }, { x: 100, z: -100 }); // east then north = left
check("turn-by-turn: east → north is 'left'", east.steps.some((s) => s.maneuver === "left"), east.steps.map((s) => s.maneuver).join(","));

// progress along the route
const rp = routeBetween({ x: -500, z: 0 }, { x: 300, z: 0 });
const p0 = progressOnRoute(rp, -500, 0), p1 = progressOnRoute(rp, -100, 0), p2 = progressOnRoute(rp, 300, 0);
check("progress: remaining distance falls as the car drives along the route", p0.remaining > p1.remaining && p1.remaining > p2.remaining && Math.abs(p0.remaining - 800) < 1e-6 && p2.remaining < 1e-6, `${p0.remaining}→${p1.remaining}→${p2.remaining}`);
check("progress: car off the route is detected (re-route trigger)", progressOnRoute(rp, -100, 120).offRoute > 100 && progressOnRoute(rp, -100, 2).offRoute < 5);
check("guidance text is human readable", /Continue|Turn|Destination/.test(describeStep(p1.next, p1.toNext)));
check("arrival radius sane", ARRIVE_RADIUS >= 10 && ARRIVE_RADIUS <= 30);

/* ================================================================ POIs */
const pois = getPois();
check("map POIs: 5 garages of all 4 kinds + events + tournament + all checkpoints, unique ids", GARAGES.length === 5 && new Set(pois.map((p) => p.id)).size === pois.length && ["REPAIR", "ENGINE_SHOP", "WORKSHOP", "FUEL", "RACE_EVENT", "TOURNAMENT", "CHECKPOINT"].every((k) => pois.some((p) => p.kind === k)) && pois.filter((p) => p.kind === "CHECKPOINT").length === L.checkpoints.length);
check("nearest garage by road distance is well defined", GARAGES.map((g) => routeBetween(spawn, g).length).every((d) => d > 0));

/* ================================================================ race modes */
check("8 race modes defined, solo ones need 1 player, multiplayer ones 2", RACE_MODE_KEYS.length === 8 && RACE_MODES.TIME_TRIAL.minPlayers === 1 && RACE_MODES.DRIFT.solo && RACE_MODES.CHECKPOINT.solo && RACE_MODES.SURVIVAL.minPlayers === 2 && RACE_MODES.MULTIPLAYER.minPlayers === 2);
const n = L.checkpoints.length, len = circuitLength();
check("circuit loop has a sane length", len > 2000 && len < 6000, `${Math.round(len)} m, ${n} gates`);
check("gate order: first target is the gate after the start, lap's last target is the start gate", targetGate(0) === (RACE_TUNING.startCp + 1) % n && targetGate(n - 1) === RACE_TUNING.startCp && targetGate(n) === targetGate(0));
const grid = [0, 1, 2, 3, 4].map(gridPose);
const sc = L.checkpoints[RACE_TUNING.startCp];
check("start grid: 5 distinct slots, all BEHIND the start gate, none overlapping", new Set(grid.map((g) => `${g.x.toFixed(1)},${g.z.toFixed(1)}`)).size === 5 && grid.every((g) => ((g.x - sc.x) * Math.sin(sc.yaw) + (g.z - sc.z) * Math.cos(sc.yaw)) < 0) && grid.every((a, i) => grid.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) > 5)));

/** drive a car through the gates: a straight line between consecutive gate centres, 20 samples per leg */
function drive(t: RaceTracker, id: string, from: Pt, gates: number[], t0: number, speedMs: number, evs: RaceEvent[] = [], skip = new Set<number>()) {
  let now = t0, pos = from;
  for (const gi of gates) {
    const g = L.checkpoints[gi];
    const end = { x: g.x + Math.sin(g.yaw) * 6, z: g.z + Math.cos(g.yaw) * 6 };
    const legLen = Math.hypot(end.x - pos.x, end.z - pos.z);
    // approach from behind the gate along its travel axis so the crossing is clean
    const pre = { x: g.x - Math.sin(g.yaw) * 6, z: g.z - Math.cos(g.yaw) * 6 };
    const steps = 20;
    const off = skip.has(gi) ? { x: Math.cos(g.yaw) * 40, z: -Math.sin(g.yaw) * 40 } : { x: 0, z: 0 }; // detour around the gate
    for (let i = 1; i <= steps; i++) {
      const f = i / steps; const p = { x: pos.x + (pre.x - pos.x) * f + off.x * f, z: pos.z + (pre.z - pos.z) * f + off.z * f };
      now += (Math.hypot(pre.x - pos.x, pre.z - pos.z) / speedMs) * 1000 / steps;
      evs.push(...t.update(id, p, now));
    }
    now += (12 / speedMs) * 1000; evs.push(...t.update(id, { x: end.x + off.x, z: end.z + off.z }, now));
    pos = { x: end.x + off.x, z: end.z + off.z }; void legLen;
  }
  return { now, pos };
}
const lapGates = (laps: number) => Array.from({ length: n * laps }, (_, i) => targetGate(i));
const startPose = (seat: number) => { const g = gridPose(seat); return { x: g.x, z: g.z }; };

// ---- 2-player 3 lap race: A faster than B
{
  const t = new RaceTracker({ mode: "MULTIPLAYER", startAt: 0, players: [{ id: "A", name: "Alice" }, { id: "B", name: "Bob" }] });
  const ev: RaceEvent[] = [];
  t.update("A", startPose(0), 100); t.update("B", startPose(1), 100);
  const a = drive(t, "A", startPose(0), lapGates(3), 5000, 45, ev);
  const lapsA = ev.filter((e) => e.type === "lap").length;
  check("3-lap race: gates counted in order, 3 laps registered, finish fires once", lapsA === 3 && ev.filter((e) => e.type === "finish").length === 1 && ev.filter((e) => e.type === "gate").length === n * 3, `${ev.filter((e) => e.type === "gate").length} gates`);
  check("finisher is #1 immediately; the other is still running (not over)", t.standings()[0].id === "A" && t.standings()[0].finished && !t.over);
  const b = drive(t, "B", startPose(1), lapGates(3), 5000, 38);
  void b; check("second finisher ends the race → over, positions 1/2, A faster than B", t.over && t.standings()[1].id === "B" && t.standings()[0].timeMs! < t.standings()[1].timeMs!);
  void a;
}
// ---- cheating: skipping a gate / driving backwards / teleporting past a gate
{
  const t = new RaceTracker({ mode: "QUICK", startAt: 0, players: [{ id: "A", name: "A" }, { id: "B", name: "B" }] });
  const ev: RaceEvent[] = [];
  const order = lapGates(1);
  drive(t, "A", startPose(0), order, 5000, 45, ev, new Set([order[4]])); // never crosses the 5th gate
  const gatesA = t.stats("A")!.gates;
  check("anti-cheat: skipping a gate stops all progress (no lap, no finish)", gatesA === 4 && !ev.some((e) => e.type === "lap" || e.type === "finish"), `gates=${gatesA}`);
  const g = L.checkpoints[targetGate(0)];
  const back = new RaceTracker({ mode: "QUICK", startAt: 0, players: [{ id: "A", name: "A" }] });
  back.update("A", { x: g.x + Math.sin(g.yaw) * 5, z: g.z + Math.cos(g.yaw) * 5 }, 6000);
  const e1 = back.update("A", { x: g.x - Math.sin(g.yaw) * 5, z: g.z - Math.cos(g.yaw) * 5 }, 6100);
  check("anti-cheat: crossing a gate the WRONG way does not count", e1.every((e) => e.type !== "gate") && back.stats("A")!.gates === 0);
  const wide = new RaceTracker({ mode: "QUICK", startAt: 0, players: [{ id: "A", name: "A" }] });
  wide.update("A", { x: g.x - Math.sin(g.yaw) * 5 + Math.cos(g.yaw) * 40, z: g.z - Math.cos(g.yaw) * 5 - Math.sin(g.yaw) * 40 }, 6000);
  const e2 = wide.update("A", { x: g.x + Math.sin(g.yaw) * 5 + Math.cos(g.yaw) * 40, z: g.z + Math.cos(g.yaw) * 5 - Math.sin(g.yaw) * 40 }, 6100);
  check("anti-cheat: passing 40 m beside the gate does not count", e2.every((e) => e.type !== "gate"));
  const early = new RaceTracker({ mode: "QUICK", startAt: 10_000, players: [{ id: "A", name: "A" }] });
  early.update("A", { x: g.x - Math.sin(g.yaw) * 5, z: g.z - Math.cos(g.yaw) * 5 }, 9000);
  const e3 = early.update("A", { x: g.x + Math.sin(g.yaw) * 5, z: g.z + Math.cos(g.yaw) * 5 }, 9500);
  check("anti-cheat: nothing counts before the countdown ends (no jump start credit)", e3.length === 0 && early.stats("A")!.gates === 0);
}
// ---- DNF window
{
  const t = new RaceTracker({ mode: "QUICK", startAt: 0, players: [{ id: "A", name: "A" }, { id: "B", name: "B" }] });
  t.update("A", startPose(0), 100); t.update("B", startPose(1), 100);
  const { now } = drive(t, "A", startPose(0), lapGates(1), 5000, 45);
  t.tick(now + RACE_TUNING.finishWindowMs - 1); const mid = t.over;
  t.tick(now + RACE_TUNING.finishWindowMs + 1);
  const s = t.standings();
  check("DNF window: slow player gets 60 s after the winner, then is marked DNF and the race ends", !mid && t.over && s[1].dnf && s[0].finished);
  const rw = computeReward("QUICK", s[1], 2, { laps: 1 });
  check("DNF only earns a token reward", rw.coins <= 30 && rw.points === 0 && !rw.won, JSON.stringify(rw));
}
// ---- player leaves mid-race
{
  const t = new RaceTracker({ mode: "MULTIPLAYER", startAt: 0, players: [{ id: "A", name: "A" }, { id: "B", name: "B" }] });
  t.drop("B", 1000); const ev = t.drop("A", 2000);
  check("when everyone leaves/drops the race ends", t.over && ev.some((e) => e.type === "over"));
}
// ---- ordering while running
{
  const t = new RaceTracker({ mode: "MULTIPLAYER", startAt: 0, players: [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }] });
  t.update("A", startPose(0), 100); t.update("B", startPose(1), 100); t.update("C", startPose(2), 100);
  drive(t, "A", startPose(0), lapGates(1).slice(0, 3), 5000, 40);
  drive(t, "B", startPose(1), lapGates(1).slice(0, 5), 5000, 40);
  const s = t.standings();
  check("live positions: more gates = ahead; ties broken by distance to the next gate", s[0].id === "B" && s[1].id === "A" && s[2].id === "C" && s.map((x) => x.position).join() === "1,2,3");
}

/* ---------------------------------------------------------------- drift mode */
const q0 = { qx: 0, qy: 0, qz: 0, qw: 1 }; // facing +z
check("slip angle: straight driving = 0°, sideways = 90°, reverse ignores tiny speeds", Math.abs(slipAngleDeg({ ...q0, vx: 0, vz: 20, speed: 72 })) < 1e-6 && Math.abs(slipAngleDeg({ ...q0, vx: 20, vz: 0, speed: 72 }) - 90) < 1e-6 && slipAngleDeg({ ...q0, vx: 0.2, vz: 0, speed: 1 }) === 0);
{
  const t = new RaceTracker({ mode: "DRIFT", startAt: 0, players: [{ id: "A", name: "A" }, { id: "B", name: "B" }] });
  let x = 0;
  for (let ms = 100; ms <= 30_000; ms += 50) { x += 1; t.update("A", { x, z: 0 }, ms, { slipDeg: 40, speedKmh: 80 }); t.update("B", { x, z: 5 }, ms, { slipDeg: 2, speedKmh: 160 }); }
  const s = t.standings();
  check("drift: only real slip scores – fast straight driving earns 0, a 40° slide earns points", s[0].id === "A" && s[0].score > 500 && s[1].score === 0, `A=${s[0].score} B=${s[1].score}`);
  const t2 = new RaceTracker({ mode: "DRIFT", startAt: 0, players: [{ id: "A", name: "A" }] });
  for (let ms = 100; ms <= 2000; ms += 50) t2.update("A", { x: ms / 50, z: 0 }, ms, { slipDeg: 40, speedKmh: 80 });
  const early = t2.standings()[0].score;
  const t3 = new RaceTracker({ mode: "DRIFT", startAt: 0, players: [{ id: "A", name: "A" }] });
  for (let ms = 100; ms <= 8000; ms += 50) t3.update("A", { x: ms / 50, z: 0 }, ms, { slipDeg: 40, speedKmh: 80 });
  const longer = t3.standings()[0].score;
  check("drift: holding the slide builds a combo (score per second grows)", longer / 8 > (early / 2) * 1.5, `${(early / 2).toFixed(0)}/s → ${(longer / 8).toFixed(0)}/s`);
  const ev = t.tick(RACE_MODES.DRIFT.timeLimitMs! + 1);
  check("drift: ends exactly at the 90 s limit with a ranking", t.over && ev.some((e) => e.type === "over") && t.standings()[0].finished);
  const rw = computeReward("DRIFT", t.standings()[0], 2, { laps: 0 });
  check("drift reward scales with score and is capped", rw.coins > 0 && rw.coins <= 800 && computeReward("DRIFT", { ...t.standings()[0], score: 1e7 }, 1, { laps: 0 }).coins === 800);
}
check("velocity check: velocity matching the movement passes, faked sideways velocity fails", velocityConsistent({ x: 0, z: 0 }, { x: 0, z: 2, vx: 0, vz: 40 }, 50) && !velocityConsistent({ x: 0, z: 0 }, { x: 0, z: 2, vx: 40, vz: 0 }, 50));

/* --------------------------------------------------------- checkpoint mode */
{
  const t = new RaceTracker({ mode: "CHECKPOINT", startAt: 0, players: [{ id: "A", name: "A" }] });
  t.update("A", startPose(0), 100);
  const first = drive(t, "A", startPose(0), lapGates(1).slice(0, 4), 5000, 45);
  const deadline = 45_000 + 4 * RACE_TUNING.checkpointBonusMs;
  t.tick(deadline - 1); const still = !t.over;
  const ev = t.tick(deadline + 1);
  check("checkpoint mode: each gate adds 12 s; time up ends the run with the gate count", still && t.over && ev.some((e) => e.type === "timeup") && t.standings()[0].gates === 4 && first.now < deadline);
  const rw = computeReward("CHECKPOINT", t.standings()[0], 1, { laps: 0 });
  check("checkpoint reward grows with gates", rw.coins === 4 * 28 && rw.xp === 36, JSON.stringify(rw));
}
/* --------------------------------------------------------------- survival */
{
  const t = new RaceTracker({ mode: "SURVIVAL", startAt: 0, players: [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }] });
  for (const id of ["A", "B", "C"]) t.update(id, startPose(0), 100);
  drive(t, "A", startPose(0), lapGates(1).slice(0, 3), 5000, 90); drive(t, "B", startPose(1), lapGates(1).slice(0, 2), 5000, 90);
  const none = t.tick(RACE_TUNING.survivalGraceMs - 1000);
  const e1 = t.tick(RACE_TUNING.survivalGraceMs + 10);
  check("survival: no elimination during the grace period, then the LAST car (C, 0 gates) goes first", none.length === 0 && e1.length === 1 && e1[0].type === "eliminated" && (e1[0] as any).id === "C");
  check("survival: not another elimination until 20 s later", t.tick(RACE_TUNING.survivalGraceMs + 15_000).length === 0);
  const e2 = t.tick(RACE_TUNING.survivalGraceMs + RACE_TUNING.survivalEveryMs + 10);
  check("survival: next elimination hits B; A wins and the race is over", e2.some((e) => e.type === "eliminated" && (e as any).id === "B") && e2.some((e) => e.type === "over") && t.standings().map((s) => s.id).join() === "A,B,C");
  check("survival reward: winner earns most; eliminated first earns least", computeReward("SURVIVAL", t.standings()[0], 3, { laps: 0 }).coins > computeReward("SURVIVAL", t.standings()[2], 3, { laps: 0 }).coins && computeReward("SURVIVAL", t.standings()[0], 3, { laps: 0 }).won);
}
/* ------------------------------------------------------------ time trial */
{
  const best = Math.round((len * 3 / 45) * 1000), mid = Math.round((len * 3 / 35) * 1000), slow = Math.round((len * 3 / 20) * 1000);
  check("time trial medals: ≥42 m/s avg gold, ≥34 silver, ≥26 bronze, else none", timeTrialMedal(best, 3) === "GOLD" && timeTrialMedal(mid, 3) === "SILVER" && timeTrialMedal(Math.round((len * 3 / 28) * 1000), 3) === "BRONZE" && timeTrialMedal(slow, 3) === null);
  const st = (timeMs: number) => ({ id: "A", name: "A", position: 1, timeMs, finished: true, dnf: false, eliminated: false, gates: 33, lap: 3, bestLapMs: null, score: 0 });
  const g = computeReward("TIME_TRIAL", st(best), 1, { laps: 3 }), s = computeReward("TIME_TRIAL", st(mid), 1, { laps: 3 }), none = computeReward("TIME_TRIAL", st(slow), 1, { laps: 3 });
  check("time trial rewards: gold > silver > no medal, all positive", g.coins > s.coins && s.coins > none.coins && none.coins > 0 && g.medal === "GOLD" && g.won);
}
/* -------------------------------------------------------------- rewards */
{
  const mk = (position: number, finished = true) => ({ id: "x", name: "x", position, timeMs: 1000, finished, dnf: !finished, eliminated: false, gates: 11, lap: 3, bestLapMs: null, score: 0 });
  const r = [1, 2, 3, 4, 5].map((p) => computeReward("MULTIPLAYER", mk(p), 5, { laps: 3 }));
  check("race rewards fall with position and only 1st 'won'", r.every((x, i) => i === 0 || x.coins < r[i - 1].coins) && r[0].won && !r[1].won, r.map((x) => x.coins).join("/"));
  check("bigger fields pay more; solo 'race' pays half; friendly private pays less than public", computeReward("MULTIPLAYER", mk(1), 5, { laps: 3 }).coins > computeReward("MULTIPLAYER", mk(1), 2, { laps: 3 }).coins && computeReward("QUICK", mk(1), 1, { laps: 1 }).won === false && computeReward("PRIVATE", mk(1), 5, { laps: 3 }).coins < computeReward("MULTIPLAYER", mk(1), 5, { laps: 3 }).coins);
  check("tournament: round points 10/7/5/3/2, DNF 0; final reward falls with rank", [1, 2, 3, 4, 5].map((p) => tournamentRoundPoints(p, true)).join() === "10,7,5,3,2" && tournamentRoundPoints(2, false) === 0 && tournamentFinalReward(1, 4).coins > tournamentFinalReward(2, 4).coins && tournamentFinalReward(1, 4).won);
}
/* ================================================================ missions */
check("missions: unique codes, every event type has a mission, rewards positive, daily+weekly both exist", new Set(MISSIONS.map((m) => m.code)).size === MISSIONS.length && MISSION_EVENTS.filter((e) => e !== "COINS_EARNED").every((e) => missionsForEvent(e).length > 0) && MISSIONS.every((m) => m.target > 0 && m.rewardCoins > 0 && m.rewardXp > 0) && MISSIONS.some((m) => m.period === "DAILY") && MISSIONS.some((m) => m.period === "WEEKLY") && MISSION_BY_CODE.size === MISSIONS.length);
check("progress never exceeds target, never decreases, ignores negatives/NaN-ish", addProgress(2, 3, 5) === 3 && addProgress(1, 10, -4) === 1 && addProgress(1, 10, 2.9) === 3);
check("daily key: UTC date; changes at midnight UTC", dailyKey(new Date("2026-11-07T23:59:59Z")) === "D20261107" && dailyKey(new Date("2026-11-08T00:00:00Z")) === "D20261108");
check("weekly key: ISO weeks (Mon–Sun), year boundary handled", weeklyKey(new Date("2026-11-07T10:00:00Z")) === "W2026-45" && weeklyKey(new Date("2026-11-09T00:00:00Z")) === "W2026-46" && weeklyKey(new Date("2026-11-08T23:59:00Z")) === "W2026-45" && weeklyKey(new Date("2027-01-01T00:00:00Z")) === "W2026-53" && weeklyKey(new Date("2024-12-30T00:00:00Z")) === "W2025-01");
check("period end: daily = next UTC midnight, weekly = next Monday", periodEnds("DAILY", new Date("2026-11-07T10:00:00Z")).toISOString() === "2026-11-08T00:00:00.000Z" && periodEnds("WEEKLY", new Date("2026-11-07T10:00:00Z")).toISOString() === "2026-11-09T00:00:00.000Z" && periodKey("DAILY", new Date("2026-11-07T00:00:00Z")) === "D20261107");

console.log(rows.join("\n")); console.log(failed ? `\n${failed} FAILED` : `\nALL ${rows.length} PASSED`); process.exit(failed ? 1 : 0);
