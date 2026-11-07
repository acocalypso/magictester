// Build complete, self-contained portable releases. Run from any working directory.
import { createWriteStream, createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const option = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const rid = option(
    "--rid",
    process.platform === "win32" ? "win-x64" : "linux-x64",
  ),
  version = option("--version", "0.1.0");
if (
  !["win-x64", "linux-x64"].includes(rid) ||
  !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)
)
  throw Error("Invalid target RID or release version");
if ((rid === "win-x64") !== (process.platform === "win32"))
  throw Error("Build each package on its matching Windows/Linux runner");
const output = resolve(option("--output", join(root, "artifacts"))),
  app = join(output, "MagicTester-" + version + "-" + rid),
  work = join(output, ".runtime-downloads-" + rid),
  engine = join(root, "engine");
function run(file, args, cwd = root, env = process.env) {
  const command =
    process.platform === "win32" && file === "npm" ? "npm.cmd" : file;
  const r = spawnSync(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && file === "npm",
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    // Keep actionable diagnostics in the check annotations even when a runner's
    // archived log download is temporarily unavailable.
    if (process.env.GITHUB_ACTIONS) {
      const detail = ((r.stdout || "") + (r.stderr || "") + (r.error?.message || "")).slice(-2800);
      console.error("::error title=Desktop build command failed::" +
        (command + " " + args.join(" ") + "\n" + detail)
          .replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A"));
    }
    throw Error(command + " failed (" + r.status + ")");
  }
  return r.stdout || "";
}
await fs.mkdir(output, { recursive: true });
await fs.rm(app, { recursive: true, force: true });
await fs.mkdir(work, { recursive: true });
run("npm", ["ci", "--ignore-scripts"], engine);
run("npm", ["run", "build"], engine);
run("npm", ["test"], engine);
run("dotnet", [
  "publish",
  join(root, "MagicTester.Desktop", "MagicTester.Desktop.csproj"),
  "-c",
  "Release",
  "-r",
  rid,
  "--self-contained",
  "true",
  "-p:Version=" + version,
  "-p:PublishTrimmed=false",
  "-o",
  app,
]);
await fs.mkdir(join(app, "engine"), { recursive: true });
await fs.cp(join(engine, "dist"), join(app, "engine"), { recursive: true });
for (const name of ["package.json", "package-lock.json"])
  await fs.copyFile(join(engine, name), join(app, "engine", name));
run("npm", ["ci", "--omit=dev", "--ignore-scripts"], join(app, "engine"));
const manifests = [];
async function download(url, path, expected, algorithm = "sha256") {
  const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!r.ok || !r.body)
    throw Error("Runtime download HTTP " + r.status + ": " + url);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(path));
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected.toLowerCase())
    throw Error("Runtime checksum mismatch: " + basename(path));
  manifests.push({ url, sha256: actual });
}
async function extract(archive, to) {
  await fs.mkdir(to, { recursive: true });
  if (archive.endsWith(".zip"))
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:BUNDLE_ARCHIVE -DestinationPath $env:BUNDLE_EXTRACT -Force",
      ],
      root,
      { ...process.env, BUNDLE_ARCHIVE: archive, BUNDLE_EXTRACT: to },
    );
  else run("tar", ["-xf", archive, "-C", to]);
}
const nodeVersion = "24.22.1",
  nodeName = `node-v${nodeVersion}-${rid === "win-x64" ? "win-x64.zip" : "linux-x64.tar.gz"}`,
  nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeName}`;
const checks = await fetch(
  `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`,
).then((r) => {
  if (!r.ok) throw Error("Node checksum manifest unavailable");
  return r.text();
});
const nodeHash = checks
  .split("\n")
  .find((line) => line.trim().endsWith(" " + nodeName))
  ?.split(/\s+/)[0];
if (!nodeHash) throw Error("Node runtime is missing its official checksum");
const nodeArchive = join(work, nodeName);
await download(nodeUrl, nodeArchive, nodeHash);
const nodeExtract = join(work, "node");
await extract(nodeArchive, nodeExtract);
const nodeHome = join(nodeExtract, (await fs.readdir(nodeExtract))[0]);
const nodeBin = join(app, "tools", "node");
await fs.mkdir(nodeBin, { recursive: true });
await fs.copyFile(
  join(nodeHome, rid === "win-x64" ? "node.exe" : "bin/node"),
  join(nodeBin, rid === "win-x64" ? "node.exe" : "node"),
);
await fs.copyFile(join(nodeHome, "LICENSE"), join(nodeBin, "LICENSE"));
await fs.rm(nodeArchive, { force: true });
await fs.rm(nodeExtract, { recursive: true, force: true });
if (rid === "linux-x64") await fs.chmod(join(nodeBin, "node"), 0o755);
const javaOs = rid === "win-x64" ? "windows" : "linux";
const javaList = await fetch(
  `https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=${javaOs}&vendor=eclipse`,
).then((r) => {
  if (!r.ok) throw Error("Java release metadata unavailable");
  return r.json();
});
const java = javaList.find((j) => j.binary?.package?.checksum)?.binary.package;
if (
  !java ||
  !/^https:\/\/github.com\/adoptium\/temurin21-binaries\/releases\/download\//.test(
    java.link,
  ) ||
  !/^[a-f0-9]{64}$/i.test(java.checksum)
)
  throw Error("Unverified Java runtime descriptor");
const javaArchive = join(
  work,
  javaOs === "windows" ? "java.zip" : "java.tar.gz",
);
await download(java.link, javaArchive, java.checksum);
const javaExtract = join(work, "java");
await extract(javaArchive, javaExtract);
const javaHome = join(javaExtract, (await fs.readdir(javaExtract))[0]);
await fs.mkdir(join(app, "tools"), { recursive: true });
// Link all Java 21 modules (including the compiler) without shipping build-only
// jmods/source archives. No module guessing: reflection and future Forge updates
// retain the complete Java platform surface.
run(join(javaHome, "bin", rid === "win-x64" ? "jlink.exe" : "jlink"), [
  "--add-modules",
  "ALL-MODULE-PATH",
  "--strip-debug",
  "--no-header-files",
  "--no-man-pages",
  "--compress",
  "zip-6",
  "--output",
  join(app, "tools", "java"),
]);
for (const name of ["NOTICE", "LICENSE", "ASSEMBLY_EXCEPTION"])
  try {
    await fs.copyFile(join(javaHome, name), join(app, "tools", "java", name));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
await fs.rm(javaArchive, { force: true });
await fs.rm(javaExtract, { recursive: true, force: true });
if (rid === "linux-x64")
  for (const name of ["java", "javac", "jar"])
    await fs.chmod(join(app, "tools", "java", "bin", name), 0o755);
for (const name of ["LICENSE", "README.md", "THIRD_PARTY.md"])
  await fs.copyFile(join(root, name), join(app, name));
await fs.writeFile(
  join(app, "runtime-manifest.json"),
  JSON.stringify(
    {
      version,
      rid,
      node: nodeVersion,
      avalonia: "12.1.5",
      javaImage:
        "Java 21 ALL-MODULE-PATH, compiler included; debug symbols, headers and manuals omitted",
      dotnet: "10.0",
      runtimes: manifests,
      source: "https://github.com/acocalypso/magictester",
    },
    null,
    2,
  ),
);
run(join(nodeBin, rid === "win-x64" ? "node.exe" : "node"), ["--version"]);
run(
  join(app, "tools", "java", "bin", rid === "win-x64" ? "java.exe" : "java"),
  ["--version"],
);
run(
  join(app, "tools", "java", "bin", rid === "win-x64" ? "javac.exe" : "javac"),
  ["--version"],
);
const encodingCheck = join(work, "EncodingCheck.java");
await fs.writeFile(encodingCheck, 'class EncodingCheck { public static void main(String[] args) { System.out.print("Éowyn, Shieldmaiden"); } }', "utf8");
const encoded = run(join(app, "tools", "java", "bin", rid === "win-x64" ? "java.exe" : "java"), ["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", encodingCheck]);
if (encoded !== "Éowyn, Shieldmaiden") throw Error("Bundled Java did not preserve UTF-8 card names");
// Verify the package using only its own runtimes and an isolated empty user directory.
const checkEnv = { ...process.env, MAGICTESTER_DATA: join(work, "smoke-data") };
delete checkEnv.MAGICTESTER_ENGINE;
delete checkEnv.MAGICTESTER_NODE;
run(
  join(app, rid === "win-x64" ? "MagicTester.exe" : "MagicTester"),
  ["--worker-check"],
  app,
  checkEnv,
);
const archive = app + (rid === "win-x64" ? ".zip" : ".tar.gz");
if (rid === "win-x64")
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -Path $env:BUNDLE_APP -DestinationPath $env:BUNDLE_ARCHIVE -Force",
    ],
    root,
    { ...process.env, BUNDLE_APP: app, BUNDLE_ARCHIVE: archive },
  );
else run("tar", ["-czf", archive, "-C", output, basename(app)]);
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
await fs.writeFile(
  archive + ".sha256",
  hash.digest("hex") + "  " + basename(archive) + "\n",
);
await fs.rm(work, { recursive: true, force: true });
console.log("Release package: " + archive);
