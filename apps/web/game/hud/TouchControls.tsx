"use client";
import { useEffect, useRef, useState } from "react";
import { controls, useGame } from "../store";
import { useGarageUi } from "../garage/garageStore";
import { tryOpenGarage } from "../input";

type K = Exclude<keyof typeof controls.touch, "steer">;

/** pointerId -> what that finger is holding. Lets each thumb/finger work independently (steer + gas + nitro at once). */
const held = new Map<number, K | "steer">();
function resetAll() {
  held.clear();
  const t = controls.touch;
  t.up = t.down = t.left = t.right = t.handbrake = t.nitro = false; t.steer = 0;
}
function release(id: number) {
  const what = held.get(id); if (!what) return;
  held.delete(id);
  if (what === "steer") controls.touch.steer = 0; else controls.touch[what] = false;
}

function Btn({ k, label, cls = "" }: { k: K; label: string; cls?: string }) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); held.set(e.pointerId, k); controls.touch[k] = true; }}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto flex touch-none select-none items-center justify-center rounded-2xl border border-white/20 bg-black/45 font-display text-sm text-white backdrop-blur active:bg-neon/40 short:rounded-xl short:text-xs ${cls}`}
    >{label}</button>
  );
}

/** Analog steering strip: slide your thumb left/right of the centre. Proportional, so gentle turns at speed are easy. */
function SteerPad() {
  const ref = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0); // -1..1, for the knob only
  const apply = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const raw = (clientX - (r.left + r.width / 2)) / (r.width / 2 * 0.8); // full lock at 80% of the half-width
    let v = Math.max(-1, Math.min(1, raw));
    v = Math.abs(v) < 0.08 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.08) / 0.92);
    controls.touch.steer = v; setX(Math.max(-1, Math.min(1, raw)));
  };
  const end = (id: number) => { release(id); setX(0); };
  return (
    <div
      ref={ref}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); held.set(e.pointerId, "steer"); apply(e.clientX); }}
      onPointerMove={(e) => { if (held.get(e.pointerId) === "steer") apply(e.clientX); }}
      onPointerUp={(e) => end(e.pointerId)} onPointerCancel={(e) => end(e.pointerId)} onLostPointerCapture={(e) => end(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
      className="pointer-events-auto relative h-20 w-56 touch-none select-none rounded-full border border-white/20 bg-black/45 backdrop-blur short:h-[72px] short:w-52"
      data-testid="steer-pad"
    >
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-white/60">◀</span>
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-2xl text-white/60">▶</span>
      <span className="absolute left-1/2 top-2 bottom-2 w-px bg-white/15" />
      <span className="absolute top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neon/70 bg-neon/30 shadow-[0_0_14px_rgba(34,211,238,.5)] short:h-11 short:w-11" style={{ left: `${50 + x * 40}%` }} />
    </div>
  );
}

/** Thumb controls. Left thumb steers, right thumb gas/brake/nitro – all at the same time. */
export default function TouchControls() {
  const cycle = useGame((s) => s.cycleCamera);
  const near = useGarageUi((s) => s.near);

  // safety net: if the browser ever drops a pointer-up (fullscreen change, system gesture, finger leaves the screen) nothing stays stuck
  useEffect(() => {
    const up = (e: PointerEvent) => release(e.pointerId);
    const touchEnd = (e: TouchEvent) => { if (e.touches.length === 0) resetAll(); };
    const hide = () => resetAll();
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    window.addEventListener("touchend", touchEnd); window.addEventListener("touchcancel", touchEnd);
    window.addEventListener("blur", hide); document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchend", touchEnd); window.removeEventListener("touchcancel", touchEnd);
      window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", hide);
      resetAll();
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4 short:p-2">
      <SteerPad />
      <div className="flex flex-col items-end gap-3 short:gap-2">
        <div className="flex gap-3 short:gap-2">
          {near && <button onPointerDown={tryOpenGarage} className="pointer-events-auto h-12 w-20 rounded-xl border border-neon/60 bg-black/60 text-xs text-neon short:h-9 short:w-16 short:text-[10px]">GARAGE</button>}
          <button onPointerDown={cycle} className="pointer-events-auto h-12 w-14 rounded-xl border border-white/20 bg-black/45 text-xs text-white short:h-9 short:w-11 short:text-[10px]">CAM</button>
          <Btn k="nitro" label="NITRO" cls="h-12 w-20 !text-sky-300 short:h-9 short:w-16 short:!text-[10px]" />
          <Btn k="handbrake" label="HAND" cls="h-12 w-16 short:h-9 short:w-12 short:!text-[10px]" />
        </div>
        <div className="flex gap-3 short:gap-2"><Btn k="down" label="BRAKE" cls="h-20 w-24 short:h-[72px] short:w-[84px]" /><Btn k="up" label="GAS" cls="h-20 w-24 !border-rival/60 short:h-[72px] short:w-[84px]" /></div>
      </div>
    </div>
  );
}
