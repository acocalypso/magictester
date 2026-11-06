import { readFile } from "node:fs/promises";
import { availableParallelism, freemem, totalmem } from "node:os";
const MiB = 1024 * 1024;
export function memoryMiB(value: string) {
  const match = /^(\d+)([kmgt]?)$/i.exec(value.trim());
  if (!match)
    throw Error("Invalid FORGE_HEAP: use a Java heap size such as 1024m or 2g");
  const bytes =
    Number(match[1]) *
    { k: 1024, m: MiB, g: 1024 * MiB, t: 1024 * 1024 * MiB, "": 1 }[
      match[2].toLowerCase()
    ]!;
  const mb = Math.ceil(bytes / MiB);
  if (mb < 128 || !Number.isFinite(mb))
    throw Error("FORGE_HEAP must be at least 128 MiB");
  return mb;
}
export type Hardware = {
  cpuCores: number;
  totalMemoryMiB: number;
  availableMemoryMiB: number;
};
async function optional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
function finiteLimit(raw: string | null) {
  if (!raw || raw.trim() === "max") return Infinity;
  const n = Number(raw);
  return n > 0 && Number.isSafeInteger(n) ? n : Infinity;
}
export function cpuQuota(raw: string | null) {
  if (!raw) return Infinity;
  const [quota, period] = raw.trim().split(/\s+/);
  return quota !== "max" && Number(quota) > 0 && Number(period) > 0
    ? Number(quota) / Number(period)
    : Infinity;
}
export function cpusetCount(raw: string | null) {
  if (!raw?.trim()) return Infinity;
  let count = 0;
  for (const part of raw.trim().split(",")) {
    const [start, end] = part.split("-").map(Number);
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      (end !== undefined && (!Number.isInteger(end) || end < start))
    )
      return Infinity;
    count += end === undefined ? 1 : end - start + 1;
  }
  return count || Infinity;
}
export async function detectHardware(): Promise<Hardware> {
  const [
    meminfo,
    v2Max,
    v2Current,
    v2Stat,
    v2Cpu,
    cpuset,
    v1Max,
    v1Current,
    v1Stat,
    v1Quota,
    v1Period,
  ] = await Promise.all([
    optional("/proc/meminfo"),
    optional("/sys/fs/cgroup/memory.max"),
    optional("/sys/fs/cgroup/memory.current"),
    optional("/sys/fs/cgroup/memory.stat"),
    optional("/sys/fs/cgroup/cpu.max"),
    optional("/sys/fs/cgroup/cpuset.cpus.effective"),
    optional("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    optional("/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    optional("/sys/fs/cgroup/memory/memory.stat"),
    optional("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
    optional("/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
  ]);
  const hostTotal =
    Number(meminfo?.match(/^MemTotal:\s+(\d+)/m)?.[1] || 0) * 1024 ||
    totalmem();
  const hostFree =
    Number(meminfo?.match(/^MemAvailable:\s+(\d+)/m)?.[1] || 0) * 1024 ||
    freemem();
  const max = finiteLimit(v2Max ?? v1Max),
    used = Number(v2Current ?? v1Current ?? 0);
  // Inactive file cache is reclaimable. Shared-memory pages are not treated as free.
  const inactive = Number(
    (v2Stat ?? v1Stat)?.match(/^(?:total_)?inactive_file\s+(\d+)/m)?.[1] || 0,
  );
  const limitedFree = Number.isFinite(max)
    ? Math.max(0, max - Math.max(0, used - inactive))
    : Infinity;
  return {
    cpuCores: Math.max(
      0.01,
      Math.min(
        availableParallelism(),
        cpuQuota(v2Cpu),
        v1Quota && v1Period
          ? cpuQuota(v1Quota.trim() + " " + v1Period.trim())
          : Infinity,
        cpusetCount(cpuset),
      ),
    ),
    totalMemoryMiB: Math.floor(Math.min(hostTotal, max) / MiB),
    availableMemoryMiB: Math.floor(Math.min(hostFree, limitedFree) / MiB),
  };
}
export type CapacityPolicy = {
  heapMiB: number;
  overheadMiB: number;
  cpuPerProcess: number;
  reserveMiB: number;
  processCap: number;
};
export function calculateCapacity(
  hardware: Hardware,
  policy: CapacityPolicy,
  residentMiB: number[] = [],
) {
  const perProcessMiB = policy.heapMiB + policy.overheadMiB;
  const reservedMemoryMiB =
    policy.reserveMiB ||
    Math.max(256, Math.min(2048, Math.ceil(hardware.totalMemoryMiB * 0.15)));
  const cpuLimit = Math.max(
    1,
    Math.floor(hardware.cpuCores / policy.cpuPerProcess),
  );
  const credited = residentMiB.reduce(
    (sum, rss) => sum + Math.min(perProcessMiB, Math.max(0, rss)),
    0,
  );
  const memoryLimit = Math.max(
    0,
    Math.floor((hardware.totalMemoryMiB - reservedMemoryMiB) / perProcessMiB),
  );
  const pressureLimit = Math.max(
    0,
    Math.floor(
      (hardware.availableMemoryMiB + credited - reservedMemoryMiB) /
        perProcessMiB,
    ),
  );
  const ceiling = policy.processCap || 16;
  const max = Math.min(16, ceiling, cpuLimit, memoryLimit, pressureLimit);
  const reason =
    max === 0
      ? "Waiting for more available memory"
      : max === ceiling && policy.processCap
        ? "Limited by the configured match cap"
        : max === cpuLimit
          ? "Limited by available CPU cores"
          : "Limited by available memory";
  return {
    ...hardware,
    max,
    cpuLimit,
    memoryLimit,
    pressureLimit,
    perProcessMiB,
    reservedMemoryMiB,
    configuredCap: policy.processCap || null,
    mode: policy.processCap ? "capped" : "automatic",
    reason,
  };
}
export class EngineScheduler {
  private waiting: {
    jobId: string;
    resolve: (lease: {
      track: (pid: number | null) => void;
      release: () => void;
    }) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  private running = new Map<symbol, { jobId: string; pid: number | null }>();
  private pumping = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval>;
  private current: ReturnType<typeof calculateCapacity> | null = null;
  constructor(
    private policy: CapacityPolicy,
    private hardware = detectHardware,
    private resident = async (pid: number) => {
      const s = await optional("/proc/" + pid + "/status");
      // File-backed RSS can already be counted as reclaimable cache; credit only anonymous pages.
      return Number(s?.match(/^RssAnon:\s+(\d+)/m)?.[1] || 0) / 1024;
    },
  ) {
    this.timer = setInterval(() => void this.pump(), 1000);
    this.timer.unref();
  }
  async refresh() {
    const snapshot = [...this.running].map(([key, slot]) => ({
      key,
      pid: slot.pid,
    }));
    const measured = await Promise.all(
      snapshot.map((s) =>
        s.pid ? this.resident(s.pid).catch(() => 0) : Promise.resolve(0),
      ),
    );
    const hardware = await this.hardware();
    const rss = measured.map((value, i) =>
      this.running.get(snapshot[i].key)?.pid === snapshot[i].pid ? value : 0,
    );
    this.current = calculateCapacity(hardware, this.policy, rss);
    return this.status();
  }
  status() {
    return {
      ...this.current,
      active: this.running.size,
      waiting: this.waiting.length,
      activeAnalyses: new Set([...this.running.values()].map((s) => s.jobId))
        .size,
    };
  }
  acquire(jobId: string, signal: AbortSignal) {
    if (signal.aborted || this.stopped)
      return Promise.reject(Error("Engine request cancelled"));
    if (this.waiting.length >= 256)
      return Promise.reject(Error("Engine wait queue is full"));
    return new Promise<{
      track: (pid: number | null) => void;
      release: () => void;
    }>((resolve, reject) => {
      const entry = {
        jobId,
        resolve,
        reject,
        signal,
        abort: () => {
          const i = this.waiting.indexOf(entry);
          if (i >= 0) this.waiting.splice(i, 1);
          reject(Error("Engine request cancelled"));
        },
      };
      signal.addEventListener("abort", entry.abort, { once: true });
      this.waiting.push(entry);
      void this.pump();
    });
  }
  async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      await this.refresh();
      while (
        this.waiting.length &&
        this.running.size < (this.current?.max || 0)
      ) {
        // Give a free slot to the analysis with the fewest running batches; FIFO breaks ties.
        const counts = new Map<string, number>();
        for (const s of this.running.values())
          counts.set(s.jobId, (counts.get(s.jobId) || 0) + 1);
        let chosen = 0;
        for (let i = 1; i < this.waiting.length; i++)
          if (
            (counts.get(this.waiting[i].jobId) || 0) <
            (counts.get(this.waiting[chosen].jobId) || 0)
          )
            chosen = i;
        const [entry] = this.waiting.splice(chosen, 1);
        entry.signal.removeEventListener("abort", entry.abort);
        if (entry.signal.aborted) {
          entry.reject(Error("Engine request cancelled"));
          continue;
        }
        const key = Symbol();
        this.running.set(key, { jobId: entry.jobId, pid: null });
        let released = false;
        entry.resolve({
          track: (pid) => {
            const slot = this.running.get(key);
            if (slot) slot.pid = pid;
          },
          release: () => {
            if (released) return;
            released = true;
            this.running.delete(key);
            void this.pump();
          },
        });
        // Refresh before each launch: running JVMs reserve their full budget while warming up.
        await this.refresh();
      }
    } catch (error) {
      for (const entry of this.waiting.splice(0)) {
        entry.signal.removeEventListener("abort", entry.abort);
        entry.reject(error as Error);
      }
    } finally {
      this.pumping = false;
    }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const entry of this.waiting.splice(0)) {
      entry.signal.removeEventListener("abort", entry.abort);
      entry.reject(Error("Engine is stopping"));
    }
  }
}
