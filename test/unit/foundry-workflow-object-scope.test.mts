import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  advanceFoundryInteractionState,
  foundryInteractionObjectProofKey,
  parseFoundryInteractionInput,
} from "../../scripts/lib/foundry-interaction-input.ts";
import { foundryInteractionObjectKey } from "../../scripts/lib/foundry-interaction-scope.ts";
import type { ArtifactEntry } from "../../scripts/lib/foundry-task-types.ts";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  currentFoundryObjectDecisionReassessments,
  currentFoundryObjectScopeIsBound,
  foundryExplicitObjectIdentity,
  indexedFoundryRowAdoptions,
  requireCurrentFoundryObjectScope,
  type CurrentFoundryObject,
} from "../../scripts/lib/foundry-workflow-object-scope.ts";

const firstId = "66666666-6666-4666-8666-666666666666";
const secondId = "77777777-7777-4777-8777-777777777777";
const version = "00.00.001";
const originalFirstHash = "1".repeat(64);
const originalSecondHash = "2".repeat(64);
const changedFirstHash = "3".repeat(64);

test("narrow identity requires explicit agreeing row and payload identifiers", () => {
  const row = {
    id: firstId,
    version,
    json: {
      processDataSet: {
        processInformation: { dataSetInformation: { "common:UUID": firstId } },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": version },
        },
      },
    },
  };
  assert.deepEqual(foundryExplicitObjectIdentity(row, "process"), {
    entity_id: firstId,
    version,
  });
  assert.equal(foundryExplicitObjectIdentity({ ...row, id: secondId }, "process"), null);
  assert.equal(foundryExplicitObjectIdentity({ ...row, version: "01.00.001" }, "process"), null);
  assert.equal(foundryExplicitObjectIdentity({ json: { processDataSet: {} } }, "process"), null);
});

test("an independent P1 row change cannot carry an old decision while unchanged P2 stays bound", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-object-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: `task-${"a".repeat(64)}-r0001`,
    actorId: "object-scope-actor",
  });
  const question = (id: string, rowHash: string, questionId: string) => ({
    kind: "question",
    id: questionId,
    dataset_type: "process",
    object_scope: { entity_id: id, version, row_sha256: rowHash },
    missing: `The source does not resolve ${questionId}.`,
    impact: "A process decision depends on this answer.",
    recommendation: "Ask the reviewer for the exact source-backed choice.",
    ask: `How should ${questionId} be handled?`,
    choices: ["Use the source", "Investigate first"],
    evidence_sha256: [],
    supersedes: null,
  });
  const state = advanceFoundryInteractionState(
    null,
    parseFoundryInteractionInput({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: context.taskId,
      actor_id: context.actorId,
      expected_state_sha256: null,
      events: [
        question(firstId, originalFirstHash, "p1-method"),
        question(secondId, originalSecondHash, "p2-method"),
        {
          kind: "answer",
          question_id: "p1-method",
          decision_id: "p1-answer",
          supersedes_decision_id: null,
          raw_answer: "Use the documented P1 method.",
          adopted_decision: "Apply the documented P1 method only to P1.",
          disposition: "decided",
          evidence_sha256: [],
        },
      ],
    }),
    null,
    new Set(),
    new Set(["process"]),
    new Set([
      foundryInteractionObjectProofKey("process", firstId, version, originalFirstHash),
      foundryInteractionObjectProofKey("process", secondId, version, originalSecondHash),
    ]),
  );
  const objects = new Map<string, CurrentFoundryObject>([
    [
      foundryInteractionObjectKey("process", firstId, version),
      { dataset_type: "process", entity_id: firstId, version, row_sha256: changedFirstHash },
    ],
    [
      foundryInteractionObjectKey("process", secondId, version),
      { dataset_type: "process", entity_id: secondId, version, row_sha256: originalSecondHash },
    ],
  ]);

  // A plausible local file is not adoption evidence until an owner receipt indexes it.
  const unindexed = path.join(context.taskRoot!, "outputs", "unindexed", "semantic-result.json");
  fs.mkdirSync(path.dirname(unindexed), { recursive: true });
  fs.writeFileSync(
    unindexed,
    JSON.stringify({
      status: "completed",
      row_adoptions: [
        {
          dataset_type: "process",
          object_scope: { entity_id: firstId, version },
          before_row_sha256: originalFirstHash,
          after_row_sha256: changedFirstHash,
          decision_ids: ["p1-answer"],
        },
      ],
    }),
  );
  const indexedEntries: readonly ArtifactEntry[] = [];
  assert.equal(
    currentFoundryObjectScopeIsBound(
      context,
      indexedEntries,
      state,
      objects,
      "process",
      firstId,
      version,
    ),
    false,
  );
  assert.throws(
    () =>
      requireCurrentFoundryObjectScope(
        context,
        indexedEntries,
        state,
        objects,
        "process",
        firstId,
        version,
      ),
    { code: "interaction_scope_invalid" },
  );
  assert.equal(
    currentFoundryObjectScopeIsBound(
      context,
      indexedEntries,
      state,
      objects,
      "process",
      secondId,
      version,
    ),
    true,
  );
  assert.equal(
    requireCurrentFoundryObjectScope(
      context,
      indexedEntries,
      state,
      objects,
      "process",
      secondId,
      version,
    ).row_sha256,
    originalSecondHash,
  );

  const relative = "outputs/indexed/semantic-result.json";
  const indexed = path.join(context.taskRoot!, relative);
  fs.mkdirSync(path.dirname(indexed), { recursive: true });
  const rowAdoption = {
    dataset_type: "process",
    object_scope: { entity_id: firstId, version },
    work_item_sha256: "e".repeat(64),
    before_row_sha256: originalFirstHash,
    after_row_sha256: changedFirstHash,
    decision_ids: ["p1-answer"],
  };
  const indexedReport = (decisionId: string) => ({
    status: "completed",
    row_adoptions: [rowAdoption],
    adopted_decisions: [
      {
        work_item_sha256: rowAdoption.work_item_sha256,
        dataset_type: "process",
        object_scope: rowAdoption.object_scope,
        decision_ids: [decisionId],
      },
    ],
  });
  const registered = (decisionId: string): ArtifactEntry => {
    const bytes = Buffer.from(JSON.stringify(indexedReport(decisionId)));
    fs.writeFileSync(indexed, bytes);
    return {
      schema: "tiangong-foundry.artifact-index.v2",
      sequence: 1,
      previous_sha256: null,
      operation_id: "test-indexed-semantic",
      command: "dataset-semantic-apply",
      input_scope_sha256: "f".repeat(64),
      receipt: { path: "receipt.json", sha256: "f".repeat(64) },
      record_sha256: "f".repeat(64),
      path: relative,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  assert.throws(
    () =>
      currentFoundryObjectScopeIsBound(
        context,
        [registered("unrelated-decision")],
        state,
        objects,
        "process",
        firstId,
        version,
      ),
    { code: "interaction_scope_invalid" },
    "a row lineage entry must agree with the independently recorded adopted decision",
  );
  assert.equal(
    currentFoundryObjectScopeIsBound(
      context,
      [registered("p1-answer")],
      state,
      objects,
      "process",
      firstId,
      version,
    ),
    true,
  );
  const firstAdoption = registered("p1-answer");
  assert.deepEqual(
    currentFoundryObjectDecisionReassessments(
      state,
      objects,
      indexedFoundryRowAdoptions(context, [firstAdoption]),
    ),
    [],
  );
  const corrected = advanceFoundryInteractionState(
    state,
    parseFoundryInteractionInput({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: context.taskId,
      actor_id: context.actorId,
      expected_state_sha256: "a".repeat(64),
      events: [
        {
          kind: "answer",
          question_id: "p1-method",
          decision_id: "p1-corrected-answer",
          supersedes_decision_id: "p1-answer",
          raw_answer: "Correction for P1 only.",
          adopted_decision: "Reassess the exact current P1 row.",
          disposition: "decided",
          evidence_sha256: [],
        },
      ],
    }),
    "a".repeat(64),
    new Set(),
    new Set(["process"]),
  );
  assert.equal(
    currentFoundryObjectScopeIsBound(
      context,
      [firstAdoption],
      corrected,
      objects,
      "process",
      firstId,
      version,
    ),
    true,
    "recorded D1 row ancestry still permits a scoped D2 reapplication",
  );
  assert.deepEqual(
    currentFoundryObjectDecisionReassessments(
      corrected,
      objects,
      indexedFoundryRowAdoptions(context, [firstAdoption]),
    ),
    [
      {
        dataset_type: "process",
        entity_id: firstId,
        version,
        decision_id: "p1-corrected-answer",
      },
    ],
    "old D1 row adoption cannot silently satisfy the corrected D2 answer",
  );
  const secondRelative = "outputs/indexed2/semantic-result.json";
  const secondFile = path.join(context.taskRoot!, secondRelative);
  fs.mkdirSync(path.dirname(secondFile), { recursive: true });
  const secondReport = {
    status: "completed",
    row_adoptions: [
      {
        ...rowAdoption,
        before_row_sha256: changedFirstHash,
        after_row_sha256: changedFirstHash,
        decision_ids: ["p1-corrected-answer"],
      },
    ],
    adopted_decisions: [
      {
        work_item_sha256: rowAdoption.work_item_sha256,
        dataset_type: "process",
        object_scope: rowAdoption.object_scope,
        decision_ids: ["p1-corrected-answer"],
      },
    ],
  };
  const secondBytes = Buffer.from(JSON.stringify(secondReport));
  fs.writeFileSync(secondFile, secondBytes);
  const secondAdoption: ArtifactEntry = {
    ...firstAdoption,
    operation_id: "test-second-semantic",
    path: secondRelative,
    bytes: secondBytes.length,
    sha256: createHash("sha256").update(secondBytes).digest("hex"),
  };
  assert.deepEqual(
    currentFoundryObjectDecisionReassessments(
      corrected,
      objects,
      indexedFoundryRowAdoptions(context, [firstAdoption, secondAdoption]),
    ),
    [],
  );
});
