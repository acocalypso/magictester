import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const files = [];
for (const dir of ["tests", "tests/generated"])
  for (const name of await readdir(dir))
    if (name.endsWith(".test.mjs")) files.push(dir + "/" + name);
const result = spawnSync(process.execPath, ["--test", "--test-concurrency="+(process.env.DESKTOP_TEST_CONCURRENCY||"2"), ...files], {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
