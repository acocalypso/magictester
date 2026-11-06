import { ForgeEngineAdapter } from "../src/engine.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const decks = await Promise.all(
  ["deck-a", "deck-b"].map((x) =>
    readFile(`services/forge-runner/fixtures/${x}.dck`, "utf8"),
  ),
);
const results: unknown[] = [];
await new ForgeEngineAdapter().runGames(
  {
    decks,
    games: Number(process.env.SPIKE_GAMES || 1),
    seed: 12345,
    clockSeconds: Number(process.env.SPIKE_CLOCK || 30),
  },
  async (r) => {
    results.push(r);
    console.log(JSON.stringify(r));
  },
);
await mkdir("data", { recursive: true });
await writeFile("data/spike-results.json", JSON.stringify(results, null, 2));
