import { create } from "zustand";
import { getSocket } from "@/services/socket";
import { VoiceEngine } from "./voiceEngine";

interface VoiceState {
  on: boolean; muted: boolean; busy: boolean; error: string | null;
  speaking: Record<string, boolean>; linked: string[];
  join: () => Promise<void>; leave: () => void; toggleMute: () => void; talk: (v: boolean) => void;
}

let engine: VoiceEngine | null = null;

export const useVoice = create<VoiceState>((set, get) => ({
  on: false, muted: false, busy: false, error: null, speaking: {}, linked: [],
  join: async () => {
    if (get().on || get().busy) return;
    set({ busy: true, error: null });
    engine = new VoiceEngine(getSocket(), {
      speaking: (id, v) => set((s) => (s.speaking[id] === v ? s : { speaking: { ...s.speaking, [id]: v } })),
      peers: (linked) => set({ linked }),
      error: (error) => set({ error }),
    });
    try { await engine.start(false); set({ on: true, muted: false, busy: false }); }
    catch (e) { engine = null; set({ busy: false, on: false, error: (e as Error).message }); }
  },
  leave: () => { engine?.stop(); engine = null; set({ on: false, muted: false, busy: false, speaking: {}, linked: [] }); },
  toggleMute: () => { const m = !get().muted; engine?.setMuted(m); set({ muted: m }); },
  talk: (v) => engine?.talk(v),
}));
