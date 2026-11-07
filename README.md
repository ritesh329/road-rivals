# ROAD RIVALS (Phase 3 complete: damage · garage · repair · upgrades · customization)

## Requirements
Node 20+, Docker (for PostgreSQL + Redis).

## Setup
```bash
cp .env.example .env          # edit JWT_SECRET
npm install
npm run db:up                 # starts postgres + redis
npm run db:generate
npm run db:migrate -- --name init   # creates migrations/ folder
npm run db:seed
npm run dev                   # web :3000, server :4000
```
Open http://localhost:3000 → Register → Dashboard.

## Notes
- Web proxies `/api/*` to the server (see apps/web/next.config.js) so the httpOnly cookie is same-origin.
- Production: set `API_URL` for web, `CLIENT_ORIGIN` + `NODE_ENV=production` for server, run `npm run db:deploy`.
- See CHECKLIST.md for what is and isn't built yet.


## Phase 2 – driving the city
1. `npm install && npm run db:up && npm run db:generate && npm run db:migrate && npm run db:seed` (seed re-positions garages to match the 3D map)
2. `npm run dev`, log in, press **Play Now** on the dashboard (or open `/game`).
3. Controls: W/↑ gas · S/↓ brake & reverse · A/D steer · Space handbrake (drift) · Shift nitro · C camera · R respawn · N day/night · Esc menu. Phones/tablets get on-screen buttons.
4. Physics tests: `npm run test:physics -w @road-rivals/web`.

### Where things live
- `packages/shared/src/vehicle.ts` – physics parameter builder, torque curve, gearbox, damage effects (part modifier keys documented at the top).
- `packages/shared/src/world.ts` – deterministic city layout shared by client (and server in Phase 5).
- `apps/web/game/physics/RaycastVehicle.ts` – Rapier raycast controller that applies those parameters.
- `apps/web/game/components/*` – City, Vehicle, CarModel, Lighting, GameCanvas; `game/hud/*` – HUD, minimap, touch, menu.


## Phase 3 – damage, garage, upgrades
- Drive into things: damage is detected from the physics, shown on the car/HUD, saved to your account, and really slows you down.
- **My Garage** (`/garage`, from the dashboard) or press **E** on a garage pad in the city: Repair · Upgrades · Customize · Vehicle.
- Earn coins/XP by completing laps of the cyan checkpoint circuit (Free Roam). Prices, level gates and compatibility are enforced by the server.
- After pulling this update run: `npm install && npm run db:generate && npm run db:seed` (schema is unchanged – **no new migration**; the seed re-syncs the parts catalogue).
- Tests: `npm run test:all` (see TESTING.md). No-Postgres demo: `npm run dev:memory` (server on an in-memory DB) + `npm run dev -w @road-rivals/web`.
- Key files: `packages/shared/src/{damage,catalog,customization,garage,performance}.ts`, `apps/server/src/routes/{garage,vehicle,rewards}.ts`, `apps/web/game/garage/*`, `apps/web/game/components/{Vehicle,CarModel}.tsx`.


## Phase 4 – multiplayer
- Dashboard → **Create Room** / **Join Room** / **Quick Match** (or `/rooms`). Copy the invite link in the lobby and send it: whoever opens it joins *that* room (after login/register).
- Up to **5 drivers**. Host starts the session when everyone is ready; everyone drives in the same city, sees each other (name tags, minimap), can chat (**T**) and crash into each other.
- No schema change → no migration. Just `npm install` (adds `socket.io-client`) and run as before. Behind a different host/port set `NEXT_PUBLIC_SOCKET_URL` (default: same host, port 4000) and `CLIENT_ORIGIN` for CORS.
- Key files: `packages/shared/src/multiplayer.ts`, `apps/server/src/{services/rooms,services/realtime,routes/rooms,sockets/index}.ts`, `apps/web/game/net/*`, `apps/web/app/{rooms,room/[code],join/[token]}`.


## Phase 6+ – laptop & mobile friendly
- **One codebase, every screen**: laptops/desktops get the full HUD + keyboard (press **F** for full screen); phones/tablets get a compact landscape HUD with thumb controls.
- **Phones**: opening `/game` shows a **TAP TO PLAY** screen → the game goes **full screen (status bar hidden), locks to landscape** (Android Chrome/Firefox/Samsung) and keeps the screen awake. iPhone Safari can't lock rotation, so a "Rotate your phone" screen is shown while held upright; for true full screen on iPhone use **Share → Add to Home Screen** (installable app, `display: fullscreen`, landscape).
- Edge-to-edge: `viewport-fit=cover` + `env(safe-area-inset-*)` keep the HUD clear of notches/rounded corners/gesture bar while the 3D view fills the whole screen. Heights use `dvh` so mobile URL bars never cut the page.
- Tailwind screens added in `tailwind.config.ts`: `short` (height ≤ 520px = landscape phone), `touch` (coarse pointer), `tall`.
- Key files: `app/layout.tsx` (viewport/PWA), `public/manifest.webmanifest`, `game/device.ts`, `game/components/DeviceGate.tsx`, `game/hud/*`, `styles/globals.css`.
