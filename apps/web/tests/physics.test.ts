/**
 * Headless gameplay-physics tests: run the REAL Rapier raycast vehicle (same code as the
 * browser) and compare stock vs upgraded / damaged cars with measured results.
 * Run:  npm run test:physics -w @road-rivals/web
 */
import { crossedCheckpoint, getCityLayout, estimateTopSpeedKmh, type InstalledPart, type DamageHealth, type BaseStats } from "@road-rivals/shared";
import { makeSim, IDLE, STOCK } from "./harness";

let failed = 0;
const rows: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  rows.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
}
type Cfg = { base?: Partial<BaseStats>; parts?: InstalledPart[]; damage?: DamageHealth };
const part = (type: string, physicsModifiers: Record<string, number>): InstalledPart => ({ type, physicsModifiers });
const mk = (c: Cfg = {}) => makeSim({ ...STOCK, ...c.base }, c.parts ?? [], c.damage ?? {});

async function accel(c: Cfg, nitro = false) {
  const s = await mk(c); s.run(1.2, IDLE);
  let t100 = Infinity, top = 0;
  for (let i = 0; i < 60 * 70; i++) {
    s.step({ ...IDLE, throttle: 1, nitro: nitro && i < 60 * 8 });
    const k = s.car.telemetry.speedKmh;
    if (t100 === Infinity && k >= 100) t100 = i / 60;
    top = Math.max(top, k);
  }
  return { t100, top };
}
async function stopDist(c: Cfg, from = 100) {
  const s = await mk(c); s.run(1.2, IDLE);
  s.body.setLinvel({ x: 0, y: 0, z: from / 3.6 }, true); s.run(0.25, IDLE);
  const z0 = s.pos().z; let n = 0;
  while (s.car.telemetry.speedKmh > 1 && n < 1200) { s.step({ ...IDLE, brake: 1 }); n++; }
  return s.pos().z - z0;
}
/** steady-state lateral acceleration (g) and body roll (deg) at speed v with full steer */
async function corner(c: Cfg, v = 22) {
  const s = await mk(c); s.run(1.2, IDLE);
  s.body.setLinvel({ x: 0, y: 0, z: v }, true);
  let roll = 0, sp = 0, n = 0, h0 = 0, hPrev = 0, hUnwrapped = 0, hStart = 0;
  for (let i = 0; i < 60 * 4; i++) {
    const speed = s.car.telemetry.speedMs;
    s.step({ ...IDLE, throttle: speed < v ? 1 : 0, brake: 0, steer: 1 });
    const lv = s.body.linvel();
    const h = Math.atan2(lv.x, lv.z);
    if (i === 0) hPrev = h;
    let dh = h - hPrev; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    hUnwrapped += dh; hPrev = h;
    if (i === 120) hStart = hUnwrapped;
    if (i > 120) {
      sp += Math.hypot(lv.x, lv.z); n++;
      const q = s.body.rotation();
      roll = Math.max(roll, Math.abs(Math.asin(2 * (q.x * q.y + q.z * q.w)) * 57.3));
    }
  }
  const omega = Math.abs(hUnwrapped - hStart) / (119 / 60);
  return { g: (omega * (sp / n)) / 9.81, roll };
}

(async () => {
  // ---------- baseline
  const s0 = await mk(); s0.run(2, IDLE);
  check("stock car settles on 4 wheels", s0.car.telemetry.onGround === 4 && Math.abs(s0.body.linvel().y) < 0.1,
    `y=${s0.pos().y.toFixed(2)}`);
  const stock = await accel({});
  check("stock hatch 0-100 km/h in 6–12 s", stock.t100 > 6 && stock.t100 < 12, `${stock.t100.toFixed(2)} s`);
  check("stock top speed within 6% of catalogue 170 km/h", Math.abs(stock.top - 170) < 10, `${stock.top.toFixed(1)} km/h`);

  // ---------- engine tiers (seed convention: peakTorque = hp*1.6)
  const eng = (hp: number) => [part("ENGINE", { powerHp: hp, peakTorqueNm: hp * 1.6 })];
  const sport = await accel({ parts: eng(180) });
  const v8 = await accel({ parts: eng(400) });
  check("ENGINE Sport 180hp: faster 0-100 and higher top speed than stock", sport.t100 < stock.t100 && sport.top > stock.top,
    `0-100 ${sport.t100.toFixed(2)}s (stock ${stock.t100.toFixed(2)}), top ${sport.top.toFixed(0)}`);
  check("ENGINE V8 400hp: faster than Sport", v8.t100 < sport.t100 && v8.top >= sport.top,
    `0-100 ${v8.t100.toFixed(2)}s, top ${v8.top.toFixed(0)}`);

  // ---------- turbo / nitro
  const turbo = await accel({ parts: [part("TURBO", { boostTorqueMult: 1.35, spoolRpm: 3000 })] });
  check("TURBO: quicker 0-100 (real torque delivery)", turbo.t100 < stock.t100 - 0.3, `${turbo.t100.toFixed(2)} s`);
  const nit = await accel({}, true);
  check("NITRO: quicker 0-100 while active", nit.t100 < stock.t100 - 0.5, `${nit.t100.toFixed(2)} s`);

  // ---------- gearbox
  const gb = await accel({ parts: [part("GEARBOX", { topSpeedMult: 1.18, accelMult: 1.0 })] });
  check("GEARBOX longer ratios: higher top speed", gb.top > stock.top + 2, `${gb.top.toFixed(1)} vs ${stock.top.toFixed(1)}`);
  const gbShort = await accel({ parts: [part("GEARBOX", { topSpeedMult: 1.0, accelMult: 1.15 })] });
  check("GEARBOX wider spread (shorter 1st): changes acceleration", Math.abs(gbShort.t100 - stock.t100) > 0.05, `${gbShort.t100.toFixed(2)} s`);

  // ---------- aero / armor
  const spoil = await accel({ parts: [part("SPOILER", { dragMult: 1.2, downforceMult: 2.5 })] });
  check("SPOILER: more drag lowers top speed", spoil.top < stock.top - 2, `${spoil.top.toFixed(1)}`);
  const c40 = await corner({}, 38), c40s = await corner({ parts: [part("SPOILER", { dragMult: 1.2, downforceMult: 6 })] }, 38);
  check("SPOILER: downforce raises high-speed cornering grip", c40s.g > c40.g, `${c40s.g.toFixed(2)}g vs ${c40.g.toFixed(2)}g`);
  const armor = await accel({ parts: [part("ARMOR", { massAdd: 350, durabilityMult: 1.5 })] });
  check("ARMOR: extra mass slows acceleration", armor.t100 > stock.t100 + 0.4, `${armor.t100.toFixed(2)} s`);

  // ---------- tyres / brakes / suspension
  const cs = await corner({}), ct = await corner({ parts: [part("TYRES", { frictionMult: 1.35 })] });
  check("TYRES racing: higher cornering g", ct.g > cs.g * 1.1, `${ct.g.toFixed(2)}g vs ${cs.g.toFixed(2)}g`);
  const d0 = await stopDist({}), dT = await stopDist({ parts: [part("TYRES", { frictionMult: 1.35 }), part("BRAKES", { brakeMult: 1.5 })] });
  const dB = await stopDist({ parts: [part("BRAKES", { brakeMult: 1.4 })] });
  check("BRAKES: shorter 100→0 stopping distance", dB < d0 - 3, `${dB.toFixed(1)} m vs ${d0.toFixed(1)} m`);
  check("TYRES+BRAKES: shortest stop", dT <= dB, `${dT.toFixed(1)} m`);
  const soft = await corner({ parts: [part("SUSPENSION", { stiffnessMult: 0.7 })] }, 20), stiff = await corner({ parts: [part("SUSPENSION", { stiffnessMult: 1.8 })] }, 20);
  check("SUSPENSION stiffer: less body roll in a corner", stiff.roll < soft.roll, `${stiff.roll.toFixed(1)}° vs ${soft.roll.toFixed(1)}°`);

  // ---------- handbrake drift
  const drift = async (hb: boolean) => {
    const s = await mk(); s.run(1.2, IDLE); s.body.setLinvel({ x: 0, y: 0, z: 22 }, true);
    let maxSlip = 0;
    for (let i = 0; i < 150; i++) { s.step({ ...IDLE, throttle: 0.5, steer: i > 20 ? 1 : 0, handbrake: hb && i > 20 }); maxSlip = Math.max(maxSlip, Math.abs(s.car.telemetry.slip)); }
    return maxSlip;
  };
  const dn = await drift(false), dh = await drift(true);
  check("HANDBRAKE induces drifting (lateral slip)", dh > dn + 1.5, `${dh.toFixed(1)} vs ${dn.toFixed(1)} m/s`);

  // ---------- damage
  const dmgE = await accel({ damage: { ENGINE: 30 } });
  check("DAMAGE engine 30%: slower acceleration", dmgE.t100 > stock.t100 + 1, `${dmgE.t100.toFixed(2)} s`);
  const dmgB = await stopDist({ damage: { BRAKES: 30 } });
  check("DAMAGE brakes 30%: longer stopping distance", dmgB > d0 + 8, `${dmgB.toFixed(1)} m`);
  const dmgT = await corner({ damage: { TYRES: 20, WHEELS: 20 } });
  check("DAMAGE tyres 20%: less cornering grip", dmgT.g < cs.g * 0.9, `${dmgT.g.toFixed(2)}g`);
  const crit = await accel({ damage: { ENGINE: 5 } });
  check("CRITICAL engine damage limits performance (limp mode)", crit.top < 80, `${crit.top.toFixed(0)} km/h`);

  // ---------- stability
  const sl = await mk(); sl.run(1.2, IDLE); sl.body.setLinvel({ x: 0, y: 0, z: 30 }, true);
  for (let i = 0; i < 240; i++) sl.step({ ...IDLE, throttle: 0.4, steer: Math.sin(i / 20) });
  const up = (() => { const q = sl.body.rotation(); return 1 - 2 * (q.x * q.x + q.z * q.z); })();
  check("car stays upright through violent slalom at 108 km/h", up > 0.6, `up·y=${up.toFixed(2)}`);

  // ---------- world data
  const L = getCityLayout();
  check("city layout: buildings, bridges, tunnel, ramps, checkpoints present",
    L.buildings.length > 200 && L.statics.length > 150 && L.checkpoints.length >= 8 && L.tunnelLights.length > 0, `${L.buildings.length} buildings, ${L.statics.length} colliders`);
  const cp = L.checkpoints[0];
  const fx = Math.sin(cp.yaw), fz = Math.cos(cp.yaw);
  check("checkpoint crossing detection (forward yes / backward no / off-gate no)",
    crossedCheckpoint(cp.x - fx * 3, cp.z - fz * 3, cp.x + fx * 3, cp.z + fz * 3, cp) &&
    !crossedCheckpoint(cp.x + fx * 3, cp.z + fz * 3, cp.x - fx * 3, cp.z - fz * 3, cp) &&
    !crossedCheckpoint(cp.x - fx * 3 + fz * 40, cp.z - fz * 3 - fx * 40, cp.x + fx * 3 + fz * 40, cp.z + fz * 3 - fx * 40, cp));

  console.log(rows.join("\n"));
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
