import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import {
  command,
  isolatedEnvironment,
  packageManagerCommand,
} from "./package-consumer-process.mts";
import {
  acquireDirectoryLockSync,
  preferredHostTempRoot,
} from "./shared-installed-package-template.mts";

// The published Foundry 0.1.18 source locks both the original CLI and its dependency graph.
const retainedSource = "b57ae1166759ee2c490eff9b79b74dfad08a5b58";
const repo = path.resolve(import.meta.dirname, "../..");
const canonicalTmpDir = preferredHostTempRoot();
const sharedRetainedStoreDir = path.join(canonicalTmpDir, "foundry-retained-pnpm-store-v1");
const sharedRetainedCorepackHome = path.join(canonicalTmpDir, "foundry-retained-corepack-v1");
const storePopulatedMarker = path.join(sharedRetainedStoreDir, `populated-${retainedSource}.json`);
const sharedRetainedWorkspaceDir = path.join(
  canonicalTmpDir,
  `foundry-retained-workspace-v1-${retainedSource.slice(0, 16)}`,
);
const workspaceReadyMarker = path.join(sharedRetainedWorkspaceDir, ".ready.json");
const checkoutMutatingRetainedFiles = new Set([
  "test/scenarios/production-contact-draft-case.test.mts",
]);

let inProcessWorkspaceReady = false;

function checkoutAndInstallRetainedSource(source: string, env: NodeJS.ProcessEnv): void {
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
  const checkout = command("git", ["checkout", "--quiet", "--detach", retainedSource], source, env);
  assert.equal(checkout.status, 0, checkout.stderr);
  fs.mkdirSync(sharedRetainedStoreDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(sharedRetainedCorepackHome, { recursive: true, mode: 0o700 });
  const releaseStoreLock = acquireDirectoryLockSync(`${sharedRetainedStoreDir}.lock`, 900_000);
  try {
    const storeReady = fs.existsSync(storePopulatedMarker);
    const baseArgs = [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      sharedRetainedStoreDir,
    ];
    let install = packageManagerCommand(
      "pnpm",
      storeReady ? [...baseArgs, "--offline"] : baseArgs,
      source,
      env,
      300_000,
    );
    if (storeReady && install.status !== 0) {
      install = packageManagerCommand("pnpm", baseArgs, source, env, 300_000);
    }
    assert.equal(install.status, 0, install.stderr || install.stdout);
    if (!storeReady) {
      fs.writeFileSync(
        storePopulatedMarker,
        JSON.stringify({ retainedSource, populatedAt: new Date().toISOString() }),
      );
    }
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
}

function ensureSharedRetainedWorkspace(): string {
  if (inProcessWorkspaceReady && fs.existsSync(workspaceReadyMarker)) {
    return sharedRetainedWorkspaceDir;
  }
  const releaseWorkspaceLock = acquireDirectoryLockSync(
    `${sharedRetainedWorkspaceDir}.lock`,
    900_000,
  );
  try {
    if (!fs.existsSync(workspaceReadyMarker)) {
      fs.rmSync(sharedRetainedWorkspaceDir, { recursive: true, force: true });
      const bootstrapRoot = fs.realpathSync(
        fs.mkdtempSync(path.join(canonicalTmpDir, "foundry-retained-bootstrap-")),
      );
      try {
        const bootstrapTmp = path.join(bootstrapRoot, "tmp");
        fs.mkdirSync(bootstrapTmp, { recursive: true, mode: 0o700 });
        const env = isolatedEnvironment(path.join(bootstrapRoot, "home"), {
          CI: "true",
          COREPACK_ENABLE_NETWORK: "1",
          COREPACK_HOME: sharedRetainedCorepackHome,
          TMP: bootstrapTmp,
          TEMP: bootstrapTmp,
          TMPDIR: bootstrapTmp,
        });
        checkoutAndInstallRetainedSource(sharedRetainedWorkspaceDir, env);
        fs.writeFileSync(
          workspaceReadyMarker,
          JSON.stringify({ retainedSource, readyAt: new Date().toISOString() }),
        );
      } finally {
        fs.rmSync(bootstrapRoot, { recursive: true, force: true });
      }
    }
  } finally {
    releaseWorkspaceLock();
  }
  inProcessWorkspaceReady = true;
  return sharedRetainedWorkspaceDir;
}

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
  const childTmp = path.join(root, "tmp");
  fs.mkdirSync(childTmp, { recursive: true, mode: 0o700 });
  const env = isolatedEnvironment(path.join(root, "home"), {
    CI: "true",
    COREPACK_ENABLE_NETWORK: "1",
    COREPACK_HOME: sharedRetainedCorepackHome,
    TMP: childTmp,
    TEMP: childTmp,
    TMPDIR: childTmp,
  });
  try {
    const sharedWorkspace = ensureSharedRetainedWorkspace();
    const requiresIsolatedCheckout = files.some((file) => checkoutMutatingRetainedFiles.has(file));
    const source = requiresIsolatedCheckout ? path.join(root, "source") : sharedWorkspace;
    if (requiresIsolatedCheckout) {
      checkoutAndInstallRetainedSource(source, env);
    }
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
      1_800_000,
    );
    assert.equal(tests.status, 0, tests.stderr + tests.stdout);
    assert.match(tests.stdout, /^ℹ pass [1-9][0-9]*$/mu);
    assert.match(tests.stdout, /^ℹ skipped 0$/mu);
    t.diagnostic(tests.stdout.trim());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
