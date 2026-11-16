import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLI_RUNTIME_EXPECTATION_SCHEMA,
  RUNTIME_PLATFORMS,
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  receiveRuntimeHostContext,
  copyTrustedRuntimeManifestBytes,
  assertCliRuntimeMatches,
  describeCliRuntime,
  ensureRuntimeComponents,
  executeRuntimeLaunch,
  inspectRuntimeComponents,
  loadTrustedRuntimeManifest,
  parseRuntimeManifest,
  pruneRuntimeComponents,
} from "@tiangong-lca/cli/runtime";
import { createFoundryIsolatedChildEnvironment } from "../../scripts/lib/foundry-runtime-environment.ts";

test("Foundry consumes the exact published CLI C1 runtime boundary", async () => {
  const descriptor = describeCliRuntime();
  assert.equal(descriptor.package.name, "@tiangong-lca/cli");
  assert.equal(descriptor.package.version, "0.1.28");
  assert.equal(RUNTIME_HOST_CONTEXT_PROTOCOL, "tiangong-lca.runtime-host.v1");
  await assert.rejects(receiveRuntimeHostContext(), /inherited manager IPC channel/u);
  assert.deepEqual(
    [...RUNTIME_PLATFORMS],
    ["darwin-arm64", "linux-x64", "linux-arm64", "win32-x64"],
  );
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.files), true);
  const expectation = {
    schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
    package_version: descriptor.package.version,
    platform: descriptor.platform,
    content_sha256: descriptor.content_sha256,
    node_version: descriptor.node.version,
    node_sha256: descriptor.node.sha256,
  };
  assert.equal(assertCliRuntimeMatches(expectation).content_sha256, descriptor.content_sha256);
  assert.throws(
    () => assertCliRuntimeMatches({ ...expectation, content_sha256: "0".repeat(64) }),
    /does not match/u,
  );
  assert.throws(() => parseRuntimeManifest({}), /Runtime manifest/u);
  for (const value of [
    loadTrustedRuntimeManifest,
    ensureRuntimeComponents,
    inspectRuntimeComponents,
    pruneRuntimeComponents,
    executeRuntimeLaunch,
    copyTrustedRuntimeManifestBytes,
  ]) {
    assert.equal(typeof value, "function");
  }
});

test("the installed CLI advertises the dataset contracts used by managed Foundry workflows", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-command-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = createFoundryIsolatedChildEnvironment({ tempRoot: root });
  const bin = fileURLToPath(import.meta.resolve("@tiangong-lca/cli/bin/tiangong-lca.js"));
  const calls = [
    { route: ["dataset", "context-pack"], options: ["--profile", "--out-dir"] },
    { route: ["flow", "identity-preflight"], options: ["--input", "--out-dir"] },
    { route: ["process", "identity-preflight"], options: ["--input", "--out-dir"] },
    {
      route: ["dataset", "save-draft"],
      options: ["--execution-contract", "--allow-account-local-support"],
    },
    { route: ["dataset", "verify-remote"], options: ["--root-policy", "--out-dir"] },
  ];
  const incompatible: string[] = [];
  for (const { route, options } of calls) {
    const result = spawnSync(process.execPath, [bin, ...route, "--help"], {
      cwd: root,
      env,
      encoding: "utf8",
      shell: false,
      timeout: 15_000,
    });
    assert.ifError(result.error);
    const name = route.join(" ");
    if (result.status !== 0 || !result.stdout.includes(`tiangong-lca ${name} `)) {
      incompatible.push(name);
    } else {
      for (const option of options) {
        if (!result.stdout.includes(option)) incompatible.push(`${name} ${option}`);
      }
    }
  }
  assert.deepEqual(incompatible, [], "Update the Foundry caller contracts when adopting a CLI");
});
