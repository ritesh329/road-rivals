import { randomBytes, randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { MP, RACE_MODES, generateRoomCode, normalizeRoomCode, type RaceModeKey } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { HttpError } from "../utils/errors";

type Tx = Prisma.TransactionClient;

const newToken = () => randomBytes(18).toString("base64url");
export async function uniqueCode(tx: Tx) {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode(randomInt);
    if (!(await tx.gameRoom.findUnique({ where: { code } }))) return code;
  }
  throw new HttpError(503, "Could not allocate a room code, try again");
}

/**
 * Serialise concurrent changes to ONE room (joins racing for the last seat, host leaving while
 * someone joins…). A no-op UPDATE takes a row lock in Postgres that is held until the transaction
 * commits, so the next transaction then counts members against committed data.
 */
export const lockRoom = (tx: Tx, id: string) => tx.gameRoom.update({ where: { id }, data: { updatedAt: new Date() } });

const activeWhere = (roomId: string) => ({ roomId, leftAt: null, kicked: false });
export const activeMembers = (tx: Tx | typeof prisma, roomId: string) => tx.roomMembership.findMany({ where: activeWhere(roomId), orderBy: { joinedAt: "asc" } });

/** Remove the user from every active room (a player can only be in one room). Returns the rooms touched. */
export async function leaveAll(tx: Tx, userId: string, exceptRoomId?: string) {
  const mine = await tx.roomMembership.findMany({ where: { userId, leftAt: null, kicked: false } });
  const touched: string[] = [];
  for (const m of mine) {
    if (m.roomId === exceptRoomId) continue;
    await leaveRoomTx(tx, userId, m.roomId);
    touched.push(m.roomId);
  }
  return touched;
}

export async function leaveRoomTx(tx: Tx, userId: string, roomId: string) {
  await lockRoom(tx, roomId);
  const room = await tx.gameRoom.findUnique({ where: { id: roomId } });
  if (!room) return;
  await tx.roomMembership.updateMany({ where: { roomId, userId, leftAt: null }, data: { leftAt: new Date(), ready: false } });
  const left = await activeMembers(tx, roomId);
  if (left.length === 0) { await tx.gameRoom.update({ where: { id: roomId }, data: { status: "CLOSED" } }); return; }
  if (room.hostId === userId) await tx.gameRoom.update({ where: { id: roomId }, data: { hostId: left[0].userId } }); // oldest member becomes host
}

export interface CreateOpts { visibility?: "PUBLIC" | "PRIVATE"; maxPlayers?: number; mode?: RaceModeKey; /** one-driver room that is already in session (time trial, drift, checkpoint) */ solo?: boolean }

export async function createRoom(userId: string, opts: CreateOpts = {}) {
  return prisma.$transaction(async (tx) => {
    const touched = await leaveAll(tx, userId);
    const room = await tx.gameRoom.create({
      data: {
        code: await uniqueCode(tx), inviteToken: newToken(), hostId: userId,
        mode: opts.mode ?? "MULTIPLAYER",
        // PRIVATE race = invite only; solo challenges are never listed
        visibility: opts.solo || opts.mode === "PRIVATE" ? "PRIVATE" : opts.visibility ?? "PRIVATE",
        maxPlayers: opts.solo ? 1 : Math.min(MP.maxPlayers, Math.max(2, opts.maxPlayers ?? MP.maxPlayers)),
        ...(opts.solo ? { status: "RACING" as const } : {}),
      },
    });
    await tx.roomMembership.create({ data: { roomId: room.id, userId } });
    return { room, touched };
  });
}

export async function joinRoom(userId: string, by: { token?: string; code?: string }) {
  return prisma.$transaction(async (tx) => {
    const room = by.token
      ? await tx.gameRoom.findUnique({ where: { inviteToken: by.token } })
      : by.code ? await tx.gameRoom.findUnique({ where: { code: normalizeRoomCode(by.code) } }) : null;
    if (!room) throw new HttpError(404, "Room not found – check the invite link or code");
    await lockRoom(tx, room.id);
    const fresh = (await tx.gameRoom.findUnique({ where: { id: room.id } }))!;
    if (fresh.status === "CLOSED") throw new HttpError(410, "This room has been closed");

    const mine = await tx.roomMembership.findUnique({ where: { roomId_userId: { roomId: fresh.id, userId } } });
    if (mine?.kicked) throw new HttpError(403, "You were removed from this room");
    if (mine && !mine.leftAt) return { room: fresh, touched: [] as string[], rejoined: true }; // already inside: idempotent

    if (fresh.locked) throw new HttpError(403, "The host has locked this room");
    const members = await activeMembers(tx, fresh.id);
    if (members.length >= fresh.maxPlayers) throw new HttpError(409, "Room is full", { code: "FULL" });

    const touched = await leaveAll(tx, userId, fresh.id);
    if (mine) await tx.roomMembership.update({ where: { id: mine.id }, data: { leftAt: null, ready: false, joinedAt: new Date() } });
    else await tx.roomMembership.create({ data: { roomId: fresh.id, userId } });
    return { room: fresh, touched, rejoined: false };
  });
}

export async function leaveRoom(userId: string, roomId: string) {
  await prisma.$transaction((tx) => leaveRoomTx(tx, userId, roomId));
}

async function hostRoom(tx: Tx, hostId: string, code: string) {
  const room = await tx.gameRoom.findUnique({ where: { code: normalizeRoomCode(code) } });
  if (!room || room.status === "CLOSED") throw new HttpError(404, "Room not found");
  await lockRoom(tx, room.id);
  const fresh = (await tx.gameRoom.findUnique({ where: { id: room.id } }))!;
  if (fresh.hostId !== hostId) throw new HttpError(403, "Only the host can do that");
  return fresh;
}

export async function memberRoom(tx: Tx | typeof prisma, userId: string, code: string) {
  const room = await tx.gameRoom.findUnique({ where: { code: normalizeRoomCode(code) } });
  if (!room || room.status === "CLOSED") throw new HttpError(404, "Room not found");
  const m = await tx.roomMembership.findUnique({ where: { roomId_userId: { roomId: room.id, userId } } });
  if (!m || m.leftAt || m.kicked) throw new HttpError(403, "You are not in this room");
  return { room, membership: m };
}

export async function setReady(userId: string, code: string, ready: boolean) {
  return prisma.$transaction(async (tx) => {
    const { room, membership } = await memberRoom(tx, userId, code);
    if (room.status !== "LOBBY") throw new HttpError(409, "The session already started");
    await tx.roomMembership.update({ where: { id: membership.id }, data: { ready } });
    return room;
  });
}

export async function kick(hostId: string, code: string, targetId: string) {
  return prisma.$transaction(async (tx) => {
    const room = await hostRoom(tx, hostId, code);
    if (targetId === hostId) throw new HttpError(400, "You cannot kick yourself – leave instead");
    const m = await tx.roomMembership.findUnique({ where: { roomId_userId: { roomId: room.id, userId: targetId } } });
    if (!m || m.leftAt) throw new HttpError(404, "That player is not in the room");
    await tx.roomMembership.update({ where: { id: m.id }, data: { kicked: true, leftAt: new Date(), ready: false } });
    return room;
  });
}

export async function updateSettings(hostId: string, code: string, s: { locked?: boolean; visibility?: "PUBLIC" | "PRIVATE"; maxPlayers?: number; mode?: RaceModeKey }) {
  return prisma.$transaction(async (tx) => {
    const room = await hostRoom(tx, hostId, code);
    if (room.maxPlayers === 1) throw new HttpError(409, "Solo challenges have no room settings");
    if (s.mode !== undefined && RACE_MODES[s.mode].minPlayers > room.maxPlayers) throw new HttpError(409, "Not enough seats for that mode");
    const count = (await activeMembers(tx, room.id)).length;
    if (s.maxPlayers !== undefined && (s.maxPlayers < Math.max(2, count) || s.maxPlayers > MP.maxPlayers))
      throw new HttpError(409, `Max players must be between ${Math.max(2, count)} and ${MP.maxPlayers}`);
    return tx.gameRoom.update({ where: { id: room.id }, data: { ...(s.locked !== undefined && { locked: s.locked }), ...(s.visibility && { visibility: s.mode === "PRIVATE" ? "PRIVATE" : s.visibility }), ...(s.maxPlayers !== undefined && { maxPlayers: s.maxPlayers }), ...(s.mode && { mode: s.mode, ...(s.mode === "PRIVATE" ? { visibility: "PRIVATE" as const } : {}) }) } });
  });
}

export async function rotateInvite(hostId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    const room = await hostRoom(tx, hostId, code);
    return tx.gameRoom.update({ where: { id: room.id }, data: { inviteToken: newToken() } });
  });
}

export async function startSession(hostId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    const room = await hostRoom(tx, hostId, code);
    if (room.status !== "LOBBY") throw new HttpError(409, "Session already running");
    const members = await activeMembers(tx, room.id);
    if (members.some((m) => m.userId !== hostId && !m.ready)) throw new HttpError(409, "Not everyone is ready yet", { code: "NOT_READY" });
    return tx.gameRoom.update({ where: { id: room.id }, data: { status: "RACING" } });
  });
}

export async function stopSession(hostId: string, code: string) {
  return prisma.$transaction(async (tx) => {
    const room = await hostRoom(tx, hostId, code);
    if (room.status !== "RACING") throw new HttpError(409, "No session is running");
    await tx.roomMembership.updateMany({ where: { roomId: room.id, leftAt: null }, data: { ready: false } });
    return tx.gameRoom.update({ where: { id: room.id }, data: { status: "LOBBY" } });
  });
}

/** Join the first public room with a free seat, or create a public one. */
export async function quickMatch(userId: string) {
  const open = await prisma.gameRoom.findMany({ where: { visibility: "PUBLIC", locked: false, status: { in: ["LOBBY", "RACING"] } }, orderBy: { createdAt: "asc" } });
  for (const r of open) {
    try { return { ...(await joinRoom(userId, { code: r.code })), created: false }; }
    catch (e) { if (!(e instanceof HttpError) || ![409, 403, 410].includes(e.status)) throw e; }
  }
  return { ...(await createRoom(userId, { visibility: "PUBLIC", mode: "QUICK" })), rejoined: false, created: true };
}

/** Full room view for members. `isOnline` comes from the socket presence map. */
export async function serializeRoom(roomId: string, isOnline: (userId: string) => boolean = () => false) {
  const room = await prisma.gameRoom.findUnique({ where: { id: roomId } });
  if (!room) return null;
  const members = await activeMembers(prisma, roomId);
  const users = await Promise.all(members.map((m) => prisma.user.findUnique({ where: { id: m.userId }, include: { profile: true } })));
  return {
    code: room.code, inviteToken: room.inviteToken, hostId: room.hostId, visibility: room.visibility, status: room.status,
    locked: room.locked, maxPlayers: room.maxPlayers, mode: room.mode, mapId: room.mapId,
    members: members.map((m, i) => ({
      userId: m.userId, username: users[i]?.username ?? "?", level: users[i]?.profile?.level ?? 1,
      ready: m.ready, isHost: m.userId === room.hostId, online: isOnline(m.userId),
    })),
  };
}

export async function publicRooms() {
  const rooms = await prisma.gameRoom.findMany({ where: { visibility: "PUBLIC", status: { in: ["LOBBY", "RACING"] } }, orderBy: { createdAt: "desc" }, take: 30 });
  const out = [];
  for (const r of rooms) {
    const members = await activeMembers(prisma, r.id);
    if (!members.length) continue;
    const host = await prisma.user.findUnique({ where: { id: r.hostId } });
    out.push({ code: r.code, host: host?.username ?? "?", players: members.length, maxPlayers: r.maxPlayers, status: r.status, locked: r.locked, joinable: !r.locked && members.length < r.maxPlayers });
  }
  return out;
}

/** What an invite link shows BEFORE you join (safe for logged-out visitors: no code, no member ids). */
export async function invitePreview(token: string) {
  const r = await prisma.gameRoom.findUnique({ where: { inviteToken: token } });
  if (!r || r.status === "CLOSED") return null;
  const members = await activeMembers(prisma, r.id);
  const host = await prisma.user.findUnique({ where: { id: r.hostId } });
  const reason = r.locked ? "The host has locked this room" : members.length >= r.maxPlayers ? "Room is full" : null;
  return { host: host?.username ?? "?", players: members.length, maxPlayers: r.maxPlayers, status: r.status, joinable: !reason, reason };
}

export async function myActiveRoom(userId: string) {
  const mine = await prisma.roomMembership.findMany({ where: { userId, leftAt: null, kicked: false } });
  for (const m of mine) {
    const r = await prisma.gameRoom.findUnique({ where: { id: m.roomId } });
    if (r && r.status !== "CLOSED") return r;
  }
  return null;
}
