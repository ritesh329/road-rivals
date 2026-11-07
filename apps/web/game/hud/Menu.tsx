"use client";
import Link from "next/link";
import { useGame, type Quality } from "../store";
import { useNav } from "../nav/navStore";
import { useFullscreen } from "../device";

/** Small ☰ button, top-right (inside the HUD safe area). */
export function MenuButton() {
  const open = useGame((s) => s.menuOpen);
  const setMenu = useGame((s) => s.setMenu);
  if (open) return null;
  return <button onClick={() => setMenu(true)} aria-label="Open menu" className="pointer-events-auto absolute right-2 top-2 rounded-lg bg-black/50 px-3 py-2 font-display text-xs text-white backdrop-blur short:py-1.5">☰ MENU</button>;
}

/** Pause / settings overlay – scrolls on short (landscape phone) screens. */
export default function Menu() {
  const g = useGame();
  const fs = useFullscreen();
  if (!g.menuOpen) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/60 safe-pad backdrop-blur-sm">
      <div className="card max-h-full w-full max-w-md space-y-4 overflow-y-auto short:max-w-xl short:space-y-2">
        <h2 className="font-display text-xl short:text-base">PAUSE · SETTINGS</h2>
        <div>
          <p className="mb-1 text-xs text-slate-400">Graphics</p>
          <div className="flex gap-2">{(["low", "medium", "high"] as Quality[]).map((q) => (
            <button key={q} onClick={() => g.set({ quality: q })} className={`btn flex-1 !py-2 ${g.quality === q ? "btn-primary" : "btn-ghost"}`}>{q.toUpperCase()}</button>))}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm short:grid-cols-3">
          <button className="btn btn-ghost !py-2" onClick={() => g.set({ night: !g.night })}>{g.night ? "🌙 Night" : "☀️ Day"}<span className="touch:hidden">&nbsp;(N)</span></button>
          <button className="btn btn-ghost !py-2" onClick={() => g.cycleCamera()}>Camera: {g.camera}<span className="touch:hidden">&nbsp;(C)</span></button>
          <button className="btn btn-ghost !py-2" onClick={() => g.set({ sound: !g.sound })}>Sound: {g.sound ? "on" : "off"}</button>
          <button className="btn btn-ghost !py-2" onClick={() => g.set({ touch: !g.touch })}>Touch pad: {g.touch ? "on" : "off"}</button>
          <button className="btn btn-ghost !py-2" onClick={() => g.set({ minimap: !g.minimap })}>Minimap: {g.minimap ? "on" : "off"}</button>
          <button className="btn btn-ghost !py-2" onClick={() => { g.setMenu(false); useNav.getState().setMapOpen(true); }}>🗺 World map<span className="touch:hidden">&nbsp;(M)</span></button>
          {fs.supported && <button className="btn btn-ghost !py-2" onClick={() => void fs.toggle()}>{fs.on ? "⤢ Exit full screen" : "⛶ Full screen"}<span className="touch:hidden">&nbsp;(F)</span></button>}
        </div>
        <p className="text-xs text-slate-500 touch:hidden short:hidden">W/↑ gas · S/↓ brake/reverse · A/D steer · Space handbrake · Shift nitro · C camera · R respawn · N day/night · M map & GPS · E garage (on a garage pad) · F full screen · T chat · Esc menu</p>
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1 !py-2" onClick={() => g.setMenu(false)}>Resume</button>
          <Link href="/garage" className="btn btn-ghost flex-1 !py-2 text-center">Garage</Link>
          <Link href="/dashboard" className="btn btn-ghost flex-1 !py-2 text-center">Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
