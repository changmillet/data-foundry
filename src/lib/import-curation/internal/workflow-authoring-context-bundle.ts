import fs from "node:fs";
import path from "node:path";
import { type DatasetType, datasetTypePlural } from "./dataset-types.ts";
import { sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  jsonLines,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  unique,
  writeJson,
  writeText,
} from "./runtime-io.ts";
import {
  contextSummaryHasKind,
  contextSummaryHasNonEmptyPayload,
  contextSummaryHasPattern,
  fullContextAiConfigRequiresAuthoring,
  markdownList,
  requiredFullContextFilePatterns,
  requiredFullContextKinds,
  sharedContextBundleReadinessBlockers,
} from "./workflow-authoring-template-helpers.ts";

export interface JsonRecord {
  [key: string]: unknown;
}

interface FullContextBlockerOptions {
  repoRoot: string;
  packagePayload: unknown;
  actionItems: unknown;
  packagePath?: string | null;
}

interface TaskReadinessOptions {
  repoRoot: string;
  task: unknown;
}

export interface AuthoringEntity extends JsonRecord {
  dataset_type: DatasetType;
  entity_id: string;
  version: string;
  profile: string | null;
}

export interface AuthoringContext extends JsonRecord {
  source_rows_file: string | null;
  authoring_package_sha256: string;
  profile_context_files: JsonRecord[];
  contract_context_files: JsonRecord[];
  full_context_ai_completion: unknown;
  missing_context_files: unknown[];
  curation_queue_status: unknown;
  shared_context_bundle?: SharedContextBundleRef;
}

export interface AuthoringFiles extends JsonRecord {
  authoring_package: string;
  task_json: string;
  task_markdown: string;
  patch_template: string;
  output_patch_file: string;
  patched_rows: string;
  apply_dir: string;
}

export interface AuthoringCommands extends JsonRecord {
  apply_patch: string | null;
  validate_after_apply: string | null;
}

export interface AuthoringActionItem extends JsonRecord {
  index: number;
  code: string;
  path: string | null;
  json_pointer: string;
  message: string | null;
  instruction: string | null;
  allowed_resolution_modes: string[];
  evidence: unknown;
}

export interface AuthoringTask extends JsonRecord {
  status: string;
  entity: AuthoringEntity;
  context: AuthoringContext;
  action_items: AuthoringActionItem[];
  decision_only_action_items: AuthoringActionItem[];
  blockers: JsonRecord[];
  files: AuthoringFiles;
  commands: AuthoringCommands;
}

interface SharedContextOptions extends JsonRecord {
  includeExecutionCommands?: boolean;
  sharedContextCacheDir?: string | null;
}

interface SharedContextBundleRef extends JsonRecord {
  path: string;
  sha256: string;
  counts: SharedContextCounts;
  cache: JsonRecord;
  instruction: string;
}

interface SharedContextCounts extends JsonRecord {
  tasks: number;
  authoring_packages: number;
  files: number;
  references: number;
  duplicate_references: number;
  unique_context_bytes: number;
  referenced_context_bytes: number;
  duplicate_context_bytes_avoided: number;
}

interface SharedContextBundle extends JsonRecord {
  sha256: string;
  counts: SharedContextCounts;
}

interface SharedContextFile extends JsonRecord {
  scope: string;
  kind: string;
  path: string | null;
  sha256: string;
  bytes: number;
  text: string;
}

interface SharedContextBuildResult {
  path: string;
  bundle: SharedContextBundle;
  cache: JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function authoringPackageFullContextReadinessBlockers({
  repoRoot,
  packagePayload,
  actionItems,
  packagePath = null,
}: FullContextBlockerOptions): JsonRecord[] {
  const typedPackage = asRecord(packagePayload);
  if (ensureArray(actionItems).length === 0) return [];
  const requirement = typedPackage.full_context_ai_completion;
  if (!fullContextAiConfigRequiresAuthoring(requirement)) return [];
  const blockers: JsonRecord[] = [];
  const authoringPackage = packagePath ? repoRelativePath(repoRoot, packagePath) : null;
  const contractFiles = ensureArray(typedPackage.contract_context_files);
  for (const missingContext of ensureArray(typedPackage.missing_context_files)) {
    const typedContext = asRecord(missingContext);
    blockers.push({
      code: "authoring_task_context_file_missing",
      message:
        "AI authoring task cannot start while its authoring package records missing context files.",
      authoring_package: authoringPackage,
      kind: asText(typedContext.kind) || null,
      path: asText(typedContext.path) || null,
    });
  }
  for (const file of contractFiles) {
    const typedFile = asRecord(file);
    if (!contextSummaryHasNonEmptyPayload(file)) {
      blockers.push({
        code: "authoring_task_context_file_empty",
        message: "AI authoring task cannot start with an empty contract context file.",
        authoring_package: authoringPackage,
        kind: asText(typedFile.kind) || null,
        path: asText(typedFile.path) || null,
      });
    }
  }
  for (const kind of requiredFullContextKinds(requirement)) {
    if (!contextSummaryHasKind(contractFiles, kind)) {
      blockers.push({
        code: "authoring_task_required_context_missing",
        message:
          "AI authoring task must include full schema/YAML/ruleset/category/location context before patch authoring.",
        authoring_package: authoringPackage,
        required_kind: kind,
      });
    }
  }
  for (const pattern of requiredFullContextFilePatterns(requirement)) {
    if (!contextSummaryHasPattern(contractFiles, pattern)) {
      blockers.push({
        code: "authoring_task_required_context_file_missing",
        message:
          "AI authoring task must include the required full-context file before patch authoring.",
        authoring_package: authoringPackage,
        required_file_pattern: pattern,
      });
    }
  }
  if (
    !typedPackage.source_row ||
    typeof typedPackage.source_row !== "object" ||
    Array.isArray(typedPackage.source_row)
  ) {
    blockers.push({
      code: "authoring_task_source_row_payload_missing",
      message: "AI authoring task must include the source row payload used as evidence.",
      authoring_package: authoringPackage,
    });
  }
  if (
    !typedPackage.entity_payload ||
    typeof typedPackage.entity_payload !== "object" ||
    Array.isArray(typedPackage.entity_payload)
  ) {
    blockers.push({
      code: "authoring_task_entity_payload_missing",
      message: "AI authoring task must include the converted TIDAS entity payload to patch.",
      authoring_package: authoringPackage,
    });
  }
  return blockers;
}

export function authoringTaskFullContextReadinessBlockers({
  repoRoot,
  task,
}: TaskReadinessOptions): JsonRecord[] {
  const typedTask = asRecord(task);
  const context = asRecord(typedTask.context);
  const files = asRecord(typedTask.files);
  if (ensureArray(typedTask.action_items).length === 0) return [];
  const requirement = context.full_context_ai_completion;
  if (!fullContextAiConfigRequiresAuthoring(requirement)) return [];
  const blockers: JsonRecord[] = [];
  const contractFiles = ensureArray(context.contract_context_files);
  blockers.push(
    ...sharedContextBundleReadinessBlockers({
      repoRoot,
      sharedContextBundle: context.shared_context_bundle,
      sourceKind: "task",
      sourcePath: asText(files.task_json) || null,
    }),
  );
  for (const missingContext of ensureArray(context.missing_context_files)) {
    const typedContext = asRecord(missingContext);
    blockers.push({
      code: "authoring_task_context_file_missing",
      message:
        "AI patch collect cannot accept a task whose context files were missing at authoring time.",
      kind: asText(typedContext.kind) || null,
      path: asText(typedContext.path) || null,
    });
  }
  for (const kind of requiredFullContextKinds(requirement)) {
    if (!contextSummaryHasKind(contractFiles, kind)) {
      blockers.push({
        code: "authoring_task_required_context_missing",
        message:
          "AI patch collect requires the authoring task to carry full schema/YAML/ruleset/category/location context.",
        required_kind: kind,
      });
    }
  }
  for (const pattern of requiredFullContextFilePatterns(requirement)) {
    if (!contextSummaryHasPattern(contractFiles, pattern)) {
      blockers.push({
        code: "authoring_task_required_context_file_missing",
        message:
          "AI patch collect requires the authoring task to carry every required full-context file.",
        required_file_pattern: pattern,
      });
    }
  }
  const packagePath = resolveRepoPath(repoRoot, asText(files.authoring_package));
  if (!packagePath || !fileExists(packagePath)) {
    blockers.push({
      code: "authoring_task_authoring_package_missing",
      message:
        "AI patch collect cannot verify full-context readiness without the authoring package.",
      authoring_package: files.authoring_package ?? null,
    });
    return blockers;
  }
  try {
    const packagePayload = readJson(packagePath);
    blockers.push(
      ...authoringPackageFullContextReadinessBlockers({
        repoRoot,
        packagePayload,
        actionItems: typedTask.action_items,
        packagePath,
      }),
    );
  } catch (error) {
    blockers.push({
      code: "authoring_task_authoring_package_invalid",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: files.authoring_package ?? null,
    });
  }
  return blockers;
}

export function shellQuote(value: unknown): string {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `'\\''`)}'`;
}

export function renderAuthoringTaskMarkdown(task: AuthoringTask): string {
  const actionItems = task.action_items.map((item) => {
    const lines = [
      `- [${item.index}] ${item.code}`,
      `  - path: ${item.path ?? "(AI must choose path)"}`,
      `  - json_pointer: ${item.json_pointer}`,
      `  - message: ${item.message ?? "(none)"}`,
    ];
    if (item.instruction) lines.push(`  - instruction: ${item.instruction}`);
    if (ensureArray(item.allowed_resolution_modes).length > 0) {
      lines.push(`  - allowed_resolution_modes: ${item.allowed_resolution_modes.join(", ")}`);
    }
    if (item.evidence !== null && item.evidence !== undefined) {
      lines.push(`  - evidence: ${JSON.stringify(item.evidence)}`);
    }
    return lines.join("\n");
  });
  const contextFiles = [
    ...task.context.profile_context_files,
    ...task.context.contract_context_files,
  ].map((file) => `${file.kind}: ${file.path} (${file.bytes} bytes, sha256=${file.sha256})`);
  const sharedContextBundle = task.context?.shared_context_bundle;
  const sharedContextLines = sharedContextBundle
    ? [
        `- shared context bundle: ${sharedContextBundle.path} (sha256=${sharedContextBundle.sha256})`,
        `- shared context files: ${sharedContextBundle.counts?.files ?? "(unknown)"}`,
        `- duplicate context bytes avoided: ${sharedContextBundle.counts?.duplicate_context_bytes_avoided ?? 0}`,
      ]
    : [];
  const sharedContextInstruction = sharedContextBundle
    ? "\nIf a shared context bundle is listed above, read it once for the batch-level full schema/YAML/ruleset/category/location text. Still read the entity authoring package for source row, entity payload, action items, support rows, queue/dependency closure, and hash-bound proof. Do not treat the shared bundle as a replacement for package lineage or action-item evidence.\n"
    : "";

  return `# Foundry AI Authoring Task

Status: ${task.status}

## Entity

- type: ${task.entity.dataset_type}
- id: ${task.entity.entity_id}
- version: ${task.entity.version}
- profile: ${task.entity.profile}

## Required Inputs

- authoring package: ${task.files.authoring_package}
- source rows file: ${task.context.source_rows_file ?? "(not recorded)"}
- patch template: ${task.files.patch_template}
- output patch file: ${task.files.output_patch_file}
${sharedContextLines.length > 0 ? sharedContextLines.join("\n") : ""}

Read the full authoring package before writing the patch. It contains the converted row, source row, schema issues, QA findings, profile constraints, queue/dependency closure, support rows, bundled TIDAS taxonomy/location schemas, and full contract context text when supplied by the SDK/CLI.
${sharedContextInstruction}

## Context Files

${markdownList(contextFiles)}

## Action Items

${actionItems.length > 0 ? actionItems.join("\n") : "- none"}

## Output Contract

Write a structured patch JSON to:

\`${task.files.output_patch_file}\`

The patch must:

- target this dataset id/version or row_index
- keep \`authoring_package\` set to the package filename
- treat template paths as suggestions and fix JSON Pointers against the actual authoring package row
- provide \`basis\` or \`evidence\` for every non-test operation
- for full-context tasks, provide both \`basis\` and structured \`evidence\` with a source/context identifier plus \`quote_or_trace\`, source path, field path, citation, or equivalent pointer
- provide \`resolution.mode\` for every non-test operation; use one of the action item's allowed modes
- include \`resolution.used_context_kinds\` with every full-context kind required by the task, normally \`schema\`, \`methodology_yaml\`, \`ruleset\`, \`classification_schema\`, and \`location_schema\`
- close every AI-required action item with \`closes_action_items\`
- for full-context import profiles, every non-test operation must include \`closes_action_items\`; supporting cleanup operations should close the same action item they are needed to resolve
- avoid database writes, direct Supabase calls, or hand-edited row files
- preserve source-language content and provide evidence-backed English for fields required by the current TIDAS/profile contract; keep the same factual meaning
- do not use \`common:other\` as a substitute for mandatory schema fields; schema-required values need evidence-backed values or must remain blocked
- if a value cannot be inferred safely and the action item's allowed modes include \`deferred_to_common_other\`, add \`common:other.tiangongfoundry:unresolvedTrace\` with \`status\`, \`action_item_code\`, \`blocked_path\`, \`reason\`, structured \`evidence\`, and \`next_action\`; evidence must include source plus quote/trace/path/citation pointer
- do not defer \`annualSupplyOrProductionVolume\` to \`common:other\` and never invent a quantity from a reference flow or a default unit; supply a real annualized quantity from source evidence, or leave the field to Foundry deterministic cleanup, which normalizes it to the supported empty array and records a row-level evidence gap
- if source exchange completeness is being accepted as source-faithful, use \`resolution.mode=source_trace_verified\` and add \`common:other.tiangongfoundry:sourceExchangeCompleteness\` with accepted \`status\` and structured source trace evidence; evidence must include source plus quote/trace/path/citation pointer

## Deterministic Apply

${task.commands.apply_patch ? `\`\`\`bash\n${task.commands.apply_patch}\n\`\`\`` : "Prepare the completed patch file for review. Apply it only through a structured next action from the public task; do not invoke a developer source runner."}

After apply, rerun Rust tidas validation, deterministic CLI QA where relevant, Foundry cleanup, dry-run publish/save, mutation manifest, explicit commit, and post-commit \`dataset verify-remote --compare-root-payload\`.
`;
}

export function buildSharedAuthoringContextBundle(
  repoRoot: string,
  outDir: string,
  tasks: AuthoringTask[],
  source: unknown,
  options: SharedContextOptions = {},
): SharedContextBuildResult {
  const fileMap = new Map<string, SharedContextFile>();
  const references: JsonRecord[] = [];
  for (const task of tasks) {
    const packageRef = task.files?.authoring_package;
    const packagePath = resolveRepoPath(repoRoot, packageRef);
    if (!packagePath || !fileExists(packagePath)) continue;
    const stablePackageRef = packageRef ? path.basename(packageRef) : null;
    let packagePayload: JsonRecord | null = null;
    try {
      packagePayload = readJson<JsonRecord>(packagePath);
    } catch {
      continue;
    }
    for (const [scope, contextFiles] of [
      ["profile_context_files", packagePayload.profile_context_files],
      ["contract_context_files", packagePayload.contract_context_files],
    ] as Array<[string, unknown]>) {
      for (const contextFile of ensureArray(contextFiles)) {
        const typedFile = asRecord(contextFile);
        const text = String(typedFile.text ?? "");
        const sha256 = asText(typedFile.sha256) || sha256Text(text);
        const bytes = Number(typedFile.bytes) || Buffer.byteLength(text, "utf8");
        const kind = asText(typedFile.kind) || "context";
        const contextPath = asText(typedFile.path) || null;
        const key = JSON.stringify([scope, kind, contextPath, sha256]);
        if (!fileMap.has(key)) {
          fileMap.set(key, {
            scope,
            kind,
            path: contextPath,
            sha256,
            bytes,
            text,
          });
        }
        references.push({
          authoring_package: stablePackageRef,
          authoring_package_sha256: task.context?.authoring_package_sha256 ?? null,
          dataset_type: task.entity?.dataset_type ?? null,
          entity_id: task.entity?.entity_id ?? null,
          dataset_version: task.entity?.version ?? null,
          scope,
          kind,
          path: contextPath,
          sha256,
          bytes,
        });
      }
    }
  }
  const files = [...fileMap.values()];
  const uniqueBytes = files.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
  const referenceBytes = references.reduce((total, ref) => total + (Number(ref.bytes) || 0), 0);
  const counts: SharedContextCounts = {
    tasks: tasks.length,
    authoring_packages: unique(
      tasks.map((task) => path.basename(task.files.authoring_package ?? "")).filter(Boolean),
    ).length,
    files: files.length,
    references: references.length,
    duplicate_references: Math.max(0, references.length - files.length),
    unique_context_bytes: uniqueBytes,
    referenced_context_bytes: referenceBytes,
    duplicate_context_bytes_avoided: Math.max(0, referenceBytes - uniqueBytes),
  };
  const stablePayload = {
    schema_version: 1,
    kind: "tiangong_foundry_shared_authoring_context_bundle",
    source,
    counts,
    files,
    references,
  };
  const bundle: SharedContextBundle = {
    ...stablePayload,
    generated_at_utc: nowIso(),
    hash_scope:
      "schema_version, kind, source, counts, files, and references; generated_at_utc is excluded so identical batch context keeps a stable hash.",
    sha256: sha256Text(JSON.stringify(stablePayload)),
  };
  const cacheDir = options.sharedContextCacheDir
    ? resolveRepoPath(repoRoot, options.sharedContextCacheDir)
    : null;
  const bundlePath = cacheDir
    ? path.join(cacheDir, `authoring.${bundle.sha256}.json`)
    : path.join(outDir, "shared-context-bundle.json");
  let cacheReused = false;
  if (cacheDir && fileExists(bundlePath)) {
    try {
      cacheReused = readJson<JsonRecord>(bundlePath).sha256 === bundle.sha256;
    } catch {
      cacheReused = false;
    }
  }
  if (!cacheReused) writeJson(bundlePath, bundle);
  return {
    path: bundlePath,
    bundle,
    cache: cacheDir
      ? {
          enabled: true,
          dir: repoRelativePath(repoRoot, cacheDir),
          reused: cacheReused,
        }
      : {
          enabled: false,
          reused: false,
        },
  };
}

export function attachSharedContextBundleToTask(
  task: AuthoringTask,
  sharedContextBundle: SharedContextBundleRef,
): AuthoringTask {
  return {
    ...task,
    context: {
      ...task.context,
      shared_context_bundle: sharedContextBundle,
    },
  };
}

export function rewriteAuthoringTaskFile(repoRoot: string, task: AuthoringTask): void {
  const taskFile = resolveRepoPath(repoRoot, task?.files?.task_json);
  const markdownFile = resolveRepoPath(repoRoot, task?.files?.task_markdown);
  if (taskFile) writeJson(taskFile, task);
  if (markdownFile) writeText(markdownFile, renderAuthoringTaskMarkdown(task));
}

export function writeAuthoringTaskBatchManifest(
  repoRoot: string,
  outDir: string,
  tasks: AuthoringTask[],
  source: unknown,
  options: SharedContextOptions = {},
): JsonRecord {
  const manifestPath = path.join(outDir, "authoring-task-manifest.json");
  const tasksPath = path.join(outDir, "authoring-tasks.jsonl");
  const batchPatchFile = path.join(outDir, "ai-patches.batch.json");
  const datasetTypes = [...new Set(tasks.map((task) => task.entity.dataset_type).filter(Boolean))];
  const sourceRowsFiles = [
    ...new Set(
      tasks
        .map((task) => task.context.source_rows_file)
        .filter((filePath): filePath is string => Boolean(filePath)),
    ),
  ];
  const packageDirs = [
    ...new Set(
      tasks
        .map((task) => resolveRepoPath(repoRoot, task.files.authoring_package))
        .filter((filePath): filePath is string => Boolean(filePath))
        .map((filePath) => repoRelativePath(repoRoot, path.dirname(filePath))),
    ),
  ];
  const totalActionItems = tasks.reduce(
    (total, task) => total + ensureArray(task.action_items).length,
    0,
  );
  const totalDecisionOnlyActionItems = tasks.reduce(
    (total, task) => total + ensureArray(task.decision_only_action_items).length,
    0,
  );
  const canApplyBatch =
    totalActionItems > 0 &&
    datasetTypes.length === 1 &&
    sourceRowsFiles.length === 1 &&
    packageDirs.length === 1;
  const batchPatchedRows = path.join(
    outDir,
    `${datasetTypePlural[datasetTypes[0]] ?? "datasets"}.patched.jsonl`,
  );
  const batchApplyDir = path.join(outDir, "patch-apply");
  const applyBatchArgs = canApplyBatch
    ? [
        "node",
        "src/dev-cli.ts",
        "dataset-patch-apply",
        "--input",
        sourceRowsFiles[0],
        "--patch",
        repoRelativePath(repoRoot, batchPatchFile),
        "--out",
        repoRelativePath(repoRoot, batchPatchedRows),
        "--out-dir",
        repoRelativePath(repoRoot, batchApplyDir),
        "--authoring-package-dir",
        packageDirs[0],
        "--require-authoring-package",
        "--require-action-item-closure",
      ]
    : [];
  const blockedTasks = tasks.filter((task) => task.status === "blocked_missing_full_context");
  const taskBlockers = tasks.flatMap((task, taskIndex) =>
    task.status === "blocked_missing_full_context"
      ? ensureArray(task.blockers).map((blocker) => ({
          ...blocker,
          task_index: taskIndex,
          entity: task.entity,
        }))
      : [],
  );
  fs.mkdirSync(outDir, { recursive: true });
  const sharedContext = buildSharedAuthoringContextBundle(repoRoot, outDir, tasks, source, options);
  const sharedContextBundleRef = {
    path: repoRelativePath(repoRoot, sharedContext.path),
    sha256: sharedContext.bundle.sha256,
    counts: sharedContext.bundle.counts,
    cache: sharedContext.cache,
    instruction:
      "Read this shared bundle once per batch for full schema/YAML/ruleset/category/location context; per-entity authoring packages still carry source/entity/action evidence and remain the hash-bound proof records.",
  };
  const tasksWithSharedContext = tasks.map((task) =>
    attachSharedContextBundleToTask(task, sharedContextBundleRef),
  );
  for (const task of tasksWithSharedContext) {
    rewriteAuthoringTaskFile(repoRoot, task);
  }
  const manifest = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status:
      blockedTasks.length > 0
        ? "blocked_missing_full_context"
        : tasks.some((task) => task.status === "ready_for_ai_authoring")
          ? "ready_for_ai_authoring_batch"
          : "ready_no_action_items",
    source,
    counts: {
      tasks: tasks.length,
      ready_for_ai_authoring: tasks.filter((task) => task.status === "ready_for_ai_authoring")
        .length,
      ready_no_action_items: tasks.filter((task) => task.status === "ready_no_action_items").length,
      blocked_missing_full_context: blockedTasks.length,
      action_items: totalActionItems,
      decision_only_action_items: totalDecisionOnlyActionItems,
      blockers: taskBlockers.length,
      shared_context_files: sharedContext.bundle.counts.files,
      shared_context_references: sharedContext.bundle.counts.references,
      duplicate_context_references: sharedContext.bundle.counts.duplicate_references,
      duplicate_context_bytes_avoided: sharedContext.bundle.counts.duplicate_context_bytes_avoided,
    },
    blockers: taskBlockers,
    batch_patch_contract: {
      status:
        totalActionItems === 0
          ? "not_required_no_patch_action_items"
          : canApplyBatch
            ? "available"
            : "not_available_mixed_inputs",
      output_patch_file: canApplyBatch ? repoRelativePath(repoRoot, batchPatchFile) : null,
      patched_rows: canApplyBatch ? repoRelativePath(repoRoot, batchPatchedRows) : null,
      apply_dir: canApplyBatch ? repoRelativePath(repoRoot, batchApplyDir) : null,
      instruction:
        options.includeExecutionCommands === false
          ? "Prepare the completed per-task patch sets in this batch file for review. Apply only through a structured action from the public task."
          : totalActionItems === 0
            ? "No patch batch is required; resolve decision_only_action_items with the dedicated deterministic decision apply commands."
            : "AI/Codex may combine all per-task patch sets into this batch file, then run apply_all_patches once to produce one patched rows file.",
    },
    commands: {
      apply_all_patches:
        options.includeExecutionCommands !== false && canApplyBatch
          ? applyBatchArgs.map(shellQuote).join(" ")
          : null,
    },
    shared_context_bundle: sharedContextBundleRef,
    tasks: tasksWithSharedContext.map((task) => ({
      status: task.status,
      entity: task.entity,
      context: task.context,
      action_item_count: ensureArray(task.action_items).length,
      action_items: task.action_items,
      decision_only_action_item_count: ensureArray(task.decision_only_action_items).length,
      decision_only_action_items: task.decision_only_action_items,
      blockers: ensureArray(task.blockers),
      files: task.files,
      commands: task.commands,
    })),
  };
  writeJson(manifestPath, manifest);
  writeText(tasksPath, jsonLines(manifest.tasks));
  return {
    ...manifest,
    files: {
      manifest: repoRelativePath(repoRoot, manifestPath),
      tasks: repoRelativePath(repoRoot, tasksPath),
      shared_context_bundle: repoRelativePath(repoRoot, sharedContext.path),
    },
  };
}
