/** Pure-logic tests for the Phase 3 shared layer. Run: npm run test -w @road-rivals/shared */
import {
  PARTS_CATALOG, PARTS_BY_SLUG, canInstall, applyImpacts, impactDamage, fullHealth, ImpactDetector, worldToLocal,
  quoteRepair, emergencyAllowed, garageProximityOk, GARAGES, quoteCustomization, customizeSchema, damageReportSchema,
  buildPhysicsParams, computeDamageEffects, estimatePerformance, PART_TYPES, DEFAULT_CONFIG, G,
} from "../src/index";

let failed = 0;
const rows: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

// ---- catalogue
const slugs = new Set(PARTS_CATALOG.map((p) => p.slug));
check("catalogue: unique slugs", slugs.size === PARTS_CATALOG.length);
check("catalogue: every PartType has at least one part", PART_TYPES.every((t) => PARTS_CATALOG.some((p) => p.type === t)));
check("catalogue: tiers strictly increase in price per type", PART_TYPES.every((t) => {
  const l = PARTS_CATALOG.filter((p) => p.type === t).sort((a, b) => a.tier - b.tier);
  return l.every((p, i) => i === 0 || p.price > l[i - 1].price);
}));
check("canInstall: level gate", !canInstall(PARTS_BY_SLUG["engine-v8"], "HATCHBACK", 1).ok && canInstall(PARTS_BY_SLUG["engine-v8"], "HATCHBACK", 4).ok);
check("canInstall: category gate", !canInstall(PARTS_BY_SLUG["engine-hyper"], "HATCHBACK", 99).ok && canInstall(PARTS_BY_SLUG["engine-hyper"], "SUPERCAR", 10).ok);

// ---- every part measurably changes the physics model (no cosmetic-only upgrades)
const stock = buildPhysicsParams({ massKg: 1250, engineHp: 180, topSpeedKmh: 220, grip: 1.1, brakeTorque: 1.15 }, [], "SPORTS");
const base = estimatePerformance(stock);
for (const t of PART_TYPES) {
  const best = PARTS_CATALOG.filter((p) => p.type === t).sort((a, b) => b.tier - a.tier)[0];
  const p = buildPhysicsParams({ massKg: 1250, engineHp: 180, topSpeedKmh: 220, grip: 1.1, brakeTorque: 1.15 }, [{ type: best.type, physicsModifiers: best.physicsModifiers }], "SPORTS");
  const e = estimatePerformance(p);
  const changed = JSON.stringify(p) !== JSON.stringify(stock);
  check(`part ${best.slug}: builds different physics params`, changed);
  void e;
}
check("estimator: engine tiers monotonic 0-100", (() => {
  const t = PARTS_CATALOG.filter((p) => p.type === "ENGINE").map((p) => estimatePerformance(buildPhysicsParams({ massKg: 1100, engineHp: 100, topSpeedKmh: 170 }, [{ type: "ENGINE", physicsModifiers: p.physicsModifiers }], "HATCHBACK")).zeroTo100);
  return t.every((v, i) => i === 0 || v <= t[i - 1] + 0.01);
})());

// ---- impact model
const wall100 = { mag: 28, lx: 0, ly: 0, lz: -1 };
const hit = applyImpacts(fullHealth(), [wall100]);
check("impact: 100 km/h head-on wrecks front bumper, hurts radiator + engine", hit.FRONT_BUMPER === 0 && hit.RADIATOR < 60 && hit.ENGINE < 80 && hit.REAR_BUMPER === 100, `bumper ${hit.FRONT_BUMPER.toFixed(0)} rad ${hit.RADIATOR.toFixed(0)} eng ${hit.ENGINE.toFixed(0)}`);
const tap = applyImpacts(fullHealth(), [{ mag: 3, lx: 0, ly: 0, lz: -1 }]);
check("impact: 3 m/s tap barely scratches, engine untouched", tap.FRONT_BUMPER > 95 && tap.ENGINE === 100, `bumper ${tap.FRONT_BUMPER.toFixed(1)}`);
const rear = applyImpacts(fullHealth(), [{ mag: 14, lx: 0, ly: 0, lz: 1 }]);
check("impact: rear hit damages rear bumper/transmission, not front", rear.REAR_BUMPER < 80 && rear.FRONT_BUMPER === 100);
const side = applyImpacts(fullHealth(), [{ mag: 14, lx: 1, ly: 0, lz: 0 }]);
check("impact: side hit damages doors/wheels", side.DOORS < 80 && side.WHEELS < 100 && side.FRONT_BUMPER === 100);
const land = applyImpacts(fullHealth(), [{ mag: 9, lx: 0, ly: 1, lz: 0 }]);
check("impact: hard landing damages suspension + tyres", land.SUSPENSION < 90 && land.TYRES < 100);
const armored = impactDamage(wall100, 1 / 3).FRONT_BUMPER! < impactDamage(wall100, 1).FRONT_BUMPER! * 0.4;
check("impact: armour durability reduces damage", armored);
check("impact: fold is deterministic and never below 0 / above 100", (() => {
  const h = applyImpacts(fullHealth(), Array.from({ length: 40 }, () => wall100));
  return Object.values(h).every((v) => v >= 0 && v <= 100);
})());
check("damage → effects: crash really weakens physics inputs", (() => {
  const fx = computeDamageEffects(hit);
  return fx.powerMult < 1 && fx.coolingMult < 0.8 && fx.gripMult <= 1;
})());

// ---- detector
const q0 = { x: 0, y: 0, z: 0, w: 1 };
const det = new ImpactDetector();
let imp = null as ReturnType<ImpactDetector["step"]>;
det.step({ x: 0, y: 0, z: 25 }, q0, 1 / 60);
for (let i = 0; i < 10; i++) { const r = det.step({ x: 0, y: -G / 60 * (i + 1) * 0, z: 25 }, q0, 1 / 60); if (r) imp = r; }
check("detector: steady cruise → no impact", imp === null);
// free-fall (gravity only) must not trigger
const dff = new ImpactDetector(); let ffImp = null as ReturnType<ImpactDetector["step"]>;
for (let i = 0; i < 90; i++) { const r = dff.step({ x: 0, y: -G * (i / 60), z: 20 }, q0, 1 / 60); if (r) ffImp = r; }
check("detector: free fall (gravity) is not a crash", ffImp === null);
// wall: 25 m/s → 0 over 3 steps
const dw = new ImpactDetector(); let wallImp = null as ReturnType<ImpactDetector["step"]>;
const prof = [25, 25, 14, 4, 0, 0, 0, 0];
prof.forEach((z) => { const r = dw.step({ x: 0, y: 0, z }, q0, 1 / 60); if (r) wallImp = r; });
check("detector: wall hit → one frontal impact of ~25 m/s", !!wallImp && Math.abs(wallImp.mag - 25) < 1 && wallImp.lz < -0.9, wallImp ? `mag ${wallImp.mag.toFixed(1)} lz ${wallImp.lz.toFixed(2)}` : "none");
// car yawed 90° (facing +x): a hit that stops +x motion is a FRONT impact in local space
const yaw = Math.PI / 2, qy = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
const loc = worldToLocal({ x: -1, y: 0, z: 0 }, qy);
check("worldToLocal: rotated car sees braking as -z", loc.z < -0.99 && Math.abs(loc.x) < 1e-6, `${loc.z.toFixed(2)}`);
const dr = new ImpactDetector(); dr.reset({ x: 20, y: 0, z: 0 }); let rotImp = null as ReturnType<ImpactDetector["step"]>;
[20, 20, 8, 0, 0, 0, 0].forEach((x) => { const r = dr.step({ x, y: 0, z: 0 }, qy, 1 / 60); if (r) rotImp = r; });
check("detector: respects car orientation", !!rotImp && rotImp.lz < -0.9, rotImp ? `lz ${rotImp.lz.toFixed(2)}` : "none");
const dt = new ImpactDetector(); dt.reset({ x: 0, y: 0, z: 30 }); let tele = null as ReturnType<ImpactDetector["step"]>;
dt.reset({ x: 0, y: 0, z: 0 }); // teleport/respawn resets, so zero velocity is not a crash
[0, 0, 0, 0].forEach((z) => { const r = dt.step({ x: 0, y: 0, z }, q0, 1 / 60); if (r) tele = r; });
check("detector: reset() after respawn → no phantom crash", tele === null);

// ---- repair quotes
const wrecked = applyImpacts(fullHealth(), [wall100]);
const full = quoteRepair("FULL", wrecked, { vehiclePrice: 0 })!;
const minor = quoteRepair("MINOR", wrecked, { vehiclePrice: 0 })!;
check("repair: no damage → nothing to repair, free", (() => { const q = quoteRepair("FULL", fullHealth())!; return !q.needed && q.cost === 0; })());
check("repair: cost scales with damage (minor < full)", minor.cost > 0 && full.cost > minor.cost, `minor ${minor.cost} full ${full.cost}`);
check("repair: FULL restores every component to 100", Object.values(full.after).every((v) => v === 100));
check("repair: MINOR only touches body panels", minor.changes.every((c) => ["FRONT_BUMPER", "REAR_BUMPER", "DOORS"].includes(c.component)));
check("repair: pricier car and home premium cost more", quoteRepair("FULL", wrecked, { vehiclePrice: 150000 })!.cost > full.cost && quoteRepair("FULL", wrecked, { home: true })!.cost > full.cost);
check("repair: all-zero health on the starter car costs the base price (5000)", quoteRepair("FULL", Object.fromEntries(Object.keys(fullHealth()).map((k) => [k, 0])), {})!.cost === 5000);
const em = quoteRepair("EMERGENCY", { ENGINE: 0, TRANSMISSION: 10, FRONT_BUMPER: 0 })!;
check("repair: EMERGENCY is free, lifts mechanicals to 35, leaves body alone", em.cost === 0 && em.after.ENGINE === 35 && em.after.TRANSMISSION === 35 && em.after.FRONT_BUMPER === 0);
check("repair: emergency only if you cannot afford the full fix", emergencyAllowed(100, 5000) && !emergencyAllowed(6000, 5000) && !emergencyAllowed(0, 0));
check("repair: unknown service → null", quoteRepair("NOPE", {}) === null);

// ---- garage proximity
const g = GARAGES[0];
check("proximity: inside radius ok, 100 m away rejected", garageProximityOk(g, { x: g.x + 3, z: g.z }) && !garageProximityOk(g, { x: g.x + 100, z: g.z }));

// ---- customization pricing / validation
const q = quoteCustomization(DEFAULT_CONFIG, { paint: "#22d3ee", wheels: "mesh", neon: "cyan" });
check("customize: priced per changed item (preset paint 250 + mesh 1100 + neon 500)", q.cost === 250 + 1100 + 500, `${q.cost}`);
check("customize: unchanged / free items cost nothing", quoteCustomization(DEFAULT_CONFIG, { paint: "#E11D48", wheels: "stock" }).cost === 0);
check("customize: custom hex colour priced at custom rate", quoteCustomization(DEFAULT_CONFIG, { paint: "#123456" }).cost === 600);
check("customize: schema rejects unknown ids, bad hex and extra keys", !customizeSchema.safeParse({ wheels: "gold-plated" }).success && !customizeSchema.safeParse({ paint: "red" }).success && !customizeSchema.safeParse({ coins: 5 }).success);
check("customize: neon can be turned off for free", quoteCustomization({ ...DEFAULT_CONFIG, neon: "cyan" }, { neon: null }).cost === 0 && quoteCustomization({ ...DEFAULT_CONFIG, neon: "cyan" }, { neon: "none" }).next.neon === null);

// ---- damage report schema
check("damage report: valid accepted, NaN / huge / empty rejected", damageReportSchema.safeParse({ ownershipId: "a", impacts: [wall100] }).success
  && !damageReportSchema.safeParse({ ownershipId: "a", impacts: [{ ...wall100, mag: 9999 }] }).success
  && !damageReportSchema.safeParse({ ownershipId: "a", impacts: [] }).success
  && !damageReportSchema.safeParse({ ownershipId: "a", impacts: [{ ...wall100, mag: NaN }] }).success);

console.log(rows.join("\n"));
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
