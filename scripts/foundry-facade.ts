import { assertFoundryRepairExecution } from "./lib/foundry-repair-execution.ts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertFoundryCacheRootSeparated } from "./lib/foundry-runtime-cache.ts";
import { createFoundryRuntime } from "./foundry-runtime.ts";
import {
  captureFoundryInput,
  assertFoundryRuntimeHost,
  assertFoundryWorkspaceWrite,
  createFoundryRuntimeContext,
  FoundryContextError,
  initializeFoundryWorkspace,
  pendingFoundryMigration,
  type FoundryInputFact,
  type FoundryAccountIntent,
  type FoundryRuntimeContextOptions,
  type FoundryWorkspaceAccess,
} from "./lib/foundry-runtime-context.ts";
import {
  commandNextActionBindingSha256,
  createFoundryOperationResult,
  type FoundryOperationArtifact,
  type FoundryOperationNextAction,
  type FoundryOperationPermissions,
  type FoundryOperationResult,
  type FoundryPublicOperation,
} from "./lib/foundry-operation-result.ts";
import {
  loadFoundryFacadeTaskRecord,
  registerFoundryFacadeTask,
  type FoundryFacadeTaskRecord,
} from "./lib/foundry-facade-store.ts";
import {
  parseFoundryTaskStartSpec,
  type FoundryTaskStartSpec,
} from "./lib/foundry-task-start-spec.ts";
import {
  qualifyFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./lib/foundry-runtime-qualification.ts";
import { sha256Json } from "./lib/identity-preflight-proof.ts";
import { inventoryFoundryWorkspace } from "./lib/foundry-migration-inventory.ts";
import {
  planFoundryWorkspaceMigration,
  revalidateFoundryMigrationPlan,
} from "./lib/foundry-migration-plan.ts";
import { stageFoundryMigration, auditFoundryMigration } from "./lib/foundry-migration-transfer.ts";
import {
  planFoundryMigrationAdoption,
  type MigrationAdoptionSelection,
} from "./lib/foundry-migration-adoption-plan.ts";
import { applyFoundryMigrationAdoption } from "./lib/foundry-migration-adoption.ts";
import { readFoundryMigrationAuthority } from "./lib/foundry-migration-authority.ts";
import {
  selectFoundryWorkspaceRuntime,
  type FoundryRuntimeManagerOptions,
} from "./lib/foundry-runtime-selection.ts";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { datasetTypePlural } from "./lib/import-curation/internal/dataset-types.ts";
import { currentWorkflowState, workflowObject } from "./lib/foundry-workflow-state.ts";
import {
  completedOwnerScopes,
  prepareFoundryOwnerExecution,
} from "./lib/foundry-owner-execution-store.ts";
import { executeFoundryOwnerScope } from "./lib/foundry-workflow-execution.ts";
import {
  inspectFoundryReferences,
  verifyFoundryReferences,
} from "./lib/foundry-workflow-reference-verify.ts";
import { selectFoundrySemanticInput } from "./lib/foundry-semantic-input.ts";
import {
  currentFoundryInteractionState,
  currentFoundryQuestions,
  currentFoundryDecisions,
  currentFoundryInvestigations,
  currentFoundryAssumptions,
  selectFoundryInteractionInput,
} from "./lib/foundry-interaction-input.ts";
import { recordFoundryInteractionInput } from "./lib/foundry-workflow-interaction.ts";
import { runFoundryWorkflowIdentity } from "./lib/foundry-workflow-identity.ts";
import { finalizeFoundryWorkflow } from "./lib/foundry-workflow-finalize.ts";
import {
  prepareFoundryRepair,
  readFoundryRepairPreparation,
} from "./lib/foundry-workflow-repair.ts";
import {
  selectFoundryReferenceInput,
  recordFoundryReferenceInput,
} from "./lib/foundry-reference-input.ts";
import {
  selectFoundryAuthorizationInput,
  snapshotFoundryAuthorizationContract,
} from "./lib/foundry-authorization-input.ts";
import { authorizeFoundryWorkflow } from "./lib/foundry-workflow-authorization.ts";
import { continueFoundryPreparedApproval } from "./lib/foundry-workflow-approval-continuation.ts";
import type { FoundryAuthentication } from "./lib/foundry-runtime-identity.ts";
import type { ArtifactEntry } from "./lib/foundry-task-types.ts";

export interface FoundryFacadeRuntimeSelection {
  readonly cliExpectation: unknown;
  readonly tidasExpectation: unknown;
  readonly tidasExecutable: string;
}

export interface FoundryFacadeOptions {
  readonly moduleUrl: string;
  readonly workspace: string;
  readonly cacheBase?: string;
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeSelection?: FoundryFacadeRuntimeSelection;
  readonly accountIntent?: FoundryAccountIntent;
  readonly authentication?: FoundryAuthentication;
  readonly signal?: AbortSignal;
  readonly workspaceAccess?: FoundryWorkspaceAccess;
  readonly runtimeManager?: FoundryRuntimeManagerOptions;
}

const maxSpecBytes = 1024 * 1024;
const maxSeedBytes = 8 * 1024 * 1024;
const maxQueueBytes = 32 * 1024 * 1024;

function readCaptured(fact: FoundryInputFact, maxBytes: number, code: string): Buffer {
  if (fact.bytes > maxBytes)
    throw new FoundryContextError(code, "Selected facade input exceeds its byte limit.");
  const fd = fs.openSync(fact.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    const bytes = fs.readFileSync(fd);
    if (
      !opened.isFile() ||
      opened.size !== fact.bytes ||
      bytes.length !== fact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== fact.sha256
    )
      throw new FoundryContextError(code, "Selected facade input changed while it was read.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function fileArtifact(role: string, file: string): FoundryOperationArtifact {
  const fact = captureFoundryInput(file);
  return Object.freeze({ kind: "file", role, ...fact });
}

function inlineArtifact(role: string, value: unknown): FoundryOperationArtifact {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return Object.freeze({
    kind: "inline",
    role,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value,
  });
}

function human(code: string, instructions: string): FoundryOperationNextAction {
  return Object.freeze({ kind: "human", code, instructions });
}

function resumeCommand(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  ownerStage?: "execution" | "readback" | "reference_verification" | "approval_continuation",
): FoundryOperationNextAction {
  const action = {
    kind: "command",
    code: ownerStage ? `resume_owner_${ownerStage}` : "resume_local_preparation",
    executable: process.execPath,
    argv: [
      context.runtime.entryPath,
      "task",
      "resume",
      "--workspace",
      context.workspaceRoot,
      "--task",
      record.task_id,
      "--actor",
      record.spec.actor_id,
      "--json",
    ],
    cwd: context.workspaceRoot,
    purpose:
      ownerStage === "execution"
        ? "Continue the approved owner scope using its exact sealed execution request."
        : ownerStage === "readback"
          ? "Read back the consumed owner scope using its retained request."
          : ownerStage === "reference_verification"
            ? "Verify the canonical references selected by the current semantic decisions."
            : ownerStage === "approval_continuation"
              ? "Continue sealing the current scope under its existing registered approval."
              : "Resume the content-bound deterministic local preparation for this task revision.",
  } as const;
  return Object.freeze({
    ...action,
    argv: Object.freeze([...action.argv]),
    binding_sha256: commandNextActionBindingSha256(action),
  });
}

function noPermission(): FoundryOperationPermissions {
  return Object.freeze({
    state: "not_required",
    requested_actions: Object.freeze([]),
    approval_reference: null,
  });
}

function assertNotInterrupted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new FoundryContextError(
      "operation_interrupted",
      "Operation was interrupted; retained evidence must be inspected before resume.",
    );
}

function contextOptions(options: FoundryFacadeOptions): FoundryRuntimeContextOptions {
  if (options.runtimeManager?.cacheDir !== undefined)
    assertFoundryCacheRootSeparated(
      options.runtimeManager.cacheDir,
      path.resolve(options.cwd ?? process.cwd(), options.workspace),
    );
  return {
    moduleUrl: options.moduleUrl,
    workspace: options.workspace,
    cacheBase: options.cacheBase,
    managedCacheRoot: options.runtimeManager?.cacheDir,
    cwd: options.cwd,
    environment: options.environment,
    accountIntent: options.accountIntent,
    workspaceAccess: options.workspaceAccess,
  };
}

function accountReadiness(context: ReturnType<typeof createFoundryRuntimeContext>) {
  const intent = context.accountIntent;
  if (!intent) return Object.freeze({ status: "not_requested", reference_selected: false });
  if (!intent.sessionReference)
    return Object.freeze({ status: "needs_auth", reference_selected: false });
  try {
    const stat = fs.lstatSync(intent.sessionReference);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 8 * 1024 * 1024)
      return Object.freeze({ status: "needs_auth", reference_selected: true });
  } catch {
    return Object.freeze({ status: "needs_auth", reference_selected: true });
  }
  return Object.freeze({ status: "configured_unverified", reference_selected: true });
}

function qualification(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  selected: FoundryFacadeRuntimeSelection | undefined,
): QualifiedFoundryRuntime | undefined {
  return selected
    ? qualifyFoundryRuntime(context, {
        cliExpectation: selected.cliExpectation,
        tidasExpectation: selected.tidasExpectation,
        tidasExecutable: selected.tidasExecutable,
      })
    : undefined;
}

function runtimeIdentity(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  selected?: QualifiedFoundryRuntime,
) {
  const described = createFoundryRuntime(context, selected).describe();
  return Object.freeze({
    foundry: Object.freeze({
      package_name: context.runtime.packageName,
      package_version: context.runtime.packageVersion,
      package_manifest_sha256: context.runtime.packageManifestSha256,
      entry_sha256: context.runtime.entrySha256,
    }),
    platform: context.platform,
    qualification: described.qualification,
    account_readiness: accountReadiness(context),
  });
}

function failure(
  operation: FoundryPublicOperation,
  taskId: string | null,
  error: unknown,
  identity: unknown = null,
): FoundryOperationResult {
  const code = error instanceof FoundryContextError ? error.code : "runtime_operation_failed";
  const systemCode =
    error &&
    typeof error === "object" &&
    "code" in error &&
    [
      "ENOENT",
      "EACCES",
      "EPERM",
      "EINVAL",
      "ENAMETOOLONG",
      "EIO",
      "ENOSPC",
      "EBADF",
      "EEXIST",
      "ENOTDIR",
      "EMFILE",
      "ENFILE",
      "EBUSY",
      "UNKNOWN",
      "ERR_INVALID_ARG_TYPE",
      "ERR_INVALID_ARG_VALUE",
      "ERR_OUT_OF_RANGE",
    ].includes(String(error.code))
      ? String(error.code)
      : error instanceof SyntaxError
        ? "SyntaxError"
        : error instanceof TypeError
          ? "TypeError"
          : null;
  const message =
    error instanceof FoundryContextError
      ? error.message
      : `Foundry could not complete this operation${systemCode ? ` (${systemCode})` : ""}; selected state was preserved.`;
  const needsAuth = code === "needs_auth" || code.startsWith("identity_");
  const needsInputCodes = new Set([
    "task_not_found",
    "workspace_not_initialized",
    "input_not_selected",
    "regular_file_required",
    "credential_input_forbidden",
    "task_id_invalid",
    "task_account_invalid",
    "task_document_invalid",
    "task_document_limit",
    "task_entities_invalid",
    "task_profile_unknown",
    "task_request_invalid",
    "task_source_invalid",
  ]);
  const blockedCodes = new Set([
    "facade_crash_recovery_conflict",
    "task_actor_mismatch",
    "task_account_mismatch",
    "task_attempt_state_invalid",
    "task_authorization_state_invalid",
    "migration_inventory_limit",
    "migration_depth_limit",
    "workspace_migration_pending",
    "workspace_read_only",
    "workspace_runtime_incompatible",
    "migration_replay_forbidden",
  ]);
  const needsInput =
    needsInputCodes.has(code) ||
    code.startsWith("argument_") ||
    code.startsWith("task_spec_") ||
    code.startsWith("task_semantic_") ||
    code.startsWith("task_authorization_input_") ||
    code.startsWith("task_seed_");
  const blocked =
    !needsAuth &&
    !needsInput &&
    (blockedCodes.has(code) ||
      code.includes("mismatch") ||
      code.includes("changed") ||
      code.includes("legacy") ||
      code.includes("unsupported") ||
      code.includes("unqualified") ||
      code.includes("required") ||
      code.includes("invalid") ||
      code.includes("conflict"));
  return createFoundryOperationResult({
    operation,
    status: needsAuth ? "needs_auth" : needsInput ? "needs_input" : blocked ? "blocked" : "failed",
    taskId,
    artifacts: [],
    blockers: [{ code, message, scope: taskId }],
    nextActions: [],
    runtimeIdentity: identity,
    permissions: noPermission(),
  });
}

function readSpec(file: string): { fact: FoundryInputFact; spec: FoundryTaskStartSpec } {
  const fact = captureFoundryInput(file);
  let value: unknown;
  try {
    value = JSON.parse(readCaptured(fact, maxSpecBytes, "task_spec_invalid").toString("utf8"));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    throw new FoundryContextError("task_spec_invalid", "Task-start spec is not complete JSON.");
  }
  return { fact, spec: parseFoundryTaskStartSpec(value) };
}

function selectedInputs(
  workspaceRoot: string,
  spec: FoundryTaskStartSpec,
): readonly FoundryInputFact[] {
  return Object.freeze(
    spec.sources.map((source) => captureFoundryInput(path.resolve(workspaceRoot, source.path))),
  );
}

function accountIntent(spec: FoundryTaskStartSpec, host?: FoundryAccountIntent) {
  if (
    host?.accountMode &&
    host.projectRef === spec.account_intent?.project_ref &&
    host.userId === spec.account_intent?.user_id &&
    host.accountMode !== (spec.account_intent.account_mode ?? "ordinary")
  )
    throw new FoundryContextError(
      "task_account_mismatch",
      "Explicit host and task verification modes must agree.",
    );
  const inheritedReference =
    host &&
    host.projectRef === spec.account_intent?.project_ref &&
    host.userId === spec.account_intent?.user_id
      ? host.sessionReference
      : undefined;
  return spec.account_intent
    ? {
        projectRef: spec.account_intent.project_ref,
        userId: spec.account_intent.user_id,
        ...(spec.account_intent.account_mode
          ? { accountMode: spec.account_intent.account_mode }
          : {}),
        ...((spec.account_intent.session_reference ?? inheritedReference)
          ? { sessionReference: spec.account_intent.session_reference ?? inheritedReference }
          : {}),
      }
    : undefined;
}

function seed(spec: FoundryTaskStartSpec, inputs: readonly FoundryInputFact[]) {
  if (!spec.seed) return undefined;
  const index = spec.sources.findIndex((source) => source.path === spec.seed?.path);
  const fact = inputs[index];
  if (!fact)
    throw new FoundryContextError("task_seed_invalid", "Selected task seed exceeds its limit.");
  let value: unknown;
  try {
    value = JSON.parse(readCaptured(fact, maxSeedBytes, "task_seed_invalid").toString("utf8"));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    throw new FoundryContextError("task_seed_invalid", "Selected task seed is not complete JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FoundryContextError("task_seed_invalid", "Selected task seed must be a JSON object.");
  return value as Record<string, unknown>;
}

function taskContext(
  options: FoundryFacadeOptions,
  base: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  derived: readonly FoundryInputFact[] = [],
) {
  return createFoundryRuntimeContext({
    ...contextOptions(options),
    workspace: base.workspaceRoot,
    taskId: record.task_id,
    actorId: record.spec.actor_id,
    accountIntent: accountIntent(record.spec, options.accountIntent),
    inputs: [
      ...record.inputs,
      ...derived.filter((fact) => !record.inputs.some((source) => source.path === fact.path)),
    ],
  });
}

function sourcePath(record: FoundryFacadeTaskRecord, selected: string): string {
  const index = record.spec.sources.findIndex((source) => source.path === selected);
  const fact = record.inputs[index];
  if (!fact)
    throw new FoundryContextError(
      "task_spec_preparation_invalid",
      "Preparation input has no registered source fact.",
    );
  return fact.path;
}

function taskArtifacts(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
): FoundryOperationArtifact[] {
  return inspected.artifacts.map((entry) =>
    Object.freeze({
      kind: "file" as const,
      role: path.basename(entry.path).replace(/[^a-zA-Z0-9._-]/gu, "_"),
      path: path.join(context.taskRoot!, entry.path),
      bytes: entry.bytes,
      sha256: entry.sha256,
    }),
  );
}

function completionProven(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
): boolean {
  for (const entry of inspected.artifacts) {
    if (entry.command !== "dataset-import-completion-report") continue;
    const file = path.join(context.taskRoot!, entry.path);
    let value: unknown;
    try {
      value = JSON.parse(
        readCaptured(
          { path: file, bytes: entry.bytes, sha256: entry.sha256 },
          maxSeedBytes,
          "task_completion_invalid",
        ).toString("utf8"),
      );
    } catch {
      return false;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const report = value as Record<string, unknown>;
      if (
        report.status === "completed" &&
        report.task_id === record.task_id &&
        (!Array.isArray(report.blockers) || report.blockers.length === 0)
      )
        return true;
    }
  }
  return false;
}

function independentLocalPreparationPending(
  record: FoundryFacadeTaskRecord,
  workflow: ReturnType<typeof currentWorkflowState>,
  entries: readonly ArtifactEntry[],
): boolean {
  if (record.spec.repair) return false;
  if (record.spec.preparation)
    return !entries.some((entry) => entry.command === "dataset-curation-cleanup");
  return !workflow.rows || workflow.assessmentRemainingTypes.length > 0;
}

function currentIndexedQueueBlockers(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  workflow: ReturnType<typeof currentWorkflowState>,
  entries: readonly ArtifactEntry[],
) {
  const blockers: Array<{ code: string; message: string; scope: string }> = [];
  const actions: FoundryOperationNextAction[] = [];
  const seenBlockerSha256 = new Set<string>();
  const queueExpected = workflow.rows?.value.sets.some((set) => set.type === "process") ?? false;
  for (const set of workflow.assessment?.value.sets ?? []) {
    if (typeof set.curation_report !== "string") continue;
    const curation = entries.find(
      (entry) =>
        entry.command === "dataset-workflow-assessment" &&
        path.join(context.taskRoot!, entry.path) === set.curation_report,
    );
    if (!curation) continue;
    // Artifact-index paths use '/' on every platform, including Windows.
    const manifest = entries.find(
      (entry) =>
        entry.operation_id === curation.operation_id &&
        entry.path.endsWith("/queue/outputs/curation-queue-manifest.json"),
    );
    if (!manifest) {
      if (queueExpected && ["flow", "process"].includes(String(set.type)))
        throw new FoundryContextError(
          "workflow_queue_invalid",
          "The registered assessment is missing its curation queue evidence.",
        );
      continue;
    }
    const blockerFile = entries.find(
      (entry) =>
        entry.operation_id === curation.operation_id &&
        entry.path.endsWith("/queue/outputs/curation-queue-blockers.jsonl"),
    );
    if (!blockerFile)
      throw new FoundryContextError(
        "workflow_queue_invalid",
        "The registered curation queue is missing its complete blocker evidence.",
      );
    const manifestFile = path.join(context.taskRoot!, manifest.path);
    const detailsFile = path.join(context.taskRoot!, blockerFile.path);
    const report = workflowObject(
      JSON.parse(
        readCaptured(
          { path: manifestFile, bytes: manifest.bytes, sha256: manifest.sha256 },
          maxQueueBytes,
          "workflow_queue_invalid",
        ).toString("utf8"),
      ),
    );
    if (report.status !== "blocked") continue;
    const reportFiles = workflowObject(report.files);
    const reportCounts = workflowObject(report.counts);
    if (
      report.schema_version !== 1 ||
      reportFiles.manifest !== manifestFile ||
      reportFiles.blockers !== detailsFile ||
      !Array.isArray(report.blockers) ||
      !report.blockers.length ||
      reportCounts.blockers !== report.blockers.length
    )
      throw new FoundryContextError(
        "workflow_queue_invalid",
        "The registered curation queue blocker manifest is invalid.",
      );
    const recorded = report.blockers;
    let blockerRows: unknown[];
    try {
      blockerRows = readCaptured(
        { path: detailsFile, bytes: blockerFile.bytes, sha256: blockerFile.sha256 },
        maxQueueBytes,
        "workflow_queue_invalid",
      )
        .toString("utf8")
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
    } catch {
      throw new FoundryContextError(
        "workflow_queue_invalid",
        "The registered curation queue blocker file is invalid or changed.",
      );
    }
    if (JSON.stringify(blockerRows) !== JSON.stringify(recorded))
      throw new FoundryContextError(
        "workflow_queue_invalid",
        "The registered curation queue blocker file does not match its manifest.",
      );
    if (seenBlockerSha256.has(blockerFile.sha256)) continue;
    seenBlockerSha256.add(blockerFile.sha256);
    const missing = recorded
      .map(workflowObject)
      .filter((item) => item.code === "process_flow_reference_unresolved")
      .reduce((total, item) => {
        const refs = workflowObject(item.details).missing_flow_refs;
        return total + (Array.isArray(refs) ? refs.length : 0);
      }, 0);
    const scope = missing ? "process" : String(set.type);
    const message = missing
      ? `Selected Process data has ${missing} unresolved Flow reference occurrence${missing === 1 ? "" : "s"}: the cited Flow evidence is absent from the selected inputs and has no verified external declaration. Process review is blocked; unrelated records can continue. Provide the cited Flow evidence or verified references, or keep the gap open. Adding selected sources requires a new task revision because this task's inputs are frozen. Full IDs and paths: ${detailsFile}.`
      : `The selected ${scope} dependency queue has ${recorded.length} blocker${recorded.length === 1 ? "" : "s"}. Independent types can continue. Review the exact registered evidence at ${detailsFile} before revising the source or closure.`;
    blockers.push({ code: "curation_queue_blocked", message, scope });
    actions.push(human("review_queue_blockers", message));
  }
  return { blockers, actions };
}

function taskProjection(
  operation: "task.start" | "task.status" | "task.resume",
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
  identity: unknown,
): FoundryOperationResult {
  const artifacts = taskArtifacts(context, inspected);
  const interaction = currentFoundryInteractionState(context, inspected.artifacts);
  const pendingQuestions = interaction ? currentFoundryQuestions(interaction.state) : [];
  const investigations = interaction ? currentFoundryInvestigations(interaction.state) : [];
  if (record.spec.brief) artifacts.push(inlineArtifact("task_brief", record.spec.brief));
  if (interaction)
    artifacts.push(
      Object.freeze({
        kind: "file" as const,
        role: "current_interaction_state",
        path: path.join(context.taskRoot!, interaction.entry.path),
        bytes: interaction.entry.bytes,
        sha256: interaction.entry.sha256,
      }),
    );
  const recap = (completionProven: boolean) => {
    const questions = new Map(
      interaction?.state.events
        .filter((event) => event.kind === "question")
        .map((event) => [String(event.id), event]) ?? [],
    );
    return inlineArtifact("decision_recap", {
      schema: "tiangong-foundry.decision-recap.v1",
      task_id: record.task_id,
      completion_proven: completionProven,
      brief: record.spec.brief ?? null,
      user_decisions: interaction
        ? currentFoundryDecisions(interaction.state).map((answer) => ({
            question_id: answer.question_id,
            dataset_type: questions.get(String(answer.question_id))?.dataset_type ?? null,
            impact: questions.get(String(answer.question_id))?.impact ?? null,
            raw_answer_sha256: createHash("sha256").update(String(answer.raw_answer)).digest("hex"),
            adopted_decision: answer.adopted_decision,
            decision_id: answer.decision_id,
            supersedes_decision_id: answer.supersedes_decision_id,
            evidence_sha256: answer.evidence_sha256,
          }))
        : [],
      ai_assumptions: interaction ? currentFoundryAssumptions(interaction.state) : [],
      unresolved_questions: [...pendingQuestions, ...investigations].map((question) => ({
        id: question.id,
        dataset_type: question.dataset_type,
        missing: question.missing,
        impact: question.impact,
        ask: question.ask,
        choices: question.choices,
      })),
      source_interaction_sha256: interaction?.entry.sha256 ?? null,
    });
  };
  if (record.spec.brief || interaction) artifacts.push(recap(false));
  const completedArtifacts = () =>
    record.spec.brief || interaction
      ? [...artifacts.filter((artifact) => artifact.role !== "decision_recap"), recap(true)]
      : artifacts;
  if (
    completionProven(context, record, inspected) &&
    !pendingQuestions.length &&
    !investigations.length
  )
    return createFoundryOperationResult({
      operation,
      status: "completed",
      taskId: record.task_id,
      artifacts: completedArtifacts(),
      blockers: [],
      nextActions: [],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  let execution: ReturnType<typeof completedOwnerScopes> | null = null;
  try {
    execution = completedOwnerScopes(context, inspected.artifacts);
  } catch (error) {
    if (!(error instanceof FoundryContextError) || error.code !== "execution_legacy_attempts")
      throw error;
  }
  if (!execution || execution.pending.length)
    return createFoundryOperationResult({
      operation,
      status: execution ? "needs_input" : "blocked",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code: "mutation_readback_required",
          message:
            "Existing attempt evidence requires its owner readback recovery and cannot replay.",
          scope: record.task_id,
        },
      ],
      nextActions: execution
        ? [resumeCommand(context, record, "readback")]
        : [
            human(
              "resume_owner_readback",
              "Use the retained owner attempt and readback evidence; do not dispatch another mutation.",
            ),
          ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  const prepared = inspected.artifacts.some(
    (entry) => entry.command === "dataset-curation-cleanup",
  );
  const nativeReport = artifacts.find(
    (artifact) =>
      artifact.kind === "file" &&
      path.basename(artifact.path) === "foundry-native-import.json" &&
      inspected.artifacts.some(
        (entry) =>
          entry.command === "dataset-tidas-import" &&
          path.join(context.taskRoot!, entry.path) === artifact.path,
      ),
  );
  if (nativeReport?.kind === "file") {
    const result: unknown = JSON.parse(
      readCaptured(nativeReport, maxSeedBytes, "native_import_report_invalid").toString("utf8"),
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("schema" in result) ||
      result.schema !== "tiangong-foundry.native-import-stage.v1" ||
      !("status" in result)
    )
      throw new FoundryContextError(
        "native_import_report_invalid",
        "The registered native stage report is invalid.",
      );
    if (result.status !== "completed")
      return createFoundryOperationResult({
        operation,
        status: "blocked",
        taskId: record.task_id,
        artifacts,
        blockers: [
          {
            code: "native_import_blocked",
            message:
              "Inspect the registered conversion report before continuing this source package.",
            scope: record.task_id,
          },
        ],
        nextActions: [
          human(
            "review_conversion_report",
            "Resolve the conversion findings for the selected source before continuing.",
          ),
        ],
        runtimeIdentity: identity,
        permissions: noPermission(),
      });
  }
  const workflow = currentWorkflowState(context, inspected.artifacts);
  const queueIssues = currentIndexedQueueBlockers(context, workflow, inspected.artifacts);
  if (record.spec.repair && execution.verified.size) {
    if (execution.requests.length !== 1 || execution.verified.size !== 1)
      throw new FoundryContextError(
        "repair_execution_mismatch",
        "A repair task must retain one exact verified execution scope.",
      );
    const requested = execution.requests[0];
    const repair = assertFoundryRepairExecution(context, inspected.artifacts, requested.request);
    const verified = execution.verified.get(requested.request.scope_id);
    const proof = verified?.value.readback as Record<string, unknown> | undefined;
    const bound = proof?.repair_preparation as Record<string, unknown> | undefined;
    if (
      !repair ||
      !verified ||
      bound?.sha256 !== repair.preparation.entry.sha256 ||
      bound?.bytes !== repair.preparation.entry.bytes ||
      proof?.publication_ready !== false
    )
      throw new FoundryContextError(
        "repair_execution_mismatch",
        "Repair completion requires the same prepared scope and independent native receipt/readback proof.",
      );
    return createFoundryOperationResult({
      operation,
      status: "completed",
      taskId: record.task_id,
      artifacts: completedArtifacts(),
      blockers: [],
      nextActions: [],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  }
  if (record.spec.repair && !workflow.authorization && !execution.completed.size) {
    const found = readFoundryRepairPreparation(context, inspected.artifacts);
    const noChange = found?.value.status === "no_change_verified";
    const preparedRepair = found?.value.status === "prepared";
    if (noChange && execution.requests.length)
      throw new FoundryContextError(
        "repair_noop_attempt_conflict",
        "No-write completion cannot replace an owner execution request.",
      );
    return createFoundryOperationResult({
      operation,
      status: noChange ? "completed" : found ? "needs_input" : "ready",
      taskId: record.task_id,
      artifacts: noChange ? completedArtifacts() : artifacts,
      blockers:
        noChange || !found
          ? []
          : [
              {
                code: preparedRepair ? "repair_authorization_required" : "repair_preflight_blocked",
                message: preparedRepair
                  ? "The exact draft repair is prepared. Current task approval is required before any write."
                  : "Review the registered repair preflight findings; a resume may repeat only the read-only preparation.",
                scope: record.task_id,
              },
            ],
      nextActions: noChange
        ? []
        : preparedRepair
          ? [
              human(
                "authorize_repair",
                `Review the content-bound repair evidence ${found.file} before authorizing its exact owner-draft scope.`,
              ),
            ]
          : [resumeCommand(context, record)],
      runtimeIdentity: identity,
      permissions: preparedRepair
        ? { state: "required", requested_actions: [], approval_reference: null }
        : noPermission(),
    });
  }
  if (pendingQuestions.length || investigations.length) {
    const describe = (question: Readonly<Record<string, unknown>>) =>
      `${String(question.missing)} ${String(question.impact)} ${String(question.recommendation)} ${String(question.ask)}`;
    const askActions = pendingQuestions.map((question) =>
      human(
        "answer_current_question",
        `${describe(question)}${Array.isArray(question.choices) && question.choices.length ? ` ${question.choices.join(" / ")}` : ""}`,
      ),
    );
    const investigationIds = new Set(investigations.map((question) => String(question.id)));
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        ...[...pendingQuestions, ...investigations].map((question) => ({
          code: investigationIds.has(String(question.id))
            ? "interaction_investigation_pending"
            : "interaction_decision_pending",
          message: `${String(question.missing)} ${String(question.impact)}`,
          scope: String(question.dataset_type ?? record.task_id),
        })),
        ...queueIssues.blockers,
      ],
      nextActions: [
        ...askActions,
        ...queueIssues.actions,
        ...(independentLocalPreparationPending(record, workflow, inspected.artifacts)
          ? [resumeCommand(context, record)]
          : []),
      ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  }
  const references = inspectFoundryReferences(context, inspected.artifacts);
  const scopeComplete =
    workflow.rows &&
    (workflow.rows.value.sets.length > 0 || references.scope) &&
    workflow.rows.value.sets.every((set) => execution.completed.has(set.type));
  if (scopeComplete && (!references.scope || references.verified) && workflow.finalization)
    return createFoundryOperationResult({
      operation,
      status: "completed",
      taskId: record.task_id,
      artifacts: completedArtifacts(),
      blockers: [],
      nextActions: [],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  if (workflow.finalization && references.scope && !references.verified)
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code: "reference_verification_required",
          message: "Current canonical reference decisions require independent remote verification.",
          scope: record.task_id,
        },
      ],
      nextActions: [resumeCommand(context, record, "reference_verification")],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  if (
    workflow.authorization &&
    !execution.completed.has(String(workflow.authorization.value.dataset_type))
  ) {
    const report = workflow.authorization.value;
    const code =
      report.status === "sealed"
        ? "authorized_execution_pending"
        : report.status === "authorized_current_rows"
          ? "authorized_refinalization_pending"
          : "authorized_handoff_requires_input";
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code,
          message:
            report.status === "sealed"
              ? "Current approval and execution capsule are recorded; owner execution remains pending."
              : "Current approval is registered; resolve the remaining preparation or handoff work.",
          scope: record.task_id,
        },
      ],
      nextActions:
        report.status === "sealed"
          ? [resumeCommand(context, record, "execution")]
          : [
              human(
                code,
                `Read the registered approval result ${workflow.authorization.file}. Existing approval does not permit replay of any consumed attempt.`,
              ),
            ],
      runtimeIdentity: identity,
      permissions: {
        state: "granted",
        requested_actions: Array.isArray(report.allowed_actions)
          ? report.allowed_actions.filter((item): item is string => typeof item === "string")
          : [],
        approval_reference: String(report.authorization_sha256),
      },
    });
  }
  if (workflow.preparedApproval) {
    const canContinue =
      Array.isArray(workflow.finalization?.value.sets) &&
      workflow.finalization.value.sets
        .map(workflowObject)
        .some(
          (scope) =>
            scope.type === workflow.preparedApproval!.value.dataset_type &&
            scope.status === "ready_for_remote_write",
        );
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code: "authorization_continuation_pending",
          message:
            "Resume to verify the retained preparation approval and complete its current final-row derivation.",
          scope: record.task_id,
        },
      ],
      nextActions: canContinue
        ? [resumeCommand(context, record, "approval_continuation")]
        : [
            human(
              "resume_approval_continuation",
              `Retained preparation approval: ${workflow.preparedApproval.file}.`,
            ),
          ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  }
  if (workflow.finalization) {
    const ready = workflow.finalization.value.status === "ready_for_authorization";
    const found = workflow.finalization;
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code: ready ? "task_authorization_required" : "finalization_requires_input",
          message: ready
            ? "Final rows are prepared. Register current task approval before owner draft execution."
            : "Resolve the registered finalization blockers before owner draft execution.",
          scope: record.task_id,
        },
      ],
      nextActions: [
        human(
          ready ? "authorize_final_rows" : "review_finalization",
          `Read the current finalization report ${found.file} and its per-scope owner reports.`,
        ),
      ],
      runtimeIdentity: identity,
      permissions: ready
        ? { state: "required", requested_actions: [], approval_reference: null }
        : noPermission(),
    });
  }
  if (workflow.identity?.value.status === "blocked")
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        {
          code: "identity_preflight_requires_input",
          message:
            "Review the identity preflight diagnostics. A subsequent resume retries this read-only stage against the same current rows.",
          scope: record.task_id,
        },
      ],
      nextActions: [
        human(
          "review_identity_preflight",
          `Read ${workflow.identity.file} and resolve the reported query or execution failure before retrying.`,
        ),
      ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  const assessment = workflow.assessment?.entry;
  if (assessment) {
    const rawReport: unknown = JSON.parse(
      readCaptured(
        { ...assessment, path: path.join(context.taskRoot!, assessment.path) },
        maxSeedBytes,
        "workflow_assessment_invalid",
      ).toString("utf8"),
    );
    if (
      !rawReport ||
      typeof rawReport !== "object" ||
      !("schema" in rawReport) ||
      rawReport.schema !== "tiangong-foundry.assessment-stage.v1" ||
      !("sets" in rawReport) ||
      !Array.isArray(rawReport.sets)
    )
      throw new FoundryContextError(
        "workflow_assessment_invalid",
        "Registered assessment metadata is invalid.",
      );
    const pending = workflow.assessment!.value.sets.filter((value: unknown) => {
      if (
        !value ||
        typeof value !== "object" ||
        !("curation_counts" in value) ||
        !("authoring_counts" in value) ||
        !("type" in value) ||
        typeof value.type !== "string"
      )
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Assessment counts are missing.",
        );
      const curation = value.curation_counts as Record<string, unknown>;
      const authoring = value.authoring_counts as Record<string, unknown>;
      if (
        !curation ||
        !authoring ||
        !Number.isSafeInteger(curation.blocking_items) ||
        !Number.isSafeInteger(authoring.tasks)
      )
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Assessment counts are invalid.",
        );
      for (const key of [
        "rows",
        "schema_report",
        "qa_report",
        "curation_report",
        "authoring_manifest",
      ]) {
        const file = (value as Record<string, unknown>)[key];
        if (typeof file !== "string")
          throw new FoundryContextError(
            "workflow_assessment_invalid",
            "Assessment file reference is missing.",
          );
        const expected = inspected.artifacts.find(
          (entry) => path.join(context.taskRoot!, entry.path) === file,
        );
        if (!expected)
          throw new FoundryContextError(
            "workflow_assessment_invalid",
            "Assessment references an unregistered artifact.",
          );
        const observed = captureFoundryInput(file);
        if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256)
          throw new FoundryContextError(
            "workflow_assessment_changed",
            "An assessed input or report changed; retain its original evidence before continuing.",
          );
      }
      return Number(curation.blocking_items ?? 0) > 0 || Number(authoring.tasks ?? 0) > 0;
    }) as Array<{
      type: string;
      curation_report: string;
      authoring_manifest: string;
      decisions?: Array<{ kind: string; task: string; status: string }>;
    }>;
    if (pending.length)
      return createFoundryOperationResult({
        operation,
        status: "needs_input",
        taskId: record.task_id,
        artifacts,
        blockers: [
          ...queueIssues.blockers,
          ...pending.map((set) => ({
            code: "curation_requires_input",
            message: `Resolve the current ${set.type} curation and authoring work before a write handoff.`,
            scope: record.task_id,
          })),
        ],
        nextActions: [
          ...queueIssues.actions,
          ...pending.flatMap((set) => [
            human(
              "review_semantic_work",
              `Read the registered curation report ${set.curation_report} and authoring manifest ${set.authoring_manifest}. Use their bound source/context evidence; no write permission is implied.`,
            ),
            ...(set.decisions ?? []).map((work) =>
              human(
                `review_${work.kind}_decisions`,
                `Read registered ${work.kind} task ${work.task} (${work.status}). Complete its bound decision template and submit it with semantic-input kind=${work.kind}.`,
              ),
            ),
          ]),
          ...(workflow.assessmentRemainingTypes.length ? [resumeCommand(context, record)] : []),
        ],
        runtimeIdentity: identity,
        permissions: noPermission(),
      });
  }
  const nextActions = prepared
    ? [
        human(
          "review_prepared_rows",
          "Review the current prepared artifacts and continue the returned task workflow.",
        ),
      ]
    : record.spec.preparation || !workflow.assessmentComplete
      ? [resumeCommand(context, record)]
      : [
          human(
            "review_assessment",
            "Review the registered curation reports and authoring-task manifests. Resolve their current semantic work before requesting a write handoff; assessment does not grant permission.",
          ),
        ];
  return createFoundryOperationResult({
    operation,
    status: "ready",
    taskId: record.task_id,
    artifacts,
    blockers: [],
    nextActions,
    runtimeIdentity: identity,
    permissions: noPermission(),
  });
}

export function createFoundryFacade(options: FoundryFacadeOptions) {
  const base = () => createFoundryRuntimeContext(contextOptions(options));
  return Object.freeze({
    async runtimeUse(input: {
      manifest: TrustedRuntimeManifest;
      requestId: string;
      actorId: string;
      access: "read" | "write";
    }): Promise<FoundryOperationResult> {
      try {
        assertNotInterrupted(options.signal);
        if (!options.workspaceAccess)
          throw new FoundryContextError(
            "workspace_runtime_selection_required",
            "Explicit runtime selection requires an independently qualified current host.",
          );
        const current = base();
        const selected = await selectFoundryWorkspaceRuntime(
          current,
          options.workspaceAccess.manifest,
          input.manifest,
          {
            requestId: input.requestId,
            actorId: input.actorId,
            access: input.access,
            manager: { ...options.runtimeManager, signal: options.signal },
          },
        );
        return createFoundryOperationResult({
          operation: "workspace.migrate",
          status: "ready",
          taskId: null,
          artifacts: [fileArtifact("workspace_runtime_selection", selected.path)],
          blockers: [],
          nextActions: [
            human(
              "launch_selected_runtime",
              "Launch through the independently trusted selected manifest. Previous and selected components remain leased; read-only selection does not permit task writes.",
            ),
          ],
          runtimeIdentity: runtimeIdentity(current),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.migrate", null, error);
      }
    },
    initialize(): FoundryOperationResult {
      try {
        assertNotInterrupted(options.signal);
        const initial = base();
        assertNotInterrupted(options.signal);
        initializeFoundryWorkspace(initial);
        assertNotInterrupted(options.signal);
        const current = base();
        const marker = path.join(current.controlRoot, "workspace.json");
        return createFoundryOperationResult({
          operation: "workspace.init",
          status: "ready",
          taskId: null,
          artifacts: [fileArtifact("workspace_marker", marker)],
          blockers: [],
          nextActions: [],
          runtimeIdentity: runtimeIdentity(current),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.init", null, error);
      }
    },
    doctor(): FoundryOperationResult {
      try {
        assertNotInterrupted(options.signal);
        const current = base();
        if (pendingFoundryMigration(current))
          throw new FoundryContextError(
            "workspace_migration_pending",
            "Migration is staged and requires task adoption and activation audit.",
          );
        const qualified = qualification(current, options.runtimeSelection);
        assertNotInterrupted(options.signal);
        const readiness = accountReadiness(current);
        const nextActions = [
          ...(current.workspaceId
            ? []
            : [human("initialize_workspace", "Initialize the selected user workspace.")]),
          ...(qualified
            ? []
            : [
                human(
                  "provide_qualified_runtime",
                  "Launch through the trusted CLI runtime manager before a child-required stage.",
                ),
              ]),
          ...(readiness.status === "needs_auth"
            ? [
                human(
                  "authenticate_cli",
                  "Complete the trusted CLI OAuth flow, then resume with the same account intent.",
                ),
              ]
            : []),
        ];
        return createFoundryOperationResult({
          operation: "doctor",
          status: readiness.status === "needs_auth" ? "needs_auth" : "ready",
          taskId: null,
          artifacts: [],
          blockers:
            readiness.status === "needs_auth"
              ? [
                  {
                    code: "needs_auth",
                    message:
                      "The selected account intent needs a CLI-owned OAuth session before restricted work.",
                    scope: null,
                  },
                ]
              : [],
          nextActions,
          runtimeIdentity: runtimeIdentity(current, qualified),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("doctor", null, error);
      }
    },
    migrationDryRun(input?: {
      destination: string;
      actorId: string;
      requestId: string;
      stageManifests?: readonly string[];
      externalInputs?: readonly string[];
    }): FoundryOperationResult {
      try {
        assertNotInterrupted(options.signal);
        assertFoundryRuntimeHost();
        if (options.runtimeManager?.cacheDir !== undefined)
          assertFoundryCacheRootSeparated(
            options.runtimeManager.cacheDir,
            path.resolve(options.cwd ?? process.cwd(), options.workspace),
          );
        const plan = input
          ? planFoundryWorkspaceMigration(
              createFoundryRuntimeContext({
                ...contextOptions(options),
                workspace: input.destination,
              }),
              {
                sourceWorkspace: path.resolve(options.cwd ?? process.cwd(), options.workspace),
                actorId: input.actorId,
                requestId: input.requestId,
                stageManifests: input.stageManifests,
                externalInputs: input.externalInputs,
              },
            )
          : inventoryFoundryWorkspace(options.workspace, {
              sessionReference: options.accountIntent?.sessionReference,
            });
        assertNotInterrupted(options.signal);
        return createFoundryOperationResult({
          operation: "workspace.migrate",
          status: "ready",
          taskId: null,
          artifacts: [
            inlineArtifact(
              input ? "workspace_migration_transfer_plan" : "workspace_migration_plan",
              plan,
            ),
          ],
          blockers: [],
          nextActions:
            input || ("disposition" in plan && plan.disposition === "explicit_migration_required")
              ? [
                  human(
                    "review_workspace_migration",
                    "Review this content-bound plan before an explicit migration apply; retained stage labels grant no write or replay permission.",
                  ),
                ]
              : [],
          runtimeIdentity: null,
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.migrate", null, error);
      }
    },
    async migrationTransfer(input: {
      destination: string;
      actorId: string;
      requestId: string;
      stageManifests?: readonly string[];
      externalInputs?: readonly string[];
      plan: unknown;
      audit?: boolean;
    }): Promise<FoundryOperationResult> {
      try {
        assertNotInterrupted(options.signal);
        assertFoundryRuntimeHost();
        const destination = createFoundryRuntimeContext({
          ...contextOptions(options),
          workspace: input.destination,
        });
        const planning = {
          sourceWorkspace: path.resolve(options.cwd ?? process.cwd(), options.workspace),
          actorId: input.actorId,
          requestId: input.requestId,
          stageManifests: input.stageManifests,
          externalInputs: input.externalInputs,
        };
        if (input.audit && destination.migration) {
          revalidateFoundryMigrationPlan(
            destination,
            planning,
            input.plan,
            destination.migration.plan_sha256,
          );
          const activation = readFoundryMigrationAuthority(
            destination.controlRoot,
            destination.workspaceId!,
            destination.migration,
          );
          return createFoundryOperationResult({
            operation: "workspace.migrate",
            status: "ready",
            taskId: null,
            artifacts: [
              fileArtifact(
                "migration_activation_receipt",
                path.join(
                  destination.controlRoot,
                  "migrations",
                  activation.plan_sha256,
                  "activation.json",
                ),
              ),
            ],
            blockers: [],
            nextActions: [],
            runtimeIdentity: runtimeIdentity(destination),
            permissions: noPermission(),
          });
        }
        const transfer = input.audit
          ? auditFoundryMigration(destination, planning, input.plan)
          : await stageFoundryMigration(destination, planning, input.plan, {
              signal: options.signal,
            });
        return createFoundryOperationResult({
          operation: "workspace.migrate",
          status: "ready",
          taskId: null,
          artifacts: [fileArtifact("migration_transfer_receipt", transfer.path)],
          blockers: [],
          nextActions: [
            human(
              "complete_migration_adoption",
              "The source snapshot is staged and verified. Complete task adoption and activation audit before running this workspace.",
            ),
          ],
          runtimeIdentity: null,
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.migrate", null, error);
      }
    },
    async migrationAdoption(input: {
      destination: string;
      actorId: string;
      requestId: string;
      stageManifests?: readonly string[];
      externalInputs?: readonly string[];
      plan: unknown;
      tasks: readonly MigrationAdoptionSelection[];
      adoptionPlan?: unknown;
      apply?: boolean;
    }): Promise<FoundryOperationResult> {
      try {
        assertNotInterrupted(options.signal);
        if (!options.workspaceAccess)
          throw new FoundryContextError(
            "workspace_runtime_selection_required",
            "Select an independently trusted Foundry runtime before task adoption.",
          );
        const destination = createFoundryRuntimeContext({
          ...contextOptions(options),
          workspace: input.destination,
        });
        const planning = {
          sourceWorkspace: path.resolve(options.cwd ?? process.cwd(), options.workspace),
          actorId: input.actorId,
          requestId: input.requestId,
          stageManifests: input.stageManifests,
          externalInputs: input.externalInputs,
        };
        if (input.apply) {
          if (input.adoptionPlan === undefined)
            throw new FoundryContextError(
              "migration_adoption_required",
              "Explicit application requires the reviewed adoption plan.",
            );
          const applied = await applyFoundryMigrationAdoption(
            destination,
            planning,
            input.plan,
            input.tasks,
            input.adoptionPlan,
            options.workspaceAccess.manifest,
            {
              runtimeManager: options.runtimeManager,
              createTaskFacade: () =>
                createFoundryFacade({ ...options, workspace: destination.workspaceRoot }),
            },
            { signal: options.signal },
          );
          return createFoundryOperationResult({
            operation: "workspace.migrate",
            status: "ready",
            taskId: null,
            artifacts: [fileArtifact("migration_activation_receipt", applied.path)],
            blockers: [],
            nextActions: applied.activation.tasks.some(
              (task) => task.disposition !== "local-unattempted",
            )
              ? [
                  human(
                    "retained_owner_recovery",
                    "Retained terminal or unresolved legacy work stays under its original owner. Inspect the activation receipt before choosing status/readback recovery.",
                  ),
                ]
              : [],
            runtimeIdentity: runtimeIdentity(destination),
            permissions: noPermission(),
          });
        }
        if (input.adoptionPlan !== undefined)
          throw new FoundryContextError(
            "argument_migration_plan_invalid",
            "Adoption preview reconstructs its plan from independent selections.",
          );
        const planned = await planFoundryMigrationAdoption(
          destination,
          planning,
          input.plan,
          input.tasks,
          options.workspaceAccess.manifest,
        );
        return createFoundryOperationResult({
          operation: "workspace.migrate",
          status: "ready",
          taskId: null,
          artifacts: [inlineArtifact("migration_adoption_plan", planned)],
          blockers: [],
          nextActions: [
            human(
              "review_task_adoption",
              "Review the retained history classes, exact source mapping and current preparation before explicit application.",
            ),
          ],
          runtimeIdentity: runtimeIdentity(destination),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.migrate", null, error);
      }
    },
    async start(input: { specFile: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      let taskId: string | null = null;
      try {
        assertNotInterrupted(options.signal);
        current = base();
        assertFoundryWorkspaceWrite(current);
        if (!current.workspaceId)
          throw new FoundryContextError(
            "workspace_not_initialized",
            "Initialize the selected workspace before starting a task.",
          );
        const selectedSpec = readSpec(path.resolve(current.workspaceRoot, input.specFile));
        const inputs = selectedInputs(current.workspaceRoot, selectedSpec.spec);
        const selectedSeed = seed(selectedSpec.spec, inputs);
        assertNotInterrupted(options.signal);
        const record = await registerFoundryFacadeTask(current, {
          specSource: selectedSpec.fact,
          spec: selectedSpec.spec,
          inputs,
          createOrLoad: (taskId) => {
            const context = createFoundryRuntimeContext({
              ...contextOptions(options),
              workspace: current!.workspaceRoot,
              taskId,
              actorId: selectedSpec.spec.actor_id,
              accountIntent: accountIntent(selectedSpec.spec, options.accountIntent),
              inputs,
            });
            const task = createFoundryRuntime(context).startTask({
              requestId: selectedSpec.spec.request_id,
              lane: selectedSpec.spec.lane,
              profileId: selectedSpec.spec.profile_id,
              targetEntities: [...selectedSpec.spec.target_entities],
              seed: selectedSeed,
              ...(selectedSpec.spec.repair ? { repair: selectedSpec.spec.repair } : {}),
            });
            return {
              created_at_utc: task.job.created_at_utc,
              inputs_sha256: sha256Json(task.sources),
            };
          },
        });
        taskId = record.task_id;
        assertNotInterrupted(options.signal);
        const context = taskContext(options, current, record);
        const inspected = await createFoundryRuntime(context).inspectTask();
        assertNotInterrupted(options.signal);
        loadFoundryFacadeTaskRecord(current, record.task_id, record.spec.actor_id);
        const result = taskProjection(
          "task.start",
          context,
          record,
          inspected,
          runtimeIdentity(context),
        );
        const requestIndex = path.join(
          current.stateRoot,
          "facade-requests",
          `${record.request_sha256}.json`,
        );
        return createFoundryOperationResult({
          ...result,
          operation: "task.start",
          taskId: record.task_id,
          artifacts: [
            fileArtifact("facade_request_index", requestIndex),
            fileArtifact("foundry_job", path.join(context.taskRoot!, "foundry-job.json")),
            ...result.artifacts,
          ],
          nextActions: result.next_actions,
          runtimeIdentity: result.runtime_identity,
          permissions: result.permissions,
        });
      } catch (error) {
        return failure("task.start", taskId, error, current ? runtimeIdentity(current) : null);
      }
    },
    async status(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        assertNotInterrupted(options.signal);
        current = base();
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const inspected = await createFoundryRuntime(context, qualified).inspectTask();
        assertNotInterrupted(options.signal);
        const projection = taskProjection(
          "task.status",
          context,
          record,
          inspected,
          runtimeIdentity(context, qualified),
        );
        if (context.workspaceAccess === "read")
          return createFoundryOperationResult({
            ...projection,
            operation: "task.status",
            taskId: projection.task_id,
            nextActions: [
              human(
                "workspace_read_only",
                "This runtime can inspect retained task evidence. Select a write-qualified runtime before preparation or mutation.",
              ),
            ],
            runtimeIdentity: projection.runtime_identity,
            permissions: projection.permissions,
          });
        return projection;
      } catch (error) {
        return failure(
          "task.status",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
    async resume(input: {
      taskId: string;
      actorId: string;
      semanticInputFile?: string;
      interactionInputFile?: string;
      authorizationInputFile?: string;
      referenceInputFile?: string;
    }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        assertNotInterrupted(options.signal);
        if (
          input.referenceInputFile !== undefined &&
          (typeof input.referenceInputFile !== "string" || !input.referenceInputFile.trim())
        )
          throw new FoundryContextError(
            "reference_input_invalid",
            "An explicit reference input requires one nonempty file path.",
          );
        if (
          input.interactionInputFile !== undefined &&
          (typeof input.interactionInputFile !== "string" || !input.interactionInputFile.trim())
        )
          throw new FoundryContextError(
            "interaction_input_invalid",
            "An explicit interaction input requires one nonempty file path.",
          );
        if (
          [
            input.semanticInputFile,
            input.authorizationInputFile,
            input.referenceInputFile,
            input.interactionInputFile,
          ].filter((file) => file !== undefined).length > 1
        )
          throw new FoundryContextError(
            "task_input_conflict",
            "Submit one task input kind at a time.",
          );
        current = base();
        assertFoundryWorkspaceWrite(current);
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const runtime = createFoundryRuntime(context, qualified);
        const before = await runtime.inspectTask();
        if (
          record.spec.repair &&
          (input.semanticInputFile || input.referenceInputFile || input.interactionInputFile)
        )
          throw new FoundryContextError(
            "repair_revision_required",
            "A repair keeps its before, candidate and contract immutable; changed inputs require an explicit revision.",
          );
        assertNotInterrupted(options.signal);
        loadFoundryFacadeTaskRecord(current, record.task_id, record.spec.actor_id);
        const existing = taskProjection(
          "task.resume",
          context,
          record,
          before,
          runtimeIdentity(context, qualified),
        );
        if (
          (input.referenceInputFile || input.interactionInputFile) &&
          existing.status === "completed"
        )
          throw new FoundryContextError(
            "execution_scope_completed",
            "A completed task cannot replace its reference evidence.",
          );
        if (existing.status === "completed" || existing.status === "blocked") return existing;
        const execution = completedOwnerScopes(context, before.artifacts);
        if (execution.pending.length) {
          if (
            input.authorizationInputFile ||
            input.semanticInputFile ||
            input.referenceInputFile ||
            input.interactionInputFile
          )
            throw new FoundryContextError(
              "execution_recovery_required",
              "Recover the consumed request before submitting changes.",
            );
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Owner readback requires qualified runtime owners.",
            );
          const selected = taskContext(
            options,
            current,
            record,
            before.artifacts.map((entry) => ({
              path: path.join(context.taskRoot!, entry.path),
              bytes: entry.bytes,
              sha256: entry.sha256,
            })),
          );
          await executeFoundryOwnerScope(
            selected,
            qualified,
            before.artifacts,
            execution.pending[0],
            options.authentication,
          );
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        if (input.interactionInputFile) {
          if (execution.consumed.size)
            throw new FoundryContextError(
              "execution_scope_consumed",
              "Recover and preserve consumed scope evidence before changing task decisions.",
            );
          const selected = selectFoundryInteractionInput(context, input.interactionInputFile);
          const facts = before.artifacts.map((entry) => ({
            path: path.join(context.taskRoot!, entry.path),
            bytes: entry.bytes,
            sha256: entry.sha256,
          }));
          await recordFoundryInteractionInput(
            taskContext(options, current, record, facts),
            before.artifacts,
            selected,
            record.spec.target_entities,
          );
          assertNotInterrupted(options.signal);
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        const unresolvedInteraction = currentFoundryInteractionState(context, before.artifacts);
        const hasUnresolvedInteraction = Boolean(
          unresolvedInteraction &&
          (currentFoundryQuestions(unresolvedInteraction.state).length ||
            currentFoundryInvestigations(unresolvedInteraction.state).length),
        );
        if (hasUnresolvedInteraction && input.authorizationInputFile)
          throw new FoundryContextError(
            "interaction_decision_pending",
            "Resolve the current question or investigation before write approval.",
          );
        if (input.referenceInputFile) {
          if (input.authorizationInputFile || input.semanticInputFile || record.spec.preparation)
            throw new FoundryContextError(
              "reference_input_invalid",
              "Select reference evidence separately from approval, semantic input or explicit cleanup.",
            );
          const submission = selectFoundryReferenceInput(context, input.referenceInputFile);
          if (
            execution.completed.has(submission.spec.dataset_type) ||
            execution.requests.some(
              (item) => item.request.policy.dataset_type === submission.spec.dataset_type,
            )
          )
            throw new FoundryContextError(
              "execution_scope_frozen",
              "A prepared or consumed owner scope cannot replace its reference evidence.",
            );
          const selected = taskContext(
            options,
            current,
            record,
            before.artifacts.map((entry) => ({
              path: path.join(context.taskRoot!, entry.path),
              bytes: entry.bytes,
              sha256: entry.sha256,
            })),
          );
          await recordFoundryReferenceInput(selected, before.artifacts, submission);
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        if (input.authorizationInputFile) {
          if (input.semanticInputFile || record.spec.preparation)
            throw new FoundryContextError(
              "task_authorization_input_invalid",
              "Submit approval separately from semantic input or explicit cleanup.",
            );
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Approval admission requires qualified runtime owners.",
            );
          const supplied = selectFoundryAuthorizationInput(context, input.authorizationInputFile);
          if (execution.completed.has(supplied.spec.dataset_type))
            throw new FoundryContextError(
              "execution_scope_completed",
              "A verified scope cannot receive new write approval.",
            );
          const submission = supplied.executionContract
            ? await snapshotFoundryAuthorizationContract(
                taskContext(
                  options,
                  current,
                  record,
                  before.artifacts.map((artifact) => ({
                    path: path.join(context.taskRoot!, artifact.path),
                    bytes: artifact.bytes,
                    sha256: artifact.sha256,
                  })),
                ),
                supplied,
                before.artifacts,
              )
            : supplied;
          const facts = before.artifacts.map((artifact) => ({
            path: path.join(context.taskRoot!, artifact.path),
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          }));
          if (
            submission.executionContract &&
            !facts.some((fact) => fs.realpathSync(fact.path) === submission.executionContract!.path)
          )
            facts.push(submission.executionContract);
          const selected = taskContext(options, current, record, facts);
          await authorizeFoundryWorkflow(
            selected,
            qualified,
            before.artifacts,
            submission,
            options.authentication,
          );
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        if (input.semanticInputFile) {
          if (execution.consumed.size)
            throw new FoundryContextError(
              "execution_scope_consumed",
              "Retain consumed scope rows and their execution evidence.",
            );
          if (record.spec.preparation)
            throw new FoundryContextError(
              "task_semantic_input_invalid",
              "Explicit cleanup tasks do not accept semantic submissions.",
            );
          const submission = selectFoundrySemanticInput(context, input.semanticInputFile);
          const facts = before.artifacts.map((artifact) => ({
            path: path.join(context.taskRoot!, artifact.path),
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          }));
          const selected = taskContext(options, current, record, facts);
          const result = await createFoundryRuntime(selected, qualified).applySemantic(
            before.artifacts,
            submission,
          );
          assertNotInterrupted(options.signal);
          const after = await runtime.inspectTask();
          if (result.status !== "completed")
            return createFoundryOperationResult({
              operation: "task.resume",
              status: "needs_input",
              taskId: record.task_id,
              artifacts: taskArtifacts(context, after),
              blockers: [
                {
                  code: "semantic_input_rejected",
                  message:
                    "Review the registered semantic result and correct the submitted input; prior rows remain current.",
                  scope: record.task_id,
                },
              ],
              nextActions: [
                human(
                  "correct_semantic_input",
                  "Use the semantic-result.json diagnostics and submit corrected input against the current assessment.",
                ),
              ],
              runtimeIdentity: runtimeIdentity(context, qualified),
              permissions: noPermission(),
            });
          return taskProjection(
            "task.resume",
            context,
            record,
            after,
            runtimeIdentity(context, qualified),
          );
        }
        const preparation = record.spec.preparation;
        const workflow = currentWorkflowState(context, before.artifacts);
        if (
          hasUnresolvedInteraction &&
          (workflow.authorization ||
            !independentLocalPreparationPending(record, workflow, before.artifacts))
        )
          return existing;
        if (record.spec.repair && !workflow.authorization && !execution.completed.size) {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_qualification_required",
              "Repair preflight requires the qualified installed owners.",
            );
          await prepareFoundryRepair(
            context,
            qualified,
            before.artifacts,
            options.authentication ?? { mode: "oauth" },
          );
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        const references = inspectFoundryReferences(context, before.artifacts);
        if (
          !preparation &&
          workflow.assessmentComplete &&
          workflow.finalization &&
          references.scope &&
          !references.verified
        ) {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Reference verification requires qualified runtime owners.",
            );
          const selected = taskContext(
            options,
            current,
            record,
            before.artifacts.map((entry) => ({
              path: path.join(context.taskRoot!, entry.path),
              bytes: entry.bytes,
              sha256: entry.sha256,
            })),
          );
          await verifyFoundryReferences(
            selected,
            qualified,
            before.artifacts,
            options.authentication,
          );
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        if (
          !preparation &&
          (record.spec.repair || workflow.assessmentComplete) &&
          workflow.authorization?.value.status === "sealed" &&
          !execution.completed.has(String(workflow.authorization.value.dataset_type))
        ) {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Owner execution requires qualified runtime owners.",
            );
          const selected = taskContext(
            options,
            current,
            record,
            before.artifacts.map((entry) => ({
              path: path.join(context.taskRoot!, entry.path),
              bytes: entry.bytes,
              sha256: entry.sha256,
            })),
          );
          const request = execution.requests.find(
            (item) => item.request.content.authorization === workflow.authorization!.entry.sha256,
          );
          if (request)
            await executeFoundryOwnerScope(
              selected,
              qualified,
              before.artifacts,
              request,
              options.authentication,
            );
          else await prepareFoundryOwnerExecution(selected, before.artifacts);
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        if (
          !preparation &&
          execution.completed.size &&
          workflow.finalization?.value.execution_progress_sha256 !== execution.progressSha256
        ) {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Dependency finalization requires qualified runtime owners.",
            );
          const selected = taskContext(
            options,
            current,
            record,
            before.artifacts.map((entry) => ({
              path: path.join(context.taskRoot!, entry.path),
              bytes: entry.bytes,
              sha256: entry.sha256,
            })),
          );
          await finalizeFoundryWorkflow(
            selected,
            qualified,
            before.artifacts,
            options.authentication,
            undefined,
            { sha256: execution.progressSha256, scopes: execution.completed },
          );
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        const preparedApproval =
          workflow.authorization?.value.status === "authorized_current_rows"
            ? workflow.authorization
            : workflow.preparedApproval;
        if (!preparation && preparedApproval && workflow.authorization?.value.status !== "sealed") {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Approval continuation requires qualified runtime owners.",
            );
          const facts = before.artifacts.map((artifact) => ({
            path: path.join(context.taskRoot!, artifact.path),
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          }));
          const selected = taskContext(options, current, record, facts);
          await continueFoundryPreparedApproval(
            selected,
            qualified,
            before.artifacts,
            preparedApproval,
            options.authentication,
          );
          return taskProjection(
            "task.resume",
            context,
            record,
            await runtime.inspectTask(),
            runtimeIdentity(context, qualified),
          );
        }
        const imported = before.artifacts.some(
          (artifact) => artifact.command === "dataset-tidas-import",
        );
        const contextPrepared = before.artifacts.some(
          (artifact) => artifact.command === "dataset-context-pack",
        );
        const nativeRows = before.artifacts.filter(
          (artifact) =>
            artifact.command === "dataset-tidas-import" &&
            artifact.path.endsWith(".json") &&
            Object.values(datasetTypePlural).includes(
              /^outputs\/import\/[^/]+\/tidas\/([^/]+)\//u.exec(artifact.path)?.[1] ?? "",
            ),
        );
        const rowsPrepared = Boolean(workflow.rows);
        if (!preparation && record.spec.lane === "external-dataset-curated-import" && !imported) {
          if (record.inputs.length !== 1)
            throw new FoundryContextError(
              "task_import_source_required",
              "Select one complete packaged input for native conversion.",
            );
          await runtime.importPackage(record.inputs[0].path);
          assertNotInterrupted(options.signal);
        } else if (!preparation && !contextPrepared) {
          const closureTypes = Object.entries(datasetTypePlural)
            .filter(([, plural]) =>
              nativeRows.some((artifact) => artifact.path.includes(`/tidas/${plural}/`)),
            )
            .map(([type]) => type);
          await runtime.prepareContext([
            ...new Set([...record.spec.target_entities, ...closureTypes]),
          ]);
          assertNotInterrupted(options.signal);
        } else if (!preparation && !rowsPrepared) {
          const facts =
            record.spec.lane === "external-dataset-curated-import"
              ? nativeRows.map((artifact) => ({
                  path: path.join(context.taskRoot!, artifact.path),
                  bytes: artifact.bytes,
                  sha256: artifact.sha256,
                }))
              : record.inputs.filter(
                  (fact) => fact.path === sourcePath(record, record.spec.seed!.path),
                );
          const selected = taskContext(options, current, record, facts);
          await createFoundryRuntime(selected, qualified).materializeRows(
            facts.map((fact) => fact.path),
          );
          assertNotInterrupted(options.signal);
        } else if (
          !preparation &&
          workflow.rows &&
          (workflow.assessmentRemainingTypes.length ||
            (!workflow.assessmentComplete && !workflow.rows.value.sets.length))
        ) {
          const selectedArtifacts = before.artifacts;
          const facts = selectedArtifacts.map((artifact) => ({
            path: path.join(context.taskRoot!, artifact.path),
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          }));
          const rows = workflow.rows
            ? facts.find((fact) => fact.path === workflow.rows!.file)
            : undefined;
          if (!rows)
            throw new FoundryContextError(
              "workflow_rows_required",
              "Registered row preparation is required.",
            );
          const contracts = facts
            .filter((fact) => path.basename(fact.path) === "contract-report.json")
            .map((fact) => fact.path);
          const selected = taskContext(options, current, record, facts);
          const identityReport =
            workflow.identity?.value.status === "completed" ? workflow.identity.file : undefined;
          if (workflow.assessmentRemainingTypes.length)
            await createFoundryRuntime(selected, qualified).assessRows(
              rows.path,
              contracts,
              identityReport,
              {
                scopeType: workflow.assessmentRemainingTypes[0],
                previousAssessment: workflow.assessment?.file,
                interactionSha256:
                  currentFoundryInteractionState(context, before.artifacts)?.entry.sha256 ?? null,
              },
            );
          else
            await createFoundryRuntime(selected, qualified).assessRows(
              rows.path,
              contracts,
              identityReport,
              {
                interactionSha256:
                  currentFoundryInteractionState(context, before.artifacts)?.entry.sha256 ?? null,
              },
            );
          assertNotInterrupted(options.signal);
        } else if (
          !preparation &&
          workflow.assessmentComplete &&
          (existing.status === "ready" || workflow.identity?.value.status === "blocked") &&
          (!workflow.identity || workflow.identity.value.status === "blocked") &&
          workflow.rows?.value.sets.some((set) => ["flow", "process"].includes(set.type))
        ) {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Identity preflight requires qualified runtime owners.",
            );
          const facts = before.artifacts.map((artifact) => ({
            path: path.join(context.taskRoot!, artifact.path),
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          }));
          const selected = taskContext(options, current, record, facts);
          const result = await runFoundryWorkflowIdentity(
            selected,
            qualified,
            before.artifacts,
            options.authentication,
          );
          if (result.status !== "completed") {
            const after = await runtime.inspectTask();
            return createFoundryOperationResult({
              operation: "task.resume",
              status: "needs_input",
              taskId: record.task_id,
              artifacts: taskArtifacts(context, after),
              blockers: [
                {
                  code: "identity_preflight_requires_input",
                  message:
                    "Review the registered identity preflight diagnostics before continuing.",
                  scope: record.task_id,
                },
              ],
              nextActions: [],
              runtimeIdentity: runtimeIdentity(context, qualified),
              permissions: noPermission(),
            });
          }
        }
        if (
          !preparation &&
          existing.status === "ready" &&
          workflow.assessmentComplete &&
          !workflow.finalization &&
          (workflow.identity?.value.status === "completed" ||
            !workflow.rows?.value.sets.some((set) => ["flow", "process"].includes(set.type)))
        ) {
          if (!qualified)
            throw new FoundryContextError(
              "runtime_unqualified",
              "Finalization requires qualified runtime owners.",
            );
          const facts = before.artifacts.map((artifact) => ({
            path: path.join(context.taskRoot!, artifact.path),
            bytes: artifact.bytes,
            sha256: artifact.sha256,
          }));
          const selected = taskContext(options, current, record, facts);
          await finalizeFoundryWorkflow(
            selected,
            qualified,
            before.artifacts,
            options.authentication,
          );
          assertNotInterrupted(options.signal);
        }
        if (preparation) {
          assertNotInterrupted(options.signal);
          await runtime.cleanup({
            input: sourcePath(record, preparation.input),
            type: preparation.type,
            outputDirectory: preparation.output_directory,
            sourceInput: preparation.source_input
              ? sourcePath(record, preparation.source_input)
              : undefined,
            profileId: record.spec.profile_id,
          });
          assertNotInterrupted(options.signal);
        }
        const inspected = await runtime.inspectTask();
        assertNotInterrupted(options.signal);
        const projected = taskProjection(
          "task.resume",
          context,
          record,
          inspected,
          runtimeIdentity(context, qualified),
        );
        if (!preparation) return projected;
        const artifacts = [...projected.artifacts];
        const cleaned = artifacts.find((artifact) =>
          artifact.kind === "file" ? /\.cleaned\.jsonl$/u.test(artifact.path) : false,
        );
        return createFoundryOperationResult({
          operation: "task.resume",
          status: projected.status,
          taskId: record.task_id,
          artifacts: cleaned
            ? [
                Object.freeze({ ...cleaned, role: "cleaned_rows" }),
                ...artifacts.filter((item) => item !== cleaned),
              ]
            : artifacts,
          blockers: projected.blockers,
          nextActions: projected.next_actions,
          runtimeIdentity: projected.runtime_identity,
          permissions: projected.permissions,
        });
      } catch (error) {
        return failure(
          "task.resume",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
    requestBinding(input: { taskId: string; actorId: string }): string {
      assertNotInterrupted(options.signal);
      const current = base();
      const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
      assertNotInterrupted(options.signal);
      return sha256Json({
        workspace_id: current.workspaceId,
        task_id: record.task_id,
        revision: record.revision,
        fingerprint_sha256: record.fingerprint_sha256,
        cwd: current.workspaceRoot,
      });
    },
  });
}
