import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { config } from "./utils/config";
import { HttpError } from "./utils/errors";
import { authRouter } from "./routes/auth";
import { meRouter } from "./routes/me";
import { garageRouter } from "./routes/garage";
import { vehicleRouter } from "./routes/vehicle";
import { rewardsRouter } from "./routes/rewards";
import { roomsRouter } from "./routes/rooms";
import { missionsRouter } from "./routes/missions";
import { leaderboardRouter } from "./routes/leaderboard";
import { showroomRouter } from "./routes/showroom";
import { profileRouter } from "./routes/profile";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  // sendBeacon (damage flush on page close) posts text/plain – accept it as JSON as well
  app.use(express.json({ limit: "100kb", type: ["application/json", "text/plain"] }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/garage", garageRouter);
  app.use("/api/vehicle", vehicleRouter);
  app.use("/api/rewards", rewardsRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/missions", missionsRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/showroom", showroomRouter);
  app.use("/api/profile", profileRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input" });
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}
