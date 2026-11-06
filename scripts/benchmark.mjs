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
while (Date.now() - start < 21600000) {
  const current = await get("/simulations/" + job.id);
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
    if (current.state !== "COMPLETED") process.exitCode = 1;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
