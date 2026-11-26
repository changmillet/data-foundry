import path from "node:path";
import process from "node:process";
import { readOnlyStageContract } from "../stage-contract.ts";

export interface LooseRecord {
  [key: string]: LooseRecord | undefined;
}

export interface ExistingArtifact {
  path: string;
  value: LooseRecord;
}

export interface ArtifactStatus {
  exists: boolean;
  path: string | null;
  status: string;
  counts?: LooseRecord | null;
  completed?: boolean;
}

export interface ContextPaths {
  schema: string | null;
  methodology_yaml: string | null;
  ruleset: string | null;
  classification_schema: string[];
  location_schema: string | null;
}

export interface GateScope {
  dataset_type: string;
  dataset_ids: string[];
}

export interface PhaseStatus {
  status: string;
  required: boolean;
  [key: string]: unknown;
}

export interface PhaseLike {
  status: string;
  required: boolean;
  [key: string]: unknown;
}

export interface MutablePhase extends PhaseLike {
  commands: Record<string, unknown>;
}

export interface ChunkBuildArgs {
  datasetType: string;
  offset: number;
  limit: number;
  chunkLabel: string;
}

export interface IdentityApplyCommand {
  dataset_type: string;
  rows_file: string;
  authoring_package_dir: string | null;
  output_rows?: string | null;
  command: string;
}

export interface AuthoringPlanDependencies {
  appendOption: (args: unknown[], flag: string, value: unknown) => void;
  appendRepeatedOptions: (args: unknown[], flag: string, values: unknown) => void;
  asText: (value: unknown) => string;
  datasetRowsFileStem: (datasetType: string) => string;
  decisionTaskChunkLabel: (
    options: LooseRecord,
    selection: Record<string, unknown>,
    fallback: string,
  ) => string;
  ensureArray: (value: unknown) => LooseRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  hasUnresolvedAiPlaceholder: (value: unknown) => boolean;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback: number | null) => number | null;
  readJson: (filePath: string) => LooseRecord;
  readJsonOrJsonLines: (filePath: string) => LooseRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (filePath: unknown) => string;
  safeFileToken: (value: unknown, fallback: string) => string;
  shellQuote: (value: unknown) => string;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => void;
}

export const authoringPlanStageContract = readOnlyStageContract([
  {
    stage: "load_curation_scope",
    phase: "prepare",
    purpose:
      "Read the curation gate report and derive the authoring workspace, context files, queues, and entity scope.",
    inputs: ["dataset-curation-gate-report.json", "workspace options"],
    outputs: ["authoring plan scope"],
    side_effects: [],
  },
  {
    stage: "inspect_existing_artifacts",
    phase: "rewrite_cleanup",
    purpose:
      "Inspect existing identity, classification, location, patch task, decision, collect, and apply artifacts.",
    inputs: ["authoring workspace artifacts"],
    outputs: ["phase artifact status snapshots"],
    side_effects: [],
  },
  {
    stage: "plan_next_commands",
    phase: "gate_validate",
    purpose:
      "Synthesize deterministic next commands for missing task builds, AI decision application, patch collection, and patch application.",
    inputs: ["phase status snapshots", "curation scope"],
    outputs: ["phase command plan"],
    side_effects: [],
  },
  {
    stage: "report",
    phase: "report",
    purpose: "Emit the authoring plan with phases, instructions, counts, and report path.",
    inputs: ["phase command plan"],
    outputs: ["dataset-authoring-plan.json"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);

/** Creates path, artifact, and phase-status helpers for dataset-authoring-plan. */
export function createAuthoringPlanStatusHelpers(deps: AuthoringPlanDependencies) {
  const {
    appendOption,
    appendRepeatedOptions,
    asText,
    decisionTaskChunkLabel,
    ensureArray,
    fileExists,
    hasUnresolvedAiPlaceholder,
    positiveIntegerOption,
    readJson,
    readJsonOrJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    repoRoot,
    resolveRepoPath,
    safeFileToken,
    shellQuote,
    unique,
  } = deps;

  function foundryCommand(args: readonly unknown[]): string {
    return [process.execPath, path.join(repoRoot, "scripts", "foundry.ts"), ...args]
      .map(shellQuote)
      .join(" ");
  }

  function authoringPlanWorkspaceDir(curationGateReportPath: string, options: LooseRecord): string {
    const explicit = resolveRepoPath(options.workspaceDir || options.workspace);
    if (explicit) return explicit;
    const curationDir = path.dirname(curationGateReportPath);
    return path.basename(curationDir) === "curation-gate" ? path.dirname(curationDir) : curationDir;
  }

  function existingArtifact(filePath: unknown): ExistingArtifact | null {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) return null;
    return { path: resolved, value: readJson(resolved) };
  }

  function artifactStatus(filePath: unknown): ArtifactStatus {
    const artifact = existingArtifact(filePath);
    if (!artifact) {
      return {
        exists: false,
        path: repoRelativeMaybe(resolveRepoPath(filePath)),
        status: "missing",
      };
    }
    return {
      exists: true,
      path: repoRelativePath(artifact.path),
      status: asText(artifact.value?.status) || "present",
      counts: artifact.value?.counts ?? null,
    };
  }

  function aiRowsFileStatus(
    filePath: unknown,
    { requireCompletedDecision = false }: { requireCompletedDecision?: boolean } = {},
  ) {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) {
      return {
        exists: false,
        path: resolved ? repoRelativePath(resolved) : null,
        status: "missing",
        rows: 0,
        placeholders: 0,
        incomplete_decisions: 0,
      };
    }
    const rows = readJsonOrJsonLines(resolved);
    const placeholders = rows.filter(hasUnresolvedAiPlaceholder).length;
    const incompleteDecisions = requireCompletedDecision
      ? rows.filter((row) => asText(row?.decision_status) !== "completed").length
      : 0;
    return {
      exists: true,
      path: repoRelativePath(resolved),
      status:
        rows.length === 0
          ? "empty"
          : placeholders > 0 || incompleteDecisions > 0
            ? "needs_ai_completion"
            : "ready_for_apply",
      rows: rows.length,
      placeholders,
      incomplete_decisions: incompleteDecisions,
    };
  }

  function authoringPlanContextPaths(curationGateReport: LooseRecord): ContextPaths {
    const details = ensureArray(curationGateReport?.context?.contract_context_file_details);
    const byKind = new Map<string, string[]>();
    for (const detail of details) {
      const kind = asText(detail?.kind);
      const filePath = asText(detail?.path);
      if (!kind || !filePath) continue;
      const values = byKind.get(kind) ?? [];
      values.push(filePath);
      byKind.set(kind, values);
    }
    return {
      schema: byKind.get("schema")?.[0] ?? null,
      methodology_yaml: byKind.get("methodology_yaml")?.[0] ?? null,
      ruleset: byKind.get("ruleset")?.[0] ?? null,
      classification_schema: byKind.get("classification_schema") ?? [],
      location_schema: byKind.get("location_schema")?.[0] ?? null,
    };
  }

  function appendContextOptions(args: unknown[], contextPaths: ContextPaths): void {
    appendOption(args, "--schema-file", contextPaths.schema);
    appendOption(args, "--yaml-file", contextPaths.methodology_yaml);
    appendOption(args, "--ruleset-file", contextPaths.ruleset);
    appendRepeatedOptions(args, "--classification-schema", contextPaths.classification_schema);
    appendOption(args, "--location-schema", contextPaths.location_schema);
  }

  function authoringPlanGateScope(curationGateReport: LooseRecord): GateScope {
    const datasetType = asText(curationGateReport?.dataset_type);
    const entities = ensureArray(
      curationGateReport?.entities ??
        curationGateReport?.processes ??
        curationGateReport?.flows ??
        curationGateReport?.items,
    );
    return {
      dataset_type: datasetType,
      dataset_ids: unique(
        entities
          .map((entity) =>
            asText(
              entity?.entity_id ?? entity?.dataset_id ?? entity?.process_id ?? entity?.flow_id,
            ),
          )
          .filter(Boolean),
      ),
    };
  }

  function appendAuthoringPlanGateScopeOptions(args: unknown[], scope: GateScope): void {
    appendOption(args, "--dataset-type", scope?.dataset_type);
    appendRepeatedOptions(args, "--dataset-id", scope?.dataset_ids ?? []);
  }

  function authoringPlanScopedDecisionQueuePath({
    taskPath,
    taskQueueKey,
    originalQueue,
    scope,
    kind,
  }: {
    taskPath: string;
    taskQueueKey: string;
    originalQueue: string;
    scope: GateScope;
    kind: string;
  }): string {
    const taskQueue = asText(existingArtifact(taskPath)?.value?.[taskQueueKey]);
    if (taskQueue) return taskQueue;
    if (scope?.dataset_type) {
      const selection = {
        dataset_types: [scope.dataset_type],
        category_types: [],
        bundle_ids: [],
      };
      const label = decisionTaskChunkLabel({}, selection, `${kind}-scope`);
      return repoRelativePath(
        path.join(
          path.dirname(resolveRepoPath(taskPath)),
          `${kind}-authoring-queue.${label}.jsonl`,
        ),
      );
    }
    return originalQueue;
  }

  function authoringPlanDefaultPaths(workspaceDir: string) {
    return {
      identityTask: path.join(
        workspaceDir,
        "identity-decision-task",
        "identity-decision-task.json",
      ),
      identityDecisions: path.join(
        workspaceDir,
        "identity-decision-task",
        "identity-decisions.jsonl",
      ),
      identityApplyReport: path.join(
        workspaceDir,
        "identity-decision-apply",
        "identity-decisions-apply-report.json",
      ),
      classificationTask: path.join(
        workspaceDir,
        "classification-decision-task",
        "classification-decision-task.json",
      ),
      classificationDecisions: path.join(
        workspaceDir,
        "classification-decision-task",
        "classification-decisions.jsonl",
      ),
      classificationApplyReport: path.join(
        workspaceDir,
        "classification-decision-apply",
        "classification-decisions-apply-report.json",
      ),
      locationTask: path.join(
        workspaceDir,
        "location-decision-task",
        "location-decision-task.json",
      ),
      locationDecisions: path.join(
        workspaceDir,
        "location-decision-task",
        "location-decisions.jsonl",
      ),
      locationApplyReport: path.join(
        workspaceDir,
        "location-decision-apply",
        "location-decisions-apply-report.json",
      ),
      authoringTaskManifest: path.join(
        workspaceDir,
        "authoring-tasks",
        "authoring-task-manifest.json",
      ),
      patchCollectReport: path.join(
        workspaceDir,
        "authoring-tasks",
        "authoring-patch-collect-report.json",
      ),
      patchApplyReport: path.join(workspaceDir, "patch-apply", "dataset-patch-apply-report.json"),
    };
  }

  function authoringPlanApplyStatus(reportPath: unknown): ArtifactStatus {
    const artifact = artifactStatus(reportPath);
    return {
      ...artifact,
      completed: artifact.exists && artifact.status === "completed",
    };
  }

  function phaseStatusFromTaskDecision({
    required,
    taskPath,
    readyStatus,
    emptyStatus,
    decisionsPath,
    applyReportPath,
    applyReportPaths = null,
  }: {
    required: boolean;
    taskPath: string;
    readyStatus: string;
    emptyStatus: string;
    decisionsPath: string;
    applyReportPath?: string;
    applyReportPaths?: string[] | null;
  }): PhaseStatus {
    if (!required) {
      return { status: "not_required", required: false };
    }
    const task = artifactStatus(taskPath);
    if (!task.exists) {
      return { status: "needs_task_build", required: true, task };
    }
    if (task.status === emptyStatus) {
      return { status: "completed_no_actions", required: true, task };
    }
    if (task.status !== readyStatus) {
      return { status: "blocked_task_not_ready", required: true, task };
    }
    const decisions = aiRowsFileStatus(decisionsPath, {
      requireCompletedDecision: true,
    });
    if (decisions.status !== "ready_for_apply") {
      return {
        status: "ready_for_ai_decisions",
        required: true,
        task,
        decisions,
      };
    }
    const applyReports = (applyReportPaths ?? [applyReportPath]).map(authoringPlanApplyStatus);
    if (!applyReports.every((report) => report.completed)) {
      return {
        status: "needs_deterministic_apply",
        required: true,
        task,
        decisions,
        apply_report: applyReports.length === 1 ? applyReports[0] : null,
        apply_reports: applyReports,
      };
    }
    return {
      status: "completed",
      required: true,
      task,
      decisions,
      apply_report: applyReports.length === 1 ? applyReports[0] : null,
      apply_reports: applyReports,
    };
  }

  function phaseStatusFromPatchAuthoring({
    required,
    manifestPath,
    patchCollectReportPath,
    patchApplyReportPath,
  }: {
    required: boolean;
    manifestPath: string;
    patchCollectReportPath: string;
    patchApplyReportPath: string;
  }): PhaseStatus {
    if (!required) {
      return { status: "not_required", required: false };
    }
    const manifest = artifactStatus(manifestPath);
    if (!manifest.exists) {
      return { status: "needs_task_build", required: true, manifest };
    }
    if (manifest.status === "ready_no_action_items") {
      return { status: "completed_no_actions", required: true, manifest };
    }
    if (manifest.status !== "ready_for_ai_authoring_batch") {
      return { status: "blocked_task_not_ready", required: true, manifest };
    }
    const collect = artifactStatus(patchCollectReportPath);
    if (!collect.exists || collect.status === "blocked") {
      return {
        status: "ready_for_ai_patches",
        required: true,
        manifest,
        patch_collect_report: collect,
      };
    }
    if (collect.status !== "ready_for_patch_apply") {
      return {
        status: "blocked_patch_collect_not_ready",
        required: true,
        manifest,
        patch_collect_report: collect,
      };
    }
    const applyReport = authoringPlanApplyStatus(patchApplyReportPath);
    if (!applyReport.completed) {
      return {
        status: "needs_deterministic_apply",
        required: true,
        manifest,
        patch_collect_report: collect,
        patch_apply_report: applyReport,
      };
    }
    return {
      status: "completed",
      required: true,
      manifest,
      patch_collect_report: collect,
      patch_apply_report: applyReport,
    };
  }

  function authoringPlanOverallStatus(phases: PhaseLike[]): string {
    const required = phases.filter((phase) => phase.required);
    if (required.length === 0) return "ready_no_authoring_actions";
    if (required.some((phase) => phase.status === "blocked_task_not_ready")) {
      return "blocked_task_not_ready";
    }
    if (required.some((phase) => phase.status === "blocked_patch_collect_not_ready")) {
      return "blocked_patch_collect_not_ready";
    }
    if (required.some((phase) => phase.status === "needs_task_build")) {
      return "needs_task_build";
    }
    if (
      required.some((phase) =>
        ["ready_for_ai_decisions", "ready_for_ai_patches"].includes(phase.status),
      )
    ) {
      return "ready_for_ai_authoring";
    }
    if (required.some((phase) => phase.status === "needs_deterministic_apply")) {
      return "needs_deterministic_apply";
    }
    return "ready_for_post_authoring_finalize";
  }

  function authoringPlanChunkSize(options: LooseRecord, kind: string): number {
    return (
      positiveIntegerOption(options[`${kind}ChunkSize`], null) ??
      positiveIntegerOption(options.decisionChunkSize, null) ??
      25
    );
  }

  function authoringPlanDecisionRows(taskPath: string, key: string): LooseRecord[] {
    const task = existingArtifact(taskPath)?.value;
    return ensureArray(task?.[key]);
  }

  function groupedRowsByDatasetType(rows: LooseRecord[]) {
    const groups = new Map<string, LooseRecord[]>();
    for (const row of rows) {
      const datasetType = asText(row?.dataset_type) || "all";
      const current = groups.get(datasetType) ?? [];
      current.push(row);
      groups.set(datasetType, current);
    }
    return [...groups.entries()].map(([datasetType, groupRows]) => ({
      dataset_type: datasetType,
      rows: groupRows,
    }));
  }

  function authoringPlanDecisionChunkPlan({
    kind,
    rows,
    chunkSize,
    buildArgsForChunk,
  }: {
    kind: string;
    rows: LooseRecord[];
    chunkSize: number;
    buildArgsForChunk: (args: ChunkBuildArgs) => unknown[];
  }) {
    if (rows.length === 0) {
      return {
        recommended: false,
        chunk_size: chunkSize,
        chunks: 0,
        commands: [],
      };
    }
    const commands: Array<Record<string, unknown>> = [];
    for (const group of groupedRowsByDatasetType(rows)) {
      for (let offset = 0; offset < group.rows.length; offset += chunkSize) {
        const selectedRows = group.rows.slice(offset, offset + chunkSize);
        const chunkLabel = safeFileToken(
          `${kind}-${group.dataset_type}-${offset}-${offset + selectedRows.length}`,
          `${kind}-chunk-${commands.length + 1}`,
        );
        commands.push({
          dataset_type: group.dataset_type,
          offset,
          limit: chunkSize,
          selected_rows: selectedRows.length,
          chunk_label: chunkLabel,
          command: foundryCommand(
            buildArgsForChunk({
              datasetType: group.dataset_type,
              offset,
              limit: chunkSize,
              chunkLabel,
            }),
          ),
        });
      }
    }
    return {
      recommended: rows.length > chunkSize,
      chunk_size: chunkSize,
      rows: rows.length,
      chunks: commands.length,
      commands,
    };
  }

  return {
    foundryCommand,
    authoringPlanWorkspaceDir,
    existingArtifact,
    artifactStatus,
    authoringPlanContextPaths,
    appendContextOptions,
    authoringPlanGateScope,
    appendAuthoringPlanGateScopeOptions,
    authoringPlanScopedDecisionQueuePath,
    authoringPlanDefaultPaths,
    phaseStatusFromTaskDecision,
    phaseStatusFromPatchAuthoring,
    authoringPlanOverallStatus,
    authoringPlanChunkSize,
    authoringPlanDecisionRows,
    authoringPlanDecisionChunkPlan,
  };
}
