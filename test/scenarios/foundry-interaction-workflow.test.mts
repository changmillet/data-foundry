import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { runFoundryTaskOperation } from "../../scripts/lib/foundry-task-store.ts";
import { selectFoundryInteractionInput } from "../../scripts/lib/foundry-interaction-input.ts";
import { recordFoundryInteractionInput } from "../../scripts/lib/foundry-workflow-interaction.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const actor = "agent/session-190";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

test("a live question and revised answer survive a new process and do not imply write approval", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-interaction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const source = path.join(root, "source.jsonl");
  const specFile = path.join(root, "spec.json");
  const descriptor = path.join(root, "interaction.json");
  fs.writeFileSync(source, '{"flowDataSet":{"@id":"test-flow"}}\n');
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "request-190",
      actor_id: actor,
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: source }],
      seed: null,
      account_intent: null,
      preparation: {
        operation: "dataset-curation-cleanup",
        type: "flow",
        input: source,
        source_input: null,
        output_directory: "outputs/cleanup",
      },
    }),
  );
  const facade = createFoundryFacade({ moduleUrl, workspace, cacheBase: path.join(root, "cache") });
  assert.equal(facade.initialize().status, "ready");
  const started = await facade.start({ specFile });
  assert.equal(started.status, "ready");
  const taskId = started.task_id!;
  const evidence = sha(fs.readFileSync(source));
  const write = (expected: string | null, events: unknown[]) =>
    fs.writeFileSync(
      descriptor,
      JSON.stringify({
        schema: "tiangong-foundry.interaction-input.v1",
        task_id: taskId,
        actor_id: actor,
        expected_state_sha256: expected,
        events,
      }),
    );
  const question = {
    kind: "question",
    id: "missing-unit",
    dataset_type: "flow",
    missing: "原始材料没有说明该数值的单位。",
    impact: "无法可靠地换算单位产品的用量。",
    recommendation: "先核对原表。",
    ask: "这个数值的单位是什么？",
    choices: ["提供原表", "暂时不知道，请先调查"],
    evidence_sha256: [evidence],
    supersedes: null,
  };
  write(null, [question]);
  const asked = await facade.resume({ taskId, actorId: actor, interactionInputFile: descriptor });
  assert.equal(asked.status, "needs_input");
  assert.equal(asked.permissions.state, "not_required");
  assert.ok(
    asked.next_actions.some(
      (action) =>
        action.kind === "human" &&
        action.code === "answer_current_question" &&
        action.instructions.includes("无法可靠地换算"),
    ),
  );
  const displayed = asked.next_actions.find(
    (action) => action.kind === "human" && action.code === "answer_current_question",
  );
  assert.ok(displayed?.kind === "human");
  for (const detail of [
    question.missing,
    question.impact,
    question.recommendation,
    question.ask,
    ...question.choices,
  ])
    assert.ok(displayed.instructions.includes(detail), `The visible question omitted ${detail}`);
  const partialRecap = asked.artifacts.find((artifact) => artifact.role === "decision_recap");
  assert.ok(partialRecap?.kind === "inline");
  const partial = partialRecap.value as {
    completion_proven: boolean;
    unresolved_questions: Array<{ id: string }>;
  };
  assert.equal(partial.completion_proven, false);
  assert.deepEqual(
    partial.unresolved_questions.map((item) => item.id),
    ["missing-unit"],
  );
  const current = asked.artifacts.find((artifact) => artifact.role === "current_interaction_state");
  assert.ok(current && current.kind === "file");
  const firstSha = current.sha256;
  const index = path.join(workspace, ".foundry/workspaces", taskId, "artifact-index.jsonl");
  const indexBefore = fs.readFileSync(index);
  assert.deepEqual(
    await facade.resume({ taskId, actorId: actor, interactionInputFile: descriptor }),
    asked,
  );
  assert.deepEqual(fs.readFileSync(index), indexBefore);

  write(firstSha, [
    {
      kind: "answer",
      question_id: "missing-unit",
      decision_id: "investigate-original-table",
      supersedes_decision_id: null,
      raw_answer: "不确定，请先调查。",
      adopted_decision: null,
      disposition: "investigate",
      evidence_sha256: [],
    },
  ]);
  const deferred = await facade.resume({
    taskId,
    actorId: actor,
    interactionInputFile: descriptor,
  });
  assert.equal(deferred.status, "needs_input");
  assert.equal(deferred.blockers[0]?.code, "interaction_investigation_pending");
  assert.equal(deferred.next_actions.filter((action) => action.kind === "human").length, 0);
  assert.ok(
    !deferred.next_actions.some(
      (action) => action.kind === "human" && action.code === "answer_current_question",
    ),
  );
  const second = deferred.artifacts.find(
    (artifact) => artifact.role === "current_interaction_state",
  );
  assert.ok(second && second.kind === "file");

  write(firstSha, [
    {
      kind: "answer",
      question_id: "missing-unit",
      decision_id: "stale-answer",
      supersedes_decision_id: "investigate-original-table",
      raw_answer: "kWh",
      adopted_decision: "Use kWh",
      disposition: "decided",
      evidence_sha256: [],
    },
  ]);
  const stale = await facade.resume({ taskId, actorId: actor, interactionInputFile: descriptor });
  assert.notEqual(stale.status, "ready");
  assert.ok(
    stale.blockers.some(
      (blocker) =>
        blocker.code === "interaction_input_invalid" ||
        blocker.code === "interaction_state_changed",
    ),
  );

  write(second.sha256, [
    {
      kind: "answer",
      question_id: "missing-unit",
      decision_id: "confirmed-unit",
      supersedes_decision_id: "investigate-original-table",
      raw_answer: "原表确认是 kWh。",
      adopted_decision: "Use kWh as the original unit; retain the table as evidence.",
      disposition: "decided",
      evidence_sha256: [evidence],
    },
  ]);
  const resumedFacade = createFoundryFacade({
    moduleUrl,
    workspace,
    cacheBase: path.join(root, "cache"),
  });
  const decided = await resumedFacade.resume({
    taskId,
    actorId: actor,
    interactionInputFile: descriptor,
  });
  assert.equal(decided.status, "ready");
  assert.equal(decided.permissions.state, "not_required");
  const decidedRecap = decided.artifacts.find((artifact) => artifact.role === "decision_recap");
  assert.ok(decidedRecap?.kind === "inline");
  const decisionSummary = decidedRecap.value as {
    completion_proven: boolean;
    user_decisions: Array<{
      decision_id: string;
      supersedes_decision_id: string;
      raw_answer_sha256: string;
    }>;
  };
  assert.equal(decisionSummary.completion_proven, false);
  assert.deepEqual(
    decisionSummary.user_decisions.map((item) => item.decision_id),
    ["confirmed-unit"],
  );
  assert.equal(
    decisionSummary.user_decisions[0]?.supersedes_decision_id,
    "investigate-original-table",
  );
  assert.equal(
    decisionSummary.user_decisions[0]?.raw_answer_sha256,
    sha(Buffer.from("原表确认是 kWh。")),
  );
  assert.equal("raw_answer" in decisionSummary.user_decisions[0], false);
  assert.ok(decided.artifacts.some((artifact) => artifact.role === "current_interaction_state"));
  assert.ok(
    (await resumedFacade.status({ taskId, actorId: actor })).artifacts.some(
      (artifact) => artifact.role === "current_interaction_state",
    ),
  );

  const baseContext = createFoundryRuntimeContext({
    moduleUrl,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId,
    actorId: actor,
    inputs: [captureFoundryInput(source)],
  });
  const inspected = await createFoundryRuntime(baseContext).inspectTask();
  const selectedContext = createFoundryRuntimeContext({
    moduleUrl,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId,
    actorId: actor,
    inputs: [
      captureFoundryInput(source),
      ...inspected.artifacts.map((entry) =>
        captureFoundryInput(path.join(baseContext.taskRoot!, entry.path)),
      ),
    ],
  });
  await runFoundryTaskOperation(
    selectedContext,
    { command: "dataset-workflow-execution-prepare", options: { scenario: "interaction-lock" } },
    (operation) => {
      operation.writeJson("outputs/interaction-lock/owner-execution-request.json", {
        schema: "test-only-owner-request",
      });
      const result = { status: "completed" };
      operation.writeJson("outputs/interaction-lock/result.json", result);
      return result;
    },
  );
  const latestState = decided.artifacts.find(
    (artifact) => artifact.role === "current_interaction_state",
  );
  assert.ok(latestState?.kind === "file");
  write(latestState.sha256, [
    {
      kind: "assumption",
      id: "late-method",
      dataset_type: "flow",
      statement: "Use a later method.",
      impact: "Would change the reviewed result.",
      evidence_sha256: [],
      supersedes: null,
    },
  ]);
  await assert.rejects(
    recordFoundryInteractionInput(
      selectedContext,
      inspected.artifacts,
      selectFoundryInteractionInput(selectedContext, descriptor),
      ["flow"],
    ),
    { code: "interaction_after_approval" },
  );
});
