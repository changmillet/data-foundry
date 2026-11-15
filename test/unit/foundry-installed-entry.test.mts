import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  copyTrustedRuntimeManifestBytes,
  ensureRuntimeComponents,
  inspectRuntimeComponents,
  executeRuntimeLaunch,
  RUNTIME_HOST_CONTEXT_PROTOCOL,
} from "@tiangong-lca/cli/runtime";
import { createManagedComponentFixture } from "../helpers/managed-package-cache.mts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";

const entry = path.resolve(import.meta.dirname, "../../scripts/package-entry.ts");
const variables = [
  "TIANGONG_FOUNDRY_MANIFEST",
  "TIANGONG_FOUNDRY_MANIFEST_SHA256",
  "TIANGONG_FOUNDRY_CACHE_DIR",
  "TIANGONG_FOUNDRY_ENTRY",
];
function environment() {
  const env = { ...process.env };
  for (const key of variables) delete env[key];
  return env;
}
function run(args: string[], env = environment()) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env,
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
  });
  assert.ifError(result.error);
  return result;
}

test("installed help and missing/invalid configuration are offline and actionable", () => {
  const helped = run(["--help"]);
  assert.equal(helped.status, 0, helped.stderr);
  assert.match(helped.stdout, /runtime describe --json/u);
  const missing = run(["runtime", "describe", "--json"]);
  assert.equal(missing.status, 4);
  assert.equal(JSON.parse(missing.stdout).error.code, "runtime_not_configured");
  const invalid = run(["task", "start", "--json"], {
    ...environment(),
    TIANGONG_FOUNDRY_MANIFEST: "relative.json",
  });
  assert.equal(invalid.status, 4);
  assert.equal(JSON.parse(invalid.stdout).error.code, "runtime_configuration_invalid");
  const legacy = run(["task", "status", "--json"]);
  assert.equal(JSON.parse(legacy.stdout).schema, "tiangong-foundry.operation-result.v1");
});

test(
  "environment selection reuses two installed combinations and retains an original launch",
  { timeout: 180_000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-selection-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cacheDir = path.join(root, "cache");
    const cliRuntime = import.meta.resolve("@tiangong-lca/cli/runtime");
    const configurations = [];
    for (const version of ["1.0.0", "1.0.1"]) {
      const source = path.join(root, version);
      fs.mkdirSync(path.join(source, "package-dist", "scripts"), { recursive: true });
      fs.mkdirSync(path.join(source, "package-dist", "assets"));
      const node = process.platform === "win32" ? "node.exe" : "node";
      fs.copyFileSync(process.execPath, path.join(source, node));
      const script = "package-dist/scripts/package-entry.js";
      fs.writeFileSync(
        path.join(source, script),
        `import { receiveRuntimeHostContext } from ${JSON.stringify(cliRuntime)};\nconst context = await receiveRuntimeHostContext();\nprocess.stdout.write(JSON.stringify({version: context.manifest.manifest.product.version, argv: process.argv.slice(2), default_manifest: process.env.TIANGONG_FOUNDRY_MANIFEST ?? null}));\nprocess.stderr.write('native diagnostic\\n');\nprocess.exitCode = 7;\n`,
      );
      fs.writeFileSync(
        path.join(source, "package-dist/assets/foundry-package-descriptor.json"),
        JSON.stringify({
          schema: "tiangong-foundry.package-descriptor.v1",
          package: {
            name: "@tiangong-lca/foundry",
            version,
            cli_dependency: { name: "@tiangong-lca/cli", version: "0.1.28" },
          },
          runtime: { protocol_schemas: ["tiangong-foundry.task-start.v1"] },
        }),
      );
      const fixture = await createManagedComponentFixture(
        root,
        `application-${version}`,
        source,
        workspaceManifestFixture({ version }),
        node,
        {
          argv: [{ component: `application-${version}`, path: script }],
          contextProtocol: RUNTIME_HOST_CONTEXT_PROTOCOL,
        },
      );
      const file = path.join(root, `${version}.json`);
      fs.writeFileSync(file, copyTrustedRuntimeManifestBytes(fixture.manifest));
      const env = {
        ...environment(),
        TIANGONG_FOUNDRY_MANIFEST: file,
        TIANGONG_FOUNDRY_MANIFEST_SHA256: fixture.manifest.sha256,
        TIANGONG_FOUNDRY_CACHE_DIR: cacheDir,
        TIANGONG_FOUNDRY_ENTRY: "tool",
      };
      const described = run(["runtime", "describe", "--json"], env);
      assert.equal(described.status, 4, described.stderr);
      assert.equal(JSON.parse(described.stdout).status, "missing");
      assert.equal(JSON.parse(described.stdout).protocol_assessment, "not_checked");
      const state = inspectRuntimeComponents(fixture.manifest, { cacheDir });
      await ensureRuntimeComponents(fixture.manifest, {
        cacheDir,
        archiveSeeds: { [state.components[0].key]: fixture.archive },
        fetchImpl: async () => {
          throw new Error("Unexpected network access");
        },
      });
      const ready = run(
        ["runtime", "describe", "--json", "--require-protocol", "tiangong-foundry.task-start.v1"],
        env,
      );
      assert.equal(ready.status, 0, ready.stdout + ready.stderr);
      assert.equal(JSON.parse(ready.stdout).product.version, version);
      assert.equal(JSON.parse(ready.stdout).cli_version, "0.1.28");
      const unsupported = run(
        ["runtime", "describe", "--json", "--require-protocol", "future.v9"],
        env,
      );
      assert.equal(unsupported.status, 4);
      assert.deepEqual(JSON.parse(unsupported.stdout).unsupported_protocols, ["future.v9"]);
      const argv = ["task", "resume", "--task", "空格 ; $(touch surprise)", "--json"];
      const invoked = run(argv, env);
      assert.equal(invoked.status, 7, invoked.stderr + invoked.stdout);
      assert.deepEqual(JSON.parse(invoked.stdout), { version, argv, default_manifest: null });
      assert.equal(invoked.stderr, "native diagnostic\n");
      configurations.push({ fixture, env, argv });
    }
    const original = configurations[0];
    const recovered = await executeRuntimeLaunch(original.fixture.manifest, {
      cacheDir,
      entry: "tool",
      cwd: root,
      argv: original.argv,
      env: configurations[1].env,
    });
    assert.equal(recovered.status, 7);
    assert.equal(JSON.parse(recovered.stdout).version, "1.0.0");
    const corrupt = run(["runtime", "describe", "--json"], {
      ...configurations[1].env,
      TIANGONG_FOUNDRY_MANIFEST_SHA256: "f".repeat(64),
    });
    assert.equal(corrupt.status, 4);
    assert.equal(JSON.parse(corrupt.stdout).error.code, "runtime_selection_failed");
  },
);
