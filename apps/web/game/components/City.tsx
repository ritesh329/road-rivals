"use client";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { getCityLayout, GARAGES, ROAD_W, BLOCK_HALF, type Mat, type StaticBox } from "@road-rivals/shared";
import { useGame } from "../store";
import { useRace } from "../race/raceStore";

/** shared night factor (0 day … 1 night) read by shader + emissive materials */
export const nightU = { value: 0 };

/* ------------------------------------------------------------ colliders */
export function StaticColliders() {
  const { world, rapier } = useRapier();
  useEffect(() => {
    const L = getCityLayout();
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    for (const b of L.statics) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rx ?? 0, b.ry ?? 0, b.rz ?? 0));
      world.createCollider(
        rapier.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(b.mat === "grass" ? 0.8 : 1).setRestitution(0.05),
        body,
      );
    }
    // buildings: solid footprints
    for (const b of L.buildings) {
      world.createCollider(rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setFriction(0.6), body);
    }
    return () => { world.removeRigidBody(body); };
  }, [world, rapier]);
  return null;
}

/* ------------------------------------------------------------- materials */
const MATS: Record<Mat, { color: string; rough?: number; metal?: number; emissive?: string } | null> = {
  ground: { color: "#2a3a30" }, asphalt: { color: "#2b2e35", rough: 0.95 }, sidewalk: { color: "#5b6270" },
  grass: { color: "#2f6b3a" }, concrete: { color: "#6b7280" }, rail: { color: "#a3aab5", metal: 0.4, rough: 0.5 },
  ramp: { color: "#f59e0b", emissive: "#4a2d00" }, tunnel: { color: "#3f4652" }, wall: { color: "#1f2937" },
  garage: { color: "#374151" }, hidden: null, canal: { color: "#16324f" },
};

const tmp = new THREE.Object3D();

function useInstances(count: number, fill: (i: number, o: THREE.Object3D, mesh: THREE.InstancedMesh) => void) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useEffect(() => {
    const m = ref.current; if (!m) return;
    for (let i = 0; i < count; i++) { tmp.position.set(0, 0, 0); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1); fill(i, tmp, m); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  return ref;
}

function Statics() {
  const L = getCityLayout();
  const groups = useMemo(() => {
    const g = new Map<Mat, StaticBox[]>();
    for (const b of L.statics) { if (!MATS[b.mat]) continue; (g.get(b.mat) ?? g.set(b.mat, []).get(b.mat)!).push(b); }
    return [...g.entries()];
  }, [L]);
  return <>{groups.map(([mat, boxes]) => <StaticGroup key={mat} mat={mat} boxes={boxes} />)}</>;
}
function StaticGroup({ mat, boxes }: { mat: Mat; boxes: StaticBox[] }) {
  const ref = useInstances(boxes.length, (i, o) => {
    const b = boxes[i];
    o.position.set(b.x, b.y, b.z); o.rotation.set(b.rx ?? 0, b.ry ?? 0, b.rz ?? 0); o.scale.set(b.hx, b.hy, b.hz);
  });
  const d = MATS[mat]!;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} frustumCulled={false} receiveShadow castShadow={mat === "rail" || mat === "tunnel" || mat === "wall"}>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color={d.color} roughness={d.rough ?? 0.9} metalness={d.metal ?? 0} emissive={d.emissive ?? "#000"} />
    </instancedMesh>
  );
}

/* ----------------------------------------------------------------- roads */
function roadTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 192;
  const g = c.getContext("2d")!;
  g.fillStyle = "#23262d"; g.fillRect(0, 0, 1024, 192);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * 1024, Math.random() * 192, 2, 2); }
  g.fillStyle = "#d8d8d0"; g.fillRect(0, 8, 1024, 4); g.fillRect(0, 180, 1024, 4);
  g.fillStyle = "#f5c518";
  for (let x = 40; x < 1024 - 40; x += 90) g.fillRect(x, 94, 50, 4);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function Roads() {
  const L = getCityLayout();
  const tex = useMemo(roadTexture, []);
  const segRef = useInstances(L.roadSegs.length, (i, o) => {
    const s = L.roadSegs[i];
    o.position.set(s.x, 0.02, s.z); o.rotation.set(0, s.dir === "z" ? Math.PI / 2 : 0, 0); o.scale.set(s.len, 1, ROAD_W);
  });
  const xRef = useInstances(L.intersections.length, (i, o) => { const p = L.intersections[i]; o.position.set(p.x, 0.022, p.z); o.scale.set(ROAD_W, 1, ROAD_W); });
  const markRef = useInstances(L.markings.length, (i, o) => { const m = L.markings[i]; o.position.set(m.x, 0.06, m.z); o.scale.set(m.w, 1, m.d); });
  return (
    <>
      <instancedMesh ref={segRef} args={[undefined, undefined, L.roadSegs.length]} frustumCulled={false} receiveShadow>
        <planeGeometry args={[1, 1]} onUpdate={(g) => g.rotateX(-Math.PI / 2)} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={xRef} args={[undefined, undefined, L.intersections.length]} frustumCulled={false} receiveShadow>
        <planeGeometry args={[1, 1]} onUpdate={(g) => g.rotateX(-Math.PI / 2)} />
        <meshStandardMaterial color="#23262d" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={markRef} args={[undefined, undefined, L.markings.length]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} onUpdate={(g) => g.rotateX(-Math.PI / 2)} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.8} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------- buildings */
function Buildings() {
  const L = getCityLayout();
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.1 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = nightU;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;")
        .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
          vec4 wp_ = vec4(transformed, 1.0); vec3 wn_ = objectNormal;
          #ifdef USE_INSTANCING
            wp_ = instanceMatrix * wp_; wn_ = mat3(instanceMatrix) * wn_;
          #endif
          vWPos = (modelMatrix * wp_).xyz; vWNrm = normalize(mat3(modelMatrix) * wn_);`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform float uNight;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }")
        .replace("#include <color_fragment>", `#include <color_fragment>
          vec2 wuv_ = abs(vWNrm.x) > 0.5 ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
          vec2 cell_ = vec2(3.4, 3.8);
          vec2 f_ = fract(wuv_ / cell_);
          float side_ = step(abs(vWNrm.y), 0.5) * step(4.0, vWPos.y);
          float win_ = step(0.18, f_.x) * step(f_.x, 0.82) * step(0.22, f_.y) * step(f_.y, 0.78) * side_;
          float lit_ = step(0.5, h21(floor(wuv_ / cell_) + vWNrm.xz * 7.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.09, 0.14), win_ * 0.85);`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          totalEmissiveRadiance += win_ * lit_ * uNight * vec3(1.0, 0.78, 0.42) * 1.3;`);
    };
    return m;
  }, []);
  const ref = useInstances(L.buildings.length, (i, o, mesh) => {
    const b = L.buildings[i];
    o.position.set(b.x, b.h / 2, b.z); o.scale.set(b.w, b.h, b.d);
    mesh.setColorAt(i, new THREE.Color(b.color));
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, L.buildings.length]} material={mat} frustumCulled={false} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

/* ----------------------------------------------- lamps, trees, tunnel, etc */
function Props() {
  const L = getCityLayout();
  const lampMat = useRef<THREE.MeshStandardMaterial>(null!);
  const tunMat = useRef<THREE.MeshStandardMaterial>(null!);
  const poles = useInstances(L.lamps.length, (i, o) => { const l = L.lamps[i]; o.position.set(l.x, 4, l.z); o.scale.set(0.15, 4, 0.15); });
  const heads = useInstances(L.lamps.length, (i, o) => { const l = L.lamps[i]; o.position.set(l.x, 8.1, l.z); o.scale.set(0.9, 0.18, 0.5); });
  const trunks = useInstances(L.trees.length, (i, o) => { const t = L.trees[i]; o.position.set(t.x, 1.2 * t.s, t.z); o.scale.set(0.3 * t.s, 1.2 * t.s, 0.3 * t.s); });
  const crowns = useInstances(L.trees.length, (i, o) => { const t = L.trees[i]; o.position.set(t.x, 3.6 * t.s, t.z); o.scale.set(1.8 * t.s, 2.4 * t.s, 1.8 * t.s); });
  const tun = useInstances(L.tunnelLights.length, (i, o) => { const t = L.tunnelLights[i]; o.position.set(t.x, t.y, t.z); o.scale.set(1.2, 0.08, 6); });
  useFrame(() => {
    if (lampMat.current) lampMat.current.emissiveIntensity = 0.25 + nightU.value * 3.2;
    if (tunMat.current) tunMat.current.emissiveIntensity = 1.6;
  });
  return (
    <>
      <instancedMesh ref={poles} args={[undefined, undefined, L.lamps.length]} frustumCulled={false}><cylinderGeometry args={[1, 1, 2, 6]} /><meshStandardMaterial color="#4b5563" /></instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, L.lamps.length]} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial ref={lampMat} color="#fff7d6" emissive="#ffd98a" emissiveIntensity={0.3} /></instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, L.trees.length]} frustumCulled={false} castShadow><cylinderGeometry args={[1, 1, 2, 6]} /><meshStandardMaterial color="#5b3a1e" /></instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, L.trees.length]} frustumCulled={false} castShadow><coneGeometry args={[1, 2, 7]} /><meshStandardMaterial color="#1f6d33" roughness={1} /></instancedMesh>
      <instancedMesh ref={tun} args={[undefined, undefined, L.tunnelLights.length]} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial ref={tunMat} color="#ffffff" emissive="#cfe8ff" emissiveIntensity={1.6} /></instancedMesh>
      <Water />
      <GaragePads />
    </>
  );
}

function Water() {
  const w = getCityLayout().water;
  return (
    <mesh position={[w.cx, -2.4, w.cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w.w, w.d]} />
      <meshStandardMaterial color="#1c5d8f" transparent opacity={0.82} roughness={0.15} metalness={0.3} />
    </mesh>
  );
}

const KIND_COLOR: Record<string, string> = { REPAIR: "#f43f5e", ENGINE_SHOP: "#22d3ee", WORKSHOP: "#a78bfa", FUEL: "#facc15" };
function GaragePads() {
  const beams = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => { if (beams.current) beams.current.children.forEach((c, i) => ((c as THREE.Mesh).scale.x = (c as THREE.Mesh).scale.z = 1 + Math.sin(clock.elapsedTime * 2 + i) * 0.08)); });
  return (
    <group ref={beams}>
      {GARAGES.map((g) => (
        <mesh key={g.slug} position={[g.x, 18, g.z]}>
          <cylinderGeometry args={[2.2, 2.2, 36, 16, 1, true]} />
          <meshBasicMaterial color={KIND_COLOR[g.kind]} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {GARAGES.map((g) => (
        <mesh key={g.slug + "p"} position={[g.x, 0.07, g.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[7, 8.2, 40]} />
          <meshBasicMaterial color={KIND_COLOR[g.kind]} />
        </mesh>
      ))}
    </group>
  );
}

/* -------------------------------------------------------- checkpoint gates */
export function Gates() {
  const L = getCityLayout();
  const free = useGame((s) => s.circuit.next);
  // during a race the beam shows the gate the SERVER expects next; drift challenges have no gates
  const raceNext = useRace((s) => (s.phase === "countdown" || s.phase === "running" ? (s.info?.kind === "drift" ? -1 : s.nextGate) : null));
  const next = raceNext ?? free;
  const ref = useInstances(L.checkpoints.length * 3, (i, o) => {
    const cp = L.checkpoints[Math.floor(i / 3)], part = i % 3;
    const rx = Math.cos(cp.yaw), rz = -Math.sin(cp.yaw);
    o.rotation.set(0, cp.yaw, 0);
    if (part < 2) { const s = part === 0 ? -1 : 1; o.position.set(cp.x + rx * s * 9, 4, cp.z + rz * s * 9); o.scale.set(0.5, 4, 0.5); }
    else { o.position.set(cp.x, 8.3, cp.z); o.scale.set(9.5, 0.5, 0.5); }
  });
  const beam = useRef<THREE.Mesh>(null!);
  const cp = L.checkpoints[Math.max(0, next) % L.checkpoints.length];
  useFrame(({ clock }) => { if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(clock.elapsedTime * 4) * 0.06; });
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, L.checkpoints.length * 3]} frustumCulled={false}>
        <boxGeometry args={[2, 2, 2]} /><meshStandardMaterial color="#334155" emissive="#0e7490" emissiveIntensity={0.6} />
      </instancedMesh>
      <mesh ref={beam} visible={next >= 0} position={[cp.x, 5, cp.z]} rotation={[0, cp.yaw, 0]}>
        <boxGeometry args={[18, 10, 0.4]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  );
}

export default function City() {
  return (
    <>
      <Statics />
      <Roads />
      <Buildings />
      <Props />
      <Gates />
    </>
  );
}
