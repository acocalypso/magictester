// Desktop transport: same allowlist/robots/backoff policy, persistent SQLite cache.
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import robotsParser from "robots-parser";
const agent = "MagicTester/0.1 (+https://github.com/acocalypso/magictester)";
const shutdown = new AbortController();
let store: any;
const hosts = new Map<string, Promise<void>>();
export function configureSourceCache(value: any) {
  store = value;
}
export function stopSourceImports() {
  shutdown.abort();
}
export function sourceImportsStopping() {
  return shutdown.signal.aborted;
}
export function sourceUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["www.mtgtop8.com", "mtgdecks.net"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("Unsupported metagame source URL");
  return url;
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
    maxBytes = 4000000,
    age = this.cacheAgeMs,
  ): Promise<SourcePage> {
    if (!store) throw Error("Desktop source cache has not been opened");
    const previous = hosts.get(url.hostname) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    hosts.set(
      url.hostname,
      previous.then(() => gate),
    );
    await previous;
    try {
      const cached = store.get(
        "SELECT * FROM http_cache WHERE url=?",
        url.href,
      );
      if (cached && Date.now() - Date.parse(cached.checked_at) < age)
        return {
          url: url.href,
          body: cached.body,
          sha256: cached.sha256,
          checkedAt: cached.checked_at,
        };
      const next =
        store.get("SELECT next_at FROM source_hosts WHERE host=?", url.hostname)
          ?.next_at || 0;
      const wait = Math.max(0, next - Date.now());
      if (wait > 60000)
        throw new SourceUnavailableError(
          "Source is in its requested backoff period",
          new Date(next).toISOString(),
        );
      if (wait) await delay(wait, undefined, { signal: shutdown.signal });
      store.run(
        "INSERT INTO source_hosts VALUES(?,?) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at",
        url.hostname,
        Date.now() + delayMs,
      );
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(20000)]),
        headers: {
          "User-Agent": agent,
          Accept: "text/html,text/plain;q=0.9",
          ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
          ...(cached?.last_modified
            ? { "If-Modified-Since": cached.last_modified }
            : {}),
        },
      });
      const checkedAt = new Date().toISOString();
      if (response.status === 304 && cached) {
        store.run(
          "UPDATE http_cache SET checked_at=? WHERE url=?",
          checkedAt,
          url.href,
        );
        return {
          url: url.href,
          body: cached.body,
          sha256: cached.sha256,
          checkedAt,
        };
      }
      if (!response.ok) {
        if ([404, 410].includes(response.status))
          throw new SourceNotFoundError(`Source HTTP ${response.status}`);
        const raw = response.headers.get("retry-after");
        const until = raw
          ? /^\d+$/.test(raw)
            ? Date.now() + Number(raw) * 1000
            : Date.parse(raw)
          : Date.now() + 3600000;
        const retry = Number.isFinite(until)
          ? Math.max(Date.now() + 5000, until)
          : Date.now() + 3600000;
        store.run(
          "UPDATE source_hosts SET next_at=max(next_at,?) WHERE host=?",
          retry,
          url.hostname,
        );
        throw new SourceUnavailableError(
          `Source HTTP ${response.status}`,
          new Date(retry).toISOString(),
        );
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw Error("Empty source response");
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw Error("Source response exceeds byte limit");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      const charset =
        response.headers
          .get("content-type")
          ?.match(/charset=([^;\s]+)/i)?.[1] || "utf-8";
      const body = new TextDecoder(charset).decode(bytes);
      store.run(
        "INSERT INTO http_cache VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET body=excluded.body,sha256=excluded.sha256,checked_at=excluded.checked_at,etag=excluded.etag,last_modified=excluded.last_modified",
        url.href,
        body,
        sha256,
        checkedAt,
        response.headers.get("etag"),
        response.headers.get("last-modified"),
      );
      return { url: url.href, body, sha256, checkedAt };
    } finally {
      release();
    }
  }
  async get(value: string): Promise<SourcePage> {
    try {
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
      const page = await this.download(
        url,
        Math.max(5000, (policy.getCrawlDelay(agent) || 0) * 1000),
      );
      this.pages.push(page);
      return page;
    } catch (error) {
      if (
        error instanceof SourceNotFoundError ||
        error instanceof SourceUnavailableError
      )
        throw error;
      throw new SourceUnavailableError((error as Error).message);
    }
  }
}
