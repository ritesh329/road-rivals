/**
 * ROAD RIVALS – analytic performance estimate for the garage UI.
 *
 * Runs the SAME drivetrain model (`stepDrivetrain`, torque curve, gearbox, thermal model,
 * drag, damage effects) used by the Rapier simulation, but as a 1-D straight-line integration,
 * so the garage can show live "before → after" numbers for any part or damage state.
 * The real driving still happens in the Rapier raycast vehicle; tests compare the two.
 */
import {
  G, NO_DAMAGE, createDrivetrain, stepDrivetrain,
  type DamageEffects, type VehiclePhysicsParams,
} from "./vehicle";

export interface PerformanceEstimate {
  powerHp: number; massKg: number; topSpeedKmh: number; zeroTo100: number;
  brake100m: number; cornerG: number; nitroS: number; cooling: number; durabilityPct: number;
}

export function estimatePerformance(p: VehiclePhysicsParams, fx: DamageEffects = NO_DAMAGE): PerformanceEstimate {
  const dt = 1 / 100;
  const s = createDrivetrain();
  const input = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
  let v = 0, t = 0, t100 = Infinity;
  const mu = p.tyre.frictionSlip * fx.gripMult / 1.5;
  for (let i = 0; i < 100 * 90; i++) {
    const out = stepDrivetrain(s, p, fx, input, v, dt);
    const drag = p.dragK * v * v + p.rollingResistN;
    const a = (out.engineForceN - drag) / p.massKg;
    v = Math.max(0, v + a * dt); t += dt;
    if (t100 === Infinity && v * 3.6 >= 100) t100 = t;
    if (t100 !== Infinity && i > 100 * 60 && Math.abs(a) < 0.01) break;
  }
  const brakeA = Math.min((p.brake.maxForceN * fx.brakeMult) / p.massKg, 1.15 * mu * G);
  const v100 = 100 / 3.6;
  const brake100m = (v100 * v100) / (2 * brakeA);
  // empirical: matches the Rapier cornering test (22 m/s, full lock) within ~10 %
  const cornerG = 0.91 * mu + (p.downforceK * 22 * 22) / (p.massKg * G) * 0.9;
  return {
    powerHp: p.engine.powerHp * fx.powerMult,
    massKg: p.massKg,
    topSpeedKmh: v * 3.6,
    zeroTo100: t100,
    brake100m,
    cornerG,
    nitroS: p.nitro.durationS,
    cooling: p.coolingMult * fx.coolingMult,
    durabilityPct: Math.round((1 / p.durability) * 100),
  };
}
