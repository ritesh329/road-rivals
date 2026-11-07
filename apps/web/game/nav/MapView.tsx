"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { GARAGES, PITCH, POI_STYLE, formatDistance, getCityLayout, getPois, routeBetween, type Poi, type PoiKind } from "@road-rivals/shared";
import { view } from "../store";
import { SEAT_COLORS, remote } from "../net/netStore";
import { origin, useNav } from "./navStore";

type Filter = "ALL" | "GARAGES" | "EVENTS" | "CHECKPOINTS" | "DRIVERS";
const FILTERS: { key: Filter; label: string; kinds: PoiKind[] }[] = [
  { key: "ALL", label: "All", kinds: ["REPAIR", "ENGINE_SHOP", "WORKSHOP", "FUEL", "RACE_EVENT", "TOURNAMENT"] },
  { key: "GARAGES", label: "Garages", kinds: ["REPAIR", "ENGINE_SHOP", "WORKSHOP", "FUEL"] },
  { key: "EVENTS", label: "Events", kinds: ["RACE_EVENT", "TOURNAMENT"] },
  { key: "CHECKPOINTS", label: "Checkpoints", kinds: ["CHECKPOINT"] },
  { key: "DRIVERS", label: "Drivers", kinds: [] },
];
interface Row { id: string; name: string; kind: PoiKind | "DRIVER"; x: number; z: number; detail: string; dist: number; color: string; icon: string }

/** Interactive world map: pan / zoom, points of interest, live drivers, road route to the chosen waypoint. */
export default function MapView() {
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const cam = useRef({ x: 0, z: 0, scale: 0.5, follow: true });
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(() => origin());
  const [drivers, setDrivers] = useState<{ id: string; name: string; x: number; z: number; seat: number }[]>([]);
  const waypoint = useNav((s) => s.waypoint), route = useNav((s) => s.route), progress = useNav((s) => s.progress);

  // refresh "where am I" + live drivers twice a second (road distances are recomputed from it)
  useEffect(() => {
    const t = setInterval(() => {
      setSnap((p) => { const o = origin(); return Math.hypot(o.x - p.x, o.z - p.z) > 15 ? o : p; });
      setDrivers([...remote.pos.entries()].map(([id, r]) => ({ id, name: r.name, x: r.x, z: r.z, seat: r.seat })));
    }, 500);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = getPois().map((p: Poi) => ({ ...p, dist: routeBetween(snap, p).length, color: POI_STYLE[p.kind].color, icon: POI_STYLE[p.kind].icon }));
    for (const d of drivers) out.push({ id: `driver:${d.id}`, name: d.name, kind: "DRIVER", x: d.x, z: d.z, detail: "Driver in your room", dist: routeBetween(snap, d).length, color: SEAT_COLORS[d.seat % 5], icon: "●" });
    return out;
  }, [snap, drivers]);
  const f = FILTERS.find((x) => x.key === filter)!;
  const list = rows.filter((r) => (filter === "DRIVERS" ? r.kind === "DRIVER" : r.kind !== "DRIVER" && f.kinds.includes(r.kind as PoiKind))).sort((a, b) => a.dist - b.dist);
  const sel = rows.find((r) => r.id === selected) ?? null;
  const nearestRepair = rows.filter((r) => r.kind === "REPAIR").sort((a, b) => a.dist - b.dist)[0];

  const go = (r: Row) => useNav.getState().setWaypoint({ id: r.id, name: r.name, x: r.x, z: r.z });

  // ---------------------------------------------------------------- drawing
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const selRef = useRef(selected); selRef.current = selected;
  useEffect(() => {
    const canvas = cv.current!, host = box.current!, g = canvas.getContext("2d")!;
    const L = getCityLayout();
    let raf = 0, w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = host.clientWidth; h = host.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (cam.current.follow && cam.current.scale === 0.5) cam.current.scale = Math.min(w, h) / 1180;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const o0 = origin(); cam.current.x = o0.x; cam.current.z = o0.z;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cam.current; const me = origin();
      if (c.follow) { c.x = me.x; c.z = me.z; }
      const S = (x: number, z: number): [number, number] => [w / 2 + (x - c.x) * c.scale, h / 2 + (z - c.z) * c.scale];
      g.fillStyle = "#070b16"; g.fillRect(0, 0, w, h);
      // ground + blocks
      g.fillStyle = "#0d1424"; { const [x, z] = S(-L.bounds, -L.bounds); g.fillRect(x, z, L.bounds * 2 * c.scale, L.bounds * 2 * c.scale); }
      for (const b of L.blocks) {
        const [x, z] = S(b.cx - 42, b.cz - 42);
        g.fillStyle = b.kind === "park" ? "#12301f" : b.kind === "parking" ? "#1c2333" : b.kind === "water" ? "#0e3a5c" : b.kind === "garage" ? "#251a33" : "#141b2d";
        g.fillRect(x, z, 84 * c.scale, 84 * c.scale);
      }
      // roads
      g.strokeStyle = "#3b4660"; g.lineWidth = Math.max(2, 16 * c.scale); g.lineCap = "butt"; g.beginPath();
      for (let k = -5; k <= 5; k++) { const [a, b2] = S(k * PITCH, -500), [a2, b3] = S(k * PITCH, 500); g.moveTo(a, b2); g.lineTo(a2, b3); const [p, q] = S(-500, k * PITCH), [p2, q2] = S(500, k * PITCH); g.moveTo(p, q); g.lineTo(p2, q2); }
      g.stroke();
      // circuit loop
      g.strokeStyle = "rgba(251,146,60,.55)"; g.lineWidth = 2; g.setLineDash([6, 6]); g.beginPath();
      L.checkpoints.forEach((cp, i) => { const [x, z] = S(cp.x, cp.z); if (i) g.lineTo(x, z); else g.moveTo(x, z); }); { const [x, z] = S(L.checkpoints[0].x, L.checkpoints[0].z); g.lineTo(x, z); } g.stroke(); g.setLineDash([]);
      // route
      const rt = useNav.getState().route;
      if (rt) {
        g.strokeStyle = "rgba(34,211,238,.35)"; g.lineWidth = Math.max(8, 20 * c.scale); g.lineJoin = "round"; g.beginPath();
        rt.points.forEach((p, i) => { const [x, z] = S(p.x, p.z); if (i) g.lineTo(x, z); else g.moveTo(x, z); }); g.stroke();
        g.strokeStyle = "#22d3ee"; g.lineWidth = 4; g.beginPath(); rt.points.forEach((p, i) => { const [x, z] = S(p.x, p.z); if (i) g.lineTo(x, z); else g.moveTo(x, z); }); g.stroke();
      }
      // points of interest
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const r of rowsRef.current) {
        const isCp = r.kind === "CHECKPOINT"; const show = filter === "CHECKPOINTS" || !isCp;
        if (!show) continue;
        const [x, z] = S(r.x, r.z);
        if (x < -20 || z < -20 || x > w + 20 || z > h + 20) continue;
        const sel = r.id === selRef.current;
        g.fillStyle = r.color; g.strokeStyle = sel ? "#fff" : "#000"; g.lineWidth = sel ? 3 : 1.5;
        g.beginPath(); g.arc(x, z, r.kind === "DRIVER" ? 7 : isCp ? 5 : 11, 0, 7); g.fill(); g.stroke();
        if (!isCp && r.kind !== "DRIVER") { g.font = "12px sans-serif"; g.fillStyle = "#000"; g.fillText(r.icon, x, z + 1); }
        if (c.scale > 0.35 && !isCp) { g.font = "11px sans-serif"; g.fillStyle = "#e2e8f0"; g.fillText(r.name, x, z + 22); }
      }
      // waypoint flag
      const wp = useNav.getState().waypoint;
      if (wp) { const [x, z] = S(wp.x, wp.z); g.fillStyle = "#22d3ee"; g.font = "22px sans-serif"; g.fillText("📍", x, z - 10); }
      // me
      { const [x, z] = S(me.x, me.z); g.save(); g.translate(x, z); g.rotate(-view.yaw + Math.PI); g.fillStyle = "#fff"; g.strokeStyle = "#f43f5e"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    };
    raf = requestAnimationFrame(draw);

    // pan (drag), zoom (wheel / pinch), select (click)
    const pts = new Map<number, { x: number; y: number }>(); let moved = 0, pinch = 0;
    const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; pinch = 0; };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const c = cam.current;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...pts.values()]; const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (d0 > 0) c.scale = Math.max(0.12, Math.min(3, c.scale * (d1 / d0))); c.follow = false; moved += 10; return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) { c.x -= dx / c.scale; c.z -= dy / c.scale; c.follow = false; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (moved > 6) return;
      const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, c = cam.current;
      let best: Row | null = null, bd = 18;
      for (const row of rowsRef.current) {
        if (row.kind === "CHECKPOINT" && filter !== "CHECKPOINTS") continue;
        const d = Math.hypot(w / 2 + (row.x - c.x) * c.scale - px, h / 2 + (row.z - c.z) * c.scale - py);
        if (d < bd) { bd = d; best = row; }
      }
      setSelected(best?.id ?? null);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const c = cam.current; c.scale = Math.max(0.12, Math.min(3, c.scale * (e.deltaY < 0 ? 1.12 : 0.89))); c.follow = false; };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up); canvas.addEventListener("wheel", wheel, { passive: false });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); canvas.removeEventListener("wheel", wheel); };
  }, [filter]);

  const zoom = (k: number) => { cam.current.scale = Math.max(0.12, Math.min(3, cam.current.scale * k)); cam.current.follow = false; };
  const recenter = () => { cam.current.follow = true; };
  const focus = (r: Row) => { setSelected(r.id); cam.current.follow = false; cam.current.x = r.x; cam.current.z = r.z; };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row short:flex-row" data-testid="map-view">
      <div ref={box} className="relative min-h-[45dvh] flex-1 touch-none short:min-h-0">
        <canvas ref={cv} className="absolute inset-0 cursor-grab" data-testid="map-canvas" />
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button className="btn btn-ghost !px-3 !py-1" onClick={() => zoom(1.25)} aria-label="Zoom in">＋</button>
          <button className="btn btn-ghost !px-3 !py-1" onClick={() => zoom(0.8)} aria-label="Zoom out">－</button>
          <button className="btn btn-ghost !px-3 !py-1" onClick={recenter} aria-label="Centre on me">⌖</button>
        </div>
        {waypoint && progress && (
          <div className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-3 py-2 text-sm backdrop-blur" data-testid="map-route">
            📍 <b>{waypoint.name}</b> · {formatDistance(progress.remaining)} by road
            <button className="ml-3 text-xs text-slate-400 underline" onClick={() => useNav.getState().clear()}>Clear</button>
          </div>
        )}
      </div>
      <aside className="flex max-h-[45dvh] w-full flex-col gap-2 overflow-hidden border-t border-white/10 bg-black/40 p-3 md:max-h-none md:w-80 md:border-l md:border-t-0 short:max-h-none short:w-64 short:border-l short:border-t-0 short:p-2">
        <div className="flex flex-wrap gap-1">{FILTERS.map((x) => <button key={x.key} onClick={() => setFilter(x.key)} data-testid={`filter-${x.key}`} className={`rounded-full px-3 py-1 text-xs ${filter === x.key ? "bg-neon text-black" : "bg-white/10 text-slate-200"}`}>{x.label}</button>)}</div>
        {nearestRepair && <button data-testid="nearest-repair" className="btn btn-primary !py-2 text-sm" onClick={() => { go(nearestRepair); focus(nearestRepair); }}>🔧 Nearest repair garage · {formatDistance(nearestRepair.dist)}</button>}
        {sel && (
          <div className="rounded-lg border border-white/15 bg-white/5 p-2 text-sm" data-testid="poi-detail">
            <p className="font-display">{sel.icon} {sel.name}</p>
            <p className="text-xs text-slate-300">{sel.kind === "DRIVER" ? "Driver" : POI_STYLE[sel.kind as PoiKind].label} · {formatDistance(sel.dist)} by road</p>
            <p className="mt-1 text-xs text-slate-400">{sel.detail}</p>
            <button data-testid="set-waypoint" className="btn btn-primary mt-2 w-full !py-1.5 text-sm" onClick={() => go(sel)}>Set waypoint</button>
          </div>
        )}
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" data-testid="poi-list">
          {list.map((r) => (
            <li key={r.id}>
              <button onClick={() => focus(r)} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${selected === r.id ? "bg-white/15" : "bg-white/5 hover:bg-white/10"}`}>
                <span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} /><span className="truncate">{r.name}</span></span>
                <span className="ml-2 shrink-0 text-xs tabular-nums text-slate-400">{formatDistance(r.dist)}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-2 text-xs text-slate-500">{filter === "DRIVERS" ? "No other drivers in your session." : "Nothing here."}</li>}
        </ul>
        <p className="text-[10px] text-slate-500 short:hidden">Drag to pan · wheel / pinch to zoom · tap a pin to select. Distances follow the road network. {GARAGES.length} garages on the map.</p>
      </aside>
    </div>
  );
}
