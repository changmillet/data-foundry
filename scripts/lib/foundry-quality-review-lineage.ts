import fs from "node:fs";
import path from "node:path";
import { captureFoundryInput } from "./foundry-runtime-context.ts";
import { sha256Json as cleanupProofSha256 } from "./import-curation/internal/hash-utils.ts";
import { canonicalPayloadSha256 } from "./post-write-root-proof.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";

type Json = Record<string, unknown>;
function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}
function same(a: unknown, b: unknown) {
  return canonicalPayloadSha256(a) === canonicalPayloadSha256(b);
}
/** Verify the existing cleanup producer's explicit validation-context proof. Never transform rows. */
export function unchangedQualityReviewRows(input: {
  originalRows: readonly unknown[];
  finalRowsFile: string;
  taskRoot: string;
  assetRoot: string;
  cleanupReport?: unknown;
  referenceFiles: readonly { path: string; bytes: number; sha256: string }[];
}): boolean {
  const rows = readRows(input.finalRowsFile);
  if (same(rows, input.originalRows)) return true;
  if (
    typeof input.cleanupReport !== "string" ||
    !input.referenceFiles.length ||
    rows.length !== input.originalRows.length
  )
    return false;
  const reportFile = path.resolve(input.assetRoot, input.cleanupReport);
  if (!fs.realpathSync(reportFile).startsWith(`${fs.realpathSync(input.taskRoot)}${path.sep}`))
    return false;
  const report = object(JSON.parse(fs.readFileSync(reportFile, "utf8")));
  const proof = object(report?.process_validation_references);
  if (
    report?.command !== "dataset-curation-cleanup" ||
    report.status !== "completed" ||
    report.dataset_type !== "process" ||
    report.remote_write_mode !== "read-only" ||
    typeof report.rows_file !== "string" ||
    typeof report.cleaned_rows_file !== "string" ||
    path.resolve(input.assetRoot, report.cleaned_rows_file) !== input.finalRowsFile ||
    !proof ||
    !Array.isArray(proof.files) ||
    !Array.isArray(proof.rows) ||
    proof.rows.length !== rows.length
  )
    return false;
  const sourceFile = path.resolve(input.assetRoot, report.rows_file);
  if (!same(readRows(sourceFile), input.originalRows)) return false;
  if (proof.files.length !== input.referenceFiles.length) return false;
  const documents = new Map<string, unknown>();
  const documentKey = (value: unknown) => {
    const identity = datasetIdentity(value, 0, "flow");
    return JSON.stringify([identity.id, identity.version]);
  };
  for (const [index, original] of input.referenceFiles.entries()) {
    const recorded = object(proof.files[index]);
    if (
      !recorded ||
      typeof recorded.path !== "string" ||
      recorded.bytes !== original.bytes ||
      recorded.sha256 !== original.sha256 ||
      path.resolve(input.assetRoot, recorded.path) !== original.path
    )
      return false;
    const observed = captureFoundryInput(original.path);
    if (observed.bytes !== original.bytes || observed.sha256 !== original.sha256) return false;
    for (const row of readRows(original.path)) {
      const payload = unwrapDatasetPayload(row, "flow");
      if (object(payload)?.flowDataSet) {
        const key = documentKey(payload),
          previous = documents.get(key);
        if (previous && !same(previous, payload)) return false;
        documents.set(key, payload);
      }
    }
  }
  return rows.every((row, index) => {
    const before = input.originalRows[index],
      original = datasetIdentity(before, index, "process"),
      current = datasetIdentity(row, index, "process");
    if (
      original.id !== current.id ||
      original.version !== current.version ||
      !same(original.payload, current.payload)
    )
      return false;
    const expectedWrapper: Json =
      original.payload === before ? { json: original.payload } : { ...object(before) };
    const actualWrapper = { ...object(row) };
    delete expectedWrapper.semantic_context;
    delete actualWrapper.semantic_context;
    if (!same(expectedWrapper, actualWrapper)) return false;
    const sourceContext = object(object(before)?.semantic_context) ?? {};
    const finalContext = object(object(row)?.semantic_context);
    const flowDocuments = finalContext?.flow_documents;
    if (!finalContext || !Array.isArray(flowDocuments)) return false;
    const { flow_documents: priorDocuments, ...priorOther } = sourceContext;
    const { flow_documents: _currentDocuments, ...currentOther } = finalContext;
    if (
      !same(priorOther, currentOther) ||
      (priorDocuments !== undefined && !Array.isArray(priorDocuments))
    )
      return false;
    const prior = Array.isArray(priorDocuments) ? priorDocuments : [];
    if (
      flowDocuments.length < prior.length ||
      prior.some((value, i) => !same(value, flowDocuments[i]))
    )
      return false;
    const process = object(object(current.payload)?.processDataSet),
      exchanges = object(process?.exchanges)?.exchange;
    const refs = (Array.isArray(exchanges) ? exchanges : exchanges ? [exchanges] : []).flatMap(
      (value) => {
        const ref = object(object(value)?.referenceToFlowDataSet);
        return ref ? [JSON.stringify([ref["@refObjectId"], ref["@version"]])] : [];
      },
    );
    const included = new Map<string, unknown>();
    for (const document of prior) {
      if (!object(document)?.flowDataSet) return false;
      const key = documentKey(document),
        selected = documents.get(key),
        earlier = included.get(key);
      if ((selected && !same(selected, document)) || (earlier && !same(earlier, document)))
        return false;
      included.set(key, document);
    }
    const expectedKeys = [...new Set(refs)].filter(
      (key) => documents.has(key) && !included.has(key),
    );
    const added = flowDocuments.slice(prior.length);
    if (
      added.length !== expectedKeys.length ||
      added.some(
        (document, i) =>
          documentKey(document) !== expectedKeys[i] ||
          !same(document, documents.get(expectedKeys[i])),
      )
    )
      return false;
    const recorded = object((proof.rows as unknown[])[index]);
    return (
      recorded?.row_index === index &&
      recorded.input_payload_sha256 === cleanupProofSha256(original.payload) &&
      recorded.output_payload_sha256 === cleanupProofSha256(current.payload) &&
      recorded.flow_documents_sha256 === cleanupProofSha256(flowDocuments)
    );
  });
}
