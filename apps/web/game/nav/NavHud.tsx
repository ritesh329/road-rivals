"use client";
import { useEffect } from "react";
import { describeStep, formatDistance } from "@road-rivals/shared";
import { useNav } from "./navStore";

const ARROW: Record<string, string> = { left: "↰", right: "↱", straight: "↑", start: "↑", uturn: "↶", arrive: "⚑" };

/** Drives navigation updates + shows the turn-by-turn banner under the minimap. */
export default function NavHud() {
  const { waypoint, progress, clear } = useNav();
  useEffect(() => { useNav.getState().hydrate(); const t = setInterval(() => useNav.getState().update(), 500); return () => clearInterval(t); }, []);
  if (!waypoint || !progress) return null;
  return (
    <div className="pointer-events-auto absolute left-2 top-[184px] z-10 w-56 rounded-xl bg-black/60 p-2 text-white backdrop-blur short:top-[120px] short:w-44 short:p-1.5" data-testid="nav-hud">
      <div className="flex items-center gap-2">
        <span className="text-3xl text-neon short:text-2xl">{ARROW[progress.next.maneuver] ?? "↑"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight short:text-xs">{describeStep(progress.next, progress.toNext)}</p>
          <p className="truncate text-[10px] text-slate-300">{waypoint.name} · {formatDistance(progress.remaining)}</p>
        </div>
        <button aria-label="Cancel navigation" className="px-2 py-1 text-xs text-slate-400 hover:text-white" onClick={clear}>✕</button>
      </div>
    </div>
  );
}
