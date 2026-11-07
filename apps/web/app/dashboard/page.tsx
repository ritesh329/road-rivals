"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me } from "@/services/api";
import SoloChallenges from "@/components/SoloChallenges";

const LIVE: Record<string, string> = { "Play Now": "/game", "My Garage": "/garage", "Create Room": "/rooms", "Join Room": "/rooms", "Quick Match": "/rooms", "World Map": "/map", "Missions": "/missions", "Car Showroom": "/showroom", "Leaderboard": "/leaderboard", "Profile": "/profile" };
const BLURB: Record<string, string> = { "Play Now": "Drive the open-world city", "My Garage": "Repair, upgrade & customize your car", "Create Room": "Host a room for up to 5 drivers", "Join Room": "Enter a room code or invite", "Quick Match": "Jump into an open public room", "World Map": "GPS, garages & events", "Missions": "Daily & weekly rewards", "Car Showroom": "Buy and unlock new cars", "Leaderboard": "Season, wins & level ranks", "Profile": "Stats, avatar & achievements" };
const MENU = ["Play Now","Create Room","Join Room","Quick Match","Car Showroom","My Garage","World Map","Missions","Leaderboard","Friends","Profile","Settings"];

export default function Dashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, error, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });

  useEffect(() => { if (error instanceof ApiError && error.status === 401) router.replace("/login"); }, [error, router]);
  if (isLoading || !me) return <main className="flex min-h-screen items-center justify-center text-slate-400">Loading…</main>;

  const pct = Math.min(100, Math.round((me.profile.xp / me.profile.xpToNext) * 100));
  const car = me.activeVehicle?.vehicle;
  async function logout() { await api("/auth/logout", { method: "POST" }); qc.clear(); router.push("/"); }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-black">ROAD <span className="text-rival">RIVALS</span></h1>
        <div className="flex items-center gap-4">
          <span className="font-display text-amber-300">🪙 {me.coins.toLocaleString()}</span>
          <button onClick={logout} className="btn btn-ghost !py-2">Logout</button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-sm text-slate-400">Driver</p>
          <p className="font-display text-xl">{me.username}</p>
          <p className="mt-1 text-neon">{me.profile.tier} · Level {me.profile.level}</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-neon" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-slate-400">{me.profile.xp} / {me.profile.xpToNext} XP</p>
        </div>
        <div className="card md:col-span-2">
          <p className="text-sm text-slate-400">Active vehicle</p>
          <p className="font-display text-xl">{car?.name ?? "None"} <span className="text-sm text-slate-400">{car?.category}</span></p>
          {car && <p className="mt-2 text-sm text-slate-400">{car.baseStats.engineHp} HP · {car.baseStats.massKg} kg · {car.baseStats.topSpeedKmh} km/h</p>}
          <p className="mt-3 text-xs text-slate-500">Hit Play Now to drive it, or visit My Garage to repair and upgrade it.</p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {MENU.map((m) => LIVE[m] ? (
          <Link key={m} href={LIVE[m]} className="card border-rival/60 text-left shadow-[0_0_24px_rgba(244,63,94,.25)] transition hover:brightness-125">
            <span className="font-display text-sm text-rival">{m}</span>
            <span className="mt-1 block text-xs text-slate-300">{BLURB[m]}</span>
          </Link>
        ) : (
          <button key={m} disabled className="card text-left opacity-60" title="Coming in a later phase">
            <span className="font-display text-sm">{m}</span>
            <span className="mt-1 block text-xs text-slate-500">Coming soon</span>
          </button>
        ))}
      </section>
      <SoloChallenges />
    </main>
  );
}
