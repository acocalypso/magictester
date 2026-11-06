/* global document, innerWidth */
// Browser acceptance against the real running stack. Install Chromium with
// `npx playwright install chromium`, or set CHROMIUM_PATH to an existing binary.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
const assetErrors = [];
const fontRequests = new Set();
const remoteFontRequests = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (request.resourceType() === "font") {
    fontRequests.add(request.url());
    if (url.origin !== new URL(base).origin)
      remoteFontRequests.push(request.url());
  }
  if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname))
    remoteFontRequests.push(request.url());
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().includes("/fonts/") && response.status() >= 400)
    assetErrors.push(`${response.status()} ${response.url()}`);
});
await mkdir("data/browser", { recursive: true });
try {
  const response = await page.goto(base, { waitUntil: "networkidle" });
  assert.match(
    response.headers()["content-security-policy"] || "",
    /(?:^|;)\s*font-src 'self'(?:;|$)/,
    "Browser policy permits fonts from this origin only",
  );
  await page.getByRole("button", { name: "Load example" }).click();
  const pool = page.getByLabel("Benchmark pool", { exact: true });
  const options = await pool.locator("option").allTextContents();
  const reference = options.find((name) =>
    name.includes("Local reference pool"),
  );
  if (reference) await pool.selectOption({ label: reference });
  await page.getByRole("button", { name: "Validate deck" }).click();
  await page.getByText("Deck validated", { exact: false }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.ok(
    await page.evaluate(() => document.fonts.check('14px "Public Sans"')),
    "Bundled Public Sans loaded",
  );
  await page.screenshot({
    path: "data/browser/analysis-desktop.png",
    fullPage: true,
  });
  let jobId = process.env.BROWSER_JOB_ID;
  if (!jobId) {
    const name = "Browser acceptance " + Date.now();
    await page.getByLabel("Deck name", { exact: true }).fill(name);
    await page.getByLabel("Total games", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Analyze deck", exact: true })
      .click();
    await page.waitForURL(/view=results&job=/);
    jobId = new URL(page.url()).searchParams.get("job");
  } else
    await page.goto(base + "/?view=results&job=" + jobId, {
      waitUntil: "networkidle",
    });
  await page
    .getByText("COMPLETED", { exact: true })
    .waitFor({ timeout: 300000 });
  await page.screenshot({
    path: "data/browser/results-desktop.png",
    fullPage: true,
  });
  const evidence = await (
    await fetch(base + "/api/v1/simulations/" + jobId + "/runs")
  ).json();
  assert.equal(evidence.length, 2);
  assert.ok(
    evidence.every(
      (run) => run.result?.engine === "forge" && run.state === "DONE",
    ),
  );
  await page
    .getByRole("button", { name: "Details", exact: false })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.keyboard.press("Tab");
  assert.ok(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    "Focus stays inside run evidence",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Results library", exact: true })
    .click();
  await page.getByRole("heading", { name: "Test records." }).waitFor();
  await page
    .getByRole("button", { name: "Simulation queue", exact: true })
    .click();
  await page.getByRole("heading", { name: "Simulation queue." }).waitFor();
  await page.screenshot({
    path: "data/browser/queue-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Benchmark pools", exact: true })
    .click();
  await page.getByRole("heading", { name: "Opponent pools." }).waitFor();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      "New analysis",
      "Simulation queue",
      "Results library",
      "Benchmark pools",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${name} overflows at ${width}px`,
      );
    }
    await page
      .getByRole("button", { name: "New analysis", exact: true })
      .click();
    await page.screenshot({
      path: `data/browser/analysis-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, [], "No uncaught browser errors");
  assert.deepEqual(assetErrors, [], "All local fonts load");
  assert.ok(
    [...fontRequests].some(
      (url) => new URL(url).pathname === "/fonts/public-sans.woff2",
    ),
    "Public Sans is requested from the bundled file",
  );
  assert.deepEqual(
    remoteFontRequests,
    [],
    "No remote font or Google Fonts stylesheet requests",
  );
  const report = {
    verifiedAt: new Date().toISOString(),
    jobId,
    realGames: evidence.length,
    viewports: [1440, 768, 390],
    uncaughtErrors: errors.length,
    fontErrors: assetErrors.length,
    localFontsOnly: true,
    keyboardDialog: true,
    navigationViews: 4,
  };
  await writeFile("data/browser/report.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ event: "browser_acceptance_passed", ...report }),
  );
} finally {
  await browser.close();
}
