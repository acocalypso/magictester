import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
await mkdir("dist", { recursive: true });
for (const name of ["bridge", "metadata", "contracts"])
  await cp(name, "dist/" + name, { recursive: true });
await mkdir("tests/generated", { recursive: true });
for (const name of await readdir("contract-tests")) {
  const source = (await readFile("contract-tests/" + name, "utf8"))
    .replaceAll("../src/", "../../dist/core/")
    .replaceAll("services/forge-runner/fixtures/", "fixtures/");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  await writeFile("tests/generated/" + name.replace(/\.ts$/, ".mjs"), compiled);
}
