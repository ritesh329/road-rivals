import { prisma } from "../utils/db";
import { isUniqueViolation } from "./wallet";

/**
 * Run a purchase once per idempotency key. A double-click / retry with the same requestId returns
 * `onReplay()` (current state, no second charge). Concurrent duplicates are caught by the unique
 * index on Transaction.idempotencyKey (P2002 rolls the losing transaction back).
 */
export async function idempotent<T, U = T>(key: string, run: () => Promise<T>, onReplay: () => Promise<U>): Promise<T | U> {
  const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: key } });
  if (existing) return onReplay();
  try { return await run(); } catch (e) { if (isUniqueViolation(e)) return onReplay(); throw e; }
}
