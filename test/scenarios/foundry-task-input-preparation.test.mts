import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { workflowFixture, digestFile } from "../fixtures/foundry-public-workflow.ts";
import { flowRow } from "../fixtures/row-builders.ts";
import { runFoundryPublicCommand } from "../../scripts/public-api.ts";

test("public input preparation binds question and answer atomically without changing task state", async (t) => {
  const { root, workspace, facade, facadeOptions } = workflowFixture(t);
  const source = path.join(root, "rows.json");
  fs.writeFileSync(
    source,
    JSON.stringify({ rows: [flowRow("11111111-1111-4111-8111-111111111111")] }),
  );
  const specFile = path.join(root, "task.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "prepare-input",
      actor_id: "prepare-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: source }],
      seed: { path: source },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const taskId = started.task_id;
  const draft = path.join(root, "interaction-draft.json");
  fs.writeFileSync(
    draft,
    JSON.stringify({
      schema: "tiangong-foundry.interaction-draft.v1",
      events: [
        {
          kind: "question",
          id: "q1",
          dataset_type: "flow",
          missing: "unit",
          impact: "conversion",
          recommendation: "kWh",
          ask: "Which unit?",
          choices: ["kWh"],
          evidence_files: [source],
          supersedes: null,
        },
        {
          kind: "answer",
          question_id: "q1",
          decision_id: "d1",
          supersedes_decision_id: null,
          raw_answer: "kWh",
          adopted_decision: "kWh",
          disposition: "decided",
          evidence_files: [],
        },
      ],
    }),
  );
  const index = path.join(workspace, ".foundry", "workspaces", taskId, "artifact-index.jsonl");
  const before = fs.readFileSync(index);
  let stdout = "",
    exitCode = -1;
  await runFoundryPublicCommand(
    [
      process.execPath,
      "tiangong-foundry",
      "task",
      "prepare-input",
      "--workspace",
      workspace,
      "--task",
      taskId,
      "--actor",
      "prepare-actor",
      "--kind",
      "interaction",
      "--input",
      draft,
      "--json",
    ],
    {
      ...facadeOptions,
      writeStdout: (text) => {
        stdout += text;
      },
      setExitCode: (code) => {
        exitCode = code;
      },
    },
  );
  assert.equal(exitCode, 0, stdout);
  const prepared = JSON.parse(stdout);
  assert.equal(prepared.operation, "task.prepare-input");
  const descriptor = prepared.artifacts.find(
    (item: { role: string }) => item.role === "prepared_task_input",
  ).value;
  assert.equal(descriptor.expected_state_sha256, null);
  assert.equal(descriptor.events[0].evidence_sha256[0], digestFile(source));
  assert.deepEqual(fs.readFileSync(index), before);
  const child = spawnSync(
    process.execPath,
    [
      path.resolve(import.meta.dirname, "../../scripts/foundry.ts"),
      "task",
      "prepare-input",
      "--workspace",
      workspace,
      "--task",
      taskId,
      "--actor",
      "prepare-actor",
      "--kind",
      "interaction",
      "--input",
      draft,
      "--json",
    ],
    { encoding: "utf8", cwd: root },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const childResult = JSON.parse(child.stdout);
  assert.deepEqual(
    childResult.artifacts.find((item: { role: string }) => item.role === "prepared_task_input")
      .value,
    descriptor,
  );
  assert.deepEqual(fs.readFileSync(index), before);
  const input = path.join(root, "interaction.json");
  fs.writeFileSync(input, JSON.stringify(descriptor));
  const registered = await facade.resume({
    taskId,
    actorId: "prepare-actor",
    interactionInputFile: input,
  });
  const current = registered.artifacts.find((item) => item.role === "current_interaction_state");
  assert.ok(current?.kind === "file");
  const state = JSON.parse(fs.readFileSync(current.path, "utf8"));
  assert.equal(state.events.length, 2);
  assert.equal(state.events[1].decision_id, "d1");
  const stale = structuredClone(descriptor);
  stale.events = [{ ...stale.events[1], decision_id: "d2", supersedes_decision_id: "d1" }];
  fs.writeFileSync(input, JSON.stringify(stale));
  const rejected = await facade.resume({
    taskId,
    actorId: "prepare-actor",
    interactionInputFile: input,
  });
  assert.ok(rejected.blockers.some((item) => item.code === "interaction_input_invalid"));
  await facade.resume({ taskId, actorId: "prepare-actor" });
  await facade.resume({ taskId, actorId: "prepare-actor" });
  const scoped = JSON.parse(fs.readFileSync(draft, "utf8"));
  scoped.events = [
    {
      ...scoped.events[0],
      id: "q2",
      ask: "Which source?",
      object_scope: { entity_id: "11111111-1111-4111-8111-111111111111", version: "00.00.001" },
    },
  ];
  fs.writeFileSync(draft, JSON.stringify(scoped));
  const narrow = await facade.prepareInput({
    taskId,
    actorId: "prepare-actor",
    kind: "interaction",
    draftFile: draft,
  });
  assert.equal(narrow.status, "ready", JSON.stringify(narrow));
  const narrowInput = narrow.artifacts.find((item) => item.role === "prepared_task_input");
  assert.ok(narrowInput?.kind === "inline");
  const narrowValue = narrowInput.value as {
    expected_state_sha256: string;
    events: Array<{ object_scope: { row_sha256: string } }>;
  };
  assert.equal(narrowValue.expected_state_sha256, current.sha256);
  assert.match(narrowValue.events[0].object_scope.row_sha256, /^[a-f0-9]{64}$/u);
  scoped.events[0].object_scope.entity_id = "missing";
  fs.writeFileSync(draft, JSON.stringify(scoped));
  const missing = await facade.prepareInput({
    taskId,
    actorId: "prepare-actor",
    kind: "interaction",
    draftFile: draft,
  });
  assert.equal(missing.blockers[0]?.code, "task_input_draft_invalid");
});
