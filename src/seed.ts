import { randomUUID } from "node:crypto";
import { db, pool } from "./db.js";
import { snapshots } from "./schema.js";
import { CachedCardDataProvider } from "./domain.js";
import { FORMATS } from "./formats.js";
import { normalizeSnapshot } from "./meta.js";
import { referencePool } from "./reference-pools.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
try {
  const cards = await new CachedCardDataProvider().load();
  for (const format of FORMATS.filter((f) => f.enabled)) {
    const name = `${format.name} · Local reference pool`;
    if (
      (
        await db
          .select({ id: snapshots.id })
          .from(snapshots)
          .where(eq(snapshots.name, name))
      ).length
    )
      continue;
    const data = normalizeSnapshot(
      format.id === "pauper"
        ? JSON.parse(await readFile("examples/pauper-reference.json", "utf8"))
        : referencePool(format.id, cards),
      cards,
    );
    await db.insert(snapshots).values({
      id: randomUUID(),
      format: data.format,
      name: data.name,
      source: data.source,
      selectionMethod: data.selectionMethod,
      decks: data.decks,
      metadata: {
        purpose:
          "Project-authored reference lists, not a current tournament metagame.",
        cardData: cards.provenance,
        weighting:
          format.players === 4
            ? "equal games per rotating pod; small pools repeat lists"
            : "equal games per deck",
      },
    });
    console.log(
      JSON.stringify({ event: "reference_pool_seeded", format: format.id }),
    );
  }
} finally {
  await pool.end();
}
