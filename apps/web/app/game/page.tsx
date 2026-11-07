"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Me } from "@/services/api";
import { DEFAULT_CONFIG, normalizeConfig } from "@road-rivals/shared";
import type { ActiveCar } from "@/game/components/GameCanvas";

const GameCanvas = dynamic(() => import("@/game/components/GameCanvas"), {
  ssr: false,
  loading: () => <main className="flex min-h-screen items-center justify-center font-display text-slate-400">Loading 3D engine…</main>,
});

export default function GamePage() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState<string | null | undefined>(undefined); // undefined = not read yet
  useEffect(() => { setRoomCode(new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? null); }, []);
  const { data: me, error, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  useEffect(() => { if (error instanceof ApiError && error.status === 401) router.replace("/login"); }, [error, router]);

  const car = useMemo<ActiveCar | null>(() => {
    const a = me?.activeVehicle;
    if (!a) return null;
    const damage: Record<string, number> = {};
    for (const d of a.damage ?? []) damage[d.component] = d.health;
    const config = normalizeConfig(a.configuration ?? DEFAULT_CONFIG);
    return {
      ownershipId: a.id, coins: me!.coins,
      name: a.vehicle.name, category: a.vehicle.category, baseStats: a.vehicle.baseStats,
      parts: (a.upgrades ?? []).map((u) => ({ type: u.slot, physicsModifiers: u.part.physicsModifiers })),
      modelParts: (a.upgrades ?? []).map((u) => ({ type: u.slot, tier: u.part.tier })),
      damage, paint: config.paint, config,
    };
  }, [me]);

  if (isLoading || roomCode === undefined) return <main className="flex min-h-screen items-center justify-center text-slate-400">Loading…</main>;
  if (!car) return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md text-center"><p>No active vehicle found.</p><Link href="/dashboard" className="btn btn-primary mt-4">Back to dashboard</Link></div>
    </main>
  );
  return <GameCanvas car={car} roomCode={roomCode} />;
}
