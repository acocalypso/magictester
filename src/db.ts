import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://magictester:magictester@localhost:5432/magictester",
  // Job ownership holds a session lock; leave connections free for result writes.
  max: Math.max(12, (Number(process.env.SIMULATION_CONCURRENCY) || 16) + 4),
});
pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "database_idle_connection_error",
      error: error.message,
    }),
  );
});
export const db = drizzle(pool, { schema });
