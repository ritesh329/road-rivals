import { create } from "zustand";
import type { VehicleConfig } from "@road-rivals/shared";

export interface NearGarage { slug: string; name: string; kind: string }
export interface Toast { id: number; text: string; kind: "good" | "bad" | "info" }

interface GarageUi {
  near: NearGarage | null;
  setNear: (g: NearGarage | null) => void;
  open: boolean;                 // in-world garage panel visible
  setOpen: (v: boolean) => void;
  /** unsaved cosmetic choices shown on the live 3D car while the Customize tab is open */
  preview: Partial<VehicleConfig> | null;
  setPreview: (p: Partial<VehicleConfig> | null) => void;
  /** last known wallet balance from any server response (HUD) */
  coins: number | null;
  setCoins: (c: number) => void;
  toast: Toast | null;
  notify: (text: string, kind?: Toast["kind"]) => void;
}

let toastId = 0;
export const useGarageUi = create<GarageUi>((set) => ({
  near: null, setNear: (near) => set({ near }),
  open: false, setOpen: (open) => set({ open, preview: open ? null : null }),
  preview: null, setPreview: (preview) => set({ preview }),
  coins: null, setCoins: (coins) => set({ coins }),
  toast: null,
  notify: (text, kind = "info") => {
    const id = ++toastId;
    set({ toast: { id, text, kind } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 3800);
  },
}));
