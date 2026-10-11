import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import { workflowFixture, digestFile } from "./foundry-public-workflow.ts";
import { supportUnitGroupRow, supportFlowPropertyRow } from "./support-row-builders.ts";
import type { FoundryQualityReviewInput } from "../../scripts/lib/foundry-quality-review-input.ts";
import type { foundryQualityReviewScope } from "../../scripts/lib/foundry-quality-review.ts";

const ids = {
  a: "66666666-6666-4666-8666-666666666666",
  b: "66666666-6666-4666-8666-666666666667",
  input: "77777777-7777-4777-8777-777777777777",
  aFlow: "77777777-7777-4777-8777-777777777778",
  bFlow: "77777777-7777-4777-8777-777777777779",
  property: "88888888-8888-4888-8888-888888888888",
  unit: "99999999-9999-4999-8999-999999999999",
};
const text = (value: string) => ({ "@xml:lang": "en", "#text": value });
const reference = (id: string, name: string) => ({
  "@refObjectId": id,
  "@version": "00.00.001",
  "common:shortDescription": text(name),
});
function flow(id: string, name: string) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: { "common:UUID": id, name: { baseName: text(name) } },
        quantitativeReference: { referenceToReferenceFlowProperty: "0" },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: [
          {
            "@dataSetInternalID": "0",
            meanValue: "1",
            referenceToFlowPropertyDataSet: reference(ids.property, "Mass"),
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}
function processRow(id: string, productId: string, input: string) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: { baseName: text("Allocated product inventory") },
          "common:generalComment": text(
            "The disclosed physical mother has 160 kg input, 120 kg product A and 40 kg product B; allocation shares are 0.6 and 0.4 on a disclosed alternative product basis.",
          ),
        },
        quantitativeReference: {
          "@type": "Reference flow(s)",
          referenceToReferenceFlow: "1",
          functionalUnitOrOther: text("1 kg allocated product"),
        },
        time: { "common:referenceYear": "2023", "common:dataSetValidUntil": "2023" },
        geography: { locationOfOperationSupplyOrProduction: { "@location": "CN" } },
        technology: {
          technologyDescriptionAndIncludedProcesses: text(
            "Synthetic attribution inventory for a two-product physical model.",
          ),
        },
      },
      modellingAndValidation: {
        LCIMethodAndAllocation: {
          typeOfDataSet: "Unit process, single operation",
          LCIMethodPrinciple: "Attributional",
          LCIMethodApproaches: "Allocation - physical causality",
        },
      },
      exchanges: {
        exchange: [
          {
            "@dataSetInternalID": "0",
            exchangeDirection: "Input",
            meanAmount: input,
            resultingAmount: input,
            referenceToFlowDataSet: reference(ids.input, "Input material"),
          },
          {
            "@dataSetInternalID": "1",
            exchangeDirection: "Output",
            meanAmount: "1",
            resultingAmount: "1",
            referenceToFlowDataSet: reference(productId, "Allocated product"),
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
      },
    },
  };
}

export async function qualityReviewFixture(t: TestContext) {
  const fixture = workflowFixture(t);
  const { root, facade } = fixture;
  const seed = path.join(root, "seed.json"),
    specFile = path.join(root, "request.json");
  const unit = supportUnitGroupRow(ids.unit);
  unit.unitGroupDataSet.units.unit[0].name = "kg";
  const property = supportFlowPropertyRow(ids.property, ids.unit);
  const references = [
    flow(ids.input, "Input material"),
    flow(ids.aFlow, "Product A"),
    flow(ids.bFlow, "Product B"),
    property,
    unit,
  ];
  fs.writeFileSync(
    seed,
    JSON.stringify({
      rows: [
        processRow(ids.a, ids.aFlow, "0.8"),
        processRow(ids.b, ids.bFlow, "1.6"),
        ...references,
      ],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "quality-review-attribution",
      actor_id: "reviewer",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process", "flow", "flowproperty", "unitgroup"],
      sources: [{ path: seed }],
      seed: { path: seed },
      preparation: null,
      account_intent: {
        project_ref: "qgzvkongdjqiiamzbbts",
        user_id: "44444444-4444-4444-8444-444444444444",
        session_reference: null,
      },
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id, JSON.stringify(started));
  const invocation = { taskId: started.task_id, actorId: "reviewer" };
  await facade.resume(invocation);
  const materialized = await facade.resume(invocation);
  const manifest = materialized.artifacts.findLast((item) => item.role === "foundry-rows.json");
  assert.ok(manifest?.kind === "file", JSON.stringify(materialized.blockers));
  const refs = path.join(root, "mass-references.json");
  fs.writeFileSync(refs, JSON.stringify(references));
  const refsDescriptor = path.join(root, "references.json");
  fs.writeFileSync(
    refsDescriptor,
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
  await facade.resume({ ...invocation, referenceInputFile: refsDescriptor });
  let assessed = await facade.resume(invocation);
  for (
    let step = 0;
    step < 4 && !assessed.artifacts.some((item) => item.role === "quality_review_scope");
    step++
  )
    assessed = await facade.resume(invocation);
  const projected = assessed.artifacts.find((item) => item.role === "quality_review_scope");
  assert.ok(projected?.kind === "inline", JSON.stringify(assessed.blockers));
  const scope = projected.value as NonNullable<ReturnType<typeof foundryQualityReviewScope>>;
  assert.equal(scope.candidates.length, 2);
  const authority = path.join(root, "authority.txt"),
    model = path.join(root, "source-model.json");
  fs.writeFileSync(
    authority,
    "Synthetic test user decision: permit this exact current Product A observation review in preparation only; no write approval.",
  );
  fs.writeFileSync(
    model,
    JSON.stringify({
      physical_input_kg: 160,
      physical_products_kg: [120, 40],
      allocation_shares: [0.6, 0.4],
      allocated_inputs_per_kg: [0.8, 1.6],
      physical_residual_kg: 0,
    }),
  );
  const candidate = scope.candidates.find((item) => item.id === ids.a)!;
  const descriptor: FoundryQualityReviewInput = {
    schema: "tiangong-foundry.quality-review-input.v1",
    binding: scope.binding,
    runtime_qualification_sha256: scope.runtime_qualification_sha256,
    rows_manifest_sha256: scope.rows_manifest_sha256,
    assessment_sha256: scope.assessment_sha256,
    context_sha256: scope.context_sha256,
    reference_inputs_sha256: scope.reference_inputs_sha256,
    interaction_context_sha256: scope.interaction_context_sha256,
    qa_report_sha256: scope.qa_report_sha256,
    qa_findings_sha256: scope.qa_findings_sha256,
    expected_previous_sha256: scope.expected_previous_sha256,
    issued_at_utc: new Date(Date.now() - 1000).toISOString(),
    expires_at_utc: new Date(Date.now() + 3600_000).toISOString(),
    reviews: [
      {
        row_index: candidate.row_index,
        id: candidate.id,
        version: candidate.version,
        payload_sha256: candidate.payload_sha256,
        finding_sha256: candidate.finding_sha256,
        code: "process_material_balance_deviation",
        evidence_ids: ["approval", "model"],
        rationale:
          "The accepted preallocated view is not an isolated physical reaction; the independently disclosed mother closes.",
      },
    ],
    evidence: [
      { id: "approval", kind: "user-decision", file: authority, sha256: digestFile(authority) },
      { id: "model", kind: "source-model", file: model, sha256: digestFile(model) },
    ],
  };
  const descriptorFile = path.join(root, "quality-review.json");
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  return { ...fixture, ids, invocation, assessed, scope, descriptor, descriptorFile };
}
