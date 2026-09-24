import fs from "node:fs";
import { createHash } from "node:crypto";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  dataSetInformation,
  datasetRoot,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  foundryInteractionObjectKey,
  foundryInteractionObjectProofKey,
} from "./foundry-interaction-scope.ts";
import {
  currentFoundryAssumptions,
  currentFoundryDecisions,
  currentFoundryInvestigations,
  currentFoundryQuestions,
} from "./foundry-interaction-projection.ts";
import { currentFoundryInteractionState } from "./foundry-interaction-input.ts";
import type { FoundryInteractionState } from "./foundry-interaction-types.ts";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { currentWorkflowState, readWorkflowArtifact } from "./foundry-workflow-state.ts";

export interface CurrentFoundryObject {
  readonly dataset_type: string;
  readonly entity_id: string;
  readonly version: string;
  readonly row_sha256: string;
}

export interface IndexedFoundryRowAdoption {
  readonly dataset_type: string;
  readonly object_scope: Readonly<{ entity_id: string; version: string }>;
  readonly work_item_sha256: string;
  readonly before_row_sha256: string;
  readonly after_row_sha256: string;
  readonly decision_ids: readonly string[];
  readonly semantic_result_sha256: string;
}

function scopeError(message: string): never {
  throw new FoundryContextError("interaction_scope_invalid", message);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readRegisteredRows(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  file: string,
): string {
  const entry = entries.findLast(
    (candidate) => resolveFoundryOutput(context, candidate.path) === file,
  );
  if (!entry) scopeError("Object scope row evidence is not registered in this task.");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== entry.bytes || stat.size > 128 * 1024 * 1024)
      scopeError("Object scope row evidence has an invalid size or file type.");
    const bytes = fs.readFileSync(fd);
    if (
      bytes.length !== entry.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      scopeError("Object scope row evidence changed after registration.");
    return bytes.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function foundryExplicitObjectIdentity(
  row: unknown,
  type: string,
): { entity_id: string; version: string } | null {
  const outer = record(row);
  const root = datasetRoot(unwrapDatasetPayload(row, type), type);
  const information = dataSetInformation(root, type);
  const publication = record(record(root.administrativeInformation).publicationAndOwnership);
  const outerId = outer.id ?? outer[`${type}_id`] ?? outer.dataset_id;
  const payloadId = information["common:UUID"];
  const outerVersion = outer.version;
  const payloadVersion = publication["common:dataSetVersion"];
  if (
    (typeof outerId === "string" && typeof payloadId === "string" && outerId !== payloadId) ||
    (typeof outerVersion === "string" &&
      typeof payloadVersion === "string" &&
      outerVersion !== payloadVersion)
  )
    return null;
  const id = payloadId ?? outerId;
  const version = payloadVersion ?? outerVersion;
  if (typeof id !== "string" || !id.trim() || typeof version !== "string" || !version.trim())
    return null;
  return { entity_id: id, version };
}

/** Read current registered row bytes, never a caller-supplied identity alone. */
export function currentFoundryObjectScopes(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): ReadonlyMap<string, CurrentFoundryObject | null> {
  const rows = currentWorkflowState(context, entries).rows;
  const objects = new Map<string, CurrentFoundryObject | null>();
  if (!rows) return objects;
  for (const set of rows.value.sets) {
    const values = readRows(set.file, (file) => readRegisteredRows(context, entries, file));
    if (values.length !== set.count)
      scopeError("Current registered row count changed before object scope binding.");
    for (const row of values) {
      const identity = foundryExplicitObjectIdentity(row, set.type);
      if (!identity) continue;
      const key = foundryInteractionObjectKey(set.type, identity.entity_id, identity.version);
      if (objects.has(key)) {
        objects.set(key, null);
        continue;
      }
      objects.set(key, {
        dataset_type: set.type,
        ...identity,
        row_sha256: sha256Json(row),
      });
    }
  }
  return objects;
}

export function verifiedFoundryObjectProofs(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): ReadonlySet<string> {
  const proofs = new Set<string>();
  for (const item of currentFoundryObjectScopes(context, entries).values()) {
    if (!item) continue;
    proofs.add(
      foundryInteractionObjectProofKey(
        item.dataset_type,
        item.entity_id,
        item.version,
        item.row_sha256,
      ),
    );
  }
  return proofs;
}

export function requireCurrentFoundryObject(
  objects: ReadonlyMap<string, CurrentFoundryObject | null>,
  type: string,
  entityId: string,
  version: string,
): CurrentFoundryObject {
  const item = objects.get(foundryInteractionObjectKey(type, entityId, version));
  if (!item)
    scopeError(
      "Object scope is missing or ambiguous in current registered rows; materialize or review the exact row before continuing.",
    );
  return item;
}

export function requireUniqueFoundryObjectInRows(
  file: string,
  type: string,
  entityId: string,
  version: string,
  reader?: (file: string) => string,
): CurrentFoundryObject {
  const matches = readRows(file, reader)
    .filter((row) => {
      const identity = foundryExplicitObjectIdentity(row, type);
      return identity?.entity_id === entityId && identity.version === version;
    })
    .map((row) => ({
      dataset_type: type,
      entity_id: entityId,
      version,
      row_sha256: sha256Json(row),
    }));
  if (matches.length !== 1)
    scopeError("Object scope is missing or duplicated in its registered row set.");
  return matches[0];
}

function decisionFamily(state: FoundryInteractionState, questionId: string): ReadonlySet<string> {
  const answers = state.events.filter(
    (item) => item.kind === "answer" && item.question_id === questionId,
  );
  const current = answers.at(-1);
  const byId = new Map(answers.map((item) => [String(item.decision_id), item]));
  const family = new Set<string>();
  let decision = current;
  while (decision && !family.has(String(decision.decision_id))) {
    family.add(String(decision.decision_id));
    decision = decision.supersedes_decision_id
      ? byId.get(String(decision.supersedes_decision_id))
      : undefined;
  }
  return family;
}

export function indexedFoundryRowAdoptions(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): readonly IndexedFoundryRowAdoption[] {
  const adoptions: IndexedFoundryRowAdoption[] = [];
  for (const entry of entries) {
    if (entry.command !== "dataset-semantic-apply" || !entry.path.endsWith("/semantic-result.json"))
      continue;
    const result = readWorkflowArtifact(context, entry).value;
    if (result.status !== "completed" || !Array.isArray(result.row_adoptions)) continue;
    if (result.row_adoptions.length > 1_000)
      scopeError("Indexed object adoption lineage exceeds its bounded size.");
    if (!Array.isArray(result.adopted_decisions))
      scopeError("Indexed object adoption lineage has no matching decision record.");
    for (const raw of result.row_adoptions) {
      const adoption = record(raw);
      const object = record(adoption.object_scope);
      if (
        typeof adoption.dataset_type !== "string" ||
        typeof object.entity_id !== "string" ||
        typeof object.version !== "string" ||
        typeof adoption.work_item_sha256 !== "string" ||
        typeof adoption.before_row_sha256 !== "string" ||
        typeof adoption.after_row_sha256 !== "string" ||
        !Array.isArray(adoption.decision_ids) ||
        adoption.decision_ids.some((id) => typeof id !== "string")
      )
        scopeError("Indexed object adoption lineage is malformed.");
      const declared = result.adopted_decisions.some((rawDecision) => {
        const decision = record(rawDecision);
        const decisionObject = record(decision.object_scope);
        return (
          decision.work_item_sha256 === adoption.work_item_sha256 &&
          decision.dataset_type === adoption.dataset_type &&
          decisionObject.entity_id === object.entity_id &&
          decisionObject.version === object.version &&
          JSON.stringify(decision.decision_ids) === JSON.stringify(adoption.decision_ids)
        );
      });
      if (!declared) scopeError("Indexed row lineage does not match its adopted decision record.");
      adoptions.push({
        dataset_type: adoption.dataset_type,
        object_scope: {
          entity_id: object.entity_id,
          version: object.version,
        },
        work_item_sha256: adoption.work_item_sha256,
        before_row_sha256: adoption.before_row_sha256,
        after_row_sha256: adoption.after_row_sha256,
        decision_ids: adoption.decision_ids as string[],
        semantic_result_sha256: entry.sha256,
      });
    }
  }
  return adoptions;
}

function indexedAdoptionLineage(
  adoptions: readonly IndexedFoundryRowAdoption[],
  scope: CurrentFoundryObject,
  originalRowSha256: string,
  decisionIds: ReadonlySet<string>,
): { readonly current: boolean; readonly adopted_decision_ids: ReadonlySet<string> } {
  let known = originalRowSha256;
  const adopted = new Set<string>();
  for (const adoption of adoptions) {
    if (
      adoption.dataset_type === scope.dataset_type &&
      adoption.object_scope.entity_id === scope.entity_id &&
      adoption.object_scope.version === scope.version &&
      adoption.before_row_sha256 === known &&
      adoption.decision_ids.some((id) => decisionIds.has(id))
    ) {
      known = adoption.after_row_sha256;
      for (const id of adoption.decision_ids) adopted.add(id);
    }
  }
  return { current: known === scope.row_sha256, adopted_decision_ids: adopted };
}

/** A new answer needs its own indexed adoption after earlier semantic work on that object. */
export function currentFoundryObjectDecisionReassessments(
  state: FoundryInteractionState,
  objects: ReadonlyMap<string, CurrentFoundryObject | null>,
  adoptions: readonly IndexedFoundryRowAdoption[],
  requireEarlierWork = true,
): ReadonlyArray<{
  readonly dataset_type: string;
  readonly entity_id: string;
  readonly version: string;
  readonly decision_id: string;
}> {
  const questions = new Map(
    state.events.filter((item) => item.kind === "question").map((item) => [String(item.id), item]),
  );
  const pending = [];
  for (const answer of currentFoundryDecisions(state)) {
    const question = questions.get(String(answer.question_id));
    if (!question || !Object.hasOwn(question, "object_scope")) continue;
    const original = record(question.object_scope);
    const type = String(question.dataset_type);
    const entityId = String(original.entity_id);
    const version = String(original.version);
    const current = objects.get(foundryInteractionObjectKey(type, entityId, version));
    if (!current) continue; // Missing or ambiguous row is separately marked stale for this object.
    const lineage = indexedAdoptionLineage(
      adoptions,
      current,
      String(original.row_sha256),
      decisionFamily(state, String(question.id)),
    );
    const hasEarlierObjectWork = adoptions.some(
      (adoption) =>
        adoption.dataset_type === type &&
        adoption.object_scope.entity_id === entityId &&
        adoption.object_scope.version === version,
    );
    if (
      lineage.current &&
      (!requireEarlierWork || hasEarlierObjectWork) &&
      !lineage.adopted_decision_ids.has(String(answer.decision_id))
    )
      pending.push({
        dataset_type: type,
        entity_id: entityId,
        version,
        decision_id: String(answer.decision_id),
      });
  }
  return pending;
}

export function currentFoundryNarrowObjects(
  state: FoundryInteractionState,
): ReadonlyArray<{ dataset_type: string; entity_id: string; version: string }> {
  const questions = new Map(
    state.events.filter((item) => item.kind === "question").map((item) => [String(item.id), item]),
  );
  const active = [
    ...currentFoundryQuestions(state),
    ...currentFoundryInvestigations(state),
    ...currentFoundryDecisions(state)
      .map((answer) => questions.get(String(answer.question_id)))
      .filter((item) => item !== undefined),
    ...currentFoundryAssumptions(state),
  ];
  const objects = new Map<string, { dataset_type: string; entity_id: string; version: string }>();
  for (const item of active) {
    if (!Object.hasOwn(item, "object_scope")) continue;
    const scope = record(item.object_scope);
    const type = String(item.dataset_type);
    const id = String(scope.entity_id);
    const version = String(scope.version);
    objects.set(foundryInteractionObjectKey(type, id, version), {
      dataset_type: type,
      entity_id: id,
      version,
    });
  }
  return [...objects.values()];
}

/** An old row proof may follow only a recorded, decision-bound semantic successor. */
export function currentFoundryObjectScopeIsBound(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  state: FoundryInteractionState,
  objects: ReadonlyMap<string, CurrentFoundryObject | null>,
  type: string,
  entityId: string,
  version: string,
  adoptions?: readonly IndexedFoundryRowAdoption[],
): boolean {
  const current = objects.get(foundryInteractionObjectKey(type, entityId, version));
  if (!current) return false;
  const questions = new Map(
    state.events.filter((item) => item.kind === "question").map((item) => [String(item.id), item]),
  );
  const active = [
    ...currentFoundryQuestions(state),
    ...currentFoundryInvestigations(state),
    ...currentFoundryDecisions(state)
      .map((answer) => questions.get(String(answer.question_id)))
      .filter((item) => item !== undefined),
    ...currentFoundryAssumptions(state),
  ];
  for (const item of active) {
    if (!Object.hasOwn(item, "object_scope") || item.dataset_type !== type) continue;
    const scope = record(item.object_scope);
    if (scope.entity_id !== entityId || scope.version !== version) continue;
    if (scope.row_sha256 === current.row_sha256) continue;
    if (
      item.kind === "question" &&
      indexedAdoptionLineage(
        adoptions ?? indexedFoundryRowAdoptions(context, entries),
        current,
        String(scope.row_sha256),
        decisionFamily(state, String(item.id)),
      ).current
    )
      continue;
    return false;
  }
  return true;
}

export function requireCurrentFoundryObjectScope(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  state: FoundryInteractionState,
  objects: ReadonlyMap<string, CurrentFoundryObject | null>,
  type: string,
  entityId: string,
  version: string,
): CurrentFoundryObject {
  const current = requireCurrentFoundryObject(objects, type, entityId, version);
  if (!currentFoundryObjectScopeIsBound(context, entries, state, objects, type, entityId, version))
    scopeError(
      "Object evidence changed without an indexed decision-bound row successor; review this object again before applying its old choice.",
    );
  return current;
}

/** Recheck the current indexed interaction before any write approval or approved continuation. */
export function currentFoundryInteractionWriteBlocker(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): Readonly<{ code: string; message: string; scope?: string }> | null {
  const interaction = currentFoundryInteractionState(context, entries);
  if (!interaction) return null;
  if (
    currentFoundryQuestions(interaction.state).length ||
    currentFoundryInvestigations(interaction.state).length
  )
    return {
      code: "interaction_decision_pending",
      message: "Resolve the current question or investigation before a write handoff.",
    };
  const narrow = currentFoundryNarrowObjects(interaction.state);
  if (!narrow.length) return null;
  const objects = currentFoundryObjectScopes(context, entries);
  const adoptions = indexedFoundryRowAdoptions(context, entries);
  for (const item of narrow)
    if (
      !currentFoundryObjectScopeIsBound(
        context,
        entries,
        interaction.state,
        objects,
        item.dataset_type,
        item.entity_id,
        item.version,
        adoptions,
      )
    )
      return {
        code: "interaction_object_evidence_changed",
        message: `Review ${item.dataset_type} ${item.entity_id}@${item.version} against its current registered row before a write handoff.`,
        scope: `${item.dataset_type}:${item.entity_id}`,
      };
  const pending = currentFoundryObjectDecisionReassessments(
    interaction.state,
    objects,
    adoptions,
    false,
  )[0];
  return pending
    ? {
        code: "interaction_object_decision_changed",
        message: `Review and adopt current decision ${pending.decision_id} for ${pending.dataset_type} ${pending.entity_id}@${pending.version} before a write handoff.`,
        scope: `${pending.dataset_type}:${pending.entity_id}`,
      }
    : null;
}

export function assertFoundryInteractionWriteReady(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): void {
  const blocker = currentFoundryInteractionWriteBlocker(context, entries);
  if (blocker) throw new FoundryContextError(blocker.code, blocker.message);
}
