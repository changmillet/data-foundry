import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { assertCliRuntimeMatches } from "@tiangong-lca/cli/runtime";
import { readFoundryTaskRuntimeAdoptionChain } from "./foundry-task-runtime-adoption.ts";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { currentWorkflowState, workflowObject } from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { readTaskBytes } from "./foundry-task-io.ts";
import { createFileArtifactFact, createFoundryCommandSpec } from "./foundry-command-spec.ts";
import {
  createIdentityPreflightBinding,
  sha256Text,
  sha256Json,
  stableJson,
  validateIdentityPreflightExecution,
  parseFreshIntentBoundAuthReceipt,
  type AuthIdentityReceipt,
} from "./identity-preflight-proof.ts";
import {
  validateIdentityPreflightRecoveryEvidence,
  observeRetainedIdentityExecutable,
  verifyRetainedIdentityCliInventory,
  type RetainedIdentityCliInventory,
  type IdentityPreflightRecoveryProof,
  type IdentityRecoveryFact,
} from "./identity-preflight-recovery-proof.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { assertNoPendingFoundryIdentityStage } from "./foundry-identity-stage-state.ts";

function fail(reason = "evidence"): never {
  throw new FoundryContextError(
    "identity_preflight_recovery_unproven",
    `Retained manual-review evidence cannot be recovered under its original producer binding (${reason}). No new search was dispatched.`,
  );
}

/** A new local interpretation, retaining the original failed attempts and their query/auth facts. */
export async function recoverFoundryWorkflowIdentity(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  currentAuth: AuthIdentityReceipt,
): Promise<Record<string, unknown> | null> {
  assertQualifiedFoundryRuntime(context, qualified);
  assertNoPendingFoundryIdentityStage(context, entries);
  try {
    return await recoverRetainedIdentity(context, qualified, entries, currentAuth);
  } catch (error) {
    if (
      error instanceof FoundryContextError &&
      error.code === "identity_preflight_recovery_unproven"
    )
      throw error;
    return fail("original-evidence-unreadable");
  }
}

async function recoverRetainedIdentity(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  currentAuth: AuthIdentityReceipt,
): Promise<Record<string, unknown> | null> {
  const state = currentWorkflowState(context, entries),
    original = state.identity,
    rows = state.rows,
    assessment = state.retainedAssessment ?? state.assessment;
  if (!original || original.value.status !== "blocked") return null;
  if (original.value.explicit_new_stage === true)
    throw new FoundryContextError(
      "identity_stage_unproven",
      "The explicitly dispatched new read-only stage remains unproven. Inspect its retained claim and outcome evidence; ordinary resume cannot dispatch another query.",
    );
  if (!rows || !assessment || !Array.isArray(original.value.sets) || !original.value.sets.length)
    fail("original-stage-context-missing");
  const originalSets = original.value.sets.map(workflowObject);
  const producerBase = String(original.value.owner_base ?? assessment.value.owner_base);
  const resolve = (file: unknown) => {
    if (typeof file !== "string") fail("locator");
    return resolveFoundryOutput(context, path.resolve(producerBase, file));
  };
  const fact = (file: string, sameProducer = true): IdentityRecoveryFact => {
    const entry = entries.find((item) => resolveFoundryOutput(context, item.path) === file);
    if (!entry || (sameProducer && entry.operation_id !== original.entry.operation_id))
      fail("native-producer");
    const bytes = readFoundryInput(context, file);
    if (bytes.length !== entry.bytes || sha256Text(bytes.toString("utf8")) !== entry.sha256)
      fail("artifact-bytes");
    return { path: file, bytes: entry.bytes, sha256: entry.sha256 };
  };
  const json = (file: string) =>
    workflowObject(JSON.parse(readFoundryInput(context, file).toString("utf8")));
  const runs = originalSets
    .map((set) => ({ set, file: resolve(set.report) }))
    .map(({ set, file }) => ({ set, file, value: json(file) }));
  if (runs.some(({ value }) => !Array.isArray(value.results) || !value.results.length))
    fail("original-attempt-results-missing");
  // Only the previously rejected, known manual-review contract is eligible. Other failures keep their normal retry contract.
  const diagnosticRows = runs.flatMap(({ value }) =>
    Array.isArray(value.results) ? value.results.map(workflowObject) : [],
  );
  if (
    runs.some(
      ({ value }) =>
        !Array.isArray(value.results) ||
        !value.results.length ||
        value.results.some((item) => {
          const row = workflowObject(item);
          return (
            row.report_status !== "needs_review" ||
            row.decision !== "manual_review" ||
            row.failure_code !== "identity_preflight_cli_exit_nonzero" ||
            row.cli_exit_code !== 1
          );
        }),
    )
  ) {
    if (
      diagnosticRows.every(
        (row) => row.status === "failed" && row.report_status === "failed" && !row.decision,
      )
    ) {
      const provenFailedReports = diagnosticRows.every((row) => {
        const file = resolve(row.report_file),
          stdout = resolve(row.stdout_log);
        fact(file);
        fact(stdout);
        const report = json(file);
        return (
          report.status === "failed" &&
          !report.decision &&
          stableJson(report) ===
            stableJson(JSON.parse(readFoundryInput(context, stdout).toString("utf8")))
        );
      });
      if (provenFailedReports) return null;
    }
    fail("mixed-or-unknown-original-attempt");
  }
  const expectedSets = rows.value.sets.filter((set) => ["flow", "process"].includes(set.type));
  if (
    runs.length !== expectedSets.length ||
    new Set(runs.map(({ set }) => set.type)).size !== expectedSets.length
  )
    fail("row-coverage");
  const output = resolveFoundryOutput(context, `outputs/identity-recovery/${randomUUID()}`);
  const receiptPath = resolveFoundryOutput(context, original.entry.receipt.path),
    receiptBytes = readTaskBytes(context, original.entry.receipt.path),
    receipt = workflowObject(JSON.parse(receiptBytes.toString("utf8")));
  if (sha256Text(receiptBytes.toString("utf8")) !== original.entry.receipt.sha256)
    fail("producer-receipt");
  const planPath = resolveFoundryOutput(context, String(workflowObject(receipt.plan).path));
  const planFact = captureFoundryInput(planPath),
    receiptFact = captureFoundryInput(receiptPath),
    jobFact = captureFoundryInput(resolveFoundryOutput(context, "foundry-job.json"));
  const recoveries: Array<{
    type: string;
    rows: string;
    index: string;
    report: string;
    proofs: Array<{ file: string; proof: IdentityPreflightRecoveryProof }>;
    indexRows: Record<string, unknown>[];
    sourceRun: IdentityRecoveryFact;
  }> = [];
  const recoveredAt = new Date().toISOString();
  const interpretationAuth = {
    project_ref: currentAuth.project.project_ref,
    user_id: currentAuth.identity.user_id,
    receipt_scope_sha256: currentAuth.receipt_scope_sha256,
    captured_at_utc: currentAuth.captured_at_utc,
  };
  for (const { set, file: runFile, value: run } of runs) {
    const selected = expectedSets.find((item) => item.type === set.type);
    if (
      !selected ||
      selected.file !== set.rows ||
      run.status !== "failed" ||
      run.command !== "dataset-identity-preflight-run" ||
      run.remote_write_mode !== "read-only"
    )
      fail("row-source");
    const indexFile = resolve(set.index),
      sourceRun = fact(runFile),
      indexFact = fact(indexFile);
    const indexRows = readFoundryInput(context, indexFile)
      .toString("utf8")
      .trim()
      .split(/\r?\n/u)
      .map((line) => workflowObject(JSON.parse(line)));
    const results = (run.results as unknown[]).map(workflowObject),
      options = workflowObject(run.runtime_options),
      cli = workflowObject(options.cli),
      originalAuth = workflowObject(options.auth_receipt);
    const prefix = cli.args_prefix;
    if (
      indexRows.length !== results.length ||
      indexRows.length !== selected.count ||
      options.max_attempts !== 1 ||
      options.retry_failed !== null ||
      !["@tiangong-lca/cli@0.1.22", "@tiangong-lca/cli@0.1.27"].includes(String(cli.package)) ||
      !Array.isArray(prefix) ||
      prefix.length !== 1 ||
      typeof prefix[0] !== "string" ||
      originalAuth.project_ref !== interpretationAuth.project_ref ||
      originalAuth.user_id !== interpretationAuth.user_id ||
      typeof originalAuth.receipt_scope_sha256 !== "string"
    )
      fail("cli-account-runtime");
    const retainedNode = observeRetainedIdentityExecutable(String(cli.executable));
    if (!retainedNode || retainedNode.sha256 !== qualified.cli.expectation.node_sha256)
      fail("retained-original-node-unproven");
    const parent = path.dirname(path.dirname(indexFile)),
      preparedFile = path.join(parent, "dataset-identity-preflight-requests-build-report.json"),
      auditFile = path.join(
        parent,
        "query-audit",
        "dataset-identity-preflight-query-audit-report.json",
      ),
      prepared = json(preparedFile),
      audit = json(auditFile);
    if (
      prepared.status !== "ready" ||
      audit.status !== "passed" ||
      !Array.isArray(audit.blockers) ||
      audit.blockers.length ||
      resolve(run.index_file) !== indexFile
    )
      fail("query-audit");
    // A digest-only producer summary is not the original authenticated receipt.
    // Recovery never substitutes the new interpreter's receipt for that missing preimage.
    if (typeof originalAuth.file !== "string") fail("original-authentication-receipt-missing");
    const authLocator = path.resolve(producerBase, originalAuth.file);
    if (
      !entries.some(
        (entry) =>
          entry.operation_id === original.entry.operation_id &&
          resolveFoundryOutput(context, entry.path) === authLocator,
      )
    )
      fail("original-authentication-receipt-missing");
    const originalAuthFile = resolve(originalAuth.file);
    const originalAuthFact = fact(originalAuthFile);
    let originalReceipt: AuthIdentityReceipt;
    try {
      originalReceipt = parseFreshIntentBoundAuthReceipt(json(originalAuthFile), {
        nowMs: Date.parse(String(prepared.generated_at_utc)),
        // Preserve the original read-only owner's receipt policy; this does not
        // change the current task's independent 60-second permission admission.
        maxAgeMs: 300_000,
        expectedProjectRef: interpretationAuth.project_ref,
        expectedUserId: interpretationAuth.user_id,
      });
    } catch {
      fail("original-authentication-receipt-invalid");
    }
    if (
      originalReceipt.receipt_scope_sha256 !== originalAuth.receipt_scope_sha256 ||
      `${originalReceipt.cli.package_name}@${originalReceipt.cli.package_version}` !== cli.package
    )
      fail("original-authentication-receipt-binding");
    const originalCliIntegrity = `sha256-${sha256Text(readCli(prefix[0]))}`;
    const originalCliVersion = String(cli.package).slice("@tiangong-lca/cli@".length);
    const chain = readFoundryTaskRuntimeAdoptionChain(context);
    const prior = chain?.plans.find((plan) => {
      const entry = workflowObject(workflowObject(plan.selection).original_entry);
      return (
        typeof entry.path === "string" && path.resolve(entry.path, "../../..") === producerBase
      );
    });
    const currentCli = assertCliRuntimeMatches(qualified.cli.expectation);
    const selectedCli = prior
      ? workflowObject(workflowObject(workflowObject(prior.selection).qualification).original_cli)
      : { expectation: qualified.cli.expectation, files: currentCli.files };
    const expectedCli = workflowObject(selectedCli.expectation);
    if (expectedCli.package_version !== originalCliVersion || !Array.isArray(selectedCli.files))
      fail("retained-original-cli-inventory-unqualified");
    const cliInventory: RetainedIdentityCliInventory = {
      role: "current_retained_cli_inventory",
      root: fs.realpathSync(path.dirname(path.dirname(prefix[0]))),
      package_version: originalCliVersion,
      content_sha256: String(expectedCli.content_sha256),
      files: selectedCli.files as RetainedIdentityCliInventory["files"],
    };
    try {
      verifyRetainedIdentityCliInventory(cliInventory, prefix[0]);
    } catch {
      fail("retained-original-cli-inventory-changed");
    }
    const resultsFile = resolve(workflowObject(run.files).results),
      resultsText = readFoundryInput(context, resultsFile).toString("utf8").trim();
    if (
      stableJson(resultsText.split(/\r?\n/u).map((line) => JSON.parse(line))) !==
      stableJson(results)
    )
      fail("original-results");
    const destination = path.join(output, String(set.type));
    const proofs: Array<{ file: string; proof: IdentityPreflightRecoveryProof }> = [],
      recoveredRows: Record<string, unknown>[] = [];
    for (const requestRow of indexRows) {
      const result = results.find(
        (row) =>
          row.dataset_type === requestRow.dataset_type &&
          row.dataset_id === requestRow.dataset_id &&
          row.dataset_version === requestRow.dataset_version,
      );
      if (
        !result ||
        result.status !== "failed" ||
        result.attempt !== 1 ||
        result.attempts !== 1 ||
        (result.signal ?? null) !== null
      )
        fail("attempt");
      const requestFile = resolve(requestRow.request_file),
        reportFile = resolve(requestRow.expected_report_file),
        outputDir = resolve(requestRow.output_dir),
        sourceFile = resolve(requestRow.source_file),
        stdoutFile = resolve(result.stdout_log),
        stderrFile = resolve(result.stderr_log);
      const requestText = readFoundryInput(context, requestFile).toString("utf8"),
        request = workflowObject(JSON.parse(requestText));
      if (
        sourceFile !== selected.file ||
        requestRow.request_bytes_sha256 !== sha256Text(requestText) ||
        requestRow.request_json_sha256 !== sha256Text(JSON.stringify(request)) ||
        requestRow.target_sha256 !== sha256Text(JSON.stringify(request.target))
      )
        fail("request-source-hashes");
      const timeout = String(options.timeout_ms),
        argv = [
          String(set.type),
          "identity-preflight",
          "--input",
          requestFile,
          "--out-dir",
          outputDir,
          "--json",
          "--timeout-ms",
          timeout,
        ];
      if (
        stableJson(result.cli_args) !== stableJson(argv) ||
        result.executable !== cli.executable ||
        result.cli_package !== cli.package ||
        resolve(result.request_file) !== requestFile ||
        resolve(result.report_file) !== reportFile
      )
        fail("argv");
      const spec = createFoundryCommandSpec({
        executable: String(cli.executable),
        argv: [...(prefix as string[]), ...argv],
        binding: {
          artifacts: [
            createFileArtifactFact({
              role: "identity_preflight_request",
              path: String(requestRow.request_file),
              filePath: requestFile,
            }),
          ],
        },
      });
      if (stableJson(result.command_spec) !== stableJson(spec)) fail("command-spec");
      const binding = createIdentityPreflightBinding({
        datasetType: String(set.type),
        datasetId: String(requestRow.dataset_id),
        datasetVersion: String(requestRow.dataset_version),
        targetSha256: String(requestRow.target_sha256),
        requestText,
        semanticArgv: [String(set.type), "identity-preflight", "--json", "--timeout-ms", timeout],
        cli: {
          packageName: "@tiangong-lca/cli",
          packageVersion: originalCliVersion,
          packageIntegrity: originalCliIntegrity,
        },
        authReceipt: originalReceipt,
        relevantInputHashes: {
          ...(workflowObject(requestRow.relevant_input_hashes ?? {}) as Record<string, string>),
          source_file: fact(sourceFile, false).sha256,
        },
      });
      if (binding.binding_sha256 !== result.binding_sha256) fail("binding");
      const reportText = readFoundryInput(context, reportFile).toString("utf8"),
        report = workflowObject(JSON.parse(reportText));
      const checked = validateIdentityPreflightExecution({
        binding,
        exitCode: 1,
        stdoutText: readFoundryInput(context, stdoutFile).toString("utf8"),
        diskReportText: reportText,
        startedAtMs: Date.parse(String(prepared.generated_at_utc)),
        diskReportMtimeMs: fs.statSync(reportFile).mtimeMs,
        completedAtUtc: String(run.generated_at_utc),
        requestFile,
        outputDir,
        reportFile,
        stderrText: readFoundryInput(context, stderrFile).toString("utf8"),
        signal: null,
      });
      if (!checked.ok) fail(String(checked.code));
      const { inputs: _inputs, ...evidence } = binding;
      const scope = {
        schema: "tiangong-foundry.identity-preflight-recovery.v1" as const,
        task_id: context.taskId!,
        actor_id: context.actorId!,
        new_cli_execution: false as const,
        binding: evidence,
        binding_sha256: binding.binding_sha256,
        original: {
          producer_base: producerBase,
          attempt: 1 as const,
          status: "failed" as const,
          failure_code: "identity_preflight_cli_exit_nonzero" as const,
          cli_exit_code: 1 as const,
          producer_auth: {
            project_ref: String(originalAuth.project_ref),
            user_id: String(originalAuth.user_id),
            receipt_scope_sha256: originalAuth.receipt_scope_sha256,
            captured_at_utc: originalReceipt.captured_at_utc,
          },
          batch_prepared_at_utc: String(prepared.generated_at_utc),
          query_generated_at_utc: String(report.generated_at_utc),
          batch_completed_at_utc: String(run.generated_at_utc),
          facts: {
            assessment: fact(assessment.file, false),
            auth_receipt: originalAuthFact,
            source_file: fact(sourceFile, false),
            stage: fact(original.file),
            run: sourceRun,
            results: fact(resultsFile),
            preparation: fact(preparedFile),
            audit: fact(auditFile),
            request: fact(requestFile),
            stdout: fact(stdoutFile),
            stderr: fact(stderrFile),
            report: fact(reportFile),
            producer_receipt: receiptFact,
            producer_plan: planFact,
            job: jobFact,
            index: indexFact,
          },
        },
        current_owner_interpretation_auth: interpretationAuth,
        recovered_at_utc: recoveredAt,
        current_retained_runtime_observation: {
          role: "current_retained_runtime_observation" as const,
          observed_at_utc: recoveredAt,
          original_executable: retainedNode,
          qualified_node_sha256: qualified.cli.expectation.node_sha256,
        },
        current_retained_cli_inventory: cliInventory,
      };
      const proof: IdentityPreflightRecoveryProof = { ...scope, proof_sha256: sha256Json(scope) };
      if (
        !validateIdentityPreflightRecoveryEvidence(proof, {
          requestText,
          reportText,
          datasetType: binding.dataset.type,
          datasetId: binding.dataset.id,
          datasetVersion: binding.dataset.version,
          targetSha256: binding.dataset.target_sha256,
          expectedProjectRef: interpretationAuth.project_ref,
          expectedUserId: interpretationAuth.user_id,
          expectedRetainedCliContentSha256: cliInventory.content_sha256,
        }).ok
      )
        fail("recovery-contract");
      const proofFile = path.join(destination, `${binding.dataset.id}.recovery.json`);
      proofs.push({ file: proofFile, proof });
      recoveredRows.push({
        ...requestRow,
        source_file: sourceFile,
        request_file: requestFile,
        output_dir: outputDir,
        expected_report_file: reportFile,
        expected_candidates_file: resolve(requestRow.expected_candidates_file),
        expected_candidate_sources_file: resolve(requestRow.expected_candidate_sources_file),
        recovery_manifest_file: proofFile,
        recovery_cli_content_sha256: cliInventory.content_sha256,
      });
    }
    recoveries.push({
      type: String(set.type),
      rows: selected.file,
      index: path.join(destination, "identity-preflight-requests.jsonl"),
      report: path.join(destination, "dataset-identity-preflight-recovery-report.json"),
      proofs,
      indexRows: recoveredRows,
      sourceRun,
    });
  }
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-workflow-identity",
      options: { recovery_of: original.entry.sha256, rows_report: rows.file },
      validateCurrent(index) {
        if (
          currentWorkflowState(context, index).identity?.entry.sha256 !== original.entry.sha256 ||
          currentWorkflowState(context, index).rows?.entry.sha256 !== rows.entry.sha256
        )
          fail("current-generation");
      },
    },
    (operation) => {
      for (const recovered of recoveries) {
        for (const item of recovered.proofs) operation.writeJson(item.file, item.proof);
        operation.writeText(
          recovered.index,
          recovered.indexRows.map((item) => JSON.stringify(item)).join("\n") + "\n",
        );
        operation.writeJson(recovered.report, {
          schema: "tiangong-foundry.identity-recovery-stage.v1",
          status: "completed_with_identity_findings",
          new_cli_execution: false,
          original_run: recovered.sourceRun,
          recovered_queries: recovered.proofs.length,
          current_owner_interpretation_auth: interpretationAuth,
          proofs: recovered.proofs.map((item) => ({
            file: item.file,
            sha256: item.proof.proof_sha256,
          })),
        });
      }
      const combined = path.join(output, "identity-preflight-requests.jsonl");
      operation.writeText(
        combined,
        recoveries
          .flatMap((item) => item.indexRows)
          .map((item) => JSON.stringify(item))
          .join("\n") + "\n",
      );
      const result = {
        schema: "tiangong-foundry.identity-stage.v1",
        status: "completed",
        mode: "registered-manual-review-recovery",
        new_cli_execution: false,
        rows_report: rows.file,
        owner_base: context.assetRoot,
        account: {
          project_ref: interpretationAuth.project_ref,
          user_id: interpretationAuth.user_id,
        },
        checked_at_utc: recoveredAt,
        original_identity_report: fact(original.file),
        index: combined,
        sets: recoveries.map(({ type, rows: file, index, report }) => ({
          type,
          rows: file,
          index,
          report,
          status: "completed_with_identity_findings",
        })),
        blockers: [],
      };
      operation.writeJson(path.join(output, "foundry-identity.json"), result);
      return result;
    },
  );
}

function readCli(file: string): string {
  return readIdentityCli(file);
}
function readIdentityCli(file: string): string {
  const canonical = fs.realpathSync(file);
  if (!fs.lstatSync(file).isFile() || !fs.statSync(canonical).isFile()) fail("cli-entry");
  return fs.readFileSync(canonical, "utf8");
}
