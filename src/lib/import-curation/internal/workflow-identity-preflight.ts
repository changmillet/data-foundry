import path from "node:path";
import { validateIdentityPreflightEvidence } from "../../identity-preflight-proof.ts";
import { validateIdentityPreflightRecoveryEvidence } from "../../identity-preflight-recovery-proof.ts";
import { readJsonLinesIfExists, resolveArtifactPath } from "./artifact-inputs.ts";
import { sha256Json } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJsonIfExists,
  readText,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import { type ProfileLike } from "./workflow-context-types.ts";
import {
  type IdentityDecisionApplyContext,
  identityDecisionApplyContextClosesAction,
} from "./workflow-identity-decision-context.ts";
import {
  asRecord,
  attachIdentityPreflightFreshness,
  buildIdentityPreflightAuthoringContext,
  classificationFreshnessAllowance,
  type DatasetIdentity,
  dependencyIdentityPreflightRows,
  dependencyPayloadForFreshness,
  deterministicTransformFreshnessAllowance,
  externalizationFreshnessAllowance,
  type IdentityPreflightAuthoringContext,
  type IdentityPreflightContext,
  identityPreflightFreshness,
  identityPreflightFreshnessAccepted,
  identityPreflightHasSourceContext,
  type IdentityPreflightJsonRecord,
  type IdentityPreflightResult,
  type IdentityPreflightRow,
  identityPreflightRowForIdentity,
  identityPreflightSourceContextRequired,
} from "./workflow-identity-preflight-freshness.ts";
import {
  classificationClassesForPayload,
  classificationDisplayForPayload,
  classificationQueueActionItem,
  classificationQueueRowStillNeedsAuthoring,
  comparableText,
  flowPrewriteIdentityBlockers,
  locationQueueActionItem,
  locationQueueRowStillNeedsAuthoring,
  prewriteContentQualityBlockers,
  prewriteIdentityBlockers,
  processClassificationClassesAreCanonical,
  sourcePrewriteIdentityBlockers,
  textContent,
  valueAtDotPath,
} from "./workflow-prewrite-quality-blockers.ts";
import { identityPreflightIndexPath } from "./workflow-queue-context.ts";
import { flowUsesElementaryClassification } from "./workflow-semantic-actions.ts";

export {
  attachIdentityPreflightFreshness,
  buildIdentityPreflightAuthoringContext,
  classificationClassesForPayload,
  classificationDisplayForPayload,
  classificationFreshnessAllowance,
  classificationQueueActionItem,
  classificationQueueRowStillNeedsAuthoring,
  comparableText,
  dependencyIdentityPreflightRows,
  dependencyPayloadForFreshness,
  deterministicTransformFreshnessAllowance,
  externalizationFreshnessAllowance,
  flowPrewriteIdentityBlockers,
  identityPreflightFreshness,
  identityPreflightFreshnessAccepted,
  identityPreflightHasSourceContext,
  identityPreflightRowForIdentity,
  identityPreflightSourceContextRequired,
  locationQueueActionItem,
  locationQueueRowStillNeedsAuthoring,
  prewriteContentQualityBlockers,
  prewriteIdentityBlockers,
  processClassificationClassesAreCanonical,
  sourcePrewriteIdentityBlockers,
  textContent,
  valueAtDotPath,
};

interface IdentityGateOptions {
  required: boolean;
  context?: IdentityPreflightContext | null;
  authoringContext?: IdentityPreflightAuthoringContext | null;
  datasetType: string;
  identity: DatasetIdentity;
  curationQueueContext?: IdentityPreflightJsonRecord | null;
  profile?: ProfileLike | null;
}

interface AiDecisionActionOptions {
  datasetType: string;
  identity: DatasetIdentity;
  row: unknown;
  relation?: string;
  path?: unknown;
  dependencyType?: string | null;
  dependencyId?: string | null;
  dependencyVersion?: string | null;
}

interface IdentityDecisionActionItem extends IdentityPreflightJsonRecord {
  code: string;
  evidence: IdentityPreflightJsonRecord & { candidate_count: number; top_candidates: unknown[] };
}

interface AuthoringActionOptions {
  required: boolean;
  authoringContext?: IdentityPreflightAuthoringContext | null;
  datasetType: string;
  identity: DatasetIdentity;
  identityDecisionApplyContext?: IdentityDecisionApplyContext | null;
}

export function identityPreflightResultFile(
  repoRoot: string,
  indexPath: string,
  row: unknown,
): string | null {
  const typedRow = asRecord(row);
  const baseDir = path.dirname(indexPath);
  const explicit =
    typedRow.expected_report_file ??
    typedRow.identity_decision_file ??
    typedRow.identityDecisionFile ??
    typedRow.report_file ??
    typedRow.reportFile;
  if (explicit) return resolveArtifactPath(repoRoot, asText(explicit), baseDir);
  const outputDir = asText(typedRow.output_dir ?? typedRow.outputDir);
  if (!outputDir) return null;
  const resolvedOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(baseDir, outputDir);
  const fromIndexBase = path.join(resolvedOutputDir, "outputs", "identity-decision.json");
  if (fileExists(fromIndexBase)) return fromIndexBase;
  return resolveRepoPath(repoRoot, path.join(outputDir, "outputs", "identity-decision.json"));
}

export function readIdentityPreflightIndexRow(
  repoRoot: string,
  indexPath: string,
  row: unknown,
): IdentityPreflightRow | null {
  const typedRow = asRecord(row);
  const baseDir = path.dirname(indexPath);
  const datasetType = asText(typedRow.dataset_type ?? typedRow.type);
  const datasetId = asText(typedRow.dataset_id ?? typedRow.entity_id ?? typedRow.id);
  const datasetVersion = asText(typedRow.dataset_version ?? typedRow.version) || "00.00.001";
  if (!datasetType || !datasetId) return null;
  const requestPath = resolveArtifactPath(repoRoot, asText(typedRow.request_file), baseDir);
  const request = requestPath ? readJsonIfExists<IdentityPreflightJsonRecord>(requestPath) : null;
  const requestText = requestPath && fileExists(requestPath) ? readText(requestPath) : null;
  const resultPath = identityPreflightResultFile(repoRoot, indexPath, row);
  const result = resultPath ? readJsonIfExists<IdentityPreflightResult>(resultPath) : null;
  const resultText = resultPath && fileExists(resultPath) ? readText(resultPath) : null;
  const executionManifestPath =
    resolveArtifactPath(
      repoRoot,
      asText(
        typedRow.recovery_manifest_file ??
          typedRow.execution_manifest_file ??
          typedRow.executionManifestFile,
      ),
      baseDir,
    ) ??
    (resultPath
      ? path.join(path.dirname(resultPath), "foundry-identity-preflight-execution.json")
      : null);
  const executionManifest = executionManifestPath
    ? readJsonIfExists<IdentityPreflightJsonRecord>(executionManifestPath)
    : null;
  const targetSha256 =
    typedRow.target_sha256 ??
    typedRow.targetSha256 ??
    (request ? sha256Json(request.target ?? null) : null);
  const validateEvidence = typedRow.recovery_manifest_file
    ? validateIdentityPreflightRecoveryEvidence
    : validateIdentityPreflightEvidence;
  const executionEvidence = validateEvidence(executionManifest, {
    ...(typedRow.recovery_manifest_file
      ? { expectedRetainedCliContentSha256: asText(typedRow.recovery_cli_content_sha256) }
      : {}),
    requestText,
    reportText: resultText,
    datasetType,
    datasetId,
    datasetVersion,
    targetSha256: asText(targetSha256),
    expectedProjectRef:
      asText(typedRow.expected_project_ref ?? typedRow.expectedProjectRef) || null,
    expectedUserId: asText(typedRow.expected_user_id ?? typedRow.expectedUserId) || null,
  });
  const completedResult = result && executionEvidence.ok ? result : null;
  // Candidate files are convenience exports and are not covered by the bound
  // execution manifest. Downstream semantic evidence comes only from the
  // manifest-bound identity-decision report.
  const rowOutputDir = asText(typedRow.output_dir);
  const resultOutputDir = asText(result?.out_dir);
  const outputDir = rowOutputDir
    ? (resolveArtifactPath(repoRoot, rowOutputDir, baseDir) ??
      resolveRepoPath(repoRoot, rowOutputDir))
    : resultOutputDir || null;
  return {
    dataset_type: datasetType,
    dataset_id: datasetId,
    dataset_version: datasetVersion,
    source_file: typedRow.source_file ?? null,
    request_file: requestPath ? repoRelativePath(repoRoot, requestPath) : null,
    output_dir: outputDir ? repoRelativePath(repoRoot, outputDir) : null,
    command: typedRow.command ?? null,
    remote_search: typedRow.remote_search ?? request?.remote_candidate_search ?? null,
    request: request
      ? {
          schema_version: request.schema_version ?? null,
          remote_candidate_search: request.remote_candidate_search ?? null,
          target_sha256: targetSha256,
        }
      : typedRow.target_sha256 || typedRow.targetSha256
        ? {
            schema_version: null,
            remote_candidate_search: null,
            target_sha256: typedRow.target_sha256 ?? typedRow.targetSha256,
          }
        : null,
    result: completedResult
      ? {
          status: completedResult.status ?? null,
          decision: completedResult.decision ?? null,
          confidence: completedResult.confidence ?? null,
          next_action: completedResult.next_action ?? null,
          target: completedResult.target ?? null,
          candidates: ensureArray(completedResult.candidates),
          candidate_sources: completedResult.candidate_sources ?? null,
          findings: completedResult.findings ?? [],
          blockers: completedResult.blockers ?? [],
          files: completedResult.files ?? null,
        }
      : null,
    execution_evidence: {
      status: executionEvidence.ok ? "verified" : "invalid_or_missing",
      code: executionEvidence.code ?? null,
      manifest_file:
        executionManifestPath && fileExists(executionManifestPath)
          ? repoRelativePath(repoRoot, executionManifestPath)
          : null,
    },
    status: completedResult ? "completed" : "pending_execution",
  };
}

export function readIdentityPreflightContext(
  repoRoot: string,
  options: IdentityPreflightJsonRecord,
  rowsFile: string | null | undefined,
): IdentityPreflightContext | null {
  const indexPath = identityPreflightIndexPath(repoRoot, options, rowsFile);
  if (!indexPath) return null;
  if (!fileExists(indexPath)) {
    throw new Error(`--identity-preflight-index must point to a readable JSONL file: ${indexPath}`);
  }
  const rows = readJsonLinesIfExists(indexPath)
    .map((row) => readIdentityPreflightIndexRow(repoRoot, indexPath, row))
    .filter((row): row is IdentityPreflightRow => row !== null);
  const rowsByIdentity = new Map<string, IdentityPreflightRow>();
  for (const row of rows) {
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    rowsByIdentity.set(key, row);
    if (!rowsByIdentity.has(`${row.dataset_type}:${row.dataset_id}`)) {
      rowsByIdentity.set(`${row.dataset_type}:${row.dataset_id}`, row);
    }
  }
  return {
    indexPath,
    rows,
    rowsByIdentity,
    completed: rows.filter((row) => row.status === "completed").length,
    pending: rows.filter((row) => row.status !== "completed").length,
  };
}

export function identityPreflightGateItems({
  required,
  context,
  authoringContext,
  datasetType,
  identity,
  curationQueueContext,
  profile,
}: IdentityGateOptions): IdentityPreflightJsonRecord[] {
  if (!required || !["flow", "process"].includes(datasetType)) return [];
  const items: IdentityPreflightJsonRecord[] = [];
  const baseInstruction =
    "Run dataset-identity-preflight-run for the generated identity-preflight-requests index before AI authoring, then pass the same index to dataset-curation-gate with --identity-preflight-index.";
  if (!context) {
    return [
      {
        source: "identity_preflight",
        code: "identity_preflight_index_required",
        path: null,
        message:
          "Full-context AI authoring requires read-only database identity-preflight request/result context.",
        action_kind: "identity_preflight_required",
        required_owner: "foundry_identity_preflight_run",
        ai_required: false,
        instruction: baseInstruction,
      },
    ];
  }

  const current = authoringContext?.current ?? null;
  const staleInstruction =
    "Regenerate identity-preflight requests from the exact current rows file, rerun dataset-identity-preflight-run, and pass that same fresh index to the curation gate.";
  const sourceContextInstruction =
    "Regenerate identity-preflight requests from the exact current rows file with dataset-identity-preflight-requests-build --source-index <original-full-identity-preflight-requests.jsonl>, rerun dataset-identity-preflight-run, merge the refreshed current rows back into the original full index, and pass that merged index to the curation gate.";
  const requiresSourceContext = identityPreflightSourceContextRequired({
    profile,
    datasetType,
    curationQueueContext,
    context,
  });
  if (!current) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_result_missing",
      path: null,
      message: "No identity-preflight result is attached for the current entity.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: baseInstruction,
    });
  } else if (current.status !== "completed") {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_result_pending",
      path: null,
      message: `Current entity identity-preflight status is ${current.status}.`,
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: baseInstruction,
    });
  } else if (!identityPreflightFreshnessAccepted(current.freshness)) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_scope_stale",
      path: null,
      message:
        "Current entity identity-preflight result was generated from a different target payload than the rows file currently being curated.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: staleInstruction,
      evidence: current.freshness ?? null,
    });
  } else if (requiresSourceContext && !identityPreflightHasSourceContext(current)) {
    items.push({
      source: "identity_preflight",
      code: "identity_preflight_current_source_context_missing",
      path: null,
      message:
        "Current entity identity-preflight was refreshed without source_file trace context, so hybrid search and AI authoring may lose source-package evidence.",
      action_kind: "identity_preflight_required",
      required_owner: "foundry_identity_preflight_run",
      ai_required: false,
      dataset_type: datasetType,
      dataset_id: identity.id,
      dataset_version: identity.version,
      instruction: sourceContextInstruction,
      evidence: {
        remote_search: current.remote_search ?? null,
        request_file: current.request_file ?? null,
      },
    });
  }

  if (datasetType === "process" && curationQueueContext?.status === "attached") {
    const dependencyPreflightRows = ensureArray(authoringContext?.dependencies).map(
      (dependency) => dependency?.identity_preflight,
    );
    const dependencyRows = ensureArray(curationQueueContext.dependency_rows);
    for (const dependency of dependencyRows) {
      const typedDependency = asRecord(dependency);
      const task = asRecord(typedDependency.task);
      const dependencyType = asText(task.entity_type);
      if (!["flow", "process"].includes(dependencyType)) continue;
      const dependencyIdentity = {
        id: asText(task.entity_id),
        version: asText(task.version) || "00.00.001",
      };
      if (!dependencyIdentity.id) continue;
      const dependencyPreflight = identityPreflightRowForIdentity(
        context,
        dependencyType,
        dependencyIdentity,
      );
      const dependencyPreflightWithFreshness =
        dependencyPreflightRows.find(
          (row) =>
            row?.dataset_type === dependencyType &&
            row?.dataset_id === dependencyIdentity.id &&
            row?.dataset_version === dependencyIdentity.version,
        ) ?? dependencyPreflight;
      if (!dependencyPreflight) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_missing",
          path: typedDependency.ref_path ?? null,
          message: "No identity-preflight result is attached for a referenced dependency entity.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
        continue;
      }
      const evaluatedPreflight = dependencyPreflightWithFreshness ?? dependencyPreflight;
      if (evaluatedPreflight.status !== "completed") {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_result_pending",
          path: typedDependency.ref_path ?? null,
          message: `Referenced dependency identity-preflight status is ${evaluatedPreflight.status}.`,
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: baseInstruction,
        });
      } else if (
        evaluatedPreflight.freshness &&
        !identityPreflightFreshnessAccepted(evaluatedPreflight.freshness)
      ) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_scope_stale",
          path: typedDependency.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight result was generated from a different dependency payload than the current curation queue context.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: staleInstruction,
          evidence: evaluatedPreflight.freshness,
        });
      } else if (requiresSourceContext && !identityPreflightHasSourceContext(evaluatedPreflight)) {
        items.push({
          source: "identity_preflight",
          code: "identity_preflight_dependency_source_context_missing",
          path: typedDependency.ref_path ?? null,
          message:
            "Referenced dependency identity-preflight is missing source_file trace context, so hybrid search and AI authoring may lose source-package evidence.",
          action_kind: "identity_preflight_required",
          required_owner: "foundry_identity_preflight_run",
          ai_required: false,
          dependency_type: dependencyType,
          dependency_id: dependencyIdentity.id,
          dependency_version: dependencyIdentity.version,
          instruction: sourceContextInstruction,
          evidence: {
            remote_search: evaluatedPreflight.remote_search ?? null,
            request_file: evaluatedPreflight.request_file ?? null,
          },
        });
      }
    }
  }
  return items;
}

export function identityPreflightNeedsAiDecision(row: unknown): boolean {
  const result = asRecord(row).result;
  if (!result) return false;
  const typedResult = asRecord(result);
  const status = asText(typedResult.status);
  const decision = asText(typedResult.decision);
  return status === "needs_review" || decision === "manual_review";
}

export function identityPreflightAiDecisionActionItem({
  datasetType,
  identity,
  row,
  relation = "current",
  path = null,
  dependencyType = null,
  dependencyId = null,
  dependencyVersion = null,
}: AiDecisionActionOptions): IdentityDecisionActionItem {
  const typedRow = asRecord(row);
  const result = asRecord(typedRow.result);
  const candidates = ensureArray(result.candidates);
  const resultFlowType = asText(asRecord(asRecord(result.target).fields).type_of_dataset);
  const isElementaryFlow =
    (dependencyType || datasetType) === "flow" &&
    (flowUsesElementaryClassification(identity.payload) || resultFlowType === "Elementary flow");
  return {
    source: "identity_preflight",
    code: isElementaryFlow
      ? "elementary_flow_identity_manual_review"
      : "identity_preflight_manual_review",
    path,
    message: isElementaryFlow
      ? "Elementary flow identity-preflight needs AI review. Elementary flows are reference-only and must select an existing TianGong flow before write planning."
      : "Identity-preflight returned manual_review/needs_review and requires AI to decide whether to reuse an existing database row or continue as a new write candidate.",
    action_kind: "identity_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    dataset_type: datasetType,
    dataset_id: identity.id,
    dataset_version: identity.version,
    relation,
    dependency_type: dependencyType,
    dependency_id: dependencyId,
    dependency_version: dependencyVersion,
    common_other_deferral_allowed: false,
    evidence: {
      identity_preflight_status: result.status ?? null,
      identity_preflight_decision: result.decision ?? null,
      confidence: result.confidence ?? null,
      next_action: result.next_action ?? null,
      candidate_count: candidates.length,
      remote_search: typedRow.remote_search ?? null,
      target: result.target ?? null,
      top_candidates: candidates.slice(0, 10),
    },
    instruction: isElementaryFlow
      ? "Use the full schema/YAML/context package plus flow_hybrid_search candidates to choose the existing TianGong elementary flow reference. Do not create or write a BAFU-owned elementary flow. If no candidate is sufficient, return an unresolved identity blocker with the searched query and candidate evidence."
      : "Use the full schema/YAML/context package plus identity-preflight candidates to decide reuse_existing_reference versus create_new. If reusing, output a structured identity reference rewrite with canonical id/version and evidence. If creating new, include evidence explaining why candidates are not identity-equivalent.",
  };
}

export function identityPreflightAuthoringActionItems({
  required,
  authoringContext,
  datasetType,
  identity,
  identityDecisionApplyContext = null,
}: AuthoringActionOptions): IdentityDecisionActionItem[] {
  if (!required || !authoringContext) return [];
  const items: IdentityDecisionActionItem[] = [];
  const current = authoringContext.current;
  if (identityPreflightNeedsAiDecision(current)) {
    const item = identityPreflightAiDecisionActionItem({
      datasetType,
      identity,
      row: current,
    });
    if (
      !identityDecisionApplyContextClosesAction({
        context: identityDecisionApplyContext,
        datasetType,
        id: current?.dataset_id ?? identity.id,
        version: current?.dataset_version ?? identity.version,
        code: item.code,
      })
    ) {
      items.push(item);
    }
  }
  if (datasetType === "process") {
    for (const dependency of ensureArray(authoringContext.dependencies)) {
      const dependencyPreflight = dependency?.identity_preflight;
      if (!identityPreflightNeedsAiDecision(dependencyPreflight)) continue;
      const item = identityPreflightAiDecisionActionItem({
        datasetType,
        identity,
        row: dependencyPreflight,
        relation: "dependency",
        path: dependency?.ref_path ?? null,
        dependencyType: dependencyPreflight?.dataset_type ?? null,
        dependencyId: dependencyPreflight?.dataset_id ?? null,
        dependencyVersion: dependencyPreflight?.dataset_version ?? null,
      });
      if (
        !identityDecisionApplyContextClosesAction({
          context: identityDecisionApplyContext,
          datasetType: dependencyPreflight?.dataset_type ?? null,
          id: dependencyPreflight?.dataset_id ?? null,
          version: dependencyPreflight?.dataset_version ?? null,
          code: item.code,
        })
      ) {
        items.push(item);
      }
    }
  }
  return items;
}
