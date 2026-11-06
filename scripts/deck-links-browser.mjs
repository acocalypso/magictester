/* global document, innerWidth */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
  errors = [],
  remoteFonts = [];
const base = process.env.BASE_URL || "http://localhost:3000";
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    r.resourceType() === "font" &&
    new URL(r.url()).origin !== new URL(base).origin
  )
    remoteFonts.push(r.url());
});
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page
    .getByText("How your deck is checked and tested", { exact: true })
    .click();
  await page
    .getByText("These results measure this Forge AI configuration.", {
      exact: false,
    })
    .waitFor({ state: "visible" });
  await page.locator("#format").selectOption("modern");
  await page
    .locator("#deck-url")
    .fill(
      process.env.MOXFIELD_TEST_URL ||
        "https://moxfield.com/decks/U_e-z8UhZ0Ol42QMUgs9Tw",
    );
  await page.getByRole("button", { name: "Import deck", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Imported from Moxfield" })
    .waitFor();
  assert.ok(
    (await page.locator("#decklist").inputValue()).includes("Mainboard"),
  );
  const before = await page.locator("#decklist").inputValue();
  // Explicit negative UI case; this mocked error does not represent a played game.
  await page.route("**/api/v1/decks/import-link", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "This deck is private or unavailable." }),
    }),
  );
  await page.getByRole("button", { name: "Import deck", exact: true }).click();
  await page
    .getByText("This deck is private or unavailable.", { exact: false })
    .waitFor();
  assert.equal(await page.locator("#decklist").inputValue(), before);
  await page.unroute("**/api/v1/decks/import-link");
  for (const width of [1440, 768, 390]) {
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
      event: "deck_link_browser_passed",
      providersTestedLive: ["moxfield"],
      guideVisible: true,
      preservedEditorOnFailure: true,
      viewports: [1440, 768, 390],
      localFontsOnly: true,
    }),
  );
} finally {
  await browser.close();
}
