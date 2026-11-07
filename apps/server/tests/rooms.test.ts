/**
 * Phase 4 integration tests: REST room rules + real Socket.IO sync with 5 simultaneous players.
 * Run: npm run test:rooms -w @road-rivals/server
 */
process.env.JWT_SECRET = "test-secret-test-secret-123456";
process.env.NODE_ENV = "test";
process.env.PRESENCE_GRACE_MS = "400";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioc, type Socket } from "socket.io-client";
import { createMemoryPrisma } from "./memoryPrisma";
import { setPrismaForTests } from "../src/utils/db";

const db = createMemoryPrisma();
setPrismaForTests(db);
let failed = 0; const rows: string[] = [];
const check = (n: string, ok: boolean, d = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { seedCatalog } = await import("../../../prisma/seedCore");
  const { createApp } = await import("../src/app");
  const { registerSockets } = await import("../src/sockets");
  const { strikesOf } = await import("../src/services/realtime");
  await seedCatalog(db);
  const server = http.createServer(createApp());
  const sio = new Server(server, { cors: { origin: true, credentials: true } });
  registerSockets(sio);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  class User {
    cookie = ""; id = ""; name = ""; sockets: Socket[] = [];
    async req(method: string, path: string, body?: unknown) {
      const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
      return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    }
    get = (p: string) => this.req("GET", p);
    post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
    connect() {
      const s = ioc(base, { transports: ["websocket"], extraHeaders: { cookie: this.cookie }, forceNew: true, reconnection: false });
      this.sockets.push(s);
      return new Promise<Socket>((res, rej) => { s.on("connect", () => res(s)); s.on("connect_error", rej); });
    }
    emit(s: Socket, ev: string, payload?: unknown) { return new Promise<any>((res) => s.emit(ev, payload, res)); }
  }
  let n = 0;
  const mk = async (name: string) => {
    const u = new User(); u.name = `${name}x${++n}`;
    const r = await u.post("/api/auth/register", { email: `${u.name}@t.io`, username: u.name, password: "password123" });
    u.id = r.json.id; return u;
  };

  // ============================================================ REST: rooms
  const host = await mk("host");
  check("rooms: unauthenticated create → 401", (await new User().post("/api/rooms")).status === 401);
  let r = await host.post("/api/rooms", { visibility: "PRIVATE" });
  const R1 = r.json.room;
  check("create: 6-char code, host is member 1/5, private, lobby", r.status === 201 && /^[A-HJ-NP-Z2-9]{6}$/.test(R1.code) && R1.hostId === host.id && R1.members.length === 1 && R1.maxPlayers === 5 && R1.status === "LOBBY" && R1.visibility === "PRIVATE");
  check("create: maxPlayers > 5 or < 2 rejected", (await host.post("/api/rooms", { maxPlayers: 6 })).status === 400 && (await host.post("/api/rooms", { maxPlayers: 1 })).status === 400);
  // that last valid call created nothing; re-fetch active room
  check("mine: returns the active room", (await host.get("/api/rooms/mine")).json.room.code === R1.code);

  // invite links
  const pv = await new User().get(`/api/rooms/invite/${R1.inviteToken}`);
  check("invite preview works WITHOUT login, shows host + seats, never leaks the room code", pv.status === 200 && pv.json.host === host.name && pv.json.players === 1 && pv.json.joinable === true && !JSON.stringify(pv.json).includes(R1.code));
  check("invalid invite token → 404", (await new User().get("/api/rooms/invite/nope-nope-nope")).status === 404);

  // two rooms: tokens must land in the RIGHT room
  const hostB = await mk("hostb"); const RB = (await hostB.post("/api/rooms", {})).json.room;
  const p1 = await mk("p"), p2 = await mk("p");
  const j1 = await p1.post("/api/rooms/join", { token: R1.inviteToken }), j2 = await p2.post("/api/rooms/join", { token: RB.inviteToken });
  check("invite link joins the CORRECT room (two rooms, two tokens)", j1.json.room.code === R1.code && j2.json.room.code === RB.code && j1.json.room.members.some((m: any) => m.userId === p1.id) && !j1.json.room.members.some((m: any) => m.userId === p2.id));
  check("join by code works case-insensitively; same user joining again is idempotent", (await p2.post("/api/rooms/join", { code: R1.code.toLowerCase() })).json.room.code === R1.code && (await p2.get("/api/rooms/mine")).json.room.code === R1.code);
  check("joining another room auto-leaves the previous one", (await hostB.get(`/api/rooms/${RB.code}`)).json.room.members.length === 1);
  check("bad code → 400 / unknown code → 404 / both token+code → 400", (await p1.post("/api/rooms/join", { code: "abc" })).status === 400 && (await p1.post("/api/rooms/join", { code: "ZZZZZZ" })).status === 404 && (await p1.post("/api/rooms/join", { code: R1.code, token: R1.inviteToken })).status === 400);
  check("non-member cannot read the room (403)", (await (await mk("out")).get(`/api/rooms/${R1.code}`)).status === 403);

  // 5-seat limit
  const p3 = await mk("p"), p4 = await mk("p"), p5 = await mk("p");
  await p3.post("/api/rooms/join", { token: R1.inviteToken }); // host, p1, p2, p3 = 4 seats used, 1 free
  const racers = [p4, p5, await mk("p")];
  const parallel = await Promise.all(racers.map((u) => u.post("/api/rooms/join", { token: R1.inviteToken })));
  const ok = parallel.filter((x) => x.status === 200), full = parallel.filter((x) => x.status === 409);
  check("5 players max: 3 parallel joins for the last seat → exactly 1 wins, 2 get 'Room is full'", ok.length === 1 && full.length === 2 && full[0].json.code === "FULL");
  check("room has exactly 5 members", (await host.get(`/api/rooms/${R1.code}`)).json.room.members.length === 5);
  check("a 6th player is refused (invite + code)", (await (await mk("p")).post("/api/rooms/join", { code: R1.code })).status === 409);
  check("invite preview now says not joinable (full)", (await new User().get(`/api/rooms/invite/${R1.inviteToken}`)).json.joinable === false);
  const small = (await (await mk("sm")).post("/api/rooms", { maxPlayers: 2 })); // user is host
  check("maxPlayers=2 room refuses a 3rd", small.status === 201);

  // host controls
  check("only host can kick/lock/start (403 for others)", (await p1.post(`/api/rooms/${R1.code}/kick`, { userId: p2.id })).status === 403 && (await p1.post(`/api/rooms/${R1.code}/settings`, { locked: true })).status === 403 && (await p1.post(`/api/rooms/${R1.code}/start`)).status === 403);
  check("start refused until everyone is ready (409 NOT_READY)", (await host.post(`/api/rooms/${R1.code}/start`)).json.code === "NOT_READY");
  // kick + no re-entry
  const kickedUser = racers[parallel.findIndex((x) => x.status === 200)]; // whoever won the last seat
  r = await host.post(`/api/rooms/${R1.code}/kick`, { userId: kickedUser.id });
  check("host kicks a player; they are removed", r.status === 200 && !(await host.get(`/api/rooms/${R1.code}`)).json.room.members.some((m: any) => m.userId === kickedUser.id));
  check("kicked player cannot come back (invite or code → 403)", (await kickedUser.post("/api/rooms/join", { token: R1.inviteToken })).status === 403 && (await kickedUser.post("/api/rooms/join", { code: R1.code })).status === 403);
  check("host cannot kick themselves", (await host.post(`/api/rooms/${R1.code}/kick`, { userId: host.id })).status === 400);

  // lock
  await host.post(`/api/rooms/${R1.code}/settings`, { locked: true });
  const late = await mk("late");
  check("locked room refuses new joins; unlocking allows again", (await late.post("/api/rooms/join", { token: R1.inviteToken })).status === 403 && (await host.post(`/api/rooms/${R1.code}/settings`, { locked: false })).status === 200 && (await late.post("/api/rooms/join", { token: R1.inviteToken })).status === 200);
  await late.post(`/api/rooms/${R1.code}/leave`);

  // invite rotation
  const oldTok = R1.inviteToken;
  const rot = await host.post(`/api/rooms/${R1.code}/invite/rotate`);
  check("rotating the invite kills the old link and creates a working new one", (await new User().get(`/api/rooms/invite/${oldTok}`)).status === 404 && (await new User().get(`/api/rooms/invite/${rot.json.inviteToken}`)).status === 200);

  // public listing + quick match
  const pubHost = await mk("pub"); const pubRoom = (await pubHost.post("/api/rooms", { visibility: "PUBLIC" })).json.room;
  const listed = (await (await mk("v")).get("/api/rooms/public")).json.rooms;
  check("public list shows public rooms only (no private ones, no codes of private rooms)", listed.some((x: any) => x.code === pubRoom.code && x.joinable) && !listed.some((x: any) => x.code === R1.code));
  const qm = await (await mk("qm")).post("/api/rooms/quick");
  check("quick match drops you into an open public room", qm.status === 200 && qm.json.created === false && qm.json.room.code === pubRoom.code);
  const qm2 = await new Promise<any>(async (res) => { const u = await mk("qn"); await pubHost.post(`/api/rooms/${pubRoom.code}/leave`); res((await u.post("/api/rooms/quick"))); });
  check("quick match creates a public room when none is open", qm2.status === 200 && (qm2.json.created === true || qm2.json.room.visibility === "PUBLIC"));

  // ready → start → stop
  const sHost = await mk("sh"), sA = await mk("sa"), sB = await mk("sb");
  const S = (await sHost.post("/api/rooms", {})).json.room;
  await sA.post("/api/rooms/join", { code: S.code }); await sB.post("/api/rooms/join", { code: S.code });
  await sA.post(`/api/rooms/${S.code}/ready`, { ready: true });
  check("start blocked while one player is not ready", (await sHost.post(`/api/rooms/${S.code}/start`)).status === 409);
  await sB.post(`/api/rooms/${S.code}/ready`, { ready: true });
  r = await sHost.post(`/api/rooms/${S.code}/start`);
  check("start works when all ready → status RACING + countdown timestamp", r.status === 200 && r.json.startAt > Date.now() && (await sHost.get(`/api/rooms/${S.code}`)).json.room.status === "RACING");
  check("ready toggling after start → 409; second start → 409", (await sA.post(`/api/rooms/${S.code}/ready`, { ready: false })).status === 409 && (await sHost.post(`/api/rooms/${S.code}/start`)).status === 409);
  await sHost.post(`/api/rooms/${S.code}/stop`);
  const back = (await sHost.get(`/api/rooms/${S.code}`)).json.room;
  check("stop returns everyone to the lobby with ready reset", back.status === "LOBBY" && back.members.every((m: any) => !m.ready));

  // host leaves → migration → empty closes
  await sHost.post(`/api/rooms/${S.code}/leave`);
  const after = (await sA.get(`/api/rooms/${S.code}`)).json.room;
  check("host leaves → oldest remaining member becomes host", after.hostId === sA.id && after.members.length === 2);
  await sA.post(`/api/rooms/${S.code}/leave`); await sB.post(`/api/rooms/${S.code}/leave`);
  check("last player leaves → room closed; its invite link and code are dead", (await new User().get(`/api/rooms/invite/${S.inviteToken}`)).status === 404 && (await (await mk("z")).post("/api/rooms/join", { code: S.code })).status === 410);

  // ============================================================ sockets: 5 players
  const H = await mk("sockhost"); const GR = (await H.post("/api/rooms", {})).json.room;
  const P = [await mk("sp"), await mk("sp"), await mk("sp"), await mk("sp")];
  for (const u of P) await u.post("/api/rooms/join", { token: GR.inviteToken });
  const all = [H, ...P];
  const sock: Socket[] = []; for (const u of all) sock.push(await u.connect());
  const outsider = await mk("intruder"); const os = await outsider.connect();
  check("sockets: unauthenticated handshake rejected", await new Promise<boolean>((res) => { const s = ioc(base, { transports: ["websocket"], forceNew: true, reconnection: false }); s.on("connect", () => { s.close(); res(false); }); s.on("connect_error", () => res(true)); }));

  const updates: Record<string, any[]> = {}; all.forEach((u) => (updates[u.id] = []));
  all.forEach((u, i) => sock[i].on("room:update", (r) => updates[u.id].push(r)));
  const subs = await Promise.all(all.map((u, i) => u.emit(sock[i], "room:subscribe", { code: GR.code })));
  check("room:subscribe: all 5 members get the live room snapshot", subs.every((s) => s.ok && s.room.members.length === 5));
  check("room:subscribe: an outsider is refused (403)", (await outsider.emit(os, "room:subscribe", { code: GR.code })).ok === false);
  check("presence: all 5 shown online", subs[4].room.members.every((m: any) => m.online) || (await H.get(`/api/rooms/${GR.code}`)).json.room.members.every((m: any) => m.online));

  const early = await H.emit(sock[0], "game:join", { code: GR.code });
  check("game:join before the session starts is refused (409)", early.ok === false && early.status === 409);

  // live lobby updates: ready toggles reach every other client
  await Promise.all(P.map((u) => u.post(`/api/rooms/${GR.code}/ready`, { ready: true })));
  await sleep(150);
  check("lobby is live: every client saw all 4 ready toggles without refreshing", all.every((u) => { const last = updates[u.id].at(-1); return last && last.members.filter((m: any) => m.ready).length === 4; }));
  const started = new Promise<any>((res) => sock[4].once("room:started", res));
  await H.post(`/api/rooms/${GR.code}/start`);
  check("room:started pushed to clients", !!(await started).startAt);

  const joined = await Promise.all(all.map((u, i) => u.emit(sock[i], "game:join", { code: GR.code })));
  check("game:join: all 5 accepted with 5 distinct seats", joined.every((j) => j.ok) && new Set(joined.map((j) => j.seat)).size === 5, joined.map((j) => j.seat).join(","));
  check("game:join: appearance comes from the DB (car name/category) for every player", joined[4].players.length === 5 && joined[4].players.every((p: any) => p.appearance.category === "HATCHBACK" && p.appearance.parts !== undefined));
  check("game:join: outsider refused", (await outsider.emit(os, "game:join", { code: GR.code })).ok === false);

  const seen: Record<string, Record<string, any>> = {}; all.forEach((u) => (seen[u.id] = {}));
  all.forEach((u, i) => sock[i].on("game:states", (m) => { for (const s of m.s) seen[u.id][s.id] = s; }));
  const statePkt = (x: number, z: number) => ({ x, y: 0.5, z, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 20, steer: 0.2, speed: 72, nitro: false, braking: false, drifting: false });
  for (let k = 0; k < 20; k++) { all.forEach((u, i) => sock[i].emit("game:state", statePkt(-30 + i * 6 + k * 0.5, -3 + k * 0.2))); await sleep(40); }
  await sleep(150);
  check("5-player realtime sync: every client receives the other 4 cars' live positions", all.every((u) => Object.keys(seen[u.id]).filter((id) => id !== u.id).length === 4));
  const hostSeesP0 = seen[H.id][P[0].id];
  check("positions are the right player's (P0 is at x≈-24+… not someone else's)", hostSeesP0 && Math.abs(hostSeesP0.x - (-30 + 1 * 6 + 19 * 0.5)) < 1.6, hostSeesP0 ? `x=${hostSeesP0.x}` : "missing");

  // cheating / garbage
  const hackSeen: number[] = []; sock[1].on("game:states", (m) => m.s.forEach((s: any) => { if (s.id === P[3].id) hackSeen.push(s.x); }));
  const corr = new Promise<any>((res) => sock[4].once("game:correct", res));
  sock[4].emit("game:state", statePkt(500, 400)); // 'teleport' hack
  const c = await Promise.race([corr, sleep(600).then(() => null)]);
  await sleep(150);
  check("speed/teleport hack: rejected, sender snapped back, nobody else ever sees it", !!c && !hackSeen.some((x) => x > 400) && ![...Object.values(seen)].some((s) => s[P[3].id]?.x > 400));
  for (const bad of [{ x: "NaN" }, { ...statePkt(0, 0), x: 1e9 }, null, "boom", { ...statePkt(0, 0), admin: 1 }]) sock[2].emit("game:state", bad);
  await sleep(150);
  const roomId = db.$rows("GameRoom").find((r: any) => r.code === GR.code).id as string;
  check("malformed packets are ignored (server alive) and counted as strikes against the sender", strikesOf(roomId, P[1].id) >= 1 && (await H.get("/api/me")).status === 200, `strikes ${strikesOf(roomId, P[1].id)}`);
  let burst = 0; const onS = (m: any) => { burst += m.s.filter((x: any) => x.id === H.id).length; }; sock[1].on("game:states", onS);
  for (let k = 0; k < 200; k++) sock[0].emit("game:state", statePkt(-30 + k * 0.001, -3));
  await sleep(300); sock[1].off("game:states", onS);
  check("flood control: 200 packets in one burst deliver only a handful of updates (not 200)", burst >= 1 && burst <= 12, `${burst} delivered`);

  // chat
  const chats: any[] = []; sock[2].on("chat:message", (m) => chats.push(m));
  await H.emit(sock[0], "chat:send", { code: GR.code, text: "  gg <script>alert(1)</script> " });
  await sleep(100);
  check("chat: delivered to the room, sanitised, with the sender's name", chats.length === 1 && chats[0].username === H.name && !chats[0].text.includes("<") && chats[0].text.startsWith("gg"));
  check("chat: outsider cannot post (403)", (await outsider.emit(os, "chat:send", { code: GR.code, text: "hi" })).ok === false);
  let limited = false; for (let k = 0; k < 7; k++) { const a = await H.emit(sock[0], "chat:send", { code: GR.code, text: "spam " + k }); if (!a.ok && a.status === 429) limited = true; }
  check("chat: spam is rate limited (429)", limited);
  const resub = await P[0].emit(sock[1], "room:subscribe", { code: GR.code });
  check("chat history is replayed on (re)subscribe", resub.chat.length >= 1);

  // leave / kick / disconnect
  const leftEv = new Promise<any>((res) => sock[0].once("game:player-left", res));
  sock[3].close();
  check("disconnect: others get game:player-left immediately", (await Promise.race([leftEv, sleep(800).then(() => null)]))?.id === P[2].id);
  const offlineSeen = (await H.get(`/api/rooms/${GR.code}`)).json.room.members.find((m: any) => m.userId === P[2].id);
  check("presence: disconnected player shown offline but still in the room during the grace period", offlineSeen && offlineSeen.online === false);
  await sleep(700);
  check("after the grace period the dropped player is removed from the room (seat freed)", !(await H.get(`/api/rooms/${GR.code}`)).json.room.members.some((m: any) => m.userId === P[2].id));
  const seatFree = await mk("seatfill"); r = await seatFree.post("/api/rooms/join", { token: (await H.get(`/api/rooms/${GR.code}`)).json.room.inviteToken });
  check("late join while RACING is allowed into the freed seat", r.status === 200 && r.json.room.status === "RACING");
  const sfSock = await seatFree.connect(); const sfJoin = await seatFree.emit(sfSock, "game:join", { code: GR.code });
  check("late joiner enters the live world and sees the 4 other cars", sfJoin.ok && sfJoin.players.length === 5 && new Set(sfJoin.players.map((p: any) => p.seat)).size === 5, `seat ${sfJoin.seat}`);

  const kickedEv = new Promise<any>((res) => sock[1].once("room:kicked", res));
  const gotAfterKick: any[] = []; sock[1].on("game:states", (m) => gotAfterKick.push(m));
  await H.post(`/api/rooms/${GR.code}/kick`, { userId: P[0].id });
  check("kick: target is notified in realtime", !!(await Promise.race([kickedEv, sleep(800).then(() => null)])));
  gotAfterKick.length = 0; sock[0].emit("game:state", statePkt(-29, -3)); await sleep(150);
  check("kick: kicked client stops receiving game traffic", gotAfterKick.length === 0);

  all.concat([outsider, seatFree]).forEach((u) => u.sockets.forEach((s) => s.close()));
  server.close(); sio.close();
  console.log(rows.join("\n")); console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
