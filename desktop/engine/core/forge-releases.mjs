const api = "https://api.github.com/repos/Card-Forge/forge";
async function releaseJson(url, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "MagicTester/0.1 (+https://github.com/acocalypso/magictester)",
        },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      if (response.ok) return await response.json();
      await response.body?.cancel();
      const error = Error("Forge release API HTTP " + response.status);
      error.transient = response.status >= 500 && response.status <= 599;
      throw error;
    } catch (error) {
      const transient = error.transient || error instanceof TypeError || error.name === "TimeoutError";
      if (!transient || attempt >= 2) throw error;
      await (await import("node:timers/promises")).setTimeout(1000 * (attempt + 1), undefined, { signal });
    }
  }
}
export function compareVersions(a, b) {
  if (!/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b))
    throw Error("Unsupported Forge version");
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}
export function releaseDescriptor(release, sourceCommit) {
  const version = /^forge-(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
  if (!version || release.draft || release.prerelease)
    throw Error("GitHub did not return a stable Forge release");
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw Error("Missing immutable Forge source commit");
  const asset = release.assets?.find(
    (a) => a.name === `forge-installer-${version}.tar.bz2`,
  );
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest))
    throw Error("Stable Forge archive has no official SHA-256 digest");
  const expected = `https://github.com/Card-Forge/forge/releases/download/${release.tag_name}/${asset.name}`;
  if (asset.browser_download_url !== expected)
    throw Error("Unexpected Forge archive URL");
  return {
    version,
    tag: release.tag_name,
    sourceCommit,
    archiveUrl: expected,
    archiveSha256: asset.digest.slice(7),
    jarName: `forge-gui-desktop-${version}-jar-with-dependencies.jar`,
  };
}
export async function latestStable(
  get = releaseJson,
  signal,
) {
  const release = await get(api + "/releases/latest", signal);
  if (
    !/^forge-\d+\.\d+\.\d+$/.test(release.tag_name) ||
    release.draft ||
    release.prerelease
  )
    throw Error("Expected latest stable Forge release");
  let ref = (await get(api + "/git/ref/tags/" + release.tag_name, signal)).object;
  for (let n = 0; ref?.type === "tag" && n < 5; n++) {
    if (!/^[a-f0-9]{40}$/.test(ref.sha)) throw Error("Invalid annotated tag");
    ref = (await get(api + "/git/tags/" + ref.sha, signal)).object;
  }
  if (ref?.type !== "commit")
    throw Error("Forge release tag did not resolve to a commit");
  return releaseDescriptor(release, ref.sha);
}
