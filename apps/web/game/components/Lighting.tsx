"use client";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useGame, view } from "../store";
import { nightU } from "./City";

const DAY_TOP = new THREE.Color("#3b82d6"), DAY_BOT = new THREE.Color("#bcd8f2");
const NIGHT_TOP = new THREE.Color("#050816"), NIGHT_BOT = new THREE.Color("#1b2142");
const SUN_DAY = new THREE.Color("#fff1d6"), SUN_NIGHT = new THREE.Color("#7f93ff");

export default function Lighting({ shadowSize, shadows }: { shadowSize: number; shadows: boolean }) {
  const dir = useRef<THREE.DirectionalLight>(null!);
  const amb = useRef<THREE.HemisphereLight>(null!);
  const sky = useRef<THREE.ShaderMaterial>(null!);
  const stars = useRef<THREE.Group>(null!);
  const { scene } = useThree();
  const night = useGame((s) => s.night);
  const fog = useMemo(() => new THREE.Fog("#bcd8f2", 120, 900), []);
  const uniforms = useMemo(() => ({ top: { value: new THREE.Color() }, bot: { value: new THREE.Color() } }), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    const target = night ? 1 : 0;
    nightU.value += (target - nightU.value) * Math.min(1, dt * 2);
    const t = nightU.value;
    uniforms.top.value.copy(DAY_TOP).lerp(NIGHT_TOP, t);
    uniforms.bot.value.copy(DAY_BOT).lerp(NIGHT_BOT, t);
    fog.color.copy(uniforms.bot.value); fog.near = 140 - t * 60; fog.far = 950 - t * 450;
    scene.fog = fog;
    if (dir.current) {
      dir.current.intensity = 3.2 - t * 2.7;
      dir.current.color.copy(SUN_DAY).lerp(SUN_NIGHT, t);
      dir.current.position.set(view.x + 80, 120, view.z + 50);
      dir.current.target.position.set(view.x, 0, view.z);
      dir.current.target.updateMatrixWorld();
    }
    if (amb.current) { amb.current.intensity = 2.0 - t * 1.5; }
    if (stars.current) stars.current.visible = t > 0.5;
    tmp.set(0);
    if (sky.current) sky.current.uniformsNeedUpdate = true;
  });

  return (
    <>
      <hemisphereLight ref={amb} args={["#cfe3ff", "#3a3f4a", 0.9]} />
      <directionalLight
        ref={dir} castShadow={shadows}
        shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.0004} shadow-normalBias={0.05}
        shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={70} shadow-camera-bottom={-70} shadow-camera-near={10} shadow-camera-far={320}
      />
      <mesh scale={[1, 1, 1]} renderOrder={-10}>
        <sphereGeometry args={[1500, 24, 16]} />
        <shaderMaterial ref={sky} side={THREE.BackSide} depthWrite={false} fog={false} uniforms={uniforms}
          vertexShader={`varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
          fragmentShader={`uniform vec3 top; uniform vec3 bot; varying float vY; void main(){ gl_FragColor = vec4(mix(bot, top, smoothstep(-0.05, 0.6, vY)), 1.0); }`} />
      </mesh>
      <group ref={stars} visible={false}><Stars radius={1200} depth={50} count={1800} factor={6} fade speed={0} /></group>
    </>
  );
}
