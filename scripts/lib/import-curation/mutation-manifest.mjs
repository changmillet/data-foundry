import fs from "node:fs";
import path from "node:path";
import * as mutationManifestWorkflow from "./internal/mutation-manifest-workflow.mjs";

const {
  asText,
  buildEvidenceScopeBlockers,
  buildFullContextAiCompletionBlockers,
  buildReferenceClosureBlockers,
  buildReferenceReuseItems,
  buildWriteCandidateItem,
  datasetTypeFromOptions,
  datasetTypePlural,
  decisionCounts,
  decisionTaskContextBundleHashesFromContext,
  ensureArray,
  evidenceScopeBlocker,
  fileExists,
  fullContextAiCompletionRequirement,
  identityDecisionApplyReportOptionValues,
  identityDecisionUnresolvedReferenceKeys,
  identityKey,
  identityReferenceRewriteProofKeys,
  jsonLines,
  mapCurationEntities,
  mapRowsByIdentity,
  mapSchemaRows,
  nowIso,
  operationCounts,
  plannedRootReferenceIds,
  plannedRootReferenceKeys,
  profileFor,
  readCanonicalSupportRewriteContext,
  readClassificationDecisionApplyContext,
  readCleanupTransformContext,
  readDatasetSaveDraftDryRunArtifacts,
  readFileArtifactIfOption,
  readFlowDryRunArtifacts,
  readIdentityDecisionApplyContexts,
  readIdentityReferenceRewriteContext,
  readJsonArtifactsIfOption,
  readJsonIfOption,
  readLifecyclemodelDryRunArtifacts,
  readLocationDecisionApplyContext,
  readPatchApplyContext,
  readPolicySnapshots,
  readProcessDryRunArtifacts,
  readRows,
  readRowsIfExists,
  readSourceContactRewriteContext,
  readSourceReferenceRewriteContext,
  readUnresolvedExchangeExternalizationContext,
  remoteVerifyBlockerKeys,
  repoRelativePath,
  resolveRepoPath,
  supportDatasetTypes,
  writeJson,
  writeText,
} = mutationManifestWorkflow;

export function runDatasetMutationManifest({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-mutation-manifest",
      usage: [
        "node scripts/foundry.mjs dataset-mutation-manifest --type flow --rows-file <ready-flow-rows.jsonl> --schema-report <validation-report.json> --dry-run-report <flow-publish-report.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <ready-processes.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --remote-verify-report <remote-verification-report.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type lifecyclemodel --rows-file <ready-lifecyclemodels.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type flow --rows-file <classified-flows.jsonl> --classification-decision-apply-report <classification-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <located-processes.jsonl> --location-decision-apply-report <location-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node scripts/foundry.mjs dataset-mutation-manifest --type process --rows-file <patched-cleaned-rows.jsonl> --patch-collect-report <authoring-patch-collect-report.json> --require-patch-collect-report --patch-apply-report <dataset-patch-apply-report.json> --cleanup-report <dataset-curation-cleanup-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
      ],
      purpose:
        "Build a prewrite mutation manifest that separates write/update candidates, reusable existing references, and blocked rows before any commit.",
    };
  }

  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const referenceRowsFile = resolveRepoPath(
    repoRoot,
    options.referenceRowsFile || options.referenceRows || options.reuseRowsFile,
  );
  const schemaReportArtifact = readJsonIfOption(repoRoot, options.schemaReport);
  const curationGateArtifact = readJsonIfOption(repoRoot, options.curationGateReport);
  const dryRunReportArtifact = readJsonIfOption(repoRoot, options.dryRunReport);
  const remoteVerifyArtifact = readJsonIfOption(repoRoot, options.remoteVerifyReport);
  const cleanupArtifact = readJsonIfOption(repoRoot, options.cleanupReport);
  const patchApplyArtifact = readJsonIfOption(repoRoot, options.patchApplyReport);
  const patchCollectArtifact = readJsonIfOption(
    repoRoot,
    options.patchCollectReport ?? options.authoringPatchCollectReport,
  );
  const classificationDecisionApplyArtifact = readJsonIfOption(
    repoRoot,
    options.classificationDecisionApplyReport ?? options.classificationDecisionsApplyReport,
  );
  const locationDecisionApplyArtifact = readJsonIfOption(
    repoRoot,
    options.locationDecisionApplyReport ?? options.locationDecisionsApplyReport,
  );
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    repoRoot,
    identityDecisionApplyReportOptionValues(options),
  );
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const patchEvidenceFile = readFileArtifactIfOption(
    repoRoot,
    options.patchEvidenceFile || options.patchEvidence,
  );
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-mutation-manifest`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const targetUserId = asText(
    options.targetUserId ??
      options.targetOwnerId ??
      dryRunReportArtifact?.value?.target_user_id_override ??
      process.env.FOUNDRY_TARGET_USER_ID,
  );
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(repoRoot, profileId, options);
  const fullContextRequirement = fullContextAiCompletionRequirement(profile, datasetType, repoRoot);
  const classificationDecisionApplyContext = classificationDecisionApplyArtifact
    ? readClassificationDecisionApplyContext(repoRoot, classificationDecisionApplyArtifact)
    : null;
  const locationDecisionApplyContext = locationDecisionApplyArtifact
    ? readLocationDecisionApplyContext(repoRoot, locationDecisionApplyArtifact)
    : null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    repoRoot,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    repoRoot,
    options.unresolvedExchangeExternalizationReport,
  );
  const unresolvedExchangeExternalizationContext = readUnresolvedExchangeExternalizationContext(
    repoRoot,
    unresolvedExchangeExternalizationArtifact,
  );
  const canonicalSupportRewriteArtifact = readJsonIfOption(
    repoRoot,
    options.canonicalSupportRewriteReport || options.canonicalSupportRewritesReport,
  );
  const canonicalSupportRewriteContext = readCanonicalSupportRewriteContext(
    repoRoot,
    canonicalSupportRewriteArtifact,
  );
  const sourceContactRewriteArtifact = readJsonIfOption(
    repoRoot,
    options.sourceContactRewriteReport ?? options.sourceContactRewritesReport,
  );
  const sourceContactRewriteContext = readSourceContactRewriteContext(
    repoRoot,
    sourceContactRewriteArtifact,
  );
  const cleanupContext = readCleanupTransformContext(repoRoot, cleanupArtifact);
  const hasClassificationDecisionProof =
    classificationDecisionApplyContext?.status === "completed" &&
    classificationDecisionApplyContext.decisions.length > 0;
  const hasLocationDecisionProof =
    locationDecisionApplyContext?.status === "completed" &&
    locationDecisionApplyContext.decisions.length > 0;
  const hasIdentityDecisionProof =
    identityDecisionApplyContext?.status === "completed" &&
    identityDecisionApplyContext.decisions.length > 0;
  const requirePatchCollectReport =
    options.requirePatchCollectReport === true ||
    options.requirePatchCollectReport === "true" ||
    (Boolean(fullContextRequirement) &&
      !hasClassificationDecisionProof &&
      !hasLocationDecisionProof &&
      !hasIdentityDecisionProof);

  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to JSON/JSONL write-candidate rows.");
  }
  if (!schemaReportArtifact) {
    throw new Error("--schema-report is required for mutation manifest generation.");
  }

  const rows = readRows(rowsFile);
  const referenceRows = readRowsIfExists(referenceRowsFile);
  const schemaRows = mapSchemaRows(schemaReportArtifact.value);
  const curationEntities = mapCurationEntities(curationGateArtifact?.value);
  const writeRows = mapRowsByIdentity(rows, datasetType);
  const writeCandidateKeys = new Set(writeRows.keys());
  const sourceReferenceRewriteContext = readSourceReferenceRewriteContext({
    repoRoot,
    rowsFile,
    options,
    writeRows,
  });
  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
    repoRoot,
    rowsFile,
    options,
    writeRows,
    referenceRows,
    datasetType,
  });
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const plannedRootIds = plannedRootReferenceIds(rows, datasetType);
  const remoteVerifyBlockers = remoteVerifyBlockerKeys(remoteVerifyArtifact?.value, {
    plannedRootKeys,
    plannedRootIds,
  });
  const patchApplyContext =
    patchApplyArtifact || patchEvidenceFile
      ? readPatchApplyContext(repoRoot, patchApplyArtifact, patchEvidenceFile)
      : null;
  const evidenceScopeBlockers = buildEvidenceScopeBlockers({
    repoRoot,
    rowsFile,
    schemaReportArtifact,
    curationGateArtifact,
    dryRunReportArtifact,
    cleanupArtifact,
    patchApplyArtifact,
    patchApplyContext,
    patchCollectArtifact,
    requirePatchCollectReport,
    remoteVerifyArtifact,
    identityDecisionApplyContext,
    requireCurationGate:
      options.requireCurationGate === undefined
        ? !(datasetType === "support" || supportDatasetTypes.has(datasetType))
        : options.requireCurationGate === true || options.requireCurationGate === "true",
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    canonicalSupportRewriteContext,
  });
  evidenceScopeBlockers.push(
    ...buildFullContextAiCompletionBlockers({
      repoRoot,
      profile,
      datasetType,
      curationGateArtifact,
      rowsFile,
      patchApplyArtifact,
      patchApplyContext,
      patchCollectArtifact,
      cleanupArtifact,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext,
      locationDecisionApplyArtifact,
      locationDecisionApplyContext,
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );
  evidenceScopeBlockers.push(
    ...buildReferenceClosureBlockers({
      repoRoot,
      rows,
      datasetType,
      remoteVerifyArtifact,
      provenReferenceKeys: identityReferenceRewriteProofKeys(identityReferenceRewriteContext),
      unresolvedReferenceKeys: identityDecisionUnresolvedReferenceKeys(
        identityDecisionApplyContext,
      ),
    }),
  );
  if (
    dryRunReportArtifact?.value?.mode === "commit" ||
    dryRunReportArtifact?.value?.commit === true
  ) {
    evidenceScopeBlockers.push(
      evidenceScopeBlocker({
        code: "dry_run_report_is_commit_report",
        stage: "dry_run",
        message:
          "dataset-mutation-manifest --dry-run-report must point to a dry-run summary, not a commit summary. Keep commit reports as post-write evidence alongside dataset verify-remote.",
        report: dryRunReportArtifact.path,
      }),
    );
  }
  const dryRun = {
    flow:
      datasetType === "flow" && dryRunReportArtifact
        ? readFlowDryRunArtifacts(repoRoot, dryRunReportArtifact.value)
        : null,
    process:
      datasetType === "process" && dryRunReportArtifact
        ? readProcessDryRunArtifacts(repoRoot, dryRunReportArtifact.value)
        : null,
    lifecyclemodel:
      datasetType === "lifecyclemodel" && dryRunReportArtifact
        ? readLifecyclemodelDryRunArtifacts(repoRoot, dryRunReportArtifact.value)
        : null,
    datasetSaveDraft:
      (datasetType === "support" || supportDatasetTypes.has(datasetType)) && dryRunReportArtifact
        ? readDatasetSaveDraftDryRunArtifacts(repoRoot, dryRunReportArtifact.value)
        : null,
  };

  const writeEntries = [...writeRows.values()];
  for (const entry of writeEntries) {
    entry.identity.sourceRowsFile = repoRelativePath(repoRoot, rowsFile);
  }

  const writeItems = writeEntries.map(({ row, identity, index }) => {
    const itemDatasetType = identity.dataset_type || datasetType;
    const key = identityKey(identity);
    return buildWriteCandidateItem({
      repoRoot,
      datasetType: itemDatasetType,
      row,
      identity,
      rowIndex: index,
      schemaRow: schemaRows.get(key) ?? schemaRows.get(identity.id) ?? null,
      curationEntity: curationEntities.get(key) ?? curationEntities.get(identity.id) ?? null,
      curationGateProvided: Boolean(curationGateArtifact),
      dryRun,
      remoteVerifyBlockers,
      targetUserId,
      cleanupStatus: cleanupArtifact?.value?.status ?? "not_provided",
      patchApplyContext,
      sourceReferenceRewritesByKey: sourceReferenceRewriteContext.byIdentity,
      identityReferenceRewritesByKey: identityReferenceRewriteContext.byIdentity,
      identityDecisionApplyContext,
      cleanupContext,
      evidenceScopeBlockers,
    });
  });
  const referenceItems = buildReferenceReuseItems({
    repoRoot,
    datasetType,
    rows: referenceRows,
    writeCandidateKeys,
    identityReferenceRewritesByKey: identityReferenceRewriteContext.byIdentity,
  });
  const items = [...writeItems, ...referenceItems];
  const unresolvedTraceItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.unresolved_traces),
  );
  const unresolvedExchangeTraceItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.unresolved_exchange_traces),
  );
  const sourceExchangeCompletenessItems = items.flatMap((item) =>
    ensureArray(item?.foundry_traces?.source_exchange_completeness),
  );
  const blockerCount = items.reduce((total, item) => total + item.blockers.length, 0);
  const cleanupStatus = cleanupArtifact?.value?.status ?? "not_provided";
  const remoteVerifyStatus = remoteVerifyArtifact?.value?.status ?? "not_provided";
  const status =
    blockerCount > 0
      ? "blocked"
      : writeItems.length > 0
        ? "ready_for_remote_write"
        : "ready_reference_only";
  const readyWriteRows =
    status === "ready_for_remote_write"
      ? writeEntries
          .filter((entry, index) => {
            const item = writeItems[index];
            return item?.decision === "write_or_update" && item.blockers.length === 0;
          })
          .map((entry) => entry.row)
      : [];
  const blockedWriteRows = writeEntries
    .filter((entry, index) => writeItems[index]?.blockers.length > 0)
    .map((entry) => entry.row);
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    reference_rows_file:
      referenceRowsFile && fileExists(referenceRowsFile)
        ? repoRelativePath(repoRoot, referenceRowsFile)
        : null,
    target_user_id: targetUserId || null,
    policy_snapshots: readPolicySnapshots(repoRoot, profile),
    evidence: {
      schema_report: repoRelativePath(repoRoot, schemaReportArtifact.path),
      curation_gate_report: curationGateArtifact
        ? repoRelativePath(repoRoot, curationGateArtifact.path)
        : null,
      cleanup_report: cleanupArtifact ? repoRelativePath(repoRoot, cleanupArtifact.path) : null,
      cleanup_status: cleanupStatus,
      patch_apply_report: patchApplyArtifact
        ? repoRelativePath(repoRoot, patchApplyArtifact.path)
        : null,
      patch_apply_status: patchApplyContext?.status ?? "not_provided",
      patch_collect_report: patchCollectArtifact
        ? repoRelativePath(repoRoot, patchCollectArtifact.path)
        : null,
      patch_collect_status: patchCollectArtifact?.value?.status ?? "not_provided",
      patch_collect_required: requirePatchCollectReport,
      patch_evidence_file: patchApplyContext?.evidenceFile
        ? repoRelativePath(repoRoot, patchApplyContext.evidenceFile)
        : null,
      patch_evidence_count: patchApplyContext?.evidenceRows.length ?? 0,
      classification_decision_apply_report: classificationDecisionApplyArtifact
        ? repoRelativePath(repoRoot, classificationDecisionApplyArtifact.path)
        : null,
      classification_decision_apply_status:
        classificationDecisionApplyContext?.status ?? "not_provided",
      classification_decision_count: classificationDecisionApplyContext?.decisions.length ?? 0,
      classification_decision_task:
        classificationDecisionApplyContext?.decisionTaskProof?.path ?? null,
      classification_decision_tasks:
        classificationDecisionApplyContext?.decisionTaskProofs?.map((proof) => proof.path) ?? [],
      classification_decision_context_bundle_sha256:
        classificationDecisionApplyContext?.decisionTaskProof?.context_bundle_sha256 ?? null,
      classification_decision_context_bundle_sha256s: decisionTaskContextBundleHashesFromContext(
        classificationDecisionApplyContext,
      ),
      location_decision_apply_report: locationDecisionApplyArtifact
        ? repoRelativePath(repoRoot, locationDecisionApplyArtifact.path)
        : null,
      location_decision_apply_status: locationDecisionApplyContext?.status ?? "not_provided",
      location_decision_count: locationDecisionApplyContext?.decisions.length ?? 0,
      location_decision_task: locationDecisionApplyContext?.decisionTaskProof?.path ?? null,
      location_decision_tasks:
        locationDecisionApplyContext?.decisionTaskProofs?.map((proof) => proof.path) ?? [],
      location_decision_context_bundle_sha256:
        locationDecisionApplyContext?.decisionTaskProof?.context_bundle_sha256 ?? null,
      location_decision_context_bundle_sha256s: decisionTaskContextBundleHashesFromContext(
        locationDecisionApplyContext,
      ),
      identity_decision_apply_report: identityDecisionApplyArtifact
        ? repoRelativePath(repoRoot, identityDecisionApplyArtifact.path)
        : null,
      identity_decision_apply_reports: identityDecisionApplyArtifacts.map((artifact) =>
        repoRelativePath(repoRoot, artifact.path),
      ),
      identity_decision_apply_status: identityDecisionApplyContext?.status ?? "not_provided",
      identity_decision_count: identityDecisionApplyContext?.decisions.length ?? 0,
      identity_decision_authoring_packages:
        identityDecisionApplyContext?.authoringPackageProofs.map((proof) => proof.path) ?? [],
      dry_run_report: dryRunReportArtifact
        ? repoRelativePath(repoRoot, dryRunReportArtifact.path)
        : null,
      remote_verify_report: remoteVerifyArtifact
        ? repoRelativePath(repoRoot, remoteVerifyArtifact.path)
        : null,
      remote_verify_status: remoteVerifyStatus,
      canonical_support_rewrite_report: canonicalSupportRewriteContext?.reportPathRelative ?? null,
      canonical_support_rewrite_status: canonicalSupportRewriteContext?.status ?? "not_provided",
      canonical_support_rewrite_input_rows:
        canonicalSupportRewriteContext?.inputRowsFileRelative ?? null,
      canonical_support_rewrite_output_rows:
        canonicalSupportRewriteContext?.outputRowsFileRelative ?? null,
      canonical_support_rewrite_deferred_rows:
        canonicalSupportRewriteContext?.deferredRowsFileRelative ?? null,
      canonical_support_rewrite_input_row_count:
        canonicalSupportRewriteContext?.counts?.input_rows ?? null,
      canonical_support_rewrite_output_row_count:
        canonicalSupportRewriteContext?.counts?.output_rows ?? null,
      canonical_support_rewrite_deferred_row_count:
        canonicalSupportRewriteContext?.counts?.deferred_rows ?? 0,
      canonical_support_rewrite_blockers: canonicalSupportRewriteContext?.blockers.length ?? 0,
      canonical_support_rewrite_deferred_blockers:
        canonicalSupportRewriteContext?.deferredBlockers.length ?? 0,
      unresolved_exchange_externalization_report:
        unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
      unresolved_exchange_externalization_status:
        unresolvedExchangeExternalizationContext?.status ?? "not_provided",
      unresolved_exchange_externalized_count:
        unresolvedExchangeExternalizationContext?.externalizedExchanges ?? 0,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFileRelative ?? null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFileRelative ?? null,
      unresolved_exchange_externalization_traces_file:
        unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
      source_reference_rewrites_file:
        sourceReferenceRewriteContext.sourceFile &&
        sourceReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(repoRoot, sourceReferenceRewriteContext.sourceFile)
          : null,
      identity_reference_rewrites_file:
        identityReferenceRewriteContext.sourceFile &&
        identityReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile)
          : null,
      full_context_ai_completion_required: Boolean(fullContextRequirement),
      full_context_ai_completion_proof: fullContextRequirement?.proof ?? null,
      scope_blockers: evidenceScopeBlockers,
    },
    counts: {
      write_candidates: readyWriteRows.length,
      planned_write_candidates: writeItems.length,
      blocked_write_candidates: blockedWriteRows.length,
      reference_reuse: referenceItems.filter((item) => item.decision === "reuse_existing_reference")
        .length,
      covered_by_write_candidate: referenceItems.filter(
        (item) => item.decision === "covered_by_write_candidate",
      ).length,
      blocked_items: items.filter((item) => item.blockers.length > 0).length,
      blockers: blockerCount,
      decisions: decisionCounts(items),
      operations: operationCounts(items),
      ai_patch_evidence_entries: writeItems.reduce(
        (total, item) => total + item.ai_patch_evidence_count,
        0,
      ),
      ai_classification_decision_entries: classificationDecisionApplyContext?.decisions.length ?? 0,
      ai_location_decision_entries: locationDecisionApplyContext?.decisions.length ?? 0,
      ai_identity_decision_entries: identityDecisionApplyContext?.decisions.length ?? 0,
      unresolved_trace_entries: unresolvedTraceItems.length,
      unresolved_exchange_trace_entries: unresolvedExchangeTraceItems.length,
      source_exchange_completeness_entries: sourceExchangeCompletenessItems.length,
      source_reference_rewrites: sourceReferenceRewriteContext.scopedRows.length,
      identity_reference_rewrites: identityReferenceRewriteContext.scopedRows.length,
      identity_reference_reuse_rows: referenceItems.filter(
        (item) => item.identity_reference_rewrite_count > 0,
      ).length,
      unresolved_exchange_externalized:
        unresolvedExchangeExternalizationContext?.externalizedExchanges ?? 0,
    },
    items,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "dataset-mutation-manifest.json");
  const itemsPath = path.join(outDir, "dataset-mutation-manifest-items.jsonl");
  const writeRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.write-candidates.jsonl`,
  );
  const blockedWriteRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.blocked-write-candidates.jsonl`,
  );
  const referenceRowsPath = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.reference-reuse.jsonl`,
  );
  const unresolvedTracesPath = path.join(outDir, "unresolved-traces.jsonl");
  const unresolvedExchangeTracesPath = path.join(outDir, "unresolved-exchange-traces.jsonl");
  const sourceExchangeCompletenessPath = path.join(
    outDir,
    "source-exchange-completeness-traces.jsonl",
  );
  const sourceReferenceRewritesPath = path.join(outDir, "source-reference-rewrites.jsonl");
  const identityReferenceRewritesPath = path.join(outDir, "identity-reference-rewrites.jsonl");
  const files = {
    report: repoRelativePath(repoRoot, reportPath),
    items: repoRelativePath(repoRoot, itemsPath),
    write_candidates: repoRelativePath(repoRoot, writeRowsPath),
    blocked_write_candidates: repoRelativePath(repoRoot, blockedWriteRowsPath),
    reference_reuse: repoRelativePath(repoRoot, referenceRowsPath),
    unresolved_traces: repoRelativePath(repoRoot, unresolvedTracesPath),
    unresolved_exchange_traces: repoRelativePath(repoRoot, unresolvedExchangeTracesPath),
    source_exchange_completeness_traces: repoRelativePath(repoRoot, sourceExchangeCompletenessPath),
    source_reference_rewrites: repoRelativePath(repoRoot, sourceReferenceRewritesPath),
    identity_reference_rewrites: repoRelativePath(repoRoot, identityReferenceRewritesPath),
    unresolved_exchange_externalization_report:
      unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
    unresolved_exchange_traces:
      unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
  };
  writeJson(reportPath, { ...report, files });
  writeText(itemsPath, jsonLines(items));
  writeText(writeRowsPath, jsonLines(readyWriteRows));
  writeText(blockedWriteRowsPath, jsonLines(blockedWriteRows));
  writeText(referenceRowsPath, jsonLines(referenceRows));
  writeText(unresolvedTracesPath, jsonLines(unresolvedTraceItems));
  writeText(unresolvedExchangeTracesPath, jsonLines(unresolvedExchangeTraceItems));
  writeText(sourceExchangeCompletenessPath, jsonLines(sourceExchangeCompletenessItems));
  writeText(sourceReferenceRewritesPath, jsonLines(sourceReferenceRewriteContext.scopedRows));
  writeText(identityReferenceRewritesPath, jsonLines(identityReferenceRewriteContext.scopedRows));
  return {
    ...report,
    files,
  };
}
