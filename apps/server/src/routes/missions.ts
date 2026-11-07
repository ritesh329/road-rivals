import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../utils/db";
import { wrap } from "../utils/async";
import { HttpError } from "../utils/errors";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { isUniqueViolation } from "../services/wallet";
import { claimMission, listMissions } from "../services/missions";

export const missionsRouter = Router();
missionsRouter.use(requireAuth);
missionsRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" }));
const uid = (req: unknown) => (req as AuthedRequest).userId;

missionsRouter.get("/", wrap(async (req, res) => { res.json(await prisma.$transaction((tx) => listMissions(tx, uid(req)))); }));

missionsRouter.post("/:code/claim", wrap(async (req, res) => {
  const code = z.string().min(2).max(40).regex(/^[a-z0-9_]+$/).parse(req.params.code);
  try { res.json(await prisma.$transaction((tx) => claimMission(tx, uid(req), code))); }
  catch (e) { if (isUniqueViolation(e)) throw new HttpError(409, "Reward already claimed"); throw e; }
}));
