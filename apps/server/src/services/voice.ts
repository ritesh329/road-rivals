import type { Server, Socket } from "socket.io";

/**
 * Voice chat signalling (WebRTC mesh, ≤5 drivers per room). Audio itself never touches the server –
 * it flows peer-to-peer; the server only introduces peers and relays offer / answer / ICE messages.
 *
 *   voice:join    I enabled my mic  → ack { peers: [userIds already on voice] }, others get voice:peer-joined
 *   voice:leave   I left voice      → others get voice:peer-left
 *   voice:signal  { to, data }      → forwarded to `to` as { from, data } (only inside the same game session)
 *
 * Requires socket.data.gameRoomId (set by game:join) and the `game:<roomId>` socket.io room.
 */
const MAX_SIGNAL_BYTES = 12_000;
const KINDS = new Set(["offer", "answer", "candidate"]);

export function registerVoice(io: Server, socket: Socket) {
  const userId = socket.data.userId as string;
  const roomOf = () => socket.data.gameRoomId as string | undefined;
  // simple flood guard: ≤ 150 signalling messages / 10 s per socket (a 5-way call needs ~40 in total)
  let windowStart = 0, count = 0;
  const allowed = () => { const n = Date.now(); if (n - windowStart > 10_000) { windowStart = n; count = 0; } return ++count <= 150; };

  const leave = () => {
    if (!socket.data.voice) return;
    socket.data.voice = false;
    const r = roomOf();
    if (r) io.to(`game:${r}`).emit("voice:peer-left", { id: userId });
  };

  socket.on("voice:join", async (_p: unknown, ack: unknown) => {
    const cb = typeof ack === "function" ? (ack as (r: unknown) => void) : () => undefined;
    const r = roomOf();
    if (!r) return cb({ ok: false, error: "Join the session first" });
    try {
      const peers = (await io.in(`game:${r}`).fetchSockets())
        .filter((s) => s.id !== socket.id && s.data.voice && s.data.userId !== userId)
        .map((s) => s.data.userId as string);
      socket.data.voice = true;
      socket.to(`game:${r}`).emit("voice:peer-joined", { id: userId });
      cb({ ok: true, peers: [...new Set(peers)] });
    } catch { cb({ ok: false, error: "Voice unavailable" }); }
  });

  socket.on("voice:leave", leave);

  socket.on("voice:signal", async (p: unknown) => {
    try {
      if (!allowed() || !socket.data.voice) return;
      const to = (p as { to?: unknown })?.to, data = (p as { data?: { type?: unknown } })?.data;
      if (typeof to !== "string" || !data || typeof data !== "object" || typeof data.type !== "string" || !KINDS.has(data.type)) return;
      if (JSON.stringify(data).length > MAX_SIGNAL_BYTES) return;
      const r = roomOf(); if (!r || to === userId) return;
      for (const t of await io.in(`user:${to}`).fetchSockets()) {
        if (t.data.gameRoomId === r && t.data.voice) t.emit("voice:signal", { from: userId, data });
      }
    } catch { /* never crash on bad input */ }
  });

  // leaving the session / closing the tab also ends voice
  socket.on("game:leave", leave);
  socket.on("disconnect", leave);
}
