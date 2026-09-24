import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertNotFoundrySessionFile, migrationCredentialPath } from "./foundry-private-path.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readWorkflowArtifact } from "./foundry-workflow-state.ts";
import {
  FOUNDRY_INTERACTION_INPUT_SCHEMA,
  FOUNDRY_INTERACTION_STATE_SCHEMA,
  FOUNDRY_INTERACTION_COMMAND,
  FOUNDRY_INTERACTION_REPORT,
  type FoundryInteractionInput,
  type FoundryInteractionObjectScope,
  type FoundryInteractionState,
} from "./foundry-interaction-types.ts";
import {
  foundryInteractionObjectProofKey,
  sameFoundryInteractionScope,
} from "./foundry-interaction-scope.ts";
export {
  FOUNDRY_INTERACTION_INPUT_SCHEMA,
  FOUNDRY_INTERACTION_STATE_SCHEMA,
  FOUNDRY_INTERACTION_COMMAND,
  FOUNDRY_INTERACTION_REPORT,
} from "./foundry-interaction-types.ts";
export type {
  FoundryInteractionInput,
  FoundryInteractionObjectScope,
  FoundryInteractionState,
} from "./foundry-interaction-types.ts";
export {
  foundryInteractionObjectKey,
  foundryInteractionObjectProofKey,
} from "./foundry-interaction-scope.ts";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const taskPattern = /^task-[0-9a-f]{64}-r\d{4}$/u;
const shaPattern = /^[0-9a-f]{64}$/u;
const datasetTypes = new Set([
  "contact",
  "source",
  "support",
  "flow",
  "flowproperty",
  "unitgroup",
  "process",
  "lifecyclemodel",
]);

export interface SelectedFoundryInteractionInput {
  readonly spec: FoundryInteractionInput;
  readonly descriptor: FoundryInputFact;
}

const selectedInputs = new WeakSet<object>();

function invalid(message: string): never {
  throw new FoundryContextError("interaction_input_invalid", message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Interaction input must be an object.");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Interaction input has missing or unsupported fields.");
}

function bounded(value: unknown, label: string, limit = 4_096): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\0\r\n]/u.test(value))
    invalid(`${label} must be concise, nonempty single-line text.`);
  return value;
}

function rawAnswer(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 16_384 || value.includes("\0"))
    invalid("Raw answer must be bounded nonempty text.");
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) invalid(`${label} is invalid.`);
  return value;
}

function evidence(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((sha) => typeof sha !== "string" || !shaPattern.test(sha))
  )
    invalid("Evidence must contain at most 16 SHA-256 references.");
  if (new Set(value).size !== value.length) invalid("Evidence references must be unique.");
  return Object.freeze([...value] as string[]);
}

function datasetType(value: unknown): string | null {
  if (value !== null && (typeof value !== "string" || !datasetTypes.has(value)))
    invalid("Question or assumption dataset type is invalid.");
  return value;
}

function objectScope(
  item: Record<string, unknown>,
  type: string | null,
): FoundryInteractionObjectScope | undefined {
  if (!Object.hasOwn(item, "object_scope")) return undefined;
  if (type === null || type === "support")
    invalid("An object scope requires one concrete dataset type.");
  const scope = record(item.object_scope);
  exact(scope, ["entity_id", "version", "row_sha256"]);
  const entityId = identifier(scope.entity_id, "Object entity id");
  const version = identifier(scope.version, "Object version");
  if (typeof scope.row_sha256 !== "string" || !shaPattern.test(scope.row_sha256))
    invalid("Object row SHA-256 is invalid.");
  return Object.freeze({ entity_id: entityId, version, row_sha256: scope.row_sha256 });
}

function event(value: unknown): Readonly<Record<string, unknown>> {
  const item = record(value);
  if (item.kind === "question") {
    exact(item, [
      "kind",
      "id",
      "dataset_type",
      "missing",
      "impact",
      "recommendation",
      "ask",
      "choices",
      "evidence_sha256",
      "supersedes",
      ...(Object.hasOwn(item, "object_scope") ? ["object_scope"] : []),
    ]);
    if (!Array.isArray(item.choices) || item.choices.length > 4)
      invalid("A question may offer at most four short choices.");
    const choices = item.choices.map((choice) => bounded(choice, "Choice", 240));
    if (new Set(choices).size !== choices.length) invalid("Question choices must be unique.");
    const type = datasetType(item.dataset_type);
    const scope = objectScope(item, type);
    return Object.freeze({
      kind: "question",
      id: identifier(item.id, "Question id"),
      dataset_type: type,
      ...(scope ? { object_scope: scope } : {}),
      missing: bounded(item.missing, "Missing information", 1_200),
      impact: bounded(item.impact, "Impact", 1_200),
      recommendation: bounded(item.recommendation, "Recommendation", 1_200),
      ask: bounded(item.ask, "Question", 1_200),
      choices: Object.freeze(choices),
      evidence_sha256: evidence(item.evidence_sha256),
      supersedes:
        item.supersedes === null ? null : identifier(item.supersedes, "Superseded question"),
    });
  }
  if (item.kind === "answer") {
    exact(item, [
      "kind",
      "question_id",
      "decision_id",
      "supersedes_decision_id",
      "raw_answer",
      "adopted_decision",
      "disposition",
      "evidence_sha256",
    ]);
    if (item.disposition !== "decided" && item.disposition !== "investigate")
      invalid("Answer disposition must be decided or investigate.");
    const adopted =
      item.adopted_decision === null ? null : bounded(item.adopted_decision, "Adopted decision");
    if ((item.disposition === "decided") !== (adopted !== null))
      invalid("Investigate-first answers cannot silently adopt a decision.");
    return Object.freeze({
      kind: "answer",
      question_id: identifier(item.question_id, "Question id"),
      decision_id: identifier(item.decision_id, "Decision id"),
      supersedes_decision_id:
        item.supersedes_decision_id === null
          ? null
          : identifier(item.supersedes_decision_id, "Superseded decision id"),
      raw_answer: rawAnswer(item.raw_answer),
      adopted_decision: adopted,
      disposition: item.disposition,
      evidence_sha256: evidence(item.evidence_sha256),
    });
  }
  if (item.kind === "assumption") {
    exact(item, [
      "kind",
      "id",
      "dataset_type",
      "statement",
      "impact",
      "evidence_sha256",
      "supersedes",
      ...(Object.hasOwn(item, "object_scope") ? ["object_scope"] : []),
    ]);
    const type = datasetType(item.dataset_type);
    const scope = objectScope(item, type);
    return Object.freeze({
      kind: "assumption",
      id: identifier(item.id, "Assumption id"),
      dataset_type: type,
      ...(scope ? { object_scope: scope } : {}),
      statement: bounded(item.statement, "Assumption"),
      impact: bounded(item.impact, "Assumption impact"),
      evidence_sha256: evidence(item.evidence_sha256),
      supersedes:
        item.supersedes === null ? null : identifier(item.supersedes, "Superseded assumption"),
    });
  }
  return invalid("Interaction event kind is unsupported.");
}

export function parseFoundryInteractionInput(value: unknown): FoundryInteractionInput {
  const item = record(value);
  exact(item, ["schema", "task_id", "actor_id", "expected_state_sha256", "events"]);
  if (
    item.schema !== FOUNDRY_INTERACTION_INPUT_SCHEMA ||
    typeof item.task_id !== "string" ||
    !taskPattern.test(item.task_id) ||
    typeof item.actor_id !== "string" ||
    !idPattern.test(item.actor_id) ||
    (item.expected_state_sha256 !== null &&
      (typeof item.expected_state_sha256 !== "string" ||
        !shaPattern.test(item.expected_state_sha256))) ||
    !Array.isArray(item.events) ||
    !item.events.length ||
    item.events.length > 16
  )
    invalid("Interaction input needs one task, actor, current-state digest and 1-16 events.");
  return Object.freeze({
    schema: FOUNDRY_INTERACTION_INPUT_SCHEMA,
    task_id: item.task_id,
    actor_id: item.actor_id,
    expected_state_sha256: item.expected_state_sha256,
    events: Object.freeze(item.events.map(event)),
  });
}

export function advanceFoundryInteractionState(
  previous: FoundryInteractionState | null,
  input: FoundryInteractionInput,
  currentSha256: string | null,
  availableEvidence: ReadonlySet<string>,
  allowedTypes: ReadonlySet<string>,
  verifiedObjectScopes: ReadonlySet<string> = new Set(),
): FoundryInteractionState {
  if (input.expected_state_sha256 !== currentSha256)
    invalid(
      "Interaction state changed; reload the current question and submit against its digest.",
    );
  if (previous && (previous.task_id !== input.task_id || previous.actor_id !== input.actor_id))
    invalid("Interaction state belongs to another task or actor.");
  const events = [...(previous?.events ?? [])];
  if (events.length + input.events.length > 1_000)
    invalid("Interaction history exceeds its bounded size.");
  const questions = new Map<string, Record<string, unknown>>();
  const assumptions = new Map<string, Readonly<Record<string, unknown>>>();
  const supersededAssumptions = new Set<string>();
  const decisions = new Set<string>();
  const answers = new Map<string, Readonly<Record<string, unknown>>>();
  const supersededQuestions = new Set<string>();
  for (const existing of events) {
    if (existing.kind === "question") {
      questions.set(String(existing.id), existing);
      if (existing.supersedes) supersededQuestions.add(String(existing.supersedes));
    } else if (existing.kind === "answer") {
      decisions.add(String(existing.decision_id));
      answers.set(String(existing.question_id), existing);
    } else if (existing.kind === "assumption") {
      assumptions.set(String(existing.id), existing);
      if (existing.supersedes) supersededAssumptions.add(String(existing.supersedes));
    }
  }
  for (const item of input.events) {
    const type = item.dataset_type;
    if (typeof type === "string" && !allowedTypes.has(type))
      invalid("Interaction scope is outside this task's target entity types.");
    if (item.kind !== "answer" && Object.hasOwn(item, "object_scope")) {
      const scope = item.object_scope as FoundryInteractionObjectScope;
      if (
        !verifiedObjectScopes.has(
          foundryInteractionObjectProofKey(
            String(type),
            scope.entity_id,
            scope.version,
            scope.row_sha256,
          ),
        )
      )
        invalid("Interaction object scope is not bound to a registered row.");
    }
    for (const sha of item.evidence_sha256 as readonly string[])
      if (!availableEvidence.has(sha))
        invalid("Interaction evidence is not a registered source or artifact.");
    if (item.kind === "question") {
      const id = String(item.id);
      if (questions.has(id)) invalid("Duplicate question id; reuse the current question instead.");
      if (item.supersedes) {
        const prior = questions.get(String(item.supersedes));
        if (
          !prior ||
          supersededQuestions.has(String(item.supersedes)) ||
          !sameFoundryInteractionScope(prior, item)
        )
          invalid("A replacement question must name one current question in the same scope.");
        supersededQuestions.add(String(item.supersedes));
      }
      if (
        [...questions.values()].some(
          (prior) =>
            !supersededQuestions.has(String(prior.id)) &&
            sameFoundryInteractionScope(prior, item) &&
            prior.missing === item.missing &&
            prior.ask === item.ask,
        )
      )
        invalid("Duplicate current question; use its existing id and answer.");
      questions.set(id, item);
    } else if (item.kind === "answer") {
      if (
        !questions.has(String(item.question_id)) ||
        supersededQuestions.has(String(item.question_id))
      )
        invalid("Answer must refer to one current registered question.");
      if (decisions.has(String(item.decision_id))) invalid("Duplicate decision id.");
      const previousAnswer = answers.get(String(item.question_id));
      if (
        (previousAnswer && item.supersedes_decision_id !== previousAnswer.decision_id) ||
        (!previousAnswer && item.supersedes_decision_id !== null)
      )
        invalid("A corrected answer must name the exact prior decision for this question.");
      decisions.add(String(item.decision_id));
      answers.set(String(item.question_id), item);
    } else if (item.kind === "assumption") {
      if (assumptions.has(String(item.id))) invalid("Duplicate assumption id.");
      if (item.supersedes) {
        const prior = assumptions.get(String(item.supersedes));
        if (
          !prior ||
          !sameFoundryInteractionScope(prior, item) ||
          supersededAssumptions.has(String(item.supersedes))
        )
          invalid("A replacement assumption must name one current assumption in the same scope.");
        supersededAssumptions.add(String(item.supersedes));
      }
      if (
        Object.hasOwn(item, "object_scope") &&
        [...assumptions.values()].some(
          (prior) =>
            !supersededAssumptions.has(String(prior.id)) &&
            sameFoundryInteractionScope(prior, item) &&
            prior.statement === item.statement,
        )
      )
        invalid("Duplicate current assumption for this object scope.");
      assumptions.set(String(item.id), item);
    }
    events.push(item);
  }
  const next = Object.freeze({
    schema: FOUNDRY_INTERACTION_STATE_SCHEMA,
    task_id: input.task_id,
    actor_id: input.actor_id,
    events: Object.freeze(events),
  });
  if (Buffer.byteLength(`${JSON.stringify(next, null, 2)}\n`) > 8 * 1024 * 1024)
    invalid("Interaction history exceeds the task artifact byte limit.");
  return next;
}

export function readSelectedFoundryInteractionBytes(fact: FoundryInputFact): Buffer {
  const fd = fs.openSync(fact.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== fact.bytes || stat.size > 1024 * 1024)
      invalid("Interaction input must be a bounded regular file.");
    const bytes = fs.readFileSync(fd);
    if (
      bytes.length !== fact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== fact.sha256
    )
      invalid("Interaction input changed after selection.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function selectFoundryInteractionInput(
  context: FoundryRuntimeContext,
  file: string,
): SelectedFoundryInteractionInput {
  if (!file || file.length > 4096 || /[\0\r\n]/u.test(file))
    invalid("Interaction input path is invalid.");
  const target = path.resolve(context.workspaceRoot, file);
  if (migrationCredentialPath(path.relative(context.workspaceRoot, target)))
    invalid("Credential paths cannot be interaction inputs.");
  assertNotFoundrySessionFile(target, context.accountIntent?.sessionReference);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    invalid("Interaction input must be a bounded regular file.");
  const descriptor = captureFoundryInput(target);
  let spec: FoundryInteractionInput;
  try {
    spec = parseFoundryInteractionInput(
      JSON.parse(readSelectedFoundryInteractionBytes(descriptor).toString("utf8")),
    );
  } catch (error) {
    if (error instanceof FoundryContextError && error.code !== "interaction_input_invalid")
      throw error;
    invalid("Interaction input must be complete valid JSON.");
  }
  if (spec.task_id !== context.taskId || spec.actor_id !== context.actorId)
    invalid("Interaction task or actor differs from this invocation.");
  const selected = Object.freeze({ spec, descriptor: Object.freeze(descriptor) });
  selectedInputs.add(selected);
  return selected;
}

export function assertSelectedFoundryInteractionInput(
  input: SelectedFoundryInteractionInput,
): void {
  if (!selectedInputs.has(input))
    invalid("Select interaction input through the current invocation.");
}

export function currentFoundryInteractionState(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): { entry: ArtifactEntry; state: FoundryInteractionState } | null {
  for (const entry of [...entries].reverse()) {
    if (
      entry.command !== FOUNDRY_INTERACTION_COMMAND ||
      path.basename(entry.path) !== FOUNDRY_INTERACTION_REPORT
    )
      continue;
    const value = readWorkflowArtifact(context, entry).value;
    if (
      value.schema !== FOUNDRY_INTERACTION_STATE_SCHEMA ||
      value.task_id !== context.taskId ||
      value.actor_id !== context.actorId ||
      !Array.isArray(value.events) ||
      value.events.length > 1_000
    )
      invalid("Registered interaction state is invalid.");
    return { entry, state: value as unknown as FoundryInteractionState };
  }
  return null;
}

export {
  applicableFoundryInteractionDigest,
  applicableFoundryInteractionDigestForObject,
  applicableFoundryInteractionProjection,
  applicableFoundryInteractionProjectionForObject,
  currentFoundryAssumptions,
  currentFoundryAssumptionsForObject,
  currentFoundryAssumptionsForType,
  currentFoundryDecisions,
  currentFoundryDecisionsForObject,
  currentFoundryDecisionsForType,
  currentFoundryInvestigations,
  currentFoundryInvestigationsForObject,
  currentFoundryQuestions,
  currentFoundryQuestionsForObject,
  foundryInteractionEventAppliesToObject,
} from "./foundry-interaction-projection.ts";
