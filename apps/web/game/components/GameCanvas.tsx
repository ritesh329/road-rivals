"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { PerformanceMonitor } from "@react-three/drei";
import { buildPhysicsParams, type DamageHealth, type InstalledPart, type VehicleConfig } from "@road-rivals/shared";
import City, { StaticColliders } from "./City";
import Lighting from "./Lighting";
import Vehicle from "./Vehicle";
import Hud from "../hud/Hud";
import Minimap from "../hud/Minimap";
import Menu, { MenuButton } from "../hud/Menu";
import DeviceGate from "./DeviceGate";
import TouchControls from "../hud/TouchControls";
import { useKeyboard } from "../input";
import { useGame } from "../store";
import { useDamage } from "../garage/damageSync";
import { useGarageUi } from "../garage/garageStore";
import GarageOverlay from "../garage/GarageOverlay";
import RemoteCars from "../net/RemoteCars";
import NetHud from "../net/NetHud";
import { useMultiplayer } from "../net/useMultiplayer";
import { useNet } from "../net/netStore";
import RaceHud from "../race/RaceHud";
import { useRaceNet } from "../race/useRaceNet";
import NavHud from "../nav/NavHud";
import MapOverlay from "../nav/MapOverlay";
import Link from "next/link";
import type { ModelPart } from "./CarModel";

export interface ActiveCar {
  ownershipId: string; coins: number;
  category: string; baseStats: Record<string, number>; parts: InstalledPart[]; modelParts: ModelPart[];
  damage: DamageHealth; paint: string; config: VehicleConfig; name: string;
}

const Q = {
  low: { dpr: [0.7, 1] as [number, number], shadows: false, shadow: 512, aa: false },
  medium: { dpr: [1, 1.5] as [number, number], shadows: true, shadow: 1024, aa: true },
  high: { dpr: [1, 2] as [number, number], shadows: true, shadow: 2048, aa: true },
};

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

export default function GameCanvas({ car, roomCode = null }: { car: ActiveCar; roomCode?: string | null }) {
  const { quality, touch, minimap, hydrated, hydrate } = useGame();
  const [gl, setGl] = useState<boolean | null>(null);
  const [dprCap, setDprCap] = useState(1);
  useKeyboard();
  useMultiplayer(roomCode);
  useRaceNet(!!roomCode);
  const netReady = useNet((n) => n.ready);
  const netError = useNet((n) => n.error);
  useEffect(() => { hydrate(); setGl(hasWebGL()); }, [hydrate]);

  // Physics params are keyed on their CONTENT so a refetch of /api/me never rebuilds (and respawns) the car;
  // only a real change (part installed / swapped) does.
  const physicsKey = JSON.stringify([car.category, car.baseStats, car.parts]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => buildPhysicsParams(car.baseStats, car.parts, car.category), [physicsKey]);

  // live damage: hydrate once per car, sync to the server every few seconds and when the page closes
  useEffect(() => { useDamage.getState().hydrate(car.ownershipId, car.damage, params.durability); }, [car.ownershipId, car.damage, params.durability]);
  useEffect(() => { useGarageUi.getState().setCoins(car.coins); }, [car.coins]);
  useEffect(() => {
    const tick = setInterval(() => void useDamage.getState().flush(), 5000);
    const leave = () => void useDamage.getState().flush({ beacon: true });
    const vis = () => { if (document.visibilityState === "hidden") leave(); };
    window.addEventListener("pagehide", leave); document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(tick); window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", vis); void useDamage.getState().flush(); };
  }, []);

  if (gl === null || !hydrated) return <Loading text="Starting engine…" />;
  if (!gl) return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="card max-w-md">
        <h1 className="font-display text-2xl text-rival">WebGL not available</h1>
        <p className="mt-2 text-slate-400">ROAD RIVALS needs WebGL. Please use a recent Chrome, Edge or Firefox with hardware acceleration enabled.</p>
      </div>
    </div>
  );
  if (roomCode && netError) return (
    <main className="flex min-h-screen items-center justify-center p-6"><div className="card max-w-md text-center"><h1 className="font-display text-xl text-rival">Can't join the session</h1><p className="mt-2 text-slate-300">{netError}</p><Link href={`/room/${roomCode}`} className="btn btn-primary mt-4">Back to the room</Link></div></main>
  );
  const q = Q[quality];
  return (
    <DeviceGate>
      <div className="absolute inset-0 touch-none select-none overflow-hidden bg-black">
        <Canvas
          key={quality} shadows={q.shadows} dpr={[q.dpr[0], Math.min(q.dpr[1], q.dpr[1] * dprCap)]}
          gl={{ antialias: q.aa, powerPreference: "high-performance" }} camera={{ fov: 62, near: 0.3, far: 2200, position: [-45, 4, 0] }}
          style={{ position: "absolute", inset: 0 }}
        >
          <PerformanceMonitor onDecline={() => setDprCap((d) => Math.max(0.6, d - 0.2))} flipflops={3} />
          <Suspense fallback={null}>
            <Physics paused gravity={[0, -9.81, 0]}>
              <Lighting shadows={q.shadows} shadowSize={q.shadow} />
              <StaticColliders />
              <City />
              {roomCode && <RemoteCars />}
              {(!roomCode || netReady) && <Vehicle params={params} paint={car.paint} category={car.category} config={car.config} modelParts={car.modelParts} />}
            </Physics>
          </Suspense>
        </Canvas>
        {/* HUD lives inside the safe area (notch / rounded corners / gesture bar); the 3D view stays edge to edge behind it */}
        <div className="safe-inset z-10">
          <Hud />
          {roomCode && <NetHud />}
          {roomCode && netReady && <RaceHud roomCode={roomCode} />}
          <NavHud />
          {minimap && <Minimap />}
          <MenuButton />
          {touch && <TouchControls />}
        </div>
        <MapOverlay />
        {roomCode && !netReady && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 font-display text-slate-200">Joining session…</div>}
        <Menu />
        <GarageOverlay car={car} params={params} />
      </div>
    </DeviceGate>
  );
}

function Loading({ text }: { text: string }) {
  return <main className="flex min-h-screen items-center justify-center font-display text-slate-400">{text}</main>;
}
