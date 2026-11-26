import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { SelectedSemanticInput } from "./foundry-semantic-input.ts";
import {
  readWorkflowArtifact,
  workflowObject,
  type WorkflowRowSet,
} from "./foundry-workflow-state.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readJsonOrJsonl, ensureArray, readRows } from "./import-curation/internal/runtime-io.ts";
import type {
  SemanticObjectIdentity,
  verifyFoundrySemanticInteraction,
} from "./foundry-semantic-interaction.ts";
import { foundryExplicitObjectIdentity } from "./foundry-workflow-object-scope.ts";
import { foundryInteractionObjectKey } from "./foundry-interaction-scope.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export function failSemantic(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

export function semanticText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value)
    failSemantic("semantic_work_invalid", `${label} is missing.`);
  return value;
}

/** Index only selected identities while reading one row set once. Null marks an ambiguous match. */
export function indexedFoundryAdoptionRows(
  file: string,
  type: string,
  selectedKeys: ReadonlySet<string>,
  reader?: (file: string) => string,
): ReadonlyMap<string, string | null> {
  const indexed = new Map<string, string | null>();
  for (const row of readRows(file, reader)) {
    const identity = foundryExplicitObjectIdentity(row, type);
    if (!identity) continue;
    const key = foundryInteractionObjectKey(type, identity.entity_id, identity.version);
    if (!selectedKeys.has(key)) continue;
    indexed.set(key, indexed.has(key) ? null : sha256Json(row));
  }
  return indexed;
}

export function uniqueAdoptionRowSha(
  indexed: ReadonlyMap<string, string | null>,
  key: string,
): string {
  const sha = indexed.get(key);
  if (!sha)
    failSemantic(
      "interaction_scope_invalid",
      "Object scope is missing or duplicated in its registered row set.",
    );
  return sha;
}

/** Keep one target per object even when a decision queue has several paths or categories. */
export function indexedFoundryDecisionWorkObjects(
  kind: "classification" | "location" | "identity",
  ownerType: string,
  targets: readonly unknown[],
): readonly SemanticObjectIdentity[] {
  if (!targets.length)
    failSemantic(
      "semantic_work_scope_invalid",
      "The registered decision task has no target objects.",
    );
  const objects = new Map<string, SemanticObjectIdentity>();
  for (const raw of targets) {
    const target = workflowObject(raw);
    const type = semanticText(target.dataset_type, "Decision target dataset type");
    const entityId = semanticText(target.dataset_id, "Decision target entity id");
    const version = semanticText(target.dataset_version, "Decision target version");
    if (!type.trim() || !entityId.trim() || !version.trim())
      failSemantic(
        "semantic_work_scope_invalid",
        "Decision target needs an explicit id and version.",
      );
    if (type !== ownerType)
      failSemantic(
        "semantic_work_scope_invalid",
        `${kind} decision task targets another row type; review the exact target and reassess it separately before applying scoped human decisions.`,
      );
    objects.set(foundryInteractionObjectKey(type, entityId, version), {
      dataset_type: type,
      entity_id: entityId,
      version,
    });
    if (objects.size > 1_000)
      failSemantic(
        "semantic_work_scope_invalid",
        "Decision task spans more than 1,000 objects; split and reassess exact target batches.",
      );
  }
  return [...objects.values()];
}

export function registeredDecisionWorkObjects(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  item: {
    kind: "classification" | "location" | "identity";
    type: string;
    rows: string;
    task: string;
    queue: string | null;
    sha: string;
  },
): readonly SemanticObjectIdentity[] {
  const taskEntry = entries.find(
    (entry) => resolveFoundryOutput(context, entry.path) === item.task,
  );
  if (!taskEntry || taskEntry.sha256 !== item.sha)
    failSemantic(
      "semantic_work_unregistered",
      "Decision target task is not the registered work item.",
    );
  const task = readWorkflowArtifact(context, taskEntry).value;
  if (task.task_kind !== `${item.kind}_decision_authoring`)
    failSemantic(
      "semantic_work_scope_invalid",
      "Decision task kind differs from its assessed owner.",
    );
  if (item.kind === "identity") {
    if (
      !Array.isArray(task.identity_action_items) ||
      Number(workflowObject(task.counts).selected_unique_identity_targets) !==
        task.identity_action_items.length
    )
      failSemantic("semantic_work_scope_invalid", "Identity task has no exact target roster.");
    return indexedFoundryDecisionWorkObjects(item.kind, item.type, task.identity_action_items);
  }
  if (!item.queue)
    failSemantic("semantic_work_scope_invalid", "Decision task has no registered target queue.");
  const queueEntry = entries.find(
    (entry) => resolveFoundryOutput(context, entry.path) === item.queue,
  );
  if (!queueEntry)
    failSemantic(
      "semantic_work_unregistered",
      "Decision target queue is not registered in this task.",
    );
  const declaredQueue = semanticText(task[`${item.kind}_queue`], "Decision task queue");
  if (path.resolve(context.assetRoot, declaredQueue) !== item.queue)
    failSemantic("semantic_work_scope_invalid", "Decision task and assessed queue differ.");
  const bytes = readFoundryInput(context, item.queue);
  if (
    bytes.length !== queueEntry.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== queueEntry.sha256
  )
    failSemantic("semantic_work_scope_invalid", "Registered decision queue bytes changed.");
  const targets = ensureArray(readJsonOrJsonl(item.queue, () => bytes.toString("utf8")));
  if (
    !Array.isArray(task[`${item.kind}_queue_rows`]) ||
    JSON.stringify(targets) !== JSON.stringify(task[`${item.kind}_queue_rows`]) ||
    Number(workflowObject(task.counts).queue_rows) !== targets.length
  )
    failSemantic("semantic_work_scope_invalid", "Decision task target queue is inconsistent.");
  for (const raw of targets) {
    const target = workflowObject(raw);
    if (
      typeof target.source_file !== "string" ||
      path.resolve(context.assetRoot, target.source_file) !== item.rows
    )
      failSemantic(
        "semantic_work_scope_invalid",
        "Decision queue targets a different assessed row set.",
      );
  }
  return indexedFoundryDecisionWorkObjects(item.kind, item.type, targets);
}

export function findPriorSemanticApplication(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  submission: SelectedSemanticInput,
): Record<string, unknown> | null {
  for (const entry of [...entries].reverse()) {
    if (
      entry.command !== "dataset-semantic-apply" ||
      path.basename(entry.path) !== "semantic-result.json"
    )
      continue;
    const value = readWorkflowArtifact(context, entry).value;
    if (value.status === "completed" && value.submission_sha256 === submission.descriptor.sha256)
      return value;
  }
  return null;
}

export function verifySemanticNarrowObjectAdoptions({
  context,
  blockers,
  decisionWork,
  narrowObjects,
  currentObjects,
  adoptedDecisions,
  originalSets,
  updated,
}: {
  context: FoundryRuntimeContext;
  blockers: readonly Record<string, unknown>[];
  decisionWork: readonly { kind: "classification" | "location" | "identity"; sha: string }[];
  narrowObjects: readonly SemanticObjectIdentity[];
  currentObjects: ReadonlyMap<string, { readonly row_sha256: string } | null> | null;
  adoptedDecisions: ReturnType<typeof verifyFoundrySemanticInteraction>;
  originalSets: readonly WorkflowRowSet[];
  updated: ReadonlyMap<string, WorkflowRowSet>;
}) {
  if (!blockers.length && decisionWork.length && narrowObjects.length) {
    const decisionTargetKeys = new Set(
      adoptedDecisions
        .filter((adopted) => decisionWork.some((item) => item.sha === adopted.work_item_sha256))
        .filter((adopted) => adopted.object_scope)
        .map((adopted) =>
          foundryInteractionObjectKey(
            adopted.dataset_type,
            adopted.object_scope!.entity_id,
            adopted.object_scope!.version,
          ),
        ),
    );
    const narrowByUpdatedType = new Map<string, Set<string>>();
    for (const object of narrowObjects) {
      if (!updated.has(object.dataset_type)) continue;
      const selected = narrowByUpdatedType.get(object.dataset_type) ?? new Set<string>();
      selected.add(
        foundryInteractionObjectKey(object.dataset_type, object.entity_id, object.version),
      );
      narrowByUpdatedType.set(object.dataset_type, selected);
    }
    for (const [type, keys] of narrowByUpdatedType) {
      const after = indexedFoundryAdoptionRows(updated.get(type)!.file, type, keys);
      for (const key of keys) {
        const before = currentObjects!.get(key);
        if (!before)
          failSemantic(
            "semantic_work_scope_invalid",
            "A reviewed object is missing or ambiguous in the current row set; recheck that exact object before applying decisions to this row set.",
          );
        if (after.get(key) === before.row_sha256) continue;
        if (decisionWork.some((item) => item.kind === "identity"))
          failSemantic(
            "semantic_identity_scope_unverifiable",
            "Identity decisions changed a reviewed object or its references without a stable row successor. Reassess that exact object before continuing.",
          );
        if (!decisionTargetKeys.has(key))
          failSemantic(
            "semantic_work_scope_invalid",
            "A decision task changed a reviewed object outside its registered target queue; reassess the affected object and decision task.",
          );
      }
    }
  }
  const adoptionKeysByType = new Map<string, Set<string>>();
  if (!blockers.length)
    for (const adopted of adoptedDecisions) {
      const object = adopted.object_scope;
      if (!object) continue;
      const keys = adoptionKeysByType.get(adopted.dataset_type) ?? new Set<string>();
      keys.add(foundryInteractionObjectKey(adopted.dataset_type, object.entity_id, object.version));
      adoptionKeysByType.set(adopted.dataset_type, keys);
    }
  const adoptionRowsByType = new Map<
    string,
    { before: ReadonlyMap<string, string | null>; after: ReadonlyMap<string, string | null> }
  >();
  for (const [type, keys] of adoptionKeysByType) {
    const before = originalSets.find((set) => set.type === type);
    const after = updated.get(type);
    if (!before || !after)
      failSemantic("semantic_row_scope_changed", "Object adoption has no exact row successor.");
    adoptionRowsByType.set(type, {
      before: indexedFoundryAdoptionRows(before.file, type, keys, (file) =>
        readFoundryInput(context, file).toString("utf8"),
      ),
      after: indexedFoundryAdoptionRows(after.file, type, keys),
    });
  }
  return blockers.length
    ? []
    : adoptedDecisions.flatMap((adopted) => {
        const object = adopted.object_scope;
        if (!object) return [];
        const key = foundryInteractionObjectKey(
          adopted.dataset_type,
          object.entity_id,
          object.version,
        );
        const indexed = adoptionRowsByType.get(adopted.dataset_type);
        if (!indexed)
          failSemantic("semantic_row_scope_changed", "Object adoption has no exact row successor.");
        if (
          !indexed.after.get(key) &&
          decisionWork.some(
            (item) => item.sha === adopted.work_item_sha256 && item.kind === "identity",
          )
        )
          failSemantic(
            "semantic_identity_scope_unverifiable",
            "Identity decision removed or duplicated a target object, so its object-level adoption cannot be proven. Review that exact identity outcome before continuing.",
          );
        return [
          {
            dataset_type: adopted.dataset_type,
            object_scope: object,
            work_item_sha256: adopted.work_item_sha256,
            before_row_sha256: uniqueAdoptionRowSha(indexed.before, key),
            after_row_sha256: uniqueAdoptionRowSha(indexed.after, key),
            decision_ids: adopted.decision_ids,
          },
        ];
      });
}
