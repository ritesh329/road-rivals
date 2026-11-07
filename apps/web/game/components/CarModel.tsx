"use client";
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { neonColor, rimColor, type VehicleConfig, type VehiclePhysicsParams } from "@road-rivals/shared";

export interface CarModelHandle {
  group: THREE.Group;
  wheels: THREE.Group[];       // FL FR RL RR (pivot groups: y = suspension, rotation.y = steer)
  wheelSpin: THREE.Object3D[]; // inner meshes spun about X
  brakeLights: THREE.MeshStandardMaterial;
  nitroFlame: THREE.Mesh;
  body: THREE.Group;
}

interface StyleDims { len: number; wid: number; hgt: number; cabLen: number; cabH: number; cabZ: number; hood: number }
const STYLE: Record<string, StyleDims> = {
  HATCHBACK: { len: 3.9, wid: 1.72, hgt: 0.62, cabLen: 2.1, cabH: 0.55, cabZ: -0.25, hood: 0.8 },
  SEDAN: { len: 4.5, wid: 1.8, hgt: 0.62, cabLen: 2.2, cabH: 0.52, cabZ: -0.2, hood: 1.0 },
  SPORTS: { len: 4.3, wid: 1.82, hgt: 0.5, cabLen: 1.8, cabH: 0.46, cabZ: -0.15, hood: 1.1 },
  MUSCLE: { len: 4.7, wid: 1.9, hgt: 0.62, cabLen: 2.0, cabH: 0.5, cabZ: -0.45, hood: 1.3 },
  SUPERCAR: { len: 4.5, wid: 1.98, hgt: 0.42, cabLen: 1.6, cabH: 0.42, cabZ: -0.1, hood: 1.2 },
  RACING_GT: { len: 4.6, wid: 2.0, hgt: 0.46, cabLen: 1.7, cabH: 0.43, cabZ: -0.05, hood: 1.2 },
  HYPERCAR: { len: 4.7, wid: 2.02, hgt: 0.4, cabLen: 1.5, cabH: 0.4, cabZ: -0.05, hood: 1.25 },
  OFFROAD: { len: 4.4, wid: 1.9, hgt: 0.8, cabLen: 2.3, cabH: 0.6, cabZ: -0.2, hood: 0.9 },
};
const SPORTY = new Set(["SPORTS", "SUPERCAR", "MUSCLE", "RACING_GT", "HYPERCAR"]);

export interface ModelPart { type: string; tier: number }
export type HealthLike = Partial<Record<string, number>>;

interface Props {
  params: VehiclePhysicsParams; paint: string; category: string;
  /** legacy: false hides the default sporty wing */
  spoiler?: boolean;
  config?: Partial<VehicleConfig>;
  parts?: ModelPart[];
  damage?: HealthLike;
}

const CarModel = forwardRef<CarModelHandle, Props>(function CarModel(
  { params, paint, category, spoiler, config, parts = [], damage = {} }, fwd,
) {
  const d = STYLE[category] ?? STYLE.SPORTS;
  const root = useRef<THREE.Group>(null!);
  const bodyG = useRef<THREE.Group>(null!);
  const wheelG = useRef<(THREE.Group | null)[]>([]);
  const spinG = useRef<(THREE.Object3D | null)[]>([]);
  const nitro = useRef<THREE.Mesh>(null!);
  const smoke = useRef<THREE.Mesh[]>([]);

  const col = config?.paint ?? paint;
  const wheelStyle = config?.wheels ?? "stock";
  const rims = rimColor(config?.rims ?? "stock");
  const partTier = (t: string) => parts.find((p) => p.type === t)?.tier ?? 0;
  const hp = (k: string) => Math.min(100, Math.max(0, damage[k] ?? 100));
  const brakeTier = partTier("BRAKES");

  const tail = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7f1d1d", emissive: "#ff1a1a", emissiveIntensity: 0.4 }), []);
  const paintMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }), [col]);
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0b1220", metalness: 0.9, roughness: 0.08 }), []);
  const rubber = useMemo(() => new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.9 }), []);
  const carbon = useMemo(() => new THREE.MeshStandardMaterial({ color: "#16161a", metalness: 0.4, roughness: 0.5 }), []);
  const rim = useMemo(() => new THREE.MeshStandardMaterial({ color: rims, metalness: 0.9, roughness: 0.25 }), [rims]);
  const decalMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.4 }), []);
  const flameMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#fb923c", emissive: "#ea580c", emissiveIntensity: 0.4 }), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9ca3af", metalness: 0.95, roughness: 0.25 }), []);
  const caliper = useMemo(() => new THREE.MeshStandardMaterial({ color: brakeTier >= 2 ? "#facc15" : "#dc2626", roughness: 0.4 }), [brakeTier]);
  const checker = useMemo(() => {
    if (typeof document === "undefined") return decalMat;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d")!;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? "#0b0b0b" : "#f5f5f5"; g.fillRect(x * 8, y * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 });
  }, [decalMat]);
  const smokeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#6b7280", transparent: true, opacity: 0.5, depthWrite: false }), []);
  const steamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#e5e7eb", transparent: true, opacity: 0.5, depthWrite: false }), []);

  useImperativeHandle(fwd, () => ({
    group: root.current, body: bodyG.current,
    wheels: wheelG.current as THREE.Group[], wheelSpin: spinG.current as THREE.Object3D[],
    brakeLights: tail, nitroFlame: nitro.current,
  }), [tail]);

  // engine / radiator smoke puffs (only animate while damaged)
  const engineBad = hp("ENGINE") < 50, radBad = hp("RADIATOR") < 50;
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const worst = Math.min(hp("ENGINE"), hp("RADIATOR"));
    smoke.current.forEach((m, i) => {
      if (!m) return;
      m.visible = engineBad || radBad;
      if (!m.visible) return;
      const ph = (t * (0.6 + (1 - worst / 100) * 0.8) + i / 6) % 1;
      m.position.set(((i % 3) - 1) * 0.12, d.hgt / 2 + 0.1 + ph * 1.3, d.len / 2 - 0.55 - ph * 0.3);
      m.scale.setScalar(0.18 + ph * 0.55);
      m.material = radBad && !engineBad ? steamMat : smokeMat;
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - ph);
    });
  });

  const hw = params.trackWidth / 2, hb = params.wheelbase / 2, r = params.wheelRadius;
  const wheelPos: [number, number][] = [[-hw, hb], [hw, hb], [-hw, -hb], [hw, -hb]];
  const bodyY = -0.05; // chassis visual centre relative to COM

  // spoiler: cosmetic style, else the physical SPOILER part, else the legacy sporty default
  const spoilerTier = partTier("SPOILER");
  const spoilerStyle = config?.spoiler && config.spoiler !== "none" ? config.spoiler
    : spoilerTier === 1 ? "lip" : spoilerTier === 2 ? "wing" : spoilerTier >= 3 ? "gt"
    : spoiler !== false && SPORTY.has(category) ? "wing" : "none";
  const sy = d.hgt / 2, rz = -d.len / 2 + 0.2;

  const bk = config?.bodyKit ?? "none";
  const bumper = config?.bumpers ?? "stock";
  const decal = config?.decal ?? "none";
  const neon = neonColor(config?.neon ?? null);
  const exhaust = config?.exhaust ?? "stock";

  const fbH = hp("FRONT_BUMPER") / 100, rbH = hp("REAR_BUMPER") / 100, doorH = hp("DOORS") / 100;
  const dent = (h: number) => new THREE.Color(col).lerp(new THREE.Color("#1f1f1f"), (1 - h) * 0.7);

  return (
    <group ref={root}>
      <group ref={bodyG} position={[0, bodyY, 0]}>
        <mesh castShadow material={paintMat} position={[0, 0.0, 0]}><boxGeometry args={[d.wid, d.hgt, d.len - 0.5]} /></mesh>
        {/* bumpers are separate pieces so damage is visible (hang, crumple, fall off) */}
        {fbH > 0.12 && (
          <group position={[0, -0.04, d.len / 2 - 0.25]} rotation={[(1 - fbH) * 0.55, 0, (1 - fbH) * 0.12]} scale={[1, 1, 0.55 + 0.45 * fbH]}>
            <mesh castShadow><boxGeometry args={[d.wid, d.hgt * 0.8, 0.5]} /><meshStandardMaterial color={dent(fbH)} metalness={0.5} roughness={0.5} /></mesh>
          </group>
        )}
        {rbH > 0.12 && (
          <group position={[0, -0.04, -d.len / 2 + 0.25]} rotation={[-(1 - rbH) * 0.5, 0, -(1 - rbH) * 0.1]} scale={[1, 1, 0.55 + 0.45 * rbH]}>
            <mesh castShadow><boxGeometry args={[d.wid, d.hgt * 0.8, 0.5]} /><meshStandardMaterial color={dent(rbH)} metalness={0.5} roughness={0.5} /></mesh>
          </group>
        )}
        {doorH > 0.2 && [-1, 1].map((s) => (
          <mesh key={"door" + s} position={[s * (d.wid / 2 + 0.005), 0.02, d.cabZ]} rotation={[0, 0, s * (1 - doorH) * 0.18]}>
            <boxGeometry args={[0.03, d.hgt * 0.7, d.cabLen * 0.55]} /><meshStandardMaterial color={dent(doorH)} metalness={0.5} roughness={0.55} />
          </mesh>
        ))}
        {/* hood slope & cabin */}
        <mesh castShadow material={paintMat} position={[0, d.hgt / 2 + d.cabH / 2 - 0.02, d.cabZ]}><boxGeometry args={[d.wid * 0.9, d.cabH, d.cabLen]} /></mesh>
        <mesh material={glass} position={[0, d.hgt / 2 + d.cabH / 2 + 0.0, d.cabZ + 0.02]}><boxGeometry args={[d.wid * 0.92, d.cabH * 0.62, d.cabLen * 0.96]} /></mesh>
        {/* lights */}
        {[-1, 1].map((s) => (
          <mesh key={"h" + s} position={[s * d.wid * 0.34, 0.05, d.len / 2 + 0.01]}>
            <boxGeometry args={[0.38, 0.14, 0.05]} /><meshStandardMaterial color="#fff" emissive="#fff7d6" emissiveIntensity={2} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={"t" + s} material={tail} position={[s * d.wid * 0.34, 0.08, -d.len / 2 - 0.01]}><boxGeometry args={[0.42, 0.12, 0.05]} /></mesh>
        ))}

        {/* spoiler styles */}
        {spoilerStyle === "lip" && <mesh material={paintMat} position={[0, sy + 0.04, rz]}><boxGeometry args={[d.wid * 0.85, 0.04, 0.2]} /></mesh>}
        {spoilerStyle === "ducktail" && <mesh material={paintMat} position={[0, sy + 0.08, rz]} rotation={[-0.35, 0, 0]}><boxGeometry args={[d.wid * 0.9, 0.05, 0.3]} /></mesh>}
        {(spoilerStyle === "wing" || spoilerStyle === "gt") && (
          <group position={[0, sy + (spoilerStyle === "gt" ? 0.5 : 0.38), rz]}>
            <mesh material={paintMat} position={[0, 0.1, 0]} rotation={[spoilerStyle === "gt" ? 0.12 : 0, 0, 0]}><boxGeometry args={[d.wid * (spoilerStyle === "gt" ? 1.0 : 0.9), 0.05, spoilerStyle === "gt" ? 0.5 : 0.4]} /></mesh>
            {[-1, 1].map((s) => <mesh key={s} material={rubber} position={[s * d.wid * 0.35, -0.12 - (spoilerStyle === "gt" ? 0.08 : 0), 0]}><boxGeometry args={[0.06, spoilerStyle === "gt" ? 0.46 : 0.3, 0.12]} /></mesh>)}
            {spoilerStyle === "gt" && [-1, 1].map((s) => <mesh key={"p" + s} material={carbon} position={[s * d.wid * 0.5, 0.1, 0]}><boxGeometry args={[0.04, 0.2, 0.52]} /></mesh>)}
          </group>
        )}

        {/* body kits */}
        {bk !== "none" && [-1, 1].map((s) => (
          <mesh key={"sk" + s} material={carbon} position={[s * (d.wid / 2 + 0.03), -d.hgt / 2 + 0.06, d.cabZ]}><boxGeometry args={[0.08, 0.1, d.len * 0.55]} /></mesh>
        ))}
        {(bk === "wide" || bk === "race") && wheelPos.map(([x, z], i) => (
          <mesh key={"fl" + i} material={paintMat} position={[x + Math.sign(x) * 0.08, 0.12, z]}><boxGeometry args={[0.3, 0.12, r * 2.7]} /></mesh>
        ))}
        {bk === "race" && <mesh material={carbon} position={[0, -d.hgt / 2 + 0.03, d.len / 2 - 0.1]}><boxGeometry args={[d.wid * 1.02, 0.05, 0.5]} /></mesh>}
        {/* bumpers (splitter / canards) */}
        {bumper !== "stock" && <mesh material={carbon} position={[0, -d.hgt / 2 + 0.03, d.len / 2 + 0.05]}><boxGeometry args={[d.wid * 0.98, 0.04, 0.35]} /></mesh>}
        {bumper === "race" && [-1, 1].map((s) => <mesh key={"cn" + s} material={carbon} position={[s * d.wid * 0.46, -0.02, d.len / 2 - 0.1]} rotation={[0, 0, s * 0.5]}><boxGeometry args={[0.2, 0.03, 0.3]} /></mesh>)}

        {/* decals */}
        {(decal === "stripes" || decal === "double") && (decal === "stripes" ? [0] : [-0.14, 0.14]).map((x) => (
          <group key={"st" + x}>
            <mesh material={decalMat} position={[x, d.hgt / 2 + 0.006, d.len / 2 - 0.9]}><boxGeometry args={[0.18, 0.006, 1.6]} /></mesh>
            <mesh material={decalMat} position={[x, d.hgt / 2 + d.cabH + 0.0, d.cabZ]}><boxGeometry args={[0.18, 0.006, d.cabLen * 0.95]} /></mesh>
            <mesh material={decalMat} position={[x, d.hgt / 2 + 0.006, -d.len / 2 + 0.55]}><boxGeometry args={[0.18, 0.006, 0.9]} /></mesh>
          </group>
        ))}
        {decal === "flames" && [-1, 1].map((s) => [0, 1, 2].map((k) => (
          <mesh key={`fl${s}${k}`} material={flameMat} position={[s * (d.wid / 2 + 0.012), -0.02 + (k === 1 ? 0.05 : 0), d.len / 2 - 0.8 - k * 0.55]}>
            <boxGeometry args={[0.01, 0.16 - k * 0.03, 0.55]} />
          </mesh>
        )))}
        {decal === "checker" && <mesh material={checker} position={[0, d.hgt / 2 + d.cabH + 0.006, d.cabZ]}><boxGeometry args={[d.wid * 0.7, 0.004, d.cabLen * 0.8]} /></mesh>}

        {/* exhaust */}
        {(exhaust === "sport" || exhaust === "dual") && (exhaust === "sport" ? [0.35] : [-0.35, 0.35]).map((x) => (
          <mesh key={"ex" + x} material={metal} position={[x * d.wid * 0.6, -d.hgt / 2 + 0.08, -d.len / 2 - 0.04]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.07, 0.07, 0.2, 14]} /></mesh>
        ))}
        {exhaust === "side" && [-1, 1].map((s) => <mesh key={"sx" + s} material={metal} position={[s * (d.wid / 2 + 0.02), -d.hgt / 2 + 0.07, -d.len * 0.12]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.05, 0.9, 12]} /></mesh>)}

        {/* visible installed parts */}
        {partTier("ENGINE") >= 4 && <mesh material={carbon} position={[0, d.hgt / 2 + 0.05, d.len / 2 - 0.95]}><boxGeometry args={[0.45, 0.1, 0.55]} /></mesh>}
        {partTier("COOLING") >= 1 && [-1, 1].map((s) => <mesh key={"v" + s} material={carbon} position={[s * 0.3, d.hgt / 2 + 0.01, d.len / 2 - 0.8]}><boxGeometry args={[0.22, 0.01, 0.5]} /></mesh>)}
        {partTier("AERO") >= 1 && <mesh material={carbon} position={[0, -d.hgt / 2 + 0.02, -d.len / 2 + 0.15]} rotation={[0.2, 0, 0]}><boxGeometry args={[d.wid * 0.8, 0.03, 0.5]} /></mesh>}
        {partTier("ARMOR") >= 1 && (
          <group>
            <mesh material={carbon} position={[0, -0.08, d.len / 2 + 0.12]}><boxGeometry args={[d.wid * 0.95, 0.09 + partTier("ARMOR") * 0.03, 0.1]} /></mesh>
            <mesh material={carbon} position={[0, -0.08, -d.len / 2 - 0.12]}><boxGeometry args={[d.wid * 0.95, 0.09 + partTier("ARMOR") * 0.03, 0.1]} /></mesh>
            {partTier("ARMOR") >= 2 && [-1, 1].map((s) => <mesh key={"cg" + s} material={carbon} position={[s * (d.wid * 0.45), d.hgt / 2 + d.cabH + 0.02, d.cabZ]}><boxGeometry args={[0.05, 0.05, d.cabLen]} /></mesh>)}
          </group>
        )}
        {partTier("NITRO") >= 1 && <mesh material={metal} position={[0.5, 0.1, -d.len / 2 + 0.7]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.07, 0.07, 0.55, 12]} /></mesh>}

        {/* nitro flame */}
        <mesh ref={nitro} position={[0, -0.1, -d.len / 2 - 0.5]} rotation={[Math.PI / 2, 0, 0]} visible={false}>
          <coneGeometry args={[0.28, 1.2, 10]} /><meshBasicMaterial color="#38bdf8" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>

        {/* damage smoke / steam */}
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={"sm" + i} ref={(m) => { if (m) smoke.current[i] = m; }} visible={false} material={smokeMat}><sphereGeometry args={[1, 8, 8]} /></mesh>
        ))}
        {/* underglow */}
        {neon && (
          <group>
            <mesh position={[0, -d.hgt / 2 - 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[d.wid * 1.05, d.len * 0.95]} /><meshBasicMaterial color={neon} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <pointLight color={neon} intensity={6} distance={6} position={[0, -d.hgt / 2 - 0.3, 0]} />
          </group>
        )}
      </group>

      {wheelPos.map(([x, z], i) => (
        <group key={i} ref={(g) => { wheelG.current[i] = g; }} position={[x, -0.05, z]}>
          <group ref={(g) => { spinG.current[i] = g; }} rotation={[0, 0, 0]}>
            <mesh castShadow material={rubber} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r, r, 0.26 + partTier("TYRES") * 0.015, 20]} /></mesh>
            <WheelFace style={wheelStyle} r={r} side={x < 0 ? -1 : 1} rim={rim} metal={metal} />
            {brakeTier >= 1 && <mesh material={caliper} position={[x < 0 ? -0.05 : 0.05, r * 0.45, 0]}><boxGeometry args={[0.1, r * 0.4, r * 0.5]} /></mesh>}
          </group>
        </group>
      ))}
    </group>
  );
});

/** Rim designs. Axis of rotation is local X; the visible face points away from the car. */
function WheelFace({ style, r, side, rim, metal }: { style: string; r: number; side: number; rim: THREE.Material; metal: THREE.Material }) {
  const x = side * 0.15; // just outside the tyre's outer face (tyre half-width ≤ 0.14)
  if (style === "aerodisc")
    return <mesh material={rim} rotation={[0, 0, Math.PI / 2]} position={[side * 0.15, 0, 0]}><cylinderGeometry args={[r * 0.88, r * 0.88, 0.03, 24]} /></mesh>;
  const n = style === "mesh" ? 12 : style === "sport5" ? 5 : style === "turbofan" ? 8 : 0;
  if (n === 0)
    return <mesh material={rim} rotation={[0, 0, Math.PI / 2]} position={[x, 0, 0]}><cylinderGeometry args={[r * 0.62, r * 0.62, 0.08, 10]} /></mesh>;
  const w = style === "mesh" ? 0.025 : style === "sport5" ? 0.09 : 0.07;
  return (
    <group position={[x, 0, 0]}>
      <mesh material={rim} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r * 0.68, r * 0.68, 0.04, 24]} /></mesh>
      <mesh material={metal} rotation={[0, 0, Math.PI / 2]} position={[side * 0.025, 0, 0]}><cylinderGeometry args={[r * 0.14, r * 0.14, 0.06, 12]} /></mesh>
      {Array.from({ length: n }, (_, k) => (
        <mesh key={k} material={rim} rotation={[(k / n) * Math.PI, 0, 0]}>
          <boxGeometry args={[style === "turbofan" ? 0.02 : 0.05, r * 1.25, w]} />
        </mesh>
      ))}
    </group>
  );
}

export default CarModel;
