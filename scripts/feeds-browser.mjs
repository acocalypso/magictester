/* global document, innerWidth */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const token =
  process.env.ADMIN_TOKEN ||
  (await readFile(".env", "utf8")).match(/^ADMIN_TOKEN=(.+)$/m)?.[1];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000");
  await page
    .getByRole("button", { name: "Benchmark pools", exact: true })
    .click();
  await page.getByRole("heading", { name: "Scheduled feeds" }).waitFor();
  await page.getByLabel("Admin token", { exact: false }).fill(token);
  const card = page
    .locator(".info-banner")
    .filter({ hasText: "Project reference feed" });
  await card.getByRole("button", { name: "Refresh now", exact: true }).click();
  await card.getByRole("button", { name: "Pause", exact: true }).click();
  await card.getByRole("button", { name: "Enable", exact: true }).waitFor();
  await card.getByRole("button", { name: "Enable", exact: true }).click();
  await card.getByRole("button", { name: "Pause", exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  console.log(JSON.stringify({ event: "feed_browser_passed" }));
} finally {
  await browser.close();
}
