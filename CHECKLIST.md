# ROAD RIVALS – Implementation Checklist
Legend: [x] implemented · [ ] not yet · (UNTESTED) = written, not yet run end-to-end

## Phase 1
- [x] Monorepo (npm workspaces): apps/web, apps/server, packages/shared
- [x] Complete Prisma schema – all 26 required models, relations, indexes (UNTESTED: run migrate)
- [x] Seed: starter vehicles, engine tiers, garages + services (UNTESTED)
- [x] Express backend, helmet, CORS, rate-limited auth (UNTESTED)
- [x] Register / Login / Logout (bcrypt + JWT httpOnly cookie) (UNTESTED)
- [x] Atomic signup: user + profile + wallet + starter car + damage rows + transaction log
- [x] /api/me profile endpoint
- [x] Socket.IO authenticated handshake
- [x] Next.js landing, login, register, dashboard (UNTESTED)
- [x] Dashboard: **Play Now** now launches the 3D game; other buttons stay disabled until their phase

## Phase 2 – 3D world, R3F, Rapier raycast vehicle
- [x] Prisma schema replaced with the new formatted version (verified token-identical to Phase 1 → no migration change)
- [x] Next.js `/game` page (auth-gated, loads active car + upgrades + damage from `/api/me`)
- [x] R3F scene: "Neon City" 11×11 grid, ~250 buildings (instanced, procedural window shader), parks, parking lots, canal with 11 bridges, tunnel, jump ramps, highway barriers, perimeter walls, lamps, trees
- [x] Garage pads (5, from shared layout; seed now uses the same coordinates), checkpoint circuit with lap timing (client-side; server validation in Phase 5)
- [x] Rapier **raycast vehicle** (4 wheels, suspension, tyre friction, steering, brakes) – no position translation
- [x] Shared physics model: torque curve, 6-speed auto gearbox, drag/downforce, turbo, nitro, brake force, suspension, damage effects – built from `VehiclePart.physicsModifiers`
- [x] Controls: W/S/A/D + arrows, Space handbrake (drift), Shift nitro, C camera, R respawn, N day/night, Esc menu; mobile touch buttons
- [x] Cameras: chase, hood, first-person; speed-based FOV; fixed 60 Hz physics with render interpolation
- [x] HUD (speed, gear, RPM, turbo, nitro, lap timer), heading-up minimap, procedural RPM-driven engine sound (timbre depends on installed engine)
- [x] Day/night lighting + shadows, Low/Medium/High graphics, dynamic resolution, WebGL fallback message
- [x] **24 headless physics tests pass** (`npm run test:physics -w @road-rivals/web`) – real Rapier simulation comparing stock vs engine/turbo/nitro/gearbox/tyres/brakes/suspension/spoiler/armor/damage
- [x] Browser-verified (headless Chromium + SwiftShader): scene renders, car accelerates through gears, cameras and night mode work
- [ ] Not yet (later phases): traffic, desert/snow/coast/industrial/forest maps, asset streaming, mesh LOD, collision damage + garage services (Phase 3), multiplayer (Phase 4)
- Note: upgrade *installation* UI/backend is Phase 3; the physics already consumes installed parts, proven by the tests above.

## Phase 3 – Damage, garage, repair, engine/upgrade physics
Legend for this phase: **[T]** = covered by an automated test that was actually run; **[B]** = verified in headless Chromium against the real UI; (PG) = needs a run against real Postgres (see TESTING.md – the sandbox had no Postgres, so server tests used a schema-driven in-memory Prisma double).
- [x] **Collision damage** from the real Rapier simulation: per-step Δv `ImpactDetector` → impact (magnitude + direction in car frame) → per-component damage (front/rear/side/landing zones, internals only on hard hits) **[T]**
- [x] No false positives: launch, slalom, handbrake drifts, hard braking, settling → 0 impacts **[T]**
- [x] Damage **changes the physics** (power, grip, braking, suspension, gearbox, cooling) and is hot-swapped without respawning the car **[T][B]**
- [x] Damage **persisted**: client batches impacts → `POST /api/vehicle/damage`; server recomputes with the shared model + the *installed armour* (client never sends health) **[T][B]**
- [x] Visible damage on the 3D car: bumpers hang/crumple/fall off, dented/dropped doors, engine smoke / radiator steam, HUD condition panel, camera shake + crash sound **[B]**
- [x] **Repair garage**: Minor / Medium / Engine / Tyres / Full / free Emergency Patch (only if you can't afford a full repair, 10-min cooldown); price = base × damage × car value (× 1.5 at home) **[T]**
- [x] Garage rules: kinds offer different services (repair shop / fuel stop / engine shop / workshop), proximity to the pad validated server-side (plausibility – see limits) **[T]**
- [x] **Upgrade shop**: all 12 part types, 38 parts, level + vehicle-category gates, buy / install / replace (old part returns to inventory) / uninstall **[T][B]**
- [x] **Every part changes real physics** (test: each best-tier part produces different physics params; Rapier tests for armour, cooling, differential and the earlier Phase 2 set) **[T]**
- [x] New physics: **engine thermal model** (heat ∝ load × power, nitro ×2.5, airflow cooling, derate above 85 %) so COOLING parts and RADIATOR damage matter; HUD temp gauge + overheat warning **[T]**
- [x] Live "before → after" numbers in the garage (0-100, top speed, braking, cornering, mass, cooling, nitro, armour) from `estimatePerformance` – the same drivetrain model, checked against Rapier within 20 % **[T]**
- [x] **Customization** (9 slots: paint incl. custom colour, wheels, rim colour, spoiler style, body kit, bumpers, decals, underglow, exhaust) – server-priced, persisted, rendered as real geometry with live 3D preview before purchase **[T][B]**
- [x] Backend validation of every purchase: price only from DB/shared catalogue, atomic `coins >= price` conditional update, idempotency keys (double-click safe), `expectedCost` stale-price guard (409), ownership checks (404), ledger row with `balanceAfter` **[T]** (PG)
- [x] Home garage page `/garage` (3D turntable + same panel) and in-world garage (E / touch button on a garage pad; car is held still, view slides so the car stays visible) **[T][B]**
- [x] Minimal earn loop so upgrades are reachable: free-roam **lap reward** (120 coins + 40 XP, XP rolls into levels), validated against the car's physical top speed, real-time cooldown and a 30/day cap **[T]** (full economy = Phase 6)
- [x] Seed re-synced from `packages/shared/src/catalog.ts` (single source of truth; engine prices rebalanced, slugs unchanged)
- [x] Prisma schema **unchanged** → no new migration needed
- Known limits (honest): damage/lap/position reports are client-reported until the authoritative server simulation (Phase 5); a modified client could omit its own damage reports (that only ever helps that one cheater; it cannot repair, grant coins or touch other players). Tyre/brake *wear* over distance is not modelled. Only the starter car exists until the Showroom (Phase 6).
## Phase 4 – Rooms, invite links, 5-player sync       [ ]
## Phase 5 – Race modes, map/GPS, missions           [ ]
## Phase 6 – Economy, XP, showroom, leaderboard       [ ]
## Phase 7 – Security hardening, perf, tests, deploy  [ ]


## Phase 4 – Multiplayer rooms, invite links, 5-player realtime sync
Legend: **[T]** automated test actually run · **[B]** verified in real headless Chromium with 5 simultaneous browsers (PG) = still needs your Postgres run.
- [x] Room model reused from the schema (`GameRoom`, `RoomMembership`) → **no new migration**
- [x] Create room (public/private, 2–5 seats), 6-char unambiguous codes, unguessable invite token (`/join/<token>`) **[T][B]**
- [x] **Invite links join the correct room**: two rooms/two tokens test; logged-out visitors see who invited them, log in / register and land in THAT room (`?next=`); preview never leaks the room code **[T][B]**
- [x] Join by code (case-insensitive), quick match, public room list; a user is in one room at a time (auto-leave) **[T][B]**
- [x] **5 players max, race-proof**: 3 parallel joins for the last seat → exactly one wins (row-lock `lockRoom`), 6th refused **[T][B]** (PG – lock semantics are Postgres-specific)
- [x] Host controls: kick (kicked user can never re-enter), lock, public/private, rotate invite link (old link dies), ready/start/stop, host migration, room closes when empty **[T][B]**
- [x] Live lobby over Socket.IO: members, ready state, presence (online/offline), chat with history **[T][B]**
- [x] Start → 3 s countdown → every client enters the same 3D city; server assigns seats/spawn grid; late join into a running session **[T][B]**
- [x] **Realtime car sync @20 Hz**: every client sends pose, server validates + rebroadcasts, clients interpolate (120 ms buffer, slerp, capped extrapolation) **[T][B]**
- [x] Appearance of every car (model, paint, wheels, spoiler, neon, damage, parts) comes from the server DB, not from the client **[T][B]**
- [x] **Cars collide with each other**: remote cars are kinematic Rapier bodies; hits go through the same impact → damage pipeline **[B]** (rammed car: bumper 100 → 64)
- [x] Anti-cheat / robustness: schema validation, plausibility (speed vs the car's physical top speed → rejected + snap-back), flood control (200 pkts → handful delivered), malformed packets counted as strikes, chat sanitised + rate limited **[T]**
- [x] Presence grace: disconnected player stays 45 s (configurable), then seat is freed; reconnect re-joins automatically **[T]**
- [x] HUD: player list with live speed, LIVE/RECONNECTING, minimap dots per seat colour, name tags, chat (T) **[B]**
- [x] Pages: `/rooms` (create / join / quick / public list), `/join/[token]`, `/room/[code]`; dashboard Create Room / Join Room / Quick Match are live
- Known limits (honest): positions are client-authoritative with plausibility checks (full server-side simulation / race validation = Phase 5); no friends/party invites yet; chat history is in server memory (lost on restart); with several browsers on a software GPU the sim runs slowly, real GPUs are fine.

## Phase 5 – Race modes, map/GPS, missions
Legend: **[T]** automated test actually run (no DB/network needed) · **[U]** written + syntax/type-sanity checked but NOT executed (needs `npm install`, Postgres and a browser – run `npm run test:race -w @road-rivals/server`, `npm test -w @road-rivals/shared` and the manual steps in TESTING.md).
- [x] **8 race modes**: Multiplayer (3 laps), Quick (1 lap), Private (2 laps, invite-only), Time Trial (solo, 3 laps, gold/silver/bronze), Drift Challenge (90 s), Checkpoint Race (45 s + 12 s per gate), Tournament (3 rounds × 2 laps, championship points), Survival (last place out every 20 s) **[T]**
- [x] **Server-authoritative race engine** (`RaceTracker`): gates must be crossed in order, forward, within ±11 m; skipped gate / wrong way / 40 m beside the gate / jump start = nothing counts; laps, finish, DNF window (60 s after the winner), live positions **[T]**
- [x] Clients never report checkpoints, laps, drift or results – the server derives them from positions it already validated (speed plausibility). Respawn during a race = server puts you behind the last gate you really passed **[T]**
- [x] Drift score from **measured slip** (heading vs. travel direction from the validated state), combo up to ×5, fake velocity that contradicts the real movement scores 0 **[T]**
- [x] Race life-cycle with fake clock: 5 s countdown on a starting grid, GO, standings @2.5 Hz, results, tournament auto-next-round after 15 s, field shrinking, host abort **[T]**
- [x] Rewards (coins/XP/leaderboard points) computed server-side by position, field size, mode (private/solo pay less), medals; 40 rewarded races/day cap; ledger row unique per race+user; Race/Participant/Result rows, season leaderboard, `racesPlayed/racesWon` (U – needs Postgres)
- [x] **GPS navigation on the real road network**: A* over the 11×11 intersection graph, snaps start/destination to roads, bridges over the canal only, turn-by-turn ("Turn left in 120 m"), progress, off-route → automatic re-route, arrival detection **[T]**
- [x] **World map** (`/map` page and in-game overlay, key **M**): pan/zoom, 5 garages of 4 kinds, race events, tournament venue, circuit checkpoints, live drivers of your room, "Nearest repair garage" (by road distance), set waypoint → route on map + minimap + HUD banner (U)
- [x] Minimap shows route, waypoint, all POIs and the next race gate (U)
- [x] **Missions**: 7 daily + 7 weekly, server-counted from validated events (race finished/won, laps, gates, drift points, driven distance in sessions, garage purchases, tournament, survival), claim once (conditional UPDATE + unique ledger key), UTC day / ISO week reset **[T for rules]** (DB part U)
- [x] Solo challenges (Time Trial / Drift / Checkpoint): one click → one-seat private room, server starts the run itself (U); lobby mode picker for hosts; quick match creates Quick-Race rooms (U)
- [x] Race HUD: start button (host), countdown, position / lap / gate, drift score, time left, live standings, event feed, results table with rewards, tournament table (U)
- Known limits (honest): friends list does not exist yet – the map's "Drivers" are the players in your session; only one map (Neon City – desert/snow/coast/forest maps are not built); distance/exploration missions count only inside rooms/solo challenges (free roam has no server link); drift/gate checks rely on the existing plausibility model, not a full server physics simulation (Phase 7); two colluding accounts can still farm the daily-capped race reward; a driver who disconnects mid-race is DNF (no race reconnect yet).

## Phase 6 – Economy, Showroom, Inventory, Leaderboard, Profile
- [ ] /showroom: 10 cars, category chips, 3D turntable, stat bars, locked cars show "Reach level N"
- [ ] Buy a car with enough coins + level -> coins drop, car becomes active; double-click does not charge twice
- [ ] Buying with too few coins / too low level is refused by the server
- [ ] /inventory lists owned cars + spare parts, Select switches active car
- [ ] /leaderboard tabs Season / Wins / Level, your row highlighted, your rank shown if outside top 20
- [ ] /profile: XP bar, tier badge, stats, avatar picker, achievements progress, coin history
- [ ] Level-up pays a one-time coin bonus; achievements pay once
