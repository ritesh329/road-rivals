"use client";
import { useEffect, useRef, useState } from "react";
import { getCityLayout, getPois, POI_STYLE } from "@road-rivals/shared";
import { useNav } from "../nav/navStore";
import { useRace } from "../race/raceStore";
import { useGame, view } from "../store";
import { SEAT_COLORS, remote } from "../net/netStore";

const RANGE = 260; // metres from centre to edge
const sizeFor = () => (typeof window !== "undefined" && window.innerHeight <= 520 ? 108 : 168);
const POIS = getPois().filter((p) => p.kind !== "CHECKPOINT");

export default function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [SIZE, setSize] = useState(sizeFor);
  useEffect(() => { const h = () => setSize(sizeFor()); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  useEffect(() => {
    const cv = ref.current!, g = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = SIZE * dpr; cv.height = SIZE * dpr; g.scale(dpr, dpr);
    const L = getCityLayout();
    let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 50) return; last = t;
      const sc = SIZE / 2 / RANGE;
      g.clearRect(0, 0, SIZE, SIZE);
      g.save();
      g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); g.clip();
      g.fillStyle = "rgba(8,12,24,0.82)"; g.fillRect(0, 0, SIZE, SIZE);
      // heading-up: rotate so car's forward points to screen up
      g.translate(SIZE / 2, SIZE / 2); g.rotate(view.yaw - Math.PI);
      const X = (x: number) => (x - view.x) * sc, Z = (z: number) => (z - view.z) * sc;
      // water
      g.fillStyle = "rgba(28,93,143,0.7)"; g.fillRect(X(L.water.cx - L.water.w / 2), Z(L.water.cz - L.water.d / 2), L.water.w * sc, L.water.d * sc);
      // roads
      g.strokeStyle = "#475569"; g.lineWidth = Math.max(1.5, 16 * sc);
      g.beginPath();
      for (let k = -5; k <= 5; k++) {
        g.moveTo(X(k * 100), Z(-500)); g.lineTo(X(k * 100), Z(500));
        g.moveTo(X(-500), Z(k * 100)); g.lineTo(X(500), Z(k * 100));
      }
      g.stroke();
      // GPS route (follows the roads)
      const rt = useNav.getState().route;
      if (rt) {
        g.strokeStyle = "#22d3ee"; g.lineWidth = 3; g.lineJoin = "round"; g.beginPath();
        rt.points.forEach((p, i) => { if (i) g.lineTo(X(p.x), Z(p.z)); else g.moveTo(X(p.x), Z(p.z)); }); g.stroke();
      }
      // garages, events, tournament venue
      for (const p of POIS) { g.fillStyle = POI_STYLE[p.kind].color; g.beginPath(); g.arc(X(p.x), Z(p.z), 4, 0, 7); g.fill(); }
      // waypoint (clamped to the edge of the minimap when far away)
      const wp = useNav.getState().waypoint;
      if (wp) { let wx = X(wp.x), wz = Z(wp.z); const d = Math.hypot(wx, wz), lim = SIZE / 2 - 8; if (d > lim) { wx *= lim / d; wz *= lim / d; } g.fillStyle = "#22d3ee"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(wx, wz, 6, 0, 7); g.fill(); g.stroke(); }
      // other players
      for (const r of remote.pos.values()) { g.fillStyle = SEAT_COLORS[r.seat % SEAT_COLORS.length]; g.strokeStyle = "#000"; g.lineWidth = 1; g.beginPath(); g.arc(X(r.x), Z(r.z), 4.5, 0, 7); g.fill(); g.stroke(); }
      // next checkpoint
      const rs = useRace.getState();
      const racing = rs.phase === "countdown" || rs.phase === "running";
      if (!(racing && rs.info?.kind === "drift")) {
        const idx = racing ? rs.nextGate : useGame.getState().circuit.next;
        const cp = L.checkpoints[idx % L.checkpoints.length];
        g.fillStyle = racing ? "#fb923c" : "#22d3ee"; g.fillRect(X(cp.x) - 5, Z(cp.z) - 5, 10, 10);
      }
      g.restore();
      // player arrow (always up)
      g.fillStyle = "#fff"; g.strokeStyle = "#f43f5e"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(SIZE / 2, SIZE / 2 - 8); g.lineTo(SIZE / 2 + 6, SIZE / 2 + 7); g.lineTo(SIZE / 2, SIZE / 2 + 3); g.lineTo(SIZE / 2 - 6, SIZE / 2 + 7); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = "rgba(34,211,238,0.6)"; g.lineWidth = 2; g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); g.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [SIZE]);
  return <canvas ref={ref} style={{ width: SIZE, height: SIZE }} className="pointer-events-none absolute left-2 top-2 rounded-full shadow-lg" />;
}
