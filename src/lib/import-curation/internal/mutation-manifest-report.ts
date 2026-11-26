import fs from "node:fs";
import path from "node:path";
import { type FullContextAiCompletion } from "./context-inputs.ts";
import { identityKey } from "./dataset-payload.ts";
import { datasetTypePlural, type DatasetType } from "./dataset-types.ts";
import { type NormalizedProfile } from "./profiles-config.ts";
import {
  asText,
  ensureArray,
  fileExists,
  nowIso,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
} from "./runtime-io.ts";
import {
  type JsonRecord,
  type MutationManifestItem,
  type WriteIdentity,
} from "./workflow-context-types.ts";
import { type ClassificationDecisionApplyContext } from "./workflow-decision-apply-context.ts";
import { decisionTaskContextBundleHashesFromContext } from "./workflow-decision-full-context.ts";
import {
  type IdentityDecisionApplyContext,
  type IdentityReferenceRewriteContext,
} from "./workflow-identity-decision-context.ts";
import { type PatchApplyContext, readPolicySnapshots } from "./workflow-patch-evidence-context.ts";
import { decisionCounts, operationCounts, referenceKey } from "./workflow-reference-closure.ts";
import {
  type CanonicalSupportRewriteContext,
  type UnresolvedExchangeExternalizationContext,
} from "./workflow-row-transform-context.ts";
import { type SourceReferenceRewriteContext } from "./workflow-source-reference-context.ts";

export interface ArtifactEnvelope {
  path: string;
  value: JsonRecord;
}

export interface MutationManifestOptions extends JsonRecord {
  help?: unknown;
  type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
  rowsFile?: string | null;
  input?: string | null;
  referenceRowsFile?: string | null;
  referenceRows?: string | null;
  reuseRowsFile?: string | null;
  schemaReport?: string | null;
  curationGateReport?: string | null;
  dryRunReport?: string | null;
  remoteVerifyReport?: string | null;
  cleanupReport?: string | null;
  patchApplyReport?: string | null;
  patchCollectReport?: string | null;
  authoringPatchCollectReport?: string | null;
  classificationDecisionApplyReport?: string | null;
  classificationDecisionsApplyReport?: string | null;
  locationDecisionApplyReport?: string | null;
  locationDecisionsApplyReport?: string | null;
  patchEvidenceFile?: string | null;
  patchEvidence?: string | null;
  outDir?: string | null;
  targetUserId?: string | null;
  targetOwnerId?: string | null;
  profile?: unknown;
  unresolvedExchangeExternalizationReport?: string | null;
  canonicalSupportRewriteReport?: string | null;
  canonicalSupportRewritesReport?: string | null;
  sourceContactRewriteReport?: string | null;
  sourceContactRewritesReport?: string | null;
  requirePatchCollectReport?: boolean | string;
  requireCurationGate?: boolean | string;
  verifiedReferenceLedger?: unknown;
  verifiedReferenceLedgers?: unknown;
  verifiedReferenceLedgerFile?: unknown;
  verifiedReferenceLedgerFiles?: unknown;
  verifiedFlowLedger?: unknown;
  verifiedFlowLedgers?: unknown;
}

export interface MutationManifestArgs {
  repoRoot?: string;
  options?: MutationManifestOptions;
}

export interface VerifiedReferenceProof {
  files: string[];
  rows: number;
  proven_keys: number;
  keys: Set<string>;
}

export interface MutationWriteEntry {
  row: unknown;
  identity: WriteIdentity;
  index: number;
}

export interface WriteMutationManifestReportInput {
  root: string;
  outDir: string;
  datasetType: DatasetType;
  rowsFile: string;
  referenceRowsFile: string | null;
  referenceRows: unknown[];
  targetUserId: string;
  profile: NormalizedProfile;
  fullContextRequirement: FullContextAiCompletion | null;
  schemaReportArtifact: ArtifactEnvelope;
  curationGateArtifact: ArtifactEnvelope | null;
  curationEntities: Map<string, JsonRecord>;
  dryRunReportArtifact: ArtifactEnvelope | null;
  remoteVerifyArtifact: ArtifactEnvelope | null;
  cleanupArtifact: ArtifactEnvelope | null;
  patchApplyArtifact: ArtifactEnvelope | null;
  patchApplyContext: PatchApplyContext | null;
  patchCollectArtifact: ArtifactEnvelope | null;
  requirePatchCollectReport: boolean;
  classificationDecisionApplyArtifact: ArtifactEnvelope | null;
  classificationDecisionApplyContext: ClassificationDecisionApplyContext | null;
  locationDecisionApplyArtifact: ArtifactEnvelope | null;
  locationDecisionApplyContext: ClassificationDecisionApplyContext | null;
  identityDecisionApplyArtifact: ArtifactEnvelope | null;
  identityDecisionApplyArtifacts: ArtifactEnvelope[];
  identityDecisionApplyContext: IdentityDecisionApplyContext | null;
  canonicalSupportRewriteContext: CanonicalSupportRewriteContext | null;
  unresolvedExchangeExternalizationContext: UnresolvedExchangeExternalizationContext | null;
  sourceReferenceRewriteContext: SourceReferenceRewriteContext;
  identityReferenceRewriteContext: IdentityReferenceRewriteContext;
  verifiedReferenceProof: VerifiedReferenceProof;
  sourceContactRewriteSemanticEvidenceEntries: number;
  evidenceScopeBlockers: JsonRecord[];
  writeEntries: MutationWriteEntry[];
  writeItems: MutationManifestItem[];
  referenceItems: MutationManifestItem[];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function optionList(value: unknown): string[] {
  return ensureArray(value).flatMap((entry) =>
    String(entry ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function readJsonLinesIfExists(filePath: string | null | undefined): JsonRecord[] {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

export function verifiedReferenceLedgerProof(
  repoRoot: string,
  options: MutationManifestOptions,
): VerifiedReferenceProof {
  const ledgerFiles = optionList(
    options.verifiedReferenceLedger ??
      options.verifiedReferenceLedgers ??
      options.verifiedReferenceLedgerFile ??
      options.verifiedReferenceLedgerFiles ??
      options.verifiedFlowLedger ??
      options.verifiedFlowLedgers,
  )
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter((filePath): filePath is string =>
      Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()),
    );
  const keys = new Set<string>();
  let rows = 0;
  for (const filePath of ledgerFiles) {
    for (const row of readJsonLinesIfExists(filePath)) {
      rows += 1;
      const datasetType = asText(
        row.row_dataset_type ?? row.dataset_type ?? row.type ?? row.scope_dataset_type,
      );
      const table = asText(row.table) || (datasetTypePlural as Record<string, string>)[datasetType];
      const id = asText(row.dataset_id ?? row.id ?? row.flow_id ?? row.process_id);
      const version =
        asText(row.version ?? row.dataset_version ?? row.flow_version ?? row.process_version) ||
        "00.00.001";
      if (!table || !id) continue;
      keys.add(referenceKey({ table, id, version }));
    }
  }
  return {
    files: ledgerFiles.map((filePath) => repoRelativePath(repoRoot, filePath)),
    rows,
    proven_keys: keys.size,
    keys,
  };
}

export function writeMutationManifestReport({
  root,
  outDir,
  datasetType,
  rowsFile,
  referenceRowsFile,
  referenceRows,
  targetUserId,
  profile,
  fullContextRequirement,
  schemaReportArtifact,
  curationGateArtifact,
  curationEntities,
  dryRunReportArtifact,
  remoteVerifyArtifact,
  cleanupArtifact,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  requirePatchCollectReport,
  classificationDecisionApplyArtifact,
  classificationDecisionApplyContext,
  locationDecisionApplyArtifact,
  locationDecisionApplyContext,
  identityDecisionApplyArtifact,
  identityDecisionApplyArtifacts,
  identityDecisionApplyContext,
  canonicalSupportRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceReferenceRewriteContext,
  identityReferenceRewriteContext,
  verifiedReferenceProof,
  sourceContactRewriteSemanticEvidenceEntries,
  evidenceScopeBlockers,
  writeEntries,
  writeItems,
  referenceItems,
}: WriteMutationManifestReportInput): JsonRecord {
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
          .filter((_entry, index) => {
            const item = writeItems[index];
            return item?.decision === "write_or_update" && item.blockers.length === 0;
          })
          .map((entry) => entry.row)
      : [];
  const blockedWriteRows = writeEntries
    .filter((_entry, index) => writeItems[index]?.blockers.length > 0)
    .map((entry) => entry.row);
  const usesQaWaivers = writeEntries.some(({ identity }) => {
    const entity = curationEntities.get(identityKey(identity)) ?? curationEntities.get(identity.id);
    return (
      entity?.status === "ready_with_profile_waivers" ||
      Number(entity?.waived_finding_count ?? 0) > 0
    );
  });
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status,
    profile: profile.id,
    profile_rules_sha256: profile.rulesSha256,
    ...(usesQaWaivers
      ? {
          required_qa_waiver_codes: ensureArray(
            asRecord(curationGateArtifact?.value?.policy).waived_qa_codes,
          ),
        }
      : {}),
    dataset_type: datasetType,
    rows_file: repoRelativePath(root, rowsFile),
    reference_rows_file:
      referenceRowsFile && fileExists(referenceRowsFile)
        ? repoRelativePath(root, referenceRowsFile)
        : null,
    target_user_id: targetUserId || null,
    policy_snapshots: readPolicySnapshots(root, profile),
    evidence: {
      schema_report: repoRelativePath(root, schemaReportArtifact.path),
      curation_gate_report: curationGateArtifact
        ? repoRelativePath(root, curationGateArtifact.path)
        : null,
      cleanup_report: cleanupArtifact ? repoRelativePath(root, cleanupArtifact.path) : null,
      cleanup_status: cleanupStatus,
      patch_apply_report: patchApplyArtifact
        ? repoRelativePath(root, patchApplyArtifact.path)
        : null,
      patch_apply_status: patchApplyContext?.status ?? "not_provided",
      patch_collect_report: patchCollectArtifact
        ? repoRelativePath(root, patchCollectArtifact.path)
        : null,
      patch_collect_status: patchCollectArtifact?.value?.status ?? "not_provided",
      patch_collect_required: requirePatchCollectReport,
      patch_evidence_file: patchApplyContext?.evidenceFile
        ? repoRelativePath(root, patchApplyContext.evidenceFile)
        : null,
      patch_evidence_count: patchApplyContext?.evidenceRows.length ?? 0,
      classification_decision_apply_report: classificationDecisionApplyArtifact
        ? repoRelativePath(root, classificationDecisionApplyArtifact.path)
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
        ? repoRelativePath(root, locationDecisionApplyArtifact.path)
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
        ? repoRelativePath(root, identityDecisionApplyArtifact.path)
        : null,
      identity_decision_apply_reports: identityDecisionApplyArtifacts.map((artifact) =>
        repoRelativePath(root, artifact.path),
      ),
      identity_decision_apply_status: identityDecisionApplyContext?.status ?? "not_provided",
      identity_decision_count: identityDecisionApplyContext?.decisions.length ?? 0,
      identity_decision_authoring_packages:
        identityDecisionApplyContext?.authoringPackageProofs.map((proof) => asRecord(proof).path) ??
        [],
      dry_run_report: dryRunReportArtifact
        ? repoRelativePath(root, dryRunReportArtifact.path)
        : null,
      remote_verify_report: remoteVerifyArtifact
        ? repoRelativePath(root, remoteVerifyArtifact.path)
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
          ? repoRelativePath(root, sourceReferenceRewriteContext.sourceFile)
          : null,
      identity_reference_rewrites_file:
        identityReferenceRewriteContext.sourceFile &&
        identityReferenceRewriteContext.sourceRows.length > 0
          ? repoRelativePath(root, identityReferenceRewriteContext.sourceFile)
          : null,
      verified_reference_ledger_files: verifiedReferenceProof.files,
      verified_reference_ledger_rows: verifiedReferenceProof.rows,
      verified_reference_ledger_proven_keys: verifiedReferenceProof.proven_keys,
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
        (total, item) => total + item.ai_patch_evidence_count!,
        0,
      ),
      ai_classification_decision_entries: classificationDecisionApplyContext?.decisions.length ?? 0,
      ai_location_decision_entries: locationDecisionApplyContext?.decisions.length ?? 0,
      ai_identity_decision_entries: identityDecisionApplyContext?.decisions.length ?? 0,
      source_contact_rewrite_semantic_evidence_entries: sourceContactRewriteSemanticEvidenceEntries,
      unresolved_trace_entries: unresolvedTraceItems.length,
      unresolved_exchange_trace_entries: unresolvedExchangeTraceItems.length,
      source_exchange_completeness_entries: sourceExchangeCompletenessItems.length,
      source_reference_rewrites: sourceReferenceRewriteContext.scopedRows.length,
      identity_reference_rewrites: identityReferenceRewriteContext.scopedRows.length,
      verified_reference_ledger_rows: verifiedReferenceProof.rows,
      verified_reference_ledger_proven_keys: verifiedReferenceProof.proven_keys,
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
    report: repoRelativePath(root, reportPath),
    items: repoRelativePath(root, itemsPath),
    write_candidates: repoRelativePath(root, writeRowsPath),
    blocked_write_candidates: repoRelativePath(root, blockedWriteRowsPath),
    reference_reuse: repoRelativePath(root, referenceRowsPath),
    unresolved_traces: repoRelativePath(root, unresolvedTracesPath),
    source_exchange_completeness_traces: repoRelativePath(root, sourceExchangeCompletenessPath),
    source_reference_rewrites: repoRelativePath(root, sourceReferenceRewritesPath),
    identity_reference_rewrites: repoRelativePath(root, identityReferenceRewritesPath),
    unresolved_exchange_externalization_report:
      unresolvedExchangeExternalizationContext?.reportPathRelative ?? null,
    unresolved_exchange_traces:
      unresolvedExchangeExternalizationContext?.tracesFileRelative ?? null,
  };
  // `items` can be enormous for mega-scopes (thousands of flow mutations); embedding
  // it inline here overflows JSON.stringify's max string length (RangeError: Invalid
  // string length) and aborts the finalize stage. It is persisted verbatim to the
  // items JSONL (files.items) and stays on the in-memory return value for in-process
  // consumers, so omit the redundant inline copy from the written report file.
  const { items: _omitInlineItems, ...reportWithoutItems } = report;
  writeJson(reportPath, { ...reportWithoutItems, files });
  // Stream these JSONL writes: mega-scopes (1000+ flow mutations) produce row sets
  // whose JSON.stringify-joined form exceeds V8's max string length, so build them
  // line-by-line on disk instead of as one in-memory string.
  writeJsonLines(itemsPath, items);
  writeJsonLines(writeRowsPath, readyWriteRows);
  writeJsonLines(blockedWriteRowsPath, blockedWriteRows);
  writeJsonLines(referenceRowsPath, referenceRows);
  writeJsonLines(unresolvedTracesPath, unresolvedTraceItems);
  writeJsonLines(unresolvedExchangeTracesPath, unresolvedExchangeTraceItems);
  writeJsonLines(sourceExchangeCompletenessPath, sourceExchangeCompletenessItems);
  writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteContext.scopedRows);
  writeJsonLines(identityReferenceRewritesPath, identityReferenceRewriteContext.scopedRows);
  return {
    ...report,
    files,
  };
}
