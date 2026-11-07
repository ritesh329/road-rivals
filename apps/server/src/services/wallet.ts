import type { Prisma, TransactionType } from "@prisma/client";
import { HttpError } from "../utils/errors";
import { recordEvents } from "./missions";

type Tx = Prisma.TransactionClient;

/**
 * Atomically take `amount` coins and write the ledger row. Must run inside prisma.$transaction.
 * The `coins >= amount` condition lives in the UPDATE itself, so two concurrent purchases can
 * never overspend. `idempotencyKey` is unique – a replayed request fails with P2002 and is
 * answered as a replay by `runIdempotent`.
 */
export async function spend(tx: Tx, userId: string, amount: number, type: TransactionType, idempotencyKey: string, meta: Prisma.InputJsonValue): Promise<number> {
  if (!Number.isInteger(amount) || amount < 0) throw new HttpError(400, "Invalid amount");
  if (amount > 0) {
    const r = await tx.playerWallet.updateMany({
      where: { userId, coins: { gte: amount } },
      data: { coins: { decrement: amount }, version: { increment: 1 } },
    });
    if (r.count !== 1) throw new HttpError(402, "Not enough coins");
  }
  const w = await tx.playerWallet.findUnique({ where: { userId } });
  if (!w) throw new HttpError(404, "Wallet not found");
  await tx.transaction.create({ data: { userId, type, amount: -amount, balanceAfter: w.coins, idempotencyKey, meta } });
  // garage purchases feed the "Pit Stop" mission (same transaction → a replayed request never counts twice)
  if (amount > 0 && (type === "REPAIR" || type === "PURCHASE_PART" || type === "CUSTOMIZATION")) await recordEvents(tx, userId, [{ event: "GARAGE_SERVICE", amount: 1 }]);
  return w.coins;
}

export async function earn(tx: Tx, userId: string, amount: number, type: TransactionType, idempotencyKey: string, meta: Prisma.InputJsonValue): Promise<number> {
  const w0 = await tx.playerWallet.findUnique({ where: { userId } });
  if (!w0) throw new HttpError(404, "Wallet not found");
  await tx.playerWallet.update({ where: { userId }, data: { coins: { increment: amount }, version: { increment: 1 } } });
  const w = await tx.playerWallet.findUnique({ where: { userId } });
  await tx.transaction.create({ data: { userId, type, amount, balanceAfter: w!.coins, idempotencyKey, meta } });
  return w!.coins;
}

export const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
