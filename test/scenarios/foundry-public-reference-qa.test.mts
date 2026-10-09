import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { workflowFixture, digestFile } from "../fixtures/foundry-public-workflow.ts";
import { processRowWithInvalidLocation, flowRow, sourceRow } from "../fixtures/row-builders.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { assessFoundryWorkflowRows } from "../../scripts/lib/foundry-workflow-assessment.ts";
import { currentWorkflowState } from "../../scripts/lib/foundry-workflow-state.ts";
import { finalizeFoundryWorkflow } from "../../scripts/lib/foundry-workflow-finalize.ts";
import { supportFlowPropertyRow, supportUnitGroupRow } from "../fixtures/support-row-builders.ts";

function massReferences() {
  const flowId = "77777777-7777-4777-8777-777777777777";
  const propertyId = "88888888-8888-4888-8888-888888888888";
  const groupId = "99999999-9999-4999-8999-999999999999";
  const original = flowRow(flowId).flowDataSet;
  const flow = {
    flowDataSet: {
      ...original,
      flowInformation: {
        ...original.flowInformation,
        quantitativeReference: { referenceToReferenceFlowProperty: "0" },
      },
      flowProperties: {
        flowProperty: {
          "@dataSetInternalID": "0",
          meanValue: "1",
          referenceToFlowPropertyDataSet: {
            "@refObjectId": propertyId,
            "@version": "00.00.001",
            "@type": "flow property data set",
          },
        },
      },
    },
  };
  const property = supportFlowPropertyRow(propertyId, groupId);
  const group = supportUnitGroupRow(groupId);
  property.flowPropertyDataSet.flowPropertiesInformation.dataSetInformation["common:name"][
    "#text"
  ] = "Mass";
  group.unitGroupDataSet.unitGroupInformation.dataSetInformation["common:name"]["#text"] =
    "Units of mass";
  group.unitGroupDataSet.units.unit[0].name = "kg";
  return { flow, property, group };
}

test("public Process references reach initial queue and QA without creating dependency tasks", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const seed = path.join(root, "seed.json"),
    specFile = path.join(root, "request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({
      rows: [
        {
          processDataSet: {
            ...processRowWithInvalidLocation("66666666-6666-4666-8666-666666666666").processDataSet,
            processInformation: {
              ...processRowWithInvalidLocation("66666666-6666-4666-8666-666666666666")
                .processDataSet.processInformation,
              quantitativeReference: { referenceToReferenceFlow: "0" },
            },
            exchanges: {
              exchange: [
                {
                  "@dataSetInternalID": "0",
                  exchangeDirection: "Output",
                  meanAmount: "1",
                  referenceToFlowDataSet: {
                    "@refObjectId": "77777777-7777-4777-8777-777777777777",
                    "@version": "00.00.001",
                  },
                },
                {
                  "@dataSetInternalID": "1",
                  exchangeDirection: "Input",
                  meanAmount: "1",
                  referenceToFlowDataSet: {
                    "@refObjectId": "77777777-7777-4777-8777-777777777777",
                    "@version": "00.00.002",
                  },
                },
              ],
            },
          },
        },
      ],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "process-reference-qa",
      actor_id: "qa-actor",
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
  assert.ok(started.task_id, JSON.stringify(started.blockers));
  const invocation = { taskId: started.task_id, actorId: "qa-actor" };
  await facade.resume(invocation);
  await facade.resume(invocation);
  const assessed = await facade.resume(invocation);
  const manifest = assessed.artifacts.findLast((item) => item.role === "foundry-rows.json");
  assert.ok(manifest?.kind === "file", JSON.stringify(assessed.blockers));
  const references = [path.join(root, "flows.jsonl"), path.join(root, "support.json")];
  const mass = massReferences();
  fs.writeFileSync(references[0], JSON.stringify(mass.flow) + "\n");
  fs.writeFileSync(references[1], JSON.stringify([mass.property, mass.group]));
  const descriptorFile = path.join(root, "references.json");
  const descriptor = {
    schema: "tiangong-foundry.reference-input.v1",
    task_id: invocation.taskId,
    actor_id: invocation.actorId,
    rows_manifest_sha256: manifest.sha256,
    dataset_type: "process",
    qa_reference_rows: references.map((file) => ({ file, sha256: digestFile(file) })),
    intent: null,
    review_files: [],
  };
  fs.writeFileSync(
    descriptorFile,
    JSON.stringify({ ...descriptor, rows_manifest_sha256: "0".repeat(64) }),
  );
  const stale = await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
  assert.equal(stale.blockers[0]?.code, "reference_input_invalid");
  assert.ok(!stale.artifacts.some((item) => item.role === "foundry-reference-input.json"));
  const original = childProcess.spawnSync;
  const qaCalls: string[][] = [];
  const validationCalls: string[][] = [];
  const queueReports: Array<{
    counts: { external_flow_refs: number };
    blockers: Array<{ code: string }>;
  }> = [];
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (Array.isArray(argv) && argv[1] === "qa" && argv[2] === "process") qaCalls.push([...argv]);
    if (Array.isArray(argv) && argv[1] === "dataset" && argv[2] === "validate")
      validationCalls.push([...argv]);
    const result = Reflect.apply(original, childProcess, args);
    if (Array.isArray(argv) && argv.includes("curation-queue") && argv.includes("build"))
      queueReports.push(JSON.parse(String(result.stdout)));
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const correctFlow = fs.readFileSync(references[0], "utf8");
  let lastAssessmentSha: string | undefined;
  for (const version of ["00.00.001", "00.00.002", null]) {
    const wrong = JSON.parse(correctFlow);
    if (version)
      wrong.flowDataSet.administrativeInformation.publicationAndOwnership["common:dataSetVersion"] =
        version;
    else
      delete wrong.flowDataSet.administrativeInformation.publicationAndOwnership[
        "common:dataSetVersion"
      ];
    fs.writeFileSync(references[0], JSON.stringify(wrong));
    descriptor.qa_reference_rows = references.map((file) => ({ file, sha256: digestFile(file) }));
    fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
    await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
    const unmatched = await facade.resume(invocation);
    const report = queueReports.at(-1);
    assert.ok(report, JSON.stringify(unmatched.blockers));
    assert.equal(
      report.counts.external_flow_refs,
      0,
      "one matching version cannot close a UUID whose two versions are referenced",
    );
    assert.ok(report.blockers.some((item) => item.code === "process_flow_reference_unresolved"));
    const latest = unmatched.artifacts.findLast((item) => item.role === "foundry-assessment.json");
    lastAssessmentSha = latest?.kind === "file" ? latest.sha256 : undefined;
  }
  const secondVersion = structuredClone(mass.flow);
  secondVersion.flowDataSet.administrativeInformation.publicationAndOwnership[
    "common:dataSetVersion"
  ] = "00.00.002";
  for (const completeVersion of ["00.00.001", null]) {
    const document = structuredClone(secondVersion) as Record<string, unknown>;
    const flow = document.flowDataSet as Record<string, unknown>;
    const publication = (flow.administrativeInformation as Record<string, unknown>)
      .publicationAndOwnership as Record<string, unknown>;
    if (completeVersion) publication["common:dataSetVersion"] = completeVersion;
    else delete publication["common:dataSetVersion"];
    fs.writeFileSync(
      references[0],
      correctFlow +
        JSON.stringify({
          id: "77777777-7777-4777-8777-777777777777",
          version: "00.00.002",
          json: document,
        }) +
        "\n",
    );
    descriptor.qa_reference_rows = references.map((file) => ({ file, sha256: digestFile(file) }));
    fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
    await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
    const unmatched = await facade.resume(invocation);
    assert.equal(
      queueReports.at(-1)?.counts.external_flow_refs,
      0,
      `metadata cannot replace a ${completeVersion ? "wrong" : "missing"} complete payload version: ${JSON.stringify(unmatched.blockers)}`,
    );
  }
  fs.writeFileSync(references[0], correctFlow + JSON.stringify(secondVersion) + "\n");
  const wrongUnit = structuredClone(mass.group);
  wrongUnit.unitGroupDataSet.administrativeInformation.publicationAndOwnership[
    "common:dataSetVersion"
  ] = "00.00.002";
  fs.writeFileSync(references[1], JSON.stringify([mass.property, wrongUnit]));
  descriptor.qa_reference_rows = references.map((file) => ({ file, sha256: digestFile(file) }));
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
  const missingUnit = await facade.resume(invocation);
  const unitAssessment = missingUnit.artifacts.findLast(
    (item) => item.role === "foundry-assessment.json",
  );
  assert.ok(unitAssessment?.kind === "file", JSON.stringify(missingUnit));
  const unitStage = JSON.parse(fs.readFileSync(unitAssessment.path, "utf8"));
  const unitQa = JSON.parse(fs.readFileSync(unitStage.sets[0].qa_report, "utf8"));
  assert.equal(queueReports.at(-1)?.counts.external_flow_refs, 2);
  assert.equal(unitQa.mass_balance[0].status, "unresolved");
  assert.equal(unitQa.mass_balance[0].exchanges[0].mass_kg, null);
  assert.match(unitQa.mass_balance[0].exchanges[0].error, /exact reference payload is missing/u);
  fs.writeFileSync(
    references[0],
    JSON.stringify({
      id: "77777777-7777-4777-8777-777777777777",
      version: "00.00.001",
      state_code: 100,
      json: mass.flow,
    }) +
      "\n" +
      JSON.stringify(secondVersion) +
      "\n",
  );
  fs.writeFileSync(references[1], JSON.stringify([mass.property, mass.group]));
  descriptor.qa_reference_rows = references.map((file) => ({ file, sha256: digestFile(file) }));
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const selected = await facade.resume({ ...invocation, referenceInputFile: descriptorFile });
  const artifact = selected.artifacts.findLast(
    (item) => item.role === "foundry-reference-input.json",
  );
  assert.ok(artifact?.kind === "file", JSON.stringify(selected.blockers));
  const selection = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
    qa_files: Array<{ path: string; sha256: string }>;
    grants_permission: boolean;
  };
  assert.equal(selection.grants_permission, false);
  assert.deepEqual(
    selection.qa_files.map((item) => item.sha256),
    descriptor.qa_reference_rows.map((item) => item.sha256),
  );
  references.forEach((file) => fs.unlinkSync(file));

  // Invoke the existing finalization owner on the same registered public task.
  // No account is selected: this exercises real offline QA transport, not remote identity or a write.
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    ...invocation,
  };
  const context = createFoundryRuntimeContext(options);
  const runtime = createFoundryRuntime(context, qualifyFoundryRuntime(context, runtimeSelection));
  qaCalls.length = 0;
  const validationsBefore = validationCalls.length;
  const reassessed = await facade.resume(invocation);
  assert.ok(
    !reassessed.blockers.some((item) => item.code === "workflow_assessment_invalid"),
    JSON.stringify(reassessed.blockers),
  );
  const assessmentFile = reassessed.artifacts.findLast(
    (item) => item.role === "foundry-assessment.json",
  );
  assert.ok(assessmentFile?.kind === "file");
  const newAssessment = JSON.parse(fs.readFileSync(assessmentFile.path, "utf8"));
  assert.equal(newAssessment.sets.length, 1);
  assert.equal(newAssessment.sets[0].type, "process");
  assert.ok(newAssessment.sets[0].reference_input_sha256);
  assert.equal(validationCalls.length, validationsBefore + 1);
  const validationFile = newAssessment.sets[0].cli_validation_report;
  assert.equal(digestFile(validationFile), newAssessment.sets[0].cli_validation_report_sha256);
  const validation = JSON.parse(fs.readFileSync(validationFile, "utf8"));
  assert.equal(validation.input_path, newAssessment.sets[0].cli_validation_input.path);
  assert.notEqual(validation.input_path, newAssessment.sets[0].rows);
  assert.equal(newAssessment.sets[0].cli_validation_reference_input_sha256, artifact.sha256);
  const primaryRows = JSON.parse(fs.readFileSync(newAssessment.sets[0].rows, "utf8"));
  const projectedRows = JSON.parse(fs.readFileSync(validation.input_path, "utf8"));
  assert.deepEqual(projectedRows[0].json, primaryRows[0].json ?? primaryRows[0]);
  assert.equal(projectedRows[0].semantic_context.flow_documents.length, 2);
  assert.equal(validation.requested_type, "process");
  assert.equal(validation.rows.length, 1);
  assert.equal(
    validation.rows[0].allocation_semantics.profile,
    "tidas.process-allocation-reference.v1",
  );
  assert.ok([0, 1].includes(newAssessment.sets[0].cli_validation_exit));
  assert.notEqual(assessmentFile.sha256, lastAssessmentSha);
  const queueFile = reassessed.artifacts.findLast(
    (item) => item.role === "curation-queue-manifest.json",
  );
  assert.ok(queueFile?.kind === "file");
  const queue = JSON.parse(fs.readFileSync(queueFile.path, "utf8"));
  assert.equal(queue.counts.tasks, 1);
  assert.equal(queue.counts.flow_rows, 0);
  assert.equal(queue.counts.support_rows, 0);
  assert.equal(queue.counts.external_flow_refs, 2);
  assert.equal(queue.blockers.length, 0);
  const qa = JSON.parse(fs.readFileSync(newAssessment.sets[0].qa_report, "utf8"));
  assert.equal(qa.mass_balance[0].status, "applicable");
  assert.equal(qa.mass_balance[0].exchanges[0].unit.name, "kg");
  assert.equal(qa.mass_balance[0].exchanges[0].mass_kg, 1);
  assert.equal(qa.mass_balance[0].input_mass_kg, 1);
  assert.equal(qa.mass_balance[0].output_mass_kg, 1);
  assert.equal(qa.mass_balance[0].delta, 0);
  assert.deepEqual(
    qa.mass_balance[0].exchanges[0].references.map((ref: { kind: string }) => ref.kind),
    ["flow", "flowproperty", "unitgroup"],
  );
  assert.equal(qaCalls.length, 1);
  assert.deepEqual(
    qaCalls[0].flatMap((arg, index, argv) =>
      arg === "--reference-rows-file" ? [argv[index + 1]] : [],
    ),
    selection.qa_files.map((item) => item.path),
  );
  qaCalls.length = 0;
  const updated = await runtime.inspectTask();
  const reassessedContext = createFoundryRuntimeContext({
    ...options,
    inputs: updated.artifacts.map((entry) =>
      captureFoundryInput(path.resolve(context.taskRoot!, entry.path)),
    ),
  });
  await finalizeFoundryWorkflow(
    reassessedContext,
    qualifyFoundryRuntime(reassessedContext, runtimeSelection),
    updated.artifacts,
  );
  assert.equal(qaCalls.length, 1);
  assert.deepEqual(
    qaCalls[0].flatMap((arg, index, argv) =>
      arg === "--reference-rows-file" ? [argv[index + 1]] : [],
    ),
    selection.qa_files.map((item) => item.path),
  );
  const after = await runtime.inspectTask();
  assert.ok(after.artifacts.some((entry) => entry.path.endsWith("foundry-finalize.json")));
  assert.ok(
    !after.artifacts.some((entry) => entry.command === "dataset-workflow-execution-prepare"),
  );
  const beforeStatusCalls = qaCalls.length;
  await facade.status(invocation);
  assert.equal(qaCalls.length, beforeStatusCalls, "read-only status does not repeat QA");
  const validationBytes = fs.readFileSync(validationFile);
  fs.appendFileSync(validationFile, " ");
  assert.ok(
    (await facade.status(invocation)).blockers.length,
    "new CLI evidence drift must fail closed",
  );
  fs.writeFileSync(validationFile, validationBytes);
  const projectedBytes = fs.readFileSync(validation.input_path);
  fs.appendFileSync(validation.input_path, " ");
  assert.ok(
    (await facade.status(invocation)).blockers.length,
    "derived validation input drift fails closed",
  );
  fs.writeFileSync(validation.input_path, projectedBytes);
  fs.appendFileSync(selection.qa_files[0].path, " ");
  const changed = await facade.status(invocation);
  assert.notEqual(changed.status, "completed");
  assert.ok(changed.blockers.length > 0, "changed dependency snapshots must fail closed");
});

test("Source and Contact are not Process QA evidence or writable dependency tasks", async (t) => {
  for (const kind of ["source", "contact"] as const) {
    await t.test(kind, async (child) => {
      const { root, facade } = workflowFixture(child);
      const seed = path.join(root, "seed.json"),
        spec = path.join(root, "request.json"),
        refs = path.join(root, "refs.json"),
        selection = path.join(root, "selection.json");
      fs.writeFileSync(
        seed,
        JSON.stringify({
          rows: [processRowWithInvalidLocation("66666666-6666-4666-8666-666666666666")],
        }),
      );
      fs.writeFileSync(
        spec,
        JSON.stringify({
          schema: "tiangong-foundry.task-start.v1",
          request_id: `non-qa-${kind}`,
          actor_id: "qa-actor",
          lane: "source-evidence-dataset-development",
          profile_id: "generic",
          target_entities: ["process"],
          sources: [{ path: seed }],
          seed: { path: seed },
          account_intent: null,
          preparation: null,
        }),
      );
      const started = await facade.start({ specFile: spec });
      assert.ok(started.task_id);
      const invocation = { taskId: started.task_id, actorId: "qa-actor" };
      await facade.resume(invocation);
      await facade.resume(invocation);
      const initial = await facade.resume(invocation);
      const manifest = initial.artifacts.findLast((item) => item.role === "foundry-rows.json");
      assert.ok(manifest?.kind === "file");
      const source = sourceRow("88888888-8888-4888-8888-888888888888").sourceDataSet;
      fs.writeFileSync(
        refs,
        JSON.stringify([
          kind === "source"
            ? { sourceDataSet: source }
            : {
                contactDataSet: {
                  contactInformation: {
                    dataSetInformation: source.sourceInformation.dataSetInformation,
                  },
                  administrativeInformation: source.administrativeInformation,
                },
              },
        ]),
      );
      fs.writeFileSync(
        selection,
        JSON.stringify({
          schema: "tiangong-foundry.reference-input.v1",
          task_id: invocation.taskId,
          actor_id: invocation.actorId,
          rows_manifest_sha256: manifest.sha256,
          dataset_type: "process",
          qa_reference_rows: [{ file: refs, sha256: digestFile(refs) }],
          intent: null,
          review_files: [],
        }),
      );
      await facade.resume({ ...invocation, referenceInputFile: selection });
      const rejected = await facade.resume(invocation);
      assert.ok(rejected.blockers.length, JSON.stringify(rejected));
      assert.notEqual(rejected.status, "completed");
      assert.equal(rejected.task_id, invocation.taskId);
      assert.ok(!rejected.artifacts.some((item) => item.role === "foundry-owner-request.json"));
      const rows = JSON.parse(fs.readFileSync(manifest.path, "utf8"));
      assert.deepEqual(
        rows.sets.map((set: { type: string }) => set.type),
        ["process"],
      );
      // The published CLI owns supported reference kinds. No local success or writable
      // Source/Contact scope is manufactured to hide its rejection.
      assert.match(
        JSON.stringify(rejected.blockers),
        /PROCESS_QA_REFERENCE_INVALID|QA references|CLI/u,
      );
    });
  }
});

test("stale Process references do not block assessment of an independent Source", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const before = path.join(root, "before.json"),
    after = path.join(root, "after.json"),
    flowOnly = path.join(root, "flow-only.json"),
    specFile = path.join(root, "request.json");
  const processRow = processRowWithInvalidLocation("66666666-6666-4666-8666-666666666666");
  const source = sourceRow("88888888-8888-4888-8888-888888888888");
  const independentFlow = flowRow("55555555-5555-4555-8555-555555555555");
  fs.writeFileSync(before, JSON.stringify({ rows: [processRow, source, independentFlow] }));
  processRow.processDataSet.processInformation.dataSetInformation.name.baseName["#text"] =
    "Revised heat supply";
  fs.writeFileSync(after, JSON.stringify({ rows: [processRow, source, independentFlow] }));
  fs.writeFileSync(flowOnly, JSON.stringify({ rows: [independentFlow] }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "independent-source",
      actor_id: "qa-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process", "source", "flow"],
      sources: [{ path: before }, { path: after }, { path: flowOnly }],
      seed: { path: before },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id, JSON.stringify(started.blockers));
  const invocation = { taskId: started.task_id, actorId: "qa-actor" };
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    ...invocation,
  };
  const context = createFoundryRuntimeContext({
    ...options,
    inputs: [before, after, flowOnly].map(captureFoundryInput),
  });
  const runtime = createFoundryRuntime(context, qualifyFoundryRuntime(context, runtimeSelection));
  const indexedContext = async () => {
    const inspected = await runtime.inspectTask();
    return {
      inspected,
      selected: createFoundryRuntimeContext({
        ...options,
        inputs: [
          ...[before, after, flowOnly].map(captureFoundryInput),
          ...inspected.artifacts.map((entry) =>
            captureFoundryInput(path.resolve(context.taskRoot!, entry.path)),
          ),
        ],
      }),
    };
  };
  await runtime.prepareContext(["process", "source", "flow"]);
  await runtime.materializeRows([before]);
  const initial = await runtime.inspectTask();
  const initialRows = initial.artifacts.findLast((entry) =>
    entry.path.endsWith("/foundry-rows.json"),
  );
  assert.ok(initialRows);
  const refs = path.join(root, "refs.json"),
    descriptor = path.join(root, "refs-selection.json");
  fs.writeFileSync(refs, JSON.stringify([flowRow("77777777-7777-4777-8777-777777777777")]));
  fs.writeFileSync(
    descriptor,
    JSON.stringify({
      schema: "tiangong-foundry.reference-input.v1",
      task_id: invocation.taskId,
      actor_id: invocation.actorId,
      rows_manifest_sha256: initialRows.sha256,
      dataset_type: "process",
      qa_reference_rows: [{ file: refs, sha256: digestFile(refs) }],
      intent: null,
      review_files: [],
    }),
  );
  const selection = await facade.resume({ ...invocation, referenceInputFile: descriptor });
  assert.ok(
    selection.artifacts.some((entry) => entry.role === "foundry-reference-input.json"),
    JSON.stringify(selection.blockers),
  );
  await runtime.materializeRows([after]);
  const changed = await indexedContext();
  const state = currentWorkflowState(changed.selected, changed.inspected.artifacts);
  assert.ok(state.rows);
  const contracts = changed.inspected.artifacts
    .filter((entry) => entry.path.endsWith("/contract-report.json"))
    .map((entry) => path.resolve(context.taskRoot!, entry.path));
  const result = await assessFoundryWorkflowRows(
    changed.selected,
    qualifyFoundryRuntime(changed.selected, runtimeSelection),
    state.rows.file,
    contracts,
    undefined,
    { scopeType: "source" },
  );
  assert.deepEqual(
    (result.sets as Array<{ type: string }>).map((set) => set.type),
    ["source"],
  );
  const updated = await indexedContext();
  const pending = currentWorkflowState(updated.selected, updated.inspected.artifacts);
  assert.ok(pending.rows && pending.assessment);
  await assert.rejects(
    assessFoundryWorkflowRows(
      updated.selected,
      qualifyFoundryRuntime(updated.selected, runtimeSelection),
      pending.rows.file,
      contracts,
      undefined,
      { scopeType: "process", previousAssessment: pending.assessment.file },
    ),
    { code: "reference_input_stale" },
  );

  // Once a legal selected materialization removes Process, its former queue evidence
  // must not make every otherwise-current independent Flow assessment look stale.
  await runtime.materializeRows([flowOnly]);
  const flowStage = await indexedContext();
  const flowState = currentWorkflowState(flowStage.selected, flowStage.inspected.artifacts);
  assert.ok(flowState.rows);
  await assessFoundryWorkflowRows(
    flowStage.selected,
    qualifyFoundryRuntime(flowStage.selected, runtimeSelection),
    flowState.rows.file,
    contracts,
    undefined,
    { scopeType: "flow", previousAssessment: flowState.assessment?.file },
  );
  const finished = await indexedContext();
  const finishedState = currentWorkflowState(finished.selected, finished.inspected.artifacts);
  assert.equal(finishedState.assessmentComplete, true);
  assert.deepEqual(finishedState.assessmentRemainingTypes, []);
  assert.deepEqual(
    finishedState.assessment?.value.sets.map((set) => set.type),
    ["flow"],
  );
});
