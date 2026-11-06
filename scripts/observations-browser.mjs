/* global document */
// Live recorded-game navigation plus explicitly mocked loading/error/empty UI cases.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.BASE_URL || "http://localhost:3000";
const jobs = await fetch(base + "/api/v1/simulations").then((r) => r.json());
const job =
  jobs.find((j) => j.id === process.env.OBSERVATIONS_JOB_ID) ||
  jobs.find((j) => j.config?.gameMode === "BO3" && j.observedGames > 0);
assert.ok(job, "Run a BO3 test with observed games first");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const endpoint = "**/api/v1/simulations/" + job.id + "/observations?*";
async function open() {
  await page.goto(base + "/?view=results&job=" + job.id, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: /View observed games/ }).waitFor();
}
async function inView() {
  await page.waitForFunction(
    () => document.activeElement?.id === "observed-match-games-heading",
  );
  const h = await page.locator("#observed-match-games-heading").boundingBox();
  assert.ok(h && h.y >= 0 && h.y + h.height <= 1000, JSON.stringify(h));
}
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await open();
    await page.getByRole("button", { name: /View observed games/ }).click();
    await inView();
    assert.ok(
      (await page.locator("#observed-match-games .observed-game").count()) > 0,
    );
    await page
      .locator("#observed-match-games details")
      .first()
      .locator("summary")
      .click();
    const details = page.locator("#observed-match-games details").first();
    await details.getByText("First to play", { exact: true }).waitFor();
    await details
      .getByRole("heading", { name: "Sideboard decisions", exact: true })
      .waitFor();
    assert.equal(
      await details.locator("pre").count(),
      0,
      "Normal game details must not expose raw JSON",
    );
    assert.ok(
      (await details.locator("summary").innerText()).includes(
        "View game details",
      ),
    );
    assert.ok((await details.innerText()).includes("Attempt "));
    assert.ok(
      !(await details.innerText()).includes(".log"),
      "Engine filenames must not be presented as game explanations",
    );
  }
  await open();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    await gate;
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.getByRole("button", { name: /View observed games/ }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Loading observed games…", exact: true })
      .isDisabled(),
    true,
  );
  release();
  await inView();
  await page
    .getByText("No observed games have been recorded yet.", { exact: false })
    .waitFor();
  await page.unroute(endpoint);
  await open();
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Recorded games temporarily unavailable" }),
    }),
  );
  await page.getByRole("button", { name: /View observed games/ }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Recorded games temporarily unavailable" })
    .waitFor();
  assert.equal(await page.locator("#observed-match-games").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: /View observed games/ }).isEnabled(),
    true,
  );
  await page.unroute(endpoint);
  await page.getByRole("button", { name: /View observed games/ }).click();
  await inView();
  assert.ok(
    (await page.locator("#observed-match-games .observed-game").count()) > 0,
  );
  // Pagination uses copied row fixtures; these are UI states, not played games.
  const recorded = await fetch(
    base + "/api/v1/simulations/" + job.id + "/observations?limit=1",
  ).then((r) => r.json());
  const fixtures = Array.from({ length: 52 }, (_, i) => ({
    ...recorded[0],
    id: "pagination-fixture-" + i,
  }));
  const resultsEndpoint = "**/api/v1/simulations/" + job.id + "/results";
  await page.route(resultsEndpoint, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.job.observedGames = 52;
    await route.fulfill({ response, json: data });
  });
  let pageTwoAttempts = 0;
  await page.route(endpoint, (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset") || 0,
    );
    if (offset === 50 && pageTwoAttempts++ === 0)
      return route.fulfill({
        status: 503,
        json: { error: "Pagination temporarily unavailable" },
      });
    return route.fulfill({ json: fixtures.slice(offset, offset + 50) });
  });
  await open();
  await page.getByRole("button", { name: /View observed games/ }).click();
  await inView();
  assert.equal(
    await page.locator("#observed-match-games .observed-game").count(),
    50,
  );
  await page
    .getByRole("button", { name: "Load more observations →", exact: true })
    .click();
  await page.locator("#observed-match-games").getByRole("alert").waitFor();
  assert.equal(
    await page.locator("#observed-match-games .observed-game").count(),
    50,
    "A failed page must retain loaded games",
  );
  await page
    .getByRole("button", { name: "Retry loading games →", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#observed-match-games .observed-game")
        .length === 52,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Load more observations →", exact: true })
      .count(),
    0,
  );
  await page.unroute(endpoint);
  await page.unroute(resultsEndpoint);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      event: "observed_games_browser_passed",
      jobId: job.id,
      viewports: [1440, 390],
      focusAndScroll: true,
      loading: true,
      emptyState: true,
      errorAndRetry: true,
      paginationAndRetry: true,
    }),
  );
} finally {
  await browser.close();
}
