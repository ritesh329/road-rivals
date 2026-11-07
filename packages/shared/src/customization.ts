/**
 * ROAD RIVALS – cosmetic customization catalogue.
 *
 * Maps 1:1 onto the VehicleConfiguration columns. The server validates every id against this
 * file and computes the price itself (the client only previews it). The 3D car (CarModel.tsx)
 * renders every option as real geometry/materials.
 *
 * Customization is intentionally cosmetic. Anything that changes how the car DRIVES (spoiler
 * wings with downforce, tyres, armour…) is an upgrade *part* in catalog.ts instead; the 3D car
 * also shows those parts so the two stay visually consistent.
 */
import { z } from "zod";

export interface Option { id: string; name: string; price: number }
export interface ColorOption extends Option { color: string }

export const PAINT_PRESETS: ColorOption[] = [
  { id: "rival-red", name: "Rival Red", price: 0, color: "#e11d48" },
  { id: "neon-cyan", name: "Neon Cyan", price: 250, color: "#22d3ee" },
  { id: "midnight", name: "Midnight Black", price: 250, color: "#111827" },
  { id: "pearl", name: "Pearl White", price: 250, color: "#f1f5f9" },
  { id: "electric-blue", name: "Electric Blue", price: 300, color: "#2563eb" },
  { id: "toxic-green", name: "Toxic Green", price: 300, color: "#65a30d" },
  { id: "sunset", name: "Sunset Orange", price: 300, color: "#f97316" },
  { id: "royal-purple", name: "Royal Purple", price: 350, color: "#7c3aed" },
  { id: "gold", name: "Gold Rush", price: 500, color: "#eab308" },
  { id: "hot-pink", name: "Hot Pink", price: 350, color: "#ec4899" },
  { id: "gunmetal", name: "Gunmetal", price: 300, color: "#475569" },
  { id: "mint", name: "Mint", price: 300, color: "#2dd4bf" },
];
export const CUSTOM_PAINT_PRICE = 600;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const WHEEL_STYLES: Option[] = [
  { id: "stock", name: "Stock steel", price: 0 },
  { id: "sport5", name: "5-Spoke Sport", price: 700 },
  { id: "mesh", name: "Mesh Racing", price: 1100 },
  { id: "turbofan", name: "Turbofan", price: 1500 },
  { id: "aerodisc", name: "Aero Disc", price: 2000 },
];
export const RIM_COLORS: ColorOption[] = [
  { id: "stock", name: "Stock silver", price: 0, color: "#c7ccd4" },
  { id: "black", name: "Gloss black", price: 150, color: "#18181b" },
  { id: "gold", name: "Gold", price: 250, color: "#d4a017" },
  { id: "red", name: "Red", price: 200, color: "#dc2626" },
  { id: "blue", name: "Blue", price: 200, color: "#2563eb" },
  { id: "chrome", name: "Chrome", price: 400, color: "#f8fafc" },
];
export const SPOILER_STYLES: Option[] = [
  { id: "none", name: "Stock (none)", price: 0 },
  { id: "lip", name: "Lip", price: 350 },
  { id: "ducktail", name: "Ducktail", price: 550 },
  { id: "wing", name: "Wing", price: 900 },
  { id: "gt", name: "GT Wing", price: 1400 },
];
export const BODY_KITS: Option[] = [
  { id: "none", name: "Stock body", price: 0 },
  { id: "sport", name: "Sport skirts", price: 900 },
  { id: "wide", name: "Wide arches", price: 1800 },
  { id: "race", name: "Race aero body", price: 2800 },
];
export const BUMPERS: Option[] = [
  { id: "stock", name: "Stock", price: 0 },
  { id: "sport", name: "Sport splitter", price: 700 },
  { id: "race", name: "Race splitter + canards", price: 1500 },
];
export const DECALS: Option[] = [
  { id: "none", name: "None", price: 0 },
  { id: "stripes", name: "Racing stripes", price: 300 },
  { id: "double", name: "Twin stripes", price: 450 },
  { id: "flames", name: "Flame sides", price: 700 },
  { id: "checker", name: "Checker roof", price: 600 },
];
export const NEON_COLORS: ColorOption[] = [
  { id: "none", name: "Off", price: 0, color: "#000000" },
  { id: "cyan", name: "Cyan", price: 500, color: "#22d3ee" },
  { id: "magenta", name: "Magenta", price: 500, color: "#e879f9" },
  { id: "green", name: "Green", price: 500, color: "#4ade80" },
  { id: "amber", name: "Amber", price: 500, color: "#fbbf24" },
  { id: "white", name: "White", price: 500, color: "#ffffff" },
];
export const EXHAUSTS: Option[] = [
  { id: "stock", name: "Stock", price: 0 },
  { id: "sport", name: "Sport tip", price: 400 },
  { id: "dual", name: "Dual tips", price: 800 },
  { id: "side", name: "Side exit", price: 1200 },
];

export interface VehicleConfig {
  paint: string; wheels: string; rims: string; spoiler: string;
  bodyKit: string; bumpers: string; decal: string; neon: string | null; exhaust: string;
}
export const DEFAULT_CONFIG: VehicleConfig = {
  paint: "#e11d48", wheels: "stock", rims: "stock", spoiler: "none",
  bodyKit: "none", bumpers: "stock", decal: "none", neon: null, exhaust: "stock",
};

export type ConfigKey = keyof VehicleConfig;
export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as ConfigKey[];

const ids = (o: Option[]) => o.map((x) => x.id);
const byId = (list: Option[], id: string) => list.find((x) => x.id === id);

export const customizeSchema = z.object({
  paint: z.string().regex(HEX, "Paint must be a #rrggbb colour").optional(),
  wheels: z.enum(ids(WHEEL_STYLES) as [string, ...string[]]).optional(),
  rims: z.enum(ids(RIM_COLORS) as [string, ...string[]]).optional(),
  spoiler: z.enum(ids(SPOILER_STYLES) as [string, ...string[]]).optional(),
  bodyKit: z.enum(ids(BODY_KITS) as [string, ...string[]]).optional(),
  bumpers: z.enum(ids(BUMPERS) as [string, ...string[]]).optional(),
  decal: z.enum(ids(DECALS) as [string, ...string[]]).optional(),
  neon: z.enum(ids(NEON_COLORS) as [string, ...string[]]).nullable().optional(),
  exhaust: z.enum(ids(EXHAUSTS) as [string, ...string[]]).optional(),
}).strict();
export type CustomizeChanges = z.infer<typeof customizeSchema>;

/** Normalise a DB row (neon "none" ↔ null) so comparisons are stable. */
export function normalizeConfig(c: Partial<Record<ConfigKey, string | null>> | null | undefined): VehicleConfig {
  const m = { ...DEFAULT_CONFIG, ...(c ?? {}) } as VehicleConfig;
  if (m.neon === "none" || m.neon === "") m.neon = null;
  return m;
}

export function paintPrice(hex: string): number {
  const preset = PAINT_PRESETS.find((p) => p.color.toLowerCase() === hex.toLowerCase());
  return preset ? preset.price : CUSTOM_PAINT_PRICE;
}

const CATALOG: Record<Exclude<ConfigKey, "paint">, Option[]> = {
  wheels: WHEEL_STYLES, rims: RIM_COLORS, spoiler: SPOILER_STYLES, bodyKit: BODY_KITS,
  bumpers: BUMPERS, decal: DECALS, neon: NEON_COLORS, exhaust: EXHAUSTS,
};

export interface CustomizeQuote { cost: number; items: { key: ConfigKey; from: string | null; to: string | null; price: number }[]; next: VehicleConfig }

/** Price of moving from `current` to `current + changes`. Unchanged fields are free, reverting costs the new item's price. */
export function quoteCustomization(currentIn: Partial<Record<ConfigKey, string | null>> | null | undefined, changes: CustomizeChanges): CustomizeQuote {
  const current = normalizeConfig(currentIn);
  const next = { ...current };
  const items: CustomizeQuote["items"] = [];
  let cost = 0;
  for (const key of CONFIG_KEYS) {
    if (!(key in changes) || changes[key] === undefined) continue;
    let to = (key === "neon" ? (changes.neon === "none" ? null : changes.neon ?? null) : changes[key]) as string | null;
    let from = current[key];
    if (key === "paint") { to = (to as string).toLowerCase(); from = (from as string).toLowerCase(); }
    if (to === from) continue;
    let price = 0;
    if (key === "paint") price = paintPrice(to as string);
    else price = to === null ? 0 : (byId(CATALOG[key], to)?.price ?? 0);
    (next as Record<string, string | null>)[key] = to;
    items.push({ key, from, to, price });
    cost += price;
  }
  return { cost, items, next };
}

/** Colour lookups used by the 3D car. */
export const rimColor = (id: string) => RIM_COLORS.find((r) => r.id === id)?.color ?? RIM_COLORS[0].color;
export const neonColor = (id: string | null) => (id ? NEON_COLORS.find((n) => n.id === id)?.color ?? null : null);
