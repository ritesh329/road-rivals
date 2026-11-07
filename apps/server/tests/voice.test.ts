/** Voice-chat signalling: peers only meet inside their own game session, signals are relayed, leaving is announced. */
import http from "node:http";
import { Server } from "socket.io";
import { io as client, type Socket } from "socket.io-client";
import { registerVoice } from "../src/services/voice";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ack = (s: Socket, ev: string, p?: unknown) => new Promise<any>((r) => s.emit(ev, p, r));

(async () => {
  const srv = http.createServer(); const io = new Server(srv);
  io.on("connection", (s) => {
    const q = s.handshake.query as Record<string, string>;
    s.data.userId = q.uid; s.data.gameRoomId = q.room || undefined;
    s.join(`user:${q.uid}`); if (q.room) s.join(`game:${q.room}`);
    registerVoice(io, s);
  });
  await new Promise<void>((r) => srv.listen(0, r));
  const url = `http://localhost:${(srv.address() as { port: number }).port}`;
  const mk = async (uid: string, room: string) => { const s = client(url, { query: { uid, room }, transports: ["websocket"] }); await new Promise((r) => s.on("connect", () => r(null))); return s; };
  const log = (s: Socket, ev: string) => { const a: any[] = []; s.on(ev, (m) => a.push(m)); return a; };

  const a = await mk("A", "r1"), b = await mk("B", "r1"), c = await mk("C", "r2"), n = await mk("N", "");
  const aJoined = log(a, "voice:peer-joined"), aSig = log(a, "voice:signal"), bSig = log(b, "voice:signal"), cSig = log(c, "voice:signal"), aLeft = log(a, "voice:peer-left");

  ok((await ack(n, "voice:join")).ok === false, "cannot join voice without being in a game session");
  const ra = await ack(a, "voice:join"); ok(ra.ok && ra.peers.length === 0, "first driver joins voice alone");
  const rb = await ack(b, "voice:join"); ok(rb.ok && rb.peers.join() === "A", "second driver is told who is already on voice");
  await wait(80); ok(aJoined.length === 1 && aJoined[0].id === "B", "existing driver is told about the newcomer");
  const rc = await ack(c, "voice:join"); ok(rc.ok && rc.peers.length === 0, "other room is separate");

  b.emit("voice:signal", { to: "A", data: { type: "offer", sdp: "v=0" } }); await wait(80);
  ok(aSig.length === 1 && aSig[0].from === "B" && aSig[0].data.type === "offer", "offer is relayed with the sender's id");
  b.emit("voice:signal", { to: "C", data: { type: "offer", sdp: "x" } }); await wait(80);
  ok(cSig.length === 0, "signals do not cross into another session");
  a.emit("voice:signal", { to: "B", data: { type: "evil", x: 1 } }); a.emit("voice:signal", { to: "B", data: { type: "offer", sdp: "x".repeat(20000) } }); await wait(80);
  ok(bSig.length === 0, "unknown / oversized signals are dropped");

  b.emit("game:leave"); await wait(80);
  ok(aLeft.length === 1 && aLeft[0].id === "B", "leaving the session announces voice:peer-left");
  c.disconnect(); a.emit("voice:leave"); await wait(50);
  [a, b, n].forEach((s) => s.disconnect()); io.close(); srv.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
})();
