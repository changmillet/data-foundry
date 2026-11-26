import fs from "node:fs";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import type { FoundryAuthentication } from "./foundry-runtime-identity.ts";
import { readRetainedFoundryEdgeIdentity } from "./foundry-edge-identity-preflight.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import type { FoundryIdentityStageTarget } from "./foundry-identity-stage-input.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { createFileArtifactFact, createFoundryCommandSpec } from "./foundry-command-spec.ts";
import {
  createIdentityPreflightBinding,
  parseFreshIntentBoundAuthReceipt,
  sha256Json,
  sha256Text,
  stableJson,
  validateBoundExecutionManifest,
  validateIdentityPreflightExecution,
} from "./identity-preflight-proof.ts";
import type { JsonRecord } from "./foundry-task-types.ts";

export type PreparedIdentityStageTarget = FoundryIdentityStageTarget & {
  readonly source_file: string;
  readonly owner_source_file: string;
  readonly index: string;
  readonly row: JsonRecord;
};

export function rejectIdentityStage(reason: string): never {
  throw new FoundryContextError(
    "identity_stage_input_invalid",
    `Explicit read-only identity stage cannot be admitted (${reason}).`,
  );
}

export function identityStageTargetKey(target: {
  readonly dataset_type?: unknown;
  readonly dataset_id?: unknown;
  readonly dataset_version?: unknown;
}): string {
  return JSON.stringify([target.dataset_type, target.dataset_id, target.dataset_version]);
}

function readJson(file: string): JsonRecord {
  const fact = captureFoundryInput(file);
  return workflowObject(JSON.parse(readSelectedSemanticBytes(fact).toString("utf8")));
}

export function readIdentityStageJsonLines(file: string): JsonRecord[] {
  const text = readSelectedSemanticBytes(captureFoundryInput(file)).toString("utf8");
  if (text && !text.endsWith("\n")) rejectIdentityStage("incomplete-index");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => workflowObject(JSON.parse(line)));
}

export function acceptRetainedIdentityStageTarget(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  target: PreparedIdentityStageTarget,
  claim: JsonRecord,
  authFile: string,
  runDir: string,
  authenticationMode: FoundryAuthentication["mode"],
): { run: JsonRecord; row: JsonRecord } {
  assertQualifiedFoundryRuntime(context, qualified);
  if (claim.admission_status === "ORPHANED_CLAIM_UNPROVEN")
    rejectIdentityStage("orphaned-claim-unproven");
  const originalMode = claim.authentication_mode;
  if (
    (originalMode !== "oauth" && originalMode !== "headless") ||
    originalMode !== authenticationMode
  )
    rejectIdentityStage("retained-authentication-mode-changed");
  if (
    claim.qualification_sha256 !== qualified.qualification_sha256 ||
    stableJson(claim.target) !== stableJson(target) ||
    claim.max_attempts !== 1
  )
    rejectIdentityStage("retained-claim-binding");
  const authFact = captureFoundryInput(authFile);
  if (stableJson(authFact) !== stableJson(claim.auth_receipt))
    rejectIdentityStage("retained-authentication-receipt");
  const receipt = parseFreshIntentBoundAuthReceipt(readJson(authFile), {
    nowMs: Date.parse(String(claim.claimed_at_utc)),
    maxAgeMs: 60_000,
    expectedProjectRef: context.accountIntent!.projectRef,
    expectedUserId: context.accountIntent!.userId,
    sessionMode: originalMode,
  });
  if (qualified.cli.expectation.package_version === "0.4.0") {
    return readRetainedFoundryEdgeIdentity(
      context,
      target.dataset_type,
      target.row,
      runDir,
      originalMode,
      {
        dispatchSha256: sha256Json(claim),
        sourceSha256: captureFoundryInput(target.owner_source_file).sha256,
        claimedAt: String(claim.claimed_at_utc),
        receipt,
      },
    );
  }
  const runFile = path.join(runDir, "dataset-identity-preflight-run-report.json"),
    run = readJson(runFile);
  const resolve = (value: unknown): string => {
    if (typeof value !== "string") rejectIdentityStage("retained-locator");
    return resolveFoundryOutput(context, path.resolve(context.assetRoot, value));
  };
  if (resolve(workflowObject(run.files).report) !== resolve(runFile))
    rejectIdentityStage("retained-run-report-path");
  if (
    !Array.isArray(run.results) ||
    run.results.length !== 1 ||
    !["completed", "completed_with_identity_findings"].includes(String(run.status)) ||
    run.command !== "dataset-identity-preflight-run" ||
    run.remote_write_mode !== "read-only" ||
    resolve(run.index_file) !== target.index
  )
    rejectIdentityStage("retained-owner-result");
  const result = workflowObject(run.results[0]),
    options = workflowObject(run.runtime_options),
    cli = workflowObject(options.cli);
  const auth = workflowObject(options.auth_receipt),
    installed = resolveInstalledTiangongLcaCliPackage();
  if (
    result.status !== "completed" ||
    result.attempt !== 1 ||
    result.attempts !== 1 ||
    result.failure_code !== null ||
    options.max_attempts !== 1 ||
    options.timeout_ms !== 60_000 ||
    options.retry_failed !== null ||
    options.result_cache_dir !== null ||
    cli.executable !== process.execPath ||
    stableJson(cli.args_prefix) !== stableJson([installed.binPath]) ||
    cli.package !== `${installed.packageName}@${installed.packageVersion}` ||
    resolve(auth.file) !== authFile ||
    auth.receipt_scope_sha256 !== receipt.receipt_scope_sha256 ||
    auth.project_ref !== receipt.project.project_ref ||
    auth.user_id !== receipt.identity.user_id
  )
    rejectIdentityStage("retained-owner-runtime-account-attempt");
  if (identityStageTargetKey(result) !== identityStageTargetKey(target))
    rejectIdentityStage("retained-target-identity");
  if (
    stableJson(readIdentityStageJsonLines(resolve(workflowObject(run.files).results))) !==
    stableJson(run.results)
  )
    rejectIdentityStage("retained-results-bytes");
  const requestFile = resolve(target.row.request_file),
    reportFile = resolve(target.row.expected_report_file),
    outputDir = resolve(target.row.output_dir);
  const requestText = fs.readFileSync(requestFile, "utf8"),
    request = readJson(requestFile);
  if (
    target.row.request_bytes_sha256 !== sha256Text(requestText) ||
    target.row.request_json_sha256 !== sha256Text(JSON.stringify(request)) ||
    target.row.target_sha256 !== sha256Text(JSON.stringify(request.target)) ||
    resolve(target.row.source_file) !== target.owner_source_file
  )
    rejectIdentityStage("retained-request-bytes");
  const argv = [
    target.dataset_type,
    "identity-preflight",
    "--input",
    requestFile,
    "--out-dir",
    outputDir,
    "--json",
    "--timeout-ms",
    "60000",
  ];
  const spec = createFoundryCommandSpec({
    executable: process.execPath,
    argv: [installed.binPath, ...argv],
    binding: {
      artifacts: [
        createFileArtifactFact({
          role: "identity_preflight_request",
          path: String(target.row.request_file),
          filePath: requestFile,
        }),
      ],
    },
  });
  if (
    result.executable !== process.execPath ||
    result.cli_package !== cli.package ||
    stableJson(result.cli_args) !== stableJson(argv) ||
    stableJson(result.command_spec) !== stableJson(spec) ||
    resolve(result.request_file) !== requestFile ||
    resolve(result.report_file) !== reportFile
  )
    rejectIdentityStage("retained-command-spec");
  const binding = createIdentityPreflightBinding({
    datasetType: target.dataset_type,
    datasetId: target.dataset_id,
    datasetVersion: target.dataset_version,
    targetSha256: String(target.row.target_sha256),
    requestText,
    semanticArgv: [target.dataset_type, "identity-preflight", "--json", "--timeout-ms", "60000"],
    cli: {
      packageName: installed.packageName,
      packageVersion: installed.packageVersion,
      packageIntegrity: `sha256-${sha256Text(fs.readFileSync(installed.binPath, "utf8"))}`,
    },
    authReceipt: receipt,
    relevantInputHashes: {
      ...(workflowObject(target.row.relevant_input_hashes ?? {}) as Record<string, string>),
      source_file: captureFoundryInput(target.owner_source_file).sha256,
    },
  });
  if (result.binding_sha256 !== binding.binding_sha256)
    rejectIdentityStage("retained-execution-binding");
  const reportText = fs.readFileSync(reportFile, "utf8");
  const report = workflowObject(JSON.parse(reportText));
  if (
    report.schema_version !== 1 ||
    report.kind !== target.dataset_type ||
    workflowObject(report.target).id !== target.dataset_id ||
    workflowObject(report.target).version !== target.dataset_version ||
    report.input_path !== requestFile ||
    report.out_dir !== outputDir ||
    workflowObject(report.files).identity_decision !== reportFile ||
    Object.hasOwn(report, "error") ||
    (Object.hasOwn(report, "errors") && (!Array.isArray(report.errors) || report.errors.length)) ||
    result.report_status !== report.status ||
    result.decision !== (report.decision ?? null) ||
    result.signal != null ||
    fs.readFileSync(resolve(result.stderr_log), "utf8") !== "" ||
    typeof result.cli_exit_code !== "number" ||
    ![0, 1].includes(result.cli_exit_code)
  )
    rejectIdentityStage("retained-report-identity-path-outcome");
  const manifest = readJson(resolve(result.execution_manifest_file));
  const completedAt = Date.parse(String(manifest.completed_at_utc));
  const generatedAt = Date.parse(String(report.generated_at_utc));
  const runCompletedAt = Date.parse(String(run.generated_at_utc));
  if (
    !Number.isFinite(completedAt) ||
    !Number.isFinite(generatedAt) ||
    !Number.isFinite(runCompletedAt) ||
    generatedAt < Date.parse(String(claim.claimed_at_utc)) ||
    generatedAt > completedAt ||
    completedAt < Date.parse(String(claim.claimed_at_utc)) ||
    completedAt > runCompletedAt
  )
    rejectIdentityStage("retained-execution-time");
  const checked = validateIdentityPreflightExecution({
    binding,
    exitCode: Number(result.cli_exit_code),
    stdoutText: fs.readFileSync(resolve(result.stdout_log), "utf8"),
    diskReportText: reportText,
    startedAtMs: Date.parse(String(claim.claimed_at_utc)),
    diskReportMtimeMs: fs.statSync(reportFile).mtimeMs,
    completedAtUtc: String(manifest.completed_at_utc),
    requestFile,
    outputDir,
    reportFile,
    stderrText: fs.readFileSync(resolve(result.stderr_log), "utf8"),
    signal: result.signal == null ? null : String(result.signal),
  });
  if (!checked.ok) rejectIdentityStage(checked.code);
  if (
    !validateBoundExecutionManifest(manifest, binding, reportText).ok ||
    stableJson(manifest) !== stableJson(checked.manifest)
  )
    rejectIdentityStage("retained-execution-manifest");
  return { run, row: target.row };
}
