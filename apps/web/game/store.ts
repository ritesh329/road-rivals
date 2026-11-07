import { create } from "zustand";

export type Quality = "low" | "medium" | "high";
export type CameraMode = "chase" | "hood" | "first";
export const CAMERA_ORDER: CameraMode[] = ["chase", "hood", "first"];

interface Settings { quality: Quality; night: boolean; camera: CameraMode; sound: boolean; touch: boolean; minimap: boolean }
const KEY = "rr.settings.v2";
const defaults: Settings = { quality: "medium", night: false, camera: "chase", sound: true, touch: false, minimap: true };

function load(): Settings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return defaults; }
}
function save(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export interface Hud {
  speedKmh: number; rpm: number; redline: number; gear: number; nitro: number; boost: number;
  drifting: boolean; limiter: boolean; shifting: boolean; temp: number;
}
export interface Circuit {
  running: boolean; next: number; lap: number; lapMs: number; lastMs: number | null; bestMs: number | null; message: string;
}

interface GameState extends Settings {
  hydrated: boolean;
  hydrate: () => void;
  set: (p: Partial<Settings>) => void;
  cycleCamera: () => void;
  hud: Hud;
  setHud: (h: Hud) => void;
  circuit: Circuit;
  setCircuit: (c: Partial<Circuit>) => void;
  nearGarage: string | null;
  setNearGarage: (n: string | null) => void;
  menuOpen: boolean;
  setMenu: (v: boolean) => void;
}

export const useGame = create<GameState>((set, get) => ({
  ...defaults,
  hydrated: false,
  hydrate: () => {
    const s = load();
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    // first visit on a phone/tablet: start at the sharpest picture (menu can lower it)
    const first = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === null;
    set({ ...s, quality: first && coarse ? "high" : s.quality, touch: s.touch || !!coarse, hydrated: true });
  },
  set: (p) => { set(p); const { quality, night, camera, sound, touch, minimap } = get(); save({ quality, night, camera, sound, touch, minimap }); },
  cycleCamera: () => { const i = CAMERA_ORDER.indexOf(get().camera); get().set({ camera: CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length] }); },
  hud: { speedKmh: 0, rpm: 900, redline: 7000, gear: 1, nitro: 1, boost: 0, drifting: false, limiter: false, shifting: false, temp: 0.1 },
  setHud: (hud) => set({ hud }),
  circuit: { running: false, next: 0, lap: 0, lapMs: 0, lastMs: null, bestMs: null, message: "Drive through the cyan gate to start a timed lap" },
  setCircuit: (c) => set((s) => ({ circuit: { ...s.circuit, ...c } })),
  nearGarage: null,
  setNearGarage: (nearGarage) => set({ nearGarage }),
  menuOpen: false,
  setMenu: (menuOpen) => set({ menuOpen }),
}));

/** Mutable per-frame view of the car, shared by camera, minimap and lights (no React re-renders). */
export const view = { x: 0, y: 0, z: 0, yaw: 0, fx: 0, fz: 1, speed: 0 };

/** Mutable driver input (keyboard + touch merge here). */
export const controls = {
  throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, respawn: false,
  key: { up: false, down: false, left: false, right: false },
  touch: { up: false, down: false, left: false, right: false, handbrake: false, nitro: false, steer: 0 as number },
  keyHand: false, keyNitro: false,
};
