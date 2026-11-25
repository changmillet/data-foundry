import { registeredAssessmentSetProducerBase } from "./foundry-assessment-producer.ts";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertNotFoundrySessionFile, migrationCredentialPath } from "./foundry-private-path.ts";
import {
  advanceFoundryInteractionState,
  currentFoundryInteractionState,
  parseFoundryInteractionInput,
} from "./foundry-interaction-input.ts";
import { parseFoundrySemanticInput, readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import {
  currentFoundryObjectScopes,
  verifiedFoundryObjectProofs,
} from "./foundry-workflow-object-scope.ts";
import { foundryInteractionObjectKey } from "./foundry-interaction-scope.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

function invalid(message: string): never {
  throw new FoundryContextError("task_input_draft_invalid", message);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Input draft has missing or unsupported fields.");
}

function selectedFile(context: FoundryRuntimeContext, value: unknown) {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\0\r\n]/u.test(value))
    invalid("Input draft file selection must be one bounded path.");
  const file = path.resolve(context.workspaceRoot, value);
  if (migrationCredentialPath(path.relative(context.workspaceRoot, file)))
    invalid("Private files cannot be input draft selections.");
  assertNotFoundrySessionFile(file, context.accountIntent?.sessionReference);
  const fact = captureFoundryInput(file);
  readSelectedSemanticBytes(fact);
  return fact;
}

function registeredFile(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  value: unknown,
) {
  const fact = selectedFile(context, value);
  const registered =
    context.inputs.find((item) => item.path === fact.path) ??
    entries.find((entry) => resolveFoundryOutput(context, entry.path) === fact.path);
  if (!registered || registered.sha256 !== fact.sha256 || registered.bytes !== fact.bytes)
    invalid(
      "Input draft evidence must match a current registered source or artifact's raw file bytes.",
    );
  return fact;
}

function currentSemanticTasks(context: FoundryRuntimeContext, entries: readonly ArtifactEntry[]) {
  const state = currentWorkflowState(context, entries);
  if (!state.assessment)
    invalid("Semantic input preparation requires a current registered assessment.");
  const tasks = new Map<string, string>();
  for (const set of state.assessment.value.sets) {
    const ownerBase = registeredAssessmentSetProducerBase(context, entries, set);
    for (const raw of Array.isArray(set.decisions) ? set.decisions : []) {
      const decision = workflowObject(raw);
      if (typeof decision.task === "string" && typeof decision.kind === "string")
        tasks.set(path.resolve(ownerBase, decision.task), decision.kind);
    }
    const manifest = registeredFile(context, entries, set.authoring_manifest);
    const entry = entries.find(
      (item) => resolveFoundryOutput(context, item.path) === manifest.path,
    )!;
    const value = readWorkflowArtifact(context, entry).value;
    if (!Array.isArray(value.tasks)) invalid("Current assessment authoring manifest has no tasks.");
    for (const raw of value.tasks) {
      const files = workflowObject(workflowObject(raw).files);
      if (typeof files.task_json !== "string") invalid("Current authoring task path is missing.");
      tasks.set(path.resolve(ownerBase, files.task_json), "patch");
    }
  }
  return { assessment: state.assessment, tasks };
}

/** Derive a strict submission from current indexed facts without registering or executing it. */
export function prepareFoundryTaskInput(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  targetEntities: readonly string[],
  kind: "interaction" | "semantic",
  draftFile: string,
) {
  const selected = selectedFile(context, draftFile);
  let draft: Record<string, unknown>;
  try {
    draft = workflowObject(JSON.parse(readSelectedSemanticBytes(selected).toString("utf8")));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    invalid("Input draft must contain complete JSON.");
  }
  const interaction = currentFoundryInteractionState(context, entries);
  if (kind === "interaction") {
    exact(draft, ["schema", "events"]);
    if (
      draft.schema !== "tiangong-foundry.interaction-draft.v1" ||
      !Array.isArray(draft.events) ||
      draft.events.length > 16
    )
      invalid("Interaction draft requires its v1 schema and at most 16 events.");
    const objects = currentFoundryObjectScopes(context, entries);
    const events = draft.events.map((raw) => {
      const event = workflowObject(raw);
      if (Object.hasOwn(event, "evidence_sha256"))
        invalid(
          "Interaction drafts select evidence_files. Submit existing strict digest descriptors directly through resume.",
        );
      const { evidence_files, object_scope, ...fields } = event;
      if (!Array.isArray(evidence_files) || evidence_files.length > 16)
        invalid("Each interaction draft event requires at most 16 evidence_files.");
      const hashes = evidence_files.map((file) => registeredFile(context, entries, file).sha256);
      let scope: Record<string, unknown> | undefined;
      if (object_scope !== undefined) {
        const selectedScope = workflowObject(object_scope);
        exact(selectedScope, ["entity_id", "version"]);
        if (
          typeof event.dataset_type !== "string" ||
          typeof selectedScope.entity_id !== "string" ||
          typeof selectedScope.version !== "string"
        )
          invalid("Object scope requires a concrete dataset type, entity_id and version.");
        const current = objects.get(
          foundryInteractionObjectKey(
            event.dataset_type,
            selectedScope.entity_id,
            selectedScope.version,
          ),
        );
        if (!current) invalid("Object scope must select one unique current registered row.");
        scope = {
          entity_id: current.entity_id,
          version: current.version,
          row_sha256: current.row_sha256,
        };
      }
      return { ...fields, evidence_sha256: hashes, ...(scope ? { object_scope: scope } : {}) };
    });
    const descriptor = parseFoundryInteractionInput({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: context.taskId,
      actor_id: context.actorId,
      expected_state_sha256: interaction?.entry.sha256 ?? null,
      events,
    });
    advanceFoundryInteractionState(
      interaction?.state ?? null,
      descriptor,
      interaction?.entry.sha256 ?? null,
      new Set([
        ...context.inputs.map((item) => item.sha256),
        ...entries.map((item) => item.sha256),
      ]),
      new Set(targetEntities),
      verifiedFoundryObjectProofs(context, entries),
    );
    return descriptor;
  }
  exact(draft, ["schema", "submissions"]);
  if (
    draft.schema !== "tiangong-foundry.semantic-draft.v1" ||
    !Array.isArray(draft.submissions) ||
    draft.submissions.length > 1000
  )
    invalid("Semantic draft requires its v1 schema and at most 1000 submissions.");
  const current = currentSemanticTasks(context, entries);
  let bytes = selected.bytes;
  const submissions = draft.submissions.map((raw) => {
    const item = workflowObject(raw);
    exact(item, [
      "kind",
      "authoring_task",
      "file",
      ...(Object.hasOwn(item, "decision_ids") ? ["decision_ids"] : []),
    ]);
    const task = registeredFile(context, entries, item.authoring_task);
    if (current.tasks.get(task.path) !== item.kind)
      invalid("Semantic work must select a matching task from the current assessment.");
    const file = selectedFile(context, item.file);
    bytes += file.bytes;
    if (bytes > 64 * 1024 * 1024) invalid("Semantic draft selection exceeds 64 MiB.");
    return {
      kind: item.kind,
      authoring_task_sha256: task.sha256,
      file: file.path,
      sha256: file.sha256,
      ...(Object.hasOwn(item, "decision_ids") ? { decision_ids: item.decision_ids } : {}),
    };
  });
  return parseFoundrySemanticInput({
    schema: "tiangong-foundry.semantic-input.v1",
    task_id: context.taskId,
    actor_id: context.actorId,
    assessment_sha256: current.assessment.entry.sha256,
    ...(interaction ? { interaction_sha256: interaction.entry.sha256 } : {}),
    submissions,
  });
}
