/**
 * Phase 3 server integration tests: real Express app over HTTP, real auth cookies, in-memory Prisma double.
 * Run: npm run test -w @road-rivals/server
 */
process.env.JWT_SECRET = "test-secret-test-secret-123456";
process.env.NODE_ENV = "test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createMemoryPrisma } from "./memoryPrisma";
import { setPrismaForTests } from "../src/utils/db";

const db = createMemoryPrisma();
setPrismaForTests(db);

let failed = 0;
const rows: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { rows.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

(async () => {
  const { seedCatalog } = await import("../../../prisma/seedCore");
  const { createApp } = await import("../src/app");
  const { resetDamageThrottle, } = await import("../src/routes/vehicle");
  const { circuitLengthM } = await import("../src/routes/rewards");
  await seedCatalog(db);

  const server = http.createServer(createApp());
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  class Client {
    cookie = "";
    async req(method: string, path: string, body?: unknown) {
      const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
      const json: any = await res.json().catch(() => ({}));
      return { status: res.status, json };
    }
    get = (p: string) => this.req("GET", p);
    post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  }
  let n = 0; const rid = () => `req-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = async (name: string) => {
    const c = new Client();
    const r = await c.post("/api/auth/register", { email: `${name}@t.io`, username: name, password: "password123" });
    if (r.status !== 201) throw new Error("register failed " + JSON.stringify(r));
    const ov = (await c.get("/api/garage/overview")).json;
    return { c, id: r.json.id as string, own: ov.vehicles[0].ownershipId as string };
  };
  const coinsOf = async (c: Client) => (await c.get("/api/garage/overview")).json.coins as number;
  const carOf = async (c: Client) => (await c.get("/api/garage/overview")).json.vehicles[0];
  const setCoins = (uid: string, coins: number) => { db.$rows("PlayerWallet").find((w: any) => w.userId === uid).coins = coins; };
  const setLevel = (uid: string, level: number) => { db.$rows("PlayerProfile").find((p: any) => p.userId === uid).level = level; };
  const FRONT = { mag: 28, lx: 0, ly: 0, lz: -1 };

  const A = await mkUser("alice"), B = await mkUser("bob");

  // ---------- auth / baseline
  check("unauthenticated garage + damage + reward calls → 401", (await new Client().get("/api/garage/overview")).status === 401
    && (await new Client().post("/api/vehicle/damage", {})).status === 401 && (await new Client().post("/api/rewards/lap", {})).status === 401);
  const ov = (await A.c.get("/api/garage/overview")).json;
  check("overview: starter car, 5000 coins, 10 healthy components, 5 garages with services", ov.coins === 5000 && ov.vehicles.length === 1
    && Object.keys(ov.vehicles[0].damage).length === 10 && Object.values(ov.vehicles[0].damage).every((v) => v === 100) && ov.garages.length === 5 && ov.garages[0].services.length === 6);
  const parts = (await A.c.get("/api/garage/parts")).json.parts;
  check("parts catalogue served from DB: 12 part types, engine price from seed", new Set(parts.map((p: any) => p.type)).size === 12 && parts.find((p: any) => p.slug === "engine-sport").price === 3500);
  check("/api/me still works (Phase 1/2 contract intact)", (await A.c.get("/api/me")).json.activeVehicle?.upgrades?.length === 0);

  // ---------- damage persistence
  let r = await A.c.post("/api/vehicle/damage", { ownershipId: A.own, impacts: [FRONT] });
  const car1 = await carOf(A.c);
  check("damage report: server applies shared model and persists", r.status === 200 && car1.damage.FRONT_BUMPER === 0 && car1.damage.REAR_BUMPER === 100 && car1.damage.ENGINE < 100,
    `bumper ${car1.damage.FRONT_BUMPER} engine ${car1.damage.ENGINE.toFixed(0)}`);
  check("damage report: throttled (429) when spammed", (await A.c.post("/api/vehicle/damage", { ownershipId: A.own, impacts: [FRONT] })).status === 429);
  resetDamageThrottle();
  check("damage report: bob cannot damage alice's car (404)", (await B.c.post("/api/vehicle/damage", { ownershipId: A.own, impacts: [FRONT] })).status === 404);
  resetDamageThrottle();
  check("damage report: client-supplied health / bad payloads rejected (400)", (await B.c.post("/api/vehicle/damage", { ownershipId: B.own, impacts: [{ ...FRONT, mag: 1e9 }] })).status === 400
    && (await B.c.post("/api/vehicle/damage", { ownershipId: B.own, health: { ENGINE: 100 }, impacts: [] })).status === 400);
  const bCar = await carOf(B.c);
  check("damage report: failed requests left bob's car untouched", Object.values(bCar.damage).every((v) => v === 100));

  // ---------- repair
  const coins0 = await coinsOf(A.c);
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid(), expectedCost: 1 });
  check("repair: stale/forged expectedCost → 409 PRICE_CHANGED with real price", r.status === 409 && r.json.code === "PRICE_CHANGED" && r.json.cost > 1, `server price ${r.json.cost}`);
  const real = r.json.cost;
  check("repair: nothing charged on rejected request", (await coinsOf(A.c)) === coins0);
  const key = rid();
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: key, expectedCost: real });
  const car2 = await carOf(A.c);
  check("repair FULL (home): charged exactly the quote, health fully restored & persisted", r.status === 200 && r.json.cost === real && (await coinsOf(A.c)) === coins0 - real && Object.values(car2.damage).every((v) => v === 100), `paid ${real}`);
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: key });
  check("repair: same requestId replayed → no second charge", r.json.replayed === true && (await coinsOf(A.c)) === coins0 - real);
  check("repair: undamaged car → 409 nothing to repair, no charge", (await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "MINOR", requestId: rid() })).status === 409 && (await coinsOf(A.c)) === coins0 - real);
  check("repair: bob cannot repair alice's car (404) / unknown service (400)", (await B.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid() })).status === 404
    && (await B.c.post("/api/garage/repair", { ownershipId: B.own, service: "GOLD", requestId: rid() })).status === 400);

  // partial repair is cheaper and only fixes its components
  resetDamageThrottle();
  await A.c.post("/api/vehicle/damage", { ownershipId: A.own, impacts: [FRONT] });
  const beforeMinor = await coinsOf(A.c);
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "MINOR", requestId: rid() });
  const carM = await carOf(A.c);
  check("repair MINOR: fixes bumpers only, engine stays damaged, cheaper than FULL", r.status === 200 && carM.damage.FRONT_BUMPER === 100 && carM.damage.ENGINE < 100 && r.json.cost < real && (await coinsOf(A.c)) === beforeMinor - r.json.cost, `paid ${r.json.cost}`);

  // ---------- garage location rules
  const garages = (await A.c.get("/api/garage/overview")).json.garages as any[];
  const gRepair = garages.find((g) => g.kind === "REPAIR"), gFuel = garages.find((g) => g.kind === "FUEL"), gEngine = garages.find((g) => g.kind === "ENGINE_SHOP"), gWork = garages.find((g) => g.kind === "WORKSHOP");
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid(), garage: gRepair.slug, pos: { x: gRepair.x + 400, z: gRepair.z } });
  check("garage: too far away → 403", r.status === 403, r.json.error);
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid(), garage: gRepair.slug });
  check("garage: missing position → 400", r.status === 400);
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid(), garage: gFuel.slug, pos: { x: gFuel.x, z: gFuel.z } });
  check("garage: fuel stop does not offer FULL repair → 403", r.status === 403, r.json.error);
  r = await A.c.post("/api/garage/parts/buy", { partSlug: "tyres-street", requestId: rid(), garage: gRepair.slug, pos: { x: gRepair.x, z: gRepair.z } });
  check("garage: repair shop does not sell parts → 403", r.status === 403, r.json.error);
  r = await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { paint: "#22d3ee" }, requestId: rid(), garage: gEngine.slug, pos: { x: gEngine.x, z: gEngine.z } });
  check("garage: engine shop does not do paint → 403", r.status === 403, r.json.error);
  const cBefore = await coinsOf(A.c);
  r = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "ENGINE", requestId: rid(), garage: gRepair.slug, pos: { x: gRepair.x + 3, z: gRepair.z - 2 } });
  const homeEngine = r.json.cost;
  check("garage: in range at a repair shop → engine repair works (garage price, no home premium)", r.status === 200 && (await carOf(A.c)).damage.ENGINE === 100 && (await coinsOf(A.c)) === cBefore - homeEngine, `paid ${homeEngine}`);
  // home premium
  resetDamageThrottle();
  await A.c.post("/api/vehicle/damage", { ownershipId: A.own, impacts: [FRONT] });
  const hr = await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "ENGINE", requestId: rid(), expectedCost: 0 });
  check("home garage costs 1.5× the in-world price (premium)", hr.status === 409 && Math.abs(hr.json.cost / homeEngine - 1.5) < 0.2, `${hr.json.cost} vs ${homeEngine}`);
  await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid() });

  // ---------- parts shop
  setCoins(A.id, 100000);
  r = await A.c.post("/api/garage/parts/buy", { partSlug: "engine-v8", requestId: rid(), ownershipId: A.own, install: true });
  check("parts: level gate enforced by server (v8 needs level 4)", r.status === 403 && r.json.code === "LEVEL" && (await coinsOf(A.c)) === 100000, r.json.error);
  r = await A.c.post("/api/garage/parts/buy", { partSlug: "engine-sport", price: 1, requestId: rid(), ownershipId: A.own, install: true });
  check("parts: client cannot name its own price (unknown fields ignored, DB price charged)", r.status === 200 && r.json.price === 3500 && (await coinsOf(A.c)) === 100000 - 3500);
  const carE = await carOf(A.c);
  check("parts: installed + persisted (upgrade row visible, drives /api/me physics input)", carE.upgrades.some((u: any) => u.slot === "ENGINE" && u.partSlug === "engine-sport" && u.physicsModifiers.powerHp === 180)
    && (await A.c.get("/api/me")).json.activeVehicle.upgrades[0].part.slug === "engine-sport");
  r = await A.c.post("/api/garage/parts/install", { ownershipId: A.own, partSlug: "engine-sport" });
  check("parts: re-installing same part → 409", r.status === 409);
  r = await A.c.post("/api/garage/parts/install", { ownershipId: A.own, partSlug: "turbo-mini" });
  check("parts: installing something you do not own → 409", r.status === 409);
  const k = rid();
  await A.c.post("/api/garage/parts/buy", { partSlug: "tyres-sport", requestId: k });
  r = await A.c.post("/api/garage/parts/buy", { partSlug: "tyres-sport", requestId: k });
  const inv = (await A.c.get("/api/garage/parts")).json.parts.find((p: any) => p.slug === "tyres-sport").owned;
  check("parts: double-click (same requestId) buys once", r.json.replayed === true && inv === 1 && (await coinsOf(A.c)) === 100000 - 3500 - 3200);
  r = await A.c.post("/api/garage/parts/install", { ownershipId: A.own, partSlug: "tyres-sport" });
  await A.c.post("/api/garage/parts/buy", { partSlug: "tyres-street", requestId: rid(), ownershipId: A.own, install: true });
  const pl = (await A.c.get("/api/garage/parts")).json.parts;
  check("parts: replacing a part returns the old one to inventory", pl.find((p: any) => p.slug === "tyres-sport").owned === 1 && pl.find((p: any) => p.slug === "tyres-street").owned === 0
    && (await carOf(A.c)).upgrades.find((u: any) => u.slot === "TYRES").partSlug === "tyres-street");
  r = await A.c.post("/api/garage/parts/uninstall", { ownershipId: A.own, slot: "TYRES" });
  check("parts: uninstall puts it back in inventory", r.status === 200 && (await carOf(A.c)).upgrades.every((u: any) => u.slot !== "TYRES")
    && (await A.c.get("/api/garage/parts")).json.parts.find((p: any) => p.slug === "tyres-street").owned === 1);
  setLevel(A.id, 10);
  r = await A.c.post("/api/garage/parts/buy", { partSlug: "engine-v10", requestId: rid(), ownershipId: A.own, install: true });
  check("parts: category compatibility enforced (V10 does not fit the hatchback)", r.status === 403 && r.json.code === "COMPAT" && (await carOf(A.c)).upgrades.find((u: any) => u.slot === "ENGINE").partSlug === "engine-sport", r.json.error);
  setCoins(A.id, 1000);
  r = await A.c.post("/api/garage/parts/buy", { partSlug: "turbo-twin", requestId: rid() });
  check("parts: not enough coins → 402, nothing granted", r.status === 402 && (await coinsOf(A.c)) === 1000 && (await A.c.get("/api/garage/parts")).json.parts.find((p: any) => p.slug === "turbo-twin").owned === 0);
  setCoins(A.id, 1000);
  const race = await Promise.all([1, 2, 3].map(() => A.c.post("/api/garage/parts/buy", { partSlug: "brakes-sport", requestId: rid() })));
  check("parts: 3 parallel buys with money for one → exactly one succeeds (no overspend)", race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 402).length === 2 && (await coinsOf(A.c)) === 200);
  check("parts: unknown part 404, bob's installs can't target alice's car",
    (await A.c.post("/api/garage/parts/buy", { partSlug: "nope", requestId: rid() })).status === 404 && (await B.c.post("/api/garage/parts/install", { ownershipId: A.own, partSlug: "tyres-street" })).status === 404);

  // ---------- armour reduces server-side crash damage
  setCoins(A.id, 50000);
  await A.c.post("/api/garage/parts/buy", { partSlug: "armor-plating", requestId: rid(), ownershipId: A.own, install: true });
  setLevel(A.id, 10);
  await A.c.post("/api/garage/parts/buy", { partSlug: "armor-plating", requestId: rid(), ownershipId: A.own, install: true }).catch(() => null);
  resetDamageThrottle();
  await B.c.post("/api/vehicle/damage", { ownershipId: B.own, impacts: [FRONT] });
  await A.c.post("/api/garage/repair", { ownershipId: A.own, service: "FULL", requestId: rid() }).catch(() => null);
  await A.c.post("/api/vehicle/damage", { ownershipId: A.own, impacts: [FRONT] });
  const aCar = await carOf(A.c), bCar2 = await carOf(B.c);
  check("armour: same crash hurts the armoured car far less (server uses installed parts)", aCar.damage.FRONT_BUMPER > bCar2.damage.FRONT_BUMPER + 25, `${aCar.damage.FRONT_BUMPER.toFixed(0)}% vs ${bCar2.damage.FRONT_BUMPER.toFixed(0)}%`);

  // ---------- customization
  setCoins(A.id, 5000);
  const ck = rid();
  r = await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { paint: "#22d3ee", wheels: "mesh", neon: "cyan" }, requestId: ck, expectedCost: 1850 });
  const cfg = (await carOf(A.c)).config;
  check("customize: charged server-computed price (1850) and persisted", r.status === 200 && r.json.cost === 1850 && (await coinsOf(A.c)) === 3150 && cfg.paint === "#22d3ee" && cfg.wheels === "mesh" && cfg.neon === "cyan");
  r = await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { paint: "#22d3ee", wheels: "mesh", neon: "cyan" }, requestId: ck });
  check("customize: replay → no double charge", r.json.replayed === true && (await coinsOf(A.c)) === 3150);
  check("customize: invalid id / bad colour / extra field → 400", (await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { wheels: "gold" }, requestId: rid() })).status === 400
    && (await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { paint: "red" }, requestId: rid() })).status === 400
    && (await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { coins: 999 }, requestId: rid() })).status === 400);
  check("customize: no-op → 409, wrong expectedCost → 409, unaffordable → 402",
    (await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { wheels: "mesh" }, requestId: rid() })).status === 409
    && (await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { decal: "flames" }, requestId: rid(), expectedCost: 1 })).status === 409);
  setCoins(A.id, 100);
  check("customize: unaffordable → 402 and config unchanged", (await A.c.post("/api/garage/customize", { ownershipId: A.own, changes: { decal: "flames" }, requestId: rid() })).status === 402 && (await carOf(A.c)).config.decal === "none");

  // ---------- emergency patch
  resetDamageThrottle();
  await B.c.post("/api/vehicle/damage", { ownershipId: B.own, impacts: [FRONT, FRONT, FRONT] });
  setCoins(B.id, 5000);
  r = await B.c.post("/api/garage/repair", { ownershipId: B.own, service: "EMERGENCY", requestId: rid() });
  check("emergency: refused while you can afford a real repair (403)", r.status === 403);
  setCoins(B.id, 10);
  r = await B.c.post("/api/garage/repair", { ownershipId: B.own, service: "EMERGENCY", requestId: rid() });
  const bd = (await carOf(B.c)).damage;
  check("emergency: broke + wrecked → free patch lifts mechanicals to ≥35%, costs 0", r.status === 200 && r.json.cost === 0 && bd.ENGINE >= 35 && (await coinsOf(B.c)) === 10, `engine ${bd.ENGINE.toFixed(0)}`);
  resetDamageThrottle();
  await B.c.post("/api/vehicle/damage", { ownershipId: B.own, impacts: [FRONT, FRONT, FRONT] });
  r = await B.c.post("/api/garage/repair", { ownershipId: B.own, service: "EMERGENCY", requestId: rid() });
  check("emergency: 10-minute cooldown → 429", r.status === 429 && r.json.retryAfterS > 0);

  // ---------- lap reward
  const minMs = Math.round((circuitLengthM() / ((170 / 3.6) * 1.15)) * 1000 * 0.9);
  const cl = await mkUser("carol");
  r = await cl.c.post("/api/rewards/lap", { ownershipId: cl.own, lapMs: 5000 });
  check("lap reward: physically impossible lap → 422", r.status === 422 && r.json.minLapMs > 5000, `min ${r.json.minLapMs} ms (loop ${circuitLengthM().toFixed(0)} m)`);
  r = await cl.c.post("/api/rewards/lap", { ownershipId: cl.own, lapMs: minMs + 20000 });
  check("lap reward: valid lap pays 120 coins + 40 xp, persisted", r.status === 200 && r.json.coins === 5120 && r.json.xp === 40 && (await coinsOf(cl.c)) === 5120, JSON.stringify({ c: r.json.coins, xp: r.json.xp, lvl: r.json.level }));
  r = await cl.c.post("/api/rewards/lap", { ownershipId: cl.own, lapMs: minMs + 20000 });
  check("lap reward: second claim instantly (faster than real time) → 429, no payout", r.status === 429 && (await coinsOf(cl.c)) === 5120);
  check("lap reward: someone else's car → 404", (await B.c.post("/api/rewards/lap", { ownershipId: cl.own, lapMs: minMs + 20000 })).status === 404);
  // level-up path
  db.$rows("PlayerProfile").find((p: any) => p.userId === cl.id).xp = 90;
  db.$rows("Transaction").forEach((t: any) => { if (t.idempotencyKey.startsWith("lap:")) t.createdAt = new Date(Date.now() - 3600_000); });
  r = await cl.c.post("/api/rewards/lap", { ownershipId: cl.own, lapMs: minMs + 20000 });
  check("lap reward: XP rolls over into a level-up", r.status === 200 && r.json.level === 2 && r.json.leveledUp === true, `level ${r.json.level}, xp ${r.json.xp}`);
  const ledger = db.$rows("Transaction").filter((t: any) => t.userId === A.id);
  check("ledger: every spend recorded with balanceAfter and unique idempotency key", ledger.length > 8 && new Set(ledger.map((t: any) => t.idempotencyKey)).size === ledger.length && ledger.every((t: any) => Number.isInteger(t.balanceAfter) && t.balanceAfter >= 0));

  server.close();
  console.log(rows.join("\n"));
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
