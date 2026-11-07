import type { Prisma } from "@prisma/client";
import { ACHIEVEMENT_BY_CODE, earnedAchievements, type AchievementDef, type PlayerStats } from "@road-rivals/shared";
import { earn } from "./wallet";
import { awardXp } from "./progress";

type Tx = Prisma.TransactionClient;

export async function playerStats(tx: Tx, userId: string): Promise<PlayerStats | null> {
  const p = await tx.playerProfile.findUnique({ where: { userId } });
  if (!p) return null;
  const vehiclesOwned = await tx.vehicleOwnership.count({ where: { userId } });
  return { racesPlayed: p.racesPlayed, racesWon: p.racesWon, level: p.level, distanceKm: p.distanceKm, vehiclesOwned };
}

/**
 * Unlock + pay every achievement the player now qualifies for. Safe to call after any event:
 * the (userId, achievementId) unique index decides who unlocks, `createMany(skipDuplicates)` returns
 * 1 only for the call that really inserted the row, so the reward is paid exactly once.
 */
export async function evaluateAchievements(tx: Tx, userId: string): Promise<AchievementDef[]> {
  const unlockedNow: AchievementDef[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const stats = await playerStats(tx, userId);
    if (!stats) return unlockedNow;
    const have = new Set((await tx.playerAchievement.findMany({ where: { userId }, include: { achievement: true } })).map((r) => r.achievement.code));
    const fresh = earnedAchievements(stats).filter((c) => !have.has(c));
    if (!fresh.length) break;
    for (const code of fresh) {
      const def = ACHIEVEMENT_BY_CODE.get(code)!;
      const row = await tx.achievement.upsert({
        where: { code }, update: { title: def.title, description: def.description, category: def.category, rewardCoins: def.rewardCoins, rewardXp: def.rewardXp },
        create: { code, title: def.title, description: def.description, category: def.category, rewardCoins: def.rewardCoins, rewardXp: def.rewardXp },
      });
      const made = await tx.playerAchievement.createMany({ data: [{ userId, achievementId: row.id }], skipDuplicates: true });
      if (made.count !== 1) continue;
      if (def.rewardCoins > 0) await earn(tx, userId, def.rewardCoins, "ACHIEVEMENT_REWARD", `ach:${userId}:${code}`, { achievement: code });
      if (def.rewardXp > 0) await awardXp(tx, userId, def.rewardXp, { skipAchievements: true });
      unlockedNow.push(def);
    }
  }
  return unlockedNow;
}
