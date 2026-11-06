/* global document, window */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
const evidence = JSON.parse(await readFile("data/pods-smoke.json", "utf8"));
const jobId = evidence.reports.find((r) => r.format === "commander").jobId;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  for (const format of ["commander", "cedh", "duel"]) {
    await page.locator("#format").selectOption(format);
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("#snapshot option")).some((o) =>
        o.textContent.includes("Local reference pool"),
      ),
    );
    const label = (
      await page.locator("#snapshot option").allTextContents()
    ).find((name) => name.includes("Local reference pool"));
    await page.locator("#snapshot").selectOption({ label });
    await page.getByRole("button", { name: "Load example" }).click();
    await page.getByRole("button", { name: "Validate deck" }).click();
    await page.getByText("Deck validated", { exact: false }).waitFor();
    assert.equal(await page.locator("#clock").inputValue(), "120");
    assert.ok(
      (await page.locator("#decklist").inputValue()).includes("Commander"),
    );
    if (format !== "duel")
      assert.ok(
        (
          await page.getByRole("list", { name: "Planned pods" }).innerText()
        ).includes("Laquatus reference"),
      );
    if (format !== "duel")
      await page
        .getByText("Lists repeat to fill the three opponent seats.", {
          exact: false,
        })
        .waitFor();
  }
  await page.goto(base + "/?view=results&job=" + jobId, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("heading", { name: "Commander results", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Pod performance", exact: true })
    .waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    assert.equal(overflow, false, String(width));
    await mkdir("data/browser", { recursive: true });
    await page.screenshot({
      path: `data/browser/commander-${width}.png`,
      fullPage: true,
    });
  }
  const duel = JSON.parse(await readFile("data/duel-smoke.json", "utf8"));
  await page.goto(base + "/?view=results&job=" + duel.jobId, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("heading", { name: "Commander results", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Matchup performance", exact: true })
    .waitFor();
  assert.ok(
    (
      await page
        .getByRole("region", { name: "Commander results" })
        .locator("dd")
        .first()
        .innerText()
    ).includes("/ 2"),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      event: "pods_browser_passed",
      formats: ["commander", "cedh", "duel"],
      jobId,
      viewports: [1440, 390],
    }),
  );
} finally {
  await browser.close();
}
