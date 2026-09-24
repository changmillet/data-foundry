import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import { assessFoundryWorkflowRows } from "../../scripts/lib/foundry-workflow-assessment.ts";
import { currentWorkflowState } from "../../scripts/lib/foundry-workflow-state.ts";
import { finalizeFoundryWorkflow } from "../../scripts/lib/foundry-workflow-finalize.ts";
import { selectFoundryInteractionInput } from "../../scripts/lib/foundry-interaction-input.ts";
import { recordFoundryInteractionInput } from "../../scripts/lib/foundry-workflow-interaction.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  flowRow,
  processRowWithFlowRef,
  processRowWithInvalidLocation,
} from "../fixtures/row-builders.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { digestFile, workflowFixture } from "../fixtures/foundry-public-workflow.ts";

test("qualified context owner accepts the registered Unicode task path directly", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const seed = path.join(root, "context-seed.json"),
    specFile = path.join(root, "context-request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({ rows: [flowRow("77777777-7777-4777-8777-777777777777")] }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "direct-context-owner",
      actor_id: "context-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  const taskId = started.task_id;
  assert.ok(taskId);
  const context = createFoundryRuntimeContext({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId,
    actorId: "context-actor",
    inputs: [captureFoundryInput(seed)],
  });
  const qualified = qualifyFoundryRuntime(context, runtimeSelection);
  const runtime = createFoundryRuntime(context, qualified);
  const result = await runtime.prepareContext(["flow"]);
  assert.equal(result.status, "completed");
  await runtime.materializeRows([seed]);
  const inspected = await runtime.inspectTask();
  const contract = inspected.artifacts.find((item) => item.path.endsWith("/contract-report.json"));
  const rows = inspected.artifacts.find((item) => item.path.endsWith("/foundry-rows.json"));
  assert.ok(contract);
  assert.ok(rows);
  const assessmentContext = createFoundryRuntimeContext({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId: started.task_id,
    actorId: "context-actor",
    inputs: [
      captureFoundryInput(seed),
      ...inspected.artifacts.map((artifact) => {
        const fact = captureFoundryInput(path.resolve(context.taskRoot!, artifact.path));
        assert.equal(fact.sha256, artifact.sha256);
        assert.equal(fact.bytes, artifact.bytes);
        return fact;
      }),
    ],
  });
  const assessmentRuntime = createFoundryRuntime(
    assessmentContext,
    qualifyFoundryRuntime(assessmentContext, runtimeSelection),
  );
  const assessed = await assessmentRuntime.assessRows(path.resolve(context.taskRoot!, rows.path), [
    path.resolve(context.taskRoot!, contract.path),
  ]);
  assert.equal(assessed.status, "completed");
  assert.ok(
    (await runtime.inspectTask()).artifacts.some((item) =>
      item.path.endsWith("/foundry-assessment.json"),
    ),
  );
});

for (const variant of [
  "wrong-exit",
  "wrong-status",
  "wrong-input",
  "wrong-hash",
  "foreign-output",
  "relative-output",
  "manifest-edited",
  "blocker-edited",
] as const) {
  test(`a blocked queue rejects an unbound ${variant} report before indexing`, async (t) => {
    const { root, workspace, facade } = workflowFixture(t);
    const seed = path.join(root, `${variant}-seed.json`);
    const specFile = path.join(root, `${variant}-task.json`);
    const missingFlowId = "91919191-9191-4919-8919-919191919191";
    fs.writeFileSync(
      seed,
      JSON.stringify({
        rows: [processRowWithFlowRef("90909090-9090-4909-8909-909090909090", missingFlowId)],
      }),
    );
    fs.writeFileSync(
      specFile,
      JSON.stringify({
        schema: "tiangong-foundry.task-start.v1",
        request_id: `issue-200-${variant}`,
        actor_id: "issue-200-local",
        lane: "source-evidence-dataset-development",
        profile_id: "generic",
        target_entities: ["process"],
        sources: [{ path: seed }],
        seed: { path: seed },
        account_intent: null,
        preparation: null,
      }),
    );
    const started = await facade.start({ specFile });
    assert.ok(started.task_id);
    const invocation = { taskId: started.task_id, actorId: "issue-200-local" };
    assert.equal((await facade.resume(invocation)).status, "ready");
    assert.equal((await facade.resume(invocation)).status, "ready");
    const index = path.join(
      workspace,
      ".foundry",
      "workspaces",
      started.task_id,
      "artifact-index.jsonl",
    );
    const before = fs.readFileSync(index);
    const delegated = childProcess.spawnSync;
    let intercepted = false;
    t.mock.method(
      childProcess,
      "spawnSync",
      (...args: Parameters<typeof childProcess.spawnSync>) => {
        const result = delegated(...args);
        const argv = Array.isArray(args[1]) ? args[1] : [];
        if (argv[1] !== "dataset" || argv[2] !== "curation-queue" || argv[3] !== "build")
          return result;
        intercepted = true;
        assert.equal(result.status, 1);
        const report = JSON.parse(String(result.stdout));
        if (variant === "wrong-exit") return { ...result, status: 0 };
        if (variant === "wrong-status") report.status = "ready";
        else if (variant === "wrong-input")
          report.inputs.processes = path.join(root, "foreign.json");
        else if (variant === "wrong-hash")
          report.hashes.inputs[report.inputs.processes] = "0".repeat(64);
        else if (variant === "foreign-output")
          report.files.manifest = path.join(root, "outside-manifest.json");
        else if (variant === "relative-output")
          report.files.manifest = path.relative(workspace, report.files.manifest);
        else if (variant === "manifest-edited") {
          const manifest = JSON.parse(fs.readFileSync(report.files.manifest, "utf8"));
          manifest.status = "ready";
          fs.writeFileSync(report.files.manifest, JSON.stringify(manifest));
        } else if (variant === "blocker-edited") {
          const blockers = fs
            .readFileSync(report.files.blockers, "utf8")
            .trimEnd()
            .split(/\r?\n/u)
            .map((line) => JSON.parse(line));
          blockers[0].details.missing_flow_refs[0].id = "forged-flow";
          fs.writeFileSync(
            report.files.blockers,
            `${blockers.map((blocker: unknown) => JSON.stringify(blocker)).join("\n")}\n`,
          );
        }
        return { ...result, stdout: JSON.stringify(report) };
      },
    );
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const refused = await facade.resume(invocation);
    assert.equal(intercepted, true);
    assert.equal(refused.status, "blocked", JSON.stringify(refused.blockers));
    assert.equal(refused.blockers[0]?.code, "workflow_queue_invalid");
    assert.deepEqual(fs.readFileSync(index), before, "invalid queue outputs cannot gain authority");
    assert.ok(
      refused.artifacts.every(
        (item) => !["curation-queue-manifest.json", "foundry-assessment.json"].includes(item.role),
      ),
    );
  });
}

test("a blocked process queue explains the indexed missing Flow and stops local retries", async (t) => {
  const { root, workspace, facade } = workflowFixture(t);
  const seed = path.join(root, "missing-flow-seed.json");
  const specFile = path.join(root, "missing-flow-task.json");
  const missingFlowId = "92929292-9292-4929-8929-929292929292";
  const selectedFlowId = "94949494-9494-4949-8949-949494949494";
  const unversioned = processRowWithFlowRef("93939393-9393-4939-8939-939393939393", missingFlowId);
  Reflect.deleteProperty(
    unversioned.processDataSet.exchanges.exchange[0].referenceToFlowDataSet,
    "@version",
  );
  unversioned.processDataSet.exchanges.exchange.push(
    structuredClone(unversioned.processDataSet.exchanges.exchange[0]),
  );
  fs.writeFileSync(
    seed,
    JSON.stringify({
      rows: [flowRow(selectedFlowId), unversioned],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "issue-200-readable-queue",
      actor_id: "issue-200-local",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow", "process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "issue-200-local" };
  assert.equal((await facade.resume(invocation)).status, "ready");
  assert.equal((await facade.resume(invocation)).status, "ready");
  const firstAssessment = await facade.resume(invocation);
  assert.equal(firstAssessment.status, "needs_input");
  assert.ok(firstAssessment.next_actions.some((action) => action.kind === "command"));
  const assessed = await facade.resume(invocation);
  assert.equal(assessed.status, "needs_input");
  assert.equal(assessed.permissions.state, "not_required");
  const queueFiles = assessed.artifacts.filter(
    (artifact) => artifact.role === "curation-queue-blockers.jsonl",
  );
  assert.equal(queueFiles.length, 2, "Flow and Process assessments each retain queue evidence");
  const queue = queueFiles[0];
  assert.ok(queue?.kind === "file");
  assert.equal(queueFiles[1]?.sha256, queue.sha256);
  const missing = JSON.parse(fs.readFileSync(queue.path, "utf8"));
  const missingRefs = missing.details.missing_flow_refs;
  assert.equal(missingRefs.length, 2, "each exchange path is a distinct unresolved occurrence");
  assert.deepEqual(
    missingRefs.map((ref: { id: string; version: string | null }) => [ref.id, ref.version]),
    [
      [missingFlowId, null],
      [missingFlowId, null],
    ],
  );
  assert.notEqual(missingRefs[0]?.path, missingRefs[1]?.path);
  const queueBlockers = assessed.blockers.filter((item) => item.code === "curation_queue_blocked");
  assert.equal(queueBlockers.length, 1, "identical closure gaps should be presented once");
  const blocker = queueBlockers[0];
  assert.ok(blocker);
  assert.match(blocker.message, /2 unresolved Flow reference occurrences/u);
  assert.match(blocker.message, /Process review is blocked/u);
  assert.ok(blocker.message.includes(queue.path));
  assert.equal(
    assessed.next_actions.filter(
      (action) =>
        action.kind === "human" &&
        action.code === "review_queue_blockers" &&
        action.instructions.includes("Provide the cited Flow evidence"),
    ).length,
    1,
  );
  assert.equal(
    assessed.next_actions.some((action) => action.kind === "command"),
    false,
  );
  assert.ok(
    assessed.artifacts.every(
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
  const before = fs.readFileSync(index);
  const repeated = await facade.resume(invocation);
  assert.deepEqual(fs.readFileSync(index), before);
  assert.deepEqual(repeated, assessed);
  fs.appendFileSync(queue.path, '{"forged":true}\n');
  const tampered = await facade.status(invocation);
  assert.notEqual(tampered.status, "needs_input");
  assert.ok(tampered.blockers.length > 0, "changed queue evidence cannot support a human prompt");
});

test("assessment records one row set at a time and cannot finalize partial coverage", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const seed = path.join(root, "partial-assessment-seed.json");
  const specFile = path.join(root, "partial-assessment-request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({
      rows: [
        flowRow("71717171-7171-4717-8717-717171717171"),
        processRowWithInvalidLocation("72727272-7272-4727-8727-727272727272"),
      ],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "partial-assessment",
      actor_id: "assessment-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow", "process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  const taskId = started.task_id;
  assert.ok(taskId);
  const taskContext = (
    entries: Awaited<
      ReturnType<ReturnType<typeof createFoundryRuntime>["inspectTask"]>
    >["artifacts"],
  ) =>
    createFoundryRuntimeContext({
      moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
      workspace,
      cacheBase: path.join(root, "cache"),
      taskId,
      actorId: "assessment-actor",
      inputs: [
        captureFoundryInput(seed),
        ...entries.map((entry) => captureFoundryInput(path.resolve(context.taskRoot!, entry.path))),
      ],
    });
  const context = createFoundryRuntimeContext({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId,
    actorId: "assessment-actor",
    inputs: [captureFoundryInput(seed)],
  });
  const runtime = createFoundryRuntime(context, qualifyFoundryRuntime(context, runtimeSelection));
  await runtime.prepareContext(["flow", "process"]);
  await runtime.materializeRows([seed]);
  const prepared = await runtime.inspectTask();
  const rows = prepared.artifacts.find((entry) => entry.path.endsWith("/foundry-rows.json"));
  const contracts = prepared.artifacts.filter((entry) =>
    entry.path.endsWith("/contract-report.json"),
  );
  assert.ok(rows);
  assert.equal(contracts.length, 2);
  const firstContext = taskContext(prepared.artifacts);
  const rowFile = path.resolve(context.taskRoot!, rows.path);
  const contractFiles = contracts.map((entry) => path.resolve(context.taskRoot!, entry.path));
  const first = await assessFoundryWorkflowRows(
    firstContext,
    qualifyFoundryRuntime(firstContext, runtimeSelection),
    rowFile,
    contractFiles,
    undefined,
    { scopeType: "flow" },
  );
  assert.equal(first.status, "in_progress");
  assert.deepEqual(
    (first.sets as Array<{ type: string }>).map((set) => set.type),
    ["flow"],
  );
  const partiallyInspected = await runtime.inspectTask();
  const partial = currentWorkflowState(context, partiallyInspected.artifacts);
  assert.equal(partial.assessmentComplete, false);
  assert.deepEqual(partial.assessmentRemainingTypes, ["process"]);
  const firstQueue = partiallyInspected.artifacts.filter((entry) =>
    entry.path.endsWith("/queue/outputs/curation-queue-manifest.json"),
  );
  assert.equal(firstQueue.length, 1, "the first assessed set owns its queue snapshot");
  await assert.rejects(
    finalizeFoundryWorkflow(
      context,
      qualifyFoundryRuntime(context, runtimeSelection),
      partiallyInspected.artifacts,
    ),
    { code: "workflow_assessment_required" },
  );
  const secondContext = taskContext(partiallyInspected.artifacts);
  const second = await assessFoundryWorkflowRows(
    secondContext,
    qualifyFoundryRuntime(secondContext, runtimeSelection),
    rowFile,
    contractFiles,
    undefined,
    { scopeType: "process", previousAssessment: partial.assessment?.file },
  );
  assert.equal(second.status, "completed");
  assert.deepEqual(
    (second.sets as Array<{ type: string }>).map((set) => set.type),
    ["flow", "process"],
  );
  const completedInspection = await runtime.inspectTask();
  const completed = currentWorkflowState(context, completedInspection.artifacts);
  const queueSnapshots = completedInspection.artifacts.filter((entry) =>
    entry.path.endsWith("/queue/outputs/curation-queue-manifest.json"),
  );
  assert.equal(queueSnapshots.length, 2, "each set owns a separate complete queue snapshot");
  assert.notEqual(queueSnapshots[0].operation_id, queueSnapshots[1].operation_id);
  assert.equal(completed.assessmentComplete, true);
  assert.deepEqual(completed.assessmentRemainingTypes, []);
  const originalSets = completed.assessment?.value.sets;
  assert.ok(originalSets);
  const interactionFile = path.join(root, "process-assumption.json");
  fs.writeFileSync(
    interactionFile,
    JSON.stringify({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: taskId,
      actor_id: "assessment-actor",
      expected_state_sha256: null,
      events: [
        {
          kind: "assumption",
          id: "process-method",
          dataset_type: "process",
          statement: "Use the source's process boundary for this dataset.",
          impact: "This changes which process fields need review.",
          evidence_sha256: [],
          supersedes: null,
        },
      ],
    }),
  );
  const interactionContext = taskContext(completedInspection.artifacts);
  await recordFoundryInteractionInput(
    interactionContext,
    completedInspection.artifacts,
    selectFoundryInteractionInput(interactionContext, interactionFile),
    ["flow", "process"],
  );
  const afterInteraction = await runtime.inspectTask();
  const stale = currentWorkflowState(context, afterInteraction.artifacts);
  assert.equal(stale.assessmentComplete, false);
  assert.deepEqual(stale.assessmentRemainingTypes, ["process"]);
  assert.deepEqual(
    stale.assessment?.value.sets.map((set) => set.type),
    ["flow"],
  );
  const selected = taskContext(afterInteraction.artifacts);
  const reassessed = await assessFoundryWorkflowRows(
    selected,
    qualifyFoundryRuntime(selected, runtimeSelection),
    rowFile,
    contractFiles,
    undefined,
    {
      scopeType: "process",
      previousAssessment: stale.assessment?.file,
      interactionSha256: stale.interactionSha256,
    },
  );
  assert.equal(reassessed.status, "completed");
  const current = currentWorkflowState(context, (await runtime.inspectTask()).artifacts);
  assert.equal(current.assessmentComplete, true);
  assert.equal(current.assessment?.value.sets[0]?.schema_report, originalSets[0]?.schema_report);
  assert.notEqual(current.assessment?.value.sets[1]?.schema_report, originalSets[1]?.schema_report);
  const decisionContext = current.assessment?.value.sets[1]?.interaction_context;
  assert.equal(typeof decisionContext, "string");
  const retainedContext = JSON.parse(fs.readFileSync(String(decisionContext), "utf8")) as {
    source_state_sha256: string;
    dataset_type: string;
    ai_assumptions: Array<{ id: string }>;
  };
  assert.equal(retainedContext.source_state_sha256, stale.interactionSha256);
  assert.equal(retainedContext.dataset_type, "process");
  assert.deepEqual(
    retainedContext.ai_assumptions.map((item) => item.id),
    ["process-method"],
  );
  const globalFile = path.join(root, "global-assumption.json");
  fs.writeFileSync(
    globalFile,
    JSON.stringify({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: taskId,
      actor_id: "assessment-actor",
      expected_state_sha256: current.interactionSha256,
      events: [
        {
          kind: "assumption",
          id: "task-boundary",
          dataset_type: null,
          statement: "Use the stated task boundary for every dataset type.",
          impact: "Every row set needs a fresh review of this boundary.",
          evidence_sha256: [],
          supersedes: null,
        },
      ],
    }),
  );
  const beforeGlobal = await runtime.inspectTask();
  const globalContext = taskContext(beforeGlobal.artifacts);
  await recordFoundryInteractionInput(
    globalContext,
    beforeGlobal.artifacts,
    selectFoundryInteractionInput(globalContext, globalFile),
    ["flow", "process"],
  );
  const global = currentWorkflowState(context, (await runtime.inspectTask()).artifacts);
  assert.equal(global.assessmentComplete, false);
  assert.deepEqual(global.assessmentRemainingTypes, ["flow", "process"]);
});

test("qualified public import dispatches the native owner and retains indexed stage evidence", async (t) => {
  const { root, facade } = workflowFixture(t);
  const source = path.join(root, "selected-package.zip");
  // This regression isolates owner dispatch and evidence registration. The paired
  // real native case uses the valid four-document ILCD oracle, not this transport fixture.
  fs.writeFileSync(source, "selected native-owner input");
  const specFile = path.join(root, "request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "native-owner-workflow",
      actor_id: "workflow-actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: source }],
      seed: null,
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.equal(started.status, "ready");
  assert.ok(started.task_id);
  const resumed = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  const imported = resumed.artifacts.find(
    (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "import-report.json",
  );
  assert.ok(
    imported?.kind === "file",
    "public resume must expose the indexed native import report",
  );
  const report = JSON.parse(fs.readFileSync(imported.path, "utf8")) as Record<string, unknown>;
  assert.equal(report.schema_version, "tidas.import-execution-report.v1");
  assert.notEqual(resumed.status, "completed", "conversion alone cannot prove import completion");
  const context = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  assert.ok(
    context.artifacts.some(
      (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "schema.json",
    ),
    `the next resume must prepare real CLI-owned contract context: ${JSON.stringify(context.blockers)}`,
  );
  const materialized = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  const processRows = materialized.artifacts.find(
    (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "process.rows.json",
  );
  assert.ok(processRows?.kind === "file");
  assert.equal(
    JSON.parse(fs.readFileSync(processRows.path, "utf8")).length,
    1,
    "bundle snapshots must not duplicate the primary converted dataset",
  );
  const status = await facade.status({ taskId: started.task_id, actorId: "workflow-actor" });
  assert.ok(
    status.artifacts.some(
      (artifact) => artifact.kind === "file" && artifact.path === imported.path,
    ),
  );
  const before = fs.readFileSync(imported.path);
  const wrongActor = await facade.resume({ taskId: started.task_id, actorId: "another-actor" });
  assert.notEqual(wrongActor.status, "ready");
  assert.deepEqual(fs.readFileSync(imported.path), before);
  fs.appendFileSync(source, "changed");
  const changed = await facade.resume({ taskId: started.task_id, actorId: "workflow-actor" });
  assert.equal(changed.status, "blocked");
  assert.deepEqual(fs.readFileSync(imported.path), before);
});

test("public semantic submission rejects stale evidence and re-assesses only successfully applied rows", async (t) => {
  const { root, facade } = workflowFixture(t, false, "missing-name");
  const id = "44444444-4444-4444-8444-444444444444";
  const good = flowRow(id);
  const bad = {
    ...good,
    flowDataSet: {
      ...good.flowDataSet,
      flowInformation: { dataSetInformation: { "common:UUID": id } },
    },
  };
  const seed = path.join(root, "seed.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: [{ id, version: "00.00.001", flow: bad }] }));
  const specFile = path.join(root, "request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "semantic-cycle",
      actor_id: "semantic-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "semantic-actor" };
  await facade.resume(invocation);
  await facade.resume(invocation);
  const assessed = await facade.resume(invocation);
  assert.equal(assessed.status, "needs_input");
  const assessmentFile = assessed.artifacts.find(
    (artifact) => artifact.kind === "file" && artifact.role === "foundry-assessment.json",
  );
  assert.ok(assessmentFile?.kind === "file");
  const assessment = JSON.parse(fs.readFileSync(assessmentFile.path, "utf8")) as {
    owner_base: string;
    sets: Array<{ rows: string; authoring_manifest: string }>;
  };
  const manifest = JSON.parse(fs.readFileSync(assessment.sets[0].authoring_manifest, "utf8")) as {
    tasks: Array<{
      entity: { entity_id: string; version: string };
      files: { task_json: string; authoring_package: string };
      action_items: Array<{ code: string; path: string | null }>;
    }>;
  };
  const task = manifest.tasks[0];
  const taskFile = path.resolve(assessment.owner_base, task.files.task_json);
  const patchFile = path.join(root, "patch.json"),
    submissionFile = path.join(root, "submission.json");
  const operation = {
    op: "add",
    path: "/json/flowDataSet/flowInformation/dataSetInformation/name",
    value: good.flowDataSet.flowInformation.dataSetInformation.name,
    basis: "Controlled fixture restores the selected source name.",
    evidence: {
      source: seed,
      field_path: "/flowDataSet/flowInformation/dataSetInformation/name",
      quote_or_trace: "Natural gas",
    },
    resolution: {
      mode: "evidence_backed_completion",
      used_context_kinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
    },
    closes_action_items: task.action_items.map((item) => ({ code: item.code, path: item.path })),
  };
  const patch = {
    schema_version: 1,
    patch_status: "completed",
    patch_sets: [
      {
        dataset_id: task.entity.entity_id,
        version: task.entity.version,
        authoring_package: path.basename(task.files.authoring_package),
        operations: [operation],
      },
    ],
  };
  const writeSubmission = (actor = invocation.actorId) => {
    fs.writeFileSync(
      submissionFile,
      JSON.stringify({
        schema: "tiangong-foundry.semantic-input.v1",
        task_id: invocation.taskId,
        actor_id: actor,
        assessment_sha256: assessmentFile.sha256,
        submissions: [
          {
            kind: "patch",
            authoring_task_sha256: digestFile(taskFile),
            file: patchFile,
            sha256: digestFile(patchFile),
          },
        ],
      }),
    );
  };
  fs.writeFileSync(patchFile, JSON.stringify(patch));
  writeSubmission("wrong-actor");
  const wrong = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
  assert.equal(wrong.status, "blocked");
  assert.equal(wrong.blockers[0]?.code, "semantic_input_scope_mismatch");
  const invalid = structuredClone(patch);
  invalid.patch_sets[0].operations[0].evidence.quote_or_trace = "";
  invalid.patch_sets[0].operations[0].evidence.field_path = "";
  fs.writeFileSync(patchFile, JSON.stringify(invalid));
  writeSubmission();
  const refused = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
  assert.equal(refused.status, "needs_input");
  assert.equal(refused.blockers[0]?.code, "semantic_input_rejected");
  const oldRows = fs.readFileSync(assessment.sets[0].rows);
  fs.writeFileSync(patchFile, JSON.stringify(patch));
  writeSubmission();
  const alternatePatch = structuredClone(patch);
  alternatePatch.patch_sets[0].operations[0].basis =
    "Concurrent equivalent repair with a distinct submission.";
  const alternateFile = path.join(root, "alternate-patch.json"),
    alternateSubmission = path.join(root, "alternate-submission.json");
  fs.writeFileSync(alternateFile, JSON.stringify(alternatePatch));
  const alternateDescriptor = JSON.parse(fs.readFileSync(submissionFile, "utf8")) as {
    submissions: Array<{ file: string; sha256: string }>;
  };
  alternateDescriptor.submissions[0].file = alternateFile;
  alternateDescriptor.submissions[0].sha256 = digestFile(alternateFile);
  fs.writeFileSync(alternateSubmission, JSON.stringify(alternateDescriptor));
  const raced = await Promise.all([
    facade.resume({ ...invocation, semanticInputFile: submissionFile }),
    facade.resume({ ...invocation, semanticInputFile: alternateSubmission }),
  ]);
  assert.equal(
    raced.filter((result) => result.status === "ready").length,
    1,
    JSON.stringify(raced),
  );
  assert.equal(raced.filter((result) => result.status === "blocked").length, 1);
  const winner = raced.findIndex((result) => result.status === "ready");
  const acceptedSubmission = winner === 0 ? submissionFile : alternateSubmission;
  const applied = raced[winner];
  assert.equal(applied.status, "ready", JSON.stringify(applied));
  assert.deepEqual(fs.readFileSync(assessment.sets[0].rows), oldRows, "old rows stay immutable");
  const rowManifest = applied.artifacts.findLast(
    (artifact) => artifact.kind === "file" && artifact.role === "foundry-rows.json",
  );
  assert.ok(rowManifest?.kind === "file");
  const rows = JSON.parse(fs.readFileSync(rowManifest.path, "utf8")) as {
    sets: Array<{ file: string }>;
  };
  assert.notEqual(rows.sets[0].file, assessment.sets[0].rows);
  const repaired = JSON.parse(fs.readFileSync(rows.sets[0].file, "utf8").trim()) as {
    json: typeof good;
  };
  assert.deepEqual(
    repaired.json.flowDataSet.flowInformation.dataSetInformation.name,
    operation.value,
  );
  const duplicate = await facade.resume({ ...invocation, semanticInputFile: acceptedSubmission });
  assert.deepEqual(
    duplicate.artifacts,
    applied.artifacts,
    "an accepted submission cannot apply twice",
  );
  const reviewed = await facade.resume(invocation);
  assert.equal(reviewed.status, "ready", JSON.stringify(reviewed));
  assert.notEqual(reviewed.status, "completed");
  const latest = reviewed.artifacts.findLast(
    (artifact) => artifact.kind === "file" && artifact.role === "foundry-assessment.json",
  );
  assert.ok(latest?.kind === "file");
  assert.notEqual(latest.sha256, assessmentFile.sha256);
  const needsAccount = await facade.resume(invocation);
  assert.equal(
    needsAccount.status,
    "needs_auth",
    "remote identity work needs independently selected account intent",
  );
  patch.patch_sets[0].operations[0].basis =
    "A different submission must not use the old assessment.";
  fs.writeFileSync(patchFile, JSON.stringify(patch));
  writeSubmission();
  const stale = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
  assert.equal(stale.status, "blocked");
  assert.equal(stale.blockers[0]?.code, "semantic_assessment_mismatch");
});

test("public decisions bind their owner and context, preserve rows on refusal, and reassess between owners", async (t) => {
  const { root, facade } = workflowFixture(t, false, "decisions");
  const id = "66666666-6666-4666-8666-666666666666";
  const row = processRowWithInvalidLocation(id);
  row.processDataSet.processInformation.dataSetInformation.classificationInformation[
    "common:classification"
  ]["common:class"][0]["@classId"] = "INVALID";
  const seed = path.join(root, "seed.json"),
    specFile = path.join(root, "request.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: [{ id, version: "00.00.001", json: row }] }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "decision-cycle",
      actor_id: "decision-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "decision-actor" };
  await facade.resume(invocation);
  await facade.resume(invocation);
  let result = await facade.resume(invocation);
  const interactionFile = path.join(root, "user-method.json");
  fs.writeFileSync(
    interactionFile,
    JSON.stringify({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: invocation.taskId,
      actor_id: invocation.actorId,
      expected_state_sha256: null,
      events: [
        {
          kind: "question",
          id: "classification-method",
          dataset_type: "process",
          missing: "The process category needs a reviewed choice.",
          impact: "A wrong category would misrepresent this process.",
          recommendation: "Use the current controlled classification source.",
          ask: "May this process use the evidenced controlled category?",
          choices: ["Use the evidenced category", "Investigate first"],
          evidence_sha256: [digestFile(seed)],
          supersedes: null,
        },
        {
          kind: "answer",
          question_id: "classification-method",
          decision_id: "use-evidenced-category",
          supersedes_decision_id: null,
          raw_answer: "Use the category supported by the current source.",
          adopted_decision: "Use the current controlled classification source for this process.",
          disposition: "decided",
          evidence_sha256: [digestFile(seed)],
        },
      ],
    }),
  );
  result = await facade.resume({ ...invocation, interactionInputFile: interactionFile });
  const interaction = result.artifacts.find(
    (artifact) => artifact.role === "current_interaction_state",
  );
  assert.ok(interaction?.kind === "file");
  result = await facade.resume(invocation);
  const classes = JSON.parse(
    fs.readFileSync(
      path.join(resolveInstalledTiangongLcaCliPackage().schemaDir, "tidas_processes_category.json"),
      "utf8",
    ),
  ) as { oneOf: Array<{ properties?: { "@classId"?: { const?: string } } }> };
  const code = classes.oneOf
    .map((value) => value.properties?.["@classId"]?.const)
    .filter((value): value is string => typeof value === "string" && value.startsWith("351"))
    .sort((left, right) => right.length - left.length)[0];
  assert.ok(code, "the classification comes from the installed owner's schema");
  for (const kind of ["classification", "location"] as const) {
    const artifact = result.artifacts.findLast((value) => value.role === "foundry-assessment.json");
    assert.ok(artifact?.kind === "file");
    const assessment = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
      owner_base: string;
      sets: Array<{
        rows: string;
        decisions: Array<{ kind: string; task: string; status: string }>;
      }>;
    };
    const set = assessment.sets[0],
      work = set.decisions.find((value) => value.kind === kind);
    assert.ok(work);
    assert.equal(work.status, `ready_for_ai_${kind}_decisions`);
    const task = JSON.parse(fs.readFileSync(work.task, "utf8")) as {
      commands: { apply_decisions: null };
      files: { template: string };
    };
    assert.equal(task.commands.apply_decisions, null);
    const decisions = fs
      .readFileSync(path.resolve(assessment.owner_base, task.files.template), "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            code: string;
            basis: string;
            used_context_kinds: string[];
            evidence: Record<string, unknown>;
            authoring_context: { context_bundle_sha256: string };
          },
      );
    for (const value of decisions) {
      value.code = kind === "classification" ? code : "CH";
      value.basis = "Controlled fixture with an explicitly selected schema-valid code.";
      value.used_context_kinds = [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ];
      value.evidence = {
        ...value.evidence,
        source: seed,
        quote_or_trace: "Controlled schema fixture.",
      };
    }
    const file = path.join(root, `${kind}.jsonl`),
      descriptor = path.join(root, `${kind}-submission.json`);
    const part = () => ({
      kind: String(kind),
      authoring_task_sha256: digestFile(work.task),
      file,
      sha256: digestFile(file),
      decision_ids: ["use-evidenced-category"],
    });
    const write = (values = decisions, parts?: ReturnType<typeof part>[]) => {
      fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + "\n");
      fs.writeFileSync(
        descriptor,
        JSON.stringify({
          schema: "tiangong-foundry.semantic-input.v1",
          task_id: invocation.taskId,
          actor_id: invocation.actorId,
          assessment_sha256: artifact.sha256,
          interaction_sha256: interaction.sha256,
          submissions: parts ?? [part()],
        }),
      );
    };
    const original = fs.readFileSync(set.rows);
    const originalManifest = result.artifacts.findLast(
      (value) => value.role === "foundry-rows.json",
    );
    write();
    write(decisions, [
      { ...part(), kind: kind === "classification" ? "location" : "classification" },
    ]);
    const wrongOwner = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(wrongOwner.status, "blocked");
    assert.equal(wrongOwner.blockers[0]?.code, "semantic_work_mismatch");
    if (kind === "classification") {
      const location = set.decisions.find((value) => value.kind === "location");
      assert.ok(location);
      write(decisions, [
        part(),
        { ...part(), kind: "location", authoring_task_sha256: digestFile(location.task) },
      ]);
      const mixed = await facade.resume({ ...invocation, semanticInputFile: descriptor });
      assert.equal(mixed.status, "needs_input");
      assert.equal(mixed.blockers[0]?.code, "task_semantic_owner_conflict");
    }
    const invalid = structuredClone(decisions);
    invalid[0].authoring_context.context_bundle_sha256 = "0".repeat(64);
    write(invalid);
    const refused = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(refused.status, "needs_input", JSON.stringify(refused));
    assert.equal(refused.blockers[0]?.code, "semantic_input_rejected");
    const afterRefusal = await facade.status(invocation);
    assert.deepEqual(
      afterRefusal.artifacts.findLast((value) => value.role === "foundry-rows.json"),
      originalManifest,
    );
    assert.deepEqual(fs.readFileSync(set.rows), original);
    write();
    const missingChoice = JSON.parse(fs.readFileSync(descriptor, "utf8")) as {
      submissions: Array<{ decision_ids?: string[] }>;
    };
    delete missingChoice.submissions[0].decision_ids;
    const missingChoiceFile = path.join(root, `${kind}-missing-choice.json`);
    fs.writeFileSync(missingChoiceFile, JSON.stringify(missingChoice));
    const omitted = await facade.resume({ ...invocation, semanticInputFile: missingChoiceFile });
    assert.equal(omitted.blockers[0]?.code, "semantic_interaction_invalid");
    const applied = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(applied.status, "ready", JSON.stringify(applied));
    const adoption = applied.artifacts.findLast((value) => value.role === "semantic-result.json");
    assert.ok(adoption?.kind === "file");
    const adopted = JSON.parse(fs.readFileSync(adoption.path, "utf8")) as {
      adopted_decisions: Array<{ decision_ids: string[] }>;
    };
    assert.deepEqual(adopted.adopted_decisions[0]?.decision_ids, ["use-evidenced-category"]);
    const duplicate = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.deepEqual(duplicate.artifacts, applied.artifacts);
    assert.deepEqual(fs.readFileSync(set.rows), original);
    result = await facade.resume(invocation);
    const latest = result.artifacts.findLast((value) => value.role === "foundry-assessment.json");
    assert.ok(latest?.kind === "file");
    const reviewed = JSON.parse(fs.readFileSync(latest.path, "utf8")) as typeof assessment;
    assert.ok(!reviewed.sets[0].decisions.some((value) => value.kind === kind));
    decisions[0].basis = "A distinct late submission against the original assessment.";
    write();
    const stale = await facade.resume({ ...invocation, semanticInputFile: descriptor });
    assert.equal(stale.status, "blocked");
    assert.equal(stale.blockers[0]?.code, "semantic_assessment_mismatch");
  }
});

test("a failed native conversion remains blocked without preparing later context", async (t) => {
  const { root, facade } = workflowFixture(t, true);
  const source = path.join(root, "unsupported-package.zip");
  fs.writeFileSync(source, "native data-issue input");
  const specFile = path.join(root, "blocked-request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "blocked-conversion",
      actor_id: "actor",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: source }],
      seed: null,
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const result = await facade.resume({ taskId: started.task_id, actorId: "actor" });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers[0]?.code, "native_import_blocked");
  assert.ok(result.artifacts.some((artifact) => artifact.role === "foundry-native-import.json"));
  const again = await facade.resume({ taskId: started.task_id, actorId: "actor" });
  assert.deepEqual(again, result);
  assert.ok(!again.artifacts.some((artifact) => artifact.role === "schema.json"));
});

test("source-evidence resume prepares an indexed SDK context before semantic work", async (t) => {
  const { root, facade } = workflowFixture(t, false, true);
  const seed = path.join(root, "selected-seed.json");
  const sourceRow = {
    id: "22222222-2222-4222-8222-222222222222",
    version: "00.00.001",
    flow: flowRow("22222222-2222-4222-8222-222222222222"),
  };
  fs.writeFileSync(seed, JSON.stringify({ rows: [sourceRow] }));
  const specFile = path.join(root, "source-request.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "source-workflow",
      actor_id: "source-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.equal(started.status, "ready");
  assert.ok(started.task_id);
  const resumed = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  const contract = resumed.artifacts.find(
    (artifact) =>
      artifact.kind === "file" && path.basename(artifact.path) === "contract-report.json",
  );
  assert.ok(contract?.kind === "file");
  const report = JSON.parse(fs.readFileSync(contract.path, "utf8")) as {
    status: string;
    type: string;
    files: Record<string, string | null>;
  };
  assert.equal(report.status, "completed");
  assert.equal(report.type, "flow");
  for (const key of ["schema", "methodology", "ruleset", "ai_context_json"]) {
    const file = report.files[key];
    assert.ok(file);
    assert.ok(
      resumed.artifacts.some((artifact) => artifact.kind === "file" && artifact.path === file),
      key,
    );
  }
  assert.notEqual(resumed.status, "completed");
  const normalized = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  const rowFile = normalized.artifacts.find(
    (artifact) => artifact.kind === "file" && path.basename(artifact.path) === "flow.rows.json",
  );
  assert.ok(rowFile?.kind === "file", "the next stage must materialize the selected rows");
  assert.deepEqual(JSON.parse(fs.readFileSync(rowFile.path, "utf8")), [
    { id: sourceRow.id, version: sourceRow.version, json: sourceRow.flow },
  ]);
  const assessed = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  assert.ok(
    assessed.artifacts.some(
      (artifact) =>
        artifact.kind === "file" && path.basename(artifact.path) === "validation-report.json",
    ),
    JSON.stringify(assessed),
  );
  const manifest = assessed.artifacts.find(
    (artifact) =>
      artifact.kind === "file" && path.basename(artifact.path) === "authoring-task-manifest.json",
  );
  assert.ok(manifest?.kind === "file", "assessment must publish concrete owner authoring work");
  const work = JSON.parse(fs.readFileSync(manifest.path, "utf8")) as {
    commands: { apply_all_patches: string | null };
    tasks: Array<{ commands: { apply_patch: string | null; validate_after_apply: string | null } }>;
  };
  assert.equal(work.commands.apply_all_patches, null);
  for (const task of work.tasks) {
    assert.equal(task.commands.apply_patch, null);
    assert.equal(task.commands.validate_after_apply, null);
  }
  assert.equal(assessed.status, "needs_input");
  assert.ok(
    assessed.next_actions.some(
      (action) => action.kind === "human" && action.code === "review_semantic_work",
    ),
  );
  const repeated = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  assert.deepEqual(
    repeated.artifacts,
    assessed.artifacts,
    "pending semantic work must not rerun local owners",
  );
  fs.appendFileSync(rowFile.path, "\n");
  const changed = await facade.resume({ taskId: started.task_id, actorId: "source-actor" });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.blockers[0]?.code, "workflow_assessment_changed");
});
