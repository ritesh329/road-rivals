"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type GarageOverview } from "@/services/api";
import GaragePanel from "@/game/garage/GaragePanel";

const CarPreview = dynamic(() => import("@/game/garage/CarPreview"), {
  ssr: false, loading: () => <div className="flex h-full items-center justify-center text-slate-500">Loading 3D preview…</div>,
});

export default function GaragePage() {
  const router = useRouter();
  const [gl, setGl] = useState<boolean | null>(null);
  const { data, error } = useQuery({ queryKey: ["garage"], queryFn: () => api<GarageOverview>("/garage/overview") });
  useEffect(() => { if (error instanceof ApiError && error.status === 401) router.replace("/login"); }, [error, router]);
  useEffect(() => {
    try { const c = document.createElement("canvas"); setGl(!!(c.getContext("webgl2") || c.getContext("webgl"))); } catch { setGl(false); }
  }, []);
  const car = data?.vehicles.find((v) => v.active) ?? data?.vehicles[0];

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-black">MY <span className="text-rival">GARAGE</span></h1>
        <div className="flex gap-2">
          <Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link>
          <Link href="/game" className="btn btn-primary !py-2">Drive ▶</Link>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,46rem)]">
        <div className="card h-[42vh] overflow-hidden !p-0 lg:h-[78vh]">
          {car && gl ? <CarPreview car={car} /> : <div className="flex h-full items-center justify-center p-6 text-center text-slate-500">{gl === false ? "WebGL is not available – the garage works, but the 3D preview can't render." : "Loading…"}</div>}
        </div>
        <GaragePanel mode="home" />
      </div>
    </main>
  );
}
