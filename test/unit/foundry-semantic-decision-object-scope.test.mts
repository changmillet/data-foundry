import assert from "node:assert/strict";
import test from "node:test";
import { verifyFoundrySemanticInteraction } from "../../scripts/lib/foundry-semantic-interaction.ts";
import { indexedFoundryDecisionWorkObjects } from "../../scripts/lib/foundry-workflow-semantic.ts";
import type { FoundryInteractionState } from "../../scripts/lib/foundry-interaction-types.ts";
import type { FoundrySemanticInput } from "../../scripts/lib/foundry-semantic-input.ts";

const workItem = "a".repeat(64);
const first = { dataset_type: "process", entity_id: "p1", version: "01.00.000" };
const second = { dataset_type: "process", entity_id: "p2", version: "01.00.000" };
const question = {
  kind: "question",
  id: "p1-category",
  dataset_type: "process",
  object_scope: { entity_id: first.entity_id, version: first.version, row_sha256: "1".repeat(64) },
};
const answer = {
  kind: "answer",
  question_id: question.id,
  decision_id: "p1-category-d",
  disposition: "decided",
};

function state(answered: boolean): FoundryInteractionState {
  return {
    schema: "tiangong-foundry.interaction-state.v1",
    task_id: `task-${"b".repeat(64)}-r0001`,
    actor_id: "agent/test",
    events: answered ? [question, answer] : [question],
  };
}

function input(decisionIds: readonly string[] = []): FoundrySemanticInput {
  return {
    schema: "tiangong-foundry.semantic-input.v1",
    task_id: `task-${"b".repeat(64)}-r0001`,
    actor_id: "agent/test",
    assessment_sha256: "c".repeat(64),
    interaction_sha256: "d".repeat(64),
    submissions: [
      {
        kind: "classification",
        authoring_task_sha256: workItem,
        file: "decisions.jsonl",
        sha256: "e".repeat(64),
        decision_ids: decisionIds,
      },
    ],
  };
}

function verify(
  answered: boolean,
  targets: readonly (typeof first)[],
  decisionIds: readonly string[] = [],
) {
  return verifyFoundrySemanticInteraction(
    input(decisionIds),
    { sha256: "d".repeat(64), state: state(answered) },
    new Map([[workItem, targets]]),
  );
}

test("a P2-only decision task proceeds while P1 needs a human answer", () => {
  assert.deepEqual(verify(false, [second]), [
    {
      work_item_sha256: workItem,
      dataset_type: "process",
      object_scope: { entity_id: second.entity_id, version: second.version },
      decision_ids: [],
    },
  ]);
  assert.throws(() => verify(false, [second], [answer.decision_id]), /decision ids/iu);
});

test("a P1+P2 decision batch waits for P1, then attributes P1's answer only to P1", () => {
  assert.throws(() => verify(false, [first, second]), /decision gap/iu);
  assert.throws(() => verify(true, [first, second]), /decision ids/iu);
  assert.deepEqual(verify(true, [first, second], [answer.decision_id]), [
    {
      work_item_sha256: workItem,
      dataset_type: "process",
      object_scope: { entity_id: first.entity_id, version: first.version },
      decision_ids: [answer.decision_id],
    },
    {
      work_item_sha256: workItem,
      dataset_type: "process",
      object_scope: { entity_id: second.entity_id, version: second.version },
      decision_ids: [],
    },
  ]);
});

test("registered decision queues name exact target objects without duplicate attribution", () => {
  const queue = [
    { dataset_type: "process", dataset_id: "p1", dataset_version: first.version },
    { dataset_type: "process", dataset_id: "p1", dataset_version: first.version },
    { dataset_type: "process", dataset_id: "p2", dataset_version: second.version },
  ];
  assert.deepEqual(indexedFoundryDecisionWorkObjects("classification", "process", queue), [
    first,
    second,
  ]);
  assert.throws(
    () =>
      indexedFoundryDecisionWorkObjects("location", "process", [
        { dataset_type: "process", dataset_id: "p2" },
      ]),
    /version/iu,
  );
  assert.throws(
    () =>
      indexedFoundryDecisionWorkObjects("identity", "process", [
        { dataset_type: "flow", dataset_id: "f1", dataset_version: second.version },
      ]),
    /another row type/iu,
  );
});
