import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  GARAGES, GARAGE_CAPS, HOME_CAPS, garageProximityOk,
  type GarageCaps, type GarageKindKey,
} from "@road-rivals/shared";
import { HttpError } from "../utils/errors";

type Db = Prisma.TransactionClient | Prisma.DefaultPrismaClient;

/** Fields every in-world garage request carries. Omit `garage` for the "home" garage page. */
export const garageFields = {
  garage: z.string().min(1).max(64).optional(),
  pos: z.object({ x: z.number().finite(), z: z.number().finite() }).optional(),
};

export type Feature = "repair" | "parts" | "customize";

export interface GarageContext {
  home: boolean;
  garage: { id: string; slug: string; kind: GarageKindKey } | null;
  caps: GarageCaps;
}

/**
 * Works out where a service request is happening and what is allowed there.
 *  - `garage` + `pos`: the player claims to be at that garage. The position must be within the
 *    garage radius (+ small slack) and the garage kind must offer the feature.
 *    NOTE: until the authoritative server simulation (Phase 5) the position is client-reported,
 *    so this is a plausibility gate, not an anti-cheat guarantee.
 *  - no `garage`: "home" – everything is available, repairs cost a premium.
 */
export async function resolveContext(db: Db, body: { garage?: string; pos?: { x: number; z: number } }, feature: Feature): Promise<GarageContext> {
  if (!body.garage) return { home: true, garage: null, caps: HOME_CAPS };
  const g = await db.garage.findUnique({ where: { slug: body.garage } });
  if (!g) throw new HttpError(404, "Garage not found");
  if (!body.pos) throw new HttpError(400, "Position required at a garage");
  // DB stores the pad centre; the pad radius lives in the shared city layout (same source the 3D world uses)
  const radius = GARAGES.find((x) => x.slug === g.slug)?.radius ?? 11;
  if (!garageProximityOk({ x: g.x, z: g.z, radius }, body.pos)) throw new HttpError(403, `You are too far from ${g.name}`);
  const caps = GARAGE_CAPS[g.kind as GarageKindKey];
  const ok = feature === "repair" ? caps.repairs.length > 0 : feature === "parts" ? caps.parts : caps.customize;
  if (!ok) throw new HttpError(403, `${g.name} does not offer ${feature === "parts" ? "part installs" : feature === "customize" ? "customization" : "repairs"}`);
  return { home: false, garage: { id: g.id, slug: g.slug, kind: g.kind as GarageKindKey }, caps };
}
