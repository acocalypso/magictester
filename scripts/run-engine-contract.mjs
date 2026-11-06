import { resolveRuntime } from "../src/runtime.mjs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const name = process.argv[2];
if (
  ![
    "DuelContracts",
    "MatchContracts",
    "CommanderColorContracts",
    "DeckNameContracts",
  ].includes(name)
)
  throw Error("Unknown engine contract");
const runtime = await resolveRuntime();
const cp =
  runtime.home +
  "/" +
  runtime.bridge.classDirectory +
  ":" +
  runtime.home +
  "/" +
  (runtime.bridge.release?.jarName ||
    `forge-gui-desktop-${runtime.bridge.engineVersion}-jar-with-dependencies.jar`);
execFileSync(
  "java",
  [
    "-Xmx1024m",
    "-Djava.awt.headless=true",
    "-cp",
    cp,
    resolve("services/forge-runner/tests/" + name + ".java"),
  ],
  { cwd: runtime.home, stdio: "inherit", timeout: 120000 },
);
