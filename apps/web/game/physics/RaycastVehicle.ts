import type RAPIER from "@dimforge/rapier3d-compat";
import {
  createDrivetrain, stepDrivetrain, steerLimit, NO_DAMAGE, ImpactDetector,
  type DamageEffects, type DriveInput, type DrivetrainState, type Impact, type VehiclePhysicsParams,
} from "@road-rivals/shared";

type R = typeof RAPIER;

export interface VehicleTelemetry {
  speedKmh: number; speedMs: number; rpm: number; redline: number; gear: number;
  nitro: number; boost: number; onGround: number; slip: number; drifting: boolean;
  limiter: boolean; shifting: boolean; temp: number;
}

/** Chassis half extents used by both the collider and the wheel layout. */
export const CHASSIS_HALF = { x: 0.9, y: 0.35, z: 2.1 };
const CONNECT_Y = -0.05; // wheel attach height relative to COM (body origin)

/**
 * Raycast-vehicle wrapper around Rapier's DynamicRayCastVehicleController.
 * Local +Z is the car's forward direction. Call `update(dt, input)` once per
 * fixed step *before* `world.step()`.
 */
export class RaycastVehicle {
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly dt = DT;
  state: DrivetrainState = createDrivetrain();
  telemetry: VehicleTelemetry;
  private steerAngle = 0;
  private steerInput = 0;
  private fx: DamageEffects = NO_DAMAGE;
  private wasDrifting = false;
  /** Watches chassis Δv after every world step; one Impact per collision (see shared/damage.ts). */
  readonly impacts = new ImpactDetector();

  constructor(private rapier: R, private world: RAPIER.World, readonly body: RAPIER.RigidBody, public params: VehiclePhysicsParams) {
    this.controller = world.createVehicleController(body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const hw = params.trackWidth / 2, hb = params.wheelbase / 2;
    const dir = { x: 0, y: -1, z: 0 }, axle = { x: -1, y: 0, z: 0 };
    const pts = [[-hw, hb], [hw, hb], [-hw, -hb], [hw, -hb]]; // FL FR RL RR
    for (const [x, z] of pts) {
      this.controller.addWheel({ x, y: CONNECT_Y, z }, dir, axle, params.suspension.restLength, params.wheelRadius);
    }
    this.telemetry = { speedKmh: 0, speedMs: 0, rpm: 900, redline: params.engine.redlineRpm, gear: 1, nitro: 1, boost: 0, onGround: 0, slip: 0, drifting: false, limiter: false, shifting: false, temp: 0.1 };
    this.applyStatic();
  }

  /** Hot-swap physics (after repair / upgrade install) without recreating the body. */
  setParams(p: VehiclePhysicsParams) {
    this.params = p;
    this.applyStatic();
  }
  setDamage(fx: DamageEffects) { this.fx = fx; this.applyStatic(); }

  private applyStatic() {
    const s = this.params.suspension;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionRestLength(i, s.restLength);
      this.controller.setWheelMaxSuspensionTravel(i, s.maxTravel);
      this.controller.setWheelSuspensionStiffness(i, s.stiffness * this.fx.suspensionStiffMult);
      this.controller.setWheelSuspensionCompression(i, s.compression);
      this.controller.setWheelSuspensionRelaxation(i, s.relaxation);
      this.controller.setWheelMaxSuspensionForce(i, 1e6);
      this.controller.setWheelSideFrictionStiffness(i, this.params.tyre.sideStiffness);
      this.controller.setWheelFrictionSlip(i, this.params.tyre.frictionSlip * this.fx.gripMult);
    }
  }

  update(dt: number, input: DriveInput) {
    const p = this.params, c = this.controller, b = this.body;
    const speed = c.currentVehicleSpeed();
    const out = stepDrivetrain(this.state, p, this.fx, input, speed, dt);

    // ---- steering (smoothed input, speed-sensitive limit)
    const rate = input.steer === 0 ? 7 : 4.5;
    this.steerInput += (input.steer - this.steerInput) * Math.min(1, rate * dt);
    const target = -this.steerInput * steerLimit(p, this.fx, Math.abs(speed)) + this.fx.steerBiasRad;
    this.steerAngle += (target - this.steerAngle) * Math.min(1, 14 * dt);
    c.setWheelSteering(0, this.steerAngle);
    c.setWheelSteering(1, this.steerAngle);

    // ---- drive distribution
    const driven = p.drive === "AWD" ? [0, 1, 2, 3] : p.drive === "FWD" ? [0, 1] : [2, 3];
    for (let i = 0; i < 4; i++) c.setWheelEngineForce(i, driven.includes(i) ? out.engineForceN / driven.length : 0);

    // ---- brakes (Rapier brake value = friction-impulse limit, so scale by dt)
    const svc = out.brake * p.brake.maxForceN * this.fx.brakeMult;
    const fb = svc * p.brake.frontBias / 2, rb = svc * (1 - p.brake.frontBias) / 2;
    const hand = input.handbrake ? p.brake.maxForceN * 0.9 / 2 : 0;
    // Rapier's brake ignores tyre grip, so cap each wheel by mu * normal load.
    const mu = 1.15 * (p.tyre.frictionSlip * this.fx.gripMult) / 1.5;
    const cap = (i: number, f: number) => {
      const load = Math.max(0, c.wheelSuspensionForce(i) ?? 0);
      return Math.min(f * dt, mu * load * dt);
    };
    c.setWheelBrake(0, cap(0, fb)); c.setWheelBrake(1, cap(1, fb));
    c.setWheelBrake(2, cap(2, rb + hand)); c.setWheelBrake(3, cap(3, rb + hand));

    // ---- tyre grip: handbrake / drift loosens the rear axle
    const base = p.tyre.frictionSlip * this.fx.gripMult;
    const rear = input.handbrake ? base * p.tyre.driftRearMult : base;
    c.setWheelFrictionSlip(0, base); c.setWheelFrictionSlip(1, base);
    c.setWheelFrictionSlip(2, rear); c.setWheelFrictionSlip(3, rear);

    // ---- aero + rolling resistance (applied as impulses on the chassis)
    const v = b.linvel();
    const vm = Math.hypot(v.x, v.y, v.z);
    if (vm > 0.05) {
      const drag = p.dragK * vm * vm + (p.rollingResistN * Math.min(1, vm / 3));
      const k = (drag * dt) / vm;
      b.applyImpulse({ x: -v.x * k, y: -v.y * k * 0.2, z: -v.z * k }, true);
      b.applyImpulse({ x: 0, y: -p.downforceK * vm * vm * dt, z: 0 }, true);
    }

    c.updateVehicle(dt);

    // ---- telemetry
    let onGround = 0;
    for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) onGround++;
    const q = b.rotation();
    const lateral = lateralSpeed(q, b.linvel());
    const t = this.telemetry;
    t.speedMs = c.currentVehicleSpeed(); t.speedKmh = Math.abs(t.speedMs) * 3.6;
    t.rpm = this.state.rpm; t.redline = p.engine.redlineRpm; t.gear = this.state.gear;
    t.nitro = this.state.nitroFuel; t.boost = this.state.boost; t.onGround = onGround;
    t.slip = lateral; t.drifting = onGround > 1 && Math.abs(lateral) > 3 && Math.abs(t.speedMs) > 8;
    t.limiter = this.state.limiter; t.shifting = this.state.shiftTimer > 0; t.temp = this.state.temp;
  }

  /** Call right after `world.step()`. Returns an Impact when a collision just finished. */
  afterStep(): Impact | null {
    return this.impacts.step(this.body.linvel(), this.body.rotation(), this.dt);
  }
  /** Call after a teleport/respawn so the velocity jump isn't read as a crash. */
  resetImpacts() { this.impacts.reset(this.body.linvel()); }

  dispose() { this.world.removeVehicleController(this.controller); }
}

export const DT = 1 / 60;

function lateralSpeed(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }) {
  // local X axis in world space
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.z * q.w), rz = 2 * (q.x * q.z - q.y * q.w);
  return v.x * rx + v.y * ry + v.z * rz;
}

/** Create the chassis rigid body + collider (origin = centre of mass, low). */
export function createChassis(rapier: R, world: RAPIER.World, p: VehiclePhysicsParams, pos: { x: number; y: number; z: number }, yaw = 0) {
  const half = { x: p.trackWidth / 2 + 0.12, y: CHASSIS_HALF.y, z: p.wheelbase / 2 + 0.75 };
  const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(q)
      .setCanSleep(false).setCcdEnabled(true).setAngularDamping(1.2).setLinearDamping(0),
  );
  const vol = 8 * half.x * half.y * half.z;
  world.createCollider(
    rapier.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(p.massKg / vol).setFriction(0.3).setRestitution(0.1), body,
  );
  return body;
}
