import type { Prisma } from "@prisma/client";
import { levelUpBonus, tierForLevel, xpForNextLevel } from "@road-rivals/shared";
import { HttpError } from "../utils/errors";
import { earn } from "./wallet";
import { evaluateAchievements } from "./achievements";

/**
 * Adds XP, rolls over levels, updates tier, pays the one-time level-up coins (unique ledger key per
 * user+level) and unlocks achievements. Run inside a transaction. Returns the new profile numbers.
 */
export async function awardXp(tx: Prisma.TransactionClient, userId: string, gain: number, opts: { skipAchievements?: boolean } = {}) {
  const p = await tx.playerProfile.findUnique({ where: { userId } });
  if (!p) throw new HttpError(404, "Profile not found");
  let { xp, level } = p;
  xp += gain;
  const gained: number[] = [];
  while (xp >= xpForNextLevel(level)) { xp -= xpForNextLevel(level); level++; gained.push(level); }
  const tier = tierForLevel(level) as typeof p.tier;
  await tx.playerProfile.update({ where: { userId }, data: { xp, level, tier } });

  let levelUpCoins = 0;
  for (const lv of gained) {
    const bonus = levelUpBonus(lv);
    await earn(tx, userId, bonus, "ADJUSTMENT", `levelup:${userId}:${lv}`, { kind: "level-up", level: lv });
    levelUpCoins += bonus;
  }
  const unlocked = opts.skipAchievements ? [] : await evaluateAchievements(tx, userId);
  return { xp, level, tier, xpToNext: xpForNextLevel(level), leveledUp: level > p.level, levelUpCoins, unlocked: unlocked.map((a) => ({ code: a.code, title: a.title, rewardCoins: a.rewardCoins })) };
}
