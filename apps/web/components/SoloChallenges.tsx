"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RACE_MODES, type RaceModeKey } from "@road-rivals/shared";
import { ApiError, post, type RoomView } from "@/services/api";

const SOLO: RaceModeKey[] = ["TIME_TRIAL", "DRIFT", "CHECKPOINT"];
const ICON: Record<string, string> = { TIME_TRIAL: "⏱", DRIFT: "🌀", CHECKPOINT: "🏁" };

/** One click → a private one-seat room that is already in session; the server starts the challenge itself. */
export default function SoloChallenges() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  async function go(mode: RaceModeKey) {
    if (busy) return; setBusy(mode); setErr("");
    try { const r = await post<{ room: RoomView }>("/rooms/solo", { mode }); router.push(`/game?room=${r.room.code}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Network error"); setBusy(null); }
  }
  return (
    <section className="card space-y-3" data-testid="solo-challenges">
      <h2 className="font-display text-lg">Solo challenges</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {SOLO.map((m) => (
          <button key={m} data-testid={`solo-${m}`} disabled={!!busy} onClick={() => go(m)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-neon/60 disabled:opacity-60">
            <span className="font-display text-sm text-neon">{ICON[m]} {RACE_MODES[m].name}</span>
            <span className="mt-1 block text-xs text-slate-300">{RACE_MODES[m].blurb}</span>
          </button>
        ))}
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
    </section>
  );
}
