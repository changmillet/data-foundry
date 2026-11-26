import { taskAuthorizationWaivesQa } from "../../task-authorization.ts";
import { datasetIdentity, identityKey } from "./dataset-payload.ts";
import {
  datasetTypePlural,
  referenceOnlySupportDatasetTypes,
  supportDatasetTypes,
} from "./dataset-types.ts";
import { externalizeImportTraceMetadata } from "./prewrite-cleanup.ts";
import {
  asText,
  ensureArray,
  fileExists,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import { foundryTraceSummary } from "./trace-summary.ts";
import {
  type DatasetReference,
  type DecisionApplyContextLike,
  type DryRunContexts,
  type IdentityReferenceRewriteContextLike,
  type JsonRecord,
  type MutationManifestItem,
  type PartitionItem,
  type PatchApplyContextLike,
  type ProfileLike,
  type ReferenceParts,
  type RemoteVerifyArtifact,
  type RowsTransformContextLike,
  type WriteIdentity,
} from "./workflow-context-types.ts";
import { normalizeDryRunOperation } from "./workflow-dry-run-context.ts";
import { prewriteIdentityBlockers } from "./workflow-identity-preflight.ts";
import { readJsonLines } from "./workflow-patch-collect.ts";
import {
  hasImportOnlyTrace,
  patchEvidenceForRow,
  tracePatchEvidenceBlockers,
} from "./workflow-patch-evidence-context.ts";
import { jsonPointerToken } from "./workflow-semantic-actions.ts";
export {
  buildFullContextAiCompletionBlockers,
  sourceContactRewriteSemanticEvidenceCount,
  type FullContextBlockerOptions,
  type SourceContactSemanticEvidenceOptions,
} from "./workflow-full-context-blockers.ts";
export type {
  DatasetReference,
  DryRunContexts,
  MapRows,
  MutationManifestItem,
  PartitionItem,
  ReferenceParts,
  RemoteVerifyArtifact,
  WriteIdentity,
} from "./workflow-context-types.ts";

export interface BuildReferenceClosureOptions {
  repoRoot: string;
  rows: unknown[];
  datasetType: string;
  remoteVerifyArtifact?: RemoteVerifyArtifact | null;
  provenReferenceKeys?: Set<string>;
  unresolvedReferenceKeys?: Set<string>;
  allowAccountLocalSupportAndElementary?: boolean;
}

export interface WriteCandidateOptions {
  repoRoot: string;
  datasetType: string;
  row: unknown;
  identity: WriteIdentity;
  rowIndex: number;
  schemaRow?: JsonRecord | null;
  curationEntity?: JsonRecord | null;
  curationWaivedQaCodes?: unknown[];
  curationGateProvided: boolean;
  dryRun: DryRunContexts;
  remoteVerifyBlockers: Set<string>;
  targetUserId: string;
  cleanupStatus: unknown;
  patchApplyContext?: PatchApplyContextLike | null;
  sourceReferenceRewritesByKey?: Map<string, unknown[]> | null;
  identityReferenceRewritesByKey?: Map<string, unknown[]> | null;
  identityDecisionApplyContext?: DecisionApplyContextLike | null;
  cleanupContext?: RowsTransformContextLike | null;
  evidenceScopeBlockers?: JsonRecord[];
  allowAccountLocalSupportAndElementary?: boolean;
  profile?: ProfileLike | null;
}

export interface ReferenceReuseOptions {
  repoRoot: string;
  datasetType: string;
  rows: unknown[];
  writeCandidateKeys: Set<string>;
  identityReferenceRewritesByKey?: Map<string, unknown[]> | null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export const referenceTableByTypeToken: Array<readonly [string, string]> = [
  ["contact", "contacts"],
  ["compliance system", "sources"],
  ["compliancesystem", "sources"],
  ["flow property", "flowproperties"],
  ["flowproperty", "flowproperties"],
  ["flow data", "flows"],
  ["lcia method", "lciamethods"],
  ["lciamethod", "lciamethods"],
  ["life cycle model", "lifecyclemodels"],
  ["lifecycle model", "lifecyclemodels"],
  ["lifecyclemodel", "lifecyclemodels"],
  ["process", "processes"],
  ["source", "sources"],
  ["unit group", "unitgroups"],
  ["unitgroup", "unitgroups"],
];

export const referenceTableByPathToken: Array<readonly [string, string]> = [
  ["flowproperties", "flowproperties"],
  ["flowproperty", "flowproperties"],
  ["flowdataset", "flows"],
  ["lciamethod", "lciamethods"],
  ["lifecyclemodel", "lifecyclemodels"],
  ["datasetformat", "sources"],
  ["compliancesystem", "sources"],
  ["datasource", "sources"],
  ["source", "sources"],
  ["processdataset", "processes"],
  ["unitgroup", "unitgroups"],
  ["commissioner", "contacts"],
  ["personorentity", "contacts"],
  ["ownership", "contacts"],
  ["contact", "contacts"],
];

export function referenceTableFromType(value: unknown): string | null {
  const text = asText(value).toLowerCase();
  if (!text) return null;
  const match = referenceTableByTypeToken.find(([token]) => text.includes(token));
  return match?.[1] ?? null;
}

export function referenceTableFromPath(pathSegments: string[]): string | null {
  const text = pathSegments.join(".").toLowerCase();
  if (!text) return null;
  const compact = text.replace(/[^a-z0-9]/gu, "");
  const match = referenceTableByPathToken.find(([token]) => compact.includes(token));
  return match?.[1] ?? null;
}

export function referenceKey({ table, id, version }: ReferenceParts): string {
  return [asText(table), asText(id), asText(version)].join("\u0000");
}

export function plannedRootReferenceKeys(rows: unknown[], datasetType: string): Set<string> {
  return new Set(
    rows.map((row, index) => {
      const identity = datasetIdentity(row, index, datasetType);
      return referenceKey({
        table: (datasetTypePlural as Record<string, string>)[identity.dataset_type || datasetType],
        id: identity.id,
        version: identity.version,
      });
    }),
  );
}

export function plannedRootReferenceIds(rows: unknown[], datasetType: string): Set<string> {
  return new Set(
    rows.map((row, index) => datasetIdentity(row, index, datasetType).id).filter(Boolean),
  );
}

export function collectDatasetReferences(
  value: unknown,
  pathSegments: string[] = [],
  refs: DatasetReference[] = [],
): DatasetReference[] {
  if (isFoundryTracePathSegments(pathSegments)) return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectDatasetReferences(item, [...pathSegments, String(index)], refs),
    );
    return refs;
  }
  if (!value || typeof value !== "object") return refs;

  const record = asRecord(value);
  const id = asText(
    record["@refObjectId"] ?? record.refObjectId ?? record.ref_object_id ?? record.ref_id,
  );
  if (id) {
    const version = asText(
      record["@version"] ?? record.version ?? record.refVersion ?? record.ref_version,
    );
    const table =
      referenceTableFromType(record["@type"] ?? record.type) ??
      referenceTableFromPath(pathSegments);
    refs.push({
      table,
      id,
      version,
      path: pathSegments.length > 0 ? `/${pathSegments.map(jsonPointerToken).join("/")}` : "/",
      type: asText(record["@type"] ?? record.type) || null,
      short_description:
        asText(asRecord(record["common:shortDescription"])["#text"]) ||
        asText(record.shortDescription) ||
        null,
    });
  }

  for (const [key, child] of Object.entries(record)) {
    collectDatasetReferences(child, [...pathSegments, key], refs);
  }
  return refs;
}

export function isFoundryTracePathSegments(pathSegments: string[]): boolean {
  return (
    pathSegments.includes("common:other") &&
    pathSegments.some(
      (segment) =>
        segment.startsWith("tiangongfoundry:") && segment.toLowerCase().includes("trace"),
    )
  );
}

export function remoteVerifyChecks(
  repoRoot: string,
  remoteVerifyArtifact?: RemoteVerifyArtifact | null,
): JsonRecord[] {
  const value = remoteVerifyArtifact?.value;
  const checks = ensureArray(value?.checks) as JsonRecord[];
  if (checks.length > 0) return checks;
  const checksFile = asRecord(value?.files).checks;
  const checksPath = resolveRepoPath(repoRoot, checksFile as string | null | undefined);
  return checksPath && fileExists(checksPath) ? (readJsonLines(checksPath) as JsonRecord[]) : [];
}

export function remoteVerifiedReferenceKeys(
  repoRoot: string,
  remoteVerifyArtifact?: RemoteVerifyArtifact | null,
  { acceptExactExistingOutdated = false }: { acceptExactExistingOutdated?: boolean } = {},
): Set<string> {
  // `version_outdated` is returned by the CLI remote-verify ONLY when the exact
  // referenced version EXISTS remotely but a newer version is also published
  // (otherwise the status would be `missing_version`). For a *reference* row the
  // referenced dataset existing at that exact version is sufficient proof of the
  // write dependency closure — the "use latest" preference is a publish-quality
  // concern, not a reference-integrity one. Under the BAFU My Data override we
  // accept such references (e.g. account-local FP/UG at state_code=0 referenced
  // at their source version while a 01.00.000 row also exists).
  const acceptableStatuses = acceptExactExistingOutdated
    ? new Set(["ok", "version_outdated"])
    : new Set(["ok"]);
  return new Set(
    remoteVerifyChecks(repoRoot, remoteVerifyArtifact)
      .filter(
        (check) =>
          asText(check?.role) === "reference" &&
          acceptableStatuses.has(asText(check?.status)) &&
          asText(check?.table) &&
          asText(check?.id),
      )
      .map((check) =>
        referenceKey({
          table: check.table,
          id: check.id,
          version: check.version,
        }),
      ),
  );
}

export function identityReferenceRewriteProofKeys(
  context?: IdentityReferenceRewriteContextLike | null,
): Set<string> {
  return new Set(
    ensureArray(context?.scopedRows)
      .map((row) => asRecord(row).canonical)
      .filter(Boolean)
      .map((canonical) => ({
        table: asText(asRecord(canonical).table) || "flows",
        id: asText(
          asRecord(canonical).ref_object_id ??
            asRecord(canonical).refObjectId ??
            asRecord(canonical).id,
        ),
        version:
          asText(
            asRecord(canonical).version ??
              asRecord(canonical)["@version"] ??
              asRecord(canonical).ref_version,
          ) || "00.00.001",
      }))
      .filter((reference) => reference.id)
      .map(referenceKey),
  );
}

export function buildReferenceClosureBlockers({
  repoRoot,
  rows,
  datasetType,
  remoteVerifyArtifact,
  provenReferenceKeys = new Set(),
  unresolvedReferenceKeys = new Set(),
  allowAccountLocalSupportAndElementary = false,
}: BuildReferenceClosureOptions): JsonRecord[] {
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const remoteOkKeys = remoteVerifiedReferenceKeys(repoRoot, remoteVerifyArtifact, {
    acceptExactExistingOutdated: allowAccountLocalSupportAndElementary,
  });
  const blockers: JsonRecord[] = [];
  const seen = new Set();
  rows.forEach((row, rowIndex) => {
    // Supplemental validation documents stay bound to the row envelope, but
    // business closure follows the same payload used by the write candidate.
    const payload = datasetIdentity(row, rowIndex, datasetType).payload;
    for (const ref of collectDatasetReferences(payload)) {
      if (!ref.table) {
        const key = `unsupported\u0000${rowIndex}\u0000${ref.id}\u0000${ref.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blockers.push({
          code: "reference_closure_type_unresolved",
          stage: "reference_closure",
          message:
            "A TIDAS reference could not be mapped to a dataset table, so Foundry cannot prove the write dependency closure.",
          row_index: rowIndex,
          reference_id: ref.id,
          reference_version: ref.version || null,
          reference_type: ref.type,
          path: ref.path,
        });
        continue;
      }
      const key = referenceKey(ref);
      if (
        plannedRootKeys.has(key) ||
        remoteOkKeys.has(key) ||
        provenReferenceKeys.has(key) ||
        unresolvedReferenceKeys.has(key)
      ) {
        continue;
      }
      const seenKey = `${rowIndex}\u0000${key}\u0000${ref.path}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      blockers.push({
        code: remoteVerifyArtifact
          ? "reference_closure_unproven"
          : "reference_closure_remote_verify_required",
        stage: "reference_closure",
        message: remoteVerifyArtifact
          ? "Referenced dataset is neither covered by the exact write scope nor proven reusable by the supplied remote verification report."
          : "Referenced dataset is outside the exact write scope; run remote verification after support rows exist, or include the dependency in an earlier write scope before commit handoff.",
        row_index: rowIndex,
        table: ref.table,
        reference_id: ref.id,
        reference_version: ref.version || null,
        path: ref.path,
      });
    }
  });
  return blockers;
}

export function failureReasons(row: unknown): JsonRecord[] {
  const record = asRecord(row);
  return ensureArray(
    record.reason ?? record.reasons ?? asRecord(record.validation).issues ?? record.issues,
  ).map((value) => {
    const item = asRecord(value);
    return {
      code: item.code ?? "failure",
      stage: item.stage ?? null,
      path: item.path ?? null,
      message: item.message ?? asRecord(item.error).message ?? null,
      validator: item.validator ?? null,
    };
  });
}

export function decisionCounts(items: PartitionItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.decision] = (counts[item.decision] ?? 0) + 1;
  }
  return counts;
}

export function operationCounts(items: PartitionItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (!item.operation) continue;
    counts[item.operation] = (counts[item.operation] ?? 0) + 1;
  }
  return counts;
}

function resolveDryRunCandidateStatus(
  datasetType: string,
  dryRun: DryRunContexts,
  key: string,
  invalidDryRunReport: boolean,
  blockers: JsonRecord[],
): { dryRunStatus: string; operation: unknown; dryRunEvidence: JsonRecord | null } {
  if (invalidDryRunReport) {
    return { dryRunStatus: "invalid_report", operation: null, dryRunEvidence: null };
  }
  const source =
    datasetType === "flow"
      ? {
          success: dryRun.flow?.success?.get(key),
          failure: dryRun.flow?.failures?.get(key),
          operation: (row: JsonRecord) => normalizeDryRunOperation(row.operation),
          failureMessage: "flow publish-version dry-run reported this row as failed.",
        }
      : datasetType === "process" || datasetType === "lifecyclemodel"
        ? {
            success: dryRun[datasetType]?.prepared?.get(key),
            failure: dryRun[datasetType]?.failures?.get(key),
            operation: () => "save_draft_prepared",
            failureMessage: `${datasetType} save-draft dry-run reported this row as failed.`,
          }
        : supportDatasetTypes.has(datasetType) || referenceOnlySupportDatasetTypes.has(datasetType)
          ? {
              // unitgroup/flowproperty are reference-only by default but, under the
              // account-local override (P1a), they are committed through the same
              // dataset save-draft (--type auto) dry-run as contacts/sources.
              success: dryRun.datasetSaveDraft?.prepared?.get(key),
              failure: dryRun.datasetSaveDraft?.failures?.get(key),
              operation: (row: JsonRecord) => normalizeDryRunOperation(row.operation),
              failureMessage: "dataset save-draft dry-run reported this support row as failed.",
            }
          : null;
  if (source?.success) {
    return {
      dryRunStatus: "success",
      operation: source.operation(source.success),
      dryRunEvidence: source.success,
    };
  }
  if (source?.failure) {
    const reasons = failureReasons(source.failure);
    blockers.push({
      code: "dry_run_failed",
      stage: "dry_run",
      message: source.failureMessage,
      reasons,
    });
    return { dryRunStatus: "failure", operation: null, dryRunEvidence: { reasons } };
  }
  blockers.push({
    code: "dry_run_evidence_missing",
    stage: "dry_run",
    message: "No matching dry-run success or failure artifact was found for this row.",
  });
  return { dryRunStatus: "missing", operation: null, dryRunEvidence: null };
}

export function buildWriteCandidateItem({
  repoRoot,
  datasetType,
  row,
  identity,
  rowIndex,
  schemaRow,
  curationEntity,
  curationWaivedQaCodes = [],
  curationGateProvided,
  dryRun,
  remoteVerifyBlockers,
  targetUserId,
  cleanupStatus,
  patchApplyContext,
  sourceReferenceRewritesByKey,
  identityReferenceRewritesByKey,
  identityDecisionApplyContext,
  cleanupContext = null,
  evidenceScopeBlockers = [],
  allowAccountLocalSupportAndElementary = false,
  profile = null,
}: WriteCandidateOptions): MutationManifestItem {
  const key = identityKey(identity);
  const blockers: JsonRecord[] = [];
  blockers.push(...evidenceScopeBlockers);
  const invalidDryRunReport = evidenceScopeBlockers.some(
    (blocker) => blocker?.code === "dry_run_report_is_commit_report",
  );
  const aiPatchEvidence = patchEvidenceForRow(patchApplyContext, identity, rowIndex);
  const sourceReferenceRewrites = sourceReferenceRewritesByKey?.get(key) ?? [];
  const identityReferenceRewrites = identityReferenceRewritesByKey?.get(key) ?? [];
  for (const blocker of patchApplyContext?.globalBlockers ?? []) {
    blockers.push(blocker);
  }
  const schemaStatus = schemaRow?.status ?? "not_found";
  if (schemaStatus !== "valid") {
    blockers.push({
      code: "schema_not_valid",
      stage: "schema",
      message: `Schema status is ${schemaStatus}.`,
      issues: ensureArray(schemaRow?.issues),
    });
  }
  if (referenceOnlySupportDatasetTypes.has(datasetType) && !allowAccountLocalSupportAndElementary) {
    blockers.push({
      code: "reference_only_support_type_write_blocked",
      stage: "support_reference_policy",
      message:
        "Unit Groups and Flow Properties are reference-only support data for Foundry imports. Select existing database rows and rewrite references instead of writing account-local My Data rows.",
    });
  }
  blockers.push(
    ...prewriteIdentityBlockers(identity.payload, datasetType, repoRoot, {
      allowAccountLocalSupportAndElementary,
      profile,
    }),
  );

  const curationStatus = curationEntity?.status ?? null;
  if (
    (curationStatus === "ready_with_profile_waivers" ||
      Number(curationEntity?.waived_finding_count ?? 0) > 0) &&
    (curationWaivedQaCodes.length === 0 ||
      !curationWaivedQaCodes.every((code) =>
        taskAuthorizationWaivesQa(profile?.authorization, datasetType, asText(code)),
      ))
  ) {
    blockers.push({
      code: "task_authorization_qa_waiver_required",
      stage: "foundry_curation",
      message:
        "Retained curation waivers require current task approval for every exact QA code and input scope.",
    });
  }
  if (curationGateProvided && !curationEntity) {
    blockers.push({
      code: "curation_gate_entity_missing",
      stage: "foundry_curation",
      message: "Curation gate report does not contain this write candidate.",
    });
  }
  if (
    curationEntity &&
    !["ready", "ready_with_profile_waivers"].includes(curationStatus as string)
  ) {
    blockers.push({
      code: "curation_gate_not_ready",
      stage: "foundry_curation",
      message: `Curation entity status is ${curationStatus}.`,
      authoring_package: curationEntity.authoring_package ?? null,
    });
  }

  if (remoteVerifyBlockers.has(identity.id)) {
    blockers.push({
      code: "remote_reference_closure_blocked",
      stage: "remote_verify",
      message: "Remote verification reported a blocker involving this entity.",
    });
  }

  if (hasImportOnlyTrace(row)) {
    blockers.push({
      code: "import_only_trace_not_cleaned",
      stage: "prewrite_cleanup",
      message: "Payload still contains tidasimport:sourceTrace or @xmlns:tidasimport.",
    });
  }

  if (!targetUserId) {
    blockers.push({
      code: "target_user_id_required",
      stage: "owner_guard",
      message: "Remote write planning requires an explicit target user id.",
    });
  }

  if (cleanupStatus !== "completed") {
    blockers.push({
      code: "curation_cleanup_required",
      stage: "prewrite_cleanup",
      message:
        "dataset-curation-cleanup must complete for the exact write rows before remote write planning.",
    });
  }

  const { dryRunStatus, operation, dryRunEvidence } = resolveDryRunCandidateStatus(
    datasetType,
    dryRun,
    key,
    invalidDryRunReport,
    blockers,
  );

  const traceSummary = foundryTraceSummary({
    datasetType,
    identity,
    row,
    rowIndex,
  });
  blockers.push(
    ...tracePatchEvidenceBlockers({
      traceSummary,
      aiPatchEvidence,
      identityDecisionApplyContext,
      cleanupContext,
      identity,
      rowIndex,
    }),
  );
  const decision = blockers.length > 0 ? "blocked" : "write_or_update";
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    role: "write_candidate",
    decision,
    operation: operation as string | null,
    target_user_id: targetUserId,
    schema_status: schemaStatus,
    curation_status: curationStatus,
    ai_patch_apply_status: patchApplyContext?.status ?? "not_provided",
    ai_patch_evidence_count: aiPatchEvidence.length,
    ai_patch_evidence: aiPatchEvidence,
    source_reference_rewrite_count: sourceReferenceRewrites.length,
    source_reference_rewrites: sourceReferenceRewrites,
    identity_reference_rewrite_count: identityReferenceRewrites.length,
    identity_reference_rewrites: identityReferenceRewrites,
    dry_run_status: dryRunStatus,
    trace_summary_count: traceSummary.import_trace_summary_count,
    unresolved_trace_count: traceSummary.unresolved_trace_count,
    unresolved_exchange_trace_count: traceSummary.unresolved_exchange_trace_count,
    source_exchange_completeness_count: traceSummary.source_exchange_completeness_count,
    foundry_traces: {
      unresolved_traces: traceSummary.unresolved_traces,
      unresolved_exchange_traces: traceSummary.unresolved_exchange_traces,
      source_exchange_completeness: traceSummary.source_exchange_completeness,
    },
    blockers,
    dry_run_evidence: dryRunEvidence,
    source_rows_file: repoRelativePath(
      repoRoot,
      resolveRepoPath(repoRoot, identity.sourceRowsFile) ?? "",
    ),
  };
}

export function buildReferenceReuseItems({
  repoRoot: _repoRoot,
  datasetType,
  rows,
  writeCandidateKeys,
  identityReferenceRewritesByKey,
}: ReferenceReuseOptions): MutationManifestItem[] {
  return rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const key = identityKey(identity);
    const identityReferenceRewrites =
      identityReferenceRewritesByKey?.get(key) ??
      identityReferenceRewritesByKey?.get(identity.id) ??
      [];
    const traceSummary = foundryTraceSummary({
      datasetType,
      identity,
      row,
      rowIndex: index,
    });
    const alreadyWriteCandidate = writeCandidateKeys.has(key);
    // Reference-reuse rows are never written, but the closure proof still
    // requires their payload snapshot to be free of raw import-only trace.
    // Write-candidate rows get this scrubbing via curation cleanup; reference
    // rows skip it, so a benign converter import trace would otherwise block
    // closure on a row we never write. Externalize it here (after the trace
    // summary is captured for reporting) so the raw tidasimport:* trace becomes
    // the sanctioned Foundry summary breadcrumb instead of a blocker. Matches
    // externalizeImportTraceMetadata's use on the write-candidate path.
    if (hasImportOnlyTrace(row)) {
      externalizeImportTraceMetadata(row);
    }
    const blockers = hasImportOnlyTrace(row)
      ? [
          {
            code: "reference_payload_contains_import_only_trace",
            stage: "prewrite_cleanup",
            message:
              "Reference-only rows are not written, but the payload snapshot still contains import-only trace metadata.",
          },
        ]
      : [];
    return {
      dataset_type: datasetType,
      entity_id: identity.id,
      version: identity.version,
      role: "reference_reuse",
      decision: alreadyWriteCandidate ? "covered_by_write_candidate" : "reuse_existing_reference",
      operation: null,
      target_user_id: null,
      schema_status: "not_required_for_reference_reuse",
      curation_status: "not_required_for_reference_reuse",
      dry_run_status: "not_required_for_reference_reuse",
      identity_reference_rewrite_count: identityReferenceRewrites.length,
      identity_reference_rewrites: identityReferenceRewrites,
      canonical_references: identityReferenceRewrites
        .map((rewrite) => asRecord(rewrite).canonical)
        .filter(Boolean),
      trace_summary_count: traceSummary.import_trace_summary_count,
      unresolved_trace_count: traceSummary.unresolved_trace_count,
      unresolved_exchange_trace_count: traceSummary.unresolved_exchange_trace_count,
      source_exchange_completeness_count: traceSummary.source_exchange_completeness_count,
      foundry_traces: {
        unresolved_traces: traceSummary.unresolved_traces,
        unresolved_exchange_traces: traceSummary.unresolved_exchange_traces,
        source_exchange_completeness: traceSummary.source_exchange_completeness,
      },
      blockers,
    };
  });
}
