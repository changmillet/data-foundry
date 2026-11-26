import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createFoundryRuntime } from "../../foundry-runtime.ts";
import {
  loadFoundryFacadeTaskRecord,
  type FoundryFacadeTaskRecord,
} from "../foundry-facade-store.ts";
import {
  commandNextActionBindingSha256,
  createFoundryOperationResult,
  type FoundryOperationArtifact,
  type FoundryOperationNextAction,
  type FoundryOperationPermissions,
  type FoundryOperationResult,
  type FoundryPublicOperation,
} from "../foundry-operation-result.ts";
import { assertFoundryCacheRootSeparated } from "../foundry-runtime-cache.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  FoundryContextError,
  type FoundryAccountIntent,
  type FoundryInputFact,
  type FoundryRuntimeContextOptions,
  type FoundryWorkspaceAccess,
} from "../foundry-runtime-context.ts";
import type { FoundryAuthentication } from "../foundry-runtime-identity.ts";
import {
  qualifyFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "../foundry-runtime-qualification.ts";
import type { FoundryRuntimeManagerOptions } from "../foundry-runtime-selection.ts";
import {
  assertAdoptedRuntimeToolkit,
  type TrustedFoundryRuntimeAdoptionQualification,
} from "../foundry-task-runtime-adoption.ts";
import {
  parseFoundryTaskStartSpec,
  type FoundryTaskStartSpec,
} from "../foundry-task-start-spec.ts";
import type { ArtifactEntry } from "../foundry-task-types.ts";
import { WorkflowChildFailure } from "../foundry-workflow-child-failure.ts";
import { currentWorkflowState } from "../foundry-workflow-state.ts";

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
  readonly runtimeAdoptionQualification?: TrustedFoundryRuntimeAdoptionQualification;
}

export const maxSpecBytes = 1024 * 1024;
export const maxSeedBytes = 8 * 1024 * 1024;
export const maxQueueBytes = 32 * 1024 * 1024;

export function readCaptured(fact: FoundryInputFact, maxBytes: number, code: string): Buffer {
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

export function fileArtifact(role: string, file: string): FoundryOperationArtifact {
  const fact = captureFoundryInput(file);
  return Object.freeze({ kind: "file", role, ...fact });
}

export function inlineArtifact(role: string, value: unknown): FoundryOperationArtifact {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return Object.freeze({
    kind: "inline",
    role,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value,
  });
}

export function human(code: string, instructions: string): FoundryOperationNextAction {
  return Object.freeze({ kind: "human", code, instructions });
}

export function resumeCommand(
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

export function noPermission(): FoundryOperationPermissions {
  return Object.freeze({
    state: "not_required",
    requested_actions: Object.freeze([]),
    approval_reference: null,
  });
}

export function assertNotInterrupted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new FoundryContextError(
      "operation_interrupted",
      "Operation was interrupted; retained evidence must be inspected before resume.",
    );
}

export function contextOptions(options: FoundryFacadeOptions): FoundryRuntimeContextOptions {
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

export function accountReadiness(context: ReturnType<typeof createFoundryRuntimeContext>) {
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

export function qualification(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  selected: FoundryFacadeRuntimeSelection | undefined,
  allowTransition = false,
): QualifiedFoundryRuntime | undefined {
  const qualified = selected
    ? qualifyFoundryRuntime(context, {
        cliExpectation: selected.cliExpectation,
        tidasExpectation: selected.tidasExpectation,
        tidasExecutable: selected.tidasExecutable,
      })
    : undefined;
  assertAdoptedRuntimeToolkit(context, qualified, allowTransition);
  return qualified;
}

export function runtimeIdentity(
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

export function failure(
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
      "BATCH_RUN_LOCK_TIMEOUT",
      "BATCH_RUN_LOCK_IDENTITY_CONFLICT",
      "ERR_SYSTEM_ERROR",
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
  const recoveryUnproven = code === "identity_preflight_recovery_unproven";
  const stageInput = code.startsWith("identity_stage_");
  const needsAuth =
    !recoveryUnproven && !stageInput && (code === "needs_auth" || code.startsWith("identity_"));
  const needsInputCodes = new Set([
    "identity_preflight_recovery_unproven",
    "identity_stage_unproven",
    "identity_stage_input_invalid",
    "identity_stage_interrupted",
    "interaction_decision_pending",
    "interaction_investigation_pending",
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
    "runtime_adoption_plan_stale",
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
    artifacts:
      error instanceof WorkflowChildFailure && error.retainedArtifact
        ? [{ kind: "file", role: "workflow-child-failure.json", ...error.retainedArtifact }]
        : [],
    blockers: [{ code, message, scope: taskId }],
    nextActions: recoveryUnproven
      ? [
          human(
            "verify_original_identity_recovery",
            `Recovery remains UNKNOWN for original task ${taskId}. Verify the retained original producer, receipt, request and attempt binding through this task's recovery entry. Preserve the original attempt and do not repeat its CLI query.`,
          ),
        ]
      : code === "identity_stage_unproven"
        ? [
            human(
              "inspect_identity_stage",
              "Inspect the indexed claim and retained outcome of the explicitly new read-only stage. Preserve UNKNOWN and do not dispatch another query through ordinary resume.",
            ),
          ]
        : error instanceof WorkflowChildFailure
          ? [human("repair_failed_local_operation", error.message)]
          : [],
    runtimeIdentity: identity,
    permissions: noPermission(),
  });
}

export function readSpec(file: string): { fact: FoundryInputFact; spec: FoundryTaskStartSpec } {
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

export function selectedInputs(
  workspaceRoot: string,
  spec: FoundryTaskStartSpec,
): readonly FoundryInputFact[] {
  return Object.freeze(
    spec.sources.map((source) => captureFoundryInput(path.resolve(workspaceRoot, source.path))),
  );
}

export function accountIntent(spec: FoundryTaskStartSpec, host?: FoundryAccountIntent) {
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

export function seed(spec: FoundryTaskStartSpec, inputs: readonly FoundryInputFact[]) {
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

export function taskContext(
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

export function sourcePath(record: FoundryFacadeTaskRecord, selected: string): string {
  const index = record.spec.sources.findIndex((source) => source.path === selected);
  const fact = record.inputs[index];
  if (!fact)
    throw new FoundryContextError(
      "task_spec_preparation_invalid",
      "Preparation input has no registered source fact.",
    );
  return fact.path;
}

export function taskArtifacts(
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

export function completionProven(
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

export function independentLocalPreparationPending(
  record: FoundryFacadeTaskRecord,
  workflow: ReturnType<typeof currentWorkflowState>,
  entries: readonly ArtifactEntry[],
): boolean {
  if (record.spec.repair) return false;
  if (record.spec.preparation)
    return !entries.some((entry) => entry.command === "dataset-curation-cleanup");
  return !workflow.rows || workflow.assessmentRemainingTypes.length > 0;
}

export function taskArtifactInputFacts(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  entries: readonly ArtifactEntry[],
): FoundryInputFact[] {
  return entries.map((entry) => ({
    path: path.join(context.taskRoot!, entry.path),
    bytes: entry.bytes,
    sha256: entry.sha256,
  }));
}

export { loadFoundryFacadeTaskRecord };
