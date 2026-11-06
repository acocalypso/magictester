/* global document, window */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#format").selectOption("commander");
  assert.equal(
    await page.locator('#game-mode option[value="BO3"]').isDisabled(),
    true,
  );
  await page.locator("#format").selectOption("modern");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("#snapshot option")).some(
      (o) => o.textContent === "Modern · Local reference pool",
    ),
  );
  await page
    .locator("#snapshot")
    .selectOption({ label: "Modern · Local reference pool" });
  await page.getByRole("button", { name: "Load example" }).click();
  await page.locator("#game-mode").selectOption("BO3");
  await page.locator("#games").fill("1");
  await page.locator("#sideboarding").selectOption("forge");
  await page.locator("#deck-name").fill("BO3 browser acceptance");
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.waitForURL(/view=results&job=/);
  const jobId = new URL(page.url()).searchParams.get("job");
  let complete = false;
  for (let i = 0; i < 600; i++) {
    const job = await (
      await fetch(base + "/api/v1/simulations/" + jobId)
    ).json();
    assert.notEqual(job.state, "FAILED", job.error);
    if (job.state === "COMPLETED") {
      complete = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(complete, true);
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "BO3 match record", exact: true })
    .waitFor();
  await page.getByText("Game win rate", { exact: true }).waitFor();
  await page.getByRole("button", { name: /View observed games/ }).click();
  const observedHeading = page.getByRole("heading", {
    name: "Observed match games",
    exact: true,
  });
  await observedHeading.waitFor();
  await page.waitForFunction(
    () => document.activeElement?.id === "observed-match-games-heading",
  );
  const observedBox = await observedHeading.boundingBox();
  assert.ok(
    observedBox &&
      observedBox.y >= 0 &&
      observedBox.y + observedBox.height <= 1100,
    "Opening observed games must bring them into the viewport",
  );
  assert.ok((await page.locator("#observed-match-games tbody tr").count()) > 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.getByRole("button", { name: /View observed games/ }).click();
    await page.waitForFunction(
      () => document.activeElement?.id === "observed-match-games-heading",
    );
    const box = await observedHeading.boundingBox();
    assert.ok(
      box && box.y >= 0 && box.y + box.height <= 1100,
      "Observed games must be in view at width " + width,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      ),
      false,
      String(width),
    );
    await mkdir("data/browser", { recursive: true });
    await page.screenshot({
      path: `data/browser/bo3-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "data/browser/bo3-report.json",
    JSON.stringify({ jobId, viewports: [1440, 390], errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      event: "bo3_browser_passed",
      jobId,
      viewports: [1440, 390],
    }),
  );
} finally {
  await browser.close();
}
