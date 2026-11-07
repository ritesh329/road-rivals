/**
 * Runs the REAL server (routes, auth, validation) on :4000 against the in-memory Prisma double, pre-seeded.
 * For browser E2E in environments without Postgres:  npx tsx apps/server/tests/devServer.ts
 */
process.env.JWT_SECRET ??= "dev-secret-dev-secret-123456";
import http from "node:http";
import { Server } from "socket.io";
import { createMemoryPrisma } from "./memoryPrisma";
import { setPrismaForTests } from "../src/utils/db";

(async () => {
  const db = createMemoryPrisma();
  setPrismaForTests(db);
  const { seedCatalog } = await import("../../../prisma/seedCore");
  const { createApp } = await import("../src/app");
  await seedCatalog(db);
  const { registerSockets } = await import("../src/sockets");
  const server = http.createServer(createApp());
  registerSockets(new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000", credentials: true } }));
  server.listen(4000, () => console.log("MEMORY-DB server (REST + sockets) on :4000"));
})();
