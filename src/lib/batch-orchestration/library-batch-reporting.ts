import path from "node:path";
import {
  compactBafuFamilySignature,
  type BafuFamilySignatureIndexLike,
  type summarizeBafuFamilyScopes,
} from "../bafu-family-signatures.ts";
import { LIBRARY_BATCH_STAGE_CONTRACT, type JsonRecord } from "./library-batch-profile-strategy.ts";
import type { BatchScopeExecutionPaths as BatchPaths } from "./scope-execution.ts";
import type { buildClassificationDecisionIndex, selectScopesForRun } from "./scope-selection.ts";
import type { createUniverseCoverageService } from "./universe-coverage.ts";

type FamilyScopeSummary = ReturnType<typeof summarizeBafuFamilyScopes>;
type ScopeSelectionResult = ReturnType<typeof selectScopesForRun>;
type ClassificationDecisionIndex = ReturnType<typeof buildClassificationDecisionIndex>;
type LedgerSourceSummary = ReturnType<
  ReturnType<typeof createUniverseCoverageService>["summarizeLedgerSources"]
>;
type SumLedgerSourceRows = ReturnType<typeof createUniverseCoverageService>["sumLedgerSourceRows"];

export function buildUniverseCoverageHelpPayload(coverageCommandName: string): JsonRecord {
  return {
    schema_version: 1,
    status: "help",
    command: coverageCommandName,
    usage: [
      "node src/dev-cli.ts dataset-bafu-universe-coverage-report --run-dir .foundry/workspaces/<bafu-run> --ledger-source-dir <batch/import-ledger> --out-dir <coverage-dir>",
      "node src/dev-cli.ts dataset-bafu-universe-coverage-report --input-dir 'inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09' --scope-file <ready-scopes.jsonl> --ledger-source-dir <batch/import-ledger>",
    ],
    purpose:
      "Build a read-only BAFU full-universe coverage report from process-bundles, ready scopes, flow references, and explicit ledger sources.",
    remote_write_mode: "read-only",
  };
}

export function buildBatchHelpPayload(activeCommandName: string): JsonRecord {
  return {
    schema_version: 1,
    status: "help",
    command: activeCommandName,
    usage: [
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-bundles-dir <.../process-bundles> --run-dir <run-dir> --out-dir <run-dir>/batch-import --parallel 5 --commit",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <existing-batch-dir> --pending-only --selection-order estimated-weight-asc --limit 20 --pause-file <pause.flag> --commit",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --pending-only --selection-order family-master-first --preflight-only",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --pending-only --require-leaf-classification --preflight-only",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <new-batch-dir> --ledger-source-dir <previous-batch-dir> --pending-only --preflight-only",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --out-dir <existing-batch-dir> --pending-only --selection-order estimated-weight-asc --preflight-only",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id <uuid> --commit",
      "node src/dev-cli.ts dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id-file <retry-ids.txt> --commit (one id per line; blank lines and # comments ignored)",
    ],
    purpose:
      "Run BAFU ready process scopes through materialize, semantic decisions, dependency flow commit, support commit, process commit, readback verify, and resumable ledgers.",
    ...LIBRARY_BATCH_STAGE_CONTRACT,
  };
}

export function writeFamilySignaturesReport({
  paths,
  nowIso,
  activeCommandName,
  scopeFile,
  processBundlesDir,
  processFilesDir,
  familySignatureIndex,
  selectedFamilySummary,
  repoRelative,
  writeJson,
}: {
  paths: BatchPaths;
  nowIso: () => string;
  activeCommandName: string;
  scopeFile: string;
  processBundlesDir: string;
  processFilesDir: string | null;
  familySignatureIndex: BafuFamilySignatureIndexLike;
  selectedFamilySummary: FamilyScopeSummary;
  repoRelative: (filePath: string | null | undefined) => string;
  writeJson: (filePath: string, value: unknown) => void;
}): void {
  writeJson(paths.bafuFamilySignatures, {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: "completed",
    command: activeCommandName,
    scope_file: repoRelative(scopeFile),
    process_bundles_dir: repoRelative(processBundlesDir),
    processes_dir: repoRelative(processFilesDir),
    policy: {
      same_amount_vector:
        "Master plus variant generation is allowed only as a BAFU-specific authoring shortcut; each scope still runs schema validation, QA gates, remote write, and readback verification.",
      same_skeleton:
        "Authoring, curation, and identity decisions may be reused as templates only with amount, location, and source-specific text parameterized per scope.",
      standard: "Scopes without matching vectors or skeletons stay on the ordinary import path.",
    },
    counts: {
      all_scopes: familySignatureIndex.summary,
      selected_scopes: selectedFamilySummary,
    },
    entries: familySignatureIndex.entries.map((entry) =>
      compactBafuFamilySignature(entry, repoRelative),
    ),
    missing: familySignatureIndex.missing,
    files: {
      report: repoRelative(paths.bafuFamilySignatures),
    },
  });
}

export function buildBatchRunManifest({
  nowIso,
  activeCommandName,
  preflightOnly,
  targetUserId,
  stateCode,
  commit,
  parallel,
  allScopesCount,
  selectedScopesCount,
  selection,
  resumeInvalidatedCount,
  verifiedScopesCount,
  verifiedFlowsCount,
  blockedScopesCount,
  verifiedSupportIdentitiesCount,
  ledgerSourceDirs,
  ledgerSourceSummary,
  sumLedgerSourceRows,
  classificationDecisionIndex,
  familySignatureIndex,
  selectedFamilySummary,
  paths,
  pendingOnly,
  selectionOrder,
  limit,
  requestedProcessIds,
  requireLeafClassification,
  pauseFile,
  stopAfterBlocked,
  supportIdentityCache,
  repoRelative,
}: {
  nowIso: () => string;
  activeCommandName: string;
  preflightOnly: boolean;
  targetUserId: string;
  stateCode: number;
  commit: boolean;
  parallel: number;
  allScopesCount: number;
  selectedScopesCount: number;
  selection: ScopeSelectionResult;
  resumeInvalidatedCount: number;
  verifiedScopesCount: number;
  verifiedFlowsCount: number;
  blockedScopesCount: number;
  verifiedSupportIdentitiesCount: number;
  ledgerSourceDirs: string[];
  ledgerSourceSummary: LedgerSourceSummary;
  sumLedgerSourceRows: SumLedgerSourceRows;
  classificationDecisionIndex: ClassificationDecisionIndex;
  familySignatureIndex: BafuFamilySignatureIndexLike;
  selectedFamilySummary: FamilyScopeSummary;
  paths: BatchPaths;
  pendingOnly: boolean;
  selectionOrder: string;
  limit: number | null;
  requestedProcessIds: Set<string>;
  requireLeafClassification: boolean;
  pauseFile: string | null;
  stopAfterBlocked: number | null;
  supportIdentityCache: unknown;
  repoRelative: (filePath: string | null | undefined) => string;
}) {
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: activeCommandName,
    status: "running",
    mode: preflightOnly ? "preflight" : "commit",
    target_user_id: targetUserId,
    state_code: stateCode,
    preflight_only: preflightOnly,
    commit,
    parallel,
    counts: {
      input_scopes: allScopesCount,
      matched_scopes: selection.stats.matched_scopes,
      pending_candidate_scopes: selection.stats.candidate_scopes_before_limit,
      selected_scopes: selectedScopesCount,
      filtered_already_verified_scopes: selection.stats.filtered_already_verified,
      invalidated_verified_scopes: resumeInvalidatedCount,
      filtered_already_blocked_scopes: selection.stats.filtered_already_blocked,
      filtered_classification_missing_scopes: selection.stats.filtered_classification_missing,
      filtered_classification_not_leaf_scopes: selection.stats.filtered_classification_not_leaf,
      already_verified_scopes: verifiedScopesCount,
      already_verified_flows: verifiedFlowsCount,
      already_blocked_scopes: blockedScopesCount,
      verified_support_identities: verifiedSupportIdentitiesCount,
      ledger_source_dirs: ledgerSourceSummary.length,
      ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
      ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
      ledger_source_blocked_scope_rows: sumLedgerSourceRows(
        ledgerSourceSummary,
        "blocked_scope_rows",
      ),
      library_classification_decisions: classificationDecisionIndex.row_count,
      indexed_library_classification_decisions: classificationDecisionIndex.indexed_decisions,
    },
    bafu_family_signatures: {
      all_scopes: familySignatureIndex.summary,
      selected_scopes: selectedFamilySummary,
    },
    files: Object.fromEntries(
      Object.entries(paths).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, repoRelative(value)]] : [],
      ),
    ),
    selection: {
      pending_only: pendingOnly,
      selection_order: selectionOrder,
      limit,
      requested_process_ids: [...requestedProcessIds],
      require_leaf_classification: requireLeafClassification,
      ledger_source_dirs: ledgerSourceDirs.map(repoRelative),
      pause_file: repoRelative(pauseFile),
      stop_after_blocked: stopAfterBlocked,
    },
    support_identity_cache: supportIdentityCache,
    ledger_sources: ledgerSourceSummary,
    policy: {
      ready_scopes_only: true,
      blocked_scopes_deferred: true,
      pending_only_filters_before_limit: pendingOnly,
      read_only_preflight_supported: true,
      stop_after_blocked_supported: true,
      process_scope_atomic_commit: true,
      support_and_flows_commit_before_process_commit: true,
      retryable_remote_failures_are_separate_from_human_review: true,
      bafu_family_reuse_is_dataset_specific: true,
      bafu_family_variants_still_require_per_scope_schema_qa_remote_verify: true,
      control_artifacts_are_content_addressed: true,
      verified_scope_receipt_precedes_prune: true,
      failed_or_ambiguous_scope_scratch_is_retained: true,
      pruned_payloads_keep_fact_not_bytes: true,
      ledger_source_dirs_are_read_only_carry_forward_inputs: true,
      require_leaf_classification_filters_only_library_decision_readiness:
        requireLeafClassification,
    },
  };
}

export function writePreflightBatchReport({
  outDir,
  paths,
  manifest,
  nowIso,
  activeCommandName,
  parallel,
  targetUserId,
  supportIdentityCache,
  familySignatureIndex,
  selectedFamilySummary,
  selectedScopesCount,
  selection,
  resumeInvalidatedCount,
  verifiedScopesCount,
  verifiedFlowsCount,
  blockedScopesCount,
  verifiedSupportIdentitiesCount,
  ledgerSourceSummary,
  sumLedgerSourceRows,
  classificationDecisionIndex,
  repoRelative,
  writeJson,
}: {
  outDir: string;
  paths: BatchPaths;
  manifest: ReturnType<typeof buildBatchRunManifest>;
  nowIso: () => string;
  activeCommandName: string;
  parallel: number;
  targetUserId: string;
  supportIdentityCache: unknown;
  familySignatureIndex: BafuFamilySignatureIndexLike;
  selectedFamilySummary: FamilyScopeSummary;
  selectedScopesCount: number;
  selection: ScopeSelectionResult;
  resumeInvalidatedCount: number;
  verifiedScopesCount: number;
  verifiedFlowsCount: number;
  blockedScopesCount: number;
  verifiedSupportIdentitiesCount: number;
  ledgerSourceSummary: LedgerSourceSummary;
  sumLedgerSourceRows: SumLedgerSourceRows;
  classificationDecisionIndex: ClassificationDecisionIndex;
  repoRelative: (filePath: string | null | undefined) => string;
  writeJson: (filePath: string, value: unknown) => void;
}): JsonRecord {
  const report: JsonRecord = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: activeCommandName,
    status: "preflight_completed",
    mode: "preflight",
    parallel,
    target_user_id: targetUserId || null,
    selection: manifest.selection,
    support_identity_cache: supportIdentityCache,
    bafu_family_signatures: {
      all_scopes: familySignatureIndex.summary,
      selected_scopes: selectedFamilySummary,
    },
    counts: {
      selected_scopes: selectedScopesCount,
      processed_scopes: 0,
      pending_candidate_scopes: selection.stats.candidate_scopes_before_limit,
      filtered_already_verified_scopes: selection.stats.filtered_already_verified,
      invalidated_verified_scopes: resumeInvalidatedCount,
      filtered_already_blocked_scopes: selection.stats.filtered_already_blocked,
      filtered_classification_missing_scopes: selection.stats.filtered_classification_missing,
      filtered_classification_not_leaf_scopes: selection.stats.filtered_classification_not_leaf,
      already_verified_scopes: verifiedScopesCount,
      already_verified_flows: verifiedFlowsCount,
      already_blocked_scopes: blockedScopesCount,
      verified_support_identities: verifiedSupportIdentitiesCount,
      ledger_source_dirs: ledgerSourceSummary.length,
      ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
      ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
      ledger_source_blocked_scope_rows: sumLedgerSourceRows(
        ledgerSourceSummary,
        "blocked_scope_rows",
      ),
      library_classification_decisions: classificationDecisionIndex.row_count,
      indexed_library_classification_decisions: classificationDecisionIndex.indexed_decisions,
      selected_same_amount_vector_scopes: selectedFamilySummary.same_amount_vector_scopes,
      selected_same_skeleton_only_scopes: selectedFamilySummary.same_skeleton_only_scopes,
      selected_standard_scopes: selectedFamilySummary.standard_scopes,
    },
    files: {
      report: repoRelative(path.join(outDir, "dataset-bafu-batch-import-run-report.json")),
      run_manifest: repoRelative(path.join(outDir, "import-ledger", "run-manifest.json")),
      preflight_plan: repoRelative(paths.preflightPlan),
      resume_invalidated: repoRelative(paths.resumeInvalidated),
      bafu_family_signatures: repoRelative(paths.bafuFamilySignatures),
      control_artifact_store: repoRelative(paths.controlArtifactStore),
      support_identity_cache: repoRelative(paths.supportIdentityCache),
    },
    ledger_sources: ledgerSourceSummary,
  };
  writeJson(path.join(outDir, "dataset-bafu-batch-import-run-report.json"), report);
  writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), {
    ...manifest,
    status: report.status,
    finished_at_utc: report.generated_at_utc,
    final_counts: report.counts,
  });
  return report;
}

export function writeCommitBatchReport({
  outDir,
  paths,
  manifest,
  nowIso,
  activeCommandName,
  status,
  parallel,
  targetUserId,
  supportIdentityCache,
  familySignatureIndex,
  selectedFamilySummary,
  selectedScopesCount,
  selection,
  resumeInvalidatedCount,
  results,
  pausedNotStarted,
  pauseObserved,
  stoppedAfterBlocked,
  blockedScopeViews,
  verifiedScopesCount,
  verifiedFlowsCount,
  blockedScopesCount,
  verifiedSupportIdentitiesCount,
  ledgerSourceSummary,
  sumLedgerSourceRows,
  classificationDecisionIndex,
  readJsonLines,
  repoRelative,
  writeJson,
}: {
  outDir: string;
  paths: BatchPaths;
  manifest: ReturnType<typeof buildBatchRunManifest>;
  nowIso: () => string;
  activeCommandName: string;
  status: string;
  parallel: number;
  targetUserId: string;
  supportIdentityCache: unknown;
  familySignatureIndex: BafuFamilySignatureIndexLike;
  selectedFamilySummary: FamilyScopeSummary;
  selectedScopesCount: number;
  selection: ScopeSelectionResult;
  resumeInvalidatedCount: number;
  results: JsonRecord[];
  pausedNotStarted: number;
  pauseObserved: boolean;
  stoppedAfterBlocked: boolean;
  blockedScopeViews: JsonRecord;
  verifiedScopesCount: number;
  verifiedFlowsCount: number;
  blockedScopesCount: number;
  verifiedSupportIdentitiesCount: number;
  ledgerSourceSummary: LedgerSourceSummary;
  sumLedgerSourceRows: SumLedgerSourceRows;
  classificationDecisionIndex: ClassificationDecisionIndex;
  readJsonLines: (filePath: string | null | undefined) => JsonRecord[];
  repoRelative: (filePath: string | null | undefined) => string;
  writeJson: (filePath: string, value: unknown) => void;
}): JsonRecord {
  const report: JsonRecord = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    command: activeCommandName,
    status,
    mode: "commit",
    parallel,
    target_user_id: targetUserId,
    selection: manifest.selection,
    support_identity_cache: supportIdentityCache,
    bafu_family_signatures: {
      all_scopes: familySignatureIndex.summary,
      selected_scopes: selectedFamilySummary,
    },
    counts: {
      selected_scopes: selectedScopesCount,
      pending_candidate_scopes: selection.stats.candidate_scopes_before_limit,
      filtered_already_verified_scopes: selection.stats.filtered_already_verified,
      invalidated_verified_scopes: resumeInvalidatedCount,
      filtered_already_blocked_scopes: selection.stats.filtered_already_blocked,
      filtered_classification_missing_scopes: selection.stats.filtered_classification_missing,
      filtered_classification_not_leaf_scopes: selection.stats.filtered_classification_not_leaf,
      processed_scopes: results.length,
      paused_not_started: pausedNotStarted,
      stopped_after_blocked: stoppedAfterBlocked,
      verified: results.filter((row) => row.status === "verified").length,
      skipped: results.filter((row) => row.status === "skipped").length,
      skipped_blocked: results.filter((row) => row.status === "skipped_blocked").length,
      blocked: results.filter((row) => row.status === "blocked").length,
      ambiguous: results.filter((row) => row.status === "ambiguous").length,
      failed_retryable: results.filter((row) => row.status === "failed").length,
      ok_scope_ledger_rows: readJsonLines(paths.okScopes).length,
      ok_flow_ledger_rows: readJsonLines(paths.okFlows).length,
      human_review_rows: blockedScopeViews.active,
      historical_human_review_rows: blockedScopeViews.historical,
      resolved_human_review_rows: blockedScopeViews.resolved,
      retry_rows: readJsonLines(paths.failedRetry).length,
      ambiguous_no_replay: readJsonLines(paths.ambiguousNoReplay).length,
      already_verified_scopes: verifiedScopesCount,
      already_verified_flows: verifiedFlowsCount,
      already_blocked_scopes: blockedScopesCount,
      verified_support_identities: verifiedSupportIdentitiesCount,
      ledger_source_dirs: ledgerSourceSummary.length,
      ledger_source_ok_scope_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_scope_rows"),
      ledger_source_ok_flow_rows: sumLedgerSourceRows(ledgerSourceSummary, "ok_flow_rows"),
      ledger_source_blocked_scope_rows: sumLedgerSourceRows(
        ledgerSourceSummary,
        "blocked_scope_rows",
      ),
      library_classification_decisions: classificationDecisionIndex.row_count,
      indexed_library_classification_decisions: classificationDecisionIndex.indexed_decisions,
      selected_same_amount_vector_scopes: selectedFamilySummary.same_amount_vector_scopes,
      selected_same_skeleton_only_scopes: selectedFamilySummary.same_skeleton_only_scopes,
      selected_standard_scopes: selectedFamilySummary.standard_scopes,
    },
    files: {
      report: repoRelative(path.join(outDir, "dataset-bafu-batch-import-run-report.json")),
      run_manifest: repoRelative(path.join(outDir, "import-ledger", "run-manifest.json")),
      scope_checkpoints: repoRelative(paths.scopeCheckpoints),
      ok_scopes: repoRelative(paths.okScopes),
      resume_invalidated: repoRelative(paths.resumeInvalidated),
      ok_flows: repoRelative(paths.okFlows),
      ok_processes: repoRelative(paths.okProcesses),
      blocked_human_review: repoRelative(paths.blockedHumanReview),
      blocked_human_review_active: repoRelative(paths.blockedHumanReviewActive),
      blocked_human_review_resolved: repoRelative(paths.blockedHumanReviewResolved),
      failed_retry: repoRelative(paths.failedRetry),
      ambiguous_no_replay: repoRelative(paths.ambiguousNoReplay),
      attempt_state: repoRelative(paths.attemptState),
      attempt_events: repoRelative(paths.attemptEvents),
      bafu_family_signatures: repoRelative(paths.bafuFamilySignatures),
      control_artifact_store: repoRelative(paths.controlArtifactStore),
      support_identity_cache: repoRelative(paths.supportIdentityCache),
    },
    results,
    ledger_sources: ledgerSourceSummary,
  };
  writeJson(path.join(outDir, "dataset-bafu-batch-import-run-report.json"), report);
  writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), {
    ...manifest,
    status: report.status,
    finished_at_utc: report.generated_at_utc,
    final_counts: report.counts,
    pause_observed: pauseObserved,
    stopped_after_blocked: stoppedAfterBlocked,
  });
  return report;
}
