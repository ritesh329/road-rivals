import { create } from "zustand";
import { SnapshotBuffer, type NetPlayer } from "@road-rivals/shared";

export interface ChatMsg { id: string; userId: string; username: string; text: string; at: number }

interface NetStore {
  active: boolean;                 // this /game session is a multiplayer room
  roomCode: string | null;
  ready: boolean;                  // joined the shared world (seat + spawn known)
  error: string | null;
  connected: boolean;
  selfId: string | null;
  seat: number;
  spawn: { x: number; y: number; z: number; yaw: number } | null;
  players: Record<string, NetPlayer>;   // remote players only
  chat: ChatMsg[];
  correct: { x: number; y: number; z: number; yaw?: number } | null; // server snapped us back (anti-teleport)
  reset: () => void;
}

const initial = { active: false, roomCode: null, ready: false, error: null, connected: false, selfId: null, seat: 0, spawn: null, players: {}, chat: [], correct: null };
export const useNet = create<NetStore>((set) => ({ ...initial, reset: () => set({ ...initial }) }));

/** Mutable, non-React data used every frame (no re-renders). */
export const remote = {
  buffers: new Map<string, SnapshotBuffer>(),
  /** serverTime → local clock offset (ms), smoothed */
  offset: null as number | null,
  /** latest interpolated ground position of every remote car, for the minimap */
  pos: new Map<string, { x: number; z: number; yaw: number; name: string; speed: number; seat: number }>(),
};
export const SEAT_COLORS = ["#f43f5e", "#22d3ee", "#facc15", "#a78bfa", "#4ade80"];
