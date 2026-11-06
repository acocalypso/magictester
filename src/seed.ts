import { randomUUID } from "node:crypto";
import { db, pool } from "./db.js";
import { snapshots } from "./schema.js";
import { CachedCardDataProvider } from "./domain.js";
import { normalizeSnapshot } from "./meta.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
const name = "Pauper · Local reference pool";
try {
  if (
    !(await db.select().from(snapshots).where(eq(snapshots.name, name))).length
  ) {
    const cards = await new CachedCardDataProvider().load();
    const data = normalizeSnapshot(
      JSON.parse(await readFile("examples/pauper-reference.json", "utf8")),
      cards,
    );
    await db
      .insert(snapshots)
      .values({
        id: randomUUID(),
        format: data.format,
        name: data.name,
        source: data.source,
        selectionMethod: data.selectionMethod,
        decks: data.decks,
        metadata: {
          purpose:
            "Project-authored integration reference lists, not a current tournament metagame.",
          cardData: cards.provenance,
          weighting: "equal games per deck",
        },
      });
    console.log(JSON.stringify({ event: "reference_pool_seeded" }));
  }
} finally {
  await pool.end();
}
