import fs from "node:fs";
import path from "node:path";
import { createFoundryRuntime } from "../../foundry-runtime.ts";
import {
  selectFoundryAuthorizationInput,
  snapshotFoundryAuthorizationContract,
} from "../foundry-authorization-input.ts";
import type { FoundryFacadeTaskRecord } from "../foundry-facade-store.ts";
import { selectFoundryIdentityStageInput } from "../foundry-identity-stage-input.ts";
import { selectFoundryInteractionInput } from "../foundry-interaction-input.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationResult,
} from "../foundry-operation-result.ts";
import type { completedOwnerScopes } from "../foundry-owner-execution-store.ts";
import { selectFoundryQualityReviewInput } from "../foundry-quality-review-input.ts";
import { recordFoundryQualityReview } from "../foundry-quality-review.ts";
import {
  recordFoundryReferenceInput,
  selectFoundryReferenceInput,
} from "../foundry-reference-input.ts";
import {
  type createFoundryRuntimeContext,
  FoundryContextError,
  resolveFoundryOutput,
} from "../foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "../foundry-runtime-qualification.ts";
import { selectFoundrySemanticInput } from "../foundry-semantic-input.ts";
import type { ArtifactEntry } from "../foundry-task-types.ts";
import { authorizeFoundryWorkflow } from "../foundry-workflow-authorization.ts";
import { executeFoundryOwnerScope } from "../foundry-workflow-execution.ts";
import { runExplicitFoundryIdentityStage } from "../foundry-workflow-identity-stage.ts";
import { recordFoundryInteractionInput } from "../foundry-workflow-interaction.ts";
import { currentFoundryInteractionWriteBlocker } from "../foundry-workflow-object-scope.ts";
import { readWorkflowArtifact, workflowObject } from "../foundry-workflow-state.ts";
import {
  assertNotInterrupted,
  type FoundryFacadeOptions,
  human,
  inlineArtifact,
  noPermission,
  runtimeIdentity,
  taskArtifactInputFacts,
  taskArtifacts,
  taskContext,
} from "./facade-support.ts";
import { taskProjection } from "./facade-task-projection.ts";

export interface FoundryResumeInput {
  taskId: string;
  actorId: string;
  semanticInputFile?: string;
  interactionInputFile?: string;
  authorizationInputFile?: string;
  referenceInputFile?: string;
  identityStageInputFile?: string;
  qualityReviewInputFile?: string;
}

export interface ResumeStageBaseParams {
  options: FoundryFacadeOptions;
  current: ReturnType<typeof createFoundryRuntimeContext>;
  record: FoundryFacadeTaskRecord;
  context: ReturnType<typeof createFoundryRuntimeContext>;
  qualified: QualifiedFoundryRuntime | undefined;
  runtime: ReturnType<typeof createFoundryRuntime>;
  before: { artifacts: readonly ArtifactEntry[] };
  input: FoundryResumeInput;
}

export interface ResumeStageExecutionParams extends ResumeStageBaseParams {
  execution: ReturnType<typeof completedOwnerScopes>;
}

export function validateResumeInputFlags(input: FoundryResumeInput): void {
  if (
    input.identityStageInputFile !== undefined &&
    (typeof input.identityStageInputFile !== "string" || !input.identityStageInputFile.trim())
  )
    throw new FoundryContextError(
      "identity_stage_input_invalid",
      "An explicit identity stage requires one nonempty file path.",
    );
  if (
    input.qualityReviewInputFile !== undefined &&
    (typeof input.qualityReviewInputFile !== "string" || !input.qualityReviewInputFile.trim())
  )
    throw new FoundryContextError(
      "quality_review_input_invalid",
      "Select one nonempty quality-review input path.",
    );
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
      input.identityStageInputFile,
      input.qualityReviewInputFile,
    ].filter((file) => file !== undefined).length > 1
  )
    throw new FoundryContextError("task_input_conflict", "Submit one task input kind at a time.");
}

export async function handleExplicitIdentityStageResume(
  { options, current, record, context, qualified, runtime, before }: ResumeStageBaseParams,
  identityStageInputFile: string,
): Promise<FoundryOperationResult> {
  if (!qualified)
    throw new FoundryContextError(
      "runtime_unqualified",
      "An explicit read-only identity stage requires exact qualified runtime owners.",
    );
  if (
    record.spec.lane !== "source-evidence-dataset-development" ||
    record.spec.preparation ||
    record.spec.repair
  )
    throw new FoundryContextError(
      "identity_stage_input_invalid",
      "An explicit identity stage applies only to the original source-evidence Task.",
    );
  const selected = selectFoundryIdentityStageInput(context, identityStageInputFile);
  const rowsEntry = before.artifacts.find(
    (entry) =>
      ["dataset-workflow-rows", "dataset-semantic-apply"].includes(entry.command) &&
      path.basename(entry.path) === "foundry-rows.json" &&
      entry.sha256 === selected.value.rows_report_sha256,
  );
  const priorEntry = before.artifacts.find(
    (entry) =>
      entry.command === "dataset-workflow-identity" &&
      path.basename(entry.path) === "foundry-identity.json" &&
      entry.sha256 === selected.value.predecessor_identity_sha256,
  );
  if (!rowsEntry || !priorEntry)
    throw new FoundryContextError(
      "identity_stage_input_invalid",
      "Explicit identity stage must bind registered original rows and predecessor identity.",
    );
  const rowReport = readWorkflowArtifact(context, rowsEntry).value;
  if (!Array.isArray(rowReport.sets))
    throw new FoundryContextError(
      "workflow_rows_invalid",
      "Registered row report has no exact row sets.",
    );
  const rowFiles = rowReport.sets.map((set) => workflowObject(set).file);
  const fixedEntries = [
    rowsEntry,
    priorEntry,
    ...rowFiles.map((file) => {
      if (typeof file !== "string")
        throw new FoundryContextError("workflow_rows_invalid", "Registered row file is invalid.");
      const entry = before.artifacts.find(
        (item) => resolveFoundryOutput(context, item.path) === file,
      );
      if (!entry)
        throw new FoundryContextError(
          "workflow_rows_invalid",
          "Registered row file lacks its producer.",
        );
      return entry;
    }),
  ];
  const fixedContext = taskContext(
    options,
    current,
    record,
    fixedEntries.map((entry) => ({
      path: resolveFoundryOutput(context, entry.path),
      bytes: entry.bytes,
      sha256: entry.sha256,
    })),
  );
  const stage = await runExplicitFoundryIdentityStage(
    fixedContext,
    qualified,
    before.artifacts,
    selected,
    options.authentication,
    { signal: options.signal },
  );
  const inspected = await runtime.inspectTask();
  const projected = taskProjection(
    "task.resume",
    context,
    record,
    inspected,
    runtimeIdentity(context, qualified),
  );
  const stageStatus = stage.status;
  const stageUnproven =
    stageStatus === "unproven" ||
    (stageStatus === "blocked" &&
      Array.isArray(stage.blockers) &&
      stage.blockers.some(
        (item) => workflowObject(item).code === "identity_stage_outcome_unproven",
      ));
  if (stageUnproven || stageStatus === "running")
    return createFoundryOperationResult({
      operation: "task.resume",
      taskId: record.task_id,
      status: stageStatus === "running" ? "running" : "needs_input",
      artifacts: [
        ...projected.artifacts,
        inlineArtifact("explicit_readonly_identity_stage", stage),
      ],
      blockers: [
        {
          code: stageStatus === "running" ? "identity_stage_running" : "identity_stage_unproven",
          message:
            "Inspect the retained explicit-stage admission and execution evidence. An incomplete dispatched read-only query cannot be repeated automatically.",
          scope: record.task_id,
        },
      ],
      nextActions: [
        human(
          "inspect_identity_stage",
          "Preserve the original Task and read its indexed new-stage evidence; no query or write replay is permitted.",
        ),
      ],
      runtimeIdentity: projected.runtime_identity,
      permissions: noPermission(),
    });
  return createFoundryOperationResult({
    operation: "task.resume",
    taskId: record.task_id,
    status: projected.status,
    artifacts: [...projected.artifacts, inlineArtifact("explicit_readonly_identity_stage", stage)],
    blockers: projected.blockers,
    nextActions: projected.next_actions,
    runtimeIdentity: projected.runtime_identity,
    permissions: noPermission(),
  });
}

export async function handlePendingOwnerReadbackResume({
  options,
  current,
  record,
  context,
  qualified,
  runtime,
  before,
  input,
  execution,
}: ResumeStageExecutionParams): Promise<FoundryOperationResult> {
  if (
    input.authorizationInputFile ||
    input.semanticInputFile ||
    input.referenceInputFile ||
    input.interactionInputFile ||
    input.qualityReviewInputFile
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
    taskArtifactInputFacts(context, before.artifacts),
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

export async function handleInteractionInputResume(
  {
    options,
    current,
    record,
    context,
    qualified,
    runtime,
    before,
    execution,
  }: ResumeStageExecutionParams,
  interactionInputFile: string,
): Promise<FoundryOperationResult> {
  if (execution.consumed.size)
    throw new FoundryContextError(
      "execution_scope_consumed",
      "Recover and preserve consumed scope evidence before changing task decisions.",
    );
  const selected = selectFoundryInteractionInput(context, interactionInputFile);
  await recordFoundryInteractionInput(
    taskContext(options, current, record, taskArtifactInputFacts(context, before.artifacts)),
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

export async function handleReferenceInputResume(
  {
    options,
    current,
    record,
    context,
    qualified,
    runtime,
    before,
    input,
    execution,
  }: ResumeStageExecutionParams,
  referenceInputFile: string,
): Promise<FoundryOperationResult> {
  if (input.authorizationInputFile || input.semanticInputFile || record.spec.preparation)
    throw new FoundryContextError(
      "reference_input_invalid",
      "Select reference evidence separately from approval, semantic input or explicit cleanup.",
    );
  const submission = selectFoundryReferenceInput(context, referenceInputFile);
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
    taskArtifactInputFacts(context, before.artifacts),
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

export async function handleQualityReviewInputResume(
  { options, current, record, context, qualified, runtime, before }: ResumeStageBaseParams,
  qualityReviewInputFile: string,
): Promise<FoundryOperationResult> {
  if (record.spec.preparation || record.spec.repair)
    throw new FoundryContextError(
      "quality_review_input_invalid",
      "Quality review requires an ordinary assessed Process task.",
    );
  if (!qualified)
    throw new FoundryContextError(
      "runtime_unqualified",
      "Quality review requires qualified runtime owners.",
    );
  const selected = taskContext(
    options,
    current,
    record,
    taskArtifactInputFacts(context, before.artifacts),
  );
  const submission = selectFoundryQualityReviewInput(selected, qualityReviewInputFile);
  await recordFoundryQualityReview(selected, qualified, before.artifacts, submission);
  return taskProjection(
    "task.resume",
    context,
    record,
    await runtime.inspectTask(),
    runtimeIdentity(context, qualified),
  );
}

export async function handleAuthorizationInputResume(
  {
    options,
    current,
    record,
    context,
    qualified,
    runtime,
    before,
    input,
    execution,
  }: ResumeStageExecutionParams,
  authorizationInputFile: string,
): Promise<FoundryOperationResult> {
  const interactionBlocker = currentFoundryInteractionWriteBlocker(context, before.artifacts);
  if (interactionBlocker)
    throw new FoundryContextError(interactionBlocker.code, interactionBlocker.message);
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
  const supplied = selectFoundryAuthorizationInput(context, authorizationInputFile);
  if (execution.completed.has(supplied.spec.dataset_type))
    throw new FoundryContextError(
      "execution_scope_completed",
      "A verified scope cannot receive new write approval.",
    );
  const facts = taskArtifactInputFacts(context, before.artifacts);
  const submission = supplied.executionContract
    ? await snapshotFoundryAuthorizationContract(
        taskContext(options, current, record, facts),
        supplied,
        before.artifacts,
      )
    : supplied;
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

export async function handleSemanticInputResume(
  {
    options,
    current,
    record,
    context,
    qualified,
    runtime,
    before,
    execution,
  }: ResumeStageExecutionParams,
  semanticInputFile: string,
): Promise<FoundryOperationResult> {
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
  const submission = selectFoundrySemanticInput(context, semanticInputFile);
  const selected = taskContext(
    options,
    current,
    record,
    taskArtifactInputFacts(context, before.artifacts),
  );
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
  return taskProjection("task.resume", context, record, after, runtimeIdentity(context, qualified));
}
