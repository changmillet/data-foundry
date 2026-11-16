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

// The published Foundry 0.1.18 source locks both the original CLI and its dependency graph.
const retainedSource = "b57ae1166759ee2c490eff9b79b74dfad08a5b58";
const repo = path.resolve(import.meta.dirname, "../..");

export function runRetainedFoundryTests(
  t: TestContext,
  files: readonly string[],
  namePattern?: string,
): void {
  assert.ok(
    files.length &&
      files.every((file) => /^test\/(?:scenarios|unit)\/[\w-]+\.test\.mts$/u.test(file)),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-original-"));
  const source = path.join(root, "source");
  const env = isolatedEnvironment(path.join(root, "home"), {
    CI: "true",
    COREPACK_ENABLE_NETWORK: "1",
  });
  let checkoutCreated = false;
  try {
    const checkout = command(
      "git",
      ["worktree", "add", "--detach", source, retainedSource],
      repo,
      env,
    );
    assert.equal(checkout.status, 0, checkout.stderr);
    checkoutCreated = true;
    const install = packageManagerCommand(
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts"],
      source,
      env,
      300_000,
    );
    assert.equal(install.status, 0, install.stderr || install.stdout);
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
    if (checkoutCreated) {
      const removed = command("git", ["worktree", "remove", "--force", source], repo, env);
      assert.equal(removed.status, 0, removed.stderr);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
