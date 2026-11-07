import { create } from "zustand";
import { applyImpacts, fullHealth, normalizeHealth, type HealthMap, type Impact } from "@road-rivals/shared";
import { post } from "@/services/api";

/**
 * Live damage state for the car being driven.
 *   health = fold(baseline (last server value), inflight + pending impacts)
 * New impacts are applied locally at once (so physics reacts immediately) and batched to the
 * server, which recomputes the same fold authoritatively and returns the persisted health.
 */
interface DamageState {
  ownershipId: string | null;
  baseline: HealthMap; pending: Impact[]; inflight: Impact[];
  health: HealthMap; durability: number; sending: boolean;
  hydrate: (ownershipId: string, serverHealth: Partial<Record<string, number>>, durability: number) => void;
  setDurability: (d: number) => void;
  addImpact: (i: Impact) => void;
  /** after a paid repair: the server's new health replaces the baseline (pending is flushed first) */
  setBaseline: (h: Partial<Record<string, number>>) => void;
  flush: (opts?: { beacon?: boolean }) => Promise<void>;
}

const fold = (b: HealthMap, imps: Impact[], dur: number) => applyImpacts(b, imps, dur);

export const useDamage = create<DamageState>((set, get) => ({
  ownershipId: null, baseline: fullHealth(), pending: [], inflight: [], health: fullHealth(), durability: 1, sending: false,

  hydrate: (ownershipId, serverHealth, durability) => {
    if (get().ownershipId === ownershipId) { set({ durability }); return; } // never overwrite live state with a stale refetch
    const b = normalizeHealth(serverHealth);
    set({ ownershipId, baseline: b, pending: [], inflight: [], health: b, durability });
  },
  setDurability: (durability) => set((s) => ({ durability, health: fold(s.baseline, [...s.inflight, ...s.pending], durability) })),

  addImpact: (imp) => set((s) => {
    const pending = [...s.pending, imp].slice(-40);
    return { pending, health: fold(s.baseline, [...s.inflight, ...pending], s.durability) };
  }),

  setBaseline: (h) => set((s) => {
    const baseline = normalizeHealth(h);
    return { baseline, health: fold(baseline, [...s.inflight, ...s.pending], s.durability) };
  }),

  flush: async ({ beacon = false } = {}) => {
    const s = get();
    if (!s.ownershipId || s.sending || s.pending.length === 0) return;
    const batch = s.pending.slice(0, 40);
    const body = { ownershipId: s.ownershipId, impacts: batch.map((i) => ({ mag: +i.mag.toFixed(3), lx: +i.lx.toFixed(4), ly: +i.ly.toFixed(4), lz: +i.lz.toFixed(4) })) };
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      // page is closing: fire-and-forget (server folds it; nothing to reconcile)
      navigator.sendBeacon("/api/vehicle/damage", new Blob([JSON.stringify(body)], { type: "text/plain" }));
      set({ pending: s.pending.slice(batch.length) });
      return;
    }
    set({ sending: true, inflight: batch, pending: s.pending.slice(batch.length) });
    try {
      const res = await post<{ damage: Partial<Record<string, number>> }>("/vehicle/damage", body);
      set((cur) => {
        const baseline = normalizeHealth(res.damage);
        return { baseline, inflight: [], sending: false, health: fold(baseline, cur.pending, cur.durability) };
      });
    } catch {
      // keep the impacts: put them back in front of the queue and retry on the next tick
      set((cur) => ({ pending: [...cur.inflight, ...cur.pending].slice(-40), inflight: [], sending: false }));
    }
  },
}));
