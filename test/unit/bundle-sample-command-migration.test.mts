import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "src/commands/bundle-sample-rows.ts");
const legacyPath = path.join(repoRoot, "src/commands/bundle-sample-rows.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("bundle-sample command exists only as native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const source = fs.readFileSync(typedPath, "utf8");
  assert.doesNotMatch(source, /(?:[:<>,(|]\s*any\b|\bas\s+any\b)/u);
  assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createBundleSampleRowsCommands"],
  );
});

test("bundle-sample consumers and metadata target the typed factory", () => {
  for (const consumer of ["src/dev-cli.ts", "src/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(source, /bundle-sample-rows\.ts/u, consumer);
    assert.doesNotMatch(source, /bundle-sample-rows\.mjs/u, consumer);
  }
});

test("bundle-sample help report retains exact bytes", () => {
  const output = execFileSync(
    process.execPath,
    ["test/fixtures/run-internal-stage.ts", "dataset-bundle-sample-rows", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(Buffer.byteLength(output, "utf8"), 4920);
  assert.equal(
    createHash("sha256").update(output).digest("hex"),
    "e233f1c56025bc22e12a4a76056b1de1862c2e1a4a73ff2528bc25fa02166914",
  );
});
