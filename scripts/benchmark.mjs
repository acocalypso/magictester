import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
const games = Number(process.argv[2] || 50);
async function get(path, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(base + "/api/v1" + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return data;
    } catch (error) {
      if (body || attempt >= 5) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
const resourceSamples = [];
const cpuMax = new Map();
const clockTicks = process.env.BENCHMARK_RESOURCES
  ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim())
  : 100;
const sampleProgram = `const fs=require('fs');const results=[];for(const pid of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))){try{const command=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');if(!command.startsWith('java\\0'))continue;const status=fs.readFileSync('/proc/'+pid+'/status','utf8');const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\\s+/);results.push({pid:Number(pid),startTicks:Number(fields[19]),cpuTicks:Number(fields[11])+Number(fields[12]),rssKB:Number(status.match(/VmRSS:\\s+(\\d+)/)?.[1]||0),highWaterKB:Number(status.match(/VmHWM:\\s+(\\d+)/)?.[1]||0)});}catch{}}console.log(JSON.stringify(results));`;
function sampleResources() {
  try {
    const processes = JSON.parse(
      execFileSync(
        "docker",
        [
          "exec",
          process.env.RUNNER_CONTAINER || "magictester-forge-runner-1",
          "node",
          "-e",
          sampleProgram,
        ],
        { encoding: "utf8", timeout: 5000 },
      ),
    );
    for (const p of processes)
      cpuMax.set(
        `${p.pid}:${p.startTicks}`,
        Math.max(cpuMax.get(`${p.pid}:${p.startTicks}`) || 0, p.cpuTicks),
      );
    resourceSamples.push({ at: new Date().toISOString(), processes });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "resource_sample_unavailable",
        error: error.message,
      }),
    );
  }
}
let job;
if (process.env.BENCHMARK_JOB_ID)
  job = await get("/simulations/" + process.env.BENCHMARK_JOB_ID);
else {
  const snapshots = await get("/meta/pauper/snapshots");
  const snapshot =
    snapshots.find((s) => s.name === "Pauper · Local reference pool") ||
    snapshots[0];
  job = await get("/simulations", {
    name: `${games}-game runtime benchmark`,
    decklist: await readFile("examples/burn.txt", "utf8"),
    format: "pauper",
    snapshotId: snapshot.id,
    games,
    seed: 12345,
  });
}
console.log(JSON.stringify({ event: "benchmark_created", id: job.id, games }));
const start = Date.now();
let previous = -1;
let sampleAt = 0;
while (Date.now() - start < 21600000) {
  const current = await get("/simulations/" + job.id);
  if (process.env.BENCHMARK_RESOURCES && Date.now() - sampleAt > 10000) {
    sampleAt = Date.now();
    sampleResources();
  }
  if (current.completed !== previous) {
    previous = current.completed;
    console.log(
      JSON.stringify({
        event: "benchmark_progress",
        id: job.id,
        state: current.state,
        completed: current.completed,
        failed: current.failed,
        games,
      }),
    );
  }
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.state)) {
    const results = await get("/simulations/" + job.id + "/results");
    const seconds =
      ((current.finishedAt ? Date.parse(current.finishedAt) : Date.now()) -
        Date.parse(job.createdAt)) /
      1000;
    const report = {
      measuredAt: new Date().toISOString(),
      seconds,
      gamesPerMinute: current.completed / (seconds / 60),
      results,
      resources: process.env.BENCHMARK_RESOURCES
        ? {
            sampleIntervalSeconds: 10,
            sampledPeakJavaHighWaterKB: Math.max(
              0,
              ...resourceSamples.flatMap((s) =>
                s.processes.map((p) => p.highWaterKB),
              ),
            ),
            observedCpuSecondsLowerBound:
              [...cpuMax.values()].reduce((n, t) => n + t, 0) / clockTicks,
            clockTicksPerSecond: clockTicks,
            qualification:
              "Samples can miss the final CPU/RSS peak before a JVM exits; CPU is a lower bound, not a full cgroup profile.",
            samples: resourceSamples,
          }
        : null,
    };
    await mkdir("data", { recursive: true });
    await writeFile(
      `data/benchmark-${games}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        event: "benchmark_finished",
        id: job.id,
        state: current.state,
        seconds,
        gamesPerMinute: report.gamesPerMinute,
        summary: results.summary,
      }),
    );
    if (
      current.state !== "COMPLETED" ||
      results.summary.games !== games ||
      current.failed ||
      results.summary.timeouts ||
      results.summary.errors
    )
      process.exitCode = 1;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
