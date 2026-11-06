// Download immutable Forge release and cache Scryfall bulk metadata. No card artwork.
import { existsSync, createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  mkdtemp,
} from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
const root = process.env.DATA_DIR || "/data";
const home = process.env.FORGE_HOME || root + "/forge";
const headers = {
  "User-Agent": "MagicTester/0.1 (https://github.com/acocalypso/magictester)",
  Accept: "application/json",
};
async function get(url) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${url}`);
  return r;
}
await mkdir(root, { recursive: true });
await mkdir(home, { recursive: true });
if (!existsSync(home + "/build.txt")) {
  const archive = root + "/forge.tar.bz2";
  const url =
    "https://github.com/Card-Forge/forge/releases/download/forge-2.0.15/forge-installer-2.0.15.tar.bz2";
  console.log(JSON.stringify({ event: "downloading_forge", url }));
  await pipeline(
    Readable.fromWeb((await get(url)).body),
    createWriteStream(archive),
  );
  const hash = createHash("sha256");
  for await (const b of createReadStream(archive)) hash.update(b);
  if (
    hash.digest("hex") !==
    "4468f182b60f6ca62d89697baa208981085af744f116781af751c611826db600"
  )
    throw new Error("Forge archive checksum mismatch");
  execFileSync("tar", ["-xjf", archive, "-C", home]);
  await rm(archive);
}
const cachedSchema = existsSync(root + "/cards.json")
  ? JSON.parse(await readFile(root + "/cards.json", "utf8")).schemaVersion
  : 0;
if (cachedSchema !== 2 || process.argv.includes("--refresh-cards")) {
  const bulk = (
    await (await get("https://api.scryfall.com/bulk-data")).json()
  ).data.find((x) => x.type === "oracle_cards");
  const url = bulk.jsonl_download_uri || bulk.download_uri;
  if (!url) throw new Error("Unsupported Scryfall bulk schema");
  console.log(JSON.stringify({ event: "downloading_scryfall", url }));
  const cards = [];
  const add = (c) => {
    if (
      c.name &&
      c.legalities &&
      !["token", "double_faced_token", "emblem", "art_series"].includes(
        c.layout,
      )
    )
      cards.push({
        name: c.name,
        manaCost: c.mana_cost || "",
        manaValue: c.cmc,
        layout: c.layout,
        keywords: c.keywords || [],
        power: c.power ?? null,
        toughness: c.toughness ?? null,
        legalities: c.legalities,
        typeLine: c.type_line || "",
        colorIdentity: c.color_identity || [],
        oracleText: c.oracle_text || "",
        faces: (c.card_faces || []).map((f) => ({
          name: f.name,
          typeLine: f.type_line,
          oracleText: f.oracle_text,
          manaCost: f.mana_cost || "",
          power: f.power ?? null,
          toughness: f.toughness ?? null,
        })),
        scryfallId: c.id,
      });
  };
  if (bulk.jsonl_download_uri) {
    const stream = Readable.fromWeb((await get(url)).body);
    const input = url.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
    for await (const line of createInterface({ input }))
      if (line.trim()) add(JSON.parse(line));
  } else {
    for (const c of await (await get(url)).json()) add(c);
  }
  await writeFile(
    root + "/cards.json.tmp",
    JSON.stringify({
      schemaVersion: 2,
      source: "Scryfall oracle_cards",
      sourceUpdatedAt: bulk.updated_at,
      fetchedAt: new Date().toISOString(),
      cards,
    }),
  );
  await rename(root + "/cards.json.tmp", root + "/cards.json");
  console.log(JSON.stringify({ event: "cards_cached", count: cards.length }));
}
// Extract supported card names from the release's scripts archive using the JDK jar utility.
if (!existsSync(root + "/forge-cards.json")) {
  const archive = home + "/res/cardsfolder/cardsfolder.zip";
  // Python isn't required: the `jar tf` list contains named script paths, but the card's actual
  // Name field can differ. Use a tiny Java ZIP reader to preserve exact names.
  const source = `import java.util.zip.*;import java.io.*;import java.nio.charset.StandardCharsets;public class CardNames{public static void main(String[]a)throws Exception{try(ZipFile z=new ZipFile(a[0])){var entries=z.entries();while(entries.hasMoreElements()){var e=entries.nextElement();if(e.isDirectory())continue;try(var r=new BufferedReader(new InputStreamReader(z.getInputStream(e),StandardCharsets.UTF_8))){String l;while((l=r.readLine())!=null){if(l.startsWith("Name:"))System.out.println(l.substring(5).trim());}}}}}}`;
  await writeFile(root + "/CardNames.java", source);
  // Source launch requires a JDK. Bootstrap image carries one; the runner uses a JRE.
  const names = execFileSync("java", [root + "/CardNames.java", archive], {
    maxBuffer: 16 * 1024 * 1024,
  })
    .toString()
    .split("\n")
    .filter(Boolean);
  await writeFile(root + "/forge-cards.json", JSON.stringify(names));
  await rm(root + "/CardNames.java");
}
const factsSource = new URL(
  "../services/forge-runner/metadata/CardFacts.java",
  import.meta.url,
);
const factsSourceHash = createHash("sha256")
  .update(await readFile(factsSource))
  .digest("hex");
let factsCache;
try {
  factsCache = JSON.parse(await readFile(root + "/forge-facts.json", "utf8"));
} catch {
  /* first bootstrap */
}
if (factsCache?.sourceHash !== factsSourceHash) {
  const sourceFile = root + "/CardFacts.java";
  await writeFile(sourceFile, await readFile(factsSource));
  execFileSync(
    "java",
    [
      "-cp",
      home + "/forge-gui-desktop-2.0.15-jar-with-dependencies.jar",
      sourceFile,
      home + "/res/cardsfolder/cardsfolder.zip",
      root + "/forge-facts.json.tmp",
    ],
    { cwd: home, maxBuffer: 16 * 1024 * 1024 },
  );
  const facts = JSON.parse(
    await readFile(root + "/forge-facts.json.tmp", "utf8"),
  );
  facts.sourceHash = factsSourceHash;
  facts.engineVersion = "2.0.15";
  facts.fetchedAt = new Date().toISOString();
  await writeFile(root + "/forge-facts.json.tmp", JSON.stringify(facts));
  await rename(root + "/forge-facts.json.tmp", root + "/forge-facts.json");
  await rm(sourceFile);
  console.log(
    JSON.stringify({
      event: "forge_metadata_cached",
      cards: Object.keys(facts.cards).length,
      failures: facts.failures.length,
    }),
  );
}
// Compile the maintained bridge against exactly this release. Runtime needs only a JRE.
const bridgeSource = new URL(
  "../services/forge-runner/bridge/MagicTesterBridge.java",
  import.meta.url,
);
const bridgeBytes = await readFile(bridgeSource);
const patchBytes = await readFile(
  new URL("../services/forge-runner/bridge/patches.json", import.meta.url),
);
const patches = JSON.parse(patchBytes);
const bridgeHash = createHash("sha256")
  .update(bridgeBytes)
  .update(patchBytes)
  .digest("hex");
const classDirectory = "bridge-builds/" + bridgeHash;
const classPath = home + "/" + classDirectory;
let bridgeCache;
try {
  bridgeCache = JSON.parse(
    await readFile(home + "/magictester-bridge.json", "utf8"),
  );
} catch {
  /* first bootstrap */
}
if (
  bridgeCache?.version !== "2" ||
  bridgeCache?.sourceHash !== bridgeHash ||
  bridgeCache?.classDirectory !== classDirectory ||
  !existsSync(classPath + "/MagicTesterBridge.class") ||
  patches.some(
    (p) => !existsSync(classPath + "/" + p.path.replace(/\.java$/, ".class")),
  )
) {
  const buildSource = await mkdtemp(root + "/bridge-source-");
  const sourceFile = buildSource + "/MagicTesterBridge.java";
  await writeFile(sourceFile, bridgeBytes);
  const patchedSources = [];
  for (const patch of patches) {
    const upstream = Buffer.from(await (await get(patch.url)).arrayBuffer());
    if (createHash("sha256").update(upstream).digest("hex") !== patch.sha256)
      throw new Error("Pinned Forge source hash mismatch: " + patch.path);
    const original = upstream.toString("utf8");
    let patched = original;
    for (const replacement of patch.replacements || [patch]) {
      if (patched.split(replacement.find).length !== 2)
        throw new Error("Forge patch must match exactly once: " + patch.path);
      patched = patched.replace(replacement.find, replacement.replace);
    }
    const destination = buildSource + "/" + patch.path;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, patched);
    patchedSources.push(destination);
  }
  await mkdir(home + "/bridge-builds", { recursive: true });
  const buildClasses = await mkdtemp(home + "/bridge-builds/.compile-");
  execFileSync(
    "java",
    [
      "-Xmx1024m",
      "-m",
      "jdk.compiler/com.sun.tools.javac.Main",
      "-cp",
      home + "/forge-gui-desktop-2.0.15-jar-with-dependencies.jar",
      "-d",
      buildClasses,
      sourceFile,
      ...patchedSources,
    ],
    { cwd: home, stdio: "inherit" },
  );
  if (!existsSync(classPath)) await rename(buildClasses, classPath);
  else await rm(buildClasses, { recursive: true, force: true });
  // Publish only complete immutable builds. Running JVMs retain their original path.
  const manifestTemp =
    home + "/magictester-bridge.json." + process.pid + ".tmp";
  await writeFile(
    manifestTemp,
    JSON.stringify({
      version: "2",
      engineVersion: "2.0.15",
      sourceHash: bridgeHash,
      classDirectory,
      upstreamOverrides: patches.map((p) => ({
        path: p.path,
        sha256: p.sha256,
        purpose: p.purpose,
      })),
    }),
  );
  await rename(manifestTemp, home + "/magictester-bridge.json");
  await rm(buildSource, { recursive: true, force: true });
  console.log(
    JSON.stringify({ event: "forge_bridge_compiled", sourceHash: bridgeHash }),
  );
}
console.log(
  JSON.stringify({
    event: "bootstrap_complete",
    build: (await readFile(home + "/build.txt", "utf8")).trim(),
  }),
);
