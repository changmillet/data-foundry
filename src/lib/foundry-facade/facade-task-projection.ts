import path from "node:path";
import type { createFoundryRuntime } from "../../foundry-runtime.ts";
import type { FoundryFacadeTaskRecord } from "../foundry-facade-store.ts";
import { pendingFoundryIdentityStage } from "../foundry-identity-stage-state.ts";
import {
  currentFoundryInteractionState,
  currentFoundryInvestigations,
  currentFoundryQuestions,
} from "../foundry-interaction-input.ts";
import { currentNativeValidationFailure } from "../foundry-native-validation-failure.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationResult,
} from "../foundry-operation-result.ts";
import { completedOwnerScopes } from "../foundry-owner-execution-store.ts";
import {
  createFoundryQualityReviewTemplate,
  foundryQualityReviewScope,
} from "../foundry-quality-review.ts";
import { assertFoundryRepairExecution } from "../foundry-repair-execution.ts";
import {
  type createFoundryRuntimeContext,
  FoundryContextError,
} from "../foundry-runtime-context.ts";
import { readWorkflowChildFailure } from "../foundry-workflow-child-failure.ts";
import {
  currentFoundryInteractionWriteBlocker,
  currentFoundryNarrowObjects,
  currentFoundryObjectDecisionReassessments,
  currentFoundryObjectScopeIsBound,
  currentFoundryObjectScopes,
  indexedFoundryRowAdoptions,
} from "../foundry-workflow-object-scope.ts";
import { inspectFoundryReferences } from "../foundry-workflow-reference-verify.ts";
import { readFoundryRepairPreparation } from "../foundry-workflow-repair.ts";
import { currentWorkflowState, workflowObject } from "../foundry-workflow-state.ts";
import {
  buildDecisionRecapArtifact,
  currentIndexedQueueBlockers,
  projectPendingAssessmentStage,
  scopedAuthoringPresentation,
} from "./facade-queue-and-scope.ts";
import {
  completionProven,
  human,
  independentLocalPreparationPending,
  inlineArtifact,
  maxSeedBytes,
  noPermission,
  readCaptured,
  resumeCommand,
  taskArtifacts,
} from "./facade-support.ts";

export function taskProjection(
  operation: "task.start" | "task.status" | "task.resume",
  context: ReturnType<typeof createFoundryRuntimeContext>,
  record: FoundryFacadeTaskRecord,
  inspected: Awaited<ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>>,
  identity: unknown,
): FoundryOperationResult {
  const artifacts = taskArtifacts(context, inspected);
  const childFailure = readWorkflowChildFailure(context, inspected.artifacts);
  if (childFailure) {
    const file = path.join(context.taskRoot!, childFailure.entry.path);
    const message = `The original local CLI ${childFailure.failure.kind} failure is retained at ${file}. The operation remains failed. Repair the runtime or selected input and use an explicitly reviewed task revision; this task cannot rerun the failed call.`;
    return createFoundryOperationResult({
      operation,
      status: "blocked",
      taskId: record.task_id,
      artifacts,
      blockers: [
        { code: "workflow_child_failed", message, scope: String(childFailure.result.command) },
      ],
      nextActions: [human("repair_failed_local_operation", message)],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  }
  let projectedWorkflow: ReturnType<typeof currentWorkflowState> | undefined;
  let qualityScope: ReturnType<typeof foundryQualityReviewScope> = null;
  const qualifiedIdentity = workflowObject(workflowObject(identity).qualification ?? {}).identity;
  if (qualifiedIdentity && context.accountIntent) {
    const digest = workflowObject(qualifiedIdentity).qualification_sha256;
    if (typeof digest === "string") {
      projectedWorkflow = currentWorkflowState(context, inspected.artifacts);
      qualityScope = foundryQualityReviewScope(
        context,
        digest,
        inspected.artifacts,
        projectedWorkflow,
      );
      if (qualityScope) {
        artifacts.push(inlineArtifact("quality_review_scope", qualityScope));
        artifacts.push(
          inlineArtifact(
            "quality_review_input_template",
            createFoundryQualityReviewTemplate(qualityScope),
          ),
        );
      }
    }
  }
  const interaction = currentFoundryInteractionState(context, inspected.artifacts);
  const pendingQuestions = interaction ? currentFoundryQuestions(interaction.state) : [];
  const investigations = interaction ? currentFoundryInvestigations(interaction.state) : [];
  const narrow = interaction ? currentFoundryNarrowObjects(interaction.state) : [];
  const objectAdoptions =
    interaction && narrow.length ? indexedFoundryRowAdoptions(context, inspected.artifacts) : [];
  const objectScopes = narrow.length
    ? currentFoundryObjectScopes(context, inspected.artifacts)
    : new Map();
  const reassessments = interaction
    ? currentFoundryObjectDecisionReassessments(interaction.state, objectScopes, objectAdoptions)
    : [];
  const staleObjects = narrow.filter(
    (item) =>
      !currentFoundryObjectScopeIsBound(
        context,
        inspected.artifacts,
        interaction!.state,
        objectScopes,
        item.dataset_type,
        item.entity_id,
        item.version,
        objectAdoptions,
      ),
  );
  const objectEvidenceCurrent = staleObjects.length === 0;
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
  const makeRecap = (isComplete: boolean) =>
    buildDecisionRecapArtifact(
      record,
      interaction,
      objectAdoptions,
      pendingQuestions,
      investigations,
      isComplete,
    );
  if (record.spec.brief || interaction) artifacts.push(makeRecap(false));
  const completedArtifacts = () =>
    record.spec.brief || interaction
      ? [...artifacts.filter((artifact) => artifact.role !== "decision_recap"), makeRecap(true)]
      : artifacts;
  if (
    completionProven(context, record, inspected) &&
    !pendingQuestions.length &&
    !investigations.length &&
    !reassessments.length &&
    objectEvidenceCurrent &&
    !currentFoundryInteractionWriteBlocker(context, inspected.artifacts)
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
  const pendingIdentity = pendingFoundryIdentityStage(context, inspected.artifacts);
  if (pendingIdentity)
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts: [
        ...artifacts,
        inlineArtifact("explicit_readonly_identity_stage", pendingIdentity),
      ],
      blockers: [
        {
          code: "identity_stage_unproven",
          message:
            "The indexed explicit read-only stage has no proven completed outcome. Preserve UNKNOWN and inspect its retained admission and claims.",
          scope: record.task_id,
        },
      ],
      nextActions: [
        human(
          "inspect_identity_stage",
          "Inspect the indexed new-stage evidence. Ordinary resume cannot repeat the query or proceed to write stages.",
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
  const workflow = projectedWorkflow ?? currentWorkflowState(context, inspected.artifacts);
  const queueIssues = currentIndexedQueueBlockers(context, workflow, inspected.artifacts);
  const nativeFailure = currentNativeValidationFailure(
    context,
    inspected.artifacts,
    workflow.rows
      ? {
          file: workflow.rows.file,
          sha256: workflow.rows.entry.sha256,
          sets: workflow.rows.value.sets,
        }
      : null,
  );
  if (nativeFailure) {
    const report = nativeFailure.result;
    const type = String(report.dataset_type);
    const label = `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`;
    const code = String(report.diagnostic_code);
    const detail = String(report.diagnostic_message);
    const normalized = detail.replace(/\s+/gu, " ").trim();
    const preview = normalized.length > 240 ? `${normalized.slice(0, 237)}…` : normalized;
    const rowCount = Number(report.row_count);
    const affectedRows = `${rowCount} selected ${label} row${rowCount === 1 ? "" : "s"}`;
    const failureKind =
      report.exit_class === "io"
        ? `${context.platform.startsWith("win32") ? "Windows " : ""}file I/O`
        : "native validation";
    const message = `Native ${label} validation stopped on ${failureKind} (${report.exit_class}/${code}): ${preview} The ${affectedRows} remain unassessed; no write can proceed. Inspect the complete indexed diagnostic at ${nativeFailure.file}, correct the native runtime or filesystem failure, and start an explicitly reviewed task revision under the replacement runtime.`;
    return createFoundryOperationResult({
      operation,
      status: "blocked",
      taskId: record.task_id,
      artifacts,
      blockers: [
        { code: "native_validation_failed", message, scope: type },
        ...queueIssues.blockers,
      ],
      nextActions: [human("repair_native_validation", message), ...queueIssues.actions],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  }
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
  const scoped = interaction
    ? scopedAuthoringPresentation(
        context,
        inspected.artifacts,
        workflow,
        interaction,
        objectScopes,
        reassessments,
        staleObjects,
      )
    : { artifacts: [], actions: [], blockers: [], types: [] as readonly string[] };
  artifacts.push(...scoped.artifacts);
  if (pendingQuestions.length || investigations.length || scoped.blockers.length) {
    const describe = (question: Readonly<Record<string, unknown>>) => {
      const object = question.object_scope as { entity_id: string; version: string } | undefined;
      const target = object
        ? ` Affected ${String(question.dataset_type)}: ID ${object.entity_id}, version ${object.version}. The indexed task artifacts retain its exact row and source evidence.`
        : "";
      return `Question: ${String(question.ask)} Missing information: ${String(question.missing)} Why it matters: ${String(question.impact)} Suggested next step: ${String(question.recommendation)}${target}`;
    };
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
          scope: question.object_scope
            ? `${String(question.dataset_type)}:${String((question.object_scope as { entity_id: string }).entity_id)}`
            : String(question.dataset_type ?? record.task_id),
        })),
        ...queueIssues.blockers,
        ...scoped.blockers,
      ],
      nextActions: [
        ...askActions,
        ...queueIssues.actions,
        ...scoped.actions,
        ...(independentLocalPreparationPending(record, workflow, inspected.artifacts)
          ? [resumeCommand(context, record)]
          : []),
      ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  }
  const writeBlocker = workflow.finalization
    ? currentFoundryInteractionWriteBlocker(context, inspected.artifacts)
    : null;
  if (writeBlocker)
    return createFoundryOperationResult({
      operation,
      status: "needs_input",
      taskId: record.task_id,
      artifacts,
      blockers: [
        ...queueIssues.blockers,
        {
          code: writeBlocker.code,
          message: writeBlocker.message,
          scope: writeBlocker.scope ?? record.task_id,
        },
      ],
      nextActions: [
        ...queueIssues.actions,
        ...scoped.actions,
        human(
          "review_unadopted_object_decision",
          `${writeBlocker.message} If this task has no matching semantic work left, start a revised task with the current source evidence.`,
        ),
      ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
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
            "Review the retained identity diagnostics. Resume verifies eligible original reports before continuing into semantic review; incomplete original proof remains UNKNOWN without repeating its query.",
          scope: record.task_id,
        },
      ],
      nextActions: [
        human(
          "review_identity_preflight",
          `Read ${workflow.identity.file}. Use the same task's resume entry to verify retained diagnostic evidence; preserve original attempts and report bindings.`,
        ),
      ],
      runtimeIdentity: identity,
      permissions: noPermission(),
    });
  const pendingAssessment = projectPendingAssessmentStage({
    operation,
    context,
    record,
    artifacts,
    inspectedArtifacts: inspected.artifacts,
    workflow,
    queueIssues,
    scoped,
    qualityScope,
    identity,
  });
  if (pendingAssessment) return pendingAssessment;
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
