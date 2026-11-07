/**
 * ROAD RIVALS – "Neon City" map layout (pure data, deterministic).
 *
 * The client renders and builds Rapier colliders from this; the server will
 * import the same layout in Phase 5 to validate checkpoints / garage proximity.
 *
 * Coordinates: x east, z south, y up. Road centre-lines sit on multiples of 100
 * from -500..500 (11 × 11 grid). A canal runs east-west across block row j=3.
 */

export const PITCH = 100;
export const ROAD_W = 16;
export const BLOCK_HALF = (PITCH - ROAD_W) / 2; // 42
export const GRID_MIN = -5;
export const GRID_MAX = 5; // road lines
export const WORLD_HALF = 640;

export type Mat =
  | "ground" | "asphalt" | "sidewalk" | "grass" | "concrete" | "rail" | "ramp"
  | "tunnel" | "wall" | "garage" | "hidden" | "canal";

export interface StaticBox {
  x: number; y: number; z: number;       // centre
  hx: number; hy: number; hz: number;    // half extents
  rx?: number; ry?: number; rz?: number; // Euler XYZ (radians); ramps use one axis
  mat: Mat;
}
export interface Building { x: number; z: number; w: number; d: number; h: number; color: number }
export interface RoadSeg { x: number; z: number; len: number; dir: "x" | "z"; bridge?: boolean }
export interface Garage {
  slug: string; name: string; kind: "REPAIR" | "ENGINE_SHOP" | "WORKSHOP" | "FUEL";
  x: number; y: number; z: number; radius: number;
}
export interface Checkpoint { x: number; z: number; yaw: number; index: number }
export interface Marking { x: number; z: number; w: number; d: number }
export interface Tree { x: number; z: number; s: number }
export interface SpawnPoint { x: number; y: number; z: number; yaw: number }

type BlockKind = "buildings" | "park" | "parking" | "garage" | "water";
export interface Block { i: number; j: number; cx: number; cz: number; kind: BlockKind }

/* -------------------------------------------------------------- seeded rng */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ layout */
const PARKS = new Set(["-1,1", "2,-3", "-4,-1", "3,2", "-3,0"]);
const PARKING = new Set(["1,1", "-3,-3", "3,-1", "0,-2", "-2,2"]);
const WATER_ROW = 3;

/** Garage pads. `facing` = +1 pad on the south edge of its block, -1 north edge. */
const GARAGE_DEFS = [
  { slug: "downtown-repair", name: "Downtown Repair", kind: "REPAIR", i: 1, j: -1, facing: 1 },
  { slug: "harbor-engines", name: "Harbor Engine Works", kind: "ENGINE_SHOP", i: -4, j: 2, facing: -1 },
  { slug: "north-workshop", name: "North Mod Workshop", kind: "WORKSHOP", i: -1, j: -4, facing: 1 },
  { slug: "east-fuel", name: "East Fuel Stop", kind: "FUEL", i: 4, j: 0, facing: 1 },
  { slug: "west-repair", name: "West Side Repair", kind: "REPAIR", i: -5, j: 0, facing: -1 },
] as const;

const cxOf = (i: number) => i * PITCH + PITCH / 2;
const key = (i: number, j: number) => `${i},${j}`;

function blockKind(i: number, j: number): BlockKind {
  if (j === WATER_ROW) return "water";
  if (GARAGE_DEFS.some((g) => g.i === i && g.j === j)) return "garage";
  if (PARKS.has(key(i, j))) return "park";
  if (PARKING.has(key(i, j))) return "parking";
  return "buildings";
}

export const GARAGES: Garage[] = GARAGE_DEFS.map((g) => ({
  slug: g.slug, name: g.name, kind: g.kind,
  x: cxOf(g.i), y: 0, z: cxOf(g.j) + g.facing * (BLOCK_HALF - 8), radius: 11,
}));

function rampBox(
  sx: number, sz: number, dir: "+x" | "-x" | "+z" | "-z", len: number, width: number, rise: number, mat: Mat = "ramp",
): StaticBox {
  const ang = Math.atan2(rise, len);
  const hl = Math.hypot(len, rise) / 2;
  const t = 0.4;
  const mid = len / 2;
  const cy = rise / 2 - t * Math.cos(ang);
  switch (dir) {
    case "+x": return { x: sx + mid, y: cy, z: sz, hx: hl, hy: t, hz: width / 2, rz: ang, mat };
    case "-x": return { x: sx - mid, y: cy, z: sz, hx: hl, hy: t, hz: width / 2, rz: -ang, mat };
    case "+z": return { x: sx, y: cy, z: sz + mid, hx: width / 2, hy: t, hz: hl, rx: -ang, mat };
    case "-z": return { x: sx, y: cy, z: sz - mid, hx: width / 2, hy: t, hz: hl, rx: ang, mat };
  }
}

export interface CityLayout {
  blocks: Block[];
  roadSegs: RoadSeg[];
  intersections: { x: number; z: number }[];
  buildings: Building[];
  statics: StaticBox[];
  markings: Marking[];
  trees: Tree[];
  lamps: { x: number; z: number }[];
  tunnelLights: { x: number; y: number; z: number }[];
  checkpoints: Checkpoint[];
  spawns: SpawnPoint[];
  water: { cx: number; cz: number; w: number; d: number };
  bounds: number;
}

let cached: CityLayout | null = null;

export function getCityLayout(): CityLayout {
  if (cached) return cached;
  const rng = mulberry32(20240611);
  const blocks: Block[] = [];
  const roadSegs: RoadSeg[] = [];
  const intersections: { x: number; z: number }[] = [];
  const buildings: Building[] = [];
  const statics: StaticBox[] = [];
  const markings: Marking[] = [];
  const trees: Tree[] = [];
  const lamps: { x: number; z: number }[] = [];
  const tunnelLights: { x: number; y: number; z: number }[] = [];

  // ---- intersections & road segments
  for (let a = GRID_MIN; a <= GRID_MAX; a++) {
    for (let b = GRID_MIN; b <= GRID_MAX; b++) {
      intersections.push({ x: a * PITCH, z: b * PITCH });
      lamps.push({ x: a * PITCH + 10, z: b * PITCH + 10 }, { x: a * PITCH - 10, z: b * PITCH - 10 });
      if (a < GRID_MAX) roadSegs.push({ x: a * PITCH + PITCH / 2, z: b * PITCH, len: BLOCK_HALF * 2, dir: "x" });
      if (b < GRID_MAX) {
        const mid = b * PITCH + PITCH / 2;
        roadSegs.push({ x: a * PITCH, z: mid, len: BLOCK_HALF * 2, dir: "z", bridge: b === WATER_ROW });
      }
    }
  }

  // ---- ground slabs (canal hole between z=308 and z=392) + canal floor
  const canalZ0 = WATER_ROW * PITCH + ROAD_W / 2;
  const canalZ1 = (WATER_ROW + 1) * PITCH - ROAD_W / 2;
  const H = WORLD_HALF + 60;
  statics.push(
    { x: 0, y: -0.5, z: (-H + canalZ0) / 2, hx: H, hy: 0.5, hz: (canalZ0 + H) / 2, mat: "ground" },
    { x: 0, y: -0.5, z: (canalZ1 + H) / 2, hx: H, hy: 0.5, hz: (H - canalZ1) / 2, mat: "ground" },
    { x: 0, y: -8.5, z: (canalZ0 + canalZ1) / 2, hx: H, hy: 0.5, hz: (canalZ1 - canalZ0) / 2, mat: "canal" },
  );

  // ---- perimeter walls (visible concrete barrier)
  const W = WORLD_HALF;
  statics.push(
    { x: 0, y: 3, z: -W, hx: W, hy: 3, hz: 1, mat: "wall" },
    { x: 0, y: 3, z: W, hx: W, hy: 3, hz: 1, mat: "wall" },
    { x: -W, y: 3, z: 0, hx: 1, hy: 3, hz: W, mat: "wall" },
    { x: W, y: 3, z: 0, hx: 1, hy: 3, hz: W, mat: "wall" },
  );

  // ---- blocks
  for (let i = GRID_MIN; i < GRID_MAX; i++) {
    for (let j = GRID_MIN; j < GRID_MAX; j++) {
      const kind = blockKind(i, j);
      const cx = cxOf(i), cz = cxOf(j);
      blocks.push({ i, j, cx, cz, kind });
      if (kind === "water") continue;

      const slabMat: Mat = kind === "park" ? "grass" : kind === "parking" ? "asphalt" : "sidewalk";
      const slabH = kind === "park" ? 0.05 : kind === "parking" ? 0.03 : 0.2;
      // Parking lots are flush with the road (drive straight in); sidewalks have a curb.
      statics.push({ x: cx, y: slabH / 2, z: cz, hx: BLOCK_HALF, hy: slabH / 2, hz: BLOCK_HALF, mat: slabMat });

      if (kind === "buildings") {
        const centreBoost = Math.max(0, 1 - Math.hypot(cx, cz) / 520);
        const tower = rng() < 0.18;
        if (tower) {
          const h = 60 + centreBoost * 90 + rng() * 30;
          buildings.push({ x: cx, z: cz, w: 56 + rng() * 10, d: 56 + rng() * 10, h, color: pickColor(rng) });
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            if (rng() < 0.08) continue; // gaps / small plazas
            const w = 26 + rng() * 8, d = 26 + rng() * 8;
            const h = 12 + rng() * 30 + centreBoost * rng() * 60;
            buildings.push({ x: cx + sx * 20, z: cz + sz * 20, w, d, h, color: pickColor(rng) });
          }
        }
      } else if (kind === "park") {
        for (let t = 0; t < 26; t++) {
          const tx = cx + (rng() * 2 - 1) * 38, tz = cz + (rng() * 2 - 1) * 38;
          // keep a driveable shortcut lane across the middle (|z-cz|<6) and a jump pad area free
          if (Math.abs(tz - cz) < 7 || Math.hypot(tx - cx, tz - cz) < 9) continue;
          trees.push({ x: tx, z: tz, s: 0.8 + rng() * 0.8 });
          statics.push({ x: tx, y: 1.5, z: tz, hx: 0.35, hy: 1.5, hz: 0.35, mat: "hidden" });
        }
        // shortcut jump ramp in the middle of the park
        statics.push(rampBox(cx - 14, cz, "+x", 12, 7, 1.8));
      } else if (kind === "parking") {
        for (let r = -2; r <= 2; r++) for (const side of [-1, 1]) for (let s = 0; s < 7; s++) {
          markings.push({ x: cx + r * 16, z: cz + side * (8 + s * 4.5), w: 0.25, d: 4 });
        }
        // a small test ramp for jumps
        statics.push(rampBox(cx - 10, cz, "+x", 14, 8, 2.4));
      }
    }
  }

  // ---- garages (building at the back of the block, pad toward the road)
  for (const g of GARAGE_DEFS) {
    const cx = cxOf(g.i), cz = cxOf(g.j);
    const bz = cz - g.facing * 16;
    const gw = 38, gd = 20, gh = 9;
    buildings.push({ x: cx, z: bz, w: gw, d: gd, h: gh, color: 0x1f2937 });
    statics.push({ x: cx, y: gh / 2, z: bz, hx: gw / 2, hy: gh / 2, hz: gd / 2, mat: "hidden" });
    // painted service pad
    const padZ = cz + g.facing * (BLOCK_HALF - 8);
    markings.push({ x: cx, z: padZ, w: 22, d: 0.3 }, { x: cx, z: padZ - 7, w: 22, d: 0.3 }, { x: cx, z: padZ + 7, w: 22, d: 0.3 });
  }

  // ---- bridges over the canal (decks + rails). Decks are flush with the road.
  for (let a = GRID_MIN; a <= GRID_MAX; a++) {
    const x = a * PITCH, z = (canalZ0 + canalZ1) / 2, hz = (canalZ1 - canalZ0) / 2;
    statics.push({ x, y: -0.35, z, hx: ROAD_W / 2, hy: 0.35, hz, mat: "concrete" });
    for (const side of [-1, 1]) {
      statics.push({ x: x + side * (ROAD_W / 2 - 0.3), y: 0.6, z, hx: 0.3, hy: 0.6, hz, mat: "rail" });
    }
  }

  // ---- tunnel on the east-west street z=-200 between x=-192 and -108
  {
    const tz = -200, tx = -150, hl = BLOCK_HALF;
    for (const side of [-1, 1]) {
      statics.push({ x: tx, y: 3.25, z: tz + side * (ROAD_W / 2 + 0.6), hx: hl, hy: 3.25, hz: 0.6, mat: "tunnel" });
    }
    statics.push({ x: tx, y: 6.75, z: tz, hx: hl, hy: 0.75, hz: ROAD_W / 2 + 1.2, mat: "tunnel" });
    for (let k = -4; k <= 4; k++) tunnelLights.push({ x: tx + k * 9, y: 5.9, z: tz });
  }

  // ---- highway jump (north ring road) and a mid-city flyover ramp pair
  statics.push(rampBox(180, -500, "+x", 22, 9, 3.2));
  statics.push(rampBox(-420, -500, "-x", 22, 9, 3.2));
  // a kerb-side stunt ramp on the central avenue
  statics.push(rampBox(0, 40, "+z", 18, 9, 2.6));

  // ---- barriers along the outer ring road (north & east edges) = road boundaries
  for (const side of [-1]) {
    statics.push({ x: 0, y: 0.6, z: -500 + side * (ROAD_W / 2 + 0.4) - 0, hx: 520, hy: 0.6, hz: 0.4, mat: "rail" });
  }

  // ---- circuit checkpoints (clockwise loop: tunnel street → east → bridge → west bridge)
  const loop: [number, number][] = [
    [-200, -200], [0, -200], [200, -200], [200, 0], [200, 200], [200, 500],
    [0, 500], [-200, 500], [-200, 300], [-200, 100], [-200, -100],
  ];
  const checkpoints: Checkpoint[] = loop.map(([x, z], index) => {
    const [nx, nz] = loop[(index + 1) % loop.length];
    return { x, z, yaw: Math.atan2(nx - x, nz - z), index };
  });

  const spawns: SpawnPoint[] = [0, 1, 2, 3, 4].map((n) => ({
    x: -30 - Math.floor(n / 2) * 12, y: 1, z: (n % 2 === 0 ? -3.2 : 3.2), yaw: Math.PI / 2,
  }));

  cached = {
    blocks, roadSegs, intersections, buildings, statics, markings, trees, lamps, tunnelLights,
    checkpoints, spawns,
    water: { cx: 0, cz: (canalZ0 + canalZ1) / 2, w: H * 2, d: canalZ1 - canalZ0 },
    bounds: W,
  };
  return cached;
}

function pickColor(rng: () => number) {
  const palette = [0x6b7a96, 0x8a93a3, 0x5f7089, 0x8b8798, 0x9a8f80, 0x74839c, 0xa0a8b5, 0x66789a];
  return palette[Math.floor(rng() * palette.length)];
}

/* -------------------------------------------------------------- checkpoints */

/** True when the segment prev→next crosses the checkpoint gate plane within ±halfWidth. */
export function crossedCheckpoint(
  px: number, pz: number, nx: number, nz: number, cp: Checkpoint, halfWidth = 11,
): boolean {
  const fx = Math.sin(cp.yaw), fz = Math.cos(cp.yaw);      // travel direction
  const rx = fz, rz = -fx;                                  // lateral
  const d0 = (px - cp.x) * fx + (pz - cp.z) * fz;
  const d1 = (nx - cp.x) * fx + (nz - cp.z) * fz;
  if (d0 > 0 || d1 < 0) return false;                       // must go from behind to in front
  const t = d0 === d1 ? 0 : d0 / (d0 - d1);
  const ix = px + (nx - px) * t, iz = pz + (nz - pz) * t;
  const lat = (ix - cp.x) * rx + (iz - cp.z) * rz;
  return Math.abs(lat) <= halfWidth;
}
