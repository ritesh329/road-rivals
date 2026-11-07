"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, post, type Me, type PublicRoom, type RoomView } from "@/services/api";
import { RACE_MODES, RACE_MODE_KEYS, type RaceModeKey } from "@road-rivals/shared";
import SoloChallenges from "@/components/SoloChallenges";

export default function RoomsPage() {
  const router = useRouter(); const qc = useQueryClient();
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [maxPlayers, setMax] = useState(5);
  const [mode, setMode] = useState<RaceModeKey>("MULTIPLAYER");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const mine = useQuery({ queryKey: ["myroom"], queryFn: () => api<{ room: RoomView | null }>("/rooms/mine"), enabled: !!me.data });
  const pub = useQuery({ queryKey: ["publicrooms"], queryFn: () => api<{ rooms: PublicRoom[] }>("/rooms/public"), enabled: !!me.data, refetchInterval: 4000 });
  useEffect(() => { if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login?next=/rooms"); }, [me.error, router]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("kicked")) setMsg("You were removed from that room by the host."); }, []);

  async function run(fn: () => Promise<{ room: RoomView }>) {
    if (busy) return; setBusy(true); setMsg("");
    try { const r = await fn(); await qc.invalidateQueries({ queryKey: ["myroom"] }); router.push(`/room/${r.room.code}`); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : "Network error"); } finally { setBusy(false); }
  }
  const myRoom = mine.data?.room;

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-black">MULTI<span className="text-rival">PLAYER</span></h1>
        <Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link>
      </header>
      {msg && <div data-testid="rooms-msg" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{msg}</div>}
      {myRoom && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-neon/50" data-testid="my-room">
          <div><p className="text-sm text-slate-400">You are in a room</p><p className="font-display text-xl">{myRoom.code} <span className="text-sm text-slate-400">{myRoom.members.length}/{myRoom.maxPlayers} · {myRoom.status}</span></p></div>
          <Link href={`/room/${myRoom.code}`} className="btn btn-primary">Open room</Link>
        </div>
      )}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-display text-lg">Create room</h2>
          <div className="flex gap-2">
            {(["PRIVATE", "PUBLIC"] as const).map((v) => <button key={v} data-testid={`vis-${v}`} onClick={() => setVisibility(v)} className={`btn flex-1 !py-2 text-sm ${visibility === v ? "btn-primary" : "btn-ghost"}`}>{v === "PRIVATE" ? "🔒 Private (invite only)" : "🌐 Public (listed)"}</button>)}
          </div>
          <label className="flex items-center justify-between text-sm text-slate-300">Max players
            <select data-testid="max-players" className="input !w-24" value={maxPlayers} onChange={(e) => setMax(Number(e.target.value))}>{[2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <label className="flex items-center justify-between text-sm text-slate-300">Race mode
            <select data-testid="room-mode" className="input !w-48" value={mode} onChange={(e) => setMode(e.target.value as RaceModeKey)}>{RACE_MODE_KEYS.map((k) => <option key={k} value={k}>{RACE_MODES[k].name}</option>)}</select>
          </label>
          <p className="text-xs text-slate-400">{RACE_MODES[mode].blurb}</p>
          <button data-testid="create-room" disabled={busy} className="btn btn-primary w-full" onClick={() => run(() => post("/rooms", { visibility: mode === "PRIVATE" ? "PRIVATE" : visibility, maxPlayers, mode }))}>Create room</button>
        </div>
        <div className="card space-y-3">
          <h2 className="font-display text-lg">Join with a code</h2>
          <input data-testid="join-code" className="input text-center font-display text-xl uppercase tracking-[0.4em]" maxLength={6} placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button data-testid="join-room" disabled={busy || code.length !== 6} className="btn btn-primary w-full" onClick={() => run(() => post("/rooms/join", { code }))}>Join room</button>
          <button data-testid="quick-match" disabled={busy} className="btn btn-ghost w-full" onClick={() => run(() => post("/rooms/quick", {}))}>⚡ Quick match</button>
        </div>
      </section>
      <SoloChallenges />
      <section className="card">
        <h2 className="mb-2 font-display text-lg">Public rooms</h2>
        {pub.data?.rooms.length ? (
          <ul className="space-y-2" data-testid="public-rooms">
            {pub.data.rooms.map((r) => (
              <li key={r.code} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
                <span><b>{r.host}</b>'s room <span className="text-slate-400">· {r.players}/{r.maxPlayers} · {r.status}</span></span>
                <button disabled={!r.joinable || busy} className="btn btn-ghost !py-1 text-xs" onClick={() => run(() => post("/rooms/join", { code: r.code }))}>{r.joinable ? "Join" : r.locked ? "Locked" : "Full"}</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No public rooms right now – create one!</p>}
      </section>
    </main>
  );
}
