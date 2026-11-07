/* global document, innerWidth */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { rateLimitedFetch } from "./test-http.mjs";
const base = process.env.BASE_URL || "http://localhost:3000";
const report = JSON.parse(
  await readFile("data/retry-settings-smoke.json", "utf8"),
);
async function req(path, body) {
  const r = await rateLimitedFetch(base + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(r.ok, await r.clone().text());
  return r.json();
}
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("data/browser", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + "/?view=results&job=" + report.source, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Retry with settings", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= width,
      "Retry dialog must fit inside the viewport",
    );
    assert.equal(await dialog.getByLabel("Retry method").inputValue(), "new");
    assert.equal(
      await dialog.getByLabel("Game time limit (seconds)").inputValue(),
      "300",
    );
    await dialog.getByLabel("Game time limit (seconds)").fill("301");
    assert.equal(
      await dialog
        .getByRole("button", { name: "Start new run", exact: true })
        .isDisabled(),
      true,
    );
    await dialog.getByLabel("Game time limit (seconds)").fill("300");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `data/browser/retry-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await page
        .getByRole("button", { name: "Retry with settings", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
  }
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#format").selectOption("commander");
  assert.equal(await page.locator("#clock").inputValue(), "300");
  assert.equal(await page.locator("#clock").getAttribute("max"), "300");
  await page.goto(base + "/?view=results&job=" + report.source, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "Retry with settings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start new run", exact: true })
    .click();
  await page.waitForURL(
    (url) =>
      url.searchParams.get("job") !== report.source &&
      url.searchParams.get("view") === "results",
  );
  const childId = new URL(page.url()).searchParams.get("job");
  const child = await req(`/simulations/${childId}`);
  assert.equal(child.clockSeconds, 300);
  assert.equal(child.config.retryOf, report.source);
  await req(`/simulations/${childId}/cancel`, {});
  await page.goto(base + "/?view=results&job=" + childId, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "Retry with settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByLabel("Retry method").inputValue(), "resume");
  assert.equal(
    await dialog.getByLabel("Game time limit (seconds)").isDisabled(),
    true,
  );
  await dialog.getByLabel("Retry method").selectOption("new");
  assert.equal(
    await dialog.getByLabel("Game time limit (seconds)").isDisabled(),
    false,
  );
  await dialog.getByLabel("Retry method").selectOption("resume");
  // Give cancellation enough time to release the worker before resuming its checkpoint.
  for (let i = 0; i < 30; i++) {
    const r = await rateLimitedFetch(
      base + `/api/v1/simulations/${childId}/retry`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    if (r.ok) {
      const resumed = await r.json();
      assert.equal(resumed.id, childId);
      break;
    }
    assert.equal(r.status, 409);
    assert.ok(i < 29);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await page.keyboard.press("Escape");
  for (let i = 0; i < 180; i++) {
    const job = await req(`/simulations/${childId}`);
    assert.notEqual(job.state, "FAILED", job.error);
    if (job.state === "COMPLETED") break;
    assert.ok(i < 179);
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "data/retry-settings-browser.json",
    JSON.stringify(
      { childId, source: report.source, widths: [1440, 390], resumed: true },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ event: "retry_settings_browser_passed", childId }),
  );
} finally {
  await browser.close();
}
