import fs from "node:fs";
import path from "node:path";
import { type DatasetType, datasetTypePlural, supportedDatasetTypes } from "./dataset-types.ts";
import { sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  readText,
  repoRelativePath,
  resolveRepoPath,
  sanitizeFileName,
  writeJson,
  writeText,
} from "./runtime-io.ts";
import {
  buildPatchTemplate,
  decisionOnlyActionItems,
  packageContextFileSummary,
  patchAuthoringActionItems,
  relOrNull,
} from "./workflow-authoring-template-helpers.ts";
import {
  attachSharedContextBundleToTask,
  authoringPackageFullContextReadinessBlockers,
  authoringTaskFullContextReadinessBlockers,
  buildSharedAuthoringContextBundle,
  renderAuthoringTaskMarkdown,
  rewriteAuthoringTaskFile,
  shellQuote,
  writeAuthoringTaskBatchManifest,
  type AuthoringTask,
  type JsonRecord,
} from "./workflow-authoring-context-bundle.ts";
import {
  operationFullContextEvidenceBlockers,
  operationHasEvidence,
  operationResolution,
  operationResolutionMode,
  operationTouchesCommonOther,
  operationUsedContextKinds,
  patchPayloadPatchSets,
  patchSetAuthoringPackage,
  patchSetDatasetId,
  patchSetDatasetVersion,
  patchSetOperations,
  taskRequiredContextKinds,
  taskRequiresFullContextEvidence,
} from "./workflow-authoring-patch-validation.ts";
import {
  evidenceEntries,
  evidenceSourceKeys,
  evidenceTraceKeys,
  firstNonEmptyEvidenceValue,
  hasNonEmptyTraceEvidence,
} from "./workflow-evidence-primitives.ts";

interface AuthoringBuildOptions extends JsonRecord {
  includeExecutionCommands?: boolean;
  patchFile?: string;
  patch?: string;
  patchedRows?: string;
  out?: string;
  applyDir?: string;
}

interface BuildAuthoringTaskOptions {
  repoRoot: string;
  packagePath: string;
  outDir: string;
  options?: AuthoringBuildOptions;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function buildDatasetAuthoringTaskFromPackage({
  repoRoot,
  packagePath,
  outDir,
  options = {},
}: BuildAuthoringTaskOptions): AuthoringTask {
  if (!packagePath || !fileExists(packagePath)) {
    throw new Error(
      "--authoring-package is required and must point to a Foundry AI authoring package JSON file.",
    );
  }

  const packagePayload = readJson<JsonRecord>(packagePath);
  const datasetTypeText = asText(packagePayload.dataset_type);
  if (!supportedDatasetTypes.has(datasetTypeText)) {
    throw new Error(
      `Authoring package dataset_type must be one of ${[...supportedDatasetTypes].join(", ")}.`,
    );
  }
  const datasetType = datasetTypeText as DatasetType;
  const entityId = asText(packagePayload.entity_id ?? packagePayload.process_id);
  if (!entityId) {
    throw new Error("Authoring package is missing entity_id.");
  }

  const patchFile = resolveRepoPath(
    repoRoot,
    options.patchFile || options.patch || path.join(outDir, "ai-patches.json"),
  )!;
  const patchTemplateFile = path.join(outDir, "patch-template.json");
  const taskFile = path.join(outDir, "ai-authoring-task.json");
  const markdownFile = path.join(outDir, "ai-authoring-task.md");
  const patchedRowsFile = resolveRepoPath(
    repoRoot,
    options.patchedRows ||
      options.out ||
      path.join(outDir, `${datasetTypePlural[datasetType]}.patched.jsonl`),
  )!;
  const applyDir = resolveRepoPath(repoRoot, options.applyDir || path.join(outDir, "patch-apply"))!;
  const packageDir = path.dirname(packagePath);
  const actionItems = patchAuthoringActionItems(packagePayload);
  const decisionOnlyItems = decisionOnlyActionItems(packagePayload);
  const contextBlockers = authoringPackageFullContextReadinessBlockers({
    repoRoot,
    packagePayload,
    actionItems,
    packagePath,
  });
  const patchTemplate = buildPatchTemplate(packagePayload, packagePath);
  const sourceRowsFile = packagePayload.source_rows_file
    ? repoRelativePath(
        repoRoot,
        resolveRepoPath(repoRoot, asText(packagePayload.source_rows_file))!,
      )
    : null;
  const applyArgs = [
    "node",
    "src/dev-cli.ts",
    "dataset-patch-apply",
    "--input",
    sourceRowsFile ?? "<source-rows.jsonl>",
    "--patch",
    relOrNull(repoRoot, patchFile),
    "--out",
    relOrNull(repoRoot, patchedRowsFile),
    "--out-dir",
    relOrNull(repoRoot, applyDir),
    "--authoring-package-dir",
    relOrNull(repoRoot, packageDir),
    "--require-authoring-package",
    "--require-action-item-closure",
  ];
  const task: AuthoringTask = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      actionItems.length > 0 && contextBlockers.length > 0
        ? "blocked_missing_full_context"
        : actionItems.length > 0
          ? "ready_for_ai_authoring"
          : "ready_no_action_items",
    purpose:
      "Use Codex/skill semantic judgment to turn one Foundry AI authoring package into a strict structured patch. Deterministic CLI apply and validation remain separate gates.",
    entity: {
      dataset_type: datasetType,
      entity_id: entityId,
      version: asText(packagePayload.version) || "00.00.001",
      profile: asText(packagePayload.profile) || null,
    },
    context: {
      source_rows_file: sourceRowsFile,
      authoring_package_sha256: sha256Text(readText(packagePath)),
      profile_context_files: packageContextFileSummary(packagePayload.profile_context_files),
      contract_context_files: packageContextFileSummary(packagePayload.contract_context_files),
      full_context_ai_completion: packagePayload.full_context_ai_completion ?? {
        required: false,
      },
      missing_context_files: ensureArray(packagePayload.missing_context_files),
      curation_queue_status: asRecord(packagePayload.curation_queue_context).status ?? null,
    },
    action_items: actionItems,
    decision_only_action_items: decisionOnlyItems,
    blockers: contextBlockers,
    counts: {
      action_items: actionItems.length,
      decision_only_action_items: decisionOnlyItems.length,
      blockers: contextBlockers.length,
    },
    policy: {
      database_write: "forbidden_in_ai_authoring_task",
      ai_output: "structured_patch_json_only",
      decision_only_action_items:
        "Identity, classification, and location action items are not patchable here; resolve them with the dedicated deterministic decision apply commands.",
      unresolved_trace:
        "If a value cannot be inferred safely and the action item allows deferral, record structured tiangongfoundry:unresolvedTrace under common:other. Mandatory schema fields need evidence-backed values or remain blocked.",
      source_language:
        "Preserve source-language content. For TIDAS-required multilingual fields, add an evidence-backed English variant from full task context before write planning.",
    },
    files: {
      authoring_package: repoRelativePath(repoRoot, packagePath),
      task_json: repoRelativePath(repoRoot, taskFile),
      task_markdown: repoRelativePath(repoRoot, markdownFile),
      patch_template: repoRelativePath(repoRoot, patchTemplateFile),
      output_patch_file: repoRelativePath(repoRoot, patchFile),
      patched_rows: repoRelativePath(repoRoot, patchedRowsFile),
      apply_dir: repoRelativePath(repoRoot, applyDir),
    },
    commands: {
      apply_patch:
        options.includeExecutionCommands === false ? null : applyArgs.map(shellQuote).join(" "),
      validate_after_apply:
        options.includeExecutionCommands === false
          ? null
          : `node src/dev-cli.ts dataset-tidas-validate --type ${datasetType} --rows-file ${shellQuote(repoRelativePath(repoRoot, patchedRowsFile))} --out-dir ${shellQuote(path.join(repoRelativePath(repoRoot, outDir), "dataset-validate"))}`,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(patchTemplateFile, patchTemplate);
  writeJson(taskFile, task);
  writeText(markdownFile, renderAuthoringTaskMarkdown(task));
  return {
    ...task,
    files: task.files,
  };
}

export function shouldBuildAuthoringTaskFromEntity(
  entity: unknown,
  includeReady: boolean,
): boolean {
  const typedEntity = asRecord(entity);
  if (includeReady) return true;
  const actionItemCount = Number(typedEntity.action_item_count ?? typedEntity.actionItemCount ?? 0);
  if (actionItemCount > 0) return true;
  return String(typedEntity.status ?? "").includes("needs_foundry_ai_authoring");
}

export function authoringPackageEntriesFromGate(
  repoRoot: string,
  reportPath: string,
  includeReady: boolean,
): JsonRecord[] {
  const report = readJson<JsonRecord>(reportPath);
  const entities = ensureArray(report.entities ?? report.processes ?? report.flows ?? report.items);
  return entities
    .filter((entity) => shouldBuildAuthoringTaskFromEntity(entity, includeReady))
    .map((entity, index) => {
      const typedEntity = asRecord(entity);
      const packageRef = asText(typedEntity.authoring_package ?? typedEntity.authoringPackage);
      const packagePath = resolveRepoPath(repoRoot, packageRef);
      const datasetType = asText(typedEntity.dataset_type ?? typedEntity.type) || "dataset";
      const entityId =
        asText(typedEntity.entity_id ?? typedEntity.process_id ?? typedEntity.id) ||
        `entity-${index + 1}`;
      return {
        index,
        entity,
        package_ref: packageRef || null,
        package_path: packagePath,
        task_dir_name: `${sanitizeFileName(datasetType)}-${sanitizeFileName(entityId)}`,
      };
    });
}

export {
  attachSharedContextBundleToTask,
  authoringPackageFullContextReadinessBlockers,
  authoringTaskFullContextReadinessBlockers,
  buildSharedAuthoringContextBundle,
  evidenceEntries,
  evidenceSourceKeys,
  evidenceTraceKeys,
  firstNonEmptyEvidenceValue,
  hasNonEmptyTraceEvidence,
  operationFullContextEvidenceBlockers,
  operationHasEvidence,
  operationResolution,
  operationResolutionMode,
  operationTouchesCommonOther,
  operationUsedContextKinds,
  patchPayloadPatchSets,
  patchSetAuthoringPackage,
  patchSetDatasetId,
  patchSetDatasetVersion,
  patchSetOperations,
  renderAuthoringTaskMarkdown,
  rewriteAuthoringTaskFile,
  shellQuote,
  taskRequiredContextKinds,
  taskRequiresFullContextEvidence,
  writeAuthoringTaskBatchManifest,
};
