"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { emitAck } from "@/services/socket";
import { SEAT_COLORS, remote, useNet } from "./netStore";
import { useVoice } from "./voiceStore";

/** Multiplayer overlay: player list with live speed, connection state, chat (press T). */
export default function NetHud() {
  const { players, chat, connected, roomCode, selfId, seat } = useNet();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [, tick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyT" && !typing && (e.target as HTMLElement)?.tagName !== "INPUT") { e.preventDefault(); setTyping(true); setTimeout(() => inputRef.current?.focus(), 0); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [typing]);
  useEffect(() => { feedRef.current?.scrollTo({ top: 1e6 }); }, [chat.length]);

  const openChat = () => { setTyping(true); setTimeout(() => inputRef.current?.focus(), 0); };
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim(); setText(""); setTyping(false); inputRef.current?.blur();
    if (t && roomCode) { try { await emitAck("chat:send", { code: roomCode, text: t }); } catch { /* ignore */ } }
  }
  const list = Object.values(players).sort((a, b) => a.seat - b.seat);
  const voice = useVoice();
  const talking = (id: string) => voice.on && voice.speaking[id];

  // leave voice when the game screen closes; V = push-to-talk while muted
  useEffect(() => () => useVoice.getState().leave(), []);
  useEffect(() => {
    const k = (v: boolean) => (e: KeyboardEvent) => { if (e.code === "KeyV" && !e.repeat && (e.target as HTMLElement)?.tagName !== "INPUT") useVoice.getState().talk(v); };
    const d = k(true), u = k(false);
    window.addEventListener("keydown", d); window.addEventListener("keyup", u);
    return () => { window.removeEventListener("keydown", d); window.removeEventListener("keyup", u); };
  }, []);

  return (
    <>
      <div className="pointer-events-none absolute right-2 top-12 w-52 rounded-xl bg-black/50 p-2 text-xs backdrop-blur short:w-36 short:p-1.5 short:text-[10px]" data-testid="players-panel">
        <div className="mb-1 flex items-center justify-between tracking-[0.2em] text-slate-300">
          <span>PLAYERS {list.length + 1}/5</span>
          <span className={connected ? "text-emerald-400" : "animate-pulse text-red-400"}>{connected ? "● LIVE" : <>● <span className="short:hidden">RECONNECTING</span></>}</span>
        </div>
        <div className="flex items-center justify-between py-0.5 font-bold" style={{ color: SEAT_COLORS[seat % 5] }}><span>You</span><span className="text-slate-300">{voice.on ? (voice.muted && !talking("me") ? "🔇" : talking("me") ? "🔊" : "🎤") : ""}</span></div>
        {list.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-0.5" style={{ color: SEAT_COLORS[p.seat % 5] }} data-testid="player-row">
            <span className="truncate">{talking(p.id) ? "🔊 " : voice.linked.includes(p.id) ? "🎧 " : ""}{p.username}</span>
            <span className="tabular-nums text-slate-300">{Math.round(remote.pos.get(p.id)?.speed ?? 0)} km/h</span>
          </div>
        ))}
        <div className="pointer-events-auto mt-1 flex gap-1">
          {!voice.on
            ? <button onClick={() => void voice.join()} disabled={voice.busy} data-testid="voice-join" className="flex-1 rounded-md bg-emerald-500/25 py-1.5 text-emerald-200 short:py-1">{voice.busy ? "…" : "🎤 Join voice"}</button>
            : <>
                <button onClick={voice.toggleMute} data-testid="voice-mute" className={`flex-1 rounded-md py-1.5 short:py-1 ${voice.muted ? "bg-red-500/30 text-red-200" : "bg-emerald-500/25 text-emerald-200"}`}>{voice.muted ? "🔇 Muted" : "🎤 Mic on"}</button>
                <button onClick={voice.leave} data-testid="voice-leave" className="rounded-md bg-white/10 px-2 py-1.5 text-slate-200 short:py-1" aria-label="Leave voice">✕</button>
              </>}
        </div>
        {voice.error && <p className="mt-1 text-[10px] leading-tight text-red-300">{voice.error}</p>}
        {voice.on && voice.muted && <p className="mt-1 hidden text-[10px] text-slate-400 tall:block touch:hidden">Hold V to talk</p>}
        <Link href={roomCode ? `/room/${roomCode}` : "/rooms"} className="pointer-events-auto mt-1 block rounded-md bg-white/10 py-1.5 text-center text-slate-200 hover:bg-white/20 short:py-1">Room lobby</Link>
      </div>
      <div className="pointer-events-none absolute bottom-44 left-3 w-72 max-w-[60vw] touch:tall:bottom-28 short:bottom-[88px] short:left-2 short:w-52" data-testid="chat">
        <div ref={feedRef} className="max-h-28 space-y-0.5 overflow-hidden text-xs short:max-h-14 short:text-[10px]">
          {chat.slice(-6).map((m) => <div key={m.id} className="rounded bg-black/45 px-2 py-0.5 text-slate-100"><b className="text-neon">{m.username}</b> {m.text}</div>)}
        </div>
        {typing
          ? <form onSubmit={send} className="pointer-events-auto mt-1"><input ref={inputRef} data-testid="chat-input" value={text} maxLength={140} onChange={(e) => setText(e.target.value)} onBlur={() => setTyping(false)} onKeyDown={(e) => { if (e.code === "Escape") { setTyping(false); } e.stopPropagation(); }} placeholder="Message… (Enter to send)" className="input !py-1.5 text-xs" /></form>
          : <button onClick={openChat} className="pointer-events-auto mt-1 rounded-md bg-black/45 px-2 py-1 text-[10px] text-slate-300 backdrop-blur">💬 Chat <span className="touch:hidden">(T)</span></button>}
      </div>
    </>
  );
}
