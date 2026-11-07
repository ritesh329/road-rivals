# ROAD RIVALS – Testing (Phase 3)

## Automated suites (all run and passing when this phase was delivered)
| Command | What it proves | Result |
|---|---|---|
| `npm run test -w @road-rivals/shared` | (now also multiplayer protocol: room codes, chat cleaning, state validation, plausibility, snapshot interpolation) catalogue integrity, every part changes physics params, impact→damage model, detector, repair quotes, customization pricing/validation, report schema | 49/49 |
| `npm run test -w @road-rivals/server` | real Express app over HTTP: auth, damage persistence, repairs, garage proximity/caps, shop (level/compat/price/atomic spend/idempotency/races), armour, customization, emergency patch, lap rewards, ledger | 50/50 |
| `npm run test:physics -w @road-rivals/web` | Phase 2 Rapier tests (engine, turbo, nitro, gearbox, tyres, brakes, suspension, spoiler, armour, damage…) | 24/24 (no regression after the thermal model) |
| `npm run test:phase3 -w @road-rivals/web` | Rapier: wall crashes at 18/50/100 km/h, side hit, landing, no phantom damage, armour, crash→slower car, radiator damage → overheating, COOLING fix, differential, estimator vs real sim | all pass |
| `npm run test:rooms -w @road-rivals/server` | **Phase 4**: REST room rules (invite→correct room, 5-seat race, kick/lock/rotate/start/stop/host migration/quick match/public list) + **real Socket.IO with 5 clients**: live lobby, 5-player position sync, hack/flood/garbage rejection, chat, presence + grace leave, late join, kick | 58 checks |
| `npm run test:all` | everything above | |

## Browser E2E (headless Chromium, real UI + real server code)
`apps/web/tests/e2e/phase3.e2e.py` (Python Playwright). Needs `pip install playwright && playwright install chromium`.
1. `npm run dev:memory` (server :4000, in-memory DB) and `npm run dev -w @road-rivals/web` (web :3000)
2. `python3 apps/web/tests/e2e/phase3.e2e.py` → screenshots in /tmp/shots.
It registers a user, opens My Garage, repairs, buys/installs parts, customizes, loads the game, teleports to a garage (dev-only hook), opens the garage with **E**, then drives into the city until a real collision happens and checks the damage reached the server. 18/18 passed.

## What was NOT run here – please run on your machine (needs Docker/Postgres)
The delivery sandbox had no Postgres and could not download Prisma's engine binaries, so the **server tests used `apps/server/tests/memoryPrisma.ts`**: an in-memory stand-in generated from your real `schema.prisma` (fields, enums, defaults, unique/compound constraints, relations, transaction rollback). It runs the real routes, but it is not Postgres. Please run once:
```
docker compose up -d
npm install && npm run db:generate && npm run db:migrate && npm run db:seed
npm run dev
```
then manually: register → My Garage → damage via a crash in /game → repair → buy engine/tyres → customize → reload (everything must persist). Expected real-DB differences to watch: the `P2002` handling on duplicate `requestId`, and concurrent purchases (the `coins >= price` update is atomic in Postgres).

## Manual checklist
- [ ] Hit a wall at ~100 km/h: bumper hangs/falls off, smoke, HUD condition panel, car feels weaker
- [ ] Reload the page: damage is still there; repair at a garage pad (E) restores it and charges coins
- [ ] Install Sport Compound tyres / brakes: cornering and braking visibly change; Vehicle tab numbers agree
- [ ] Radiator at 0 % + long full-throttle run → ENGINE OVERHEATING; a Cooling part fixes it
- [ ] Customize preview on the car before paying; after Apply it survives reload
- [ ] Complete a lap: +120 coins/+40 XP; level-ups unlock higher parts


## Phase 4 – multiplayer browser E2E (5 real browsers)
`apps/web/tests/e2e/phase4.multiplayer.e2e.py` – start `npm run dev:memory` + `npm run dev -w @road-rivals/web`, then run it (≈3 min on software GL, it opens 5 browsers):
host creates a room → new user opens the invite link logged-out → registers → lands in the right room → 3 more join → 6th is refused → chat → ready/start → 5 browsers enter the world → every one sees the 4 other cars + name tags → positions match → in-game chat → A rams B (damage) → a player leaves and the others drop the car.
Manual multiplayer check on real Postgres: open 2–5 browser profiles (or phones on the same Wi-Fi with your PC's IP: set `CLIENT_ORIGIN` and `NEXT_PUBLIC_SOCKET_URL` accordingly).

## Phase 5 – how to test
Automated (no database needed):
- `npm test -w @road-rivals/shared` → navigation (A*, turns, re-route), race tracker, rewards, drift anti-fake, missions/period keys (54 checks in `phase5.test.ts`).
- `npm run test:race -w @road-rivals/server` → race life-cycle with a fake clock (36 checks): countdown, grid teleport, gate credit, DNF, tournament rounds, abort, drift validation.

Manual (needs Postgres + two browsers):
1. Dashboard → **Time Trial** → the 5-4-3-2-1 countdown runs on the grid, drive through the orange gate beam 33 times (3 laps) → results with medal, coins/XP added (check `/api/leaderboard`, `/missions`).
2. `/rooms` → create a room with mode *Multiplayer Race*, join with a second browser, host starts the session, in the world the host presses **Start race**.
3. Press **R** during a race → you reappear behind the last gate you passed.
4. `/map` → click *Nearest repair garage* → **Drive there** → the cyan route follows streets, the banner counts down turns, driving off route re-routes, arriving clears it.
5. `/missions` → after a race the "Warm-up" progress moves; **Claim** pays once (second click → 409).

## Phase 6
Tested (automated): `packages/shared` fleet/achievement/level/purchase-rule logic (`tests/phase6.test.ts`).
NOT executed here (no DB/network in build sandbox): server routes (showroom, profile, leaderboard, achievements, progress) and all web pages – only syntax-checked. Please run the manual checklist.
Showroom self-heals the catalog; `npm run db:seed` is optional.
