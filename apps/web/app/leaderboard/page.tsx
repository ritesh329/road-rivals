"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AVATARS, type AvatarKey } from "@road-rivals/shared";
import { api, ApiError, type LeaderboardView, type Me } from "@/services/api";
import { TierBadge } from "@/components/Badges";

const BOARDS = [
  { key: "season", label: "Season points", unit: "pts" },
  { key: "wins", label: "Race wins", unit: "wins" },
  { key: "level", label: "Level", unit: "lvl" },
] as const;

export default function LeaderboardPage() {
  const router = useRouter();
  const [board, setBoard] = useState<(typeof BOARDS)[number]["key"]>("season");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const q = useQuery({ queryKey: ["leaderboard", board], queryFn: () => api<LeaderboardView>(`/leaderboard?board=${board}`), enabled: !!me.data, refetchInterval: 20000 });
  useEffect(() => { if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login?next=/leaderboard"); }, [me.error, router]);
  const d = q.data; const unit = BOARDS.find((b) => b.key === board)!.unit;
  const inTop = d?.top.some((t) => t.userId === me.data?.id);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="font-display text-2xl font-black">LEADER<span className="text-rival">BOARD</span></h1><Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link></header>
      <div className="flex gap-2">{BOARDS.map((b) => <button key={b.key} data-testid={`board-${b.key}`} onClick={() => setBoard(b.key)} className={`btn flex-1 !py-2 text-sm ${board === b.key ? "btn-primary" : "btn-ghost"}`}>{b.label}</button>)}</div>
      {d?.season && <p className="text-xs text-slate-400">{d.season.name} · ends {new Date(d.season.endsAt).toLocaleDateString()}</p>}
      <section className="card !p-2">
        {!d ? <p className="p-4 text-slate-400">Loading…</p> : d.top.length === 0 ? <p className="p-4 text-slate-500">No results yet – finish a race to get on the board!</p> : (
          <ol className="divide-y divide-white/5" data-testid="board-rows">
            {d.top.map((r) => (
              <li key={r.userId} data-testid="board-row" className={`flex items-center gap-3 px-3 py-2 ${r.userId === me.data?.id ? "rounded-lg bg-neon/10 text-neon" : ""}`}>
                <span className="w-7 text-center font-display text-sm">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</span>
                <span className="text-xl">{AVATARS[r.avatar as AvatarKey] ?? AVATARS.default}</span>
                <span className="min-w-0 flex-1 truncate">{r.username}{r.userId === me.data?.id ? " (you)" : ""}</span>
                <TierBadge tier={r.tier} />
                <span className="w-24 text-right text-sm tabular-nums">{r.value.toLocaleString()} {unit}<span className="block text-[10px] text-slate-400">{r.extra}</span></span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {d?.me && !inTop && <div className="card flex items-center justify-between border-neon/50" data-testid="my-rank"><span>Your rank <b className="font-display text-neon">#{d.me.rank}</b></span><span className="tabular-nums">{d.me.value.toLocaleString()} {unit} · {d.me.extra}</span></div>}
      {d && !d.me && d.top.length > 0 && <p className="text-xs text-slate-500">You are not ranked on this board yet.</p>}
    </main>
  );
}
