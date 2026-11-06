import { z } from "zod";
export const config = z
  .object({
    MAX_GAMES_PER_JOB: z.coerce.number().int().min(1).max(5000).default(1000),
    MAX_ACTIVE_JOBS_PER_CLIENT: z.coerce.number().int().min(1).default(3),
    MAX_QUEUED_JOBS: z.coerce.number().int().min(1).default(100),
    MAX_JOB_RUNTIME_SECONDS: z.coerce.number().int().min(30).default(21600),
    SIMULATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    MAX_FORGE_PROCESSES: z.coerce.number().int().min(1).max(8).default(1),
    MAX_DECKLIST_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(262144)
      .default(32768),
  })
  .parse(process.env);
export const redisOptions = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
};
export const ACTIVE = ["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"];
