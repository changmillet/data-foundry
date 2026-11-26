import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "src/commands/topology-convergence.ts");
const legacyPath = path.join(repoRoot, "src/commands/topology-convergence.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("topology command exists only as native TypeScript", async () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  const libDir = path.join(repoRoot, "src/lib/topology-convergence");
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
    "occurrenceKeyedExchanges",
    "admissionRequestBinding",
    "createTopologyConvergenceCommands",
  ]) {
    assert.equal(typeof mod[exportName], "function");
  }
});

test("topology consumers and metadata target the typed module", () => {
  for (const consumer of ["src/dev-cli.ts", "src/lib/foundry-command-metadata.ts"]) {
    const source = readRepoFile(consumer);
    assert.match(source, /topology-convergence\.ts/u, consumer);
    assert.doesNotMatch(source, /topology-convergence\.mjs/u, consumer);
  }
  const unitSource = readRepoFile("test/unit/topology-convergence.test.mts");
  assert.match(unitSource, /topology-convergence\.ts/u);
});

test("topology help report retains exact bytes", () => {
  const output = execFileSync(
    process.execPath,
    ["src/dev-cli.ts", "dataset-topology-convergence-compose", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(Buffer.byteLength(output, "utf8"), 3341);
  assert.equal(
    createHash("sha256").update(output).digest("hex"),
    "b5787ef83ebbdf328397a41561d5349cd1b78ff5f3cc2efeb63ae4ca151f6ec9",
  );
});
