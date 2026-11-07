import type { Server, Socket } from "socket.io";
import { parse } from "cookie";
import { COOKIE_NAME, verifyToken } from "../middleware/auth";
import { prisma } from "../utils/db";
import { HttpError } from "../utils/errors";
import { memberRoom, serializeRoom } from "../services/rooms";
import {
  addPresence, broadcastRoom, cancelGrace, chatHistory, dropFromGame, isOnline, joinGame, onGameRespawn, onGameState,
  removePresence, sendChat, setIo, startGrace, startRaceFor, abortRaceFor,
} from "../services/realtime";

type Ack = (r: unknown) => void;
const ackOf = (a: unknown): Ack => (typeof a === "function" ? (a as Ack) : () => undefined);
const fail = (ack: Ack, e: unknown) => ack({ ok: false, error: e instanceof HttpError ? e.message : "Something went wrong", status: e instanceof HttpError ? e.status : 500 });
const codeOf = (p: unknown) => (typeof (p as { code?: unknown })?.code === "string" ? (p as { code: string }).code : "");

/**
 * Socket.IO: authenticated via the same httpOnly cookie as the REST API.
 *   room:subscribe  join the live channel of a room you are a member of (lobby updates, chat, presence)
 *   game:join       enter the shared world of a RACING room (server assigns seat, sends everyone's look)
 *   game:state      your car pose, ≤ 20 Hz (validated + plausibility-checked; broadcast as game:states)
 *   chat:send       room chat (cleaned, rate limited)
 */
export function registerSockets(io: Server) {
  setIo(io);
  io.use((socket, next) => {
    const cookies = parse(socket.handshake.headers.cookie ?? "");
    const authToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const token = typeof authToken === "string" && authToken ? authToken : cookies[COOKIE_NAME];
    const userId = token ? verifyToken(token) : null;
    if (!userId) return next(new Error("unauthorized"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string;
    addPresence(userId, socket.id); cancelGrace(userId);
    socket.join(`user:${userId}`);
    socket.emit("hello", { userId });
    const touchRooms = async () => {
      const mine = await prisma.roomMembership.findMany({ where: { userId, leftAt: null, kicked: false } });
      for (const m of mine) await broadcastRoom(m.roomId);
    };
    void touchRooms().catch(() => undefined);

    socket.on("room:subscribe", async (p: unknown, a: unknown) => {
      const ack = ackOf(a);
      try {
        const { room } = await memberRoom(prisma, userId, codeOf(p));
        socket.join(`room:${room.id}`);
        const snap = await serializeRoom(room.id, isOnline);
        ack({ ok: true, room: snap, chat: chatHistory(room.id) });
        await broadcastRoom(room.id);
      } catch (e) { fail(ack, e); }
    });
    socket.on("room:unsubscribe", async (p: unknown) => {
      try { const { room } = await memberRoom(prisma, userId, codeOf(p)); socket.leave(`room:${room.id}`); } catch { /* not a member */ }
    });

    socket.on("game:join", async (p: unknown, a: unknown) => {
      const ack = ackOf(a);
      try { ack({ ok: true, ...(await joinGame(socket, codeOf(p))) }); } catch (e) { fail(ack, e); }
    });
    socket.on("game:state", (raw: unknown) => { try { onGameState(socket, raw); } catch { /* never crash the server on bad input */ } });
    socket.on("game:respawn", (raw: unknown) => { try { onGameRespawn(socket, raw); } catch { /* ignore */ } });
    socket.on("game:leave", () => { const r = socket.data.gameRoomId as string | undefined; if (r) { dropFromGame(r, userId); socket.leave(`game:${r}`); socket.data.gameRoomId = undefined; } });

    socket.on("race:start", async (p: unknown, a: unknown) => {
      const ack = ackOf(a);
      try { const r = await startRaceFor(userId, codeOf(p)); ack({ ok: true, startAt: r.startAt, racers: r.racers }); } catch (e) { fail(ack, e); }
    });
    socket.on("race:abort", async (p: unknown, a: unknown) => {
      const ack = ackOf(a);
      try { await abortRaceFor(userId, codeOf(p)); ack({ ok: true }); } catch (e) { fail(ack, e); }
    });

    socket.on("chat:send", async (p: unknown, a: unknown) => {
      const ack = ackOf(a);
      try { await sendChat(userId, codeOf(p), (p as { text?: unknown })?.text); ack({ ok: true }); } catch (e) { fail(ack, e); }
    });

    socket.on("disconnect", () => {
      const r = socket.data.gameRoomId as string | undefined;
      if (r) dropFromGame(r, userId);
      const left = removePresence(userId, socket.id);
      void touchRooms().catch(() => undefined);
      if (left === 0) startGrace(userId); // no tab left: remove from room after the grace period
    });
  });
}
