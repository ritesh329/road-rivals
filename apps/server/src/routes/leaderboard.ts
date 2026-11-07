import { Router } from "express";
import { z } from "zod";
import { tierOf } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const leaderboardRouter = Router();
leaderboardRouter.use(requireAuth);

/**
 * Three boards:  season (race points this month) · wins (all-time race wins) · level (level + XP).
 * Always returns the top 20 plus the caller's own rank, even when they are outside the top 20.
 */
leaderboardRouter.get("/", wrap(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const board = z.enum(["season", "wins", "level"]).catch("season").parse(req.query.board);
  const now = new Date();

  if (board === "season") {
    const season = await prisma.season.findFirst({ where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "desc" } });
    if (!season) return res.json({ board, season: null, top: [], me: null });
    const top = await prisma.leaderboard.findMany({ where: { seasonId: season.id }, orderBy: [{ score: "desc" }, { wins: "desc" }], take: 20 });
    const users = await Promise.all(top.map((t) => prisma.user.findUnique({ where: { id: t.userId }, include: { profile: true } })));
    const mine = await prisma.leaderboard.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId } } });
    const rank = mine ? (await prisma.leaderboard.count({ where: { seasonId: season.id, score: { gt: mine.score } } })) + 1 : null;
    return res.json({
      board, season: { name: season.name, endsAt: season.endsAt },
      top: top.map((t, i) => ({ rank: i + 1, userId: t.userId, username: users[i]?.username ?? "?", avatar: users[i]?.profile?.avatar ?? "default", tier: tierOf(users[i]?.profile?.level ?? 1), value: t.score, extra: `${t.wins} wins` })),
      me: mine ? { rank, value: mine.score, extra: `${mine.wins} wins` } : null,
    });
  }

  const orderBy = board === "wins" ? [{ racesWon: "desc" as const }, { racesPlayed: "asc" as const }] : [{ level: "desc" as const }, { xp: "desc" as const }];
  const top = await prisma.playerProfile.findMany({ orderBy, take: 20 });
  const users = await Promise.all(top.map((t) => prisma.user.findUnique({ where: { id: t.userId } })));
  const me = await prisma.playerProfile.findUnique({ where: { userId } });
  const val = (p: { racesWon: number; level: number }) => (board === "wins" ? p.racesWon : p.level);
  const rank = me
    ? board === "wins"
      ? (await prisma.playerProfile.count({ where: { racesWon: { gt: me.racesWon } } })) + 1
      : (await prisma.playerProfile.count({ where: { OR: [{ level: { gt: me.level } }, { level: me.level, xp: { gt: me.xp } }] } })) + 1
    : null;
  res.json({
    board, season: null,
    top: top.map((t, i) => ({ rank: i + 1, userId: t.userId, username: users[i]?.username ?? "?", avatar: t.avatar, tier: tierOf(t.level), value: val(t), extra: board === "wins" ? `${t.racesPlayed} races` : `${t.xp} xp` })),
    me: me ? { rank, value: val(me), extra: board === "wins" ? `${me.racesPlayed} races` : `${me.xp} xp` } : null,
  });
}));
