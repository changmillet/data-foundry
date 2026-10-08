import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import { digestFile, workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { unwrapDatasetPayload } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { supportFlowPropertyRow, supportUnitGroupRow } from "../fixtures/support-row-builders.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;

const annualFixed = [
  { "@xml:lang": "en", "#text": "200000 kg/year" },
  { "@xml:lang": "zh", "#text": "200000 千克/年" },
];
export const registeredPreparationCases = [
  [
    "nonannual",
    [
      { "@xml:lang": "en", "#text": "200000 kg" },
      { "@xml:lang": "zh", "#text": "200000 千克" },
    ],
    "annual_supply_or_production_volume_not_annualized",
  ],
  ["unknown", [], "annual_supply_or_production_volume_missing"],
  [
    "fixed",
    [
      { "@xml:lang": "en", "#text": "200000 kg/year" },
      { "@xml:lang": "zh", "#text": "200000 千克/年" },
    ],
    null,
  ],
  ["allocation-input-product", annualFixed, null, "Product flow", "Input", "passed"],
  ["allocation-output-product", annualFixed, null, "Product flow", "Output", "passed"],
  ["allocation-input-waste", annualFixed, null, "Waste flow", "Input", "passed"],
  ["allocation-output-waste", annualFixed, null, "Waste flow", "Output", "passed"],
  ["allocation-elementary", annualFixed, null, "Elementary flow", "Input", "failed"],
  ["allocation-absent", annualFixed, null, "Product flow", "Input", "unresolved"],
  ["allocation-wrong-version", annualFixed, null, "Product flow", "Input", "unresolved"],
] as Array<[string, unknown, string | null, string?, string?, string?]>;

export const registeredPreparationGroups = {
  annual: ["nonannual", "unknown", "fixed"],
  targets: [
    "allocation-input-product",
    "allocation-output-product",
    "allocation-input-waste",
    "allocation-output-waste",
  ],
  unresolved: ["allocation-elementary", "allocation-absent", "allocation-wrong-version"],
} as const;

export async function verifyRegisteredProcessPreparation(
  t: TestContext,
  selected: (typeof registeredPreparationCases)[number],
) {
  const [name, annual, expected, flowType, direction, semanticExpected] = selected;
  const { root, facade } = workflowFixture(t);
  const source = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  ) as { payload: Json; context: { flow_documents: Json[] } };
  object(
    object(object(source.payload.processDataSet).modellingAndValidation)
      .dataSourcesTreatmentAndRepresentativeness,
  ).annualSupplyOrProductionVolume = annual;
  if (flowType) {
    const flowRoot = object(source.context.flow_documents[0].flowDataSet);
    object(object(flowRoot.modellingAndValidation).LCIMethod).typeOfDataSet = flowType;
    const exchanges = object(object(source.payload.processDataSet).exchanges).exchange as Json[];
    exchanges[1].exchangeDirection = direction;
    if (name === "allocation-wrong-version")
      object(object(flowRoot.administrativeInformation).publicationAndOwnership)[
        "common:dataSetVersion"
      ] = "00.00.002";
    if (name === "allocation-absent") source.context.flow_documents = [];
  }
  const seed = path.join(root, "process-source.json");
  const propertyId = "93a60a56-a3c8-11da-a746-0800200b9a66";
  const unitGroupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const property = supportFlowPropertyRow(propertyId, unitGroupId);
  const units = supportUnitGroupRow(unitGroupId);
  units.unitGroupDataSet.units.unit[0].name = "kg";
  object(object(source.payload.processDataSet).processInformation).quantitativeReference = {
    ...object(
      object(object(source.payload.processDataSet).processInformation).quantitativeReference,
    ),
    functionalUnitOrOther: { "@xml:lang": "en", "#text": "1 kg of synthetic product" },
  };
  const before = JSON.stringify(source.payload);
  fs.writeFileSync(
    seed,
    JSON.stringify({
      source_evidence:
        name === "unknown"
          ? { annual_quantity: "unknown", reporting_period: "unknown" }
          : { annual_quantity: "200000 kg", reporting_period: "one year" },
      rows: [
        { json_ordered: source.payload, semantic_context: source.context },
        ...source.context.flow_documents,
        property,
        units,
      ],
    }),
  );
  const request = path.join(root, "preparation-request.json");
  fs.writeFileSync(
    request,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: `annual-${name}`,
      actor_id: "preparation-author",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow", "flowproperty", "unitgroup", "process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile: request });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "preparation-author" };
  let inspected = await facade.status(invocation);
  const hasCompleteAssessment = () =>
    inspected.artifacts.some((item) => {
      if (item.kind !== "file" || path.basename(item.path) !== "foundry-assessment.json")
        return false;
      const value = object(JSON.parse(fs.readFileSync(item.path, "utf8")));
      return (
        value.status === "completed" && (value.sets as Json[]).some((set) => set.type === "process")
      );
    });
  for (let i = 0; i < 8 && !hasCompleteAssessment(); i += 1) {
    await facade.resume(invocation);
    inspected = await facade.status(invocation);
  }
  const evidence = inspected.artifacts.findLast(
    (item) => item.kind === "file" && path.basename(item.path) === "foundry-assessment.json",
  );
  assert.ok(evidence?.kind === "file", JSON.stringify(inspected.blockers));
  const assessment = object(JSON.parse(fs.readFileSync(evidence.path, "utf8")));
  const process = (assessment.sets as Json[]).find((item) => item.type === "process");
  assert.ok(process);
  const report = object(JSON.parse(fs.readFileSync(String(process.cli_validation_report), "utf8")));
  const row = object((report.rows as unknown[])[0]);
  if (semanticExpected) assert.equal(object(row.allocation_semantics).status, semanticExpected);
  assert.equal(row.payload_sha256, object(row.allocation_semantics).candidate_sha256);

  const issues = object(row.validation_layers).authoring_evidence as { issues: Json[] };
  assert.equal(
    issues.issues.some((item) =>
      String(item.code).startsWith("annual_supply_or_production_volume"),
    ),
    expected !== null,
  );
  if (expected) assert.ok(issues.issues.some((item) => item.code === expected));
  const gate = object(JSON.parse(fs.readFileSync(String(process.curation_report), "utf8")));
  const entities = gate.entities as Json[];
  const entity = entities[0];
  assert.ok(entity);
  const authoringPackage = JSON.parse(
    fs.readFileSync(
      path.resolve(String(assessment.owner_base), String(entity.authoring_package)),
      "utf8",
    ),
  ) as Json;
  const actions = authoringPackage.action_items as Json[];
  if (semanticExpected && semanticExpected !== "passed") {
    assert.ok(
      actions.some(
        (item) => item.validation_layer === "allocation_semantics" && item.ai_required === true,
      ),
    );
  }
  assert.deepEqual(object(authoringPackage.cli_validation).row, row);

  assert.equal(
    actions.some((item) => String(item.code).startsWith("annual_supply_or_production_volume")),
    expected !== null,
  );
  if (expected)
    assert.ok(
      actions.some((item) => item.code === expected && item.action_kind === "ai_authoring"),
    );
  assert.equal(JSON.stringify(source.payload), before);
  assert.equal(inspected.permissions.state, "not_required");
  const beforeResume = inspected.artifacts.map((item) => item.sha256);
  await facade.resume(invocation);
  const restarted = await facade.status(invocation);
  assert.deepEqual(
    restarted.artifacts.map((item) => item.sha256),
    beforeResume,
    "unchanged blocked preparation must not replay validation",
  );
  if (name === "nonannual") {
    const manifest = object(
      JSON.parse(fs.readFileSync(String(process.authoring_manifest), "utf8")),
    );
    const task = (manifest.tasks as Json[])[0];
    const files = object(task.files);
    const taskFile = path.resolve(String(assessment.owner_base), String(files.task_json));
    const currentRows = readRows(String(process.rows));
    const current = object(currentRows[0]);
    const payloadKey = ["process", "json_ordered", "jsonOrdered", "json", "payload"].find(
      (key) => current[key],
    );
    assert.ok(payloadKey);
    const annualPath = `/${payloadKey}/processDataSet/modellingAndValidation/dataSourcesTreatmentAndRepresentativeness/annualSupplyOrProductionVolume`;
    const patchFile = path.join(root, "annual-text-repair.json");
    const submissionFile = path.join(root, "annual-text-submission.json");
    const annualActions = actions
      .filter((item) => item.code === expected)
      .map((item) => ({ code: item.code, path: item.path }));
    fs.writeFileSync(
      patchFile,
      JSON.stringify({
        schema_version: 1,
        patch_status: "completed",
        patch_sets: [
          {
            dataset_id: object(task.entity).entity_id,
            version: object(task.entity).version,
            authoring_package: path.basename(String(files.authoring_package)),
            operations: ["200000 kg/year", "200000 千克/年"].map((value, index) => ({
              op: "replace",
              path: `${annualPath}/${index}/#text`,
              value,
              basis: "Synthetic source explicitly states these quantities cover one year.",
              evidence: {
                source: seed,
                field_path: annualPath,
                quote_or_trace: "Synthetic annual production period is one year; 200000 kg.",
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
              closes_action_items: annualActions,
            })),
          },
        ],
      }),
    );
    fs.writeFileSync(
      submissionFile,
      JSON.stringify({
        schema: "tiangong-foundry.semantic-input.v1",
        task_id: invocation.taskId,
        actor_id: invocation.actorId,
        assessment_sha256: evidence.sha256,
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
    const oldBytes = fs.readFileSync(String(process.rows));
    const applied = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
    const collected = applied.artifacts.findLast(
      (item) => item.kind === "file" && item.role === "authoring-patch-collect-report.json",
    );
    assert.equal(
      applied.status,
      "ready",
      JSON.stringify(
        collected?.kind === "file"
          ? JSON.parse(fs.readFileSync(collected.path, "utf8"))
          : applied.blockers,
      ),
    );
    assert.deepEqual(fs.readFileSync(String(process.rows)), oldBytes);
    const rowsArtifact = applied.artifacts.findLast(
      (item) => item.kind === "file" && path.basename(item.path) === "foundry-rows.json",
    );
    assert.ok(rowsArtifact?.kind === "file");
    const newSets = object(JSON.parse(fs.readFileSync(rowsArtifact.path, "utf8"))).sets as Json[];
    const newProcess = newSets.find((item) => item.type === "process");
    assert.ok(newProcess);
    const repaired = unwrapDatasetPayload(readRows(String(newProcess.file))[0], "process");
    const expectedPayload = structuredClone(source.payload);
    const expectedAnnual = object(
      object(object(expectedPayload.processDataSet).modellingAndValidation)
        .dataSourcesTreatmentAndRepresentativeness,
    ).annualSupplyOrProductionVolume as Json[];
    expectedAnnual[0]["#text"] = "200000 kg/year";
    expectedAnnual[1]["#text"] = "200000 千克/年";
    assert.deepEqual(repaired, expectedPayload, "only the two evidence-backed text fields change");
    for (let i = 0; i < 8; i += 1) {
      await facade.resume(invocation);
      inspected = await facade.status(invocation);
      const current = inspected.artifacts.findLast(
        (item) => item.kind === "file" && path.basename(item.path) === "foundry-assessment.json",
      );
      if (current?.kind === "file") {
        const value = object(JSON.parse(fs.readFileSync(current.path, "utf8")));
        if (
          value.status === "completed" &&
          (value.sets as Json[]).some(
            (set) => set.type === "process" && set.rows === newProcess.file,
          )
        )
          break;
      }
    }
    const reviewed = inspected;
    const refreshed = reviewed.artifacts.findLast(
      (item) => item.kind === "file" && path.basename(item.path) === "foundry-assessment.json",
    );
    assert.ok(refreshed?.kind === "file");
    const refreshedProcess = (
      object(JSON.parse(fs.readFileSync(refreshed.path, "utf8"))).sets as Json[]
    ).find((item) => item.type === "process");
    assert.ok(refreshedProcess);
    const refreshedReport = object(
      JSON.parse(fs.readFileSync(String(refreshedProcess.cli_validation_report), "utf8")),
    );
    const refreshedLayer = object(
      object((refreshedReport.rows as Json[])[0].validation_layers).authoring_evidence,
    );
    assert.deepEqual(refreshedLayer.issues, []);
    const repairedBytes = fs.readFileSync(String(newProcess.file));
    const duplicate = await facade.resume({ ...invocation, semanticInputFile: submissionFile });
    assert.notEqual(duplicate.status, "completed");
    assert.deepEqual(fs.readFileSync(String(newProcess.file)), repairedBytes);
  }
}
