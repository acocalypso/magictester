import { test } from "node:test";
import assert from "node:assert/strict";
import { feedUrl, feedInput } from "../src/feeds.js";
test("feed URLs require an exact authorized HTTPS host and reject bypasses", () => {
  assert.equal(
    feedUrl(
      "https://raw.githubusercontent.com/acocalypso/magictester/main/examples/pauper-reference.json",
    ).hostname,
    "raw.githubusercontent.com",
  );
  for (const url of [
    "http://raw.githubusercontent.com/a",
    "https://raw.githubusercontent.com.evil.test/a",
    "https://u:p@raw.githubusercontent.com/a",
    "https://raw.githubusercontent.com:8443/a",
    "https://127.0.0.1/a",
    "https://raw.githubusercontent.com/a#fragment",
  ])
    assert.throws(() => feedUrl(url));
  assert.throws(() =>
    feedInput.parse({
      name: "test",
      url: "https://example.com/a",
      format: "modern",
      intervalHours: 0,
      permission: "Own feed permission",
    }),
  );
});
