import RAPIER from "@dimforge/rapier3d-compat";
import { buildPhysicsParams, computeDamageEffects, type DriveInput, type InstalledPart, type BaseStats, type DamageHealth, type Impact } from "@road-rivals/shared";
import { RaycastVehicle, createChassis, DT } from "../game/physics/RaycastVehicle";

export const STOCK: Partial<BaseStats> = { massKg: 1100, engineHp: 100, topSpeedKmh: 170, grip: 1.0, brakeTorque: 1.0 };
export const IDLE: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

export async function makeSim(base: Partial<BaseStats> = STOCK, parts: InstalledPart[] = [], damage: DamageHealth = {}, category = "HATCHBACK") {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setFriction(1));
  const params = buildPhysicsParams(base, parts, category);
  const body = createChassis(RAPIER, world, params, { x: 0, y: 0.7, z: 0 }, 0);
  const car = new RaycastVehicle(RAPIER, world, body, params);
  car.setDamage(computeDamageEffects(damage));
  const impacts: Impact[] = [];
  const step = (input: DriveInput) => { car.update(DT, input); world.step(); const i = car.afterStep(); if (i) impacts.push(i); };
  const run = (secs: number, input: DriveInput | ((t: number) => DriveInput)) => {
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) step(typeof input === "function" ? input(i * DT) : input);
  };
  const pos = () => body.translation();
  return { world, body, car, params, step, run, pos, impacts };
}
