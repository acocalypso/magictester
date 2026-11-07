import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SetupProgress, monitorDownload } from '../dist/setup-progress.mjs';
import { RuntimeManager } from '../dist/runtime-manager.mjs';

test('download progress counts actual bytes without changing streamed data', async () => {
  const events = []; let clock = 0;
  const response = new Response(new ReadableStream({ start(c) { for (const text of ['abc', 'def', 'ghi']) c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { headers: { 'content-length': '9' } });
  assert.equal(await monitorDownload(response, 'forge', e => events.push(e), () => clock += 300).text(), 'abcdefghi');
  assert.equal(events.at(-1).bytes, 9); assert.equal(events.at(-1).totalBytes, 9); assert.equal(events.at(-1).complete, true);
  assert.ok(events.some(e => e.bytes > 0 && e.bytes < 9)); assert.ok(events.every(e => e.bytes <= 9));
});
test('compressed HTTP and unknown-length downloads never display a made-up percentage', async () => {
  for (const headers of [{ 'content-length': '3', 'content-encoding': 'gzip' }, {}]) {
    const events = [];
    await monitorDownload(new Response('already decoded data', { headers }), 'cards', e => events.push(e)).text();
    assert.equal(events.at(-1).totalBytes, null);
    const reporter = new SetupProgress(); reporter.begin(); reporter.event(events.at(-1));
    assert.equal(reporter.snapshot().fraction, null); assert.equal(reporter.snapshot().bytes, 20);
  }
});
test('cancelling a monitored response cancels its upstream stream', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } }));
  const reader = monitorDownload(response, 'forge', () => {}).body.getReader();
  await reader.read(); await reader.cancel(); await new Promise(r => setImmediate(r)); assert.equal(cancelled, true);
});
test('setup tracks real stages, validation checks and cancellation until retry', () => {
  const reporter = new SetupProgress(); reporter.begin();
  reporter.event({ event: 'extraction_progress', bytes: 5, totalBytes: 10 }); assert.equal(reporter.snapshot().fraction, 0.5);
  reporter.event({ event: 'download_progress', target: 'forge', bytes: 1, totalBytes: 10 }); assert.equal(reporter.snapshot().stage, 'extract');
  reporter.event({ event: 'validation_progress', completed: 3, total: 8 }); assert.equal(reporter.snapshot().fraction, 3 / 8);
  assert.equal(reporter.snapshot().stages.at(-1).status, 'pending');
  const generation = reporter.snapshot().generation;
  reporter.finish('cancelled', 'Paused'); reporter.event({ event: 'setup_complete' }); assert.equal(reporter.snapshot().status, 'cancelled');
  reporter.begin(); assert.ok(reporter.snapshot().generation > generation); assert.equal(reporter.snapshot().fraction, null);
  reporter.finish('complete', 'Ready'); assert.ok(reporter.snapshot().stages.every(s => s.status === 'complete'));
});
test('setup progress survives fragmented CRLF subprocess output', async () => {
  const data = await mkdtemp(join(tmpdir(), 'setup-progress-'));
  const manager = new RuntimeManager(data, () => {}); manager.progress.begin();
  try {
    await manager.run('../tests/fixtures/progress-pipe.mjs');
    assert.equal(manager.progress.snapshot().stage, 'download'); assert.equal(manager.progress.snapshot().bytes, 123); assert.equal(manager.progress.snapshot().totalBytes, 256);
  } finally { await manager.close(); await rm(data, { recursive: true, force: true }); }
});
test('setup cancellation aborts discovery without waiting for a network timeout', { timeout: 5000 }, async () => {
  const data = await mkdtemp(join(tmpdir(), 'setup-cancel-http-')); const original = globalThis.fetch;
  await mkdir(join(data, 'forge'));
  const previous = { status: 'current', latestVersion: '2.0.15', checkedAt: '2020-01-01T00:00:00.000Z' };
  await writeFile(join(data, 'forge', 'forge-updates.json'), JSON.stringify(previous));
  let entered; const started = new Promise(r => entered = r);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); entered(); });
  const manager = new RuntimeManager(data, () => {});
  try {
    const operation = manager.setup(); const rejected = assert.rejects(operation);
    await started; await manager.cancel(); await rejected;
    assert.equal(manager.progress.snapshot().status, 'cancelled'); assert.equal(manager.child, null);
    assert.deepEqual(JSON.parse(await readFile(join(data, 'forge', 'forge-updates.json'), 'utf8')), previous, 'Cancelling discovery must not certify a stale engine as freshly checked');
  } finally { globalThis.fetch = original; await manager.close(); await rm(data, { recursive: true, force: true }); }
});
