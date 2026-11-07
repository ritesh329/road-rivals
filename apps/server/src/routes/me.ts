import { Router } from "express";
import { xpForNextLevel } from "@road-rivals/shared";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/", wrap(async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, wallet: true, _count: { select: { vehicles: true } } },
  });
  if (!user || !user.profile || !user.wallet) return res.status(404).json({ error: "Profile not found" });

  const active = user.profile.activeOwnershipId
    ? await prisma.vehicleOwnership.findUnique({
        where: { id: user.profile.activeOwnershipId },
        include: { vehicle: true, configuration: true, damage: true, upgrades: { include: { part: true } } },
      })
    : null;

  res.json({
    id: user.id, username: user.username, email: user.email,
    profile: { ...user.profile, xpToNext: xpForNextLevel(user.profile.level) },
    coins: user.wallet.coins,
    vehicleCount: user._count.vehicles,
    activeVehicle: active,
  });
}));
