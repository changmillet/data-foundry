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
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { flowRow, processRowWithFlowRef, sourceRow } from "../fixtures/row-builders.ts";

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
  await runFoundryTaskOperation(
    selectedContext,
    { command: "dataset-workflow-authorization", options: { scenario: "interaction-lock" } },
    (operation) => {
      const result = {
        schema: "test-only-authorization",
        status: "completed",
      };
      operation.writeJson("outputs/interaction-lock/foundry-authorization.json", result);
      return result;
    },
  );
  await assert.rejects(
    recordFoundryInteractionInput(
      selectedContext,
      inspected.artifacts,
      selectFoundryInteractionInput(selectedContext, descriptor),
      ["flow"],
    ),
    { code: "interaction_after_approval" },
    "the first indexed authorization freezes the reviewed decision scope",
  );
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

test("a pending human question leaves independent local preparation runnable", async (t) => {
  const { root, workspace, facade } = workflowFixture(t);
  const scenarios = [
    {
      name: "ordinary-import",
      lane: "external-dataset-curated-import",
      type: "process",
      source: "selected native-owner input",
      seed: false,
      cleanup: false,
      expectedArtifact: "foundry-native-import.json",
    },
    {
      name: "source-evidence",
      lane: "source-evidence-dataset-development",
      type: "flow",
      source: JSON.stringify({ rows: [flowRow("81818181-8181-4818-8818-818181818181")] }),
      seed: true,
      cleanup: false,
      expectedArtifact: "foundry-context.json",
    },
    {
      name: "blocked-process-queue",
      lane: "source-evidence-dataset-development",
      type: "process",
      source: JSON.stringify({
        rows: [
          sourceRow("85858585-8585-4858-8858-858585858585"),
          processRowWithFlowRef(
            "83838383-8383-4838-8838-838383838383",
            "84848484-8484-4848-8848-848484848484",
          ),
        ],
      }),
      seed: true,
      cleanup: false,
      expectedArtifact: "foundry-context.json",
    },
    {
      name: "explicit-cleanup",
      lane: "external-dataset-curated-import",
      type: "flow",
      source: JSON.stringify({ rows: [flowRow("82828282-8282-4828-8828-828282828282")] }),
      seed: false,
      cleanup: true,
      expectedArtifact: "dataset-curation-cleanup-report.json",
    },
  ] as const;
  for (const scenario of scenarios) {
    const source = path.join(root, `${scenario.name}-source.json`);
    const specFile = path.join(root, `${scenario.name}-request.json`);
    const descriptor = path.join(root, `${scenario.name}-question.json`);
    fs.writeFileSync(source, scenario.source);
    fs.writeFileSync(
      specFile,
      JSON.stringify({
        schema: "tiangong-foundry.task-start.v1",
        request_id: `issue-196-${scenario.name}`,
        actor_id: "issue-196-local",
        lane: scenario.lane,
        profile_id: "generic",
        target_entities:
          scenario.name === "blocked-process-queue" ? ["source", "process"] : [scenario.type],
        sources: [{ path: source }],
        seed: scenario.seed ? { path: source } : null,
        account_intent: null,
        preparation: scenario.cleanup
          ? {
              operation: "dataset-curation-cleanup",
              type: scenario.type,
              input: source,
              source_input: null,
              output_directory: `outputs/${scenario.name}`,
            }
          : null,
      }),
    );
    const started = await facade.start({ specFile });
    assert.equal(started.status, "ready");
    assert.ok(started.task_id);
    fs.writeFileSync(
      descriptor,
      JSON.stringify({
        schema: "tiangong-foundry.interaction-input.v1",
        task_id: started.task_id,
        actor_id: "issue-196-local",
        expected_state_sha256: null,
        events: [
          {
            kind: "question",
            id: `purpose-${scenario.name}`,
            dataset_type: null,
            missing: "The selected source leaves its intended use unclear.",
            impact: "Scientific authoring depends on that choice.",
            recommendation: "Ask now and continue independent local preparation.",
            ask: "What is the intended use?",
            choices: ["Specify the goal", "Investigate first"],
            evidence_sha256: [sha(fs.readFileSync(source))],
            supersedes: null,
          },
        ],
      }),
    );
    const invocation = { taskId: started.task_id, actorId: "issue-196-local" };
    const asked = await facade.resume({ ...invocation, interactionInputFile: descriptor });
    assert.equal(asked.status, "needs_input", scenario.name);
    assert.equal(asked.permissions.state, "not_required", scenario.name);
    assert.ok(
      asked.next_actions.some((action) => action.kind === "human"),
      `${scenario.name} must preserve the human question`,
    );
    assert.ok(
      asked.next_actions.some(
        (action) => action.kind === "command" && action.code === "resume_local_preparation",
      ),
      `${scenario.name} must expose the independent local preparation`,
    );
    const progressed = await facade.resume(invocation);
    assert.equal(progressed.status, "needs_input", scenario.name);
    assert.ok(
      progressed.artifacts.some((artifact) => artifact.role === scenario.expectedArtifact),
      `${scenario.name} did not register its independent local stage`,
    );
    assert.equal(progressed.permissions.state, "not_required", scenario.name);
    assert.ok(
      progressed.artifacts.every(
        (artifact) =>
          ![
            "foundry-finalize.json",
            "foundry-authorization.json",
            "owner-execution-request.json",
            "consumed.json",
          ].includes(artifact.role),
      ),
      `${scenario.name} cannot reach remote authority while the question is pending`,
    );
    const refused = await facade.resume({
      ...invocation,
      authorizationInputFile: path.join(root, "unselected-authorization.json"),
    });
    assert.equal(refused.blockers[0]?.code, "interaction_decision_pending", scenario.name);
    let current = progressed;
    let independentAfterQueueBlocker = false;
    for (let step = 0; step < 8; step += 1) {
      if (!current.next_actions.some((action) => action.kind === "command")) break;
      current = await facade.resume(invocation);
      assert.equal(current.status, "needs_input", scenario.name);
      assert.equal(current.permissions.state, "not_required", scenario.name);
      if (
        current.blockers.some((item) => item.code === "curation_queue_blocked") &&
        current.next_actions.some((action) => action.kind === "command")
      )
        independentAfterQueueBlocker = true;
    }
    assert.equal(
      current.next_actions.some((action) => action.kind === "command"),
      false,
      `${scenario.name} must stop before identity, finalization and execution`,
    );
    assert.ok(current.next_actions.some((action) => action.kind === "human"));
    if (scenario.name === "blocked-process-queue") {
      assert.equal(
        independentAfterQueueBlocker,
        true,
        "independent Source work must remain runnable after blocked Process closure",
      );
      const queue = current.artifacts.find(
        (artifact) => artifact.role === "curation-queue-manifest.json",
      );
      const blockers = current.artifacts.find(
        (artifact) => artifact.role === "curation-queue-blockers.jsonl",
      );
      assert.ok(queue?.kind === "file");
      assert.ok(blockers?.kind === "file");
      const manifest = JSON.parse(fs.readFileSync(queue.path, "utf8"));
      assert.equal(manifest.status, "blocked");
      assert.equal(manifest.counts.blockers, 1);
      assert.equal(manifest.blockers[0]?.code, "process_flow_reference_unresolved");
      assert.equal(
        manifest.blockers[0]?.details?.missing_flow_refs?.[0]?.id,
        "84848484-8484-4848-8848-848484848484",
      );
      assert.ok(
        current.next_actions.some(
          (action) => action.kind === "human" && action.code === "review_queue_blockers",
        ),
        "the pending question must not hide the exact registered closure gap",
      );
      assert.ok(current.artifacts.some((artifact) => artifact.role === "foundry-assessment.json"));
      const assessment = current.artifacts.findLast(
        (artifact) => artifact.role === "foundry-assessment.json",
      );
      assert.ok(assessment?.kind === "file");
      assert.deepEqual(
        JSON.parse(fs.readFileSync(assessment.path, "utf8"))
          .sets.map((set: { type: string }) => set.type)
          .sort(),
        ["process", "source"],
        "independent source assessment must remain recorded despite Process closure blockers",
      );
    }
    assert.ok(
      current.artifacts.every(
        (artifact) =>
          ![
            "foundry-finalize.json",
            "foundry-authorization.json",
            "owner-execution-request.json",
            "consumed.json",
          ].includes(artifact.role),
      ),
    );
    const index = path.join(
      workspace,
      ".foundry",
      "workspaces",
      started.task_id,
      "artifact-index.jsonl",
    );
    const beforeRepeat = fs.readFileSync(index);
    const repeated = await facade.resume(invocation);
    assert.deepEqual(fs.readFileSync(index), beforeRepeat, "pending work must not replay stages");
    assert.equal(
      repeated.next_actions.some((action) => action.kind === "command"),
      false,
    );
    assert.equal(repeated.permissions.state, "not_required");
  }
});
