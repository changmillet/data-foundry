import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

// Follow the actual development verification chain without adding a public dependency.
const rootRequire = createRequire(import.meta.url);
const sigstoreRequire = createRequire(rootRequire.resolve("sigstore"));
const tufRequire = createRequire(sigstoreRequire.resolve("@sigstore/tuf"));
const tufJsRequire = createRequire(tufRequire.resolve("tuf-js"));
const modelsRequire = createRequire(tufJsRequire.resolve("@tufjs/models"));
const minimatchRequire = createRequire(modelsRequire.resolve("minimatch"));
const expansionEntry = minimatchRequire.resolve("brace-expansion");

function leafManifest(): { name: string; version: string } {
  let directory = path.dirname(expansionEntry);
  for (let depth = 0; depth < 6; depth += 1) {
    const file = path.join(directory, "package.json");
    if (fs.existsSync(file)) {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === "brace-expansion" && typeof manifest.version === "string")
        return { name: manifest.name, version: manifest.version };
    }
    directory = path.dirname(directory);
  }
  throw new Error("Installed development brace-expansion package identity is missing.");
}

function boundedExpansion(pattern: string): void {
  const script = `const assert=require('node:assert/strict');
const {expand}=require(${JSON.stringify(expansionEntry)});
const result=expand(${JSON.stringify(pattern)},{max:1,maxLength:1});
assert(Array.isArray(result));`;
  execFileSync(
    process.execPath,
    ["--max-old-space-size=128", "--input-type=commonjs", "-e", script],
    {
      env: {},
      timeout: 10_000,
      maxBuffer: 32_768,
      stdio: "pipe",
    },
  );
}

test("development signature verification resolves the patched exact brace leaf", () => {
  assert.deepEqual(leafManifest(), { name: "brace-expansion", version: "5.0.12" });
});

test("ordinary brace alternation and numeric ranges retain their existing meaning", () => {
  const expand = (minimatchRequire("brace-expansion") as { expand: (pattern: string) => string[] })
    .expand;
  assert.deepEqual(expand("file-{a,b}-{1..3}"), [
    "file-a-1",
    "file-a-2",
    "file-a-3",
    "file-b-1",
    "file-b-2",
    "file-b-3",
  ]);
});

test("nested single groups cannot exhaust the bounded verification worker stack", () => {
  boundedExpansion("{".repeat(4_000) + "a,b" + "}".repeat(4_000));
});

test("nested comma alternatives cannot exhaust the bounded verification worker stack", () => {
  boundedExpansion("{a,".repeat(4_000) + "z" + "}".repeat(4_000));
});
