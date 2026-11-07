import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { MP, RACE_MODES, RACE_MODE_KEYS, isRoomCode, normalizeRoomCode } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import * as rooms from "../services/rooms";
import { broadcastRoom, detachUser, isOnline, notifyUser, getIo, races } from "../services/realtime";

export const roomsRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" });
roomsRouter.use(limiter);
const uid = (req: unknown) => (req as AuthedRequest).userId;

/** Rooms the user was moved out of because they joined/created another one. */
async function afterLeave(userId: string, roomIds: string[]) {
  for (const id of roomIds) { detachUser(id, userId); await broadcastRoom(id); }
}

// ---- public (no login): what an invite link shows before you sign in
roomsRouter.get("/invite/:token", wrap(async (req, res) => {
  const p = await rooms.invitePreview(String(req.params.token).slice(0, 64));
  if (!p) throw new HttpError(404, "This invite link is invalid or the room is closed");
  res.json(p);
}));

roomsRouter.use(requireAuth);

roomsRouter.get("/public", wrap(async (_req, res) => { res.json({ rooms: await rooms.publicRooms() }); }));

roomsRouter.get("/mine", wrap(async (req, res) => {
  const r = await rooms.myActiveRoom(uid(req));
  res.json({ room: r ? await rooms.serializeRoom(r.id, isOnline) : null });
}));

roomsRouter.post("/", wrap(async (req, res) => {
  const b = z.object({ visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(), maxPlayers: z.number().int().min(2).max(MP.maxPlayers).optional(), mode: z.enum(RACE_MODE_KEYS).optional() }).parse(req.body ?? {});
  if (b.mode && RACE_MODES[b.mode].minPlayers > (b.maxPlayers ?? MP.maxPlayers)) throw new HttpError(400, "Not enough seats for that mode");
  const { room, touched } = await rooms.createRoom(uid(req), b);
  await afterLeave(uid(req), touched);
  res.status(201).json({ room: await rooms.serializeRoom(room.id, isOnline) });
}));

/** Solo challenge (time trial / drift / checkpoint): a private one-seat room that is already "in session". */
roomsRouter.post("/solo", wrap(async (req, res) => {
  const { mode } = z.object({ mode: z.enum(RACE_MODE_KEYS) }).parse(req.body ?? {});
  if (!RACE_MODES[mode].solo) throw new HttpError(400, `${RACE_MODES[mode].name} needs other drivers – create a room instead`);
  const { room, touched } = await rooms.createRoom(uid(req), { mode, solo: true });
  await afterLeave(uid(req), touched);
  res.status(201).json({ room: await rooms.serializeRoom(room.id, isOnline) });
}));

roomsRouter.post("/quick", wrap(async (req, res) => {
  const r = await rooms.quickMatch(uid(req));
  await afterLeave(uid(req), r.touched);
  await broadcastRoom(r.room.id);
  res.json({ created: r.created, room: await rooms.serializeRoom(r.room.id, isOnline) });
}));

roomsRouter.post("/join", wrap(async (req, res) => {
  const b = z.object({ token: z.string().min(8).max(64).optional(), code: z.string().min(1).max(12).optional() }).refine((v) => !!v.token !== !!v.code, "Send either a token or a code").parse(req.body ?? {});
  if (b.code && !isRoomCode(normalizeRoomCode(b.code))) throw new HttpError(400, "Room codes are 6 letters/digits");
  const r = await rooms.joinRoom(uid(req), b);
  await afterLeave(uid(req), r.touched);
  await broadcastRoom(r.room.id);
  res.json({ rejoined: r.rejoined, room: await rooms.serializeRoom(r.room.id, isOnline) });
}));

const code = () => z.string().min(4).max(12);

roomsRouter.get("/:code", wrap(async (req, res) => {
  const { room } = await rooms.memberRoom(prisma, uid(req), String(req.params.code));
  res.json({ room: await rooms.serializeRoom(room.id, isOnline) });
}));

roomsRouter.post("/:code/leave", wrap(async (req, res) => {
  const { room } = await rooms.memberRoom(prisma, uid(req), String(req.params.code));
  await rooms.leaveRoom(uid(req), room.id);
  detachUser(room.id, uid(req));
  await broadcastRoom(room.id);
  res.json({ ok: true });
}));

roomsRouter.post("/:code/ready", wrap(async (req, res) => {
  const { ready } = z.object({ ready: z.boolean() }).parse(req.body);
  const room = await rooms.setReady(uid(req), code().parse(req.params.code), ready);
  await broadcastRoom(room.id);
  res.json({ ok: true });
}));

roomsRouter.post("/:code/kick", wrap(async (req, res) => {
  const { userId } = z.object({ userId: z.string().min(1).max(64) }).parse(req.body);
  const room = await rooms.kick(uid(req), code().parse(req.params.code), userId);
  notifyUser(userId, "room:kicked", { code: room.code });
  detachUser(room.id, userId);
  await broadcastRoom(room.id);
  res.json({ ok: true });
}));

roomsRouter.post("/:code/settings", wrap(async (req, res) => {
  const b = z.object({ locked: z.boolean().optional(), visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(), maxPlayers: z.number().int().min(2).max(MP.maxPlayers).optional(), mode: z.enum(RACE_MODE_KEYS).optional() }).strict().parse(req.body);
  if (b.mode) { const m = await rooms.memberRoom(prisma, uid(req), code().parse(req.params.code)); if (races.isActive(m.room.id)) throw new HttpError(409, "Finish the running race before changing the mode"); }
  const room = await rooms.updateSettings(uid(req), code().parse(req.params.code), b);
  await broadcastRoom(room.id);
  res.json({ ok: true });
}));

roomsRouter.post("/:code/invite/rotate", wrap(async (req, res) => {
  const room = await rooms.rotateInvite(uid(req), code().parse(req.params.code));
  await broadcastRoom(room.id);
  res.json({ ok: true, inviteToken: room.inviteToken });
}));

roomsRouter.post("/:code/start", wrap(async (req, res) => {
  const room = await rooms.startSession(uid(req), code().parse(req.params.code));
  const startAt = Date.now() + 3000;
  getIo()?.to(`room:${room.id}`).emit("room:started", { code: room.code, startAt });
  await broadcastRoom(room.id);
  res.json({ ok: true, startAt });
}));

roomsRouter.post("/:code/stop", wrap(async (req, res) => {
  const room = await rooms.stopSession(uid(req), code().parse(req.params.code));
  getIo()?.to(`room:${room.id}`).emit("room:stopped", { code: room.code });
  await broadcastRoom(room.id);
  res.json({ ok: true });
}));
