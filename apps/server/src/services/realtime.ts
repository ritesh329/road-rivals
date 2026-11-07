import type { Server, Socket } from "socket.io";
import {
  MP, cleanChat, computeDamageEffects, estimatePerformance, plausibleMove, sanitizeState, seatPose,
  RACE_MODES, isRaceMode, type NetPlayer, type NetState, type PlayerAppearance, type RaceModeKey,
} from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { HttpError } from "../utils/errors";
import { memberRoom, serializeRoom, leaveRoom, myActiveRoom } from "./rooms";
import { RaceOrchestrator, RaceError } from "./raceSession";
import { persistRound } from "./racePersist";
import { recordEvents } from "./missions";
import { evaluateAchievements } from "./achievements";
import { healthOf, loadOwned, physicsOf } from "./vehicles";
import { config } from "../utils/config";

/* ------------------------------------------------------------------ io + presence */

let io: Server | null = null;
export const setIo = (s: Server | null) => { io = s; };
export const getIo = () => io;

const presence = new Map<string, Set<string>>(); // userId -> socket ids
export const isOnline = (userId: string) => (presence.get(userId)?.size ?? 0) > 0;
export function addPresence(userId: string, socketId: string) {
  if (!presence.has(userId)) presence.set(userId, new Set());
  presence.get(userId)!.add(socketId);
}
export function removePresence(userId: string, socketId: string) {
  const s = presence.get(userId); if (!s) return 0;
  s.delete(socketId); if (!s.size) presence.delete(userId);
  return s.size;
}

const graceTimers = new Map<string, NodeJS.Timeout>();
export const cancelGrace = (userId: string) => { const t = graceTimers.get(userId); if (t) { clearTimeout(t); graceTimers.delete(userId); } };
export function startGrace(userId: string) {
  cancelGrace(userId);
  graceTimers.set(userId, setTimeout(async () => {
    graceTimers.delete(userId);
    if (isOnline(userId)) return;
    try {
      const room = await myActiveRoom(userId);
      if (room) { await leaveRoom(userId, room.id); dropFromGame(room.id, userId); await broadcastRoom(room.id); }
    } catch (e) { console.error("grace leave failed", e); }
  }, config.presenceGraceMs));
}

export async function broadcastRoom(roomId: string) {
  const room = await serializeRoom(roomId, isOnline);
  if (!io || !room) return;
  io.to(`room:${roomId}`).emit("room:update", room);
  if (room.status === "CLOSED") { io.to(`room:${roomId}`).emit("room:closed", { code: room.code }); roomChat.delete(roomId); }
}
export const notifyUser = (userId: string, event: string, payload: unknown) => { io?.to(`user:${userId}`).emit(event, payload); };

/** A user is no longer part of a room: pull their sockets out of its channels and out of the game. */
export function detachUser(roomId: string, userId: string) {
  dropFromGame(roomId, userId);
  io?.in(`user:${userId}`).socketsLeave([`room:${roomId}`, `game:${roomId}`]);
}

/* ------------------------------------------------------------------------- chat */

interface ChatMsg { id: string; userId: string; username: string; text: string; at: number }
const roomChat = new Map<string, ChatMsg[]>();
const chatRate = new Map<string, number[]>();
export const chatHistory = (roomId: string) => roomChat.get(roomId) ?? [];

export async function sendChat(userId: string, code: string, raw: unknown) {
  const text = cleanChat(raw);
  if (!text) throw new HttpError(400, "Empty message");
  const now = Date.now();
  const recent = (chatRate.get(userId) ?? []).filter((t) => now - t < 8000);
  if (recent.length >= 5) throw new HttpError(429, "Slow down – too many messages");
  chatRate.set(userId, [...recent, now]);
  const { room } = await memberRoom(prisma, userId, code);
  const u = await prisma.user.findUnique({ where: { id: userId } });
  const msg: ChatMsg = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, userId, username: u?.username ?? "?", text, at: now };
  const list = [...chatHistory(room.id), msg].slice(-50);
  roomChat.set(room.id, list);
  io?.to(`room:${room.id}`).emit("chat:message", msg);
  return msg;
}

/* -------------------------------------------------------------- game simulation */

interface GamePlayer {
  userId: string; username: string; seat: number; socketId: string; appearance: PlayerAppearance; topSpeedMs: number;
  state: NetState | null; base: { x: number; y: number; z: number; at: number }; lastAt: number; lastRespawnAt: number; strikes: number; dirty: boolean;
  /** metres driven since the last mission flush (server-measured from validated positions) */
  dist: number;
}
interface GameRoomSim { players: Map<string, GamePlayer>; timer: NodeJS.Timeout | null }
const games = new Map<string, GameRoomSim>();

/* ----------------------------------------------------------------------- races */

/** One orchestrator for all rooms; everything it needs from sockets / DB is injected here. */
export const races = new RaceOrchestrator({
  now: () => Date.now(),
  every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
  after: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  emit: (roomId, event, payload) => { io?.to(`game:${roomId}`).emit(event, payload); },
  emitUser: (userId, event, payload) => { io?.to(`user:${userId}`).emit(event, payload); },
  teleport: (roomId, userId, pose) => {
    const p = games.get(roomId)?.players.get(userId); if (!p) return;
    const now = Date.now(); p.base = { x: pose.x, y: pose.y, z: pose.z, at: now }; p.lastRespawnAt = now;
    io?.to(p.socketId).emit("game:correct", { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, reason: "grid" });
  },
  present: (roomId) => [...(games.get(roomId)?.players.values() ?? [])].map((p) => ({ userId: p.userId, username: p.username, seat: p.seat })),
  persist: persistRound,
});

/** Host starts a race for everybody currently in the shared world. */
export async function startRaceFor(userId: string, code: string) {
  const { room } = await memberRoom(prisma, userId, code);
  if (room.hostId !== userId) throw new HttpError(403, "Only the host can start the race");
  if (room.status !== "RACING") throw new HttpError(409, "Start the session first");
  if (!isRaceMode(room.mode)) throw new HttpError(409, "Unknown race mode");
  try { return races.start({ id: room.id, code: room.code, mode: room.mode as RaceModeKey }); }
  catch (e) { if (e instanceof RaceError) throw new HttpError(e.status, e.message); throw e; }
}
export async function abortRaceFor(userId: string, code: string) {
  const { room } = await memberRoom(prisma, userId, code);
  if (room.hostId !== userId) throw new HttpError(403, "Only the host can end the race");
  races.abort(room.id);
}

function flushDistance(p: GamePlayer) {
  const m = Math.floor(p.dist); if (m < 50) return; p.dist = 0;
  void prisma.$transaction(async (tx) => {
    await recordEvents(tx, p.userId, [{ event: "DISTANCE_M", amount: m }]);
    await tx.playerProfile.update({ where: { userId: p.userId }, data: { distanceKm: { increment: m / 1000 } } });
    await evaluateAchievements(tx, p.userId);
  }).catch((e) => console.error("distance mission flush failed", e));
}

export const gamePlayerCount = (roomId: string) => games.get(roomId)?.players.size ?? 0;
const pub = (p: GamePlayer): NetPlayer => ({ id: p.userId, username: p.username, seat: p.seat, appearance: p.appearance, state: p.state });

/** Everything the other clients need to draw this player – read from the DB, never from the client. */
async function loadAppearance(userId: string) {
  const profile = await prisma.playerProfile.findUnique({ where: { userId } });
  if (!profile?.activeOwnershipId) throw new HttpError(409, "No active vehicle");
  const own = await loadOwned(prisma, userId, profile.activeOwnershipId);
  const params = physicsOf(own);
  const health = healthOf(own);
  const perf = estimatePerformance(params, computeDamageEffects(health));
  const appearance: PlayerAppearance = {
    name: own.vehicle.name, category: own.vehicle.category, baseStats: own.vehicle.baseStats as unknown as Record<string, number>,
    parts: own.upgrades.map((u) => ({ type: u.slot, tier: u.part.tier })),
    config: { ...(own.configuration ?? {}) } as unknown as Record<string, string | null>, damage: health,
  };
  delete (appearance.config as Record<string, unknown>).id; delete (appearance.config as Record<string, unknown>).ownershipId; delete (appearance.config as Record<string, unknown>).updatedAt;
  return { appearance, topSpeedMs: Math.max(perf.topSpeedKmh, 60) / 3.6 };
}

export async function joinGame(socket: Socket, code: string) {
  const userId = socket.data.userId as string;
  const { room } = await memberRoom(prisma, userId, code);
  if (room.status !== "RACING") throw new HttpError(409, "The session has not started yet");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const { appearance, topSpeedMs } = await loadAppearance(userId);

  let g = games.get(room.id);
  if (!g) { g = { players: new Map(), timer: null }; games.set(room.id, g); }
  const existing = g.players.get(userId);
  if (existing && existing.socketId !== socket.id) io?.to(existing.socketId).emit("game:replaced", {});
  const taken = new Set([...g.players.values()].filter((p) => p.userId !== userId).map((p) => p.seat));
  let seat = existing?.seat ?? 0; if (!existing) while (taken.has(seat)) seat++;
  const sp = seatPose(seat), now = Date.now();
  const me: GamePlayer = {
    userId, username: user?.username ?? "?", seat, socketId: socket.id, appearance, topSpeedMs, state: null,
    base: { x: sp.x, y: sp.y, z: sp.z, at: now }, lastAt: 0, lastRespawnAt: now, strikes: 0, dirty: false, dist: 0,
  };
  g.players.set(userId, me);
  socket.data.gameRoomId = room.id;
  socket.join([`room:${room.id}`, `game:${room.id}`]);
  socket.to(`game:${room.id}`).emit("game:player-joined", pub(me));
  if (!g.timer) g.timer = setInterval(() => tick(room.id), 1000 / MP.sendHz);
  // solo challenges (time trial / drift / checkpoint) start by themselves once the driver is in the world
  if (room.maxPlayers === 1 && isRaceMode(room.mode) && RACE_MODES[room.mode].solo && !races.get(room.id)) {
    setTimeout(() => { try { if (!races.get(room.id)) races.start({ id: room.id, code: room.code, mode: room.mode as RaceModeKey }); } catch { /* left already */ } }, 1500);
  }
  return { selfId: userId, seat, spawn: sp, serverTime: now, players: [...g.players.values()].map(pub), race: races.summary(room.id), mode: room.mode, solo: room.maxPlayers === 1, isHost: room.hostId === userId };
}

export function dropFromGame(roomId: string, userId: string) {
  const g = games.get(roomId);
  const leaving = g?.players.get(userId);
  if (!g || !g.players.delete(userId)) return;
  if (leaving) flushDistance(leaving);
  races.drop(roomId, userId);
  io?.to(`game:${roomId}`).emit("game:player-left", { id: userId });
  if (!g.players.size) { if (g.timer) clearInterval(g.timer); games.delete(roomId); races.dispose(roomId); }
}

export function onGameState(socket: Socket, raw: unknown) {
  const roomId = socket.data.gameRoomId as string | undefined;
  const g = roomId ? games.get(roomId) : undefined;
  const p = g?.players.get(socket.data.userId);
  if (!g || !p || p.socketId !== socket.id) return;
  const now = Date.now();
  if (now - p.lastAt < MP.minStateIntervalMs) return; // flood control
  p.lastAt = now;
  const s = sanitizeState(raw);
  if (!s) { p.strikes++; return; }
  const move = plausibleMove(p.base, s, now, p.topSpeedMs);
  if (!move.ok) {
    p.strikes++;
    // snap the sender back to the last accepted position (their client treats it as a respawn)
    socket.emit("game:correct", { x: p.base.x, y: p.base.y, z: p.base.z, reason: "speed" });
    return;
  }
  p.dist += Math.min(Math.hypot(s.x - p.base.x, s.z - p.base.z), 40); // measured from validated positions only
  p.state = s; p.base = { x: s.x, y: s.y, z: s.z, at: now }; p.dirty = true;
  races.onState(roomId!, p.userId, { x: s.x, z: s.z, vx: s.vx, vz: s.vz, qx: s.qx, qy: s.qy, qz: s.qz, qw: s.qw, speed: s.speed }, now);
  if (p.dist >= 1000) flushDistance(p);
}

/** Legit teleports (R key, garage tow, flip recovery). Rate limited, must stay inside the map. */
export function onGameRespawn(socket: Socket, raw: unknown) {
  const roomId = socket.data.gameRoomId as string | undefined;
  const p = roomId ? games.get(roomId)?.players.get(socket.data.userId) : undefined;
  const r = raw as { x?: number; y?: number; z?: number } | null;
  if (!p || !r || ![r.x, r.y, r.z].every((n) => typeof n === "number" && Number.isFinite(n)) || Math.abs(r.x!) > 600 || Math.abs(r.z!) > 600) return;
  const now = Date.now();
  if (now - p.lastRespawnAt < 1500) return;
  // during a race the SERVER decides where you come back: the last gate you really passed (or the grid)
  const pose = races.respawnPose(roomId!, p.userId);
  if (pose) { p.lastRespawnAt = now; p.base = { x: pose.x, y: pose.y, z: pose.z, at: now }; socket.emit("game:correct", { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, reason: "respawn" }); return; }
  p.lastRespawnAt = now; p.base = { x: r.x!, y: r.y!, z: r.z!, at: now };
}

function tick(roomId: string) {
  const g = games.get(roomId);
  if (!g || !io) return;
  const s = [] as (NetState & { id: string })[];
  for (const p of g.players.values()) if (p.dirty && p.state) { s.push({ id: p.userId, ...p.state }); p.dirty = false; }
  if (s.length) io.to(`game:${roomId}`).volatile.emit("game:states", { t: Date.now(), s });
}

export const strikesOf = (roomId: string, userId: string) => games.get(roomId)?.players.get(userId)?.strikes ?? 0;
