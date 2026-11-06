/* global document, innerWidth */
// Read actual game records and verify their plain-language presentation.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { rateLimitedFetch } from "./test-http.mjs";
const base = process.env.BASE_URL || "http://localhost:3000";
const read = (path) =>
  rateLimitedFetch(base + "/api/v1" + path).then((r) => r.json());
const jobs = await read("/simulations");
const job =
  jobs.find((j) => j.id === process.env.OBSERVATIONS_JOB_ID) ||
  jobs.find(
    (j) =>
      j.config?.gameMode === "BO3" &&
      j.observedGames > 0 &&
      j.state === "COMPLETED",
  );
assert.ok(job);
const records = await read("/simulations/" + job.id + "/observations?limit=50");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function open(id) {
  await page.goto(base + "/?view=results&job=" + id, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: /View observed games/ }).click();
  await page.locator("#observed-match-games .observed-game").first().waitFor();
}
try {
  await mkdir("data/browser", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await open(job.id);
    const first = page.locator("#observed-match-games details").first();
    await first.locator("summary").click();
    await first.getByText("First to play", { exact: true }).waitFor();
    await first.getByText("Playing time", { exact: true }).waitFor();
    assert.equal(await first.locator("pre").count(), 0);
    assert.ok(
      (await first.locator("summary").innerText()).includes(
        "View game details",
      ),
    );
    assert.ok(!(await first.innerText()).includes(".log"));
    const changed = records.findIndex((o) =>
      o.data.result.sideboardChanges?.some(
        (p) => p.added.length || p.removed.length,
      ),
    );
    if (changed >= 0) {
      const row = page.locator("#observed-match-games details").nth(changed);
      if ((await row.getAttribute("open")) === null)
        await row.locator("summary").click();
      const changes = records[changed].data.result.sideboardChanges;
      for (const player of changes) {
        for (const card of [...player.added, ...player.removed])
          assert.ok(
            (await row.innerText()).includes(card.quantity + " × " + card.name),
          );
      }
      await row
        .getByText("Moved into the mainboard", { exact: true })
        .first()
        .waitFor();
      await row
        .getByText("Moved to the sideboard", { exact: true })
        .first()
        .waitFor();
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "data/browser/readable-games-" + width + ".png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: /Details/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.locator("pre").count(), 0);
    await dialog
      .getByText("Sideboard decisions", { exact: true })
      .first()
      .waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  }
  const restarted = jobs.find(
    (j) =>
      j.config?.gameMode === "BO3" &&
      j.state === "COMPLETED" &&
      j.observedGames > j.actualGames,
  );
  if (restarted) {
    const history = await read(
      "/simulations/" + restarted.id + "/observations?limit=50",
    );
    const index = history.findIndex((o) => o.review?.status === "previous");
    if (index >= 0) {
      await open(restarted.id);
      const row = page.locator("#observed-match-games details").nth(index);
      await row.locator("summary").click();
      await row
        .locator(".game-counting")
        .getByText("Earlier attempt", { exact: true })
        .waitFor();
      await row
        .getByText("This game belongs to an earlier attempt.", { exact: false })
        .waitFor();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      event: "readable_game_details_passed",
      jobId: job.id,
      actualSideboardChanges: records.some((o) =>
        o.data.result.sideboardChanges?.some(
          (p) => p.added.length || p.removed.length,
        ),
      ),
      restartedMatchChecked: Boolean(restarted),
      viewports: [1440, 390],
      noRawJson: true,
    }),
  );
} finally {
  await browser.close();
}
