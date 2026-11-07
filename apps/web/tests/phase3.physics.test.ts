/**
 * Phase 3 physics tests – real Rapier simulation:
 *  collision detection → damage → changed handling, armour, thermal/cooling, estimator accuracy.
 * Run: npm run test:phase3 -w @road-rivals/web
 */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  applyImpacts, fullHealth, estimatePerformance, computeDamageEffects, buildPhysicsParams,
  type InstalledPart, type BaseStats, type DamageHealth,
} from "@road-rivals/shared";
import { makeSim, IDLE, STOCK } from "./harness";

let failed = 0;
const rows: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const part = (type: string, physicsModifiers: Record<string, number>): InstalledPart => ({ type, physicsModifiers });
type Cfg = { base?: Partial<BaseStats>; parts?: InstalledPart[]; damage?: DamageHealth };
const mk = (c: Cfg = {}) => makeSim({ ...STOCK, ...c.base }, c.parts ?? [], c.damage ?? {});

function addWall(world: RAPIER.World, x: number, y: number, z: number, hx: number, hy: number, hz: number) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.5).setRestitution(0.1));
}

/** Drive the car at `kmh` into a wall 60 m ahead, return what the detector saw and the resulting health. */
async function crash(kmh: number, c: Cfg = {}) {
  const s = await mk(c);
  addWall(s.world, 0, 2, 70, 20, 2, 1);
  s.run(1.2, IDLE);
  s.body.setLinvel({ x: 0, y: 0, z: kmh / 3.6 }, true); s.car.resetImpacts();
  for (let i = 0; i < 60 * 6; i++) s.step({ ...IDLE, throttle: 0 });
  const health = applyImpacts(fullHealth(), s.impacts, s.params.durability);
  return { s, health, impacts: s.impacts };
}

async function accelT100(c: Cfg) {
  const s = await mk(c); s.run(1.2, IDLE);
  for (let i = 0; i < 60 * 40; i++) { s.step({ ...IDLE, throttle: 1 }); if (s.car.telemetry.speedKmh >= 100) return i / 60; }
  return Infinity;
}
async function stopDist(c: Cfg, from = 100) {
  const s = await mk(c); s.run(1.2, IDLE);
  s.body.setLinvel({ x: 0, y: 0, z: from / 3.6 }, true); s.run(0.25, IDLE);
  const z0 = s.pos().z; let n = 0;
  while (s.car.telemetry.speedKmh > 1 && n < 1200) { s.step({ ...IDLE, brake: 1 }); n++; }
  return s.pos().z - z0;
}

(async () => {
  // ---- 1. normal driving never registers a crash
  const n = await mk(); n.run(2, IDLE);
  for (let i = 0; i < 60 * 12; i++) n.step({ ...IDLE, throttle: 1, steer: Math.sin(i / 40) });
  n.body.setLinvel({ x: 0, y: 0, z: 30 }, true); n.car.resetImpacts(); // test teleports speed, like a respawn: reset the detector
  for (let i = 0; i < 60 * 4; i++) n.step({ ...IDLE, throttle: 0.4, steer: Math.sin(i / 18), handbrake: i % 80 > 50 });
  for (let i = 0; i < 60 * 5; i++) n.step({ ...IDLE, brake: 1 });
  check("no phantom damage: launch, slalom, handbrake drifts, hard braking, settling → 0 impacts", n.impacts.length === 0, `${n.impacts.length} impacts`);

  // ---- 2. wall crash at 100 km/h
  const c100 = await crash(100);
  const big = c100.impacts.reduce((a, b) => (b.mag > a.mag ? b : a), { mag: 0, lx: 0, ly: 0, lz: 0 });
  check("wall @100 km/h: detector reports a frontal impact", c100.impacts.length >= 1 && big.mag > 18 && big.lz < -0.7, `${c100.impacts.length} impact(s), peak ${big.mag.toFixed(1)} m/s, lz ${big.lz.toFixed(2)}`);
  check("wall @100 km/h: front bumper wrecked, rear untouched, radiator hurt", c100.health.FRONT_BUMPER < 15 && c100.health.REAR_BUMPER > 95 && c100.health.RADIATOR < 80,
    `bumper ${c100.health.FRONT_BUMPER.toFixed(0)} radiator ${c100.health.RADIATOR.toFixed(0)} engine ${c100.health.ENGINE.toFixed(0)}`);

  // ---- 3. gentle bump
  const c15 = await crash(18);
  check("wall @18 km/h: only a scuff (bumper > 90%, engine untouched)", c15.health.FRONT_BUMPER > 88 && c15.health.ENGINE === 100, `bumper ${c15.health.FRONT_BUMPER.toFixed(1)}`);
  const c50 = await crash(50);
  check("damage grows with speed (18 < 50 < 100 km/h)", c15.health.FRONT_BUMPER > c50.health.FRONT_BUMPER && c50.health.FRONT_BUMPER > c100.health.FRONT_BUMPER,
    `${c15.health.FRONT_BUMPER.toFixed(0)} > ${c50.health.FRONT_BUMPER.toFixed(0)} > ${c100.health.FRONT_BUMPER.toFixed(0)}`);

  // ---- 4. armour
  const arm = await crash(70, { parts: [part("ARMOR", { massAdd: 180, durabilityMult: 3.0 })] });
  const noArm = await crash(70);
  check("ARMOR plating: same 70 km/h crash does clearly less damage", arm.health.FRONT_BUMPER > noArm.health.FRONT_BUMPER + 15,
    `${arm.health.FRONT_BUMPER.toFixed(0)}% vs ${noArm.health.FRONT_BUMPER.toFixed(0)}% bumper left`);

  // ---- 5. side impact + landing
  const side = await mk();
  addWall(side.world, 6, 2, 0, 1, 2, 20); // face at x = 5 m: reachable while tyres scrub the slide off
  side.run(1.2, IDLE); side.body.setLinvel({ x: 14, y: 0, z: 0 }, true); side.car.resetImpacts();
  for (let i = 0; i < 60 * 3; i++) side.step({ ...IDLE });
  const sh = applyImpacts(fullHealth(), side.impacts);
  check("sliding sideways into a wall damages doors (side zone), not bumpers", side.impacts.length >= 1 && sh.DOORS < 90 && sh.FRONT_BUMPER > sh.DOORS, `doors ${sh.DOORS.toFixed(0)} front ${sh.FRONT_BUMPER.toFixed(0)}`);
  const drop = await mk(); drop.run(1.2, IDLE);
  drop.body.setTranslation({ x: 0, y: 6, z: 0 }, true); drop.body.setLinvel({ x: 0, y: 0, z: 0 }, true); drop.car.resetImpacts();
  for (let i = 0; i < 60 * 4; i++) drop.step({ ...IDLE });
  const dh = applyImpacts(fullHealth(), drop.impacts);
  check("dropping from 6 m: landing damages suspension/tyres", drop.impacts.length >= 1 && dh.SUSPENSION < 95, `suspension ${dh.SUSPENSION.toFixed(0)} tyres ${dh.TYRES.toFixed(0)}`);

  // ---- 6. closed loop: the crash changes how the car drives
  const crashed = { ...c100.health };
  const t0 = await accelT100({ base: { engineHp: 180 } });
  const t1 = await accelT100({ base: { engineHp: 180 }, damage: crashed });
  const fx = computeDamageEffects(crashed);
  check("crash damage persists into physics: crashed car accelerates slower", t1 > t0 + 0.2 && fx.powerMult < 1, `${t0.toFixed(2)}s → ${t1.toFixed(2)}s`);

  // ---- 7. thermal model / COOLING upgrade / radiator damage
  async function heatRun(c: Cfg, secs = 90) {
    const s = await mk({ base: { massKg: 1400, engineHp: 550, topSpeedKmh: 310, grip: 1.25, brakeTorque: 1.3 }, ...c });
    s.run(1.2, IDLE);
    let peak = 0, avg = 0, k = 0;
    for (let i = 0; i < 60 * secs; i++) {
      s.step({ ...IDLE, throttle: 1, steer: 0 });
      peak = Math.max(peak, s.car.telemetry.temp);
      if (i > 60 * (secs - 20)) { avg += s.car.telemetry.speedKmh; k++; }
      if (Math.abs(s.pos().z) > 3500) s.body.setTranslation({ x: 0, y: 0.7, z: 0 }, true);
    }
    return { peak, avg: avg / k };
  }
  const healthy = await heatRun({});
  const badRad = await heatRun({ damage: { RADIATOR: 10 } });
  const badRadCooled = await heatRun({ damage: { RADIATOR: 10 }, parts: [part("COOLING", { coolingMult: 3.0 })] });
  check("healthy 550 hp car stays out of the overheat zone", healthy.peak < 0.85, `peak heat ${healthy.peak.toFixed(2)}`);
  check("RADIATOR damage → overheats and loses top-end speed", badRad.peak > 0.95 && badRad.avg < healthy.avg - 8, `peak ${badRad.peak.toFixed(2)}, speed ${badRad.avg.toFixed(0)} vs ${healthy.avg.toFixed(0)} km/h`);
  check("COOLING upgrade fixes it (lower temp, faster again)", badRadCooled.peak < badRad.peak - 0.2 && badRadCooled.avg > badRad.avg + 8, `peak ${badRadCooled.peak.toFixed(2)}, speed ${badRadCooled.avg.toFixed(0)} km/h`);

  // ---- 8. differential
  const d0 = await accelT100({}), d1 = await accelT100({ parts: [part("DIFFERENTIAL", { tractionMult: 1.1 })] });
  check("DIFFERENTIAL: quicker launch", d1 < d0 - 0.15, `${d1.toFixed(2)}s vs ${d0.toFixed(2)}s`);

  // ---- 9. garage estimator vs real simulation
  for (const [label, c] of [["stock", {}], ["sport engine", { parts: [part("ENGINE", { powerHp: 180, peakTorqueNm: 288 })] }], ["V8", { parts: [part("ENGINE", { powerHp: 400, peakTorqueNm: 640 })] }]] as [string, Cfg][]) {
    const params = buildPhysicsParams({ ...STOCK, ...c.base }, c.parts ?? [], "HATCHBACK");
    const est = estimatePerformance(params);
    const real = await accelT100(c);
    check(`estimator 0-100 (${label}) within 20% of Rapier`, Math.abs(est.zeroTo100 - real) / real < 0.2, `est ${est.zeroTo100.toFixed(2)}s vs real ${real.toFixed(2)}s`);
  }
  for (const [label, c] of [["stock", {}], ["BRAKES 1.5", { parts: [part("BRAKES", { brakeMult: 1.5 })] }], ["damaged brakes", { damage: { BRAKES: 30 } }]] as [string, Cfg][]) {
    const params = buildPhysicsParams({ ...STOCK, ...c.base }, c.parts ?? [], "HATCHBACK");
    const est = estimatePerformance(params, computeDamageEffects(c.damage ?? {}));
    const real = await stopDist(c);
    check(`estimator 100→0 (${label}) within 20% of Rapier`, Math.abs(est.brake100m - real) / real < 0.2, `est ${est.brake100m.toFixed(1)}m vs real ${real.toFixed(1)}m`);
  }
  const pe = estimatePerformance(buildPhysicsParams(STOCK, [], "HATCHBACK"));
  check("estimator top speed within 8% of catalogue", Math.abs(pe.topSpeedKmh - 170) / 170 < 0.08, `${pe.topSpeedKmh.toFixed(0)} km/h`);

  console.log(rows.join("\n"));
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
