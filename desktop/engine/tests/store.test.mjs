import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../dist/store.mjs";
import { partitionIndices } from "../dist/core/parallel.js";
import { calculateCapacity } from "../dist/core/resources.js";
import { parseDeck } from "../dist/core/domain.js";
test("SQLite checkpoints reject changed inputs and recover only unfinished active jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-store-"));
  try {
    let store = new Store(join(dir, "test.sqlite"));
    store.run(
      "INSERT INTO jobs(id,name,format,state,document,created_at) VALUES('a','Saved','pauper','RUNNING','{}','2026-11-07T00:00:00Z')",
    );
    store.run(
      "INSERT INTO runs(id,job_id,plan_key,unit_index,state,result) VALUES('r','a','p',0,'DONE','{\"winner\":0}')",
    );
    assert.throws(
      () => store.run("UPDATE jobs SET document='{} ' WHERE id='a'"),
      /immutable/i,
    );
    store.close();
    store = new Store(join(dir, "test.sqlite"));
    assert.equal(
      store.get("SELECT state FROM jobs WHERE id='a'").state,
      "QUEUED",
    );
    assert.equal(
      store.get("SELECT result FROM runs WHERE id='r'").result,
      '{"winner":0}',
    );
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("failure rolls back a complete transaction, preserving earlier checkpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-transaction-"));
  const s = new Store(join(dir, "test.sqlite"));
  try {
    assert.throws(() =>
      s.transaction(() => {
        s.set("a", 1);
        throw Error("disk failure");
      }),
    );
    assert.equal(s.setting("a"), null);
  } finally {
    s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("portable engine retains commander parsing, absolute batch IDs and memory caps", () => {
  const parsed = parseDeck(
    "Commander\n1 Bruvac the Grandiloquent\nDeck\n99 Island",
  );
  assert.equal(
    parsed.cards.find((c) => c.section === "COMMANDER").name,
    "Bruvac the Grandiloquent",
  );
  assert.deepEqual(partitionIndices([0, 3, 8, 15], 2, 2).flat(), [0, 3, 8, 15]);
  assert.equal(
    calculateCapacity(
      { cpuCores: 2, totalMemoryMiB: 2048, availableMemoryMiB: 1000 },
      {
        heapMiB: 1024,
        overheadMiB: 512,
        cpuPerProcess: 2,
        reserveMiB: 0,
        processCap: 0,
      },
    ).max,
    0,
  );
});
test("transactional queue counters follow checkpoints and reject future schema downgrades", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-counts-"));
  let s = new Store(join(dir, "db.sqlite"));
  try {
    s.run(
      "INSERT INTO jobs(id,name,format,state,document,created_at) VALUES('a','Count','pauper','QUEUED','{}','2026-11-07')",
    );
    s.run(
      "INSERT INTO runs(id,job_id,plan_key,unit_index) VALUES('r','a','p',0)",
    );
    assert.equal(s.get("SELECT pending FROM jobs WHERE id='a'").pending, 1);
    s.run(
      "UPDATE runs SET state='DONE',result='{\"termination\":\"timeout\"}' WHERE id='r'",
    );
    assert.deepEqual(
      { ...s.get("SELECT completed,pending,timeouts FROM jobs WHERE id='a'") },
      { completed: 1, pending: 0, timeouts: 1 },
    );
    s.db.exec("PRAGMA user_version=99");
    s.close();
    s = null;
    assert.throws(() => new Store(join(dir, "db.sqlite")), /newer desktop/);
  } finally {
    s?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
