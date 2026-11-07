/**
 * Race orchestration tests (countdown → running → results → tournament rounds) with a fake clock,
 * fake socket layer and fake persistence. No database / network needed.
 * Run: npm run test:race -w @road-rivals/server
 */
import { RACE_TUNING, circuitLength, getCityLayout, gridPose, targetGate, type RaceModeKey } from "@road-rivals/shared";
import { RaceError, RaceOrchestrator, type Persisted, type Racer, type RaceDeps, type RoundResult } from "../src/services/raceSession";

let failed = 0; const rows: string[] = [];
const check = (n: string, ok: boolean, d = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };
const L = getCityLayout(); const N = L.checkpoints.length;

/* ---- fakes */
class Clock {
  t = 1_000_000; private timers: { at: number; fn: () => void; every?: number; dead: boolean }[] = [];
  now = () => this.t;
  every = (fn: () => void, ms: number) => { const x = { at: this.t + ms, fn, every: ms, dead: false }; this.timers.push(x); return () => { x.dead = true; }; };
  after = (fn: () => void, ms: number) => { const x = { at: this.t + ms, fn, dead: false }; this.timers.push(x); return () => { x.dead = true; }; };
  to(target: number) {
    for (;;) {
      this.timers = this.timers.filter((x) => !x.dead);
      const next = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.t = Math.max(this.t, next.at); next.fn(); if (next.every) next.at += next.every; else next.dead = true;
    }
    this.t = Math.max(this.t, target);
  }
}
function setup(present: Racer[]) {
  const clock = new Clock();
  const sent: { room?: string; user?: string; event: string; payload: any }[] = [];
  const teleports: { userId: string; pose: any }[] = [];
  const persisted: RoundResult[] = [];
  let here = present;
  const deps: RaceDeps = {
    now: clock.now, every: clock.every, after: clock.after,
    emit: (room, event, payload) => sent.push({ room, event, payload }),
    emitUser: (user, event, payload) => sent.push({ user, event, payload }),
    teleport: (_r, userId, pose) => teleports.push({ userId, pose }),
    present: () => here,
    persist: async (r): Promise<Persisted[]> => { persisted.push(r); return r.rows.map((x) => ({ userId: x.userId, coinsAwarded: x.coins, xpAwarded: x.xp, capped: false })); },
  };
  const orch = new RaceOrchestrator(deps);
  return { clock, sent, teleports, persisted, orch, setPresent: (p: Racer[]) => { here = p; } };
}
const ev = (s: ReturnType<typeof setup>, name: string) => s.sent.filter((x) => x.event === name);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** timestamped samples of a car driving through gates (straight lines, clean crossing) */
function plan(from: { x: number; z: number }, gates: number[], t0: number, speed: number, skip = new Set<number>()) {
  const out: { t: number; x: number; z: number; vx: number; vz: number; yaw: number }[] = [];
  let t = t0, pos = from;
  for (const gi of gates) {
    const g = L.checkpoints[gi], fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
    const off = skip.has(gi) ? { x: Math.cos(g.yaw) * 45, z: -Math.sin(g.yaw) * 45 } : { x: 0, z: 0 };
    const pre = { x: g.x - fx * 6 + off.x, z: g.z - fz * 6 + off.z }, end = { x: g.x + fx * 6 + off.x, z: g.z + fz * 6 + off.z };
    for (const [a, b] of [[pos, pre], [pre, end]] as const) {
      const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(d / 1.5)), dt = (d / speed) * 1000 / n;
      for (let i = 1; i <= n; i++) { t += dt; const f = i / n; out.push({ t: Math.round(t), x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, vx: ((b.x - a.x) / d) * speed, vz: ((b.z - a.z) / d) * speed, yaw: Math.atan2(b.x - a.x, b.z - a.z) }); }
    }
    pos = end;
  }
  return out;
}
function play(s: ReturnType<typeof setup>, room: string, runs: Record<string, ReturnType<typeof plan>>) {
  const all = Object.entries(runs).flatMap(([id, a]) => a.map((p) => ({ id, ...p }))).sort((a, b) => a.t - b.t);
  for (const p of all) {
    s.clock.to(p.t);
    s.orch.onState(room, p.id, { x: p.x, z: p.z, vx: p.vx, vz: p.vz, qx: 0, qy: Math.sin(p.yaw / 2), qz: 0, qw: Math.cos(p.yaw / 2), speed: Math.hypot(p.vx, p.vz) * 3.6 }, p.t);
  }
}
const lapGates = (laps: number) => Array.from({ length: N * laps }, (_, i) => targetGate(i));
const A: Racer = { userId: "A", username: "Alice", seat: 0 }, B: Racer = { userId: "B", username: "Bob", seat: 1 }, C: Racer = { userId: "C", username: "Cara", seat: 2 };
const gp = (seat: number) => { const g = gridPose(seat); return { x: g.x, z: g.z }; };

(async () => {
  /* ---- start rules */
  {
    const s = setup([A]);
    let e: unknown; try { s.orch.start({ id: "r1", code: "AAAAAA", mode: "MULTIPLAYER" }); } catch (x) { e = x; }
    check("multiplayer race refuses to start with 1 driver (409)", e instanceof RaceError && e.status === 409);
    s.orch.start({ id: "r1", code: "AAAAAA", mode: "TIME_TRIAL" });
    let e2: unknown; try { s.orch.start({ id: "r1", code: "AAAAAA", mode: "TIME_TRIAL" }); } catch (x) { e2 = x; }
    check("cannot start a second race while one runs (409)", e2 instanceof RaceError && e2.status === 409);
    s.orch.dispose("r1");
  }

  /* ---- solo time trial, full 3 laps */
  {
    const s = setup([A]);
    const r = s.orch.start({ id: "r1", code: "AAAAAA", mode: "TIME_TRIAL" });
    const cd = ev(s, "race:countdown")[0]?.payload;
    check("countdown event: mode, 3 laps, start 5 s ahead, racer list", cd?.mode === "TIME_TRIAL" && cd.laps === 3 && cd.startAt - cd.serverNow === RACE_TUNING.countdownMs && cd.racers.length === 1);
    check("every racer is snapped to its grid slot behind the start gate", s.teleports.length === 1 && Math.abs(s.teleports[0].pose.x - gridPose(0).x) < 1e-9);
    // jump start: movement during countdown must not count
    const early = plan(gp(0), lapGates(1).slice(0, 2), s.clock.t + 500, 60);
    play(s, "r1", { A: early.filter((p) => p.t < r.startAt) });
    check("no gate credit during the countdown", s.orch.summary("r1")!.standings[0].gates === 0);
    check("respawn point before the first gate is the grid slot", Math.abs(s.orch.respawnPose("r1", "A")!.x - gridPose(0).x) < 1e-9);
    s.clock.to(r.startAt + 1);
    check("'race:go' fires when the countdown ends", ev(s, "race:go").length === 1 && s.orch.summary("r1")!.phase === "RUNNING");
    const run = plan(gp(0), lapGates(3), r.startAt + 1000, 50);
    play(s, "r1", { A: run.slice(0, 200) });
    const rp = s.orch.respawnPose("r1", "A")!;
    const g0 = L.checkpoints[targetGate(Math.max(0, s.orch.summary("r1")!.standings[0].gates - 1))];
    check("after passing a gate the respawn point moves to just behind THAT gate (server-decided)", s.orch.summary("r1")!.standings[0].gates > 0 && Math.hypot(rp.x - (g0.x + Math.sin(g0.yaw) * 4), rp.z - (g0.z + Math.cos(g0.yaw) * 4)) < 1e-6 && Math.abs(rp.yaw - g0.yaw) < 1e-9);
    play(s, "r1", { A: run.slice(200) });
    await flush();
    const res = ev(s, "race:results")[0]?.payload;
    const total = (run[run.length - 1].t - r.startAt) / 1000;
    check("3 laps → results broadcast once with position 1, finish time, medal and reward", !!res && res.rows.length === 1 && res.rows[0].position === 1 && res.rows[0].finished && res.rows[0].medal !== undefined && res.rows[0].coins > 0 && ev(s, "race:results").length === 1, `time ${total.toFixed(1)} s, medal ${res?.rows[0].medal}`);
    check("average speed ≈ 50 m/s → GOLD medal and the reward matches gold", res.rows[0].medal === "GOLD" && res.rows[0].coins === 500, `${(circuitLength() * 3 / total).toFixed(1)} m/s`);
    check("results persisted exactly once, with the server's own numbers", s.persisted.length === 1 && s.persisted[0].rows[0].laps === 3 && s.persisted[0].mode === "TIME_TRIAL");
    const me = s.persisted[0].missionEvents.filter((m) => m.userId === "A").map((m) => `${m.event}:${m.amount}`).sort().join(",");
    check("mission events: race finished, 3 laps, 33 gates – and NO race-won for a solo run", me === "GATES:33,LAP:3,RACE_FINISHED:1", me);
    check("no more standings broadcast after the race is over", (() => { const n = ev(s, "race:standings").length; s.clock.to(s.clock.t + 5000); return ev(s, "race:standings").length === n; })());
  }

  /* ---- 2 players: winner, DNF window, anti-cheat gate skip */
  {
    const s = setup([A, B]);
    const r = s.orch.start({ id: "r2", code: "BBBBBB", mode: "MULTIPLAYER" });
    s.clock.to(r.startAt + 1);
    const fast = plan(gp(0), lapGates(3), r.startAt + 500, 55);
    const cheat = plan(gp(1), lapGates(3), r.startAt + 500, 40, new Set([targetGate(1)])); // detours around the 2nd gate every lap
    play(s, "r2", { A: fast, B: cheat });
    const mid = s.orch.summary("r2")!;
    check("winner finished; the gate-skipper is stuck at the skipped gate (1 gate counted) and cannot finish", mid.standings[0].id === "A" && mid.standings[0].finished && mid.standings[1].gates === 1 && !mid.standings[1].finished && mid.phase === "RUNNING");
    s.clock.to(s.clock.t + RACE_TUNING.finishWindowMs + 1000); await flush();
    const res = ev(s, "race:results")[0]?.payload;
    const b = res?.rows.find((x: any) => x.userId === "B"), a = res?.rows.find((x: any) => x.userId === "A");
    check("after the 60 s window B is DNF with token reward, A won with full reward", !!res && b.dnf && !b.finished && b.coins < a.coins * 0.2 && a.won && a.position === 1 && a.coins > 300, `A ${a?.coins} / B ${b?.coins}`);
    const m = s.persisted[0].missionEvents;
    check("missions: winner gets RACE_FINISHED + RACE_WON + laps; DNF gets no 'finished'", m.some((x) => x.userId === "A" && x.event === "RACE_WON") && !m.some((x) => x.userId === "B" && x.event === "RACE_FINISHED"));
    check("room can start the next race after results", (() => { try { s.orch.start({ id: "r2", code: "BBBBBB", mode: "MULTIPLAYER" }); return s.orch.isActive("r2"); } catch { return false; } })());
    s.orch.dispose("r2");
  }

  /* ---- leaving mid race */
  {
    const s = setup([A, B]);
    const r = s.orch.start({ id: "r3", code: "CCCCCC", mode: "QUICK" });
    s.clock.to(r.startAt + 1);
    s.orch.drop("r3", "B");
    const run = plan(gp(0), lapGates(1), r.startAt + 500, 55);
    play(s, "r3", { A: run }); await flush();
    const res = ev(s, "race:results")[0]?.payload;
    check("a driver leaving counts as DNF; the other can still finish and the race ends", !!res && res.rows.find((x: any) => x.userId === "B").dnf && res.rows.find((x: any) => x.userId === "A").finished);
  }

  /* ---- abort */
  {
    const s = setup([A, B]); s.orch.start({ id: "r4", code: "DDDDDD", mode: "MULTIPLAYER" });
    s.orch.abort("r4");
    check("host abort: 'race:aborted' broadcast and session removed (no results, nothing persisted)", ev(s, "race:aborted").length === 1 && !s.orch.get("r4") && s.persisted.length === 0);
  }

  /* ---- tournament: 3 rounds, championship, final reward, auto next round */
  {
    const s = setup([A, B, C]);
    const roomMode: RaceModeKey = "TOURNAMENT";
    let r = s.orch.start({ id: "t1", code: "TTTTTT", mode: roomMode });
    check("tournament round 1/3 announced with 2 laps per round", ev(s, "race:countdown")[0].payload.round === 1 && ev(s, "race:countdown")[0].payload.rounds === 3 && ev(s, "race:countdown")[0].payload.laps === 2);
    const order = [["A", "B", "C"], ["B", "A", "C"], ["A", "C", "B"]]; // finishing order per round
    for (let round = 1; round <= 3; round++) {
      s.clock.to(r.startAt + 1);
      const speeds: Record<string, number> = {}; order[round - 1].forEach((id, i) => { speeds[id] = 60 - i * 6; });
      const runs: Record<string, ReturnType<typeof plan>> = {};
      for (const [id, seat] of [["A", 0], ["B", 1], ["C", 2]] as const) runs[id] = plan(gp(seat), lapGates(2), r.startAt + 500, speeds[id]);
      play(s, "t1", runs); await flush();
      const res = ev(s, "race:results")[round - 1]?.payload;
      check(`round ${round}: results in the expected finishing order`, !!res && res.rows.map((x: any) => x.userId).join("") === order[round - 1].join("") && res.round === round);
      if (round < 3) {
        check(`round ${round}: championship table + 'next round in 15 s'`, res.table.length === 3 && res.next.inMs === RACE_TUNING.tournamentBreakMs && !res.finalRound);
        s.clock.to(s.clock.t + RACE_TUNING.tournamentBreakMs + 10);
        check(`round ${round + 1} starts automatically after the break`, ev(s, "race:countdown").length === round + 1 && s.orch.get("t1")!.phase === "COUNTDOWN");
        r = { startAt: ev(s, "race:countdown")[round].payload.startAt, racers: 3 };
      }
    }
    const fin = ev(s, "race:results")[2].payload;
    // A: 10+7+10=27, B: 7+10+5=22, C: 5+5+7=17
    check("final table adds the rounds up (A 27, B 22, C 17)", fin.finalRound && fin.table.map((t: any) => `${t.userId}${t.points}`).join() === "A27,B22,C17", fin.table.map((t: any) => `${t.userId}${t.points}`).join());
    check("final rewards: champion earns more than 2nd and 3rd; TOURNAMENT_FINISHED mission event for all three", fin.finalRewards[0].userId === "A" && fin.finalRewards[0].coins > fin.finalRewards[1].coins && fin.finalRewards[1].coins > fin.finalRewards[2].coins && s.persisted[2].missionEvents.filter((m) => m.event === "TOURNAMENT_FINISHED").length === 3);
    check("tournament does not restart after the final round", (() => { s.clock.to(s.clock.t + 60_000); return ev(s, "race:countdown").length === 3; })());
    check("3 rounds persisted (one DB race per round)", s.persisted.length === 3 && s.persisted.map((p) => p.round).join() === "1,2,3");
  }
  /* ---- tournament: field shrinks below 2 between rounds */
  {
    const s = setup([A, B]); const r = s.orch.start({ id: "t2", code: "UUUUUU", mode: "TOURNAMENT" });
    s.clock.to(r.startAt + 1);
    play(s, "t2", { A: plan(gp(0), lapGates(2), r.startAt + 500, 60), B: plan(gp(1), lapGates(2), r.startAt + 500, 55) }); await flush();
    s.setPresent([A]); s.clock.to(s.clock.t + RACE_TUNING.tournamentBreakMs + 10);
    check("tournament stops cleanly when only one driver is left", ev(s, "race:aborted").length === 1 && !s.orch.get("t2"));
  }
  /* ---- drift (server computes slip) + checkpoint mode through the orchestrator */
  {
    const s = setup([A]); const r = s.orch.start({ id: "d1", code: "VVVVVV", mode: "DRIFT" });
    s.clock.to(r.startAt + 1);
    let t = r.startAt + 100, x = -300, z = -200;
    for (let i = 0; i < 400; i++) { t += 50; x += 1.5; s.clock.to(t); // car points +z but travels +x → 90° slip at 30 m/s
      s.orch.onState("d1", "A", { x, z, vx: 30, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 108 }, t); }
    const sc = s.orch.summary("d1")!.standings[0].score;
    check("drift mode: score comes from measured slip", sc > 500, `score ${sc}`);
    s.clock.to(r.startAt + 91_000); await flush();
    const res = ev(s, "race:results")[0]?.payload;
    check("drift mode ends at 90 s and pays by score", !!res && res.rows[0].score === sc && res.rows[0].coins > 0 && s.persisted[0].missionEvents.some((m) => m.event === "DRIFT_POINTS"));
    const s2 = setup([A]); const r2 = s2.orch.start({ id: "d2", code: "WWWWWW", mode: "DRIFT" }); s2.clock.to(r2.startAt + 1);
    t = r2.startAt + 100; x = -300;
    for (let i = 0; i < 400; i++) { t += 50; x += 1.5; s2.clock.to(t); s2.orch.onState("d2", "A", { x, z, vx: 30, vz: 0, qx: 0, qy: Math.SQRT1_2, qz: 0, qw: Math.SQRT1_2, speed: 108 }, t); } // facing +x, travelling +x
    check("drive straight fast (no slip) = 0 drift points; faked velocity that contradicts movement is ignored", s2.orch.summary("d2")!.standings[0].score === 0);
    const s3 = setup([A]); const r3 = s3.orch.start({ id: "d3", code: "XXXXXX", mode: "DRIFT" }); s3.clock.to(r3.startAt + 1);
    t = r3.startAt + 100; x = -300;
    for (let i = 0; i < 400; i++) { t += 50; x += 1.5; s3.clock.to(t); s3.orch.onState("d3", "A", { x, z, vx: 0, vz: 30, qx: 0, qy: Math.SQRT1_2, qz: 0, qw: Math.SQRT1_2, speed: 108 }, t); } // lies: moves +x, claims velocity +z, faces +x → fake 90° "slip"
    check("faking a slide (velocity not matching real movement) scores nothing", s3.orch.summary("d3")!.standings[0].score === 0, `score ${s3.orch.summary("d3")!.standings[0].score}`);
  }

  console.log(rows.join("\n")); console.log(failed ? `\n${failed} FAILED` : `\nALL ${rows.length} PASSED`); process.exit(failed ? 1 : 0);
})();
