import { createHash } from "node:crypto";
import path from "node:path";
import {
  applicableFoundryInteractionDigestForObject,
  applicableFoundryInteractionProjectionForObject,
  currentFoundryAssumptions,
  currentFoundryDecisions,
  type currentFoundryInteractionState,
  currentFoundryInvestigations,
  currentFoundryQuestions,
  foundryInteractionObjectKey,
} from "../foundry-interaction-input.ts";
import type { FoundryFacadeTaskRecord } from "../foundry-facade-store.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationArtifact,
  type FoundryOperationNextAction,
  type FoundryOperationResult,
} from "../foundry-operation-result.ts";
import type { foundryQualityReviewScope } from "../foundry-quality-review.ts";
import {
  captureFoundryInput,
  type createFoundryRuntimeContext,
  FoundryContextError,
  resolveFoundryOutput,
} from "../foundry-runtime-context.ts";
import type { ArtifactEntry } from "../foundry-task-types.ts";
import {
  currentFoundryNarrowObjects as readNarrowObjects,
  type currentFoundryObjectDecisionReassessments,
  type currentFoundryObjectScopes,
  type indexedFoundryRowAdoptions,
} from "../foundry-workflow-object-scope.ts";
import {
  type currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "../foundry-workflow-state.ts";
import {
  human,
  inlineArtifact,
  maxQueueBytes,
  maxSeedBytes,
  noPermission,
  readCaptured,
  resumeCommand,
} from "./facade-support.ts";

export function currentIndexedQueueBlockers(
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
      ? `Selected Process data has ${missing} unresolved Flow reference occurrence${missing === 1 ? "" : "s"}: the cited Flow evidence is absent from the selected inputs and has no verified external declaration. Process review is blocked; unrelated records can continue. Select existing read-only Flow evidence and its complete FlowProperty/UnitGroup QA chain using this Process task's --reference-input, or keep the gap open. Only changing the frozen selected sources requires a new task revision. Full IDs and paths: ${detailsFile}.`
      : `The selected ${scope} dependency queue has ${recorded.length} blocker${recorded.length === 1 ? "" : "s"}. Independent types can continue. Review the exact registered evidence at ${detailsFile} before revising the source or closure.`;
    blockers.push({ code: "curation_queue_blocked", message, scope });
    actions.push(human("review_queue_blockers", message));
  }
  return { blockers, actions };
}

export function scopedAuthoringPresentation(
  context: ReturnType<typeof createFoundryRuntimeContext>,
  entries: Parameters<typeof currentWorkflowState>[1],
  workflow: ReturnType<typeof currentWorkflowState>,
  interaction: NonNullable<ReturnType<typeof currentFoundryInteractionState>>,
  objects: ReturnType<typeof currentFoundryObjectScopes>,
  reassessments: ReturnType<typeof currentFoundryObjectDecisionReassessments>,
  staleObjects: ReturnType<typeof readNarrowObjects>,
): {
  artifacts: FoundryOperationArtifact[];
  actions: FoundryOperationNextAction[];
  blockers: Array<{ code: string; message: string; scope: string }>;
  types: readonly string[];
} {
  const narrow = readNarrowObjects(interaction.state);
  const artifacts: FoundryOperationArtifact[] = [];
  const actions: FoundryOperationNextAction[] = [];
  const blockers: Array<{ code: string; message: string; scope: string }> = [];
  for (const item of staleObjects) {
    blockers.push({
      code: "interaction_object_evidence_changed",
      message: `The reviewed ${item.dataset_type} changed without a proven link to the earlier decision. Recheck only this record and its proven dependents. Record ID: ${item.entity_id}; version: ${item.version}.`,
      scope: `${item.dataset_type}:${item.entity_id}`,
    });
    actions.push(
      human(
        "review_object_scope",
        `The earlier answer may no longer fit this ${item.dataset_type}. Recheck its current row and source evidence before using that answer. Record ID: ${item.entity_id}; version: ${item.version}.`,
      ),
    );
  }
  for (const item of reassessments) {
    blockers.push({
      code: "interaction_object_decision_changed",
      message: `A newer answer for this ${item.dataset_type} has not been applied to its current row. Review it before authorization. Record ID: ${item.entity_id}; version: ${item.version}; decision ID: ${item.decision_id}.`,
      scope: `${item.dataset_type}:${item.entity_id}`,
    });
    actions.push(
      human(
        "review_corrected_object_decision",
        `A newer answer for this ${item.dataset_type} still needs to be reflected in the data. Check its current source evidence, then submit matching semantic work. If no matching work remains, start a revised task. Other records can continue. Record ID: ${item.entity_id}; version: ${item.version}; decision ID: ${item.decision_id}.`,
      ),
    );
  }
  if (!narrow.length || !workflow.assessment) return { artifacts, actions, blockers, types: [] };
  const narrowTypes = new Set(narrow.map((item) => item.dataset_type));
  const reassessmentKeys = new Set(
    reassessments.map((item) => JSON.stringify([item.dataset_type, item.entity_id, item.version])),
  );
  const staleKeys = new Set(
    staleObjects.map((item) => JSON.stringify([item.dataset_type, item.entity_id, item.version])),
  );
  let shown = 0;
  for (const set of workflow.assessment.value.sets) {
    const type = String(set.type);
    if (!narrowTypes.has(type)) continue;
    for (const raw of Array.isArray(set.decisions) ? set.decisions : []) {
      const decision = workflowObject(raw);
      if (typeof decision.kind !== "string" || typeof decision.task !== "string") continue;
      actions.push(
        human(
          `review_${decision.kind}_decisions`,
          `A ${decision.kind} decision batch needs review. Check each affected record's evidence and resolve its pending questions before submitting the batch. Registered task: ${decision.task}; status: ${String(decision.status)}.`,
        ),
      );
    }
    const manifestFile = String(set.authoring_manifest);
    const manifestEntry = entries.find(
      (entry) => resolveFoundryOutput(context, entry.path) === manifestFile,
    );
    if (!manifestEntry)
      throw new FoundryContextError(
        "workflow_assessment_invalid",
        "Current object work has no registered authoring manifest.",
      );
    const manifest = readWorkflowArtifact(context, manifestEntry).value;
    if (!Array.isArray(manifest.tasks))
      throw new FoundryContextError(
        "workflow_assessment_invalid",
        "Current authoring manifest has no bounded task list.",
      );
    for (const raw of manifest.tasks) {
      if (shown >= 64) {
        actions.push(
          human(
            "review_remaining_object_work",
            `More object work is indexed at ${manifestFile}; inspect its exact task identities before continuing.`,
          ),
        );
        break;
      }
      const task = workflowObject(raw);
      const files = workflowObject(task.files);
      const taskFile = path.resolve(workflow.assessment.value.owner_base, String(files.task_json));
      const taskEntry = entries.find(
        (entry) => resolveFoundryOutput(context, entry.path) === taskFile,
      );
      if (!taskEntry)
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Current object work has no registered authoring task.",
        );
      const registered = readWorkflowArtifact(context, taskEntry).value;
      const entity = workflowObject(registered.entity);
      if (
        entity.dataset_type !== type ||
        typeof entity.entity_id !== "string" ||
        typeof entity.version !== "string"
      )
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Current authoring task has no exact object identity.",
        );
      const current =
        objects.get(foundryInteractionObjectKey(type, entity.entity_id, entity.version)) ?? null;
      const projection = applicableFoundryInteractionProjectionForObject(
        interaction.state,
        type,
        entity.entity_id,
        entity.version,
      );
      const decisionCurrent = !reassessmentKeys.has(
        JSON.stringify([type, entity.entity_id, entity.version]),
      );
      const bound = !staleKeys.has(JSON.stringify([type, entity.entity_id, entity.version]));
      artifacts.push(
        inlineArtifact("object_interaction_context", {
          ...projection,
          work_item_sha256: taskEntry.sha256,
          current_row_sha256: current?.row_sha256 ?? null,
          source_state_sha256: interaction.entry.sha256,
          applicable_digest: applicableFoundryInteractionDigestForObject(
            interaction.state,
            type,
            entity.entity_id,
            entity.version,
          ),
          evidence_current: bound,
          decision_current: decisionCurrent,
        }),
      );
      shown += 1;
      if (
        bound &&
        registered.status === "ready_for_ai_authoring" &&
        !projection.pending_questions.length &&
        !projection.investigations.length
      ) {
        actions.push(
          human(
            "review_semantic_work",
            `This ${type} has independent authoring work ready. Review its remaining gaps and source evidence in the registered task and matching object_interaction_context, then cite only decisions that apply to this record. Record ID: ${entity.entity_id}; version: ${entity.version}; task: ${taskFile}. This does not grant write permission.`,
          ),
        );
      }
    }
  }
  return { artifacts, actions, blockers, types: [...narrowTypes] };
}

export function buildDecisionRecapArtifact(
  record: FoundryFacadeTaskRecord,
  interaction: ReturnType<typeof currentFoundryInteractionState>,
  objectAdoptions: ReturnType<typeof indexedFoundryRowAdoptions>,
  pendingQuestions: ReturnType<typeof currentFoundryQuestions>,
  investigations: ReturnType<typeof currentFoundryInvestigations>,
  completionProvenFlag: boolean,
): FoundryOperationArtifact {
  const questions = new Map(
    interaction?.state.events
      .filter((event) => event.kind === "question")
      .map((event) => [String(event.id), event]) ?? [],
  );
  return inlineArtifact("decision_recap", {
    schema: "tiangong-foundry.decision-recap.v1",
    task_id: record.task_id,
    completion_proven: completionProvenFlag,
    brief: record.spec.brief ?? null,
    user_decisions: interaction
      ? currentFoundryDecisions(interaction.state).map((answer) => ({
          question_id: answer.question_id,
          dataset_type: questions.get(String(answer.question_id))?.dataset_type ?? null,
          ...(questions.get(String(answer.question_id))?.object_scope
            ? {
                object_scope: questions.get(String(answer.question_id))?.object_scope,
                applied_to: objectAdoptions
                  .filter((adoption) => adoption.decision_ids.includes(String(answer.decision_id)))
                  .filter((adoption) => {
                    const scope = questions.get(String(answer.question_id))?.object_scope as
                      { entity_id: string; version: string } | undefined;
                    return (
                      scope &&
                      adoption.dataset_type ===
                        questions.get(String(answer.question_id))?.dataset_type &&
                      adoption.object_scope.entity_id === scope.entity_id &&
                      adoption.object_scope.version === scope.version
                    );
                  })
                  .slice(-16)
                  .map((adoption) => ({
                    work_item_sha256: adoption.work_item_sha256,
                    before_row_sha256: adoption.before_row_sha256,
                    after_row_sha256: adoption.after_row_sha256,
                    semantic_result_sha256: adoption.semantic_result_sha256,
                  })),
              }
            : {}),
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
      ...(question.object_scope ? { object_scope: question.object_scope } : {}),
      missing: question.missing,
      impact: question.impact,
      ask: question.ask,
      choices: question.choices,
    })),
    source_interaction_sha256: interaction?.entry.sha256 ?? null,
  });
}

export function projectPendingAssessmentStage({
  operation,
  context,
  record,
  artifacts,
  inspectedArtifacts,
  workflow,
  queueIssues,
  scoped,
  qualityScope,
  identity,
}: {
  operation: "task.start" | "task.status" | "task.resume";
  context: ReturnType<typeof createFoundryRuntimeContext>;
  record: FoundryFacadeTaskRecord;
  artifacts: FoundryOperationArtifact[];
  inspectedArtifacts: readonly ArtifactEntry[];
  workflow: ReturnType<typeof currentWorkflowState>;
  queueIssues: ReturnType<typeof currentIndexedQueueBlockers>;
  scoped: ReturnType<typeof scopedAuthoringPresentation>;
  qualityScope: ReturnType<typeof foundryQualityReviewScope>;
  identity: unknown;
}): FoundryOperationResult | null {
  const assessment = workflow.assessment?.entry;
  if (!assessment) return null;
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
      const expected = inspectedArtifacts.find(
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
  if (!pending.length) return null;
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
      ...scoped.actions,
      ...(qualityScope
        ? [
            human(
              "review_process_mass_observation",
              "Save the quality_review_input_template artifact, select only the Process observations actually reviewed, and fill an explicit accept-interpretation disposition, rationale and source-model evidence file references under applicable user authority. Submit the completed descriptor through --quality-review-input, then resume to reassess. The template accepts nothing by default; preserve quantities and raw QA. This input grants no write permission.",
            ),
          ]
        : []),
      ...pending.flatMap((set) => [
        ...(!scoped.types.includes(set.type)
          ? [
              human(
                "review_semantic_work",
                `Read the registered curation report ${set.curation_report} and authoring manifest ${set.authoring_manifest}. Use their bound source/context evidence; no write permission is implied.`,
              ),
            ]
          : []),
        ...(!scoped.types.includes(set.type) ? (set.decisions ?? []) : []).map((work) =>
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
