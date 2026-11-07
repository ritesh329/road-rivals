/**
 * ROAD RIVALS – world-map points of interest (pure data; server, minimap and the map page share it).
 */
import { GARAGES, getCityLayout } from "./world";
import { RACE_TUNING } from "./race";

export type PoiKind = "REPAIR" | "ENGINE_SHOP" | "WORKSHOP" | "FUEL" | "RACE_EVENT" | "TOURNAMENT" | "CHECKPOINT";
export interface Poi { id: string; kind: PoiKind; name: string; x: number; z: number; detail: string }

export const POI_STYLE: Record<PoiKind, { color: string; label: string; icon: string }> = {
  REPAIR: { color: "#f43f5e", label: "Repair garage", icon: "🔧" },
  ENGINE_SHOP: { color: "#22d3ee", label: "Engine upgrade shop", icon: "⚙️" },
  WORKSHOP: { color: "#a78bfa", label: "Modification workshop", icon: "🎨" },
  FUEL: { color: "#facc15", label: "Fuel station", icon: "⛽" },
  RACE_EVENT: { color: "#fb923c", label: "Racing event", icon: "🏁" },
  TOURNAMENT: { color: "#f472b6", label: "Tournament venue", icon: "🏆" },
  CHECKPOINT: { color: "#38bdf8", label: "Circuit checkpoint", icon: "◎" },
};

const GARAGE_DETAIL: Record<string, string> = {
  REPAIR: "Quick / full / engine / tyre / body repairs",
  ENGINE_SHOP: "Buy and install engines & performance parts",
  WORKSHOP: "Paint, wheels, spoilers, body kits, neon",
  FUEL: "Fuel stop with emergency roadside repair",
};

let cache: Poi[] | null = null;
/** Static points of interest (friends are dynamic and come from the live session). */
export function getPois(): Poi[] {
  if (cache) return cache;
  const L = getCityLayout();
  const start = L.checkpoints[RACE_TUNING.startCp];
  const pois: Poi[] = [
    ...GARAGES.map((g): Poi => ({ id: `garage:${g.slug}`, kind: g.kind, name: g.name, x: g.x, z: g.z, detail: GARAGE_DETAIL[g.kind] ?? "" })),
    { id: "event:start-line", kind: "RACE_EVENT", name: "Neon Circuit – start line", x: start.x, z: start.z, detail: "Races start and finish here (grid behind the gate)" },
    { id: "event:drift-pad", kind: "RACE_EVENT", name: "Drift Pad", x: 150, z: 150, detail: "Open parking lot – ideal for the Drift Challenge" },
    { id: "tournament:arena", kind: "TOURNAMENT", name: "Grand Arena", x: 0, z: 0, detail: "Host of the weekend tournaments" },
    ...L.checkpoints.map((c): Poi => ({ id: `cp:${c.index}`, kind: "CHECKPOINT", name: `Checkpoint ${c.index}`, x: c.x, z: c.z, detail: c.index === RACE_TUNING.startCp ? "Start / finish gate" : "Circuit gate" })),
  ];
  cache = pois;
  return pois;
}
export const poiById = (id: string) => getPois().find((p) => p.id === id) ?? null;
