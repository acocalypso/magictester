import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCapacity,
  cpuQuota,
  cpusetCount,
  memoryMiB,
  EngineScheduler,
} from "../src/resources.js";
import { interleave, partitionIndices, runParallel } from "../src/parallel.js";
const policy = {
  heapMiB: 1024,
  overheadMiB: 512,
  cpuPerProcess: 2,
  reserveMiB: 0,
  processCap: 0,
};
const hardware = {
  cpuCores: 8,
  totalMemoryMiB: 8192,
  availableMemoryMiB: 7000,
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
test("capacity respects Docker CPU/memory limits, explicit caps and memory pressure", () => {
  assert.equal(cpuQuota("150000 100000"), 1.5);
  assert.equal(cpuQuota("max 100000"), Infinity);
  assert.equal(cpusetCount("0-3,6"), 5);
  assert.equal(memoryMiB("2g"), 2048);
  assert.equal(memoryMiB("1024m"), 1024);
  assert.throws(() => memoryMiB("1.5g"));
  assert.equal(calculateCapacity(hardware, policy).max, 3);
  assert.equal(calculateCapacity({ ...hardware, cpuCores: 2 }, policy).max, 1);
  assert.equal(
    calculateCapacity(
      { ...hardware, totalMemoryMiB: 2048, availableMemoryMiB: 2000 },
      policy,
    ).max,
    1,
  );
  assert.equal(
    calculateCapacity(hardware, { ...policy, processCap: 2 }).max,
    2,
  );
  assert.equal(
    calculateCapacity({ ...hardware, availableMemoryMiB: 1800 }, policy).max,
    0,
  );
  // Existing JVM RSS is counted once; not-yet-used heap remains reserved.
  assert.equal(
    calculateCapacity({ ...hardware, availableMemoryMiB: 3000 }, policy, [1000])
      .max,
    1,
  );
  assert.equal(
    calculateCapacity(
      { ...hardware, availableMemoryMiB: 3000 },
      policy,
      [10000],
    ).max,
    2,
  );
});
test("parallel batches conserve absolute run identities and interleave opponent work", () => {
  const indices = [0, 2, 3, 9, 10, 100];
  const groups = partitionIndices(indices, 3, 2);
  assert.deepEqual(groups.flat(), indices);
  assert.ok(groups.every((group) => group.length <= 2));
  assert.deepEqual(
    interleave([
      [1, 3, 5],
      [2, 4],
    ]),
    [1, 2, 3, 4, 5],
  );
  assert.throws(() => partitionIndices(indices, 0, 10));
});
test("bounded workers drain siblings on failure and do not launch remaining units", async () => {
  const controller = new AbortController();
  let active = 0,
    peak = 0,
    finished = 0,
    started = 0;
  await assert.rejects(
    runParallel(
      Array.from({ length: 10 }, (_, i) => async () => {
        active++;
        started++;
        peak = Math.max(peak, active);
        try {
          await tick();
          if (i === 0) throw Error("actual task failure");
        } finally {
          active--;
          finished++;
        }
      }),
      () => 2,
      controller,
    ),
    /actual task failure/,
  );
  assert.equal(active, 0);
  assert.equal(peak, 2);
  assert.equal(started, 2);
  assert.equal(finished, 2);
});
test("resource scheduler never exceeds capacity and favors analyses without a running slot", async () => {
  const scheduler = new EngineScheduler(
    { ...policy, cpuPerProcess: 1, processCap: 2 },
    async () => ({ ...hardware, cpuCores: 2 }),
    async () => 800,
  );
  const a = new AbortController(),
    b = new AbortController();
  try {
    const first = await scheduler.acquire("analysis-a", a.signal);
    first.track(101);
    const second = await scheduler.acquire("analysis-a", a.signal);
    second.track(102);
    let aReady = false,
      bReady = false;
    const waitingA = scheduler
      .acquire("analysis-a", a.signal)
      .then((lease) => ((aReady = true), lease));
    const waitingB = scheduler
      .acquire("analysis-b", b.signal)
      .then((lease) => ((bReady = true), lease));
    await tick();
    assert.equal(scheduler.status().active, 2);
    assert.equal(bReady, false);
    first.release();
    await scheduler.pump();
    await tick();
    assert.equal(bReady, true);
    assert.equal(aReady, false);
    const bLease = await waitingB;
    bLease.track(103);
    assert.equal(scheduler.status().activeAnalyses, 2);
    second.release();
    await tick();
    const aLease = await waitingA;
    assert.equal(scheduler.status().active, 2);
    aLease.release();
    bLease.release();
    await tick();
    assert.equal(scheduler.status().active, 0);
  } finally {
    scheduler.stop();
  }
});
test("memory pressure holds new launches, recovery releases them, and cancelled waiters consume no slot", async () => {
  let available = 1000;
  const scheduler = new EngineScheduler(policy, async () => ({
    ...hardware,
    availableMemoryMiB: available,
  }));
  const abort = new AbortController();
  try {
    const cancelled = scheduler.acquire("cancelled", abort.signal);
    abort.abort();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal(scheduler.status().waiting, 0);
    let admitted = false;
    const pending = scheduler
      .acquire("waiting", new AbortController().signal)
      .then((lease) => ((admitted = true), lease));
    await tick();
    assert.equal(admitted, false);
    available = 7000;
    await scheduler.pump();
    const lease = await pending;
    assert.equal(admitted, true);
    lease.release();
  } finally {
    scheduler.stop();
  }
});
