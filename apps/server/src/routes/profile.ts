import { Router } from "express";
import { z } from "zod";
import { ACHIEVEMENTS, AVATAR_KEYS, nextTier, tierOf, xpForNextLevel } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { playerStats } from "../services/achievements";

export const profileRouter = Router();
profileRouter.use(requireAuth);
const uid = (req: unknown) => (req as AuthedRequest).userId;

profileRouter.get("/", wrap(async (req, res) => {
  const userId = uid(req);
  const [user, stats, unlocked, season] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { profile: true, wallet: true } }),
    playerStats(prisma as never, userId),
    prisma.playerAchievement.findMany({ where: { userId }, include: { achievement: true } }),
    prisma.season.findFirst({ where: { active: true, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, orderBy: { startsAt: "desc" } }),
  ]);
  if (!user?.profile || !user.wallet || !stats) throw new HttpError(404, "Profile not found");
  const p = user.profile;
  let rank: number | null = null, points = 0, wins = 0;
  if (season) {
    const mine = await prisma.leaderboard.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId } } });
    if (mine) { points = mine.score; wins = mine.wins; rank = (await prisma.leaderboard.count({ where: { seasonId: season.id, score: { gt: mine.score } } })) + 1; }
  }
  const at = new Map(unlocked.map((u) => [u.achievement.code, u.unlockedAt]));
  res.json({
    id: user.id, username: user.username, avatar: p.avatar, level: p.level, xp: p.xp, xpToNext: xpForNextLevel(p.level),
    tier: tierOf(p.level), nextTier: nextTier(p.level), coins: user.wallet.coins,
    stats: { racesPlayed: p.racesPlayed, racesWon: p.racesWon, winRate: p.racesPlayed ? Math.round((p.racesWon / p.racesPlayed) * 100) : 0, distanceKm: Math.round(p.distanceKm * 10) / 10, vehiclesOwned: stats.vehiclesOwned },
    season: season ? { name: season.name, rank, points, wins } : null,
    achievements: ACHIEVEMENTS.map((a) => { const [value, target] = a.goal(stats); return { code: a.code, title: a.title, description: a.description, category: a.category, rewardCoins: a.rewardCoins, rewardXp: a.rewardXp, value, target, unlockedAt: at.get(a.code) ?? null }; }),
  });
}));

profileRouter.post("/avatar", wrap(async (req, res) => {
  const { avatar } = z.object({ avatar: z.enum(AVATAR_KEYS) }).parse(req.body);
  await prisma.playerProfile.update({ where: { userId: uid(req) }, data: { avatar } });
  res.json({ ok: true, avatar });
}));

/** Coin history – every change of the wallet is a ledger row (the balance is never edited directly). */
profileRouter.get("/ledger", wrap(async (req, res) => {
  const rows = await prisma.transaction.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: "desc" }, take: 30 });
  res.json({ entries: rows.map((t) => ({ id: t.id, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter, at: t.createdAt })) });
}));
