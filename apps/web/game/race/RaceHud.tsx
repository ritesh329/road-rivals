"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RACE_MODES, ordinal } from "@road-rivals/shared";
import { emitAck } from "@/services/socket";
import { post } from "@/services/api";
import { SEAT_COLORS, useNet } from "../net/netStore";
import { useRace, type ResultRow } from "./raceStore";

const fmt = (ms: number | null) => {
  if (ms === null || ms === undefined) return "--:--.---";
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(x).padStart(3, "0")}`;
};
const MEDAL: Record<string, string> = { GOLD: "🥇 Gold", SILVER: "🥈 Silver", BRONZE: "🥉 Bronze" };

/** Race overlay: pre-race start button, 5-4-3-2-1 countdown, live standings, results. */
export default function RaceHud({ roomCode }: { roomCode: string }) {
  const r = useRace();
  const selfId = useNet((n) => n.selfId);
  const seat = useNet((n) => n.seat);
  const players = useNet((n) => n.players);
  const [, tick] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);

  const start = async () => {
    setBusy(true); setMsg("");
    try { const a = await emitAck("race:start", { code: roomCode }); if (!a.ok) setMsg(a.error ?? "Could not start"); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const exit = async () => { try { await post(`/rooms/${roomCode}/leave`, {}); } catch { /* already gone */ } router.push("/dashboard"); };

  const names = Object.fromEntries([[selfId ?? "", "You"], ...Object.values(players).map((p) => [p.id, p.username])]);
  const me = r.standings.find((s) => s.id === selfId);
  const total = r.standings.length;
  const left = r.startLocal - Date.now();
  const mode = r.info ? RACE_MODES[r.info.mode] : r.roomMode ? RACE_MODES[r.roomMode] : null;
  const timeLeft = r.timeLeftMs !== null ? Math.max(0, r.timeLeftMs - (Date.now() - r.timeLeftAt)) : null;

  return (
    <>
      {/* feed */}
      <div className="pointer-events-none absolute left-1/2 top-44 z-10 -translate-x-1/2 space-y-1 text-center short:top-[118px]">
        {r.feed.map((f) => <div key={f.id} className={`rounded-lg px-3 py-1 text-sm backdrop-blur short:py-0.5 short:text-xs ${f.kind === "good" ? "bg-emerald-500/25 text-emerald-100" : f.kind === "bad" ? "bg-red-500/25 text-red-100" : "bg-black/60 text-slate-100"}`}>{f.text}</div>)}
      </div>

      {/* idle: host starts the race, others wait */}
      {r.phase === "idle" && mode && (
        <div className="pointer-events-auto absolute bottom-52 left-1/2 z-10 w-72 max-w-[90vw] -translate-x-1/2 rounded-xl bg-black/60 p-3 text-center backdrop-blur sm:bottom-6 touch:tall:bottom-52 short:bottom-auto short:top-[64px] short:w-64 short:p-2" data-testid="race-idle">
          <p className="font-display text-xs tracking-[0.25em] text-neon">{mode.name.toUpperCase()}</p>
          <p className="mt-1 text-xs text-slate-300">{mode.blurb}</p>
          {r.isHost
            ? <button data-testid="race-start" disabled={busy} onClick={start} className="btn btn-primary mt-2 w-full !py-2 text-sm">🏁 Start race ({Object.keys(players).length + 1} driver{Object.keys(players).length ? "s" : ""})</button>
            : <p className="mt-2 text-xs text-slate-400">Waiting for the host to start the race…</p>}
          {r.solo && <p className="mt-1 text-[10px] text-slate-500">Your challenge starts automatically.</p>}
          {msg && <p className="mt-1 text-xs text-red-300">{msg}</p>}
        </div>
      )}

      {/* countdown */}
      {r.phase === "countdown" && left > -800 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center" data-testid="race-countdown">
          <p className="font-display text-xs tracking-[0.4em] text-slate-300">{r.info?.name?.toUpperCase()}{r.info && r.info.rounds > 1 ? ` · ROUND ${r.info.round}/${r.info.rounds}` : ""}</p>
          <p className={`font-display text-8xl font-black short:text-6xl drop-shadow-[0_0_30px_rgba(34,211,238,.7)] ${left > 0 ? "text-neon" : "text-emerald-300"}`}>{left > 0 ? Math.ceil(left / 1000) : "GO!"}</p>
          <p className="text-sm text-slate-300">{mode?.blurb}</p>
        </div>
      )}

      {/* live panel */}
      {(r.phase === "running" || r.phase === "countdown") && r.info && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 max-w-[46vw] -translate-x-1/2 rounded-lg bg-black/55 px-5 py-2 text-center backdrop-blur short:px-3 short:py-1" data-testid="race-panel">
            <div className="text-[10px] tracking-[0.3em] text-neon">{r.info.name.toUpperCase()}{r.info.rounds > 1 ? ` · R${r.info.round}/${r.info.rounds}` : ""}</div>
            {r.info.kind === "drift" && <div className="text-2xl tabular-nums">{Math.round(me?.score ?? 0).toLocaleString()} <span className="text-xs text-slate-400">pts</span></div>}
            {r.info.kind === "checkpoint" && <div className="text-2xl tabular-nums">{me?.gates ?? 0} <span className="text-xs text-slate-400">gates</span></div>}
            {(r.info.kind === "laps") && <div className="text-2xl tabular-nums">{ordinal(me?.position ?? 1)}<span className="text-sm text-slate-400"> / {total || r.info.racers.length}</span></div>}
            {r.info.kind === "survival" && <div className="text-2xl tabular-nums">{me?.eliminated ? "ELIMINATED" : `${ordinal(me?.position ?? 1)} / ${total || r.info.racers.length}`}</div>}
            <div className="text-[10px] text-slate-300">
              {r.info.kind === "laps" && <>Lap {Math.min(r.info.laps, me?.lap ?? 1)}/{r.info.laps} · Gate {(me?.gates ?? 0) % r.info.gates}/{r.info.gates}</>}
              {r.info.kind === "drift" && <>Time left {((timeLeft ?? 0) / 1000).toFixed(0)} s</>}
              {r.info.kind === "checkpoint" && <>Every gate adds 12 s</>}
              {r.info.kind === "survival" && <>Last place is eliminated every 20 s</>}
            </div>
          </div>
          <div className="pointer-events-none absolute right-2 top-14 z-10 hidden w-52 translate-y-[132px] space-y-0.5 rounded-xl bg-black/50 p-2 text-xs backdrop-blur md:block short:hidden" data-testid="race-standings">
            {r.standings.map((s) => (
              <div key={s.id} className={`flex items-center justify-between ${s.id === selfId ? "font-bold" : ""} ${s.eliminated || s.dnf ? "opacity-50" : ""}`} style={{ color: SEAT_COLORS[(r.info!.racers.find((x) => x.id === s.id)?.seat ?? 0) % 5] }}>
                <span className="truncate">{s.position}. {names[s.id] ?? s.name}</span>
                <span className="tabular-nums text-slate-300">{r.info!.kind === "drift" ? Math.round(s.score) : s.finished ? fmt(s.timeMs) : s.eliminated ? "OUT" : s.dnf ? "DNF" : r.info!.kind === "checkpoint" ? s.gates : `L${s.lap}`}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* results */}
      {r.phase === "results" && r.results && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-black/65 safe-pad backdrop-blur-sm" data-testid="race-results">
          <div className="card max-h-full w-full max-w-2xl space-y-3 overflow-y-auto short:space-y-2">
            <h2 className="font-display text-2xl short:text-lg">{r.results.name.toUpperCase()}{r.results.rounds > 1 ? ` · ROUND ${r.results.round}/${r.results.rounds}` : ""}</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400"><tr><th>#</th><th>Driver</th><th>{r.results.mode === "DRIFT" ? "Score" : r.results.mode === "CHECKPOINT" ? "Gates" : "Time"}</th><th className="text-right">Coins</th><th className="text-right">XP</th></tr></thead>
              <tbody>
                {r.results.rows.map((row: ResultRow) => (
                  <tr key={row.userId} className={row.userId === selfId ? "text-neon" : ""} data-testid="result-row">
                    <td className="py-1">{row.position}</td>
                    <td>{row.userId === selfId ? "You" : names[row.userId] ?? row.name}{row.medal ? ` · ${MEDAL[row.medal] ?? ""}` : ""}{row.dnf ? " · DNF" : row.eliminated ? " · OUT" : ""}</td>
                    <td className="tabular-nums">{r.results!.mode === "DRIFT" ? row.score.toLocaleString() : r.results!.mode === "CHECKPOINT" ? row.gates : row.finished ? fmt(row.timeMs) : "—"}</td>
                    <td className="text-right tabular-nums text-amber-300">+{(row.paid?.coinsAwarded ?? row.coins).toLocaleString()}</td>
                    <td className="text-right tabular-nums">+{row.paid?.xpAwarded ?? row.xp}{row.paid?.leveledUp ? " ⬆" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.results.rows.find((x) => x.userId === selfId)?.paid?.capped && <p className="text-xs text-amber-300">Daily race reward limit reached – no coins/XP for this race.</p>}
            {r.results.table && (
              <div>
                <p className="text-xs tracking-widest text-slate-400">CHAMPIONSHIP</p>
                {r.results.table.map((t) => <div key={t.userId} className="flex justify-between text-sm"><span>{t.position}. {t.userId === selfId ? "You" : names[t.userId] ?? t.username}</span><span className="tabular-nums">{t.points} pts</span></div>)}
              </div>
            )}
            {r.results.finalRewards && r.results.finalRewards.find((f) => f.userId === selfId) && (
              <p className="rounded-lg bg-amber-400/10 p-2 text-sm text-amber-200">🏆 Tournament bonus: +{r.results.finalRewards.find((f) => f.userId === selfId)!.coins.toLocaleString()} coins, +{r.results.finalRewards.find((f) => f.userId === selfId)!.xp} XP</p>
            )}
            {r.nextAtLocal && <p className="text-center font-display text-neon">Next round in {Math.max(0, Math.ceil((r.nextAtLocal - Date.now()) / 1000))}…</p>}
            <div className="flex flex-wrap gap-2">
              {!r.nextAtLocal && r.isHost && <button data-testid="race-again" disabled={busy} onClick={start} className="btn btn-primary flex-1 !py-2">{r.solo ? "Try again" : "Start another race"}</button>}
              {!r.nextAtLocal && !r.isHost && <p className="flex-1 text-sm text-slate-400">Waiting for the host…</p>}
              <button className="btn btn-ghost !py-2" onClick={() => useRace.setState({ phase: "idle", results: null })}>Free roam</button>
              {r.solo ? <button className="btn btn-ghost !py-2" onClick={exit}>Exit</button> : <Link href={`/room/${roomCode}`} className="btn btn-ghost !py-2">Room lobby</Link>}
            </div>
            {msg && <p className="text-xs text-red-300">{msg}</p>}
          </div>
        </div>
      )}
    </>
  );
}
