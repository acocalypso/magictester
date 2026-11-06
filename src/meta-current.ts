import { pool } from "./db.js";
export async function currentMetagame(format: string) {
  const row = (
    await pool.query(
      `SELECT s.*,f.id AS feed_id,f.name AS feed_name,f.last_success_at,f.last_checked_at,f.next_check_at,f.last_error,f.enabled FROM meta_feeds f LEFT JOIN meta_snapshots s ON s.id=f.snapshot_id WHERE f.format=$1 AND f.provider!='json' ORDER BY f.enabled DESC,f.last_success_at DESC NULLS LAST LIMIT 1`,
      [format],
    )
  ).rows[0];
  if (!row) return { status: "unconfigured", snapshot: null };
  const stale =
    !row.last_success_at ||
    Date.now() - new Date(row.last_success_at).getTime() > 26 * 3600000;
  const snapshot = row.id
    ? {
        id: row.id,
        format: row.format,
        name: row.name,
        source: row.source,
        sourceDate: row.source_date,
        selectionMethod: row.selection_method,
        decks: row.decks,
        metadata: row.metadata,
        createdAt: row.created_at,
      }
    : null;
  const refreshing =
    !row.last_error &&
    row.last_checked_at &&
    (!row.last_success_at ||
      new Date(row.last_checked_at).getTime() >
        new Date(row.last_success_at).getTime());
  const status = !row.enabled
    ? "paused"
    : !snapshot
      ? refreshing
        ? "refreshing"
        : row.last_error
          ? "error"
          : "pending"
      : stale
        ? "stale"
        : row.last_error
          ? "degraded"
          : refreshing
            ? "refreshing"
            : "current";
  return {
    status,
    snapshot,
    feedId: row.feed_id,
    feedName: row.feed_name,
    lastSuccessAt: row.last_success_at,
    nextCheckAt: row.next_check_at,
    error: row.last_error,
  };
}
