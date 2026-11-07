"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { Html } from "@react-three/drei";
import type RAPIER from "@dimforge/rapier3d-compat";
import { MP, buildPhysicsParams, type NetPlayer } from "@road-rivals/shared";
import CarModel, { type CarModelHandle } from "../components/CarModel";
import { CHASSIS_HALF } from "../physics/RaycastVehicle";
import { SEAT_COLORS, remote, useNet } from "./netStore";

/**
 * One interpolated car per remote player. Each also gets a kinematic Rapier body (same box as a
 * real chassis) that follows the interpolated pose, so cars genuinely collide with each other:
 * every client simulates the hit against the other car's body, and the normal impact → damage
 * pipeline (shared/damage.ts) applies it to the local car.
 */
export default function RemoteCars() {
  const players = useNet((s) => s.players);
  return <>{Object.values(players).map((p) => <RemoteCar key={p.id} player={p} />)}</>;
}

function RemoteCar({ player }: { player: NetPlayer }) {
  const { world, rapier } = useRapier();
  const handle = useRef<CarModelHandle>(null!);
  const body = useRef<RAPIER.RigidBody | null>(null);
  const spin = useRef(0);
  const a = player.appearance;
  const params = useMemo(() => buildPhysicsParams(a.baseStats, [], a.category), [a.baseStats, a.category]);
  const color = SEAT_COLORS[player.seat % SEAT_COLORS.length];
  const group = useRef<any>(null);

  useEffect(() => {
    const half = { x: params.trackWidth / 2 + 0.12, y: CHASSIS_HALF.y, z: params.wheelbase / 2 + 0.75 };
    const b = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    world.createCollider(rapier.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.3).setRestitution(0.1), b);
    body.current = b;
    return () => { world.removeRigidBody(b); body.current = null; };
  }, [world, rapier, params]);

  useEffect(() => { handle.current?.wheels.forEach((w) => { if (w) w.position.y = -0.05 - params.suspension.restLength; }); }, [params]);

  // priority -1: runs before the local vehicle's fixed-step loop so the kinematic bodies are current when it steps
  useFrame((_, dt) => {
    const buf = remote.buffers.get(player.id);
    const h = handle.current;
    if (!buf || !h?.group) return;
    const renderT = Date.now() - (remote.offset ?? 0) - MP.interpDelayMs;
    const s = buf.sample(renderT);
    if (!s) { h.group.visible = false; return; }
    h.group.visible = true;
    h.group.position.set(s.x, s.y, s.z); h.group.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    body.current?.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
    body.current?.setNextKinematicRotation({ x: s.qx, y: s.qy, z: s.qz, w: s.qw });
    spin.current += ((s.speed / 3.6) / params.wheelRadius) * dt;
    for (let i = 0; i < 4; i++) {
      if (h.wheelSpin[i]) h.wheelSpin[i].rotation.x = spin.current;
      if (i < 2 && h.wheels[i]) h.wheels[i].rotation.y = -s.steer * 0.45;
    }
    h.brakeLights.emissiveIntensity = s.braking ? 2.2 : 0.4;
    if (h.nitroFlame) h.nitroFlame.visible = s.nitro;
    const yaw = Math.atan2(2 * (s.qw * s.qy + s.qx * s.qz), 1 - 2 * (s.qy * s.qy + s.qx * s.qx));
    remote.pos.set(player.id, { x: s.x, z: s.z, yaw, name: player.username, speed: s.speed, seat: player.seat });
  }, -1);

  useEffect(() => () => { remote.pos.delete(player.id); }, [player.id]);

  return (
    <group ref={group}>
      <CarModel ref={handle} params={params} paint={String(a.config.paint ?? "#888")} category={a.category} config={a.config as any} parts={a.parts} damage={a.damage} />
      <Tag name={player.username} color={color} target={handle} />
    </group>
  );
}

/** DOM name tag that follows the car (re-parented to the car's moving group via a tiny follower). */
function Tag({ name, color, target }: { name: string; color: string; target: React.RefObject<CarModelHandle> }) {
  const ref = useRef<any>(null);
  useFrame(() => { const g = target.current?.group; if (g && ref.current) { ref.current.position.copy(g.position); ref.current.position.y += 2.1; ref.current.visible = g.visible; } });
  return (
    <group ref={ref}>
      <Html center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div data-testid="nametag" className="whitespace-nowrap rounded-md bg-black/60 px-2 py-0.5 text-xs font-bold" style={{ color, border: `1px solid ${color}` }}>{name}</div>
      </Html>
    </group>
  );
}
