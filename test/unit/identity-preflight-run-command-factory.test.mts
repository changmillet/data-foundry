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
import { createIdentityPreflightRunCommands } from "../../scripts/commands/identity-preflight-run.ts";
import {
  createFoundryRuntimeUtils,
  resolveTiangongLcaCliRuntimeCommand,
} from "../../scripts/lib/foundry-runtime-utils.ts";
import { parseScalar } from "../../scripts/lib/foundry-args.ts";
import { createTidasRowUtils } from "../../scripts/lib/tidas-row-utils.ts";
import { bundleRowTypes } from "../../scripts/lib/bundle-row-types.ts";
import { createBundleSourceContextUtils } from "../../scripts/lib/bundle-source-context.ts";
import { createDecisionTaskUtils } from "../../scripts/lib/decision-task-utils.ts";
import { createIdentityPreflightArtifactUtils } from "../../scripts/lib/identity-preflight-artifacts.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { ensureArray } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { workflowObject } from "../../scripts/lib/foundry-workflow-state.ts";
import { parseFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const typedPath = path.join(repoRoot, "scripts/commands/identity-preflight-run.ts");
const ownerPath = path.join(repoRoot, "scripts/lib/decision-owners/identity-preflight.ts");
const legacyPath = path.join(repoRoot, "scripts/commands/identity-preflight-run.mjs");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("identity-preflight command help bytes remain exact for all four exports", () => {
  const expected = [
    {
      command: "dataset-identity-preflight-requests-build",
      bytes: 890,
      sha256: "918dcb2f34a0a54fab5684fa722348c1291b93f8d86c882c4c79e146e8875012",
    },
    {
      command: "dataset-identity-preflight-query-audit",
      bytes: 457,
      sha256: "0a22ecb83e482ceac6fc84b17f4ffa4b6ef56d323cfb865bb0faf9f8d9b15b27",
    },
    {
      command: "dataset-identity-preflight-run",
      bytes: 4531,
      sha256: "918bd3aff37a471a01ce9ec9715ef93fc5f6de05b3643d139b8ce1f23542a685",
    },
    {
      command: "dataset-identity-preflight-index-merge",
      bytes: 747,
      sha256: "8b60ceb7d6a69f5cc87a4da5ecf0b52afadc8bade3c74c4174926b474ea294e7",
    },
  ];
  for (const contract of expected) {
    const result = spawnSync(process.execPath, ["scripts/foundry.ts", contract.command, "--help"], {
      cwd: repoRoot,
      encoding: null,
    });
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
    "scripts/foundry.ts",
    "scripts/lib/foundry-command-metadata.ts",
    "scripts/lib/batch-orchestration/bafu-batch-command-runtime.ts",
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
