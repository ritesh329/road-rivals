"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, post, type RoomView } from "@/services/api";
import { emitAck, getSocket } from "@/services/socket";
import type { ChatMsg } from "@/game/net/netStore";
import { RACE_MODES, RACE_MODE_KEYS, type RaceModeKey } from "@road-rivals/shared";

export default function RoomPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = raw.toUpperCase();
  const router = useRouter();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const feed = useRef<HTMLDivElement>(null);

  const act = useCallback(async (path: string, body: unknown = {}) => {
    setNote("");
    try { return await post<any>(`/rooms/${code}/${path}`, body); } catch (e) { setNote(e instanceof ApiError ? e.message : "Network error"); return null; }
  }, [code]);

  useEffect(() => {
    let alive = true;
    const s = getSocket();
    (async () => {
      try {
        const me = await api<{ id: string }>("/me"); if (!alive) return; setMeId(me.id);
        const r = await api<{ room: RoomView }>(`/rooms/${code}`); if (!alive) return; setRoom(r.room);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=/room/${code}`);
        else setError(e instanceof ApiError ? (e.status === 403 || e.status === 404 ? "You are not in this room (or it no longer exists)." : e.message) : "Network error");
      }
    })();
    const sub = async () => { try { const r = await emitAck("room:subscribe", { code }); if (alive && r.ok) { setRoom(r.room); setChat(r.chat); } } catch { /* offline */ } };
    const onUpdate = (r: RoomView) => { if (r.code === code) setRoom(r); };
    const onChat = (m: ChatMsg) => setChat((c) => [...c, m].slice(-60));
    const onStarted = (e: { startAt: number }) => {
      const tick = () => { const left = Math.ceil((e.startAt - Date.now()) / 1000); if (left <= 0) { router.push(`/game?room=${code}`); return; } setCountdown(left); setTimeout(tick, 200); };
      tick();
    };
    const onKicked = () => router.replace("/rooms?kicked=1");
    const onClosed = () => router.replace("/rooms");
    s.on("connect", sub); s.on("room:update", onUpdate); s.on("chat:message", onChat); s.on("room:started", onStarted); s.on("room:kicked", onKicked); s.on("room:closed", onClosed);
    if (s.connected) void sub();
    return () => { alive = false; s.off("connect", sub); s.off("room:update", onUpdate); s.off("chat:message", onChat); s.off("room:started", onStarted); s.off("room:kicked", onKicked); s.off("room:closed", onClosed); s.emit("room:unsubscribe", { code }); };
  }, [code, router]);
  useEffect(() => { feed.current?.scrollTo({ top: 1e6 }); }, [chat.length]);

  if (error) return <main className="flex min-h-screen items-center justify-center p-4"><div className="card max-w-md text-center"><p className="text-red-300">{error}</p><Link href="/rooms" className="btn btn-primary mt-4">Multiplayer</Link></div></main>;
  if (!room || !meId) return <main className="flex min-h-screen items-center justify-center text-slate-400">Loading room…</main>;

  const isHost = room.hostId === meId;
  const mine = room.members.find((m) => m.userId === meId);
  const allReady = room.members.every((m) => m.isHost || m.ready);
  const link = typeof window !== "undefined" ? `${window.location.origin}/join/${room.inviteToken}` : "";
  const copy = async () => { try { await navigator.clipboard.writeText(link); } catch { /* insecure context */ } setCopied(true); setTimeout(() => setCopied(false), 1800); };
  const send = async (e: React.FormEvent) => { e.preventDefault(); const t = text.trim(); setText(""); if (t) { const r = await emitAck("chat:send", { code, text: t }).catch(() => null); if (r && !r.ok) setNote(r.error); } };
  const leave = async () => { await act("leave"); router.push("/rooms"); };

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs tracking-[0.3em] text-slate-400">ROOM</p>
          <h1 className="font-display text-3xl font-black tracking-[0.2em]" data-testid="room-code">{room.code}</h1>
        </div>
        <div className="flex gap-2"><span className="rounded-lg bg-white/10 px-3 py-2 text-sm" data-testid="room-count">{room.members.length}/{room.maxPlayers} players</span><button className="btn btn-ghost !py-2" onClick={leave} data-testid="leave-room">Leave</button></div>
      </header>
      {countdown !== null && <div data-testid="countdown" className="card text-center font-display text-5xl text-neon">Starting in {countdown}…</div>}
      {note && <div data-testid="room-note" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{note}</div>}

      <section className="card space-y-2" data-testid="mode-card">
        <p className="text-xs tracking-[0.25em] text-slate-400">RACE MODE</p>
        {isHost && room.status === "LOBBY"
          ? <select data-testid="mode-select" className="input !py-2" value={room.mode} onChange={(e) => act("settings", { mode: e.target.value as RaceModeKey })}>{RACE_MODE_KEYS.map((k) => <option key={k} value={k}>{RACE_MODES[k].name}</option>)}</select>
          : <p className="font-display text-lg text-neon" data-testid="mode-name">{RACE_MODES[room.mode as RaceModeKey]?.name ?? room.mode}</p>}
        <p className="text-xs text-slate-300">{RACE_MODES[room.mode as RaceModeKey]?.blurb}{RACE_MODES[room.mode as RaceModeKey]?.minPlayers > 1 ? ` Needs ${RACE_MODES[room.mode as RaceModeKey].minPlayers}+ drivers.` : ""} The host starts the race inside the session.</p>
      </section>

      <section className="card space-y-2">
        <p className="text-sm text-slate-300">Invite link – opens this exact room:</p>
        <div className="flex gap-2"><input readOnly data-testid="invite-link" className="input text-xs" value={link} onFocus={(e) => e.target.select()} /><button data-testid="copy-invite" className="btn btn-primary !py-2" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button></div>
        {isHost && <button className="text-xs text-slate-400 underline" onClick={() => act("invite/rotate")}>Reset link (old link stops working)</button>}
      </section>

      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="card space-y-2" data-testid="members">
          <h2 className="font-display text-lg">Drivers</h2>
          {room.members.map((m) => (
            <div key={m.userId} data-testid="member-row" className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${m.online ? "bg-emerald-400" : "bg-slate-500"}`} />{m.username}{m.isHost && <span title="Host">👑</span>}<span className="text-xs text-slate-500">Lv {m.level}</span></span>
              <span className="flex items-center gap-2">
                <span className={m.isHost ? "text-slate-400" : m.ready ? "text-emerald-300" : "text-slate-500"}>{m.isHost ? "Host" : m.ready ? "Ready" : "Not ready"}</span>
                {isHost && !m.isHost && <button className="text-xs text-red-300 underline" data-testid={`kick-${m.username}`} onClick={() => act("kick", { userId: m.userId })}>Kick</button>}
              </span>
            </div>
          ))}
          {Array.from({ length: room.maxPlayers - room.members.length }, (_, i) => <div key={i} className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-sm text-slate-600">Open seat</div>)}
          <div className="flex flex-wrap gap-2 pt-2">
            {room.status === "RACING" ? (
              <>
                <Link href={`/game?room=${code}`} data-testid="enter-session" className="btn btn-primary">Enter session ▶</Link>
                {isHost && <button className="btn btn-ghost" onClick={() => act("stop")}>End session</button>}
              </>
            ) : (
              <>
                {!isHost && <button data-testid="ready" className="btn btn-primary" onClick={() => act("ready", { ready: !mine?.ready })}>{mine?.ready ? "Not ready" : "I'm ready"}</button>}
                {isHost && <button data-testid="start" className="btn btn-primary" onClick={() => act("start")} title={allReady ? "" : "Waiting for players"}>{allReady ? "Start session" : "Start (waiting for ready…)"}</button>}
              </>
            )}
          </div>
          {isHost && (
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3 text-xs">
              <button data-testid="toggle-lock" className="btn btn-ghost !py-1" onClick={() => act("settings", { locked: !room.locked })}>{room.locked ? "🔒 Locked – unlock" : "🔓 Lock room"}</button>
              <button className="btn btn-ghost !py-1" onClick={() => act("settings", { visibility: room.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC" })}>{room.visibility === "PUBLIC" ? "🌐 Public" : "🔒 Private"} (switch)</button>
            </div>
          )}
        </section>
        <section className="card flex min-h-[18rem] flex-col">
          <h2 className="mb-2 font-display text-lg">Chat</h2>
          <div ref={feed} className="flex-1 space-y-1 overflow-y-auto text-sm" data-testid="lobby-chat">
            {chat.map((m) => <p key={m.id}><b className="text-neon">{m.username}</b> {m.text}</p>)}
            {!chat.length && <p className="text-slate-600">Say hi 👋</p>}
          </div>
          <form onSubmit={send} className="mt-2 flex gap-2"><input data-testid="lobby-chat-input" className="input !py-2 text-sm" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" /><button className="btn btn-primary !py-2 text-sm">Send</button></form>
        </section>
      </div>
    </main>
  );
}
