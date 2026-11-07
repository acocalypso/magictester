/* global document, innerWidth */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.BASE_URL || "http://localhost:3000";
const report = JSON.parse(
  await readFile("data/action-history-smoke.json", "utf8"),
);
const jobId = process.env.HISTORY_JOB_ID || report.job;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("data/browser", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + "/?view=results&job=" + jobId, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Details", exact: false })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    const history = dialog
      .getByRole("region", { name: "Game action history", exact: true })
      .first();
    await history.getByRole("button", { name: /View action history/ }).click();
    const timeline = history.getByRole("region", {
      name: "Recorded actions in chronological order",
    });
    await timeline.waitFor();
    assert.match(await timeline.innerText(), /Turn 1/);
    assert.doesNotMatch(
      await timeline.innerText(),
      /Ai\(\d+\)-player-|\bplayer-\d\b/,
    );
    assert.equal(
      await timeline
        .locator(".action-kind")
        .filter({ hasText: /^Phase$/ })
        .count(),
      0,
    );
    const before = await timeline.locator("li").count();
    await history.getByLabel("Show phase and mana details").check();
    assert.ok((await timeline.locator("li").count()) > before);
    assert.ok(
      (await timeline
        .locator(".action-kind")
        .filter({ hasText: /^Phase$/ })
        .count()) > 0,
    );
    if (
      width === 1440 &&
      (await history.getByRole("button", { name: "Load more actions" }).count())
    ) {
      const total = Number(
        (await history.getByText(/of .* saved entries loaded/).innerText())
          .match(/of ([\d,]+) saved/)[1]
          .replaceAll(",", ""),
      );
      let fail = true;
      await page.route(
        /\/games\/[^/]+\/actions\?offset=100&limit=100$/,
        (route) => {
          if (fail) {
            fail = false;
            return route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "temporary test failure" }),
            });
          }
          return route.continue();
        },
      );
      const count = await timeline.locator("li").count();
      await history.getByRole("button", { name: "Load more actions" }).click();
      await history.getByRole("alert").waitFor();
      assert.equal(await timeline.locator("li").count(), count);
      await history
        .getByRole("button", { name: "Retry loading actions" })
        .click();
      await history
        .getByText(
          new RegExp(`${Math.min(200, total)} of .* saved entries loaded`),
        )
        .waitFor();
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await timeline.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `data/browser/actions-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  }
  await page.goto(base + "/?view=results&job=" + report.cancelled, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "View observed games", exact: false })
    .click();
  const earlier = page
    .locator("details.observed-game")
    .filter({ hasText: "Earlier attempt" })
    .first();
  await earlier.locator("summary").click();
  const history = earlier.getByRole("region", {
    name: "Game action history",
    exact: true,
  });
  await history.getByRole("button", { name: /View action history/ }).click();
  await history
    .getByRole("region", { name: "Recorded actions in chronological order" })
    .waitFor();
  await page.screenshot({
    path: "data/browser/actions-earlier-attempt.png",
    fullPage: true,
  });
  await page.goto(base + "/?view=results&job=" + report.commander, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "Details", exact: false })
    .first()
    .click();
  const podHistory = page
    .getByRole("dialog")
    .getByRole("region", { name: "Game action history", exact: true });
  await podHistory.getByRole("button", { name: /View action history/ }).click();
  const podTimeline = podHistory.getByRole("region", {
    name: "Recorded actions in chronological order",
  });
  await podTimeline.waitFor();
  assert.match(await podTimeline.innerText(), /seat [1-4]/);
  assert.doesNotMatch(
    await podTimeline.innerText(),
    /Ai\(\d+\)-player-|\bplayer-\d\b/,
  );
  if (report.timeout) {
    await page.goto(base + "/?view=results&job=" + report.timeout, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Details", exact: false })
      .first()
      .click();
    const history = page
      .getByRole("dialog")
      .getByRole("region", { name: "Game action history", exact: true });
    await history.getByText(/Partial history:/).waitFor();
    await history.getByRole("button", { name: /View action history/ }).click();
    await history
      .getByText(/saved entries loaded|No action entries were recorded/)
      .waitFor();
    await page.screenshot({
      path: "data/browser/actions-timeout.png",
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      event: "action_history_browser_passed",
      jobId,
      widths: [1440, 390],
      previousAttempt: true,
    }),
  );
} finally {
  await browser.close();
}
