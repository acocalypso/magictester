/* global document, innerWidth, navigator */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { rateLimitedFetch } from "./test-http.mjs";
const base = process.env.BASE_URL || "http://localhost:3000";
const read = (path) =>
  rateLimitedFetch(base + "/api/v1" + path).then((r) => r.json());
const jobs = await read("/simulations");
const job =
  jobs.find((j) => j.id === process.env.DECKLIST_JOB_ID) ||
  jobs.find((j) => j.state === "COMPLETED" && j.config?.players === 2);
assert.ok(job, "A completed two-player test is required");
const results = await read("/simulations/" + job.id + "/results");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage(),
  errors = [],
  remoteFonts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    request.resourceType() === "font" &&
    new URL(request.url()).origin !== new URL(base).origin
  )
    remoteFonts.push(request.url());
});
try {
  await mkdir("data/browser", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(base + "/?view=results&job=" + job.id, {
      waitUntil: "networkidle",
    });
    const trigger = page.getByRole("button", {
      name: "View your decklist",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog
        .getByLabel("Your saved decklist", { exact: true })
        .textContent(),
      results.job.deck.decklist,
      "Show the saved submission, not the editor contents",
    );
    await dialog
      .getByRole("button", { name: "Copy decklist", exact: true })
      .click();
    await dialog
      .getByRole("status")
      .filter({ hasText: "Decklist copied." })
      .waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      results.job.deck.decklist,
    );
    const downloadPromise = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download .txt ↓", exact: true })
      .click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.txt$/);
    assert.equal(
      await readFile(await download.path(), "utf8"),
      results.job.deck.decklist,
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await trigger.evaluate((el) => document.activeElement === el),
      true,
      "Closing the decklist restores focus",
    );
    for (const matchup of results.matchups.slice(0, 2)) {
      await page
        .getByRole("button", {
          name: "View decklist for " + matchup.opponent.name,
          exact: true,
        })
        .first()
        .click();
      await dialog.waitFor();
      assert.equal(
        await dialog
          .getByLabel("Saved opponent decklist", { exact: true })
          .textContent(),
        matchup.opponent.decklist,
      );
      await dialog
        .getByText("For BO3 games, changes made between games", {
          exact: false,
        })
        .waitFor();
      await dialog
        .getByRole("button", { name: "Close decklist", exact: true })
        .click();
      await dialog.waitFor({ state: "detached" });
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "data/browser/result-decklists-" + width + ".png",
      fullPage: true,
    });
  }
  const podJob = jobs.find(
    (j) => j.state === "COMPLETED" && j.config?.players === 4,
  );
  if (podJob) {
    const podResults = await read("/simulations/" + podJob.id + "/results");
    await page.goto(base + "/?view=results&job=" + podJob.id, {
      waitUntil: "networkidle",
    });
    const pod = podResults.matchups[0];
    assert.equal(pod.participants.length, 3);
    for (let seat = 0; seat < 3; seat++) {
      const deck = pod.participants[seat];
      await page
        .getByRole("button", {
          name: `Seat ${seat + 2}: ${deck.name} · View decklist`,
          exact: true,
        })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      assert.equal(
        await dialog
          .getByLabel("Saved opponent decklist", { exact: true })
          .textContent(),
        deck.decklist,
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteFonts, []);
  console.log(
    JSON.stringify({
      event: "result_decklists_browser_passed",
      jobId: job.id,
      savedInputVerified: true,
      opponentsVerified: true,
      copyAndDownload: true,
      podSeatsVerified: Boolean(podJob),
      viewports: [1440, 390],
      localFontsOnly: true,
    }),
  );
} finally {
  await browser.close();
}
