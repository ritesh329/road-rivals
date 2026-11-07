import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) throw new Error("JWT_SECRET missing or too short (min 16 chars). Check .env");
export const config = {
  port: Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4000),
  jwtSecret: secret,
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000",
  isProd: process.env.NODE_ENV === "production",
  /** how long a player may be disconnected before being removed from their room */
  presenceGraceMs: Number(process.env.PRESENCE_GRACE_MS ?? 45_000),
};
