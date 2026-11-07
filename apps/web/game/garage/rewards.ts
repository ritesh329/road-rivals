import { ApiError, post } from "@/services/api";
import { useGarageUi } from "./garageStore";

/** Ask the server to pay for a completed free-roam lap. The server validates plausibility + caps. */
export async function claimLap(ownershipId: string, lapMs: number) {
  const ui = useGarageUi.getState();
  try {
    const r = await post<{ coins: number; coinsAwarded: number; xpAwarded: number; leveledUp: boolean; level: number }>("/rewards/lap", { ownershipId, lapMs: Math.round(lapMs) });
    ui.setCoins(r.coins);
    ui.notify(`Lap reward  +${r.coinsAwarded} coins  +${r.xpAwarded} XP${r.leveledUp ? `  ·  LEVEL ${r.level}!` : ""}`, "good");
  } catch (e) {
    if (e instanceof ApiError && e.status !== 401) ui.notify(`Lap not rewarded: ${e.message}`, "info");
  }
}
