import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_SPECS,
  RETAINED_IDENTITY_PREFLIGHT_CLI_VERSIONS,
  TYPED_V4_CLI_PACKAGE_VERSION,
  isRetainedIdentityPreflightCliPackageSpec,
  isRetainedIdentityPreflightCliVersion,
  isTypedV4CliRuntime,
} from "../../src/lib/cli-compatibility-capabilities.ts";

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");

const MAX_AS_UNKNOWN_AS_CASTS = 32;
const ZERO_CAST_BOUNDARY_FILES = [
  "src/dev-cli.ts",
  "src/lib/foundry-cli.ts",
  "src/lib/foundry-decision-owners.ts",
  "src/lib/foundry-identity-owners.ts",
  "src/lib/foundry-finalize-owners.ts",
  "src/lib/foundry-workflow-decisions.ts",
  "src/lib/foundry-workflow-semantic.ts",
  "src/lib/foundry-workflow-identity-apply.ts",
  "src/lib/foundry-workflow-repair.ts",
  "src/lib/foundry-workflow-repair-preparation-read.ts",
  "src/lib/import-curation/curation-gate.ts",
  "src/lib/import-curation/mutation-manifest.ts",
  "src/lib/import-curation/internal/curation-gate-report.ts",
  "src/lib/import-curation/internal/mutation-manifest-report.ts",
  "src/lib/import-curation/internal/workflow-context-types.ts",
  "src/lib/import-curation/internal/workflow-full-context-blockers.ts",
  "src/lib/import-curation/internal/workflow-reference-closure.ts",
] as const;

function listTypeScriptSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTypeScriptSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function findPatternMatches(
  filePath: string,
  pattern: RegExp,
): Array<{ file: string; line: number; text: string }> {
  const relative = path.relative(repoRoot, filePath).split(path.sep).join("/");
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
  const matches: Array<{ file: string; line: number; text: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hits = line.match(pattern);
    if (!hits) continue;
    for (let count = 0; count < hits.length; count += 1) {
      matches.push({ file: relative, line: index + 1, text: line.trim() });
    }
  }
  return matches;
}

describe("TypeScript type-safety ratchet", () => {
  test("forbids all `as never` casts across src/**/*.ts", () => {
    const files = listTypeScriptSourceFiles(srcRoot);
    const matches = files.flatMap((file) => findPatternMatches(file, /\bas\s+never\b/gu));
    assert.deepEqual(
      matches,
      [],
      `Expected zero \`as never\` casts in src/**/*.ts, found ${matches.length}:\n${matches
        .map((match) => `  ${match.file}:${match.line}: ${match.text}`)
        .join("\n")}`,
    );
  });

  test("enforces shrink-only `as unknown as` ceiling across src/**/*.ts and zero casts in boundary owners", () => {
    const files = listTypeScriptSourceFiles(srcRoot);
    const matches = files.flatMap((file) => findPatternMatches(file, /\bas\s+unknown\s+as\b/gu));
    assert.ok(
      matches.length <= MAX_AS_UNKNOWN_AS_CASTS,
      `Expected at most ${MAX_AS_UNKNOWN_AS_CASTS} \`as unknown as\` casts in src/**/*.ts, found ${matches.length}`,
    );

    const byFile = new Map<string, number>();
    for (const match of matches) {
      byFile.set(match.file, (byFile.get(match.file) ?? 0) + 1);
    }
    for (const boundaryFile of ZERO_CAST_BOUNDARY_FILES) {
      assert.equal(
        byFile.get(boundaryFile) ?? 0,
        0,
        `Expected zero \`as unknown as\` casts in ${boundaryFile}`,
      );
    }
  });
});

describe("CLI compatibility capability helper", () => {
  test("matches retained identity preflight CLI versions and package specs", () => {
    assert.deepEqual([...RETAINED_IDENTITY_PREFLIGHT_CLI_VERSIONS], ["0.1.22", "0.1.27", "0.1.28"]);
    assert.deepEqual(
      [...RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_SPECS],
      ["@tiangong-lca/cli@0.1.22", "@tiangong-lca/cli@0.1.27", "@tiangong-lca/cli@0.1.28"],
    );

    for (const version of RETAINED_IDENTITY_PREFLIGHT_CLI_VERSIONS) {
      assert.equal(isRetainedIdentityPreflightCliVersion(version), true);
      assert.equal(isRetainedIdentityPreflightCliVersion(`  ${version}  `), false);
    }
    assert.equal(isRetainedIdentityPreflightCliVersion("0.4.0"), false);
    assert.equal(isRetainedIdentityPreflightCliVersion("0.1.21"), false);
    assert.equal(isRetainedIdentityPreflightCliVersion(""), false);
    assert.equal(isRetainedIdentityPreflightCliVersion(null), false);
    assert.equal(isRetainedIdentityPreflightCliVersion(undefined), false);

    for (const spec of RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_SPECS) {
      assert.equal(isRetainedIdentityPreflightCliPackageSpec(spec), true);
    }
    assert.equal(isRetainedIdentityPreflightCliPackageSpec("@tiangong-lca/cli@0.4.0"), false);
    assert.equal(isRetainedIdentityPreflightCliPackageSpec("other-pkg@0.1.28"), false);
    assert.equal(isRetainedIdentityPreflightCliPackageSpec(null), false);
  });

  test("identifies typed v0.4.0 CLI runtimes by exact package version", () => {
    assert.equal(TYPED_V4_CLI_PACKAGE_VERSION, "0.4.0");
    assert.equal(isTypedV4CliRuntime("0.4.0"), true);
    assert.equal(isTypedV4CliRuntime("0.1.28"), false);
    assert.equal(isTypedV4CliRuntime("@tiangong-lca/cli@0.4.0"), false);
    assert.equal(isTypedV4CliRuntime(null), false);
    assert.equal(isTypedV4CliRuntime(undefined), false);
  });
});
