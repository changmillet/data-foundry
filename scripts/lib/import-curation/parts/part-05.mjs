import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { annualSupplyMissingDataSentinelText, asText, datasetRoot, defaultProfilesFile, ensureArray, fallbackProfiles, fileExists, normalizeFullContextAiCompletion, nowIso, readJson, readJsonIfExists, repoRelativePath, resolveRepoPath, sanitizeFileName, unwrapDatasetPayload, writeJson } from "./part-00.mjs";
import { allowedPatchResolutionModes, sharedContextBundleReadinessBlockers } from "./part-02.mjs";
import { authoringPackageEntriesFromGate, authoringTaskFullContextReadinessBlockers, buildDatasetAuthoringTaskFromPackage, operationFullContextEvidenceBlockers, operationHasEvidence, operationResolution, operationResolutionMode, operationTouchesCommonOther, operationUsedContextKinds, patchPayloadPatchSets, patchSetAuthoringPackage, patchSetDatasetId, patchSetDatasetVersion, patchSetOperations, taskRequiredContextKinds, taskRequiresFullContextEvidence, writeAuthoringTaskBatchManifest } from "./part-03.mjs";
import { containsAiTemplatePlaceholder, operationClosesAnnualSupplyTarget, operationClosureCodes, operationClosureKeys, taskActionItemKeys, taskActionItemsForOperation, taskAuthoringPackageName, validateDeferredCommonOtherTrace, validateFlowClassificationDecisionOperation, validateLocationDecisionOperation, validateProcessClassificationDecisionOperation, validateSourceExchangeCompletenessTrace } from "./part-04.mjs";
import { sha256Text } from "./part-06.mjs";

export function validateCollectedPatchSet({
  repoRoot,
  task,
  patchSet,
  patchSetIndex,
  patchPath,
}) {
  const blockers = [];
  const operations = patchSetOperations(patchSet);
  const entity = task.entity ?? {};
  const datasetId = patchSetDatasetId(patchSet);
  const datasetVersion = patchSetDatasetVersion(patchSet);
  const expectedPackage = taskAuthoringPackageName(repoRoot, task);
  const authoringPackage = patchSetAuthoringPackage(patchSet);
  const patchLocation = repoRelativePath(repoRoot, patchPath);

  if (!operations) {
    blockers.push({
      code: "patch_set_invalid",
      message: "AI patch output must contain patch sets with operations[].",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
    return blockers;
  }
  const nonTestOperations = operations.filter(
    (operation) => asText(operation?.op) !== "test",
  );
  const deferredAnnualSupply = nonTestOperations.some(
    (operation) =>
      operationResolutionMode(operation) === "deferred_to_common_other" &&
      operationClosesAnnualSupplyTarget(operation),
  );
  if (deferredAnnualSupply) {
    blockers.push({
      code: "patch_deferred_annual_supply_not_allowed",
      message:
        "annualSupplyOrProductionVolume is schema-required and must not be deferred to common:other; use Foundry deterministic cleanup to write the searchable 9999 missing-data sentinel when source evidence is missing.",
      sentinel_value: annualSupplyMissingDataSentinelText,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (nonTestOperations.length === 0) {
    blockers.push({
      code: "patch_effective_operation_missing",
      message:
        "Patch set must include at least one non-test operation for AI-authored curation.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (
    !datasetId &&
    patchSet.row_index === undefined &&
    patchSet.rowIndex === undefined
  ) {
    blockers.push({
      code: "patch_target_missing",
      message:
        "Patch set must target a row by dataset_id/id/uuid/entity_id or row_index.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (datasetId && datasetId !== entity.entity_id) {
    blockers.push({
      code: "patch_dataset_id_mismatch",
      message: `Patch dataset id ${datasetId} does not match task entity ${entity.entity_id}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (datasetVersion && datasetVersion !== entity.version) {
    blockers.push({
      code: "patch_dataset_version_mismatch",
      message: `Patch dataset version ${datasetVersion} does not match task version ${entity.version}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }
  if (!authoringPackage) {
    blockers.push({
      code: "patch_authoring_package_missing",
      message: "Patch set must include authoring_package.",
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  } else if (
    expectedPackage &&
    path.basename(authoringPackage) !== expectedPackage
  ) {
    blockers.push({
      code: "patch_authoring_package_mismatch",
      message: `Patch authoring_package ${authoringPackage} does not match ${expectedPackage}.`,
      patch_file: patchLocation,
      patch_set_index: patchSetIndex,
      entity,
    });
  }

  const closed = new Set(nonTestOperations.flatMap(operationClosureKeys));
  for (const required of taskActionItemKeys(task)) {
    const [code, itemPath] = required.split("\u0000");
    const matched = [...closed].some((closure) => {
      const [closedCode, closedPath] = closure.split("\u0000");
      return (
        closedCode === code &&
        (!closedPath || !itemPath || closedPath === itemPath)
      );
    });
    if (!matched) {
      blockers.push({
        code: "patch_action_item_unclosed",
        message: `Patch set does not close required action item ${code}.`,
        path: itemPath || null,
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        entity,
      });
    }
  }

  operations.forEach((operation, operationIndex) => {
    const op = asText(operation?.op);
    const pointer = asText(operation?.path);
    const mode = operationResolutionMode(operation);
    if (!["add", "replace", "remove", "test"].includes(op)) {
      blockers.push({
        code: "patch_operation_invalid",
        message: `Unsupported or missing patch operation: ${op || "(missing)"}.`,
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test") {
      if (!operationResolution(operation)) {
        blockers.push({
          code: "patch_resolution_missing",
          message:
            "Non-test patch operations must include resolution with mode and used_context_kinds.",
          patch_file: patchLocation,
          patch_set_index: patchSetIndex,
          operation_index: operationIndex,
          entity,
        });
      } else {
        if (!allowedPatchResolutionModes.has(mode)) {
          blockers.push({
            code: "patch_resolution_mode_invalid",
            message: `Unsupported patch resolution mode: ${mode || "(missing)"}.`,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        for (const actionItem of taskActionItemsForOperation(task, operation)) {
          const allowedModes = ensureArray(actionItem?.allowed_resolution_modes)
            .map((item) => asText(item))
            .filter(Boolean);
          if (allowedModes.length > 0 && !allowedModes.includes(mode)) {
            blockers.push({
              code: "patch_resolution_mode_not_allowed_for_action_item",
              message: `Patch resolution mode ${mode || "(missing)"} is not allowed for action item ${asText(actionItem.code) || "(unknown)"}.`,
              allowed_resolution_modes: allowedModes,
              action_item_code: asText(actionItem.code) || null,
              action_item_path: asText(actionItem.path) || null,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          }
        }
        const usedKinds = new Set(operationUsedContextKinds(operation));
        for (const requiredKind of taskRequiredContextKinds(task)) {
          if (!usedKinds.has(requiredKind)) {
            blockers.push({
              code: "patch_resolution_context_kind_missing",
              message: `Patch resolution does not declare use of required context kind '${requiredKind}'.`,
              required_kind: requiredKind,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          }
        }
        if (
          ["deferred_to_common_other", "source_trace_verified"].includes(
            mode,
          ) &&
          !operationTouchesCommonOther(operation)
        ) {
          blockers.push({
            code: "patch_resolution_trace_not_in_common_other",
            message:
              "deferred_to_common_other and source_trace_verified resolutions must add or update common:other provenance.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        const traceContractBlockers =
          mode === "deferred_to_common_other"
            ? validateDeferredCommonOtherTrace({
                operation,
                actionItems: taskActionItemsForOperation(task, operation),
              })
            : mode === "source_trace_verified"
              ? validateSourceExchangeCompletenessTrace(operation)
              : [];
        traceContractBlockers.forEach((blocker) => {
          blockers.push({
            ...blocker,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        });
        const closureCodes = operationClosureCodes(operation);
        if (
          closureCodes.some((code) => code.includes("only_output_exchange")) &&
          !["source_trace_verified", "exchange_set_repaired"].includes(mode)
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Only-output exchange action items must be resolved by source_trace_verified or exchange_set_repaired.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("classification")) &&
          mode !== "classification_decision"
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Classification action items must be resolved by classification_decision.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("classification")) &&
          mode === "classification_decision"
        ) {
          validateProcessClassificationDecisionOperation({
            repoRoot,
            task,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
          validateFlowClassificationDecisionOperation({
            repoRoot,
            task,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
        }
        if (
          closureCodes.some((code) => code.includes("location")) &&
          mode !== "location_decision"
        ) {
          blockers.push({
            code: "patch_resolution_mode_mismatch",
            message:
              "Location action items must be resolved by location_decision.",
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        }
        if (
          closureCodes.some((code) => code.includes("location")) &&
          mode === "location_decision"
        ) {
          validateLocationDecisionOperation({
            repoRoot,
            operation,
          }).forEach((blocker) => {
            blockers.push({
              ...blocker,
              patch_file: patchLocation,
              patch_set_index: patchSetIndex,
              operation_index: operationIndex,
              entity,
            });
          });
        }
      }
    }
    if (!pointer.startsWith("/")) {
      blockers.push({
        code: "patch_path_invalid",
        message: "Patch operation path must be a JSON Pointer.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test" && !operationHasEvidence(operation)) {
      blockers.push({
        code: "patch_evidence_missing",
        message:
          "Non-test patch operations need basis or evidence before collect/apply.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
    if (op !== "test") {
      if (
        taskRequiresFullContextEvidence(task) &&
        operationClosureKeys(operation).length === 0
      ) {
        blockers.push({
          code: "patch_action_item_closure_missing_full_context",
          message:
            "Full-context AI patch operations must close at least one authoring action item so mutation-manifest evidence remains fully traceable.",
          patch_file: patchLocation,
          patch_set_index: patchSetIndex,
          operation_index: operationIndex,
          entity,
        });
      }
      operationFullContextEvidenceBlockers({ operation, task }).forEach(
        (blocker) => {
          blockers.push({
            ...blocker,
            patch_file: patchLocation,
            patch_set_index: patchSetIndex,
            operation_index: operationIndex,
            entity,
          });
        },
      );
    }
    if (containsAiTemplatePlaceholder(operation)) {
      blockers.push({
        code: "patch_template_placeholder_unresolved",
        message: "Patch operation still contains an AI template placeholder.",
        patch_file: patchLocation,
        patch_set_index: patchSetIndex,
        operation_index: operationIndex,
        entity,
      });
    }
  });

  return blockers;
}

export function runDatasetAuthoringPatchCollect({
  repoRoot,
  options = {},
} = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-patch-collect",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-patch-collect --task-manifest <authoring-task-manifest.json>",
        "node scripts/foundry.mjs dataset-authoring-patch-collect --task-manifest ./authoring-tasks/authoring-task-manifest.json",
      ],
      purpose:
        "Collect per-task AI patch outputs into one batch patch file and block if any task output is missing or structurally invalid. This command is local-only and never writes the database.",
    };
  }

  const manifestPath = resolveRepoPath(
    repoRoot,
    options.taskManifest ?? options.manifest ?? options.input,
  );
  if (!manifestPath || !fileExists(manifestPath)) {
    throw new Error(
      "--task-manifest is required and must point to authoring-task-manifest.json.",
    );
  }
  const manifest = readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const outDir = resolveRepoPath(repoRoot, options.outDir || manifestDir);
  const batchPatchPath = resolveRepoPath(
    repoRoot,
    options.out ||
      options.patchOut ||
      manifest.batch_patch_contract?.output_patch_file ||
      path.join(outDir, "ai-patches.batch.json"),
  );
  const reportPath = path.join(outDir, "authoring-patch-collect-report.json");
  const requiredTasks = ensureArray(manifest.tasks).filter(
    (task) =>
      task?.status === "ready_for_ai_authoring" ||
      Number(task?.action_item_count ?? 0) > 0,
  );
  const patchSets = [];
  const patchFiles = [];
  const blockers = [];

  if (requiredTasks.length > 0) {
    blockers.push(
      ...sharedContextBundleReadinessBlockers({
        repoRoot,
        sharedContextBundle: manifest?.shared_context_bundle,
        sourceKind: "manifest",
        sourcePath: manifestPath,
      }),
    );
  }

  for (const [taskIndex, task] of requiredTasks.entries()) {
    const taskContextBlockers = authoringTaskFullContextReadinessBlockers({
      repoRoot,
      task,
    });
    if (taskContextBlockers.length > 0) {
      blockers.push(
        ...taskContextBlockers.map((blocker) => ({
          ...blocker,
          task_index: taskIndex,
          entity: task.entity ?? null,
        })),
      );
      continue;
    }
    const patchPath = resolveRepoPath(repoRoot, task?.files?.output_patch_file);
    if (!patchPath || !fileExists(patchPath)) {
      blockers.push({
        code: "ai_patch_missing",
        message: "Expected AI patch file is missing for authoring task.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        expected_patch_file: task?.files?.output_patch_file ?? null,
      });
      continue;
    }
    let rawPatch;
    try {
      rawPatch = readJson(patchPath);
    } catch (error) {
      blockers.push({
        code: "ai_patch_invalid_json",
        message: error instanceof Error ? error.message : String(error),
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    if (asText(rawPatch?.template_status) === "requires_ai_completion") {
      blockers.push({
        code: "ai_patch_template_incomplete",
        message:
          "AI patch file still has template_status=requires_ai_completion.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    const patchStatus = asText(rawPatch?.patch_status ?? rawPatch?.status);
    if (patchStatus !== "completed") {
      blockers.push({
        code: "ai_patch_status_not_completed",
        message:
          "AI patch file must declare patch_status=completed before collect.",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
        patch_status: patchStatus || null,
      });
      continue;
    }
    const taskPatchSets = patchPayloadPatchSets(rawPatch);
    if (taskPatchSets.length === 0) {
      blockers.push({
        code: "ai_patch_no_patch_sets",
        message: "AI patch file must contain a patch set or patch_sets[].",
        task_index: taskIndex,
        entity: task.entity ?? null,
        patch_file: repoRelativePath(repoRoot, patchPath),
      });
      continue;
    }
    for (const [patchSetIndex, patchSet] of taskPatchSets.entries()) {
      blockers.push(
        ...validateCollectedPatchSet({
          repoRoot,
          task,
          patchSet,
          patchSetIndex,
          patchPath,
        }),
      );
    }
    patchSets.push(...taskPatchSets);
    patchFiles.push(repoRelativePath(repoRoot, patchPath));
  }

  const operationCount = patchSets.reduce(
    (total, patchSet) => total + (patchSetOperations(patchSet)?.length ?? 0),
    0,
  );
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length > 0 ? "blocked" : "ready_for_patch_apply",
    task_manifest: repoRelativePath(repoRoot, manifestPath),
    counts: {
      tasks: ensureArray(manifest.tasks).length,
      required_tasks: requiredTasks.length,
      patch_files: patchFiles.length,
      patch_sets: patchSets.length,
      operations: operationCount,
      blockers: blockers.length,
    },
    patch_files: patchFiles,
    blockers,
    commands: {
      apply_all_patches: manifest.commands?.apply_all_patches ?? null,
    },
    files: {
      batch_patch: repoRelativePath(repoRoot, batchPatchPath),
      report: repoRelativePath(repoRoot, reportPath),
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  if (blockers.length === 0) {
    writeJson(batchPatchPath, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch_batch",
      patch_status: "completed",
      generated_at_utc: report.generated_at_utc,
      task_manifest: repoRelativePath(repoRoot, manifestPath),
      patch_sets: patchSets,
    });
  }
  writeJson(reportPath, report);
  return report;
}

export function runDatasetAuthoringTaskBuild({ repoRoot, options = {} } = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-task-build",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-task-build --authoring-package <package.json> --out-dir <task-dir>",
        "node scripts/foundry.mjs dataset-authoring-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <tasks-dir> [--shared-context-cache-dir <cache-dir>]",
        "node scripts/foundry.mjs dataset-authoring-task-build --package ./curation-gate/ai-authoring-packages/process-<uuid>.authoring-package.json --out-dir ./authoring-task",
      ],
      purpose:
        "Build Codex/skill-facing authoring tasks and strict patch templates from Foundry AI authoring packages. This command is local-only and never writes the database.",
    };
  }

  const curationGateReportInput =
    options.curationGateReport ?? options.gateReport ?? options.report;
  const curationGateReportPath = resolveRepoPath(
    repoRoot,
    curationGateReportInput,
  );
  if (curationGateReportPath) {
    if (!fileExists(curationGateReportPath)) {
      throw new Error(
        "--curation-gate-report must point to dataset-curation-gate-report.json.",
      );
    }
    const outDir = resolveRepoPath(
      repoRoot,
      options.outDir || ".foundry/workspaces/dataset-authoring-tasks",
    );
    const sharedContextCacheDir = resolveRepoPath(
      repoRoot,
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    const includeReady =
      options.includeReady === true || options.includeReady === "true";
    const entries = authoringPackageEntriesFromGate(
      repoRoot,
      curationGateReportPath,
      includeReady,
    );
    const missingPackages = entries.filter(
      (entry) => !entry.package_path || !fileExists(entry.package_path),
    );
    if (missingPackages.length > 0) {
      return {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "blocked_missing_authoring_packages",
        curation_gate_report: repoRelativePath(
          repoRoot,
          curationGateReportPath,
        ),
        missing_packages: missingPackages.map((entry) => ({
          entity: entry.entity,
          authoring_package: entry.package_ref,
        })),
      };
    }
    const tasks = entries.map((entry) =>
      buildDatasetAuthoringTaskFromPackage({
        repoRoot,
        packagePath: entry.package_path,
        outDir: path.join(outDir, entry.task_dir_name),
        options: {},
      }),
    );
    return writeAuthoringTaskBatchManifest(
      repoRoot,
      outDir,
      tasks,
      {
        curation_gate_report: repoRelativePath(repoRoot, curationGateReportPath),
        include_ready: includeReady,
      },
      {
        sharedContextCacheDir,
      },
    );
  }

  const authoringPackageInput =
    options.authoringPackage ?? options.package ?? options.input;
  const packagePath = resolveRepoPath(repoRoot, authoringPackageInput);
  const packagePayload =
    packagePath && fileExists(packagePath) ? readJson(packagePath) : null;
  const datasetType = asText(packagePayload?.dataset_type);
  const entityId = asText(
    packagePayload?.entity_id ?? packagePayload?.process_id,
  );
  const defaultOut = `.foundry/workspaces/dataset-authoring-task/${datasetType || "dataset"}-${sanitizeFileName(entityId || "entity")}`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  return buildDatasetAuthoringTaskFromPackage({
    repoRoot,
    packagePath,
    outDir,
    options,
  });
}

export const foundryTraceNamespace =
  "https://tiangong-lca.dev/foundry/import-curation/1";

export const datetimeFieldsToNormalize = new Set([
  "common:timeStamp",
  "common:dateOfLastRevision",
]);

export function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function normalizeUtcDateTimeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      trimmed,
    )
  ) {
    return null;
  }
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) return null;
  const normalized = new Date(time).toISOString();
  return normalized === value ? null : normalized;
}

export function normalizeDateTimeMetadata(value) {
  let normalized = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (datetimeFieldsToNormalize.has(key)) {
        const nextValue = normalizeUtcDateTimeString(child);
        if (nextValue) {
          node[key] = nextValue;
          normalized += 1;
        }
        continue;
      }
      visit(child);
    }
  };
  visit(value);
  return normalized;
}

export function annualSupplyTextValue(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(value["#text"] ?? value.value);
  }
  return "";
}

export function isPlaceholderAnnualSupplyValue(value) {
  const text = annualSupplyTextValue(value);
  return (
    !text ||
    /^9999$/u.test(text) ||
    /^not\s+specified\.?$/iu.test(text) ||
    /^not\s+declared\s+in\s+source\s+package\.?$/iu.test(text)
  );
}

export function annualSupplySentinelValue() {
  return {
    "@xml:lang": "en",
    "#text": annualSupplyMissingDataSentinelText,
  };
}

export function applyAnnualSupplyMissingDataSentinel(row, datasetType) {
  if (datasetType !== "process") return false;
  const payload = unwrapDatasetPayload(row, datasetType);
  const root = datasetRoot(payload, datasetType);
  const dataSources =
    root?.modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness;
  if (!dataSources || typeof dataSources !== "object") return false;
  const current = dataSources.annualSupplyOrProductionVolume;
  if (current !== undefined && !isPlaceholderAnnualSupplyValue(current)) {
    return false;
  }
  dataSources.annualSupplyOrProductionVolume = annualSupplySentinelValue();
  return true;
}

export function appendImportTraceSummary(commonOther, sourceTrace) {
  commonOther["@xmlns:tiangongfoundry"] =
    commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
  const summary = {
    "@sourceExtension": "tidasimport:sourceTrace",
    "@status": "externalized_before_remote_write",
    traceHash: sha256Json(sourceTrace),
    note: "Original import trace was captured in the Foundry AI authoring package and removed from the write payload.",
  };
  const existing = commonOther["tiangongfoundry:importTraceSummary"];
  if (existing === undefined) {
    commonOther["tiangongfoundry:importTraceSummary"] = summary;
  } else if (Array.isArray(existing)) {
    existing.push(summary);
  } else {
    commonOther["tiangongfoundry:importTraceSummary"] = [existing, summary];
  }
}

export function externalizeImportTraceMetadata(value) {
  let removed = 0;
  let summaries = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      if (Object.hasOwn(commonOther, "tidasimport:sourceTrace")) {
        appendImportTraceSummary(
          commonOther,
          commonOther["tidasimport:sourceTrace"],
        );
        delete commonOther["tidasimport:sourceTrace"];
        removed += 1;
        summaries += 1;
      }
      if (Object.hasOwn(commonOther, "@xmlns:tidasimport")) {
        delete commonOther["@xmlns:tidasimport"];
      }
      if (Object.keys(commonOther).length === 0) {
        delete node["common:other"];
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return { removed, summaries };
}

export function ensureFoundryTraceNamespaces(value) {
  let added = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      const hasFoundryExtension = Object.keys(commonOther).some((key) =>
        key.startsWith("tiangongfoundry:"),
      );
      if (
        hasFoundryExtension &&
        !Object.hasOwn(commonOther, "@xmlns:tiangongfoundry")
      ) {
        commonOther["@xmlns:tiangongfoundry"] = foundryTraceNamespace;
        added += 1;
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return added;
}

export const foundryTraceKeys = [
  "tiangongfoundry:unresolvedTrace",
  "tiangongfoundry:sourceExchangeCompleteness",
];

export const localSourceLocatorKeys = new Set([
  "source_path",
  "sourcePath",
  "local_source_path",
  "localSourcePath",
  "package_path",
  "packagePath",
  "source_object",
  "sourceObject",
]);

export function containsLocalSourceLocator(value) {
  const text = asText(value);
  return Boolean(
    text &&
      /(?:^|["'\s])(?:\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|file:\/\/|[A-Za-z]:\\)|\.zip:|LCI ecoSpold version2 Files/iu.test(
        text,
      ),
  );
}

export function sanitizeTraceEvidenceValue(value, stats) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) sanitizeTraceEvidenceValue(item, stats);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      sanitizeTraceEvidenceValue(child, stats);
      continue;
    }
    if (!containsLocalSourceLocator(child)) continue;

    const hash = sha256Text(String(child));
    if (localSourceLocatorKeys.has(key)) {
      delete value[key];
    } else {
      value[key] = `redacted local source locator sha256:${hash}`;
    }
    value.source_locator_sha256 = value.source_locator_sha256 ?? hash;
    value.source_locator_status =
      value.source_locator_status ?? "redacted_before_remote_write";
    stats.redacted += 1;
  }
}

export function sanitizeFoundryTraceEvidenceLocators(value) {
  const stats = { redacted: 0 };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      for (const traceKey of foundryTraceKeys) {
        for (const traceEntry of ensureArray(commonOther[traceKey])) {
          if (
            !traceEntry ||
            typeof traceEntry !== "object" ||
            Array.isArray(traceEntry)
          ) {
            continue;
          }
          const evidence =
            traceEntry.evidence ??
            traceEntry.source_evidence ??
            traceEntry.sourceEvidence;
          sanitizeTraceEvidenceValue(evidence, stats);
        }
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return stats.redacted;
}

export function normalizeProfile(rawProfile, profileId) {
  const profile =
    rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  return {
    id: String(profile.id ?? profileId ?? "generic"),
    description: profile.description ?? "",
    docs: ensureArray(profile.docs),
    waivedQaCodesByType:
      profile.waivedQaCodesByType ?? profile.waived_qa_codes_by_type ?? {},
    waiverReasons: profile.waiverReasons ?? profile.waiver_reasons ?? {},
    fullContextAiCompletion: normalizeFullContextAiCompletion(
      profile.fullContextAiCompletion ?? profile.full_context_ai_completion,
    ),
  };
}

export function readProfilesConfig(repoRoot, profilesFile = defaultProfilesFile) {
  const resolved = resolveRepoPath(repoRoot, profilesFile);
  return readJsonIfExists(resolved) ?? fallbackProfiles;
}
