import fs from "node:fs";
import path from "node:path";
import { taskAuthorizationAllows } from "../task-authorization.ts";
import {
  compactStageReportWithTiming,
  postCleanupArtifactDirectories,
  postCleanupArtifactFiles,
  type FinalizeDependencies,
  type FinalizeOptions,
  type FinalizeStage,
  type FinalizeTiming,
  type JsonRecord,
} from "./post-authoring-types.ts";

/** Builds the blocked finalize report and writes optional import-ledger when cleanup fails. */
export function buildCleanupBlockedFinalizeResult({
  deps,
  datasetType,
  options,
  rowsFile,
  preCleanupRowsFile,
  sourceContactRowsFile,
  canonicalSupportRowsFile,
  canonicalSupportReportFile,
  canonicalSupportPrewriteBlockers,
  outDir,
  finalizeStartedAtUtc,
  finalizeStartedAtMs,
  finalizeTimings,
  timeStage,
  identityReferenceRewriteStage,
  unresolvedExchangeExternalizeStage,
  sourceContactRewriteStage,
  sourceContactSupportFinalize,
  canonicalSupportRewriteStage,
  cleanup,
  cleanupReportFile,
}: {
  deps: FinalizeDependencies;
  datasetType: string;
  options: FinalizeOptions;
  rowsFile: string;
  preCleanupRowsFile: string;
  sourceContactRowsFile: string;
  canonicalSupportRowsFile: string;
  canonicalSupportReportFile: string | null;
  canonicalSupportPrewriteBlockers: JsonRecord[];
  outDir: string;
  finalizeStartedAtUtc: string;
  finalizeStartedAtMs: number;
  finalizeTimings: FinalizeTiming[];
  timeStage: <T extends FinalizeStage>(stage: string, fn: () => T) => T;
  identityReferenceRewriteStage: FinalizeStage;
  unresolvedExchangeExternalizeStage: FinalizeStage;
  sourceContactRewriteStage: FinalizeStage;
  sourceContactSupportFinalize: FinalizeStage;
  canonicalSupportRewriteStage: FinalizeStage;
  cleanup: FinalizeStage;
  cleanupReportFile: string | null;
}): FinalizeStage {
  const {
    compactStageReport,
    ensureArray,
    nowIso,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    writeFinalizeImportLedger,
    writeJson,
  } = deps;
  const staleManagedArtifacts = [
    ...postCleanupArtifactDirectories
      .map((directory) => path.join(outDir, directory))
      .filter((directory) => fs.existsSync(directory)),
    ...postCleanupArtifactFiles
      .map((file) => path.join(outDir, file))
      .filter((file) => fs.existsSync(file)),
  ];
  const priorStageBlockers = [
    ...ensureArray(identityReferenceRewriteStage.blockers).map((blocker) => ({
      ...blocker,
      stage: "identity_reference_rewrites",
      source: "identity_reference_rewrites",
      severity: blocker.severity || "error",
    })),
    ...ensureArray(unresolvedExchangeExternalizeStage.blockers).map((blocker) => ({
      ...blocker,
      stage: "unresolved_exchange_externalization",
      source: "unresolved_exchange_externalization",
      severity: blocker.severity || "error",
    })),
    ...ensureArray(sourceContactRewriteStage.blockers).map((blocker) => ({
      ...blocker,
      stage: "source_contact_rewrites",
      source: "source_contact_rewrites",
      severity: blocker.severity || "error",
    })),
    ...ensureArray(sourceContactSupportFinalize.blockers).map((blocker) => ({
      ...blocker,
      stage: "source_contact_support_finalize",
      source: "source_contact_support_finalize",
      severity: blocker.severity || "error",
    })),
    ...ensureArray(sourceContactSupportFinalize.commit_handoff?.blockers).map((blocker) => ({
      ...blocker,
      stage: "source_contact_support_finalize",
      source: "source_contact_support_commit_handoff",
      severity: blocker.severity || "error",
    })),
    ...canonicalSupportPrewriteBlockers,
  ];
  const cleanupBlockers = ensureArray(cleanup.blockers).map((blocker) => ({
    ...blocker,
    stage: "curation_cleanup",
    source: "curation_cleanup",
    severity: blocker.severity || "error",
  }));
  const cleanupNotReadyBlocker = {
    code: "curation_cleanup_not_ready",
    stage: "curation_cleanup",
    source: "curation_cleanup",
    severity: "error",
    cleanup_status: cleanup.status ?? null,
    cleanup_report: repoRelativeMaybe(cleanupReportFile),
    action:
      "Resolve every cleanup blocker and rerun post-authoring finalize before any downstream prewrite stage.",
  };
  const invalidationBlockers =
    staleManagedArtifacts.length > 0
      ? [
          {
            code: "stale_finalize_artifacts_not_invalidated",
            stage: "curation_cleanup",
            source: "finalize_output_ownership",
            severity: "error",
            paths: staleManagedArtifacts.map((artifact) => repoRelativeMaybe(artifact)),
            action:
              "Preserve and inspect the stale artifacts manually, then use a new output directory for the repaired rerun.",
          },
        ]
      : [];
  const blockers = [
    ...priorStageBlockers,
    ...cleanupBlockers,
    cleanupNotReadyBlocker,
    ...invalidationBlockers,
  ];
  const stageReports = [
    {
      stage: "identity_reference_rewrites",
      status: identityReferenceRewriteStage.status,
      exit_code: (identityReferenceRewriteStage.blockers ?? []).length > 0 ? 1 : 0,
      command: "foundry.dataset-identity-reference-rewrites-apply",
      args: [],
      stderr: "",
      report_file: null,
    },
    {
      stage: "unresolved_exchange_externalization",
      status: unresolvedExchangeExternalizeStage.status,
      exit_code: 0,
      command: "foundry.externalize-unresolved-process-flow-exchanges",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(unresolvedExchangeExternalizeStage.files?.report),
    },
    {
      stage: "source_contact_rewrites",
      status: sourceContactRewriteStage.status,
      exit_code: 0,
      command: "foundry.dataset-source-contact-rewrites-apply",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(sourceContactRewriteStage.files?.report),
    },
    {
      stage: "canonical_support_rewrites",
      status: canonicalSupportRewriteStage.status,
      exit_code: (canonicalSupportRewriteStage.counts?.blockers ?? 0) > 0 ? 1 : 0,
      command: "foundry.dataset-canonical-support-rewrites-apply",
      args: [],
      stderr: "",
      report_file: canonicalSupportReportFile,
    },
    {
      stage: "curation_cleanup",
      status: cleanup.status,
      exit_code: 1,
      command: "foundry.dataset-curation-cleanup",
      args: [],
      stderr: "",
      report_file: cleanupReportFile,
    },
  ];
  const timingsByStage = new Map(finalizeTimings.map((timing) => [timing.stage, timing]));
  const reportPath = path.join(outDir, "dataset-post-authoring-finalize-report.json");
  const report = {
    schema_version: 1,
    started_at_utc: finalizeStartedAtUtc,
    generated_at_utc: nowIso(),
    status: "blocked",
    dataset_type: datasetType,
    profile: String(options.profile || "generic"),
    rows_file: repoRelativePath(rowsFile),
    pre_cleanup_rows_file: repoRelativeMaybe(preCleanupRowsFile),
    source_contact_rows_file: repoRelativeMaybe(sourceContactRowsFile),
    canonical_support_rows_file: repoRelativeMaybe(canonicalSupportRowsFile),
    final_rows_file: null,
    remote_write_mode: "read-only",
    policy: {
      purpose:
        "Finalize AI-authored or support TIDAS rows into exact-scope prewrite evidence without committing to the database.",
      cleanup_gate:
        "Curation cleanup must complete with a concrete cleaned rows artifact before identity preflight, queue, schema, QA, dry-run, mutation manifest, or handoff stages may run.",
    },
    counts: {
      finalize_duration_ms: Date.now() - finalizeStartedAtMs,
      finalize_substage_count: finalizeTimings.length,
      blockers: blockers.length,
      mutation_manifest_blockers: 0,
      prewrite_gate_blockers: blockers.length,
      canonical_support_blockers: canonicalSupportRewriteStage.counts?.blockers ?? 0,
      write_candidates: 0,
    },
    blockers,
    stages: stageReports.map((stage) =>
      compactStageReportWithTiming(stage, timingsByStage, compactStageReport),
    ),
    timings: finalizeTimings,
    files: {
      source_contact_rewrite_report: sourceContactRewriteStage.files?.report ?? null,
      source_contact_rewritten_rows: sourceContactRewriteStage.files?.output_rows ?? null,
      cleanup_report: repoRelativeMaybe(cleanupReportFile),
      canonical_support_rewrite_report: repoRelativeMaybe(canonicalSupportReportFile),
      canonical_support_rewritten_rows: repoRelativeMaybe(canonicalSupportRowsFile),
      final_rows: null,
      identity_preflight_run_report: null,
      identity_preflight_index: null,
      curation_queue_dir: null,
      curation_queue_report: null,
      schema_report: null,
      qa_report: null,
      location_audit_report: null,
      curation_gate_report: null,
      dry_run_report: null,
      remote_verify_report: null,
      mutation_manifest: null,
      commit_handoff_plan: null,
    },
    commit_handoff: {
      status: "not_requested",
      command: null,
      post_write_verify_command: null,
      blockers,
    },
  };
  writeJson(reportPath, report);
  const importLedger = writeFinalizeImportLedger
    ? timeStage("import_ledger", () =>
        writeFinalizeImportLedger({
          report,
          reportPath,
          ledgerDir: resolveRepoPath(
            options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
          ),
        }),
      )
    : { status: "skipped", files: {}, counts: { entries_written: 0 } };
  const finalReport = {
    ...report,
    counts: {
      ...report.counts,
      finalize_duration_ms: Date.now() - finalizeStartedAtMs,
      finalize_substage_count: finalizeTimings.length,
      import_ledger_entries: importLedger.counts?.entries_written ?? 0,
    },
    timings: finalizeTimings,
    files: {
      ...report.files,
      import_ledger: importLedger.files ?? {},
    },
  };
  writeJson(reportPath, finalReport);
  return {
    ...finalReport,
    files: {
      ...finalReport.files,
      report: repoRelativePath(reportPath),
    },
  };
}

/** Resolves dataset-specific dry-run CLI arguments without dispatching remote writes. */
export function buildDryRunCliArgs({
  deps,
  datasetType,
  supportTypes,
  cleanedRowsFile,
  dryRunOutDir,
  options,
  taskAuthorization,
}: {
  deps: Pick<FinalizeDependencies, "appendOption" | "booleanOption">;
  datasetType: string;
  supportTypes: string[];
  cleanedRowsFile: string;
  dryRunOutDir: string;
  options: FinalizeOptions;
  taskAuthorization: unknown;
}): string[] {
  const args = (() => {
    if (datasetType === "support" || supportTypes.includes(datasetType)) {
      const supportDryRunArgs = [
        "dataset",
        "save-draft",
        "--type",
        datasetType === "support" ? "auto" : datasetType,
        "--input",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
      if (
        deps.booleanOption(options.mintUnmatchedFpUgSupport) ||
        taskAuthorizationAllows(taskAuthorization, "flowproperty_write") ||
        taskAuthorizationAllows(taskAuthorization, "unitgroup_write")
      ) {
        supportDryRunArgs.push("--allow-account-local-support");
      }
      return supportDryRunArgs;
    }
    if (datasetType === "flow") {
      return [
        "flow",
        "publish-version",
        "--input-file",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
    }
    if (datasetType === "lifecyclemodel") {
      return [
        "lifecyclemodel",
        "save-draft",
        "--input",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
    }
    return [
      "process",
      "save-draft",
      "--input",
      cleanedRowsFile,
      "--out-dir",
      dryRunOutDir,
      "--dry-run",
      "--json",
    ];
  })();
  if (datasetType === "flow") {
    deps.appendOption(args, "--target-user-id", options.remoteTargetUserId || options.targetUserId);
  }
  return args;
}

/** Collects deduplicated scope and item blockers from the mutation manifest. */
export function collectMutationManifestBlockers(
  ensureArray: FinalizeDependencies["ensureArray"],
  mutationManifest: FinalizeStage,
): JsonRecord[] {
  const mutationManifestBlockers: JsonRecord[] = [];
  const seenMutationBlockers = new Set<string>();
  const addMutationBlocker = (blocker: JsonRecord, extra: JsonRecord = {}): void => {
    if (!blocker || typeof blocker !== "object") return;
    const normalized: JsonRecord = {
      ...blocker,
      stage: blocker.stage || "mutation_manifest",
      source: "mutation_manifest",
      ...extra,
    };
    const key = JSON.stringify([
      normalized.code,
      normalized.stage,
      normalized.row_index,
      normalized.table,
      normalized.reference_id,
      normalized.reference_version,
      normalized.path,
    ]);
    if (seenMutationBlockers.has(key)) return;
    seenMutationBlockers.add(key);
    mutationManifestBlockers.push(normalized);
  };
  for (const blocker of ensureArray(mutationManifest.evidence?.scope_blockers)) {
    addMutationBlocker(blocker);
  }
  for (const item of ensureArray(mutationManifest.items)) {
    for (const blocker of ensureArray(item?.blockers)) {
      addMutationBlocker(blocker, {
        dataset_type: item?.dataset_type ?? null,
        entity_id: item?.entity_id ?? null,
        version: item?.version ?? null,
      });
    }
  }
  return mutationManifestBlockers;
}

/** Builds ordered runtime stage reports for the completed finalize run. */
export function buildFinalizeStageReports({
  resolveRepoPath,
  identityPreflightRunStage,
  identityReferenceRewriteStage,
  unresolvedExchangeExternalizeStage,
  sourceContactRewriteStage,
  sourceContactSupportFinalizeRequested,
  sourceContactSupportFinalizeStatus,
  sourceContactSupportFinalizeBlockers,
  sourceContactSupportFinalize,
  canonicalSupportRewriteStage,
  canonicalSupportReportFile,
  cleanup,
  cleanupReportFile,
  curationQueueStage,
  schemaStage,
  qaStage,
  locationAuditStage,
  curationGate,
  curationGateReportFile,
  requiresCurationGate,
  dryRunStage,
  remoteVerifyStage,
  mutationManifest,
}: {
  resolveRepoPath: FinalizeDependencies["resolveRepoPath"];
  identityPreflightRunStage: FinalizeStage;
  identityReferenceRewriteStage: FinalizeStage;
  unresolvedExchangeExternalizeStage: FinalizeStage;
  sourceContactRewriteStage: FinalizeStage;
  sourceContactSupportFinalizeRequested: boolean;
  sourceContactSupportFinalizeStatus: string | undefined;
  sourceContactSupportFinalizeBlockers: number;
  sourceContactSupportFinalize: FinalizeStage;
  canonicalSupportRewriteStage: FinalizeStage;
  canonicalSupportReportFile: string | null;
  cleanup: FinalizeStage;
  cleanupReportFile: string | null;
  curationQueueStage: FinalizeStage;
  schemaStage: FinalizeStage;
  qaStage: FinalizeStage;
  locationAuditStage: FinalizeStage;
  curationGate: FinalizeStage;
  curationGateReportFile: string | null;
  requiresCurationGate: boolean;
  dryRunStage: FinalizeStage;
  remoteVerifyStage: FinalizeStage | null;
  mutationManifest: FinalizeStage;
}): FinalizeStage[] {
  return [
    {
      stage: "identity_preflight_run",
      status: identityPreflightRunStage.status,
      exit_code: [
        "not_requested",
        "planned",
        "completed",
        "completed_with_identity_findings",
      ].includes(identityPreflightRunStage.status ?? "")
        ? 0
        : 1,
      command:
        identityPreflightRunStage.status === "not_requested"
          ? "skipped"
          : "foundry.dataset-identity-preflight-run",
      args: [],
      stderr: "",
      report_file: identityPreflightRunStage.report_file,
    },
    {
      stage: "identity_reference_rewrites",
      status: identityReferenceRewriteStage.status,
      exit_code: (identityReferenceRewriteStage.blockers ?? []).length > 0 ? 1 : 0,
      command: "foundry.dataset-identity-reference-rewrites-apply",
      args: [],
      stderr: "",
      report_file: null,
    },
    {
      stage: "unresolved_exchange_externalization",
      status: unresolvedExchangeExternalizeStage.status,
      exit_code: 0,
      command: "foundry.externalize-unresolved-process-flow-exchanges",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(unresolvedExchangeExternalizeStage.files?.report),
    },
    {
      stage: "source_contact_rewrites",
      status: sourceContactRewriteStage.status,
      exit_code: 0,
      command: "foundry.dataset-source-contact-rewrites-apply",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(sourceContactRewriteStage.files?.report),
    },
    {
      stage: "source_contact_support_finalize",
      status: sourceContactSupportFinalizeStatus,
      exit_code: sourceContactSupportFinalizeBlockers > 0 ? 1 : 0,
      command: sourceContactSupportFinalizeRequested
        ? "foundry.dataset-post-authoring-finalize"
        : "skipped",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(sourceContactSupportFinalize.files?.report),
    },
    {
      stage: "canonical_support_rewrites",
      status: canonicalSupportRewriteStage.status,
      exit_code: (canonicalSupportRewriteStage.counts?.blockers ?? 0) > 0 ? 1 : 0,
      command: "foundry.dataset-canonical-support-rewrites-apply",
      args: [],
      stderr: "",
      report_file: canonicalSupportReportFile,
    },
    {
      stage: "curation_cleanup",
      status: cleanup.status,
      exit_code: 0,
      command: "foundry.dataset-curation-cleanup",
      args: [],
      stderr: "",
      report_file: cleanupReportFile,
    },
    {
      stage: "curation_queue",
      status: curationQueueStage.status,
      exit_code:
        curationQueueStage.status === "not_required" ||
        curationQueueStage.status === "provided" ||
        curationQueueStage.status === "ready"
          ? 0
          : 1,
      command:
        curationQueueStage.status === "not_required" || curationQueueStage.status === "provided"
          ? "skipped"
          : "foundry.dataset-curation-queue-build",
      args: [],
      stderr: curationQueueStage.report?.foundry_wrapper?.stderr || "",
      report_file: curationQueueStage.report_file,
    },
    schemaStage,
    qaStage,
    locationAuditStage,
    {
      stage: "post_authoring_curation_gate",
      status: curationGate.status,
      exit_code:
        !requiresCurationGate ||
        ["ready", "ready_with_profile_waivers"].includes(curationGate.status ?? "")
          ? 0
          : 1,
      command: "foundry.dataset-curation-gate",
      args: [],
      stderr: "",
      report_file: curationGateReportFile,
    },
    dryRunStage,
    ...(remoteVerifyStage ? [remoteVerifyStage] : []),
    {
      stage: "mutation_manifest",
      status: mutationManifest.status,
      exit_code: ["ready_for_remote_write", "ready_reference_only"].includes(
        mutationManifest.status ?? "",
      )
        ? 0
        : 1,
      command: "foundry.dataset-mutation-manifest",
      args: [],
      stderr: "",
      report_file: resolveRepoPath(mutationManifest.files?.report),
    },
  ];
}

/** Resolves dry-run output directory and stage name for the target dataset type. */
export function resolveDryRunStageTarget(
  datasetType: string,
  outDir: string,
  supportTypes: string[],
) {
  const isSupport = datasetType === "support" || supportTypes.includes(datasetType);
  return {
    dryRunOutDir: path.join(
      outDir,
      "dry-run",
      isSupport
        ? `${datasetType}-save-draft`
        : datasetType === "flow"
          ? "flow-publish-version"
          : datasetType === "lifecyclemodel"
            ? "lifecyclemodel-save-draft"
            : "process-save-draft",
    ),
    dryRunStageName: isSupport
      ? `${datasetType}_save_draft_dry_run`
      : datasetType === "flow"
        ? "flow_publish_version_dry_run"
        : datasetType === "lifecyclemodel"
          ? "lifecyclemodel_save_draft_dry_run"
          : "process_save_draft_dry_run",
  };
}

/** Binds the dry-run publish/save report path when prewrite gates succeeded. */
export function attachDryRunReportFile({
  stage,
  datasetType,
  supportTypes,
  dryRunOutDir,
  prewriteGateReady,
  reportFileFromCliStage,
}: {
  stage: FinalizeStage;
  datasetType: string;
  supportTypes: string[];
  dryRunOutDir: string;
  prewriteGateReady: boolean;
  reportFileFromCliStage: FinalizeDependencies["reportFileFromCliStage"];
}): FinalizeStage {
  if (prewriteGateReady) {
    const isSupport = datasetType === "support" || supportTypes.includes(datasetType);
    stage.report_file = reportFileFromCliStage(
      stage,
      datasetType === "flow" ? ["files.report"] : ["files.summary_json"],
      isSupport
        ? path.join(dryRunOutDir, "outputs", "dataset-save-draft", "summary.json")
        : datasetType === "flow"
          ? path.join(dryRunOutDir, "flows_tidas_sdk_plus_classification_mcp_sync_report.json")
          : datasetType === "lifecyclemodel"
            ? path.join(dryRunOutDir, "outputs", "save-draft-bundle", "summary.json")
            : path.join(dryRunOutDir, "outputs", "save-draft-rpc", "summary.json"),
    );
  }
  return stage;
}

/** Runs optional remote precommit verification and records blocking findings. */
export function runRemoteVerifyFinalizeStageBody({
  deps,
  remoteOutDir,
  remoteArgs,
  prewriteGateReady,
  prewriteGateBlockers,
}: {
  deps: Pick<
    FinalizeDependencies,
    "runTiangongJsonStage" | "skippedPrewriteStage" | "reportFileFromCliStage" | "repoRelativeMaybe"
  >;
  remoteOutDir: string;
  remoteArgs: string[];
  prewriteGateReady: boolean;
  prewriteGateBlockers: JsonRecord[];
}): { stage: FinalizeStage; reportFile: string | null } {
  let reportFile: string | null = null;
  const stage = prewriteGateReady
    ? deps.runTiangongJsonStage("remote_verify_precommit", remoteArgs)
    : deps.skippedPrewriteStage(
        "remote_verify_precommit",
        "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
      );
  if (prewriteGateReady) {
    stage.report_file = deps.reportFileFromCliStage(
      stage,
      ["files.report"],
      path.join(remoteOutDir, "outputs", "remote-verification-report.json"),
    );
    reportFile = stage.report_file ?? null;
    if (
      stage.report?.schema === "tiangong-foundry.edge-support-precommit.v1" &&
      stage.status !== "passed_remote_verification"
    ) {
      prewriteGateBlockers.push({
        code: "edge_precommit_verification_blocked",
        stage: "remote_verify_precommit",
        message:
          "Resolve the exact remote identity and dependency checks before requesting write approval.",
        report: deps.repoRelativeMaybe(reportFile),
      });
    }
  }
  return { stage, reportFile };
}

/** Derives raw vs advisory blocker summary metrics for nested source/contact support finalize. */
export function computeSourceContactSupportSummary({
  ensureArray,
  sourceContactSupportFinalizeRequested,
  sourceContactSupportFinalize,
  mutationManifest,
}: {
  ensureArray: FinalizeDependencies["ensureArray"];
  sourceContactSupportFinalizeRequested: boolean;
  sourceContactSupportFinalize: FinalizeStage;
  mutationManifest: FinalizeStage;
}) {
  const rawBlockers = Number(sourceContactSupportFinalize.counts?.blockers ?? 0);
  const rawHandoffBlockers = ensureArray(
    sourceContactSupportFinalize.commit_handoff?.blockers,
  ).length;
  const advisory = Boolean(
    sourceContactSupportFinalizeRequested &&
    sourceContactSupportFinalize.status === "blocked" &&
    mutationManifest.status === "ready_for_remote_write" &&
    Number(mutationManifest.counts?.blockers ?? 0) === 0,
  );
  return {
    rawBlockers,
    rawHandoffBlockers,
    advisory,
    status: advisory
      ? "advisory_blocked_top_level_remote_verified"
      : sourceContactSupportFinalize.status,
    blockers: advisory ? 0 : rawBlockers,
    commitHandoffBlockers: advisory ? 0 : rawHandoffBlockers,
  };
}
