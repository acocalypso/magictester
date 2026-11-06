/* global document */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
const formats = (await (await fetch(base + "/api/v1/formats")).json()).filter(
  (f) => f.enabled && !f.commander,
);
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
  for (const format of formats) {
    await page.locator("#format").selectOption(format.id);
    await page.waitForFunction(
      (name) =>
        Array.from(document.querySelectorAll("#snapshot option")).some(
          (option) => option.textContent === name,
        ),
      `${format.name} · Local reference pool`,
    );
    await page.getByRole("button", { name: "Load example" }).click();
    await page.getByRole("button", { name: "Validate deck" }).click();
    await page.getByText("Deck validated", { exact: false }).waitFor();
    assert.ok(
      (await page.locator("#decklist").inputValue()).includes("Mountain"),
    );
    assert.equal(await page.locator("#format").inputValue(), format.id);
  }
  await page.locator("#format").selectOption("modern");
  await page.locator("#decklist").fill("59 Forest\n1 Black Lotus");
  await page.getByRole("button", { name: "Validate deck" }).click();
  await page.getByText(/Black Lotus is .* in modern/).waitFor();
  await page
    .getByRole("button", { name: "Benchmark pools", exact: true })
    .click();
  await page.locator("#pool-format-filter").selectOption("legacy");
  await page
    .getByRole("heading", {
      name: "Legacy · Local reference pool",
      exact: true,
    })
    .waitFor();
  await mkdir("data/browser", { recursive: true });
  await writeFile(
    "data/browser/formats.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        formats: formats.map((f) => f.id),
        exampleValidation: true,
        bannedCardFeedback: true,
        formatFilteredPools: true,
        uncaughtErrors: errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      event: "formats_browser_passed",
      formats: formats.length,
    }),
  );
} finally {
  await browser.close();
}
