import fs from "node:fs";
import path from "node:path";
import { preparationValidationEvidence } from "../../foundry-preparation-cli-validation.ts";
import { type FoundryInputFact } from "../../foundry-runtime-context.ts";
import { qaFindingCode } from "./artifact-inputs.ts";
import {
  contextFileDetails,
  type ContextFile,
  type FullContextAiCompletion,
} from "./context-inputs.ts";
import { datasetTypePlural, type DatasetType } from "./dataset-types.ts";
import { sha256Text } from "./hash-utils.ts";
import { type NormalizedProfile } from "./profiles-config.ts";
import {
  ensureArray,
  jsonLines,
  nowIso,
  readText,
  repoRelativePath,
  sanitizeFileName,
  writeJson,
  writeText,
} from "./runtime-io.ts";
import { type JsonRecord } from "./workflow-context-types.ts";
import {
  type IdentityDecisionApplyContext,
  type IdentityReferenceRewriteContext,
} from "./workflow-identity-decision-context.ts";
import { type UnresolvedExchangeExternalizationContext } from "./workflow-row-transform-context.ts";

export interface CurationGateOptions extends JsonRecord {
  includeExecutionCommands?: boolean;
  help?: unknown;
  type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
  rowsFile?: string | null;
  input?: string | null;
  schemaReport?: string | null;
  qaReport?: string | null;
  outDir?: string | null;
  profile?: unknown;
  contractContext?: string | null;
  contextFile?: string | null;
  schemaFile?: string | null;
  yamlFile?: string | null;
  rulesetFile?: string | null;
  contractFile?: string | null;
  contextDir?: string | null;
  queueDir?: string;
  curationQueueDir?: string;
  requireQueueContext?: boolean | string;
  requireCurationQueueContext?: boolean | string;
  classificationQueue?: string | null;
  classificationQueueFile?: string | null;
  locationQueue?: string | null;
  locationQueueFile?: string | null;
  classificationDecisionApplyReport?: string | null;
  classificationDecisionsApplyReport?: string | null;
  unresolvedExchangeExternalizationReport?: string | null;
  sourceContactRewriteReport?: string | null;
  sourceContactRewritesReport?: string | null;
  canonicalSupportRewriteReport?: string | null;
  canonicalSupportRewritesReport?: string | null;
  cleanupReport?: string | null;
}

export interface CurationGateCliValidation {
  report: string;
  exit: number;
  input?: FoundryInputFact;
}

export interface CurationGateArgs {
  repoRoot?: string;
  options?: CurationGateOptions;
  routeAction?: (action: JsonRecord, datasetType: string, payload: unknown) => JsonRecord;
  requireIdentityPreflight?: boolean;
  cliValidation?: CurationGateCliValidation;
}

export interface CurationGateEntityReport extends JsonRecord {
  dataset_type: string;
  entity_id: string;
  version: string;
  schema_status: unknown;
  schema_issue_count: number;
  qa_finding_count: number;
  waived_finding_count: number;
  action_item_count: number;
  identity_action_item_count: number;
  identity_decision_apply_count: number;
  semantic_action_item_count: number;
  classification_queue_action_item_count: number;
  location_queue_action_item_count: number;
  deterministic_cleanup_count: number;
  blocking_item_count: number;
  authoring_package: string;
  authoring_package_sha256: string;
  authoring_package_context_file_details: unknown;
  status: string;
}

export interface ContextFilesBundle {
  files: ContextFile[];
  missing: unknown[];
}

export interface QueueContextSummary {
  queueDir: string;
  manifestPath: string;
  manifest: {
    status?: unknown;
    counts?: unknown;
  };
}

export interface AuthoringQueueSummary {
  path: string;
  rows: unknown[];
}

export interface IdentityPreflightSummary {
  indexPath: string;
  rows: unknown[];
  completed: number;
  pending: number;
}

export interface QualityReviewSummary {
  receipt_sha256: string;
}

export interface WriteEntityAuthoringPackageInput {
  root: string;
  packageDir: string;
  datasetType: DatasetType;
  rowsFile: string;
  options: CurationGateOptions;
  profile: NormalizedProfile;
  profileContext: ContextFilesBundle;
  contractContext: ContextFilesBundle;
  fullContextRequirement: FullContextAiCompletion | null;
  row: unknown;
  index: number;
  identity: { id: string; version: string; payload: unknown };
  schemaRow: JsonRecord | null;
  schemaIssues: unknown[];
  cliValidation?: CurationGateCliValidation;
  cliValidationRows?: unknown[];
  cliValidationReportSha256?: string;
  entityQaFindings: JsonRecord[];
  reviewedFindings: QualityReviewSummary[];
  waivedFindings: JsonRecord[];
  actionItems: unknown[];
  identityPreflightActionItems: unknown[];
  identityDecisionApplyRows: unknown[];
  semanticActionItems: unknown[];
  classificationQueueActionItems: unknown[];
  locationQueueActionItems: unknown[];
  deterministicCleanupItems: unknown[];
  curationQueueContext: JsonRecord | null;
  identityPreflightAuthoringContext: JsonRecord | null;
  unresolvedExchangeExternalizationContext: UnresolvedExchangeExternalizationContext | null;
  unresolvedExchangeExternalizationRows: unknown[];
  identityReferenceRewriteContext: IdentityReferenceRewriteContext;
  identityReferenceRewrites: unknown[];
  identityDecisionApplyContext: IdentityDecisionApplyContext | null;
  identityDecisionApplyArtifact: { path: string } | null;
  classificationQueueContext: AuthoringQueueSummary | null;
  classificationAuthoringRows: unknown[];
  locationQueueContext: AuthoringQueueSummary | null;
  locationAuthoringRows: unknown[];
}

export interface WriteCurationGateReportInput {
  root: string;
  outDir: string;
  packageDir: string;
  datasetType: DatasetType;
  rowsFile: string;
  schemaReportPath: string;
  qaReportPath: string;
  profile: NormalizedProfile;
  profileContext: ContextFilesBundle;
  contractContext: ContextFilesBundle;
  fullContextRequirement: FullContextAiCompletion | null;
  waivedQaCodes: Set<unknown>;
  cliValidation?: CurationGateCliValidation;
  cliValidationReportSha256?: string;
  qualityReviews: QualityReviewSummary[];
  queueContext: QueueContextSummary | null;
  requireQueueContext: boolean;
  classificationQueueContext: AuthoringQueueSummary | null;
  locationQueueContext: AuthoringQueueSummary | null;
  unresolvedExchangeExternalizationContext: UnresolvedExchangeExternalizationContext | null;
  identityPreflightContext: IdentityPreflightSummary | null;
  identityReferenceRewriteContext: IdentityReferenceRewriteContext;
  identityDecisionApplyContext: IdentityDecisionApplyContext | null;
  identityDecisionApplyArtifact: { path: string } | null;
  entityReports: CurationGateEntityReport[];
}

export function buildQueueGateItems({
  requireQueueContext,
  queueContext,
  curationQueueContext,
}: {
  requireQueueContext: boolean;
  queueContext: unknown;
  curationQueueContext: JsonRecord | null;
}): JsonRecord[] {
  const queueGateItems: JsonRecord[] = [];
  if (requireQueueContext && !queueContext) {
    queueGateItems.push({
      source: "curation_queue",
      code: "curation_queue_context_required",
      path: null,
      message:
        "Full-context prewrite authoring requires curation queue and dependency closure context.",
      action_kind: "queue_rebuild",
      required_owner: "foundry_deterministic_queue_build",
      ai_required: false,
      instruction:
        "Run dataset-curation-queue-build for the exact rows and pass --queue-dir before AI authoring or remote write planning.",
    });
    return queueGateItems;
  }
  if (curationQueueContext?.status === "missing_task") {
    queueGateItems.push({
      source: "curation_queue",
      code: "curation_queue_task_missing",
      path: null,
      message: "No matching curation queue task was found for this entity.",
      action_kind: "queue_rebuild",
      required_owner: "foundry_deterministic_queue_build",
      ai_required: false,
      instruction:
        "Rebuild the curation queue with this entity included before AI authoring or remote write planning.",
    });
  }
  if (curationQueueContext?.queue_status && curationQueueContext.queue_status !== "ready") {
    queueGateItems.push({
      source: "curation_queue",
      code: "curation_queue_not_ready",
      path: null,
      message:
        "The curation queue manifest is not ready, so dependency closure cannot be trusted for AI authoring or remote write planning.",
      action_kind: "queue_rebuild",
      required_owner: "foundry_deterministic_queue_build",
      ai_required: false,
      instruction:
        "Resolve curation queue blockers, rebuild the queue, and rerun the curation gate before AI authoring or remote write planning.",
      evidence: {
        queue_status: curationQueueContext.queue_status,
        queue_counts: curationQueueContext.queue_counts ?? null,
        queue_blockers: curationQueueContext.queue_blockers ?? [],
      },
    });
  }
  const queueClosure = curationQueueContext?.closure as JsonRecord | null | undefined;
  const queueDependencies = queueClosure?.dependencies as JsonRecord | null | undefined;
  const unresolvedQueueRefs = ensureArray(queueDependencies?.unresolved_refs);
  if (unresolvedQueueRefs.length > 0) {
    queueGateItems.push({
      source: "curation_queue",
      code: "curation_queue_dependency_refs_unresolved",
      path: null,
      message:
        "The curation queue closure still has unresolved dependency references for this entity.",
      action_kind: "queue_rebuild",
      required_owner: "foundry_deterministic_queue_build",
      ai_required: false,
      instruction:
        "Provide local dependency rows or declared external references, rebuild the queue, and rerun the curation gate before AI authoring or remote write planning.",
      evidence: {
        unresolved_refs: unresolvedQueueRefs,
      },
    });
  }
  return queueGateItems;
}

export function writeEntityAuthoringPackage({
  root,
  packageDir,
  datasetType,
  rowsFile,
  options,
  profile,
  profileContext,
  contractContext,
  fullContextRequirement,
  row,
  index,
  identity,
  schemaRow,
  schemaIssues,
  cliValidation,
  cliValidationRows,
  cliValidationReportSha256,
  entityQaFindings,
  reviewedFindings,
  waivedFindings,
  actionItems,
  identityPreflightActionItems,
  identityDecisionApplyRows,
  semanticActionItems,
  classificationQueueActionItems,
  locationQueueActionItems,
  deterministicCleanupItems,
  curationQueueContext,
  identityPreflightAuthoringContext,
  unresolvedExchangeExternalizationContext,
  unresolvedExchangeExternalizationRows,
  identityReferenceRewriteContext,
  identityReferenceRewrites,
  identityDecisionApplyContext,
  identityDecisionApplyArtifact,
  classificationQueueContext,
  classificationAuthoringRows,
  locationQueueContext,
  locationAuthoringRows,
}: WriteEntityAuthoringPackageInput): CurationGateEntityReport {
  const blockingItemCount = actionItems.length + deterministicCleanupItems.length;
  const status =
    actionItems.length > 0
      ? "needs_foundry_ai_authoring"
      : deterministicCleanupItems.length > 0
        ? "needs_foundry_deterministic_cleanup"
        : waivedFindings.length > 0
          ? "ready_with_profile_waivers"
          : "ready";
  const packagePath = path.join(
    packageDir,
    `${datasetType}-${sanitizeFileName(identity.id)}.authoring-package.json`,
  );
  const packagePayload: JsonRecord = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    profile: profile.id,
    dataset_type: datasetType,
    entity_id: identity.id,
    version: identity.version,
    authoring_package: repoRelativePath(root, packagePath),
    source_rows_file: repoRelativePath(root, rowsFile),
    profile_context_files: profileContext.files,
    contract_context_files: contractContext.files,
    full_context_ai_completion: fullContextRequirement
      ? {
          required: true,
          proof: fullContextRequirement.proof,
          required_context_kinds: fullContextRequirement.requiredContextKinds,
          required_context_file_patterns: fullContextRequirement.requiredContextFilePatterns,
          context_file_details: contextFileDetails(contractContext.files),
        }
      : {
          required: false,
        },
    missing_context_files: [...profileContext.missing, ...contractContext.missing],
    schema_issues: schemaIssues,
    ...(cliValidationRows
      ? {
          cli_validation: preparationValidationEvidence(
            cliValidationRows[index] as Parameters<typeof preparationValidationEvidence>[0],
            cliValidation!.report,
            cliValidationReportSha256,
          ),
        }
      : {}),
    qa_findings: entityQaFindings,
    ...(reviewedFindings.length ? { reviewed_findings: reviewedFindings } : {}),
    waived_findings: waivedFindings.map((finding) => ({
      ...finding,
      waiver_basis: profile.waiverReasons?.[qaFindingCode(finding)] ?? null,
    })),
    action_items: actionItems,
    deterministic_cleanup_items: deterministicCleanupItems,
    curation_queue_context: curationQueueContext,
    identity_preflight_context: identityPreflightAuthoringContext,
    unresolved_exchange_externalization_context: unresolvedExchangeExternalizationContext
      ? {
          status: unresolvedExchangeExternalizationContext.status,
          report_file: unresolvedExchangeExternalizationContext.reportPathRelative,
          input_rows_file: unresolvedExchangeExternalizationContext.inputRowsFileRelative,
          output_rows_file: unresolvedExchangeExternalizationContext.outputRowsFileRelative,
          traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
          rows: unresolvedExchangeExternalizationRows,
          policy:
            "Completed entries prove Foundry moved unresolved elementary-flow process exchanges into common:other traces before schema validation and remote write planning; they do not create new elementary flows.",
        }
      : {
          status: "not_provided",
        },
    identity_reference_rewrite_context: {
      status:
        identityReferenceRewriteContext.sourceFile && identityReferenceRewrites.length > 0
          ? "attached"
          : identityReferenceRewriteContext.sourceFile
            ? "no_rows_for_entity"
            : "not_provided",
      source_file: identityReferenceRewriteContext.sourceFile
        ? repoRelativePath(root, identityReferenceRewriteContext.sourceFile)
        : null,
      rows: identityReferenceRewrites,
      policy:
        "These rows prove deterministic process reference rewrites to existing database flow identities selected by CLI identity-preflight before validation and write planning.",
    },
    identity_decision_apply_context: {
      status: identityDecisionApplyContext ? identityDecisionApplyContext.status : "not_provided",
      report_file: identityDecisionApplyArtifact
        ? repoRelativePath(root, identityDecisionApplyArtifact.path)
        : null,
      decisions: identityDecisionApplyRows,
      policy:
        "These rows prove AI-authored identity decisions were deterministically applied before write planning. Completed decisions can close identity_preflight_manual_review action items; mutation manifest still verifies full-context evidence before remote write.",
    },
    classification_authoring_context: {
      queue_file: classificationQueueContext
        ? repoRelativePath(root, classificationQueueContext.path)
        : null,
      rows: classificationAuthoringRows,
    },
    location_authoring_context: {
      queue_file: locationQueueContext ? repoRelativePath(root, locationQueueContext.path) : null,
      rows: locationAuthoringRows,
    },
    source_row: row,
    entity_payload: identity.payload,
    output_contract: {
      artifact: `${datasetType}-build-plan.json or structured patch set`,
      apply_owner:
        "tiangong-lca-cli dataset patch apply for structured patches, or type-specific build-plan materialize when a build plan is produced",
      apply_report:
        "dataset-patch-apply-report.json is required when AI output is a structured patch set",
      patch_contract:
        "Structured patch sets must include authoring_package, row_index or dataset_id/version, operation evidence or basis, and closes_action_items for the package action_items they resolve.",
      recommended_apply:
        options.includeExecutionCommands === false
          ? null
          : "node src/dev-cli.ts dataset-patch-apply --input <rows.jsonl> --patch <ai-patches.json> --out <patched.jsonl> --out-dir <apply-dir> --authoring-package-dir <ai-authoring-packages-dir> --require-authoring-package --require-action-item-closure",
      cleanup_owner:
        "Foundry removes or externalizes import-only trace metadata before remote write",
      final_gate_owner: "Foundry profile-aware curation gate",
    },
  };
  if (datasetType === "process") {
    packagePayload.process_id = identity.id;
    packagePayload.process_payload = identity.payload;
    packagePayload.process_qa_findings = entityQaFindings;
  }
  writeJson(packagePath, packagePayload);
  const authoringPackageText = readText(packagePath);
  const authoringPackageContextDetails = contextFileDetails(packagePayload.contract_context_files);
  return {
    dataset_type: datasetType,
    entity_id: identity.id,
    ...(datasetType === "process" ? { process_id: identity.id } : {}),
    version: identity.version,
    schema_status: schemaRow?.status ?? "not_found",
    schema_issue_count: schemaIssues.length,
    qa_finding_count: entityQaFindings.length,
    ...(datasetType === "process" ? { process_qa_finding_count: entityQaFindings.length } : {}),
    waived_finding_count: waivedFindings.length,
    ...(reviewedFindings.length
      ? {
          reviewed_finding_count: reviewedFindings.length,
          quality_review_receipt_sha256: reviewedFindings[0].receipt_sha256,
        }
      : {}),
    action_item_count: actionItems.length,
    identity_action_item_count: identityPreflightActionItems.length,
    identity_decision_apply_count: identityDecisionApplyRows.length,
    semantic_action_item_count: semanticActionItems.length,
    classification_queue_action_item_count: classificationQueueActionItems.length,
    location_queue_action_item_count: locationQueueActionItems.length,
    deterministic_cleanup_count: deterministicCleanupItems.length,
    blocking_item_count: blockingItemCount,
    authoring_package: repoRelativePath(root, packagePath),
    authoring_package_sha256: sha256Text(authoringPackageText),
    authoring_package_context_file_details: authoringPackageContextDetails,
    status,
  };
}

export function writeCurationGateReport({
  root,
  outDir,
  packageDir,
  datasetType,
  rowsFile,
  schemaReportPath,
  qaReportPath,
  profile,
  profileContext,
  contractContext,
  fullContextRequirement,
  waivedQaCodes,
  cliValidation,
  cliValidationReportSha256,
  qualityReviews,
  queueContext,
  requireQueueContext,
  classificationQueueContext,
  locationQueueContext,
  unresolvedExchangeExternalizationContext,
  identityPreflightContext,
  identityReferenceRewriteContext,
  identityDecisionApplyContext,
  identityDecisionApplyArtifact,
  entityReports,
}: WriteCurationGateReportInput): JsonRecord {
  const actionItemCount = entityReports.reduce((total, item) => total + item.action_item_count, 0);
  const semanticActionItemCount = entityReports.reduce(
    (total, item) => total + item.semantic_action_item_count,
    0,
  );
  const identityActionItemCount = entityReports.reduce(
    (total, item) => total + item.identity_action_item_count,
    0,
  );
  const classificationQueueActionItemCount = entityReports.reduce(
    (total, item) => total + item.classification_queue_action_item_count,
    0,
  );
  const locationQueueActionItemCount = entityReports.reduce(
    (total, item) => total + item.location_queue_action_item_count,
    0,
  );
  const deterministicCleanupCount = entityReports.reduce(
    (total, item) => total + item.deterministic_cleanup_count,
    0,
  );
  const blockingItemCount = actionItemCount + deterministicCleanupCount;
  const waiverCount = entityReports.reduce((total, item) => total + item.waived_finding_count, 0);
  const report: JsonRecord = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status:
      actionItemCount > 0
        ? "blocked_needs_foundry_ai_authoring"
        : deterministicCleanupCount > 0
          ? "blocked_needs_foundry_deterministic_cleanup"
          : waiverCount > 0
            ? "ready_with_profile_waivers"
            : "ready",
    profile: profile.id,
    dataset_type: datasetType,
    rows_file: repoRelativePath(root, rowsFile),
    schema_report: repoRelativePath(root, schemaReportPath),
    ...(cliValidation
      ? {
          cli_validation_report: repoRelativePath(root, cliValidation.report),
          cli_validation_report_sha256: cliValidationReportSha256,
        }
      : {}),
    qa_report: repoRelativePath(root, qaReportPath),
    ...(qualityReviews.length
      ? { quality_review_receipt_sha256: qualityReviews[0].receipt_sha256 }
      : {}),
    policy: {
      cli_qa_role: "deterministic_qa_report_only",
      ...(cliValidation
        ? {
            cli_validation_role:
              "Current local save-equivalent schema, authoring, content, multilingual and allocation/reference profile evidence; final authenticated reference eligibility remains separate.",
          }
        : {}),
      foundry_role:
        "profile policy, AI authoring package, deterministic cleanup, waiver, final prewrite decision",
      waived_qa_codes: [...waivedQaCodes],
      required_multilang_english_before_write: true,
      preserve_source_language_variants: true,
    },
    context: {
      profile_files: profileContext.files.map((file) => file.path),
      contract_context_files: contractContext.files.map((file) => file.path),
      contract_context_file_details: contextFileDetails(contractContext.files),
      full_context_ai_completion: fullContextRequirement
        ? {
            required: true,
            proof: fullContextRequirement.proof,
            required_context_kinds: fullContextRequirement.requiredContextKinds,
            required_context_file_patterns: fullContextRequirement.requiredContextFilePatterns,
          }
        : {
            required: false,
          },
      curation_queue: queueContext
        ? {
            queue_dir: repoRelativePath(root, queueContext.queueDir),
            manifest_file: repoRelativePath(root, queueContext.manifestPath),
            status: queueContext.manifest.status ?? null,
            counts: queueContext.manifest.counts ?? null,
          }
        : null,
      require_queue_context: requireQueueContext,
      classification_queue: classificationQueueContext
        ? {
            queue_file: repoRelativePath(root, classificationQueueContext.path),
            rows: classificationQueueContext.rows.length,
          }
        : null,
      location_queue: locationQueueContext
        ? {
            queue_file: repoRelativePath(root, locationQueueContext.path),
            rows: locationQueueContext.rows.length,
          }
        : null,
      unresolved_exchange_externalization: unresolvedExchangeExternalizationContext
        ? {
            status: unresolvedExchangeExternalizationContext.status,
            report_file: unresolvedExchangeExternalizationContext.reportPathRelative,
            input_rows_file: unresolvedExchangeExternalizationContext.inputRowsFileRelative,
            output_rows_file: unresolvedExchangeExternalizationContext.outputRowsFileRelative,
            traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
            externalized_exchanges: unresolvedExchangeExternalizationContext.externalizedExchanges,
            affected_rows: unresolvedExchangeExternalizationContext.affectedRows,
          }
        : null,
      identity_preflight: identityPreflightContext
        ? {
            index_file: repoRelativePath(root, identityPreflightContext.indexPath),
            rows: identityPreflightContext.rows.length,
            completed: identityPreflightContext.completed,
            pending: identityPreflightContext.pending,
          }
        : null,
      identity_reference_rewrites: identityReferenceRewriteContext.sourceFile
        ? {
            source_file: repoRelativePath(root, identityReferenceRewriteContext.sourceFile),
            rows: identityReferenceRewriteContext.sourceRows.length,
            scoped_rows: identityReferenceRewriteContext.scopedRows.length,
          }
        : null,
      identity_decision_apply: identityDecisionApplyContext
        ? {
            report_file: repoRelativePath(root, identityDecisionApplyArtifact!.path),
            status: identityDecisionApplyContext.status,
            decisions: identityDecisionApplyContext.decisions.length,
            authoring_package_proofs: identityDecisionApplyContext.authoringPackageProofs.length,
          }
        : null,
      missing_context_files: [...profileContext.missing, ...contractContext.missing],
    },
    counts: {
      entities: entityReports.length,
      [datasetTypePlural[datasetType]]: entityReports.length,
      action_items: actionItemCount,
      identity_action_items: identityActionItemCount,
      semantic_action_items: semanticActionItemCount,
      classification_queue_action_items: classificationQueueActionItemCount,
      location_queue_action_items: locationQueueActionItemCount,
      deterministic_cleanup_items: deterministicCleanupCount,
      blocking_items: blockingItemCount,
      waivers: waiverCount,
      identity_preflight_rows: identityPreflightContext?.rows.length ?? 0,
      identity_preflight_completed: identityPreflightContext?.completed ?? 0,
      identity_preflight_pending: identityPreflightContext?.pending ?? 0,
      identity_reference_rewrites: identityReferenceRewriteContext.scopedRows.length,
      identity_decisions: identityDecisionApplyContext?.decisions.length ?? 0,
    },
    entities: entityReports,
  };
  if (datasetType === "process") {
    report.processes = entityReports;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const reportFileName = "dataset-curation-gate-report.json";
  const entitiesFileName = `${datasetType}-curation-gate-entities.jsonl`;
  const reportPath = path.join(outDir, reportFileName);
  const jsonlPath = path.join(outDir, entitiesFileName);
  writeJson(reportPath, report);
  writeText(jsonlPath, jsonLines(entityReports));
  return {
    ...report,
    files: {
      report: repoRelativePath(root, reportPath),
      entities: repoRelativePath(root, jsonlPath),
      ...(datasetType === "process" ? { processes: repoRelativePath(root, jsonlPath) } : {}),
      authoring_packages_dir: repoRelativePath(root, packageDir),
    },
  };
}
