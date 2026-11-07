"use client";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { DEFAULT_CONFIG, buildPhysicsParams, normalizeConfig } from "@road-rivals/shared";
import CarModel, { type CarModelHandle } from "../components/CarModel";

const PAINTS = ["#e11d48", "#22d3ee", "#facc15", "#a78bfa", "#4ade80", "#fb923c", "#f8fafc", "#3b82f6"];
export const paintFor = (slug: string) => PAINTS[[...slug].reduce((a, c) => a + c.charCodeAt(0), 0) % PAINTS.length];

function Turntable({ category, baseStats, slug }: { category: string; baseStats: Record<string, number>; slug: string }) {
  const handle = useRef<CarModelHandle>(null!);
  const spin = useRef<THREE.Group>(null!);
  const params = useMemo(() => buildPhysicsParams(baseStats, [], category), [baseStats, category]);
  const config = useMemo(() => normalizeConfig({ ...DEFAULT_CONFIG, paint: paintFor(slug) }), [slug]);
  const y = 0.05 + params.suspension.restLength + params.wheelRadius;
  useEffect(() => { handle.current?.wheels.forEach((w) => { if (w) w.position.y = -0.05 - params.suspension.restLength; }); }, [params]);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.5; });
  return <group ref={spin} position={[0, y, 0]}><CarModel ref={handle} params={params} paint={config.paint} category={category} config={config} /></group>;
}

/** Showroom stage: the selected car on a turntable (drag to rotate, scroll to zoom). */
export default function ShowroomPreview(props: { category: string; baseStats: Record<string, number>; slug: string }) {
  return (
    <Canvas shadows camera={{ position: [5.8, 2.2, 6.2], fov: 38 }} gl={{ antialias: true }} data-testid="showroom-preview">
      <color attach="background" args={["#080a12"]} />
      <hemisphereLight args={["#c7d2ff", "#2a2040", 1.0]} />
      <directionalLight position={[-5, 4, 6]} intensity={1.2} />
      <directionalLight position={[6, 9, 5]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-6, 3, -4]} intensity={30} color="#f43f5e" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[9, 48]} /><meshStandardMaterial color="#2a3142" roughness={0.6} metalness={0.3} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}><ringGeometry args={[4.2, 4.32, 64]} /><meshBasicMaterial color="#f43f5e" /></mesh>
      <Turntable {...props} />
      <OrbitControls enablePan={false} minDistance={5} maxDistance={14} maxPolarAngle={Math.PI / 2.05} target={[0, 0.7, 0]} />
    </Canvas>
  );
}
