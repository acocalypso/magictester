import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import robotsParser from "robots-parser";
import { pool } from "./db.js";
const agent = "MagicTester/0.1 (+https://github.com/acocalypso/magictester)";
const hosts = new Set(["www.mtgtop8.com", "mtgdecks.net"]);
export function sourceUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !hosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Unsupported metagame source URL");
  return url;
}
const shutdown = new AbortController();
export function stopSourceImports() {
  shutdown.abort();
}
export function sourceImportsStopping() {
  return shutdown.signal.aborted;
}
export class SourceNotFoundError extends Error {}
export class SourceUnavailableError extends Error {
  constructor(
    message: string,
    public retryAt?: string,
  ) {
    super(message);
  }
}
export function sourcePolicy(url: string, body: string) {
  return (
    robotsParser as unknown as (
      url: string,
      body: string,
    ) => {
      isAllowed: (url: string, agent: string) => boolean | undefined;
      getCrawlDelay: (agent: string) => number | undefined;
    }
  )(url, body);
}
export interface SourcePage {
  url: string;
  body: string;
  sha256: string;
  checkedAt: string;
}
export class SourceClient {
  readonly pages: SourcePage[] = [];
  constructor(private cacheAgeMs = 6 * 3600000) {}
  private async download(
    url: URL,
    delayMs: number,
    maxBytes = 4_000_000,
    cacheAgeMs = this.cacheAgeMs,
  ): Promise<SourcePage> {
    const cached = (
      await pool.query("SELECT * FROM source_http_cache WHERE url=$1", [
        url.href,
      ])
    ).rows[0];
    if (
      cached &&
      Date.now() - new Date(cached.checked_at).getTime() < cacheAgeMs
    )
      return {
        url: url.href,
        body: cached.body,
        sha256: cached.sha256,
        checkedAt: new Date(cached.checked_at).toISOString(),
      };
    const lock = await pool.connect();
    let locked = false;
    try {
      await lock.query("SELECT pg_advisory_lock(hashtextextended($1,77191))", [
        url.hostname,
      ]);
      locked = true;
      await lock.query(
        "INSERT INTO source_hosts(host) VALUES($1) ON CONFLICT DO NOTHING",
        [url.hostname],
      );
      const next = (
        await lock.query(
          "SELECT next_allowed_at FROM source_hosts WHERE host=$1",
          [url.hostname],
        )
      ).rows[0];
      const wait = Math.max(
        0,
        new Date(next.next_allowed_at).getTime() - Date.now(),
      );
      if (wait > 60000)
        throw new SourceUnavailableError(
          "Source is in its requested backoff period",
          new Date(next.next_allowed_at).toISOString(),
        );
      if (wait) await delay(wait, undefined, { signal: shutdown.signal });
      await lock.query(
        "UPDATE source_hosts SET next_allowed_at=now()+$2 * interval '1 millisecond' WHERE host=$1",
        [url.hostname, delayMs],
      );
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(20000), shutdown.signal]),
        headers: {
          "User-Agent": agent,
          Accept: "text/html,text/plain;q=0.9",
          ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          ...(cached?.last_modified
            ? { "If-Modified-Since": cached.last_modified }
            : {}),
        },
      });
      if (response.status === 304 && cached) {
        await lock.query(
          "UPDATE source_http_cache SET checked_at=now() WHERE url=$1",
          [url.href],
        );
        return {
          url: url.href,
          body: cached.body,
          sha256: cached.sha256,
          checkedAt: new Date().toISOString(),
        };
      }
      if (!response.ok) {
        if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
          const raw = response.headers.get("retry-after");
          const until = raw
            ? /^\d+$/.test(raw)
              ? Date.now() + Number(raw) * 1000
              : Date.parse(raw)
            : Date.now() + 3600000;
          const retryAt = new Date(
            Number.isFinite(until)
              ? Math.max(Date.now() + 5000, until)
              : Date.now() + 3600000,
          ).toISOString();
          await lock.query(
            "UPDATE source_hosts SET next_allowed_at=greatest(next_allowed_at,$2::timestamptz) WHERE host=$1",
            [url.hostname, retryAt],
          );
          throw new SourceUnavailableError(
            `Source HTTP ${response.status}: ${url.pathname}`,
            retryAt,
          );
        }
        if ([404, 410].includes(response.status))
          throw new SourceNotFoundError(
            `Source HTTP ${response.status}: ${url.pathname}`,
          );
        throw new SourceUnavailableError(
          `Source HTTP ${response.status}: ${url.pathname}`,
        );
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw new Error("Empty source response");
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes)
          throw new Error("Source response exceeds byte limit");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const charset =
        response.headers
          .get("content-type")
          ?.match(/charset=([^;\s]+)/i)?.[1] || "utf-8";
      const body = new TextDecoder(charset).decode(bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await lock.query(
        `INSERT INTO source_http_cache(url,body,sha256,etag,last_modified,checked_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(url) DO UPDATE SET body=excluded.body,sha256=excluded.sha256,etag=excluded.etag,last_modified=excluded.last_modified,checked_at=now()`,
        [
          url.href,
          body,
          sha256,
          response.headers.get("etag"),
          response.headers.get("last-modified"),
        ],
      );
      return {
        url: url.href,
        body,
        sha256,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      if (locked)
        await lock.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,77191))",
          [url.hostname],
        );
      lock.release();
    }
  }
  async get(value: string): Promise<SourcePage> {
    try {
      if (shutdown.signal.aborted)
        throw new SourceUnavailableError(
          "Source import interrupted by server shutdown",
        );
      return await this.getPage(value);
    } catch (error) {
      if (
        error instanceof SourceUnavailableError ||
        error instanceof SourceNotFoundError
      )
        throw error;
      throw new SourceUnavailableError((error as Error).message);
    }
  }
  private async getPage(value: string) {
    const url = sourceUrl(value);
    const robots = await this.download(
      new URL("/robots.txt", url),
      5000,
      100000,
      24 * 3600000,
    );
    const policy = sourcePolicy(robots.url, robots.body);
    if (policy.isAllowed(url.href, agent) === false)
      throw new SourceUnavailableError(
        `Source robots policy disallows ${url.pathname}`,
      );
    const delay = Math.max(5000, (policy.getCrawlDelay(agent) || 0) * 1000);
    const page = await this.download(url, delay);
    this.pages.push(page);
    return page;
  }
}
