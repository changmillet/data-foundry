import { createFoundryRuntime } from "../../foundry-runtime.ts";
import type { FoundryFacadeTaskRecord } from "../foundry-facade-store.ts";
import { currentFoundryInteractionState } from "../foundry-interaction-input.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationResult,
} from "../foundry-operation-result.ts";
import {
  type completedOwnerScopes,
  prepareFoundryOwnerExecution,
} from "../foundry-owner-execution-store.ts";
import {
  type createFoundryRuntimeContext,
  FoundryContextError,
} from "../foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "../foundry-runtime-qualification.ts";
import type { ArtifactEntry } from "../foundry-task-types.ts";
import { continueFoundryPreparedApproval } from "../foundry-workflow-approval-continuation.ts";
import { executeFoundryOwnerScope } from "../foundry-workflow-execution.ts";
import { finalizeFoundryWorkflow } from "../foundry-workflow-finalize.ts";
import { runFoundryWorkflowIdentity } from "../foundry-workflow-identity.ts";
import { currentFoundryInteractionWriteBlocker } from "../foundry-workflow-object-scope.ts";
import {
  inspectFoundryReferences,
  verifyFoundryReferences,
} from "../foundry-workflow-reference-verify.ts";
import { prepareFoundryRepair } from "../foundry-workflow-repair.ts";
import { currentWorkflowState } from "../foundry-workflow-state.ts";
import { datasetTypePlural } from "../import-curation/internal/dataset-types.ts";
import {
  assertNotInterrupted,
  type FoundryFacadeOptions,
  independentLocalPreparationPending,
  noPermission,
  runtimeIdentity,
  sourcePath,
  taskArtifactInputFacts,
  taskArtifacts,
  taskContext,
} from "./facade-support.ts";
import { taskProjection } from "./facade-task-projection.ts";

export interface AutomaticResumeParams {
  options: FoundryFacadeOptions;
  current: ReturnType<typeof createFoundryRuntimeContext>;
  record: FoundryFacadeTaskRecord;
  context: ReturnType<typeof createFoundryRuntimeContext>;
  qualified: QualifiedFoundryRuntime | undefined;
  runtime: ReturnType<typeof createFoundryRuntime>;
  before: { artifacts: readonly ArtifactEntry[] };
  existing: FoundryOperationResult;
  execution: ReturnType<typeof completedOwnerScopes>;
  hasUnresolvedInteraction: boolean;
}

export async function runAutomaticResumeStage({
  options,
  current,
  record,
  context,
  qualified,
  runtime,
  before,
  existing,
  execution,
  hasUnresolvedInteraction,
}: AutomaticResumeParams): Promise<FoundryOperationResult> {
  const preparation = record.spec.preparation;
  const workflow = currentWorkflowState(context, before.artifacts);
  if (
    (workflow.authorization || workflow.preparedApproval) &&
    currentFoundryInteractionWriteBlocker(context, before.artifacts)
  )
    return existing;
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
      taskArtifactInputFacts(context, before.artifacts),
    );
    await verifyFoundryReferences(selected, qualified, before.artifacts, options.authentication);
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
      taskArtifactInputFacts(context, before.artifacts),
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
      taskArtifactInputFacts(context, before.artifacts),
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
    const selected = taskContext(
      options,
      current,
      record,
      taskArtifactInputFacts(context, before.artifacts),
    );
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
  const imported = before.artifacts.some((artifact) => artifact.command === "dataset-tidas-import");
  const contextPrepared = workflow.currentContextReports.length > 0;
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
    await runtime.prepareContext([...new Set([...record.spec.target_entities, ...closureTypes])]);
    assertNotInterrupted(options.signal);
  } else if (!preparation && !rowsPrepared) {
    const facts =
      record.spec.lane === "external-dataset-curated-import"
        ? taskArtifactInputFacts(context, nativeRows)
        : record.inputs.filter((fact) => fact.path === sourcePath(record, record.spec.seed!.path));
    const selected = taskContext(options, current, record, facts);
    await createFoundryRuntime(selected, qualified).materializeRows(facts.map((fact) => fact.path));
    assertNotInterrupted(options.signal);
  } else if (
    !preparation &&
    workflow.rows &&
    (workflow.assessmentRemainingTypes.length ||
      (!workflow.assessmentComplete && !workflow.rows.value.sets.length))
  ) {
    const facts = taskArtifactInputFacts(context, before.artifacts);
    const rows = workflow.rows
      ? facts.find((fact) => fact.path === workflow.rows!.file)
      : undefined;
    if (!rows)
      throw new FoundryContextError(
        "workflow_rows_required",
        "Registered row preparation is required.",
      );
    const contracts = workflow.currentContextReports;
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
          qualityReviewSha256: workflow.qualityReviewSha256,
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
          qualityReviewSha256: workflow.qualityReviewSha256,
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
    const facts = taskArtifactInputFacts(context, before.artifacts);
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
            message: "Review the registered identity preflight diagnostics before continuing.",
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
    const facts = taskArtifactInputFacts(context, before.artifacts);
    const selected = taskContext(options, current, record, facts);
    await finalizeFoundryWorkflow(selected, qualified, before.artifacts, options.authentication);
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
}
