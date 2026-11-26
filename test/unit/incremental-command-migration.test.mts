import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "src/commands/incremental-change-set.ts");
const legacyPath = path.join(repoRoot, "src/commands/incremental-change-set.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("incremental command exists only as native TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const libDir = path.join(repoRoot, "src/lib/incremental-change-set");
  const sourceFiles = [
    typedPath,
    ...fs
      .readdirSync(libDir)
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => path.join(libDir, entry)),
  ];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
  }
  const mod = (await import(pathToFileURL(typedPath).href)) as Record<string, unknown>;
  for (const exportName of [
    "stableValue",
    "stableJson",
    "sha256Json",
    "valueSha256",
    "conversionHashSets",
    "mergeThreeWay",
    "readJsonLinesWithMeta",
    "createIncrementalChangeSetCommands",
  ]) {
    assert.equal(typeof mod[exportName], "function");
  }
});

test("incremental consumers and metadata target the typed module", () => {
  for (const consumer of ["src/dev-cli.ts", "src/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(source, /incremental-change-set\.ts/u, consumer);
    assert.doesNotMatch(source, /incremental-change-set\.mjs/u, consumer);
  }
  const unitSource = readRepoFile("test/unit/incremental-change-set.test.mts");
  assert.match(unitSource, /incremental-change-set\.ts/u);
});

test("incremental help report retains exact bytes", () => {
  const output = execFileSync(
    process.execPath,
    ["src/dev-cli.ts", "dataset-incremental-change-set-compose", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(Buffer.byteLength(output, "utf8"), 3551);
  assert.equal(
    createHash("sha256").update(output).digest("hex"),
    "e006ac6dc756f9a87ffcf06e0d9721e2aa725edf6c853b9644a11f75e8496d64",
  );
});
