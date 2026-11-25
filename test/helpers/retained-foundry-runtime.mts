import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import {
  command,
  isolatedEnvironment,
  packageManagerCommand,
} from "./package-consumer-process.mts";
import { acquireDirectoryLockSync } from "./shared-installed-package-template.mts";

// The published Foundry 0.1.18 source locks both the original CLI and its dependency graph.
const retainedSource = "b57ae1166759ee2c490eff9b79b74dfad08a5b58";
const repo = path.resolve(import.meta.dirname, "../..");
const canonicalTmpDir = fs.realpathSync(os.tmpdir());
const sharedRetainedStoreDir = path.join(canonicalTmpDir, "foundry-retained-pnpm-store-v1");

export function runRetainedFoundryTests(
  t: TestContext,
  files: readonly string[],
  namePattern?: string,
): void {
  assert.ok(
    files.length &&
      files.every((file) => /^test\/(?:scenarios|unit)\/[\w-]+\.test\.mts$/u.test(file)),
  );
  const root = fs.realpathSync(fs.mkdtempSync(path.join(canonicalTmpDir, "foundry-original-")));
  const source = path.join(root, "source");
  const env = isolatedEnvironment(path.join(root, "home"), {
    CI: "true",
    COREPACK_ENABLE_NETWORK: "1",
  });
  try {
    const commonDirResult = command("git", ["rev-parse", "--git-common-dir"], repo, env);
    assert.equal(commonDirResult.status, 0, commonDirResult.stderr);
    const commonGitDir = path.resolve(repo, commonDirResult.stdout.trim());
    const cloned = command(
      "git",
      ["clone", "--quiet", "--no-checkout", "--shared", commonGitDir, source],
      repo,
      env,
    );
    assert.equal(cloned.status, 0, cloned.stderr);
    const checkout = command(
      "git",
      ["checkout", "--quiet", "--detach", retainedSource],
      source,
      env,
    );
    assert.equal(checkout.status, 0, checkout.stderr);
    fs.mkdirSync(sharedRetainedStoreDir, { recursive: true, mode: 0o700 });
    const releaseStoreLock = acquireDirectoryLockSync(`${sharedRetainedStoreDir}.lock`, 300_000);
    try {
      const install = packageManagerCommand(
        "pnpm",
        [
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--store-dir",
          sharedRetainedStoreDir,
          "--package-import-method=copy",
        ],
        source,
        env,
        300_000,
      );
      assert.equal(install.status, 0, install.stderr || install.stdout);
    } finally {
      releaseStoreLock();
    }
    const cli = command(
      process.execPath,
      ["node_modules/@tiangong-lca/cli/bin/tiangong-lca.js", "--version"],
      source,
      env,
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), "0.1.28");
    // The retained test suite runs the real original source, with synthetic remote transport.
    const tests = command(
      process.execPath,
      [
        "--test",
        "--test-reporter=spec",
        ...(namePattern ? [`--test-name-pattern=${namePattern}`] : []),
        ...files,
      ],
      source,
      env,
      900_000,
    );
    assert.equal(tests.status, 0, tests.stderr + tests.stdout);
    assert.match(tests.stdout, /^ℹ pass [1-9][0-9]*$/mu);
    assert.match(tests.stdout, /^ℹ skipped 0$/mu);
    t.diagnostic(tests.stdout.trim());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
