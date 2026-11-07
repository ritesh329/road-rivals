import { PrismaClient } from "@prisma/client";

/**
 * Lazy singleton. Every module imports `prisma` from here; tests can swap the client with
 * `setPrismaForTests()` (the in-memory Prisma double in tests/memoryPrisma.ts) so the full
 * HTTP stack can be exercised without a Postgres server.
 */
let client: PrismaClient | undefined;
export const getPrisma = () => (client ??= new PrismaClient());
export function setPrismaForTests(c: unknown) { client = c as PrismaClient; }

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = getPrisma() as any;
    const v = c[prop];
    return typeof v === "function" ? v.bind(c) : v;
  },
});
