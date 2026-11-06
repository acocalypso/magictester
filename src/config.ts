import { z } from "zod";
export const config = z
  .object({
    MAX_GAMES_PER_JOB: z.coerce.number().int().min(1).max(5000).default(1000),
    MAX_ACTIVE_JOBS_PER_CLIENT: z.coerce.number().int().min(1).default(3),
    MAX_QUEUED_JOBS: z.coerce.number().int().min(1).default(100),
    MAX_JOB_RUNTIME_SECONDS: z.coerce.number().int().min(30).default(21600),
    SIMULATION_CONCURRENCY: z.coerce.number().int().min(0).max(16).default(0),
    MAX_FORGE_PROCESSES: z.coerce.number().int().min(0).max(16).default(0),
    FORGE_CPUS_PER_PROCESS: z.coerce.number().int().min(1).max(8).default(2),
    FORGE_MEMORY_OVERHEAD_MB: z.coerce
      .number()
      .int()
      .min(256)
      .max(4096)
      .default(512),
    FORGE_MEMORY_RESERVE_MB: z.coerce
      .number()
      .int()
      .min(0)
      .max(131072)
      .default(0),
    FORGE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
    MAX_DECKLIST_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(262144)
      .default(32768),
  })
  .parse(process.env);
export const redisOptions = {
  // ioredis 6 defaults to RESP3; preserve the existing queue wire protocol.
  protocol: 2 as const,
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
};
export const ACTIVE = ["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"];
