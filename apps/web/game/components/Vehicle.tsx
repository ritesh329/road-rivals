"use client";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { MP, computeDamageEffects, crossedCheckpoint, getCityLayout, GARAGES, type VehicleConfig, type VehiclePhysicsParams } from "@road-rivals/shared";
import { RaycastVehicle, createChassis, DT } from "../physics/RaycastVehicle";
import { controls, useGame, view } from "../store";
import { readControls } from "../input";
import { EngineAudio } from "../audio";
import CarModel, { type CarModelHandle, type ModelPart } from "./CarModel";
import { useDamage } from "../garage/damageSync";
import { useGarageUi } from "../garage/garageStore";
import { claimLap } from "../garage/rewards";
import { useNet, remote as remoteNet } from "../net/netStore";
import { raceActive, raceFrozen, raceRespawnPose } from "../race/raceStore";
import { getSocket } from "@/services/socket";

const UP = new THREE.Vector3(0, 1, 0);
const FLIP_Q = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

interface Props { params: VehiclePhysicsParams; paint: string; category: string; config: VehicleConfig; modelParts: ModelPart[] }

export default function Vehicle({ params, paint, category, config, modelParts }: Props) {
  const { world, rapier } = useRapier();
  const { camera, size } = useThree();
  const model = useRef<CarModelHandle>(null!);
  const veh = useRef<RaycastVehicle | null>(null);
  const audio = useMemo(() => new EngineAudio(), []);
  const L = useMemo(() => getCityLayout(), []);
  const health = useDamage((d) => d.health);
  const preview = useGarageUi((g) => g.preview);
  const shownConfig = useMemo(() => ({ ...config, ...(preview ?? {}) }), [config, preview]);

  const sim = useRef({
    acc: 0, t: 0, hudT: 0, spin: 0, flipT: 0, waterT: 0, lapStart: 0,
    prevP: new THREE.Vector3(), currP: new THREE.Vector3(), prevQ: new THREE.Quaternion(), currQ: new THREE.Quaternion(),
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fw: new THREE.Vector3(0, 0, 1),
    camPos: new THREE.Vector3(), camInit: false,
    respawn: { ...(useNet.getState().spawn ?? { x: L.spawns[0].x, y: 1, z: L.spawns[0].z, yaw: L.spawns[0].yaw }) },
    netAcc: 0,
    fromServer: false, near: null as string | null, fov: 62, shake: 0, hasPose: false, offsetOn: false,
    tmpV: new THREE.Vector3(), tmpQ: new THREE.Quaternion(),
  });

  // ---- (re)create the physics vehicle when the PHYSICS parameters change (part installed / swapped).
  // The new body appears exactly where the old one was, at rest. Damage does NOT rebuild the car.
  useEffect(() => {
    world.timestep = DT;
    const s = sim.current;
    const sp = s.respawn;
    let pos = { x: sp.x, y: 0.9, z: sp.z }, yaw = sp.yaw;
    if (s.hasPose) {
      const q = s.currQ;
      yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      pos = { x: s.currP.x, y: s.currP.y + 0.25, z: s.currP.z };
    }
    const body = createChassis(rapier, world, params, pos, yaw);
    const v = new RaycastVehicle(rapier, world, body, params);
    v.setDamage(computeDamageEffects(useDamage.getState().health));
    veh.current = v;
    const t = body.translation(); s.prevP.set(t.x, t.y, t.z); s.currP.copy(s.prevP);
    const r = body.rotation(); s.prevQ.set(r.x, r.y, r.z, r.w); s.currQ.copy(s.prevQ);
    s.hasPose = true;
    v.resetImpacts();
    return () => { v.dispose(); world.removeRigidBody(body); veh.current = null; };
  }, [world, rapier, params]);

  // dev/test-only hook (stripped from production builds): lets the browser E2E test teleport the car
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as any).__RR_DEBUG__ = {
      teleport: (x: number, z: number, yaw = 0) => { sim.current.respawn = { x, y: 0.6, z, yaw }; controls.respawn = true; },
      pos: () => ({ x: view.x, y: view.y, z: view.z, speed: view.speed }),
      damage: () => useDamage.getState().health,
      netPlayers: () => Object.keys(useNet.getState().players).length,
      remotes: () => [...remoteNet.pos.entries()].map(([id, r]) => ({ id, ...r })),
    };
    return () => { delete (window as any).__RR_DEBUG__; };
  }, []);

  // ---- damage → physics: hot-swap the damage effects whenever live health changes
  useEffect(() => { veh.current?.setDamage(computeDamageEffects(health)); }, [health]);

  useEffect(() => {
    const start = () => audio.start(params);
    window.addEventListener("pointerdown", start, { once: false }); window.addEventListener("keydown", start, { once: false });
    return () => { window.removeEventListener("pointerdown", start); window.removeEventListener("keydown", start); audio.stop(); };
  }, [audio, params]);

  useFrame((state, frameDt) => {
    const v = veh.current; if (!v) return;
    const s = sim.current;
    const game = useGame.getState();
    s.acc += Math.min(frameDt, 0.1);

    while (s.acc >= DT) {
      s.acc -= DT; s.t += DT;
      s.prevP.copy(s.currP); s.prevQ.copy(s.currQ);
      const parked = useGarageUi.getState().open || raceFrozen();
      const c = parked ? { throttle: 0, brake: 1, steer: 0, handbrake: true, nitro: false } : readControls();
      v.update(DT, { throttle: c.throttle, brake: c.brake, steer: c.steer, handbrake: c.handbrake, nitro: c.nitro });
      world.step();
      const hit = v.afterStep();
      if (hit) onImpact(s, hit, game.sound);
      const t = v.body.translation(), r = v.body.rotation();
      const before = s.currP.clone();
      s.currP.set(t.x, t.y, t.z); s.currQ.set(r.x, r.y, r.z, r.w);
      stepGameplay(s, v, before, game);
    }

    // ---- multiplayer: broadcast our pose at 20 Hz; obey server corrections (anti-teleport)
    const net = useNet.getState();
    if (net.active && net.ready) {
      if (net.correct) { s.respawn = { ...s.respawn, x: net.correct.x, y: 0.8, z: net.correct.z, yaw: net.correct.yaw ?? s.respawn.yaw }; s.fromServer = true; controls.respawn = true; useNet.setState({ correct: null }); }
      s.netAcc += frameDt;
      if (s.netAcc >= 1 / MP.sendHz) { s.netAcc = 0; sendNetState(v); }
    }

    const alpha = s.acc / DT;
    s.pos.copy(s.prevP).lerp(s.currP, alpha);
    s.quat.copy(s.prevQ).slerp(s.currQ, alpha);
    const m = model.current;
    if (m?.group) {
      m.group.position.copy(s.pos); m.group.quaternion.copy(s.quat);
      m.body.visible = game.camera !== "first";
      const speed = v.telemetry.speedMs;
      s.spin += (speed / params.wheelRadius) * frameDt;
      for (let i = 0; i < 4; i++) {
        const susp = v.controller.wheelSuspensionLength(i) ?? params.suspension.restLength;
        const w = m.wheels[i]; if (!w) continue;
        w.position.y = -0.05 - susp;
        w.rotation.y = i < 2 ? (v.controller.wheelSteering(i) ?? 0) : 0;
        m.wheelSpin[i].rotation.x = s.spin;
      }
      m.brakeLights.emissiveIntensity = controls.brake > 0 && v.telemetry.speedMs > 0.5 ? 3 : 0.4;
      m.nitroFlame.visible = v.state.nitroActive;
      if (v.state.nitroActive) m.nitroFlame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }

    // shared view for minimap / lights
    const f = s.tmpV.set(0, 0, 1).applyQuaternion(s.quat);
    const flat = Math.hypot(f.x, f.z) || 1;
    view.x = s.pos.x; view.y = s.pos.y; view.z = s.pos.z; view.fx = f.x / flat; view.fz = f.z / flat;
    view.yaw = Math.atan2(view.fx, view.fz); view.speed = v.telemetry.speedMs;

    updateCamera(camera as THREE.PerspectiveCamera, s, game.camera, frameDt, v);
    // garage panel covers the right half of the screen: slide the 3D view left so the car stays visible
    const cam = camera as THREE.PerspectiveCamera;
    const wantOffset = useGarageUi.getState().open && size.width >= 768;
    if (wantOffset !== s.offsetOn) {
      s.offsetOn = wantOffset;
      if (wantOffset) cam.setViewOffset(size.width, size.height, size.width * 0.24, 0, size.width, size.height); else cam.clearViewOffset();
    }
    if (s.shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * s.shake; camera.position.y += (Math.random() - 0.5) * s.shake; camera.position.z += (Math.random() - 0.5) * s.shake;
      s.shake *= Math.exp(-6 * frameDt);
    }
    audio.update(v.telemetry.rpm, controls.throttle, game.sound);

    s.hudT += frameDt;
    if (s.hudT > 0.08) {
      s.hudT = 0; const t = v.telemetry;
      game.setHud({ speedKmh: t.speedKmh, rpm: t.rpm, redline: t.redline, gear: t.gear, nitro: t.nitro, boost: t.boost, drifting: t.drifting, limiter: t.limiter, shifting: t.shifting, temp: t.temp });
      if (game.circuit.running) game.setCircuit({ lapMs: (s.t - s.lapStart) * 1000 });
    }
  });

  function stepGameplay(s: typeof sim.current, v: RaycastVehicle, before: THREE.Vector3, game: ReturnType<typeof useGame.getState>) {
    const p = s.currP;
    // respawn: key, flipped, fell in the canal
    const upY = s.tmpV.set(0, 1, 0).applyQuaternion(s.currQ).y;
    s.flipT = upY < 0.25 && Math.abs(v.telemetry.speedMs) < 3 ? s.flipT + DT : 0;
    s.waterT = p.y < -1.8 ? s.waterT + DT : 0;
    if (controls.respawn || s.flipT > 2.5 || s.waterT > 1.2 || p.y < -30) {
      controls.respawn = false; s.flipT = 0; s.waterT = 0;
      // in a race the respawn point is the last gate the server saw us pass (or the grid) – same place the server will use
      if (raceActive() && !s.fromServer) s.respawn = { ...raceRespawnPose(useNet.getState().seat), y: 0.6 };
      const sp = s.respawn;
      v.body.setTranslation({ x: sp.x, y: sp.y + 0.6, z: sp.z }, true);
      v.body.setRotation({ x: 0, y: Math.sin(sp.yaw / 2), z: 0, w: Math.cos(sp.yaw / 2) }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      s.currP.set(sp.x, sp.y + 0.6, sp.z); s.prevP.copy(s.currP);
      s.currQ.set(0, Math.sin(sp.yaw / 2), 0, Math.cos(sp.yaw / 2)); s.prevQ.copy(s.currQ);
      v.resetImpacts();
      if (useNet.getState().active && !s.fromServer) getSocket().emit("game:respawn", { x: sp.x, y: 1, z: sp.z });
      s.fromServer = false;
    }
    // free-roam circuit (switched off while a server-run race is on, so laps are never counted twice)
    const cp = L.checkpoints[game.circuit.next % L.checkpoints.length];
    if (!raceActive() && crossedCheckpoint(before.x, before.z, p.x, p.z, cp)) {
      const n = L.checkpoints.length;
      const c = game.circuit;
      s.respawn = { x: cp.x + Math.sin(cp.yaw) * 4, y: 0.6, z: cp.z + Math.cos(cp.yaw) * 4, yaw: cp.yaw };
      if (!c.running) { s.lapStart = s.t; game.setCircuit({ running: true, next: 1, lap: 1, message: "Lap 1 started" }); }
      else if (c.next === 0) {
        const ms = (s.t - s.lapStart) * 1000; s.lapStart = s.t;
        const own = useDamage.getState().ownershipId; if (own) void claimLap(own, ms);
        game.setCircuit({ next: 1, lap: c.lap + 1, lastMs: ms, bestMs: c.bestMs === null ? ms : Math.min(c.bestMs, ms), message: `Lap ${c.lap} complete` });
      } else game.setCircuit({ next: (c.next + 1) % n, message: `Checkpoint ${c.next}/${n}` });
    }
    // garage proximity (services arrive in Phase 3)
    let near: string | null = null; let nearG: (typeof GARAGES)[number] | null = null;
    for (const g of GARAGES) if (Math.hypot(g.x - p.x, g.z - p.z) < g.radius) { near = g.name; nearG = g; break; }
    if (near !== s.near) {
      s.near = near; game.setNearGarage(near);
      useGarageUi.getState().setNear(nearG ? { slug: nearG.slug, name: nearG.name, kind: nearG.kind } : null);
      if (!nearG && useGarageUi.getState().open) useGarageUi.getState().setOpen(false);
    }
  }

  function sendNetState(v: RaycastVehicle) {
    const t = v.body.translation(), r = v.body.rotation(), l = v.body.linvel();
    const f = (n: number) => (Number.isFinite(n) ? n : 0);
    getSocket().volatile.emit("game:state", {
      x: f(t.x), y: f(t.y), z: f(t.z), qx: f(r.x), qy: f(r.y), qz: f(r.z), qw: f(r.w) || 1,
      vx: f(l.x), vy: f(l.y), vz: f(l.z), steer: Math.max(-1, Math.min(1, f(controls.steer))), speed: f(v.telemetry.speedKmh),
      nitro: controls.nitro && v.telemetry.nitro > 0.02, braking: controls.brake > 0.1, drifting: v.telemetry.drifting,
    });
  }

  function onImpact(s: typeof sim.current, hit: { mag: number; lx: number; ly: number; lz: number }, sound: boolean) {
    useDamage.getState().addImpact(hit);
    s.shake = Math.min(0.9, 0.08 + hit.mag * 0.03);
    audio.impact(hit.mag, sound);
  }

  return <CarModel ref={model} params={params} paint={paint} category={category} config={shownConfig} parts={modelParts} damage={health} />;
}

function updateCamera(cam: THREE.PerspectiveCamera, s: any, mode: string, dt: number, v: RaycastVehicle) {
  const speed = Math.abs(v.telemetry.speedMs);
  const targetFov = 62 + Math.min(speed, 70) * 0.28 + (v.state.nitroActive ? 10 : 0) + (mode === "first" ? 8 : 0);
  s.fov += (targetFov - s.fov) * Math.min(1, dt * 4);
  if (Math.abs(cam.fov - s.fov) > 0.05) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
  const k = (r: number) => 1 - Math.exp(-r * dt);

  if (mode === "chase") {
    const f = s.tmpV.set(0, 0, 1).applyQuaternion(s.quat); f.y = 0; f.normalize();
    s.fw.lerp(f, k(4)).normalize();
    const compact = typeof window !== "undefined" && window.innerHeight <= 520; // landscape phone: thumbs cover the bottom
    const dist = 7.4 + speed * 0.035 + (compact ? 1.3 : 0);
    const want = new THREE.Vector3().copy(s.pos).addScaledVector(s.fw, -dist); want.y = s.pos.y + (compact ? 3.1 : 2.7) + speed * 0.01;
    if (!s.camInit) { s.camPos.copy(want); s.camInit = true; }
    s.camPos.lerp(want, k(9));
    cam.position.copy(s.camPos);
    cam.lookAt(s.pos.x + s.fw.x * 4, s.pos.y + (compact ? 0.1 : 1.0), s.pos.z + s.fw.z * 4);
  } else {
    s.camInit = false;
    const off = mode === "hood" ? s.tmpV.set(0, 0.95, 1.4) : s.tmpV.set(0.0, 0.82, 0.15);
    off.applyQuaternion(s.quat);
    cam.position.copy(s.pos).add(off);
    s.tmpQ.copy(s.quat).multiply(FLIP_Q);
    cam.quaternion.slerp(s.tmpQ, k(18));
  }
}
