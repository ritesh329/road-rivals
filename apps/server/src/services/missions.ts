import type { Prisma } from "@prisma/client";
import { MISSIONS, MISSION_BY_CODE, missionsForEvent, periodEnds, periodKey, type MissionEvent, type MissionDef } from "@road-rivals/shared";
import { HttpError } from "../utils/errors";
import { earn } from "./wallet";
import { awardXp } from "./progress";

type Tx = Prisma.TransactionClient;

/** Make sure every catalogue mission has a DB row (the catalogue in shared/missions.ts is the source of truth). */
export async function ensureMissionRows(tx: Tx, defs: MissionDef[] = MISSIONS) {
  const rows = await tx.mission.findMany({ where: { code: { in: defs.map((d) => d.code) } } });
  const have = new Map(rows.map((r) => [r.code, r]));
  for (const d of defs) {
    const data = { title: d.title, description: d.description, period: d.period, target: d.target, rewardCoins: d.rewardCoins, rewardXp: d.rewardXp };
    const row = have.get(d.code);
    if (!row) have.set(d.code, await tx.mission.create({ data: { code: d.code, ...data } }));
    else if (row.target !== d.target || row.rewardCoins !== d.rewardCoins || row.rewardXp !== d.rewardXp || row.title !== d.title)
      have.set(d.code, await tx.mission.update({ where: { code: d.code }, data }));
  }
  return have;
}

/**
 * Server-validated progress. Call inside the same transaction as the thing that happened (race
 * result, lap claim, garage purchase) so progress and cause commit together.
 */
export async function recordEvents(tx: Tx, userId: string, events: { event: MissionEvent; amount: number }[], now = new Date()) {
  const merged = new Map<MissionEvent, number>();
  for (const e of events) if (e.amount > 0) merged.set(e.event, (merged.get(e.event) ?? 0) + Math.floor(e.amount));
  const defs = [...merged.keys()].flatMap((e) => missionsForEvent(e));
  if (!defs.length) return;
  const rows = await ensureMissionRows(tx, defs);
  for (const def of defs) {
    const amount = merged.get(def.event)!;
    const mission = rows.get(def.code)!;
    const key = periodKey(def.period, now);
    const where = { userId_missionId_periodKey: { userId, missionId: mission.id, periodKey: key } };
    const cur = await tx.playerMission.upsert({
      where, update: { progress: { increment: amount } },
      create: { userId, missionId: mission.id, periodKey: key, progress: Math.min(def.target, amount) },
    });
    if (cur.progress > def.target) await tx.playerMission.updateMany({ where: { id: cur.id, progress: { gt: def.target } }, data: { progress: def.target } });
    if (Math.min(cur.progress, def.target) >= def.target && !cur.completedAt)
      await tx.playerMission.updateMany({ where: { id: cur.id, completedAt: null }, data: { completedAt: now } });
  }
}

export async function listMissions(tx: Tx, userId: string, now = new Date()) {
  const rows = await ensureMissionRows(tx);
  const keys = { DAILY: periodKey("DAILY", now), WEEKLY: periodKey("WEEKLY", now) };
  const mine = await tx.playerMission.findMany({ where: { userId, periodKey: { in: [keys.DAILY, keys.WEEKLY] } } });
  const byMission = new Map(mine.map((m) => [m.missionId, m]));
  const shape = (d: MissionDef) => {
    const pm = byMission.get(rows.get(d.code)!.id);
    const progress = Math.min(d.target, pm?.progress ?? 0);
    return {
      code: d.code, title: d.title, description: d.description, period: d.period, target: d.target, progress,
      rewardCoins: d.rewardCoins, rewardXp: d.rewardXp,
      completed: progress >= d.target, claimed: !!pm?.claimedAt,
    };
  };
  return {
    daily: MISSIONS.filter((m) => m.period === "DAILY").map(shape),
    weekly: MISSIONS.filter((m) => m.period === "WEEKLY").map(shape),
    resets: { daily: periodEnds("DAILY", now).toISOString(), weekly: periodEnds("WEEKLY", now).toISOString() },
  };
}

/** Pay a completed mission exactly once (conditional UPDATE + unique ledger key). */
export async function claimMission(tx: Tx, userId: string, code: string, now = new Date()) {
  const def = MISSION_BY_CODE.get(code);
  if (!def) throw new HttpError(404, "Unknown mission");
  const rows = await ensureMissionRows(tx, [def]);
  const mission = rows.get(code)!;
  const key = periodKey(def.period, now);
  const pm = await tx.playerMission.findUnique({ where: { userId_missionId_periodKey: { userId, missionId: mission.id, periodKey: key } } });
  if (!pm || pm.progress < def.target || !pm.completedAt) throw new HttpError(409, "Mission not completed yet");
  const claimed = await tx.playerMission.updateMany({ where: { id: pm.id, claimedAt: null }, data: { claimedAt: now } });
  if (claimed.count !== 1) throw new HttpError(409, "Reward already claimed");
  const coins = await earn(tx, userId, def.rewardCoins, "MISSION_REWARD", `mission:${userId}:${code}:${key}`, { mission: code, period: key } as Prisma.InputJsonValue);
  const progress = await awardXp(tx, userId, def.rewardXp);
  return { ok: true, coinsAwarded: def.rewardCoins, xpAwarded: def.rewardXp, coins, ...progress };
}
