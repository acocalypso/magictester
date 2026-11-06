import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://magictester:magictester@localhost:5432/magictester",
  max: 12,
});
export const db = drizzle(pool, { schema });
