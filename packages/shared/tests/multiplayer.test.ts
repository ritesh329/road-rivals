import { MP, SnapshotBuffer, cleanChat, generateRoomCode, isRoomCode, plausibleMove, sanitizeState, seatPose, ROOM_CODE_ALPHABET, type NetState } from "../src/index";

let failed = 0; const rows: string[] = [];
const check = (n: string, ok: boolean, d = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };

const S = (o: Partial<NetState> = {}): NetState => ({ x: 0, y: 0.5, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, steer: 0, speed: 0, nitro: false, braking: false, drifting: false, ...o });

// room codes
const rnd = (n: number) => Math.floor(Math.random() * n);
const codes = new Set(Array.from({ length: 500 }, () => generateRoomCode(rnd)));
check("room codes: 6 chars from the unambiguous alphabet, few collisions", [...codes].every((c) => isRoomCode(c) && [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch))) && codes.size > 490, `${codes.size}/500 unique`);
check("room code check rejects lowercase / 0 / O / wrong length", !isRoomCode("abcdef") && !isRoomCode("ABC0EF") && !isRoomCode("ABCDE") && isRoomCode("ABCDEF"));

// chat
check("chat: trims, strips control chars and < >, caps length, rejects empty/non-string", cleanChat("  hi\u0000 <b>there</b>  ") === "hi b there /b" && cleanChat("x".repeat(500))!.length === MP.chatMax && cleanChat("   ") === null && cleanChat(5) === null);

// state validation
check("state: valid accepted and quaternion normalised", (() => { const s = sanitizeState(S({ qy: 0.6, qw: 0.6 })); return !!s && Math.abs(Math.hypot(s.qx, s.qy, s.qz, s.qw) - 1) < 1e-9; })());
check("state: NaN / Infinity / out-of-world / unknown keys / zero quaternion rejected", sanitizeState(S({ x: NaN })) === null && sanitizeState(S({ x: 99999 })) === null && sanitizeState({ ...S(), admin: true }) === null && sanitizeState(S({ qw: 0 })) === null && sanitizeState("x") === null && sanitizeState(S({ vx: 1e6 })) === null);
check("plausibleMove: 200 km/h car OK, 'teleport' 500 m in 50 ms rejected", plausibleMove({ x: 0, y: 0, z: 0, at: 0 }, { x: 0, y: 0, z: 2.8 }, 50, 55).ok === true && plausibleMove({ x: 0, y: 0, z: 0, at: 0 }, { x: 0, y: 0, z: 500 }, 50, 55).ok === false);
check("seats: 5 distinct spawn positions", new Set([0, 1, 2, 3, 4].map((s) => `${seatPose(s).x},${seatPose(s).z}`)).size === 5);

// interpolation
const b = new SnapshotBuffer();
b.push(1000, S({ x: 0, vx: 10 })); b.push(1100, S({ x: 1, vx: 10 })); b.push(1200, S({ x: 2, vx: 10 }));
check("interp: midpoint exact between snapshots", Math.abs(b.sample(1150)!.x - 1.5) < 1e-9);
check("interp: before first → first, after last → short extrapolation by velocity", b.sample(900)!.x === 0 && Math.abs(b.sample(1300)!.x - 3) < 1e-9);
check("interp: extrapolation capped (no runaway ghost after packet loss)", Math.abs(b.sample(9999)!.x - (2 + 10 * MP.extrapolateMs / 1000)) < 1e-9);
b.push(1150, S({ x: 99 }));
check("interp: out-of-order snapshot ignored", b.length === 3 && Math.abs(b.sample(1150)!.x - 1.5) < 1e-9);
const yaw = (a: number) => ({ qx: 0, qy: Math.sin(a / 2), qz: 0, qw: Math.cos(a / 2) });
const q = new SnapshotBuffer(); q.push(0, S(yaw(0))); q.push(100, S(yaw(Math.PI / 2)));
const mid = q.sample(50)!;
check("interp: rotation slerps along the shortest arc (45° at midpoint)", Math.abs(2 * Math.atan2(mid.qy, mid.qw) - Math.PI / 4) < 1e-6);
const wrap = new SnapshotBuffer(); wrap.push(0, S(yaw(3.0))); wrap.push(100, S(yaw(-3.0)));
const wm = wrap.sample(50)!;
check("interp: no long-way-round spin across ±180°", Math.abs(Math.abs(2 * Math.atan2(wm.qy, wm.qw)) - Math.PI) < 0.2);

console.log(rows.join("\n")); console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED"); process.exit(failed ? 1 : 0);
