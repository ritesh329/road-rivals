import { z } from "zod";

export const MAX_PLAYERS_PER_ROOM = 5;
export const STARTING_COINS = 5000;
export const TIERS = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "LEGEND"] as const;

export const xpForNextLevel = (level: number) => Math.round(100 * Math.pow(level, 1.5));
export const tierForLevel = (level: number) =>
  level >= 50 ? "LEGEND" : level >= 40 ? "DIAMOND" : level >= 25 ? "PLATINUM" : level >= 15 ? "GOLD" : level >= 5 ? "SILVER" : "BRONZE";

export const registerSchema = z.object({
  email: z.string().email().max(120),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, underscore only"),
  password: z.string().min(8).max(100),
});
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(100) });
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export * from "./vehicle";
export * from "./world";
export * from "./damage";
export * from "./catalog";
export * from "./customization";
export * from "./garage";
export * from "./performance";
export * from "./multiplayer";
export * from "./navigation";
export * from "./race";
export * from "./missions";
export * from "./mapdata";
export * from "./fleet";
