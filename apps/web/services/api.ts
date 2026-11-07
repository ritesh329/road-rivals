import type { HealthMap, VehicleConfig, GarageCaps } from "@road-rivals/shared";

export class ApiError extends Error { constructor(public status: number, message: string, public data: Record<string, any> = {}) { super(message); } }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed", data);
  return data as T;
}
export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Unique per user action; the server uses it to make purchases idempotent (double-click safe). */
export const newRequestId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

export interface Me {
  id: string; username: string; email: string; coins: number; vehicleCount: number;
  profile: { level: number; xp: number; xpToNext: number; tier: string; racesPlayed: number; racesWon: number };
  activeVehicle: null | {
    id: string; vehicleId: string;
    vehicle: { name: string; category: string; price: number; baseStats: Record<string, number> };
    damage: { component: string; health: number }[];
    configuration: null | Partial<VehicleConfig>;
    upgrades: { slot: string; part: { slug: string; type: string; tier: number; physicsModifiers: Record<string, number> } }[];
  };
}

export interface GarageVehicle {
  ownershipId: string; vehicleId: string; slug: string; name: string; category: string; price: number;
  baseStats: Record<string, number>; active: boolean; config: VehicleConfig;
  upgrades: { slot: string; partSlug: string; name: string; tier: number; physicsModifiers: Record<string, number> }[];
  damage: HealthMap;
}
export interface GarageInfo {
  slug: string; name: string; kind: "REPAIR" | "ENGINE_SHOP" | "WORKSHOP" | "FUEL"; x: number; z: number;
  caps: GarageCaps; services: { code: string; name: string; basePrice: number }[];
}
export interface GarageOverview {
  coins: number; level: number; activeOwnershipId: string | null; vehicles: GarageVehicle[]; garages: GarageInfo[]; home: { caps: GarageCaps };
}
export interface PartRow {
  slug: string; type: string; tier: number; name: string; price: number; requiredLevel: number;
  physicsModifiers: Record<string, number>; compatibleCategories: string[]; blurb: string; owned: number;
}

export interface RoomMember { userId: string; username: string; level: number; ready: boolean; isHost: boolean; online: boolean }
export interface RoomView {
  code: string; inviteToken: string; hostId: string; visibility: "PUBLIC" | "PRIVATE"; status: "LOBBY" | "STARTING" | "RACING" | "FINISHED" | "CLOSED";
  locked: boolean; maxPlayers: number; mode: string; mapId: string; members: RoomMember[];
}
export interface PublicRoom { code: string; host: string; players: number; maxPlayers: number; status: string; locked: boolean; joinable: boolean }
export interface InvitePreview { host: string; players: number; maxPlayers: number; status: string; joinable: boolean; reason: string | null }

export interface MissionRow { code: string; title: string; description: string; period: "DAILY" | "WEEKLY"; target: number; progress: number; rewardCoins: number; rewardXp: number; completed: boolean; claimed: boolean }
export interface MissionsView { daily: MissionRow[]; weekly: MissionRow[]; resets: { daily: string; weekly: string } }

export interface ShowroomCar {
  slug: string; name: string; category: string; price: number; requiredLevel: number; baseStats: Record<string, number>;
  owned: boolean; ownershipId: string | null; active: boolean; locked: boolean; affordable: boolean; canBuy: boolean; reason: string | null;
}
export interface ShowroomView { coins: number; level: number; categories: string[]; activeOwnershipId: string | null; vehicles: ShowroomCar[] }
export interface BoardRow { rank: number; userId: string; username: string; avatar: string; tier: string; value: number; extra: string }
export interface LeaderboardView { board: "season" | "wins" | "level"; season: { name: string; endsAt: string } | null; top: BoardRow[]; me: { rank: number | null; value: number; extra: string } | null }
export interface ProfileView {
  id: string; username: string; avatar: string; level: number; xp: number; xpToNext: number; tier: string; nextTier: { tier: string; level: number } | null; coins: number;
  stats: { racesPlayed: number; racesWon: number; winRate: number; distanceKm: number; vehiclesOwned: number };
  season: { name: string; rank: number | null; points: number; wins: number } | null;
  achievements: { code: string; title: string; description: string; category: string; rewardCoins: number; rewardXp: number; value: number; target: number; unlockedAt: string | null }[];
}
export interface LedgerEntry { id: string; type: string; amount: number; balanceAfter: number; at: string }
