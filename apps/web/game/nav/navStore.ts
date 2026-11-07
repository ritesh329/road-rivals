import { create } from "zustand";
import { ARRIVE_RADIUS, REROUTE_DISTANCE, getCityLayout, progressOnRoute, routeBetween, type Pt, type Route, type RouteProgress } from "@road-rivals/shared";
import { view } from "../store";
import { useGarageUi } from "../garage/garageStore";

export interface Waypoint { id: string; name: string; x: number; z: number }
const KEY = "rr.waypoint.v1";

/** Where the driver is (in the 3D world) – or the spawn when the map is opened from the dashboard. */
export function origin(): Pt {
  if (view.x !== 0 || view.z !== 0) return { x: view.x, z: view.z };
  const sp = getCityLayout().spawns[0]; return { x: sp.x, z: sp.z };
}

interface NavState {
  waypoint: Waypoint | null; route: Route | null; progress: RouteProgress | null; mapOpen: boolean;
  hydrate: () => void;
  setWaypoint: (w: Waypoint) => void;
  clear: () => void;
  setMapOpen: (v: boolean) => void;
  /** called ~2×/s while driving: updates progress, re-routes when off route, detects arrival */
  update: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  waypoint: null, route: null, progress: null, mapOpen: false,
  hydrate: () => {
    try {
      const w = JSON.parse(localStorage.getItem(KEY) ?? "null") as Waypoint | null;
      if (w && Number.isFinite(w.x) && Number.isFinite(w.z)) set({ waypoint: w, route: routeBetween(origin(), w) });
    } catch { /* storage blocked */ }
  },
  setWaypoint: (w) => {
    try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ }
    const route = routeBetween(origin(), w);
    set({ waypoint: w, route, progress: progressOnRoute(route, origin().x, origin().z) });
  },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } set({ waypoint: null, route: null, progress: null }); },
  setMapOpen: (mapOpen) => set({ mapOpen }),
  update: () => {
    const { waypoint, route } = get();
    if (!waypoint) return;
    const me = origin();
    if (Math.hypot(me.x - waypoint.x, me.z - waypoint.z) < ARRIVE_RADIUS) {
      useGarageUi.getState().notify(`Arrived: ${waypoint.name}`, "good");
      get().clear(); return;
    }
    let r = route ?? routeBetween(me, waypoint);
    let p = progressOnRoute(r, me.x, me.z);
    if (p.offRoute > REROUTE_DISTANCE) { r = routeBetween(me, waypoint); p = progressOnRoute(r, me.x, me.z); }
    set({ route: r, progress: p });
  },
}));
