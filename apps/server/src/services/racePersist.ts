import type { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { earn } from "./wallet";
import { awardXp } from "./progress";
import { recordEvents } from "./missions";
import type { Persisted, RoundResult } from "./raceSession";

/** Rewarded races per player per UTC day (anti-farming; results are still stored beyond it, just unpaid). */
export const RACE_REWARDS_PER_DAY = 40;

async function currentSeason(tx: Prisma.TransactionClient, now: Date) {
  const found = await tx.season.findFirst({ where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "desc" } });
  if (found) return found;
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return tx.season.create({ data: { name: `Season ${startsAt.toISOString().slice(0, 7)}`, startsAt, endsAt, active: true } });
}

/**
 * Store one finished race (a tournament = one Race per round) and pay it out, all in ONE
 * transaction: Race + participants + results, coins (ledger row with a unique key per race+user),
 * XP, season leaderboard, mission progress. All numbers come from the server's race tracker.
 */
export async function persistRound(r: RoundResult): Promise<Persisted[]> {
  const now = new Date(r.endedAt);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return prisma.$transaction(async (tx) => {
    const season = await currentSeason(tx, now);
    const race = await tx.race.create({
      data: { roomId: r.roomId, seasonId: season.id, mode: r.mode, status: "FINISHED", mapId: "city", laps: r.laps, startedAt: new Date(r.startAt), finishedAt: now },
    });
    const finals = new Map((r.finalRewards ?? []).map((f) => [f.userId, f]));
    const out: Persisted[] = [];
    for (const row of r.rows) {
      const profile = await tx.playerProfile.findUnique({ where: { userId: row.userId } });
      if (!profile?.activeOwnershipId) continue;
      const part = await tx.raceParticipant.create({ data: { raceId: race.id, userId: row.userId, ownershipId: profile.activeOwnershipId } });

      const paidToday = await tx.transaction.count({ where: { userId: row.userId, type: "RACE_REWARD", idempotencyKey: { startsWith: "race:" }, createdAt: { gte: dayStart } } });
      const capped = paidToday >= RACE_REWARDS_PER_DAY;
      const fin = finals.get(row.userId);
      const coins = capped ? 0 : row.coins + (fin?.coins ?? 0);
      const xp = capped ? 0 : row.xp + (fin?.xp ?? 0);
      const points = row.points + (fin?.points ?? 0);

      await tx.raceResult.create({ data: { participantId: part.id, position: row.position, timeMs: row.timeMs, coinsAwarded: coins, xpAwarded: xp, validated: true } });
      let level: number | undefined, leveledUp: boolean | undefined;
      if (coins > 0) await earn(tx, row.userId, coins, "RACE_REWARD", `race:${race.id}:${row.userId}`, { mode: r.mode, round: r.round, position: row.position, score: row.score, gates: row.gates } as Prisma.InputJsonValue);
      if (xp > 0) { const p = await awardXp(tx, row.userId, xp); level = p.level; leveledUp = p.leveledUp; }
      if (points > 0 || row.won) {
        await tx.leaderboard.upsert({
          where: { seasonId_userId: { seasonId: season.id, userId: row.userId } },
          update: { score: { increment: points }, wins: { increment: row.won ? 1 : 0 } },
          create: { seasonId: season.id, userId: row.userId, score: points, wins: row.won ? 1 : 0 },
        });
      }
      if (row.gates > 0 || row.score > 0) await tx.playerProfile.update({ where: { userId: row.userId }, data: { racesPlayed: { increment: 1 }, ...(row.won && row.field > 1 ? { racesWon: { increment: 1 } } : {}) } });
      await recordEvents(tx, row.userId, r.missionEvents.filter((m) => m.userId === row.userId), now);
      out.push({ userId: row.userId, coinsAwarded: coins, xpAwarded: xp, capped, level, leveledUp });
    }
    return out;
  });
}
