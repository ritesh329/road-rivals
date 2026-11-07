"use client";
import { controls, useGame } from "../store";
import { useGarageUi } from "../garage/garageStore";
import { tryOpenGarage } from "../input";

type K = keyof typeof controls.touch;
function Btn({ k, label, cls = "" }: { k: K; label: string; cls?: string }) {
  const on = (v: boolean) => (e: React.PointerEvent) => { e.preventDefault(); controls.touch[k] = v; };
  return (
    <button
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); on(true)(e); }}
      onPointerUp={on(false)} onPointerCancel={on(false)} onLostPointerCapture={on(false)} onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto flex touch-none select-none items-center justify-center rounded-2xl border border-white/20 bg-black/45 font-display text-sm text-white backdrop-blur active:bg-neon/40 short:rounded-xl short:text-xs ${cls}`}
    >{label}</button>
  );
}

/** Thumb controls. Sizes shrink on short (landscape phone) screens so both thumbs reach everything without covering the road. */
export default function TouchControls() {
  const cycle = useGame((s) => s.cycleCamera);
  const near = useGarageUi((s) => s.near);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4 short:p-2">
      <div className="flex gap-3 short:gap-2"><Btn k="left" label="◀" cls="h-20 w-20 text-3xl short:h-[72px] short:w-[72px] short:text-2xl" /><Btn k="right" label="▶" cls="h-20 w-20 text-3xl short:h-[72px] short:w-[72px] short:text-2xl" /></div>
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
