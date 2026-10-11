import assert from "node:assert/strict";
import test from "node:test";
import { parseFoundryIdentityStageInput } from "../../scripts/lib/foundry-identity-stage-input.ts";

const valid = {
  schema: "tiangong-foundry.identity-stage-input.v1",
  intent_id: "di-readonly-stage-1",
  task_id: `task-${"a".repeat(64)}-r0001`,
  actor_id: "original-writer",
  rows_report_sha256: "b".repeat(64),
  predecessor_identity_sha256: "c".repeat(64),
  targets: [
    {
      dataset_type: "flow",
      dataset_id: "11111111-1111-4111-8111-111111111111",
      dataset_version: "00.00.001",
      source_row_sha256: "d".repeat(64),
    },
  ],
};
test("explicit new-stage input selects a bounded exact unchanged roster", () => {
  const parsed = parseFoundryIdentityStageInput(valid);
  assert.equal(parsed.intent_id, valid.intent_id);
  assert.deepEqual(parsed.targets, valid.targets);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.targets));
});
test("new-stage input cannot carry engineering authority, writes or ambiguous targets", () => {
  for (const value of [
    { ...valid, engineering_generation: 2 },
    { ...valid, authorization: { write: true } },
    { ...valid, intent_id: "" },
    { ...valid, actor_id: "" },
    { ...valid, task_id: "new-task" },
    { ...valid, rows_report_sha256: "wrong" },
    { ...valid, predecessor_identity_sha256: null },
    { ...valid, targets: [] },
    { ...valid, targets: [...valid.targets, ...valid.targets] },
    { ...valid, targets: [{ ...valid.targets[0], dataset_type: "source" }] },
    { ...valid, targets: [{ ...valid.targets[0], source_row_sha256: "wrong" }] },
    { ...valid, targets: [{ ...valid.targets[0], mutate: true }] },
  ])
    assert.throws(() => parseFoundryIdentityStageInput(value));
});
