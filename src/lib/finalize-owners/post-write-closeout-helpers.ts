import type { FoundryArtifactFact } from "../foundry-command-spec.ts";
import type { TraceQueueCoverageValidator } from "../trace-coverage.ts";
import { validateNativeDraftCloseout } from "./native-draft-closeout.ts";

export type JsonRecord = Record<string, unknown>;

export type CountRecord = Record<string, unknown> & {
  failed?: unknown;
  failure_count?: unknown;
  executed?: unknown;
  success_count?: unknown;
  selected?: unknown;
  total_rows?: unknown;
  blockers?: unknown;
  root_readback_checks?: unknown;
  root_payload_mismatches?: unknown;
  unresolved_trace_entries?: unknown;
  source_exchange_completeness_entries?: unknown;
  source_reference_rewrites?: unknown;
  ai_patch_evidence_entries?: unknown;
  ai_classification_decision_entries?: unknown;
  ai_location_decision_entries?: unknown;
  ai_identity_decision_entries?: unknown;
  source_contact_rewrite_semantic_evidence_entries?: unknown;
  entries_written?: unknown;
};

export type FileRecord = Record<string, unknown> & {
  checks?: unknown;
  final_rows?: unknown;
  rows_file?: unknown;
  unresolved_traces?: unknown;
  source_exchange_completeness_traces?: unknown;
  source_reference_rewrites?: unknown;
  trace_queues?: FileRecord;
};

export type ReportValue = JsonRecord & {
  status?: unknown;
  mode?: unknown;
  commit?: unknown;
  counts?: CountRecord;
  blockers?: unknown;
  files?: FileRecord;
  dataset_type?: unknown;
  final_rows_file?: unknown;
  final_rows_artifact?: unknown;
  finalize_report?: unknown;
  mutation_manifest?: unknown;
  target_user_id?: unknown;
  expected_state_code?: unknown;
  account_mode?: unknown;
  profile?: unknown;
  rows_file?: unknown;
};

export type JsonArtifact = {
  path: string;
  value: ReportValue;
};

export type FullContextResult = {
  required: boolean;
  blockers: JsonRecord[];
};

export type TraceQueueResult = {
  counts: {
    unresolved_trace_entries: number;
    source_exchange_completeness_entries: number;
    source_reference_rewrites: number;
  };
  files: {
    unresolved_traces: unknown;
    source_exchange_completeness_traces: unknown;
    source_reference_rewrites: unknown;
  };
};

export type ImportLedgerResult = {
  status: string;
  files: JsonRecord;
  counts: CountRecord;
};

export type PostWriteCloseoutOptions = Record<string, unknown> & {
  help?: unknown;
  handoffPlan?: unknown;
  plan?: unknown;
  input?: unknown;
  commitReport?: unknown;
  commit?: unknown;
  writeReport?: unknown;
  postWriteVerifyReport?: unknown;
  verifyReport?: unknown;
  remoteVerifyReport?: unknown;
  type?: unknown;
  outDir?: unknown;
  rowsFile?: unknown;
  finalizeReport?: unknown;
  mutationManifest?: unknown;
  targetUserId?: unknown;
  stateCode?: unknown;
  productionCase?: unknown;
  ledgerDir?: unknown;
  importLedgerDir?: unknown;
};

export type PostWriteCloseoutFactoryDependencies = {
  executionEnvironment?: NodeJS.ProcessEnv;
  asText: (value: unknown) => string;
  countJsonLinesFile: (filePath: string) => number;
  countRowsFile: (filePath: string) => number;
  datasetIdentity: (row: JsonRecord, type: string) => { id: string | null; version: string | null };
  ensureArray: <T>(value: T | T[] | null | undefined) => T[];
  fileExists: (filePath: string) => boolean;
  fullContextProofCheck: (input: JsonRecord) => FullContextResult;
  nowIso: () => string;
  readJsonArtifactOption: (value: unknown) => JsonArtifact | null;
  readJsonLines: (filePath: string) => JsonRecord[];
  readRowsFile: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  reportInputPath: (report: ReportValue) => unknown;
  resolveRepoPath: (value: unknown) => string | null;
  sameResolvedPath: (left: string, right: string) => boolean;
  validateTraceQueueCoverageForRows: TraceQueueCoverageValidator;
  writeCloseoutImportLedger?: (input: {
    report: JsonRecord;
    reportPath: string;
    ledgerDir: string | null;
  }) => ImportLedgerResult;
  writeJson: (filePath: string, value: unknown) => unknown;
};

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rootTypeAndTable(
  row: JsonRecord,
  fallbackType: string,
): { type: string; table: string } {
  if (row?.contactDataSet) return { type: "contact", table: "contacts" };
  if (row?.sourceDataSet) return { type: "source", table: "sources" };
  if (row?.flowPropertyDataSet) return { type: "flowproperty", table: "flowproperties" };
  if (row?.unitGroupDataSet) return { type: "unitgroup", table: "unitgroups" };
  if (row?.flowDataSet) return { type: "flow", table: "flows" };
  if (row?.processDataSet) return { type: "process", table: "processes" };
  if (row?.lifeCycleModelDataSet || row?.lifecycleModelDataSet) {
    return { type: "lifecyclemodel", table: "lifecyclemodels" };
  }
  const table =
    fallbackType === "process"
      ? "processes"
      : fallbackType === "flow"
        ? "flows"
        : fallbackType === "contact"
          ? "contacts"
          : fallbackType === "source"
            ? "sources"
            : fallbackType === "lifecyclemodel"
              ? "lifecyclemodels"
              : "";
  return { type: fallbackType, table };
}

export function createPostWriteCloseoutValidators(deps: PostWriteCloseoutFactoryDependencies) {
  const {
    asText,
    countJsonLinesFile,
    fileExists,
    nowIso,
    repoRelativeMaybe,
    repoRelativePath,
    reportInputPath,
    resolveRepoPath,
    sameResolvedPath,
    validateTraceQueueCoverageForRows,
  } = deps;

  function validateCommitReportForCloseout({
    commitReport,
    commitReportPath,
    datasetType,
    finalRowsFile,
    expectedRows,
    blockers,
    handoffPlan,
    targetUserId,
    expectedStateCode,
  }: {
    commitReport: ReportValue;
    commitReportPath: string;
    datasetType: string;
    finalRowsFile: string;
    expectedRows: number;
    blockers: JsonRecord[];
    handoffPlan?: ReportValue;
    targetUserId?: string;
    expectedStateCode?: number | null;
  }): void {
    try {
      if (
        validateNativeDraftCloseout({
          handoff: handoffPlan ?? {},
          report: commitReport,
          rowsFile: finalRowsFile,
          datasetType,
          targetUserId: targetUserId ?? asText(handoffPlan?.target_user_id),
          stateCode: asText(expectedStateCode ?? handoffPlan?.expected_state_code),
          expectedRows,
          resolveFile: resolveRepoPath,
          relativePath: repoRelativePath,
        })
      )
        return;
    } catch {
      blockers.push({
        code: "native_execution_evidence_invalid",
        message:
          "Native contract, bound artifacts, command or exact completion evidence is missing, changed or inconsistent; mutation replay is forbidden.",
      });
      return;
    }
    const inputPath = resolveRepoPath(reportInputPath(commitReport));
    const status = asText(commitReport.status);
    const mode = asText(commitReport.mode);
    const counts = commitReport.counts ?? {};
    const failedCount = Number(counts.failed ?? counts.failure_count ?? 0);
    const executedCount = Number(counts.executed ?? 0);
    const successCount = Number(counts.success_count ?? 0);
    const selectedCount = Number(counts.selected ?? counts.total_rows ?? 0);

    if (!inputPath || !sameResolvedPath(inputPath, finalRowsFile)) {
      blockers.push({
        code: "commit_report_input_mismatch",
        message: "Commit report input must match the handoff final rows file.",
        commit_report: repoRelativePath(commitReportPath),
        expected_input: repoRelativeMaybe(finalRowsFile),
        actual_input: inputPath ? repoRelativeMaybe(inputPath) : null,
      });
    }
    if (mode !== "commit") {
      blockers.push({
        code: "commit_report_not_commit_mode",
        message: `Commit report mode is ${mode || "missing"}; expected commit.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (Object.hasOwn(commitReport, "commit") && commitReport.commit !== true) {
      blockers.push({
        code: "commit_report_commit_flag_false",
        message: "Commit report has commit=false; dry-run reports cannot close an import.",
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (!status || /with_failures|failure|failed|prepared/u.test(status)) {
      blockers.push({
        code: "commit_report_status_not_completed",
        message: `Commit report status is ${status || "missing"}; expected a completed commit without failures.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (!Number.isFinite(failedCount) || failedCount !== 0) {
      blockers.push({
        code: "commit_report_failures_present",
        message: `Commit report contains ${Number.isFinite(failedCount) ? failedCount : "unknown"} failed rows.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }

    const committedRows = datasetType === "flow" ? successCount : executedCount || successCount;
    if (!Number.isFinite(committedRows) || committedRows < expectedRows || expectedRows <= 0) {
      blockers.push({
        code: "commit_report_row_count_incomplete",
        message: `Commit report proves ${Number.isFinite(committedRows) ? committedRows : "unknown"} committed rows; expected ${expectedRows}.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
    if (selectedCount && selectedCount < expectedRows) {
      blockers.push({
        code: "commit_report_selected_count_incomplete",
        message: `Commit report selected ${selectedCount} rows; expected at least ${expectedRows}.`,
        commit_report: repoRelativePath(commitReportPath),
      });
    }
  }

  function validateTraceQueuesForCloseout({
    handoffPlan,
    finalizeReport,
    mutationManifest,
    datasetType,
    finalRowsFile,
    blockers,
  }: {
    handoffPlan: ReportValue;
    finalizeReport: ReportValue | null;
    mutationManifest: ReportValue | null;
    datasetType: string;
    finalRowsFile: string | null;
    blockers: JsonRecord[];
  }): TraceQueueResult {
    const counts = {
      unresolved_trace_entries:
        Number(
          handoffPlan.counts?.unresolved_trace_entries ??
            mutationManifest?.counts?.unresolved_trace_entries ??
            finalizeReport?.counts?.unresolved_trace_entries ??
            0,
        ) || 0,
      source_exchange_completeness_entries:
        Number(
          handoffPlan.counts?.source_exchange_completeness_entries ??
            mutationManifest?.counts?.source_exchange_completeness_entries ??
            finalizeReport?.counts?.source_exchange_completeness_entries ??
            0,
        ) || 0,
      source_reference_rewrites:
        Number(
          handoffPlan.counts?.source_reference_rewrites ??
            mutationManifest?.counts?.source_reference_rewrites ??
            finalizeReport?.counts?.source_reference_rewrites ??
            0,
        ) || 0,
    };
    const traceQueues = {
      unresolved_traces:
        handoffPlan.files?.trace_queues?.unresolved_traces ??
        mutationManifest?.files?.unresolved_traces ??
        finalizeReport?.files?.unresolved_traces ??
        null,
      source_exchange_completeness_traces:
        handoffPlan.files?.trace_queues?.source_exchange_completeness_traces ??
        mutationManifest?.files?.source_exchange_completeness_traces ??
        finalizeReport?.files?.source_exchange_completeness_traces ??
        null,
      source_reference_rewrites:
        handoffPlan.files?.trace_queues?.source_reference_rewrites ??
        mutationManifest?.files?.source_reference_rewrites ??
        finalizeReport?.files?.source_reference_rewrites ??
        null,
    };

    for (const [key, queuePath] of Object.entries(traceQueues)) {
      const expectedCount =
        key === "unresolved_traces"
          ? counts.unresolved_trace_entries
          : key === "source_exchange_completeness_traces"
            ? counts.source_exchange_completeness_entries
            : counts.source_reference_rewrites;
      const resolved = resolveRepoPath(queuePath);
      if (!resolved) {
        if (expectedCount > 0) {
          blockers.push({
            code: "trace_queue_missing",
            message: `${key} has ${expectedCount} entries but no queue file is recorded.`,
            trace_queue: key,
          });
        }
        continue;
      }
      if (!fileExists(resolved)) {
        blockers.push({
          code: "trace_queue_file_missing",
          message: `${key} is recorded but the queue file is not readable.`,
          trace_queue: key,
          file: queuePath,
        });
        continue;
      }
      const actualCount = countJsonLinesFile(resolved);
      if (actualCount < expectedCount) {
        blockers.push({
          code: "trace_queue_count_incomplete",
          message: `${key} has ${actualCount} JSONL rows; expected at least ${expectedCount}.`,
          trace_queue: key,
          file: repoRelativePath(resolved),
        });
      }
    }

    if (finalRowsFile && fileExists(finalRowsFile)) {
      validateTraceQueueCoverageForRows({
        datasetType,
        finalRowsFile,
        traceQueues,
        counts,
        blockers,
      });
    }

    return {
      counts,
      files: {
        unresolved_traces: traceQueues.unresolved_traces,
        source_exchange_completeness_traces: traceQueues.source_exchange_completeness_traces,
        source_reference_rewrites: traceQueues.source_reference_rewrites,
      },
    };
  }

  function buildPostWriteCloseoutReportPayload({
    blockers,
    datasetType,
    handoffArtifact,
    handoffPlan,
    finalizeArtifact,
    finalizeReport,
    mutationArtifact,
    mutationManifest,
    commitArtifact,
    verifyArtifact,
    finalRowsFile,
    finalRowsArtifact,
    targetUserId,
    expectedStateCode,
    productionTestAccount,
    expectedRows,
    uniqueReadbackCount,
    traceQueues,
    postWriteFullContextRequired,
    reportPath,
  }: {
    blockers: JsonRecord[];
    datasetType: string;
    handoffArtifact: JsonArtifact;
    handoffPlan: ReportValue;
    finalizeArtifact: JsonArtifact | null;
    finalizeReport: ReportValue | null;
    mutationArtifact: JsonArtifact | null;
    mutationManifest: ReportValue | null;
    commitArtifact: JsonArtifact;
    verifyArtifact: JsonArtifact;
    finalRowsFile: string | null;
    finalRowsArtifact: FoundryArtifactFact | null;
    targetUserId: string;
    expectedStateCode: number | null;
    productionTestAccount: boolean;
    expectedRows: number;
    uniqueReadbackCount: number;
    traceQueues: TraceQueueResult;
    postWriteFullContextRequired: boolean;
    reportPath: string;
  }) {
    return {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "completed" : "blocked",
      dataset_type: datasetType,
      profile: handoffPlan.profile ?? finalizeReport?.profile ?? mutationManifest?.profile ?? null,
      remote_write_mode: "read-only",
      handoff_plan: repoRelativePath(handoffArtifact.path),
      finalize_report: finalizeArtifact ? repoRelativePath(finalizeArtifact.path) : null,
      mutation_manifest: mutationArtifact ? repoRelativePath(mutationArtifact.path) : null,
      commit_report: repoRelativePath(commitArtifact.path),
      post_write_verify_report: repoRelativePath(verifyArtifact.path),
      final_rows_file: repoRelativeMaybe(finalRowsFile),
      final_rows_artifact: finalRowsArtifact
        ? {
            path: finalRowsArtifact.path,
            bytes: finalRowsArtifact.bytes,
            sha256: finalRowsArtifact.sha256,
          }
        : null,
      target_user_id: targetUserId || null,
      expected_state_code: expectedStateCode,
      policy: {
        ai_full_context_semantic_completion_required_before_entry: true,
        commit_boundary:
          "This closeout is read-only. It accepts only an already executed explicit CLI commit plus post-write root payload readback evidence.",
        compare_root_payload_required: true,
        accepted_trace_hash_only_normalization: !productionTestAccount,
        closeout_completion:
          "completed means Foundry handoff was ready, CLI commit completed without row failures, post-write verify proved owner, state_code, and local/remote payload hash equality for the same final rows, and profile-required full schema/YAML/context AI proof remained attached.",
      },
      counts: {
        blockers: blockers.length,
        final_rows: expectedRows,
        commit_rows:
          Number(
            commitArtifact.value.counts?.executed ??
              commitArtifact.value.counts?.success_count ??
              0,
          ) || 0,
        post_write_verify_blockers:
          Number(
            verifyArtifact.value.counts?.blockers ??
              (Array.isArray(verifyArtifact.value.blockers)
                ? verifyArtifact.value.blockers.length
                : 0),
          ) || 0,
        root_readback_checks: Number(verifyArtifact.value.counts?.root_readback_checks ?? 0) || 0,
        unique_root_readback_checks: uniqueReadbackCount,
        root_payload_mismatches: Number(verifyArtifact.value.counts?.root_payload_mismatches ?? -1),
        unresolved_trace_entries: traceQueues.counts.unresolved_trace_entries,
        source_exchange_completeness_entries:
          traceQueues.counts.source_exchange_completeness_entries,
        source_reference_rewrites: traceQueues.counts.source_reference_rewrites,
        ai_patch_evidence_entries:
          Number(mutationManifest?.counts?.ai_patch_evidence_entries ?? 0) || 0,
        ai_classification_decision_entries:
          Number(mutationManifest?.counts?.ai_classification_decision_entries ?? 0) || 0,
        ai_location_decision_entries:
          Number(mutationManifest?.counts?.ai_location_decision_entries ?? 0) || 0,
        ai_identity_decision_entries:
          Number(mutationManifest?.counts?.ai_identity_decision_entries ?? 0) || 0,
        source_contact_rewrite_semantic_evidence_entries:
          Number(mutationManifest?.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0) ||
          0,
        ai_semantic_evidence_entries:
          (Number(mutationManifest?.counts?.ai_patch_evidence_entries ?? 0) || 0) +
          (Number(mutationManifest?.counts?.ai_classification_decision_entries ?? 0) || 0) +
          (Number(mutationManifest?.counts?.ai_location_decision_entries ?? 0) || 0) +
          (Number(mutationManifest?.counts?.ai_identity_decision_entries ?? 0) || 0) +
          (Number(
            mutationManifest?.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0,
          ) || 0),
        full_context_ai_completion_required: postWriteFullContextRequired,
      },
      blockers,
      files: {
        report: repoRelativePath(reportPath),
        trace_queues: traceQueues.files,
        remote_verification_checks: verifyArtifact.value.files?.checks
          ? repoRelativeMaybe(resolveRepoPath(verifyArtifact.value.files.checks))
          : null,
      },
    };
  }

  return {
    validateCommitReportForCloseout,
    validateTraceQueuesForCloseout,
    buildPostWriteCloseoutReportPayload,
  };
}
