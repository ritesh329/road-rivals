"use client";
import MapView from "./MapView";
import { useNav } from "./navStore";

export default function MapOverlay() {
  const open = useNav((s) => s.mapOpen);
  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col bg-[#05080f]/95 text-white" style={{ paddingTop: "var(--sat)", paddingRight: "var(--sar)", paddingBottom: "var(--sab)", paddingLeft: "var(--sal)" }} data-testid="map-overlay">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 short:py-1">
        <h2 className="font-display text-lg short:text-base">WORLD <span className="text-neon">MAP</span></h2>
        <button className="btn btn-ghost !py-1 short:!min-h-8" onClick={() => useNav.getState().setMapOpen(false)}>Close (M)</button>
      </div>
      <div className="min-h-0 flex-1"><MapView /></div>
    </div>
  );
}
