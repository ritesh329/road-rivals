/**
 * ROAD RIVALS – vehicle physics model (pure TypeScript, no engine dependency).
 *
 * Everything that makes a car drive differently lives here: the torque curve,
 * gearing, drag, downforce, tyre grip, brake force, suspension, nitro, turbo
 * and damage penalties. The Rapier raycast controller (apps/web/game/physics)
 * only *applies* these numbers, and the server can import this same file later
 * to validate speeds / race results.
 *
 * Upgrades are expressed as `InstalledPart[]` (VehiclePart.type +
 * physicsModifiers JSON from the database). `buildPhysicsParams` folds them
 * into real simulation parameters – nothing is cosmetic.
 */

export const G = 9.81;

export type DamageHealth = Partial<Record<DamageComponentKey, number>>; // 0..100
export const DAMAGE_COMPONENTS = [
  "ENGINE", "FRONT_BUMPER", "REAR_BUMPER", "DOORS", "WHEELS",
  "TYRES", "SUSPENSION", "BRAKES", "RADIATOR", "TRANSMISSION",
] as const;
export type DamageComponentKey = (typeof DAMAGE_COMPONENTS)[number];

export type DriveType = "RWD" | "AWD" | "FWD";

export interface BaseStats {
  massKg: number;
  engineHp: number;
  topSpeedKmh: number;
  grip: number;        // 1.0 = stock hatchback tyres
  brakeTorque: number; // 1.0 = stock hatchback brakes
  drive?: DriveType;
}

/** A part as stored in VehiclePart (type + physicsModifiers JSON). */
export interface InstalledPart {
  type: string;
  physicsModifiers: Record<string, number>;
}

/**
 * Modifier keys understood per part type (also documented in README):
 *  ENGINE       peakTorqueNm, powerHp, redlineRpm
 *  TURBO        boostTorqueMult, spoolRpm
 *  TYRES        frictionMult, sideStiffnessMult, driftRearMult
 *  BRAKES       brakeMult
 *  SUSPENSION   stiffnessMult, dampingMult, rideHeightDelta
 *  GEARBOX      topSpeedMult, accelMult, shiftTimeMult
 *  SPOILER/AERO dragMult, downforceMult
 *  ARMOR        massAdd, durabilityMult
 *  NITRO        torqueMult, durationS
 *  COOLING      coolingMult   (heat rejection: keeps big engines / damaged radiators out of the power-derate zone)
 *  DIFFERENTIAL tractionMult
 */

export interface EngineParams {
  idleRpm: number;
  redlineRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  powerHp: number;
}

export interface VehiclePhysicsParams {
  massKg: number;
  wheelRadius: number;
  wheelbase: number;
  trackWidth: number;
  drive: DriveType;
  engine: EngineParams;
  turbo: { boostTorqueMult: number; spoolRpm: number };
  gears: number[];          // TOTAL ratio (gear * final drive), index 0 = 1st
  reverseRatio: number;
  drivetrainEff: number;
  shiftTimeS: number;
  dragK: number;            // F_drag = dragK * v^2   (N)
  rollingResistN: number;   // constant, N
  downforceK: number;       // F_down = downforceK * v^2 (N)
  tyre: { frictionSlip: number; sideStiffness: number; driftRearMult: number; tractionMult: number };
  brake: { maxForceN: number; frontBias: number };
  suspension: { restLength: number; maxTravel: number; stiffness: number; compression: number; relaxation: number };
  steering: { maxAngleRad: number; gripAccel: number };
  nitro: { torqueMult: number; durationS: number; rechargePerS: number };
  durability: number;       // multiplier on incoming collision damage (<1 = tougher)
  coolingMult: number;
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const DEFAULT_BASE_STATS: BaseStats = {
  massKg: 1100, engineHp: 100, topSpeedKmh: 170, grip: 1.0, brakeTorque: 1.0,
};

/* ------------------------------------------------------------------ engine */

/** Normalised torque curve: ~0.45 at 0 rpm, 1.0 at peak, ~0.8 at redline. */
export function torqueAtRpm(e: EngineParams, rpm: number): number {
  const x = clamp(rpm / e.redlineRpm, 0, 1.05);
  const pk = e.peakTorqueRpm / e.redlineRpm;
  let n: number;
  if (x < pk) {
    const t = x / pk;
    n = 0.45 + 0.55 * (1 - (1 - t) * (1 - t));
  } else {
    const u = (x - pk) / (1 - pk);
    n = 1 - 0.2 * Math.pow(Math.min(u, 1.2), 1.5);
  }
  return e.peakTorqueNm * n;
}

export function peakPowerKw(e: EngineParams): number {
  let best = 0;
  for (let r = e.idleRpm; r <= e.redlineRpm; r += 50) best = Math.max(best, torqueAtRpm(e, r) * (r * 2 * Math.PI / 60));
  return best / 1000;
}

function makeEngine(hp: number, peakTorqueNm?: number, redline = 7000): EngineParams {
  // Default torque follows the seed catalogue convention: peak Nm = hp * 1.6
  return {
    idleRpm: 900, redlineRpm: redline, peakTorqueRpm: redline * 0.62,
    peakTorqueNm: peakTorqueNm ?? hp * 1.6, powerHp: hp,
  };
}

/* ------------------------------------------------------------ param builder */

const DRIVE_BY_CATEGORY: Record<string, DriveType> = {
  HATCHBACK: "FWD", SEDAN: "RWD", MUSCLE: "RWD", SPORTS: "RWD",
  RACING_GT: "RWD", SUPERCAR: "AWD", HYPERCAR: "AWD", OFFROAD: "AWD",
};

const N_GEARS = 6;
const GEAR_SPREAD = 4.4; // 1st / 6th total ratio

function gearRatios(redlineRpm: number, wheelRadius: number, ceilingMs: number, spread: number): number[] {
  const topTotal = (redlineRpm * 2 * Math.PI / 60) * wheelRadius / ceilingMs;
  const out: number[] = [];
  for (let i = 0; i < N_GEARS; i++) out.push(topTotal * Math.pow(spread, (N_GEARS - 1 - i) / (N_GEARS - 1)));
  return out;
}

export function buildPhysicsParams(
  baseIn: Partial<BaseStats> = {},
  parts: InstalledPart[] = [],
  category?: string,
): VehiclePhysicsParams {
  const base: BaseStats = { ...DEFAULT_BASE_STATS, ...baseIn };
  const mod = (type: string, key: string, dflt: number) => {
    const p = parts.find((x) => x.type === type);
    const v = p?.physicsModifiers?.[key];
    return typeof v === "number" ? v : dflt;
  };

  const wheelRadius = base.topSpeedKmh > 280 ? 0.35 : 0.33;
  const wheelbase = base.topSpeedKmh > 280 ? 2.7 : base.massKg > 1500 ? 2.75 : 2.55;
  const trackWidth = base.topSpeedKmh > 280 ? 1.62 : 1.5;
  const drive = base.drive ?? DRIVE_BY_CATEGORY[category ?? ""] ?? "RWD";

  const massKg = base.massKg + mod("ARMOR", "massAdd", 0);

  // ---- engine (stock engine from base stats, replaced when ENGINE part installed)
  const stockEngine = makeEngine(base.engineHp);
  const engine = makeEngine(
    mod("ENGINE", "powerHp", base.engineHp),
    mod("ENGINE", "peakTorqueNm", NaN) || undefined,
    mod("ENGINE", "redlineRpm", 7000),
  );

  // ---- gearing. Ceiling speed = what the *stock* gearbox can reach at redline.
  const stockCeilingMs = (base.topSpeedKmh / 3.6) * 1.3;
  const ceilingMs = stockCeilingMs * mod("GEARBOX", "topSpeedMult", 1);
  const spread = GEAR_SPREAD * mod("GEARBOX", "accelMult", 1);
  const gears = gearRatios(engine.redlineRpm, wheelRadius, ceilingMs, spread);
  const stockGears = gearRatios(stockEngine.redlineRpm, wheelRadius, stockCeilingMs, GEAR_SPREAD);

  // ---- drag calibrated so the STOCK car levels off at its catalogue top speed.
  const drivetrainEff = 0.88;
  const vTop = base.topSpeedKmh / 3.6;
  const rpmAtTop = (vTop / wheelRadius) * stockGears[N_GEARS - 1] * 60 / (2 * Math.PI);
  const wheelPowerAtTop =
    torqueAtRpm(stockEngine, Math.min(rpmAtTop, stockEngine.redlineRpm)) *
    (Math.min(rpmAtTop, stockEngine.redlineRpm) * 2 * Math.PI / 60) * drivetrainEff;
  const rollingResistN = 0.012 * base.massKg * G;
  const dragBase = Math.max(0.05, (wheelPowerAtTop / vTop - rollingResistN) / (vTop * vTop));
  const dragK = dragBase * mod("SPOILER", "dragMult", 1) * mod("AERO", "dragMult", 1);
  const downforceK =
    0.6 * dragBase * mod("SPOILER", "downforceMult", 1) * mod("AERO", "downforceMult", 1);

  // ---- tyres
  const gripMult = base.grip * mod("TYRES", "frictionMult", 1);
  const tyre = {
    frictionSlip: 1.5 * gripMult,
    sideStiffness: 1.0 * mod("TYRES", "sideStiffnessMult", 1),
    driftRearMult: 0.55 * mod("TYRES", "driftRearMult", 1),
    tractionMult: mod("DIFFERENTIAL", "tractionMult", 1),
  };

  // ---- brakes: stock deliver ~0.85 g of retardation – *below* the tyre limit so
  // that better brakes (and better tyres) really shorten stopping distance.
  const maxForceN = 0.85 * G * massKg * base.brakeTorque * mod("BRAKES", "brakeMult", 1);

  // ---- suspension
  const stiffMult = mod("SUSPENSION", "stiffnessMult", 1);
  const dampMult = mod("SUSPENSION", "dampingMult", 1);
  const stiffness = 26 * stiffMult;
  const critical = 2 * Math.sqrt(stiffness);
  const suspension = {
    restLength: clamp(0.3 + mod("SUSPENSION", "rideHeightDelta", 0), 0.16, 0.5),
    maxTravel: 0.28,
    stiffness,
    compression: critical * 0.55 * dampMult,
    relaxation: critical * 0.75 * dampMult,
  };

  return {
    massKg, wheelRadius, wheelbase, trackWidth, drive, engine,
    turbo: { boostTorqueMult: mod("TURBO", "boostTorqueMult", 1), spoolRpm: mod("TURBO", "spoolRpm", 3500) },
    gears, reverseRatio: gears[0] * 0.95, drivetrainEff,
    shiftTimeS: 0.22 * mod("GEARBOX", "shiftTimeMult", 1),
    dragK, rollingResistN, downforceK, tyre,
    brake: { maxForceN, frontBias: 0.6 },
    suspension,
    steering: { maxAngleRad: 34 * DEG, gripAccel: 11 * gripMult },
    nitro: { torqueMult: mod("NITRO", "torqueMult", 1.45), durationS: mod("NITRO", "durationS", 4), rechargePerS: 1 / 18 },
    durability: 1 / mod("ARMOR", "durabilityMult", 1),
    coolingMult: mod("COOLING", "coolingMult", 1),
  };
}

/* ----------------------------------------------------------------- damage */

export interface DamageEffects {
  powerMult: number;
  gripMult: number;
  brakeMult: number;
  suspensionStiffMult: number;
  steerBiasRad: number;
  shiftTimeMult: number;
  maxGear: number;
  coolingMult: number; // radiator health -> airflow/heat rejection
  critical: boolean; // vehicle should be limited / stopped safely
}

export function computeDamageEffects(health: DamageHealth = {}): DamageEffects {
  const h = (k: DamageComponentKey) => clamp((health[k] ?? 100) / 100, 0, 1);
  const tyres = (h("TYRES") + h("WHEELS")) / 2;
  const critical = h("ENGINE") < 0.1 || h("TRANSMISSION") < 0.1;
  let powerMult = (0.35 + 0.65 * h("ENGINE")) * (0.7 + 0.3 * h("TRANSMISSION")) * (0.9 + 0.1 * h("RADIATOR"));
  if (critical) powerMult = Math.min(powerMult, 0.15);
  return {
    powerMult,
    gripMult: 0.55 + 0.45 * tyres,
    brakeMult: 0.3 + 0.7 * h("BRAKES"),
    suspensionStiffMult: 0.6 + 0.4 * h("SUSPENSION"),
    steerBiasRad: (1 - h("SUSPENSION")) * 0.035 * (h("WHEELS") < 0.5 ? 1 : 0.5),
    shiftTimeMult: 1 + (1 - h("TRANSMISSION")) * 2.2,
    maxGear: h("TRANSMISSION") < 0.25 ? 3 : N_GEARS,
    coolingMult: 0.25 + 0.75 * h("RADIATOR"),
    critical,
  };
}

export const NO_DAMAGE: DamageEffects = computeDamageEffects({});

/* -------------------------------------------------------------- drivetrain */

export interface DriveInput {
  throttle: number;  // 0..1
  brake: number;     // 0..1
  steer: number;     // -1..1 (left negative)
  handbrake: boolean;
  nitro: boolean;
}

export interface DrivetrainState {
  gear: number;        // -1 reverse, 1..N forward
  rpm: number;
  shiftTimer: number;
  boost: number;       // 0..1 turbo spool
  nitroFuel: number;   // 0..1
  nitroActive: boolean;
  limiter: boolean;
  temp: number;        // engine heat 0 (cold) .. 1 (hot) .. 1.5 (cooked); >0.85 derates power
}

export const createDrivetrain = (): DrivetrainState => ({
  gear: 1, rpm: 900, shiftTimer: 0, boost: 0, nitroFuel: 1, nitroActive: false, limiter: false, temp: 0.1,
});

/** Heat above this fraction starts cutting engine power. */
export const OVERHEAT_START = 0.85;

export interface DrivetrainOutput {
  engineForceN: number; // total at the contact patches; + forward, - reverse
  brake: number;        // 0..1 service-brake demand after reverse logic
}

/**
 * One fixed step of engine + gearbox. `speed` is signed forward speed (m/s).
 * Mutates `s`.
 */
export function stepDrivetrain(
  s: DrivetrainState, p: VehiclePhysicsParams, fx: DamageEffects,
  input: DriveInput, speed: number, dt: number,
): DrivetrainOutput {
  const e = p.engine;
  const movingFwd = speed > 1.0;
  const movingBack = speed < -1.0;
  let drive = 0;   // signed 0..1
  let brake = 0;

  if (s.gear === -1) {
    if (input.throttle > 0) {
      if (movingBack) brake = input.throttle;
      else { s.gear = 1; drive = input.throttle; }
    } else if (input.brake > 0) drive = -input.brake;
  } else {
    if (input.brake > 0 && input.throttle === 0 && !movingFwd) { s.gear = -1; drive = -input.brake; }
    else { drive = input.throttle; brake = input.brake; }
  }

  const reverse = s.gear === -1;
  const ratio = reverse ? p.reverseRatio : p.gears[Math.max(0, s.gear - 1)];
  const wheelRpm = (Math.abs(speed) / p.wheelRadius) * ratio * 60 / (2 * Math.PI);

  // ---- automatic gearbox
  s.shiftTimer = Math.max(0, s.shiftTimer - dt);
  const maxGear = Math.min(fx.maxGear, p.gears.length);
  if (!reverse && s.shiftTimer === 0) {
    const upRpm = s.gear < p.gears.length ? wheelRpm * p.gears[s.gear] / p.gears[s.gear - 1] : 0;
    const fCur = torqueAtRpm(e, wheelRpm) * p.gears[s.gear - 1];
    const fNext = s.gear < p.gears.length ? torqueAtRpm(e, upRpm) * p.gears[s.gear] : 0;
    const betterUp = drive > 0.5 && upRpm > e.idleRpm * 2 && fNext >= fCur;
    if ((wheelRpm > e.redlineRpm * 0.93 || betterUp) && s.gear < maxGear && drive > 0) {
      s.gear++; s.shiftTimer = p.shiftTimeS * fx.shiftTimeMult;
    } else if (s.gear > 1) {
      const lowerRpm = wheelRpm * p.gears[s.gear - 2] / p.gears[s.gear - 1];
      const lugging = wheelRpm < e.redlineRpm * 0.38;
      const kickdown = drive > 0.9 && wheelRpm < e.redlineRpm * 0.5 && lowerRpm < e.redlineRpm * 0.88;
      if ((lugging && lowerRpm < e.redlineRpm * 0.8) || kickdown) {
        s.gear--; s.shiftTimer = p.shiftTimeS * fx.shiftTimeMult * 0.6;
      }
    }
    if (s.gear > maxGear) s.gear = maxGear;
  }

  // ---- engine speed (clutch slip at launch)
  const launchRpm = e.redlineRpm * 0.32;
  const effRpm = Math.abs(drive) > 0.05 ? Math.max(wheelRpm, launchRpm) : Math.max(wheelRpm, e.idleRpm);
  const target = s.shiftTimer > 0 ? Math.max(e.idleRpm, effRpm * 0.8) : Math.max(e.idleRpm, effRpm);
  s.rpm += (target - s.rpm) * Math.min(1, dt * 14);

  // ---- turbo spool
  const hasTurbo = p.turbo.boostTorqueMult > 1.001;
  const boostTarget = hasTurbo && Math.abs(drive) > 0.5 && effRpm > p.turbo.spoolRpm ? 1 : 0;
  s.boost += (boostTarget - s.boost) * Math.min(1, dt * (boostTarget > s.boost ? 1.4 : 2.5));
  const turboMult = 1 + s.boost * (p.turbo.boostTorqueMult - 1);

  // ---- nitro
  const wantNitro = input.nitro && s.nitroFuel > 0.001 && drive > 0.1 && !reverse;
  s.nitroActive = wantNitro;
  if (wantNitro) s.nitroFuel = Math.max(0, s.nitroFuel - dt / p.nitro.durationS);
  else s.nitroFuel = Math.min(1, s.nitroFuel + dt * p.nitro.rechargePerS);
  const nitroMult = wantNitro ? p.nitro.torqueMult : 1;

  // ---- rev limiter (soft cut 100% → 104% of redline, nitro lifts it a little)
  const limitRpm = e.redlineRpm * (wantNitro ? 1.04 : 1.0);
  const over = (wheelRpm - limitRpm) / (e.redlineRpm * 0.04);
  const limiterScale = clamp(1 - over, 0, 1);
  s.limiter = limiterScale < 1 && Math.abs(drive) > 0.05;

  // ---- thermal model: heat ~ load * (power/100)^0.8 (x2.5 on nitro); rejection ~ (idle + airflow) * cooling part * radiator health
  const load = Math.abs(drive) * clamp(effRpm / e.redlineRpm, 0, 1.1);
  const heatIn = 0.012 * load * Math.pow(Math.max(e.powerHp, 20) / 100, 0.8) * (wantNitro ? 2.5 : 1);
  const heatOut = (0.012 + 0.0007 * Math.abs(speed)) * p.coolingMult * fx.coolingMult;
  const heatDerate = s.temp > OVERHEAT_START ? clamp(1 - (s.temp - OVERHEAT_START) * 2.2, 0.45, 1) : 1;
  s.temp = clamp(s.temp + (heatIn - heatOut * s.temp) * dt, 0, 1.5);

  let force = 0;
  if (s.shiftTimer === 0 && Math.abs(drive) > 0) {
    const torque = torqueAtRpm(e, effRpm) * turboMult * nitroMult * fx.powerMult * limiterScale * heatDerate;
    force = (torque * ratio * p.drivetrainEff * p.tyre.tractionMult / p.wheelRadius) * Math.abs(drive);
    if (reverse) force = -force * 0.8;
    if (fx.critical) force = clamp(force, -2500, 2500) * clamp(1 - Math.abs(speed) / 18, 0, 1);
  }
  return { engineForceN: force, brake };
}

/* ----------------------------------------------------------------- helpers */

/** Steering limit (rad) at speed v: stays inside the tyre grip circle. */
export function steerLimit(p: VehiclePhysicsParams, fx: DamageEffects, v: number): number {
  const a = p.steering.gripAccel * fx.gripMult;
  const lim = (1.5 * p.wheelbase * a) / Math.max(v * v, 1);
  return clamp(lim, 0.04, p.steering.maxAngleRad);
}

/** Convenience: theoretical drag-limited top speed in km/h (for the garage UI/tests). */
export function estimateTopSpeedKmh(p: VehiclePhysicsParams): number {
  let best = 0;
  for (let g = 0; g < p.gears.length; g++) {
    for (let v = 5; v < 140; v += 0.25) {
      const rpm = (v / p.wheelRadius) * p.gears[g] * 60 / (2 * Math.PI);
      if (rpm > p.engine.redlineRpm) break;
      const t = torqueAtRpm(p.engine, rpm) * Math.max(1, p.turbo.boostTorqueMult);
      const f = (t * p.gears[g] * p.drivetrainEff) / p.wheelRadius;
      if (f >= p.dragK * v * v + p.rollingResistN) best = Math.max(best, v);
    }
  }
  return best * 3.6;
}
