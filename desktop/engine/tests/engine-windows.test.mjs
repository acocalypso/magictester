import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ForgeResultParser } from "../dist/core/engine.js";

test("Forge log parsing accepts Windows CRLF as well as Unix line endings", async () => {
  for (const fixture of ["real-game.log", "native-timeout.log"]) {
    const text = await readFile(new URL("../fixtures/" + fixture, import.meta.url), "utf8");
    const parse = (value) => {
      const parser = new ForgeResultParser("2.0.15", 12345);
      return value.split("\n").map((line) => parser.line(line)).filter(Boolean);
    };
    const unix = parse(text.replaceAll("\r\n", "\n"));
    assert.equal(unix.length, 1);
    assert.deepEqual(parse(text.replace(/\r?\n/g, "\r\n")), unix);
  }
});
