"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AVATARS, TIER_INFO, type AvatarKey, type TierKey } from "@road-rivals/shared";
import { api, ApiError, post, type LedgerEntry, type ProfileView } from "@/services/api";
import { TierBadge, money } from "@/components/Badges";

const TYPE: Record<string, string> = { RACE_REWARD: "Race reward", MISSION_REWARD: "Mission", ACHIEVEMENT_REWARD: "Achievement", PURCHASE_VEHICLE: "Car purchase", PURCHASE_PART: "Part purchase", REPAIR: "Repair", CUSTOMIZATION: "Customization", SIGNUP_BONUS: "Welcome bonus", ADJUSTMENT: "Level-up bonus" };

export default function ProfilePage() {
  const router = useRouter(); const qc = useQueryClient();
  const [ledger, setLedger] = useState(false);
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api<ProfileView>("/profile") });
  const led = useQuery({ queryKey: ["ledger"], queryFn: () => api<{ entries: LedgerEntry[] }>("/profile/ledger"), enabled: ledger });
  const avatar = useMutation({ mutationFn: (a: string) => post("/profile/avatar", { avatar: a }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["profile"] }) });
  useEffect(() => { if (q.error instanceof ApiError && q.error.status === 401) router.replace("/login?next=/profile"); }, [q.error, router]);
  const p = q.data;
  if (!p) return <main className="flex min-h-screen items-center justify-center text-slate-400">Loading…</main>;
  const pct = Math.min(100, Math.round((p.xp / p.xpToNext) * 100));
  const done = p.achievements.filter((a) => a.unlockedAt).length;
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="font-display text-2xl font-black">DRIVER <span className="text-rival">PROFILE</span></h1><Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link></header>

      <section className="card flex flex-wrap items-center gap-5">
        <div className="text-6xl" data-testid="avatar">{AVATARS[p.avatar as AvatarKey] ?? AVATARS.default}</div>
        <div className="min-w-[14rem] flex-1 space-y-1">
          <p className="font-display text-2xl">{p.username} <TierBadge tier={p.tier} /></p>
          <p className="text-sm text-slate-300">Level {p.level}{p.nextTier ? ` · ${TIER_INFO[p.nextTier.tier as TierKey].label} at level ${p.nextTier.level}` : " · maximum tier"}</p>
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-neon" style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-slate-400">{p.xp.toLocaleString()} / {p.xpToNext.toLocaleString()} XP</p>
        </div>
        <div className="text-right"><p className="text-xs text-slate-400">Wallet</p><p className="font-display text-2xl text-amber-300" data-testid="profile-coins">🪙 {money(p.coins)}</p></div>
      </section>

      <section className="card space-y-2"><p className="text-xs tracking-widest text-slate-400">AVATAR</p>
        <div className="flex flex-wrap gap-2">{(Object.keys(AVATARS) as AvatarKey[]).map((k) => <button key={k} data-testid={`avatar-${k}`} onClick={() => avatar.mutate(k)} className={`h-12 w-12 rounded-xl text-2xl ${p.avatar === k ? "bg-rival/30 ring-2 ring-rival" : "bg-white/10 hover:bg-white/20"}`}>{AVATARS[k]}</button>)}</div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="profile-stats">
        {[["Races", p.stats.racesPlayed], ["Wins", p.stats.racesWon], ["Win rate", `${p.stats.winRate}%`], ["Distance", `${p.stats.distanceKm} km`], ["Cars", p.stats.vehiclesOwned]].map(([k, v]) => <div key={k as string} className="card text-center"><p className="font-display text-2xl">{v}</p><p className="text-xs text-slate-400">{k}</p></div>)}
      </section>
      {p.season && <section className="card flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-slate-300">{p.season.name}</span><span className="font-display">Rank {p.season.rank ? `#${p.season.rank}` : "—"} · {p.season.points} pts · {p.season.wins} wins</span><Link href="/leaderboard" className="btn btn-ghost !py-1 text-sm">Leaderboard</Link></section>}

      <section className="space-y-2">
        <h2 className="font-display text-lg">Achievements <span className="text-sm text-slate-400">{done}/{p.achievements.length}</span></h2>
        <div className="grid gap-3 md:grid-cols-2" data-testid="achievements">
          {p.achievements.map((a) => (
            <div key={a.code} data-testid={`ach-${a.code}`} className={`card space-y-1 ${a.unlockedAt ? "border-emerald-400/50" : "opacity-80"}`}>
              <div className="flex justify-between gap-2"><div><p className="font-display text-sm">{a.unlockedAt ? "🏆 " : ""}{a.title}</p><p className="text-xs text-slate-400">{a.description} · {a.category}</p></div><span className="text-right text-xs text-amber-300">🪙 {money(a.rewardCoins)}{a.rewardXp ? <><br /><span className="text-slate-300">{a.rewardXp} XP</span></> : null}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full ${a.unlockedAt ? "bg-emerald-400" : "bg-neon"}`} style={{ width: `${Math.round((a.value / a.target) * 100)}%` }} /></div>
              <p className="text-[10px] text-slate-400">{a.unlockedAt ? `Unlocked ${new Date(a.unlockedAt).toLocaleDateString()}` : `${Math.floor(a.value)} / ${a.target}`}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-2">
        <button className="font-display text-lg" onClick={() => setLedger((v) => !v)} data-testid="toggle-ledger">Coin history {ledger ? "▾" : "▸"}</button>
        {ledger && (led.data ? (
          <ul className="space-y-1 text-sm" data-testid="ledger">{led.data.entries.map((e) => <li key={e.id} className="flex justify-between rounded bg-white/5 px-3 py-1"><span>{TYPE[e.type] ?? e.type} <span className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</span></span><span className={e.amount >= 0 ? "text-emerald-300" : "text-red-300"}>{e.amount >= 0 ? "+" : ""}{money(e.amount)} <span className="text-xs text-slate-500">→ {money(e.balanceAfter)}</span></span></li>)}</ul>
        ) : <p className="text-sm text-slate-500">Loading…</p>)}
      </section>
    </main>
  );
}
