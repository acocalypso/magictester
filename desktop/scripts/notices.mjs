import { readFile, readdir, mkdir, cp, writeFile, access } from "node:fs/promises";
import { join, basename } from "node:path";

// Retain resolved package metadata and its original license/third-party files.
// Runtime packs are downloadDependencies rather than ordinary NuGet libraries.
export async function collectNotices(assetsPath, destination) {
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  const packages = new Map(Object.entries(assets.libraries)
    .filter(([, entry]) => entry.type === "package")
    .map(([name, entry]) => [entry.path, { name, path: entry.path }]));
  for (const framework of Object.values(assets.project.frameworks))
    for (const dependency of framework.downloadDependencies || []) {
      const version = /^\[([^,\]]+)/.exec(dependency.version)?.[1];
      if (!version) throw Error("Unexpected runtime-pack version: " + dependency.version);
      const path = dependency.name.toLowerCase() + "/" + version;
      packages.set(path, { name: dependency.name + "/" + version, path });
    }
  const template = await readFile(new URL("../notices/MIT.txt", import.meta.url), "utf8");
  const manifest = [];
  for (const entry of packages.values()) {
    let source;
    for (const folder of Object.keys(assets.packageFolders)) {
      const candidate = join(folder, entry.path);
      try { await access(candidate); source = candidate; break; } catch {}
    }
    if (!source) throw Error("Resolved package is missing: " + entry.name);
    const target = join(destination, entry.path);
    await mkdir(target, { recursive: true });
    const files = await readdir(source);
    const spec = files.find((file) => file.endsWith(".nuspec"));
    if (!spec) throw Error("Package metadata is missing: " + entry.name);
    const metadata = await readFile(join(source, spec), "utf8");
    for (const file of files)
      if (file === spec || /^(licen[cs]e|notice|copying|third[-_. ]?party|legal)/i.test(file))
        await cp(join(source, file), join(target, basename(file)), { recursive: true });
    const license = /<license\s+type="([^"]+)"[^>]*>([^<]+)<\/license>/.exec(metadata);
    if (license?.[1] === "expression" && license[2].trim() === "MIT") {
      const declared = /<copyright>([\s\S]*?)<\/copyright>/.exec(metadata)?.[1]
        || /<authors>([\s\S]*?)<\/authors>/.exec(metadata)?.[1];
      if (!declared) throw Error("MIT copyright holder is missing: " + entry.name);
      const holder = declared.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
      const copyright = /copyright/i.test(holder) ? holder : "Copyright (c) " + holder;
      await writeFile(join(target, "LICENSE-MIT.txt"), template.replace("{{COPYRIGHT}}", copyright));
    }
    manifest.push({ package: entry.name, license: license?.[2] || "See package metadata", notices: entry.path });
  }
  await writeFile(join(destination, "packages.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
