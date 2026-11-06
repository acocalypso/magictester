import { Queue } from "bullmq";
import { redisOptions } from "./config.js";
export const queue = new Queue("simulations", {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});
export async function enqueue(id: string) {
  await queue.add("benchmark", { id }, { jobId: id });
}
