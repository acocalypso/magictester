/* global document,innerWidth */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
const remoteFonts = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    r.resourceType() === "font" &&
    new URL(r.url()).origin !==
      new URL(process.env.BASE_URL || "http://localhost:3000").origin
  )
    remoteFonts.push(r.url());
});
try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000", {
    waitUntil: "networkidle",
  });
  await page.getByText("Daily metagame · current", { exact: true }).waitFor();
  assert.equal(await page.locator("#snapshot").inputValue(), "latest");
  await page
    .getByText("Choose opponents & allocation", { exact: true })
    .click();
  assert.equal(await page.locator("#allocation-mode").inputValue(), "meta");
  assert.ok((await page.locator(".opponent-choice").count()) > 0);
  const reference = (
    await page.locator("#snapshot option").allTextContents()
  ).find((s) => s.includes("Local reference pool"));
  await page.locator("#snapshot").selectOption({ label: reference });
  assert.equal(await page.locator("#allocation-mode").inputValue(), "equal");
  await page.locator("#snapshot").selectOption("latest");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteFonts, []);
  console.log(
    JSON.stringify({
      event: "daily_meta_browser_passed",
      localFontsOnly: true,
    }),
  );
} finally {
  await browser.close();
}
