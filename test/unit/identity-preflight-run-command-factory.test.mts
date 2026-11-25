import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIdentityPreflightRunCommands } from "../../src/commands/identity-preflight-run.ts";
import {
  createFoundryRuntimeUtils,
  resolveTiangongLcaCliRuntimeCommand,
} from "../../src/lib/foundry-runtime-utils.ts";
import { parseScalar } from "../../src/lib/foundry-args.ts";
import { createTidasRowUtils } from "../../src/lib/tidas-row-utils.ts";
import { bundleRowTypes } from "../../src/lib/bundle-row-types.ts";
import { createBundleSourceContextUtils } from "../../src/lib/bundle-source-context.ts";
import { createDecisionTaskUtils } from "../../src/lib/decision-task-utils.ts";
import { createIdentityPreflightArtifactUtils } from "../../src/lib/identity-preflight-artifacts.ts";
import { datasetIdentity } from "../../src/lib/import-curation/internal/dataset-payload.ts";
import { ensureArray } from "../../src/lib/import-curation/internal/runtime-io.ts";
import { workflowObject } from "../../src/lib/foundry-workflow-state.ts";
import { parseFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "src/commands/identity-preflight-run.ts");
const ownerPath = path.join(repoRoot, "src/lib/decision-owners/identity-preflight.ts");
const legacyPath = path.join(repoRoot, "src/commands/identity-preflight-run.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("identity-preflight command help bytes remain exact for all four exports", () => {
  const expected = [
    {
      command: "dataset-identity-preflight-requests-build",
      bytes: 878,
      sha256: "221d7ec10fcb99de08504ba87c60a3d5e6e46892b142cb149f87b8181d919db8",
    },
    {
      command: "dataset-identity-preflight-query-audit",
      bytes: 453,
      sha256: "85b47a2b712180b038303c84b29441bc025bd995364c95c61b61241ca48c1ae1",
    },
    {
      command: "dataset-identity-preflight-run",
      bytes: 4519,
      sha256: "727705d97af360928127ea9b15b8dfb61e178abf7f113f9cdcbfcc90350a0bdb",
    },
    {
      command: "dataset-identity-preflight-index-merge",
      bytes: 739,
      sha256: "3fc2961480f6d80b026a249265febdb48f2b5a6881a12453b75ae2d07b9aeb6a",
    },
  ];
  for (const contract of expected) {
    const result = spawnSync(
      process.execPath,
      ["test/fixtures/run-internal-stage.ts", contract.command, "--help"],
      {
        cwd: repoRoot,
        encoding: null,
      },
    );
    assert.equal(result.status, 0, contract.command);
    assert.equal(result.stderr.length, 0, contract.command);
    assert.equal(result.stdout.length, contract.bytes, contract.command);
    assert.equal(
      createHash("sha256").update(result.stdout).digest("hex"),
      contract.sha256,
      contract.command,
    );
  }
});

test("identity-preflight runner retains receipt, binding, cache, disk, and fail-closed codes", () => {
  const source = fs.readFileSync(ownerPath, "utf8");
  for (const contract of [
    "parseFreshIntentBoundAuthReceipt",
    "validateBoundExecutionManifest",
    "validateIdentityPreflightExecution",
    "identity_preflight_request_hash_drift",
    "identity_preflight_request_json_hash_drift",
    "identity_preflight_target_hash_drift",
    "identity_preflight_execution_binding_invalid",
    "restored_from_bound_cache",
    "skipped_bound_execution",
    "identity_preflight_timeout",
    "identity_preflight_execution_invalid",
    "stdout/disk mismatch",
    "Missing/malformed or stale reports",
    "Nonzero CLI exits fail except the qualified CLI 0.1.28 complete, bound, error-free needs_review/manual_review exit 1 diagnostic",
    "execution signals/stderr and binding drift remain failures",
    "the pinned manual-review exit 1 contract does not resolve identity or grant a write",
  ]) {
    assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(source, /spawnSync\(cli\.command, receiptArgs/u);
  assert.match(source, /spawnSync\(cli\.command, spawnArgs/u);
  assert.match(source, /stderrText:\s*result\.stderr \|\| ""/u);
  assert.match(source, /signal:\s*result\.signal/u);
  assert.match(
    source,
    /if \(executionValidation\?\.ok\) \{\s*writeJson\(executionManifestFile, executionValidation\.manifest\)/u,
  );
  assert.match(source, /shell:\s*false/u);
  assert.doesNotMatch(source, /execSync|execFileSync|shell:\s*true/u);
});

test("identity-preflight command owner exists only as zero-escape native TypeScript", () => {
  assert.equal(fs.existsSync(typedPath), true);
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(
    fs.readFileSync(typedPath, "utf8").trim(),
    'export { createIdentityPreflightRunCommands } from "../lib/decision-owners/identity-preflight.ts";',
  );
  const source = fs.readFileSync(ownerPath, "utf8");
  assert.doesNotMatch(source, /\bas\s+any\b|:\s*any\b|\bany\s*\[\]|<\s*any\b|,\s*any\s*>/u);
  assert.doesNotMatch(source, /@ts-(?:no)?check|@ts-ignore/u);
  assert.deepEqual(
    [...source.matchAll(/export function\s+([A-Za-z0-9_]+)/gu)].map((match) => match[1]),
    ["createIdentityPreflightRunCommands"],
  );
});

test("identity-preflight consumers and metadata target the typed owner", () => {
  for (const consumer of [
    "src/dev-cli.ts",
    "src/lib/foundry-command-metadata.ts",
    "src/lib/batch-orchestration/bafu-batch-command-runtime.ts",
  ]) {
    const source = readRepoFile(consumer);
    assert.match(source, /(?:commands\/|scripts\/commands\/)identity-preflight-run\.ts/u, consumer);
    assert.doesNotMatch(
      source,
      /(?:commands\/|scripts\/commands\/)identity-preflight-run\.mjs/u,
      consumer,
    );
  }
});

for (const datasetType of ["flow", "process"] as const)
  test(`${datasetType} owner executes and retains the same canonical argv for absolute path aliases`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-owner-path-alias-"));
    const previousExitCode = process.exitCode;
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      process.exitCode = previousExitCode;
      fs.rmSync(root, { recursive: true, force: true });
    });
    const runtime = createFoundryRuntimeUtils({ parseScalar, repoRoot: root });
    const cli = resolveTiangongLcaCliRuntimeCommand({});
    const id = "11111111-1111-4111-8111-111111111111";
    const account = { projectRef: "a".repeat(20), userId: id };
    const sources = createBundleSourceContextUtils({ asText: runtime.asText });
    const decisions = createDecisionTaskUtils({
      ...runtime,
      ensureArray,
      readJson: (file) => workflowObject(runtime.readJson(file)),
      readJsonLines: (file) => runtime.readJsonLines(file).map(workflowObject),
    });
    const dependencies = {
      ...runtime,
      ...createTidasRowUtils({ ...runtime, bundleRowTypes }),
      ...sources,
      repoRoot: root,
      processAuthoringContextFromTrace: (traces: unknown[]) =>
        sources.processAuthoringContextFromTrace(traces.map(workflowObject)),
      processSourceClassificationSummary: (traces: unknown[]) =>
        sources.processSourceClassificationSummary(traces.map(workflowObject)),
      sourceTraceLocationCode: (traces: unknown[]) =>
        sources.sourceTraceLocationCode(traces.map(workflowObject)),
      ensureArray,
      safeFileToken: decisions.safeFileToken,
      datasetIdentity: (row: unknown, type: string) => datasetIdentity(row, 0, type),
      readJson: (file: string) => workflowObject(runtime.readJson(file)),
      readJsonLines: (file: string) => runtime.readJsonLines(file).map(workflowObject),
      readRowsFile: (file: string) => runtime.readRowsFile(file).map(workflowObject),
      repoRelativeMaybe: (value: unknown) =>
        runtime.repoRelativeMaybe(typeof value === "string" ? value : null),
      resolveTiangongLcaCliCommand: () => ({
        ...cli,
        package_version: cli.package_version ?? undefined,
      }),
      resolveTiangongLcaCliCommandPrefix: () => [cli.command, ...cli.args],
      resolveTiangongLcaCliBin: () => cli.display,
    };
    const artifacts = createIdentityPreflightArtifactUtils(dependencies);
    const owner = createIdentityPreflightRunCommands({
      ...dependencies,
      ...artifacts,
      ensureArray: (value: unknown) => ensureArray(value).map(workflowObject),
      identityPreflightSourceIndexPaths: (options) =>
        artifacts.identityPreflightSourceIndexPaths(options).filter((file) => file !== null),
      writeJsonLines: (file: string, values: readonly unknown[]) =>
        dependencies.writeJsonLines(file, [...values]),
      executionEnvironment: {
        FOUNDRY_VERIFIED_PROJECT_REF: account.projectRef,
        FOUNDRY_VERIFIED_USER_ID: account.userId,
      },
      executionCwd: root,
    });
    const requestFile = path.join(root, "requests", "selected.json");
    const outputDir = path.join(root, "search", "selected");
    const reportFile = path.join(outputDir, "outputs", "identity-decision.json");
    const absoluteAlias = (file: string) =>
      `${path.dirname(file).replaceAll("\\", "/")}/../${path.basename(path.dirname(file))}/./${path.basename(file)}`;
    const selectedRequest = absoluteAlias(requestFile);
    const selectedOutput = absoluteAlias(outputDir);
    const selectedReport = absoluteAlias(reportFile);
    assert.equal(path.isAbsolute(selectedRequest), true);
    assert.notEqual(selectedRequest, path.resolve(selectedRequest));
    if (process.platform === "win32") {
      // Exercise actual native drive:/ inputs on Windows, including the C:/ TEMP path used by CI.
      assert.match(selectedRequest, /^[a-z]:\//iu);
      assert.match(selectedOutput, /^[a-z]:\//iu);
      assert.equal(selectedRequest.includes("\\"), false);
    }
    runtime.writeJson(requestFile, { schema_version: 1, target: { id } });
    const indexFile = path.join(root, "index.jsonl");
    dependencies.writeJsonLines(indexFile, [
      {
        dataset_type: datasetType,
        dataset_id: id,
        dataset_version: "00.00.001",
        request_file: selectedRequest,
        output_dir: selectedOutput,
        expected_report_file: selectedReport,
      },
    ]);
    const authFile = path.join(root, "auth.json");
    runtime.writeJson(authFile, testAuthIdentityReceipt(account));
    const actualSpawns: Array<{ executable: string; argv: string[] }> = [];
    t.mock.method(childProcess, "spawnSync", (executable: string, argv: string[]) => {
      actualSpawns.push({ executable, argv: [...argv] });
      assert.ok(argv.includes("identity-preflight"));
      const report = {
        schema_version: 1,
        kind: datasetType,
        status: "passed",
        decision: "create_new",
        ok: true,
        generated_at_utc: new Date().toISOString(),
        input_path: path.resolve(argv[argv.indexOf("--input") + 1]),
        files: { identity_decision: reportFile },
      };
      runtime.writeJson(reportFile, report);
      const reportTime = new Date(Date.now() + 1);
      fs.utimesSync(reportFile, reportTime, reportTime);
      return { status: 0, signal: null, stdout: JSON.stringify(report), stderr: "" };
    });
    syncBuiltinESMExports();
    const result = owner.runDatasetIdentityPreflightRun({
      index: indexFile,
      outDir: path.join(root, "run"),
      authReceipt: authFile,
      expectedProjectRef: account.projectRef,
      expectedUserId: account.userId,
      maxAttempts: 1,
      timeoutMs: 60_000,
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.ok("files" in result && "results" in result, "owner emits retained run evidence");
    const expectedArguments = [
      datasetType,
      "identity-preflight",
      "--input",
      path.resolve(selectedRequest),
      "--out-dir",
      path.resolve(selectedOutput),
      "--json",
      "--timeout-ms",
      "60000",
    ];
    assert.deepEqual(actualSpawns, [
      { executable: cli.command, argv: [...cli.args, ...expectedArguments] },
    ]);
    const retained = workflowObject(
      runtime.readJsonLines(runtime.resolveRepoPath(result.files.results)!)[0],
    );
    assert.deepEqual(retained.cli_args, expectedArguments);
    const command = parseFoundryCommandSpec(retained.command_spec);
    assert.equal(command.executable, actualSpawns[0].executable);
    assert.deepEqual(command.argv, actualSpawns[0].argv);
    assert.equal(runtime.resolveRepoPath(retained.report_file), path.resolve(selectedReport));
    assert.deepEqual(workflowObject(result.results[0]).cli_args, retained.cli_args);
  });
