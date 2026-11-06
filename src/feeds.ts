import { validationFormatIds } from "./formats.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { normalizeSnapshot } from "./meta.js";
import type { CardDataProvider } from "./domain.js";

export const feedInput = z.object({
  name: z.string().trim().min(1).max(150),
  url: z.url().max(1000),
  format: z.enum(validationFormatIds()),
  intervalHours: z.number().int().min(1).max(720).default(24),
  permission: z.string().trim().min(10).max(1000),
});
export function feedUrl(
  value: string,
  hosts = process.env.META_FEED_HOSTS || "raw.githubusercontent.com",
) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !hosts
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(url.hostname.toLowerCase())
  )
    throw new Error(
      "Feed URL must use HTTPS and a configured META_FEED_HOSTS hostname, without credentials, ports or fragments",
    );
  return url;
}
export async function readFeed(url: string, etag: string | null) {
  const response = await fetch(feedUrl(url), {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent":
        "MagicTester/0.1 (+https://github.com/acocalypso/magictester)",
      Accept: "application/json",
      ...(etag ? { "If-None-Match": etag } : {}),
    },
  });
  if (response.status === 304) return null;
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > 2_000_000)
    throw new Error("Feed exceeds 2 MB");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error("Empty feed response");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2_000_000) {
      await response.body.cancel().catch(() => {});
      throw new Error("Feed exceeds 2 MB");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  return {
    input: JSON.parse(body.toString("utf8")),
    digest: createHash("sha256").update(body).digest("hex"),
    etag: response.headers.get("etag")?.slice(0, 1000) || null,
  };
}
export async function listFeeds() {
  return (
    await pool.query(
      `SELECT id,name,url,format,interval_hours AS "intervalHours",permission,enabled,last_checked_at AS "lastCheckedAt",last_success_at AS "lastSuccessAt",next_check_at AS "nextCheckAt",last_error AS "lastError",snapshot_id AS "snapshotId",digest, CASE WHEN last_success_at IS NULL THEN 'never' WHEN last_success_at < now() - interval_hours * interval '2 hours' THEN 'stale' ELSE 'current' END AS freshness FROM meta_feeds ORDER BY created_at DESC`,
    )
  ).rows;
}
export async function createFeed(input: unknown) {
  const data = feedInput.parse(input);
  feedUrl(data.url);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO meta_feeds(id,name,url,format,interval_hours,permission) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, data.name, data.url, data.format, data.intervalHours, data.permission],
  );
  return (await listFeeds()).find((f) => f.id === id);
}
export async function syncFeed(
  id: string,
  cards: CardDataProvider,
  scheduled = false,
) {
  // A dedicated session lock spans the bounded network request, validation and transaction.
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,71931)) AS locked",
        [id],
      )
    ).rows[0].locked;
    if (!locked) return { busy: true };
    const feed = (
      await client.query("SELECT * FROM meta_feeds WHERE id=$1", [id])
    ).rows[0];
    if (!feed) throw new Error("Feed not found");
    if (
      scheduled &&
      (!feed.enabled || new Date(feed.next_check_at).getTime() > Date.now())
    )
      return { skipped: true };
    try {
      const downloaded = await readFeed(feed.url, feed.etag);
      let snapshotId = feed.snapshot_id;
      let normalized;
      if (downloaded && downloaded.digest !== feed.digest) {
        normalized = normalizeSnapshot(downloaded.input, cards);
        if (normalized.format !== feed.format)
          throw new Error("Feed format does not match registration");
      }
      await client.query("BEGIN");
      if (normalized) {
        snapshotId = randomUUID();
        await client.query(
          `INSERT INTO meta_snapshots(id,format,name,source,source_date,selection_method,decks,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            snapshotId,
            normalized.format,
            normalized.name,
            normalized.source,
            normalized.sourceDate || null,
            normalized.selectionMethod,
            JSON.stringify(normalized.decks),
            JSON.stringify({
              cardData: cards.provenance,
              feedId: id,
              url: feed.url,
              sha256: downloaded!.digest,
              fetchedAt: new Date().toISOString(),
              permission: feed.permission,
              weighting:
                "Job execution plan records the allocation; source shares are not inferred",
            }),
          ],
        );
      }
      await client.query(
        `UPDATE meta_feeds SET last_checked_at=now(),last_success_at=now(),next_check_at=now()+interval_hours * interval '1 hour',last_error=NULL,snapshot_id=$2,digest=coalesce($3,digest),etag=coalesce($4,etag) WHERE id=$1`,
        [id, snapshotId, downloaded?.digest || null, downloaded?.etag || null],
      );
      await client.query("COMMIT");
      return { changed: !!normalized, snapshotId };
    } catch (error) {
      await client.query("ROLLBACK");
      const message = (error as Error).message.slice(0, 1000);
      await client.query(
        `UPDATE meta_feeds SET last_checked_at=now(),next_check_at=now()+interval_hours * interval '1 hour',last_error=$2 WHERE id=$1`,
        [id, message],
      );
      throw error;
    }
  } finally {
    if (locked)
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended($1,71931))",
        [id],
      );
    client.release();
  }
}
export async function syncDueFeeds(cards: CardDataProvider) {
  const due = (
    await pool.query(
      "SELECT id FROM meta_feeds WHERE enabled AND next_check_at <= now() ORDER BY next_check_at LIMIT 10",
    )
  ).rows;
  for (const feed of due) await syncFeed(feed.id, cards, true).catch(() => {});
}
