/* global document, innerWidth */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(process.env.BASE_URL || "http://localhost:3000", {
    waitUntil: "networkidle",
  });
  await page
    .getByText("Choose opponents & allocation", { exact: true })
    .click();
  await page.getByLabel("Allocation", { exact: true }).selectOption("custom");
  await page
    .getByRole("spinbutton", { name: /Weight for/ })
    .first()
    .fill("3");
  assert.equal(
    await page
      .getByRole("spinbutton", { name: /Weight for/ })
      .first()
      .inputValue(),
    "3",
  );
  await page.locator("#format").selectOption("commander");
  await page.locator("#snapshot option").first().waitFor({ state: "attached" });
  await page
    .locator("#snapshot")
    .selectOption({ label: "Commander · Local reference pool" });
  await page
    .getByText("Choose opponents & allocation", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add an ordered pod", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add an ordered pod", exact: true })
    .click();
  assert.equal(
    await page.getByRole("combobox", { name: /Pod 1 seat/ }).count(),
    3,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await page.getByRole("button", { name: "Remove pod 1", exact: true }).click();
  assert.equal(
    await page.getByRole("combobox", { name: /Pod 1 seat/ }).count(),
    0,
  );
  console.log(JSON.stringify({ event: "selection_browser_passed" }));
} finally {
  await browser.close();
}
