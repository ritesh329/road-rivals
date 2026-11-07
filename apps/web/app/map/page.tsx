"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Me } from "@/services/api";
import MapView from "@/game/nav/MapView";
import { useNav } from "@/game/nav/navStore";

export default function MapPage() {
  const router = useRouter();
  const { data: me, error } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const waypoint = useNav((s) => s.waypoint);
  useEffect(() => { useNav.getState().hydrate(); }, []);
  useEffect(() => { if (error instanceof ApiError && error.status === 401) router.replace("/login?next=/map"); }, [error, router]);
  if (!me) return <main className="flex min-h-screen items-center justify-center text-slate-400">Loading…</main>;
  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <h1 className="font-display text-xl font-black">WORLD <span className="text-neon">MAP</span></h1>
        <div className="flex items-center gap-2">
          {waypoint && <Link href="/game" className="btn btn-primary !py-1.5 text-sm" data-testid="drive-there">Drive there ▶</Link>}
          <Link href="/dashboard" className="btn btn-ghost !py-1.5 text-sm">← Dashboard</Link>
        </div>
      </header>
      <div className="min-h-0 flex-1"><MapView /></div>
    </main>
  );
}
