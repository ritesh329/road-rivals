"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, post, type MissionRow, type MissionsView, type Me } from "@/services/api";

function countdown(iso: string) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function Card({ m, onClaim, busy }: { m: MissionRow; onClaim: () => void; busy: boolean }) {
  const pct = Math.round((m.progress / m.target) * 100);
  const fmt = (n: number) => (m.code.includes("dist") ? `${(n / 1000).toFixed(n >= m.target ? 0 : 1)} km` : n.toLocaleString());
  return (
    <div className={`card space-y-2 ${m.claimed ? "opacity-60" : m.completed ? "border-emerald-400/60" : ""}`} data-testid={`mission-${m.code}`}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="font-display">{m.title}</p><p className="text-xs text-slate-400">{m.description}</p></div>
        <span className="shrink-0 text-right text-xs text-amber-300">🪙 {m.rewardCoins.toLocaleString()}<br /><span className="text-slate-300">{m.rewardXp} XP</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full ${m.completed ? "bg-emerald-400" : "bg-neon"}`} style={{ width: `${pct}%` }} /></div>
      <div className="flex items-center justify-between text-xs">
        <span className="tabular-nums text-slate-300">{fmt(m.progress)} / {fmt(m.target)}</span>
        {m.claimed ? <span className="text-slate-400">Claimed ✓</span> : <button data-testid={`claim-${m.code}`} disabled={!m.completed || busy} onClick={onClaim} className="btn btn-primary !px-3 !py-1 text-xs disabled:opacity-40">{m.completed ? "Claim" : "In progress"}</button>}
      </div>
    </div>
  );
}

export default function MissionsPage() {
  const router = useRouter(); const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const q = useQuery({ queryKey: ["missions"], queryFn: () => api<MissionsView>("/missions"), enabled: !!me.data, refetchInterval: 15000 });
  const claim = useMutation({
    mutationFn: (code: string) => post<{ coinsAwarded: number; xpAwarded: number }>(`/missions/${code}/claim`, {}),
    onSuccess: (r) => { setMsg(`+${r.coinsAwarded.toLocaleString()} coins, +${r.xpAwarded} XP`); void qc.invalidateQueries({ queryKey: ["missions"] }); void qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "Network error"),
  });
  useEffect(() => { if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login?next=/missions"); }, [me.error, router]);
  const d = q.data;
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-black">MIS<span className="text-rival">SIONS</span></h1>
        <div className="flex items-center gap-3"><span className="font-display text-amber-300">🪙 {me.data?.coins.toLocaleString() ?? "…"}</span><Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link></div>
      </header>
      {msg && <div data-testid="mission-msg" className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">{msg}</div>}
      {!d ? <p className="text-slate-400">Loading…</p> : (
        <>
          <section className="space-y-3"><div className="flex items-baseline justify-between"><h2 className="font-display text-lg">Daily</h2><span className="text-xs text-slate-400">resets in {countdown(d.resets.daily)}</span></div>
            <div className="grid gap-3 md:grid-cols-2">{d.daily.map((m) => <Card key={m.code} m={m} busy={claim.isPending} onClaim={() => claim.mutate(m.code)} />)}</div></section>
          <section className="space-y-3"><div className="flex items-baseline justify-between"><h2 className="font-display text-lg">Weekly</h2><span className="text-xs text-slate-400">resets in {countdown(d.resets.weekly)}</span></div>
            <div className="grid gap-3 md:grid-cols-2">{d.weekly.map((m) => <Card key={m.code} m={m} busy={claim.isPending} onClaim={() => claim.mutate(m.code)} />)}</div></section>
          <p className="text-xs text-slate-500">Progress is counted by the server from validated races, laps, garage purchases and driven distance in multiplayer sessions – it cannot be edited from the browser.</p>
        </>
      )}
    </main>
  );
}
