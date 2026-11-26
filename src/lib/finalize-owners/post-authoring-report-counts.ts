import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readRows } from "../import-curation/internal/runtime-io.ts";
import type {
  FinalizeDependencies,
  FinalizeOptions,
  FinalizeStage,
} from "./post-authoring-types.ts";

/** Builds the aggregated counts and files sections for the finalized post-authoring report. */
export function buildFinalizeReportCountsAndFiles({
  deps,
  options,
  finalizeStartedAtMs,
  finalizeTimings,
  fullContextRequirement,
  identityPreflightRequired,
  preCleanupRowsFile,
  sourceContactRowsFile,
  canonicalSupportRowsFile,
  canonicalSupportReportFile,
  cleanupReportFile,
  cleanedRowsFile,
  curationQueueDir,
  curationQueueStage,
  schemaStage,
  qaStage,
  locationAuditStage,
  locationAuditBlockers,
  curationGateReportFile,
  patchCollectReportFile,
  patchApplyReportFile,
  classificationDecisionApplyReportFile,
  locationDecisionApplyReportFile,
  identityDecisionApplyReportFiles,
  dryRunStage,
  remoteVerifyReportFile,
  identityPreflightRunStage,
  identityReferenceRewriteStage,
  unresolvedExchangeExternalizeStage,
  sourceContactRewriteStage,
  sourceContactSupportFinalize,
  sourceContactSupportFinalizeStatus,
  sourceContactSupportFinalizeAdvisory,
  sourceContactSupportFinalizeBlockers,
  sourceContactSupportFinalizeRawBlockers,
  sourceContactSupportCommitHandoffBlockers,
  sourceContactSupportCommitHandoffRawBlockers,
  canonicalSupportRewriteStage,
  mutationManifest,
  blockerCount,
  mutationBlockerCount,
  prewriteGateBlockers,
}: {
  deps: Pick<FinalizeDependencies, "repoRelativeMaybe" | "repoRelativePath">;
  options: FinalizeOptions;
  finalizeStartedAtMs: number;
  finalizeTimings: Array<Record<string, unknown>>;
  fullContextRequirement: unknown;
  identityPreflightRequired: boolean;
  preCleanupRowsFile: string;
  sourceContactRowsFile: string;
  canonicalSupportRowsFile: string;
  canonicalSupportReportFile: string | null;
  cleanupReportFile: string | null;
  cleanedRowsFile: string;
  curationQueueDir: string | null;
  curationQueueStage: FinalizeStage;
  schemaStage: FinalizeStage;
  qaStage: FinalizeStage;
  locationAuditStage: FinalizeStage;
  locationAuditBlockers: Array<Record<string, unknown>>;
  curationGateReportFile: string | null;
  patchCollectReportFile: string | null;
  patchApplyReportFile: string | null;
  classificationDecisionApplyReportFile: string | null;
  locationDecisionApplyReportFile: string | null;
  identityDecisionApplyReportFiles: string[];
  dryRunStage: FinalizeStage;
  remoteVerifyReportFile: string | null;
  identityPreflightRunStage: FinalizeStage;
  identityReferenceRewriteStage: FinalizeStage;
  unresolvedExchangeExternalizeStage: FinalizeStage;
  sourceContactRewriteStage: FinalizeStage;
  sourceContactSupportFinalize: FinalizeStage;
  sourceContactSupportFinalizeStatus: string | null | undefined;
  sourceContactSupportFinalizeAdvisory: boolean;
  sourceContactSupportFinalizeBlockers: number;
  sourceContactSupportFinalizeRawBlockers: number;
  sourceContactSupportCommitHandoffBlockers: number;
  sourceContactSupportCommitHandoffRawBlockers: number;
  canonicalSupportRewriteStage: FinalizeStage;
  mutationManifest: FinalizeStage;
  blockerCount: number;
  mutationBlockerCount: number;
  prewriteGateBlockers: Array<Record<string, unknown>>;
}) {
  const { repoRelativeMaybe, repoRelativePath } = deps;
  const canonicalSupportBlockers = canonicalSupportRewriteStage.counts?.blockers ?? 0;
  const fullContextScopeBlockers =
    mutationManifest.evidence?.scope_blockers?.filter((blocker) =>
      String(blocker?.stage ?? "").includes("full_context_ai_completion"),
    ).length ?? 0;
  const counts = {
    finalize_duration_ms: Date.now() - finalizeStartedAtMs,
    finalize_substage_count: finalizeTimings.length,
    blockers: blockerCount,
    mutation_manifest_blockers: mutationBlockerCount,
    prewrite_gate_blockers: prewriteGateBlockers.length,
    canonical_support_blockers: canonicalSupportBlockers,
    source_contact_rewrite_input_rows: sourceContactRewriteStage.counts?.input_rows ?? null,
    source_contact_rewrite_output_rows: sourceContactRewriteStage.counts?.output_rows ?? null,
    source_contact_reference_rewrites:
      sourceContactRewriteStage.counts?.contact_reference_rewrites ?? 0,
    source_contact_source_reference_rewrites:
      sourceContactRewriteStage.counts?.source_reference_rewrites ?? 0,
    source_contact_support_rows: sourceContactRewriteStage.counts?.support_rows ?? 0,
    source_contact_support_finalize_status: sourceContactSupportFinalizeStatus,
    source_contact_support_finalize_raw_status: sourceContactSupportFinalize.status,
    source_contact_support_finalize_advisory: sourceContactSupportFinalizeAdvisory,
    source_contact_support_finalize_write_candidates:
      sourceContactSupportFinalize.counts?.write_candidates ?? 0,
    source_contact_support_finalize_blockers: sourceContactSupportFinalizeBlockers,
    source_contact_support_finalize_raw_blockers: sourceContactSupportFinalizeRawBlockers,
    source_contact_support_commit_handoff_blockers: sourceContactSupportCommitHandoffBlockers,
    source_contact_support_commit_handoff_raw_blockers:
      sourceContactSupportCommitHandoffRawBlockers,
    canonical_support_input_rows: canonicalSupportRewriteStage.counts?.input_rows ?? null,
    canonical_support_output_rows: canonicalSupportRewriteStage.counts?.output_rows ?? null,
    canonical_support_deferred_rows: canonicalSupportRewriteStage.counts?.deferred_rows ?? 0,
    canonical_support_deferred_blockers:
      canonicalSupportRewriteStage.counts?.deferred_blockers ?? 0,
    canonical_flow_property_reference_rewrites:
      canonicalSupportRewriteStage.counts?.canonical_flow_property_reference_rewrites ?? 0,
    canonical_unit_group_reference_proofs:
      canonicalSupportRewriteStage.counts?.canonical_unit_group_reference_proofs ?? 0,
    full_context_ai_completion_required: Boolean(fullContextRequirement),
    identity_preflight_required: identityPreflightRequired,
    identity_preflight_run_selected: identityPreflightRunStage.report?.counts?.selected_rows ?? 0,
    identity_preflight_run_completed: identityPreflightRunStage.report?.counts?.completed ?? 0,
    identity_preflight_run_skipped_existing:
      identityPreflightRunStage.report?.counts?.skipped_existing_report ?? 0,
    identity_preflight_run_failed: identityPreflightRunStage.report?.counts?.failed ?? 0,
    identity_preflight_refresh_required: Boolean(identityPreflightRunStage.refresh_required),
    identity_preflight_refresh_forced: Boolean(identityPreflightRunStage.refresh_forced),
    identity_preflight_refresh_reason: identityPreflightRunStage.refresh_plan?.reason ?? null,
    identity_preflight_refresh_force_skipped_exact: Boolean(
      identityPreflightRunStage.refresh_force_skipped_exact,
    ),
    identity_preflight_refreshed_current_rows:
      identityPreflightRunStage.refresh_report?.counts?.request_rows ?? 0,
    identity_preflight_merge_replaced_rows:
      identityPreflightRunStage.merge_report?.counts?.replaced_rows ?? 0,
    location_audit_blockers: locationAuditBlockers.length,
    location_code_targets: locationAuditStage.report?.counts?.location_targets ?? 0,
    location_code_invalid: locationAuditStage.report?.counts?.invalid ?? 0,
    write_candidates: mutationManifest.counts?.write_candidates ?? 0,
    ai_patch_evidence_entries: mutationManifest.counts?.ai_patch_evidence_entries ?? 0,
    ai_classification_decision_entries:
      mutationManifest.counts?.ai_classification_decision_entries ?? 0,
    ai_location_decision_entries: mutationManifest.counts?.ai_location_decision_entries ?? 0,
    ai_identity_decision_entries: mutationManifest.counts?.ai_identity_decision_entries ?? 0,
    source_contact_rewrite_semantic_evidence_entries:
      mutationManifest.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0,
    ai_semantic_evidence_entries:
      (Number(mutationManifest.counts?.ai_patch_evidence_entries ?? 0) || 0) +
      (Number(mutationManifest.counts?.ai_classification_decision_entries ?? 0) || 0) +
      (Number(mutationManifest.counts?.ai_location_decision_entries ?? 0) || 0) +
      (Number(mutationManifest.counts?.ai_identity_decision_entries ?? 0) || 0) +
      (Number(mutationManifest.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0),
    unresolved_trace_entries: mutationManifest.counts?.unresolved_trace_entries ?? 0,
    unresolved_exchange_externalized:
      unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
    blocked_flow_dependency_externalized:
      unresolvedExchangeExternalizeStage.counts?.blocked_flow_dependency_externalized ?? 0,
    source_exchange_completeness_entries:
      mutationManifest.counts?.source_exchange_completeness_entries ?? 0,
    source_reference_rewrites: mutationManifest.counts?.source_reference_rewrites ?? 0,
    identity_reference_rewrites: mutationManifest.counts?.identity_reference_rewrites ?? 0,
    identity_flow_reference_rewrites:
      identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0,
    identity_reference_reuse_rows: identityReferenceRewriteStage.counts?.reference_rows ?? 0,
    curation_queue_status:
      curationQueueStage.status === "not_required" ? "not_required" : curationQueueStage.status,
    curation_queue_blockers: curationQueueStage.report?.counts?.blockers ?? 0,
    curation_queue_tasks: curationQueueStage.report?.counts?.tasks ?? 0,
    curation_queue_process_rows: curationQueueStage.report?.counts?.process_rows ?? 0,
    curation_queue_flow_rows: curationQueueStage.report?.counts?.flow_rows ?? 0,
    curation_queue_external_flow_refs: curationQueueStage.report?.counts?.external_flow_refs ?? 0,
    full_context_scope_blockers: fullContextScopeBlockers,
  };
  const files = {
    source_contact_rewrite_report: sourceContactRewriteStage.files?.report ?? null,
    source_contact_rewritten_rows: sourceContactRewriteStage.files?.output_rows ?? null,
    source_contact_support_rows: sourceContactRewriteStage.files?.support_rows ?? null,
    source_contact_support_finalize_report: sourceContactSupportFinalize.files?.report ?? null,
    source_contact_support_finalize_rows: sourceContactSupportFinalize.files?.final_rows ?? null,
    source_contact_support_commit_handoff_plan:
      sourceContactSupportFinalize.files?.commit_handoff_plan ?? null,
    source_contact_source_reference_rewrites:
      sourceContactRewriteStage.files?.source_reference_rewrites ?? null,
    cleanup_report: repoRelativeMaybe(cleanupReportFile),
    canonical_support_rewrite_report: repoRelativeMaybe(canonicalSupportReportFile),
    canonical_support_rewritten_rows: repoRelativeMaybe(canonicalSupportRowsFile),
    canonical_support_deferred_rows: canonicalSupportRewriteStage.files?.deferred_rows ?? null,
    canonical_support_rewrites:
      canonicalSupportRewriteStage.files?.canonical_support_rewrites ?? null,
    canonical_support_blockers:
      canonicalSupportRewriteStage.files?.canonical_support_blockers ?? null,
    identity_reference_rewrites: identityReferenceRewriteStage.rewrite_file ?? null,
    identity_preflight_run_report: repoRelativeMaybe(identityPreflightRunStage.report_file),
    identity_preflight_index: identityPreflightRunStage.index_file ?? null,
    identity_preflight_base_index: identityPreflightRunStage.base_index_file ?? null,
    identity_preflight_refresh_report: identityPreflightRunStage.refresh_report_file ?? null,
    identity_preflight_merge_report: identityPreflightRunStage.merge_report_file ?? null,
    identity_rewritten_rows:
      Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
        ? identityReferenceRewriteStage.output_rows_file
        : null,
    unresolved_exchange_externalization_report:
      unresolvedExchangeExternalizeStage.files?.report ?? null,
    unresolved_exchange_externalized_rows:
      Number(unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0) > 0
        ? unresolvedExchangeExternalizeStage.files?.output_rows
        : null,
    unresolved_exchange_traces: unresolvedExchangeExternalizeStage.files?.traces ?? null,
    identity_reference_reuse_rows: identityReferenceRewriteStage.reference_rows_file ?? null,
    curation_queue_dir: repoRelativeMaybe(curationQueueDir),
    curation_queue_report: repoRelativeMaybe(curationQueueStage.report_file),
    curation_queue_identity_external_flow_refs:
      curationQueueStage.files?.identity_external_flow_refs ?? null,
    curation_queue_process_reference_external_flow_refs:
      curationQueueStage.files?.process_reference_external_flow_refs ?? null,
    final_rows: repoRelativeMaybe(cleanedRowsFile),
    schema_report: repoRelativeMaybe(schemaStage.report_file),
    qa_report: repoRelativeMaybe(qaStage.report_file),
    location_audit_report: repoRelativeMaybe(locationAuditStage.report_file),
    curation_gate_report: repoRelativeMaybe(curationGateReportFile),
    patch_collect_report: repoRelativeMaybe(patchCollectReportFile),
    patch_apply_report: repoRelativeMaybe(patchApplyReportFile),
    classification_decision_apply_report: repoRelativeMaybe(classificationDecisionApplyReportFile),
    location_decision_apply_report: repoRelativeMaybe(locationDecisionApplyReportFile),
    identity_decision_apply_reports: identityDecisionApplyReportFiles.map((file) =>
      repoRelativePath(file),
    ),
    patch_evidence: mutationManifest.evidence?.patch_evidence_file ?? null,
    dry_run_report: repoRelativeMaybe(dryRunStage.report_file),
    remote_verify_report: repoRelativeMaybe(remoteVerifyReportFile),
    mutation_manifest: mutationManifest.files?.report ?? null,
    unresolved_traces: mutationManifest.files?.unresolved_traces ?? null,
    source_exchange_completeness_traces:
      mutationManifest.files?.source_exchange_completeness_traces ?? null,
    source_reference_rewrites: mutationManifest.files?.source_reference_rewrites ?? null,
    mutation_identity_reference_rewrites:
      mutationManifest.files?.identity_reference_rewrites ?? null,
  };
  return {
    counts,
    files,
    preCleanupRowsRef: repoRelativeMaybe(preCleanupRowsFile),
    sourceContactRowsRef: repoRelativeMaybe(sourceContactRowsFile),
    canonicalSupportRowsRef: repoRelativeMaybe(canonicalSupportRowsFile),
    profile: String(options.profile || "generic"),
  };
}

/** Shared reset defaults for nested support sub-finalize invocations. */
export function buildNestedSupportFinalizeResetDefaults(): FinalizeOptions {
  return {
    skipSourceContactRewrites: true,
    finalizeSourceContactSupport: false,
    prepareSourceContactSupport: false,
    autoFinalizeSourceContactSupport: false,
    mintUnmatchedFpUgSupport: false,
    requireIdentityPreflight: false,
    runIdentityPreflight: false,
    identityPreflightIndex: null,
    identityPreflightRequests: null,
    identityPreflightRequestsIndex: null,
    classificationDecisionApplyReport: null,
    classificationDecisionsApplyReport: null,
    locationDecisionApplyReport: null,
    locationDecisionsApplyReport: null,
    identityDecisionApplyReport: null,
    identityDecisionsApplyReport: null,
    identityDecisionApplyReports: [],
    identityDecisionsApplyReports: [],
    patchCollectReport: null,
    authoringPatchCollectReport: null,
    patchApplyReport: null,
    verifyRemote: false,
    precommitVerifyRemote: false,
  };
}

/** Builds the CLI argument vector for optional remote precommit verification. */
export function buildRemoteVerifyCliArgs({
  deps,
  cleanedRowsFile,
  remoteOutDir,
  options,
  referenceIntentFile,
}: {
  deps: Pick<FinalizeDependencies, "appendOption" | "booleanOption">;
  cleanedRowsFile: string;
  remoteOutDir: string;
  options: FinalizeOptions;
  referenceIntentFile: string | null;
}): string[] {
  const remoteArgs = [
    "dataset",
    "verify-remote",
    "--input",
    cleanedRowsFile,
    "--out-dir",
    remoteOutDir,
    "--root-policy",
    String(options.remoteRootPolicy || options.rootPolicy || "candidate"),
    "--json",
  ];
  if (referenceIntentFile) remoteArgs.push("--reference-intent-file", referenceIntentFile);
  if (deps.booleanOption(options.compareRootPayload || options.remoteCompareRootPayload)) {
    remoteArgs.push("--compare-root-payload");
  }
  deps.appendOption(
    remoteArgs,
    "--target-user-id",
    options.remoteTargetUserId || options.targetUserId,
  );
  deps.appendOption(
    remoteArgs,
    "--state-code",
    options.remoteStateCode || options.stateCode || "0",
  );
  return remoteArgs;
}

/** Writes the synthetic support QA report placeholder when deterministic CLI QA is skipped. */
export function buildSkippedSupportQaStage({
  outDir,
  datasetType,
  cleanedRowsFile,
  repoRelativePath,
  writeJson,
}: {
  outDir: string;
  datasetType: string;
  cleanedRowsFile: string;
  repoRelativePath: FinalizeDependencies["repoRelativePath"];
  writeJson: FinalizeDependencies["writeJson"];
}): FinalizeStage {
  const supportQaOutDir = path.join(outDir, "qa", datasetType);
  const supportQaReportFile = path.join(supportQaOutDir, `${datasetType}-qa-report.json`);
  const supportQaReport = {
    schema_version: 1,
    status: "not_required_for_support_rows",
    dataset_type: datasetType,
    rows_file: repoRelativePath(cleanedRowsFile),
    findings: [],
    blockers: [],
    counts: { blockers: 0, findings: 0 },
    files: { report: repoRelativePath(supportQaReportFile) },
  };
  writeJson(supportQaReportFile, supportQaReport);
  return {
    stage: `${datasetType}_qa`,
    status: "not_required_for_support_rows",
    exit_code: 0,
    command: "skipped",
    args: [],
    stderr: "Support rows do not have a deterministic qa <type> gate.",
    report: supportQaReport,
    report_file: supportQaReportFile,
  };
}

/** Captures validation reference rows along with byte length and SHA-256 facts before cleanup. */
export function readFinalizeValidationReferences({
  qaFiles,
  readReferenceBytes,
  repoRelativePath,
}: {
  qaFiles: string[];
  readReferenceBytes: (file: string) => Buffer;
  repoRelativePath: FinalizeDependencies["repoRelativePath"];
}) {
  return qaFiles.map((file) => {
    const content = readReferenceBytes(file);
    const rows = readRows(file.toLowerCase(), () => content.toString("utf8"));
    if (!fs.readFileSync(file).equals(content)) {
      throw new Error("Selected Process validation reference bytes changed during capture.");
    }
    return {
      rows,
      fact: {
        path: repoRelativePath(file),
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    };
  });
}

/** Builds option payload passed to `runDatasetCurationGate` during post-authoring finalize. */
export function buildCurationGateOptions({
  options,
  datasetType,
  cleanedRowsFile,
  schemaStage,
  qaStage,
  outDir,
  identityPreflightRequired,
  identityPreflightRunStage,
  identityReferenceRewriteFile,
  unresolvedExchangeExternalizeStage,
  sourceContactRewriteStage,
  canonicalSupportReportFile,
  cleanupReportFile,
  curationQueueDir,
  fullContextRequirement,
  booleanOption,
}: {
  options: FinalizeOptions;
  datasetType: string;
  cleanedRowsFile: string;
  schemaStage: FinalizeStage;
  qaStage: FinalizeStage;
  outDir: string;
  identityPreflightRequired: boolean;
  identityPreflightRunStage: FinalizeStage;
  identityReferenceRewriteFile: string | null;
  unresolvedExchangeExternalizeStage: FinalizeStage;
  sourceContactRewriteStage: FinalizeStage;
  canonicalSupportReportFile: string | null;
  cleanupReportFile: string | null;
  curationQueueDir: string | null | undefined;
  fullContextRequirement: unknown;
  booleanOption: FinalizeDependencies["booleanOption"];
}) {
  return {
    ...options,
    type: datasetType,
    rowsFile: cleanedRowsFile,
    schemaReport: schemaStage.report_file,
    qaReport: qaStage.report_file,
    outDir: path.join(outDir, "curation-gate"),
    requireIdentityPreflight: identityPreflightRequired,
    identityPreflightIndex:
      identityPreflightRunStage.index_file ||
      options.identityPreflightIndex ||
      options.identityPreflightRequests ||
      options.identityPreflightRequestsIndex,
    identityReferenceRewrites: identityReferenceRewriteFile,
    classificationDecisionApplyReport:
      options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
    unresolvedExchangeExternalizationReport: unresolvedExchangeExternalizeStage.files?.report,
    sourceContactRewriteReport: sourceContactRewriteStage.files?.report,
    canonicalSupportRewriteReport: canonicalSupportReportFile,
    cleanupReport: cleanupReportFile,
    identityDecisionApplyReport:
      options.identityDecisionApplyReport || options.identityDecisionsApplyReport,
    queueDir: curationQueueDir,
    requireQueueContext:
      booleanOption(options.requireQueueContext || options.requireCurationQueueContext) ||
      (Boolean(fullContextRequirement) && datasetType === "process"),
  };
}

/** Builds option payload passed to `runDatasetMutationManifest` during post-authoring finalize. */
export function buildMutationManifestOptions({
  options,
  datasetType,
  rowsFile,
  cleanedRowsFile,
  outDir,
  schemaStage,
  qaStage,
  curationGateReportFile,
  requiresDeterministicQa,
  requiresCurationGate,
  cleanupReportFile,
  prewriteGateReady,
  dryRunStage,
  remoteVerifyReportFile,
  unresolvedExchangeExternalizeStage,
  sourceContactRewriteStage,
  canonicalSupportReportFile,
  identityDecisionApplyReportOptions,
  identityReferenceRewriteStage,
  identityReferenceRewriteFile,
  verifiedReferenceLedgerFiles,
  sourceReferenceRewrites,
}: {
  options: FinalizeOptions;
  datasetType: string;
  rowsFile: string;
  cleanedRowsFile: string;
  outDir: string;
  schemaStage: FinalizeStage;
  qaStage: FinalizeStage;
  curationGateReportFile: string | null;
  requiresDeterministicQa: boolean;
  requiresCurationGate: boolean;
  cleanupReportFile: string | null;
  prewriteGateReady: boolean;
  dryRunStage: FinalizeStage;
  remoteVerifyReportFile: string | null;
  unresolvedExchangeExternalizeStage: FinalizeStage;
  sourceContactRewriteStage: FinalizeStage;
  canonicalSupportReportFile: string | null;
  identityDecisionApplyReportOptions: string[];
  identityReferenceRewriteStage: FinalizeStage;
  identityReferenceRewriteFile: string | null;
  verifiedReferenceLedgerFiles: string[];
  sourceReferenceRewrites: unknown;
}) {
  return {
    ...options,
    type: datasetType,
    rowsFile: cleanedRowsFile,
    referenceRowsFile:
      identityReferenceRewriteStage.reference_rows_file ||
      options.referenceRowsFile ||
      options.referenceRows ||
      options.reuseRowsFile,
    schemaReport: schemaStage.report_file,
    qaReport: requiresDeterministicQa ? qaStage.report_file : null,
    curationGateReport: requiresCurationGate ? curationGateReportFile : null,
    cleanupReport: cleanupReportFile,
    dryRunReport: prewriteGateReady ? dryRunStage.report_file : null,
    remoteVerifyReport: remoteVerifyReportFile,
    unresolvedExchangeExternalizationReport: unresolvedExchangeExternalizeStage.files?.report,
    sourceContactRewriteReport: sourceContactRewriteStage.files?.report,
    canonicalSupportRewriteReport: canonicalSupportReportFile,
    classificationDecisionApplyReport:
      options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
    locationDecisionApplyReport:
      options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
    identityDecisionApplyReport:
      options.identityDecisionApplyReport || options.identityDecisionsApplyReport,
    identityDecisionApplyReports: identityDecisionApplyReportOptions,
    identityReferenceRewriteStatus: identityReferenceRewriteStage.status,
    identityReferenceRewriteInputRows: rowsFile,
    identityReferenceRewriteOutputRows: identityReferenceRewriteStage.output_rows_file,
    sourceReferenceRewrites,
    identityReferenceRewrites: identityReferenceRewriteFile,
    verifiedReferenceLedgers: verifiedReferenceLedgerFiles,
    outDir: path.join(outDir, "mutation-manifest"),
    requireCurationGate: requiresCurationGate,
  };
}

/** Returns the static policy metadata embedded in the finalized post-authoring report. */
export function buildFinalizeReportPolicy(identityPreflightRequired: boolean) {
  return {
    purpose:
      "Finalize AI-authored or support TIDAS rows into exact-scope prewrite evidence without committing to the database.",
    commit_boundary:
      "A later explicit CLI commit command is required after this report and mutation manifest are ready.",
    required_multilang_english_before_write: true,
    preserve_source_language_variants: true,
    full_context_ai_patch_evidence:
      "When the active profile requires full-context AI completion, mutation manifest must prove deterministic AI semantic evidence: classification/location decision apply evidence for queued decisions, or patch collect/apply evidence with authoring package hash, closed action items, resolution.mode, and resolution.used_context_kinds for field patches.",
    identity_preflight_gate: identityPreflightRequired
      ? "Process/flow full-context profiles require completed CLI identity-preflight evidence from flow_hybrid_search/process_hybrid_search before post-authoring dry-run or remote write planning."
      : "Not required for this dataset type/profile unless --require-identity-preflight is provided.",
    location_code_audit:
      "Final rows must pass tiangong-lca dataset classification audit --type location against tidas_locations_category.json before remote write.",
  };
}

/** Attaches commit handoff and import ledger summaries onto the finalized report and persists it. */
export function attachHandoffAndLedgerToFinalizeReport({
  report,
  reportPath,
  commitHandoffPlan,
  importLedger,
  finalizeStartedAtMs,
  finalizeTimings,
  writeJson,
  repoRelativePath,
}: {
  report: Record<string, unknown> & {
    counts: Record<string, unknown>;
    files: Record<string, unknown>;
  };
  reportPath: string;
  commitHandoffPlan: FinalizeStage;
  importLedger: FinalizeStage;
  finalizeStartedAtMs: number;
  finalizeTimings: unknown[];
  writeJson: FinalizeDependencies["writeJson"];
  repoRelativePath: FinalizeDependencies["repoRelativePath"];
}): FinalizeStage {
  const commit_handoff_blockers = commitHandoffPlan.counts?.blockers ?? 0;
  const finalReport = {
    ...report,
    counts: {
      ...report.counts,
      commit_handoff_blockers,
      finalize_duration_ms: Date.now() - finalizeStartedAtMs,
      finalize_substage_count: finalizeTimings.length,
      import_ledger_entries: importLedger.counts?.entries_written ?? 0,
    },
    commit_handoff: {
      status: commitHandoffPlan.status,
      command: commitHandoffPlan.commands?.commit ?? null,
      post_write_verify_command: commitHandoffPlan.commands?.post_write_verify ?? null,
      blockers: commitHandoffPlan.blockers ?? [],
    },
    timings: finalizeTimings,
    files: {
      ...report.files,
      commit_handoff_plan: commitHandoffPlan.files?.report ?? null,
      import_ledger: importLedger.files ?? {},
    },
  };
  writeJson(reportPath, finalReport);
  return {
    ...finalReport,
    files: { ...finalReport.files, report: repoRelativePath(reportPath) },
  };
}

/** Normalizes raw `runTidasRowsValidation` output into the `schema_validate` stage shape. */
export function normalizeSchemaValidateStage(stage: Record<string, unknown>): FinalizeStage {
  const record = stage as FinalizeStage;
  return {
    stage: "schema_validate",
    command: record.executable,
    executable: record.executable,
    args: record.args,
    exit_code: record.exit_code,
    stderr: record.stderr,
    report: record.report,
    report_file: record.report_file,
    rust_report: record.rust_report,
    binary_version: record.binary_version,
  };
}

/** Builds deterministic CLI arguments for `qa <datasetType>` prewrite validation. */
export function buildDeterministicQaArgs(
  datasetType: string,
  cleanedRowsFile: string,
  qaOutDir: string,
  qaFiles: string[],
): string[] {
  return [
    "qa",
    datasetType,
    "--rows-file",
    cleanedRowsFile,
    "--out-dir",
    qaOutDir,
    ...qaFiles.flatMap((file) => ["--reference-rows-file", file]),
    "--json",
  ];
}

/** Binds the deterministic QA report path onto the executed `qa <type>` stage. */
export function attachQaReportFile(
  stage: FinalizeStage,
  datasetType: string,
  qaOutDir: string,
  reportFileFromCliStage: FinalizeDependencies["reportFileFromCliStage"],
): FinalizeStage {
  stage.report_file = reportFileFromCliStage(
    stage,
    ["files.report"],
    path.join(
      qaOutDir,
      datasetType === "flow"
        ? "flow_qa_report.json"
        : datasetType === "lifecyclemodel"
          ? "lifecyclemodel_qa_report.json"
          : "process-qa-report.json",
    ),
  );
  return stage;
}

/** Builds CLI arguments for `location_audit` classification checking. */
export function buildLocationAuditArgs(
  cleanedRowsFile: string,
  locationAuditOutDir: string,
): string[] {
  return [
    "dataset",
    "classification",
    "audit",
    "--type",
    "location",
    "--input",
    cleanedRowsFile,
    "--out-dir",
    locationAuditOutDir,
    "--json",
  ];
}

/** Binds the `location_audit` output report file path onto the executed stage. */
export function attachLocationAuditReportFile(
  stage: FinalizeStage,
  locationAuditOutDir: string,
  reportFileFromCliStage: FinalizeDependencies["reportFileFromCliStage"],
): FinalizeStage {
  stage.report_file = reportFileFromCliStage(
    stage,
    ["files.report"],
    path.join(locationAuditOutDir, "outputs", "location-audit-report.json"),
  );
  return stage;
}

/** Projects commit handoff summary onto the base finalize report before ledger persistence. */
export function buildImportLedgerReportInput(
  report: Record<string, unknown> & {
    counts: Record<string, unknown>;
    files: Record<string, unknown>;
  },
  commitHandoffPlan: FinalizeStage,
  commitHandoffBlockers: number,
) {
  return {
    ...report,
    counts: {
      ...report.counts,
      commit_handoff_blockers: commitHandoffBlockers,
    },
    commit_handoff: {
      status: commitHandoffPlan.status,
      command: commitHandoffPlan.commands?.commit ?? null,
      post_write_verify_command: commitHandoffPlan.commands?.post_write_verify ?? null,
      blockers: commitHandoffPlan.blockers ?? [],
    },
    files: {
      ...report.files,
      commit_handoff_plan: commitHandoffPlan.files?.report ?? null,
    },
  };
}
