import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { unchangedQualityReviewRows } from "../../scripts/lib/foundry-quality-review-lineage.ts";
import { captureFoundryInput } from "../../scripts/lib/foundry-runtime-context.ts";
import { sha256Json } from "../../scripts/lib/import-curation/internal/hash-utils.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";

type Json = Record<string, unknown>;
// These fixtures follow the cleanup proof and projection producer inspected at fb658de6:
// curation-cleanup.ts:286-320 and foundry-validation-reference-context.ts. Projection wraps
// raw rows in `json`, preserves prior context, and appends each selected exact Flow once in
// exchange order. Conflicting selected or prior-context Flow bodies are rejected by that producer.
const flowId = "12345678-1234-1234-1234-123456789abc";
const secondFlowId = "22345678-1234-1234-1234-123456789abc";
const processId = "32345678-1234-1234-1234-123456789abc";
const version = "01.00.000";
function flow(id = flowId, description = "selected exact Flow") {
  return {
    flowDataSet: {
      flowInformation: { dataSetInformation: { "common:UUID": id, description } },
      administrativeInformation: { publicationAndOwnership: { "common:dataSetVersion": version } },
      flowProperties: { flowProperty: [{ "@dataSetInternalID": "0", meanValue: "1" }] },
    },
  };
}
function process(id = processId, ids = [flowId]) {
  return {
    processDataSet: {
      processInformation: { dataSetInformation: { "common:UUID": id } },
      administrativeInformation: { publicationAndOwnership: { "common:dataSetVersion": version } },
      exchanges: {
        exchange: ids.map((ref, index) => ({
          "@dataSetInternalID": String(index),
          referenceToFlowDataSet: { "@refObjectId": ref, "@version": version },
          exchangeDirection: "Output",
          meanAmount: "1",
        })),
      },
    },
  };
}
const wrapper = (payload: unknown, documents: readonly unknown[], context: Json = {}) => ({
  json: payload,
  semantic_context: { ...context, flow_documents: documents },
});

function fixture(t: TestContext, originalRows: unknown[] = [process()]) {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-review-lineage-"));
  t.after(() => fs.rmSync(assetRoot, { recursive: true, force: true }));
  const taskRoot = path.join(assetRoot, "task"),
    source = path.join(taskRoot, "source.jsonl"),
    finalRowsFile = path.join(taskRoot, "final.jsonl"),
    reference = path.join(taskRoot, "flows.jsonl"),
    cleanupReport = path.join(taskRoot, "cleanup.json");
  fs.mkdirSync(taskRoot);
  const writeRows = (file: string, rows: readonly unknown[]) =>
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeRows(source, originalRows);
  let finalRows: unknown[] = originalRows;
  let referenceFiles: ReturnType<typeof captureFoundryInput>[] = [];
  const writeReferences = (rows: unknown[]) => {
    writeRows(reference, rows);
    referenceFiles = [captureFoundryInput(reference)];
  };
  writeReferences([flow()]);
  const writeFinal = (rows: unknown[]) => {
    finalRows = rows;
    writeRows(finalRowsFile, rows);
  };
  const report = () => ({
    schema_version: 2,
    generated_at_utc: "2026-10-10T00:00:00.000Z",
    command: "dataset-curation-cleanup",
    status: "completed",
    dataset_type: "process",
    remote_write_mode: "read-only",
    rows_file: source,
    cleaned_rows_file: finalRowsFile,
    process_validation_references: {
      files: referenceFiles.map((fact) => ({ ...fact })),
      rows: finalRows.map((row, index) => ({
        row_index: index,
        input_payload_sha256: sha256Json(
          datasetIdentity(originalRows[index], index, "process").payload,
        ),
        output_payload_sha256: sha256Json(datasetIdentity(row, index, "process").payload),
        flow_documents_sha256: sha256Json(
          (row as { semantic_context: { flow_documents: unknown[] } }).semantic_context
            .flow_documents,
        ),
      })),
    },
    counts: { rows: originalRows.length, blockers: 0 },
    blockers: [],
    files: { report: cleanupReport, cleaned_rows: finalRowsFile },
  });
  const writeReport = (value: unknown = report()) =>
    fs.writeFileSync(cleanupReport, JSON.stringify(value));
  const input = () => ({
    originalRows,
    finalRowsFile,
    taskRoot,
    assetRoot,
    cleanupReport,
    referenceFiles,
  });
  const check = () => unchangedQualityReviewRows(input());
  writeFinal(originalRows);
  return {
    assetRoot,
    taskRoot,
    source,
    reference,
    cleanupReport,
    originalRows,
    writeFinal,
    writeReferences,
    report,
    writeReport,
    input,
    check,
  };
}

test("quality review lineage accepts exact original ordered rows without a cleanup exception", (t) => {
  const rows = [process(), process("42345678-1234-1234-1234-123456789abc")];
  const f = fixture(t, rows);
  assert.equal(
    unchangedQualityReviewRows({ ...f.input(), cleanupReport: undefined, referenceFiles: [] }),
    true,
  );
  f.writeFinal([...rows].reverse());
  assert.equal(unchangedQualityReviewRows({ ...f.input(), cleanupReport: undefined }), false);
});

test("quality review lineage accepts the existing producer's exact selected Flow projection", (t) => {
  const f = fixture(t),
    expected = [wrapper(f.originalRows[0], [flow()])];
  f.writeFinal(expected);
  f.writeReport();
  assert.equal(f.check(), true);
});

test("quality review lineage accepts preserved wrapper metadata and prior context before new exact Flows", (t) => {
  const original = wrapper(process(), [flow(secondFlowId)], { annotation: { note: "keep" } });
  const row = { id: processId, version, ...original, label: "existing label" };
  const f = fixture(t, [row]);
  const expected = [
    {
      ...row,
      semantic_context: { ...row.semantic_context, flow_documents: [flow(secondFlowId), flow()] },
    },
  ];
  f.writeFinal(expected);
  f.writeReport();
  assert.equal(f.check(), true);
});

test("quality review lineage rejects absent or structurally malformed cleanup proof", (t) => {
  const f = fixture(t);
  f.writeFinal([wrapper(f.originalRows[0], [flow()])]);
  assert.equal(unchangedQualityReviewRows({ ...f.input(), cleanupReport: undefined }), false);
  for (const change of [
    { command: "other" },
    { status: "blocked" },
    { dataset_type: "flow" },
    { remote_write_mode: "write" },
    { rows_file: 0 },
    { cleaned_rows_file: "wrong.jsonl" },
    { process_validation_references: null },
    { process_validation_references: { files: [], rows: [] } },
  ]) {
    f.writeReport({ ...f.report(), ...change });
    assert.equal(f.check(), false, JSON.stringify(change));
  }
  f.writeReport();
  assert.equal(unchangedQualityReviewRows({ ...f.input(), referenceFiles: [] }), false);
  const outside = path.join(f.assetRoot, "outside-report.json");
  fs.writeFileSync(outside, JSON.stringify(f.report()));
  assert.equal(unchangedQualityReviewRows({ ...f.input(), cleanupReport: outside }), false);
});

test("quality review lineage rejects changed scientific payload, identities and ordered row scope", (t) => {
  const originals = [process(), process("42345678-1234-1234-1234-123456789abc")];
  const f = fixture(t, originals);
  const changed = process();
  changed.processDataSet.exchanges.exchange[0].meanAmount = "2";
  const variants = [
    [wrapper(changed, [flow()]), wrapper(originals[1], [flow()])],
    [wrapper(originals[1], [flow()]), wrapper(originals[0], [flow()])],
    [wrapper(originals[0], [flow()])],
    [{ ...wrapper(originals[0], [flow()]), id: "different" }, wrapper(originals[1], [flow()])],
  ];
  for (const rows of variants) {
    f.writeFinal(rows);
    f.writeReport();
    assert.equal(f.check(), false);
  }
});

test("quality review lineage rejects introduced or edited unrelated wrapper metadata", (t) => {
  const f = fixture(t);
  f.writeFinal([{ ...wrapper(f.originalRows[0], [flow()]), unrelated: "introduced" }]);
  f.writeReport();
  assert.equal(f.check(), false);
  const original = { ...wrapper(process(), []), label: "original" },
    g = fixture(t, [original]);
  g.writeFinal([{ ...wrapper(original.json, [flow()]), label: "changed" }]);
  g.writeReport();
  assert.equal(g.check(), false);
});

test("quality review lineage rejects changed prior context and reordered or replaced prior Flow bodies", (t) => {
  const prior = [flow(secondFlowId), flow("52345678-1234-1234-1234-123456789abc")];
  const original = wrapper(process(), prior, { annotation: "keep" }),
    f = fixture(t, [original]);
  for (const row of [
    wrapper(original.json, [...prior, flow()], { annotation: "changed" }),
    wrapper(original.json, [...prior].reverse().concat(flow()), { annotation: "keep" }),
    wrapper(original.json, [flow(secondFlowId, "edited"), prior[1], flow()], {
      annotation: "keep",
    }),
    wrapper(original.json, [flow()], { annotation: "keep" }),
  ]) {
    f.writeFinal([row]);
    f.writeReport();
    assert.equal(f.check(), false);
  }
});

test("quality review lineage rejects unrelated, unselected and changed exact-version Flow bodies", (t) => {
  const f = fixture(t);
  for (const document of [
    flow(secondFlowId),
    flow(flowId, "unselected changed body"),
    {
      flowDataSet: {
        ...flow().flowDataSet,
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "01.00.001" },
        },
      },
    },
  ]) {
    f.writeFinal([wrapper(f.originalRows[0], [document])]);
    f.writeReport();
    assert.equal(f.check(), false);
  }
  f.writeReferences([flow(), flow(secondFlowId)]);
  f.writeFinal([wrapper(f.originalRows[0], [flow(secondFlowId)])]);
  f.writeReport();
  assert.equal(f.check(), false, "a selected but unreferenced Flow is not a producer projection");
});

test("quality review lineage rejects wrong row index, payload hash and derived document hash", (t) => {
  const f = fixture(t);
  f.writeFinal([wrapper(f.originalRows[0], [flow()])]);
  for (const change of [
    { row_index: 1 },
    { input_payload_sha256: "0".repeat(64) },
    { output_payload_sha256: "0".repeat(64) },
    { flow_documents_sha256: "0".repeat(64) },
  ]) {
    const report = f.report();
    Object.assign(report.process_validation_references.rows[0], change);
    f.writeReport(report);
    assert.equal(f.check(), false);
  }
  const report = f.report();
  report.process_validation_references.files[0].sha256 = "0".repeat(64);
  f.writeReport(report);
  assert.equal(f.check(), false);
});

test("quality review lineage rejects selected reference or source files edited after proof capture", (t) => {
  const f = fixture(t);
  f.writeFinal([wrapper(f.originalRows[0], [flow()])]);
  f.writeReport();
  fs.writeFileSync(f.reference, JSON.stringify(flow(flowId, "edited selected bytes")) + "\n");
  assert.equal(f.check(), false);
  f.writeReferences([flow()]);
  f.writeReport();
  fs.writeFileSync(
    f.source,
    JSON.stringify(process("62345678-1234-1234-1234-123456789abc")) + "\n",
  );
  assert.equal(f.check(), false);
});

test("quality review lineage rejects conflicting selected complete Flow bodies as the producer does", (t) => {
  const references = [flow(), flow(flowId, "conflicting exact-version body")],
    f = fixture(t);
  f.writeReferences(references);
  f.writeFinal([wrapper(f.originalRows[0], [references[0]])]);
  f.writeReport();
  assert.equal(f.check(), false);
});

test("quality review lineage rejects selected Flow evidence conflicting with preserved prior context", (t) => {
  const original = wrapper(process(processId, [flowId, secondFlowId]), [flow()]),
    references = [flow(flowId, "conflicting selected body"), flow(secondFlowId)],
    f = fixture(t, [original]);
  f.writeReferences(references);
  f.writeFinal([wrapper(original.json, [flow(), flow(secondFlowId)])]);
  f.writeReport();
  assert.equal(f.check(), false);
});

test("quality review lineage rejects an arbitrary new payload wrapper", (t) => {
  const f = fixture(t),
    payload = f.originalRows[0];
  f.writeFinal([{ payload, semantic_context: { flow_documents: [flow()] } }]);
  f.writeReport();
  assert.equal(f.check(), false);
});

test("quality review lineage rejects an extra shadow payload alias", (t) => {
  const f = fixture(t),
    payload = f.originalRows[0];
  f.writeFinal([
    { ...wrapper(payload, [flow()]), payload: process("72345678-1234-1234-1234-123456789abc") },
  ]);
  f.writeReport();
  assert.equal(f.check(), false);
});

for (const [label, documents] of [
  ["missing all selected references", []],
  ["missing one selected reference", [flow()]],
  ["reordered selected references", [flow(secondFlowId), flow()]],
  ["duplicated selected reference", [flow(), flow(), flow(secondFlowId)]],
] as const) {
  test(`quality review lineage rejects ${label} in the producer projection`, (t) => {
    const original = process(processId, [flowId, secondFlowId]),
      f = fixture(t, [original]);
    f.writeReferences([flow(), flow(secondFlowId)]);
    f.writeFinal([wrapper(original, documents)]);
    f.writeReport();
    assert.equal(f.check(), false, JSON.stringify(documents));
  });
}
