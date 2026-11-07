"use client";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { buildPhysicsParams, type VehicleConfig } from "@road-rivals/shared";
import CarModel, { type CarModelHandle } from "../components/CarModel";
import type { GarageVehicle } from "@/services/api";
import { useGarageUi } from "./garageStore";

function Turntable({ car }: { car: GarageVehicle }) {
  const preview = useGarageUi((s) => s.preview);
  const handle = useRef<CarModelHandle>(null!);
  const spin = useRef<THREE.Group>(null!);
  const params = useMemo(() => buildPhysicsParams(car.baseStats, car.upgrades.map((u) => ({ type: u.slot, physicsModifiers: u.physicsModifiers })), car.category), [car]);
  const config = useMemo(() => ({ ...car.config, ...(preview ?? {}) }) as VehicleConfig, [car.config, preview]);
  const modelParts = useMemo(() => car.upgrades.map((u) => ({ type: u.slot, tier: u.tier })), [car]);
  const y = 0.05 + params.suspension.restLength + params.wheelRadius;
  useEffect(() => { handle.current?.wheels.forEach((w) => { if (w) w.position.y = -0.05 - params.suspension.restLength; }); }, [params, car]);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.35; });
  return (
    <group ref={spin} position={[0, y, 0]}>
      <CarModel ref={handle} params={params} paint={config.paint} category={car.category} config={config} parts={modelParts} damage={car.damage} />
    </group>
  );
}

/** Showroom-style turntable used on the /garage page. Reflects unsaved Customize choices live. */
export default function CarPreview({ car }: { car: GarageVehicle }) {
  return (
    <Canvas shadows camera={{ position: [5.5, 2.4, 6.5], fov: 38 }} gl={{ antialias: true }} data-testid="car-preview">
      <color attach="background" args={["#0a0c14"]} />
      <hemisphereLight args={["#c7d2ff", "#2a2040", 1.1]} />
      <directionalLight position={[-5, 4, 6]} intensity={1.2} />
      <directionalLight position={[6, 9, 5]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-6, 3, -4]} intensity={30} color="#22d3ee" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[9, 48]} /><meshStandardMaterial color="#3a4256" roughness={0.8} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}><ringGeometry args={[4.2, 4.3, 64]} /><meshBasicMaterial color="#22d3ee" /></mesh>
      <Turntable car={car} />
      <OrbitControls enablePan={false} minDistance={5} maxDistance={14} maxPolarAngle={Math.PI / 2.05} target={[0, 0.7, 0]} />
    </Canvas>
  );
}
