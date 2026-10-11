import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDatasetCurationCleanup } from "../../scripts/lib/import-curation/curation-cleanup.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonRecord;
}

function writeJsonLines(filePath: string, rows: unknown[]): string {
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
  return text;
}

test("Process cleanup preserves supplied validation evidence while normalizing only candidate metadata", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cleanup-validation-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  ) as { payload: JsonRecord; context: { flow_documents: JsonRecord[] } };
  const candidate = record(source.payload.processDataSet);
  record(record(candidate.administrativeInformation).dataEntryBy)["common:timeStamp"] =
    "2025-03-01T08:00:00+08:00";
  const flow = record(source.context.flow_documents[0].flowDataSet);
  record(record(flow.administrativeInformation).dataEntryBy)["common:timeStamp"] =
    "2025-02-01T08:00:00+08:00";
  const context = { ...source.context, candidate_sha256: "a".repeat(64) };
  const input = path.join(root, "processes.jsonl");
  const original = writeJsonLines(input, [{ json: source.payload, semantic_context: context }]);
  const report = runDatasetCurationCleanup({
    repoRoot: root,
    options: { type: "process", rowsFile: input, outDir: path.join(root, "cleanup") },
  });
  assert.equal(report.status, "completed");
  const output = path.resolve(root, String(record(report.files).cleaned_rows));
  const cleaned = record(JSON.parse(fs.readFileSync(output, "utf8")));
  assert.deepEqual(cleaned.semantic_context, context, "independent evidence is not cleanup input");
  assert.equal(
    record(
      record(record(record(cleaned.json).processDataSet).administrativeInformation).dataEntryBy,
    )["common:timeStamp"],
    "2025-03-01T00:00:00.000Z",
  );
  assert.equal(fs.readFileSync(input, "utf8"), original);
});

test("Process cleanup projects selected complete Flow evidence into the final row envelope", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cleanup-flow-projection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  ) as { payload: JsonRecord; context: { flow_documents: JsonRecord[] } };
  const flow = record(source.context.flow_documents[0].flowDataSet);
  record(record(flow.administrativeInformation).dataEntryBy)["common:timeStamp"] =
    "2025-02-01T08:00:00+08:00";
  const input = path.join(root, "processes.jsonl");
  const referenceFile = path.join(root, "flows.jsonl");
  const original = writeJsonLines(input, [{ json: source.payload }]);
  const referenceBytes = writeJsonLines(referenceFile, source.context.flow_documents);
  const referenceFact = {
    path: referenceFile,
    bytes: Buffer.byteLength(referenceBytes),
    sha256: createHash("sha256").update(referenceBytes).digest("hex"),
  };
  const baseline = runDatasetCurationCleanup({
    repoRoot: root,
    options: { type: "process", rowsFile: input, outDir: path.join(root, "baseline") },
  });
  const result = runDatasetCurationCleanup({
    repoRoot: root,
    options: { type: "process", rowsFile: input, outDir: path.join(root, "projected") },
    processValidationReferences: { rows: source.context.flow_documents, files: [referenceFact] },
  });
  assert.equal(result.status, "completed");
  const loadFinal = (report: JsonRecord) =>
    record(
      JSON.parse(
        fs.readFileSync(path.resolve(root, String(record(report.files).cleaned_rows)), "utf8"),
      ),
    );
  const plain = loadFinal(baseline);
  const projected = loadFinal(result);
  assert.deepEqual(
    record(projected.semantic_context).flow_documents,
    source.context.flow_documents,
  );
  assert.deepEqual(
    datasetIdentity(projected, 0, "process").payload,
    datasetIdentity(plain, 0, "process").payload,
  );
  assert.deepEqual(record(result.process_validation_references).files, [referenceFact]);
  assert.equal(fs.readFileSync(input, "utf8"), original);
  assert.equal(fs.readFileSync(referenceFile, "utf8"), referenceBytes);
});
