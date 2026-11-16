import fs from "node:fs";
import path from "node:path";
import {
  FoundryContextError,
  captureFoundryInput,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { canonicalPayloadSha256 } from "./post-write-root-proof.ts";
import { datasetIdentity, detectDatasetType } from "./import-curation/internal/dataset-payload.ts";
import { foundryProcessQa } from "./foundry-process-qa.ts";
import type { MassReferenceEvidence } from "./foundry-process-mass-balance.ts";
import { sha256Text } from "./identity-preflight-proof.ts";
import { projectFoundryValidationReferences } from "./foundry-validation-reference-context.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { assertWorkflowReportArtifact, runWorkflowLocalCliResult } from "./foundry-workflow-io.ts";

function invalid(): never {
  throw new FoundryContextError(
    "workflow_qa_failed",
    "The complete typed dataset validation does not match the selected row and receipt.",
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

type RowIdentity = { id: string; version: string; payload: unknown };

type ValidationType = "flow" | "process" | "lifecyclemodel";

const operationFor = (type: ValidationType) =>
  `dataset ${type === "lifecyclemodel" ? "model" : type} validate`;

function projectValidation(
  type: ValidationType,
  row: RowIdentity,
  output: string,
  exit: number,
  receipt: unknown,
  bytes: Buffer,
) {
  const report = object(receipt);
  const artifact = Array.isArray(report.artifacts) ? object(report.artifacts[0]) : invalid();
  if (
    report.schemaVersion !== 1 ||
    report.operation !== operationFor(type) ||
    report.status !== "completed" ||
    report.error !== null ||
    artifact.path !== output ||
    artifact.purpose !== "complete_result" ||
    artifact.bytes !== bytes.length
  )
    return invalid();

  const complete = object(JSON.parse(bytes.toString("utf8")));
  const preview = object(object(report.data).validation);
  const issues = complete.issues;
  const previewIssues = preview.issues;
  const receiptKeys = [
    "id",
    "type",
    "version",
    "status",
    "validator",
    "issue_count",
    "payload_sha256",
  ];
  const status = complete.status;
  const admittedStatuses =
    type === "process" ? ["passed", "failed", "incomplete"] : ["passed", "failed"];
  if (
    !admittedStatuses.includes(String(status)) ||
    exit !== (status === "passed" ? 0 : 1) ||
    report.outcome !== `validation_${status}` ||
    complete.type !== type ||
    complete.index !== 0 ||
    complete.id !== row.id ||
    complete.version !== row.version ||
    complete.payload_sha256 !== canonicalPayloadSha256(row.payload) ||
    JSON.stringify(complete.checks) !== '["schema","business"]' ||
    !Array.isArray(issues) ||
    !Array.isArray(previewIssues) ||
    complete.issue_count !== issues.length ||
    (status === "passed" && issues.length !== 0) ||
    (status === "failed" && issues.length === 0) ||
    receiptKeys.some((key) => complete[key] !== preview[key]) ||
    canonicalPayloadSha256(previewIssues) !==
      canonicalPayloadSha256(issues.slice(0, previewIssues.length))
  )
    return invalid();

  const ownerIssues: unknown[] = [...issues];
  if (type === "process" && status === "incomplete") {
    const names = object(complete.flow_reference_names);
    if (names.status === "unresolved" && Array.isArray(names.issues))
      ownerIssues.push(...names.issues);
  }
  const findings = ownerIssues.map((raw: unknown) => {
    const { code, path: issuePath, message } = object(raw);
    if (
      typeof code !== "string" ||
      !code ||
      typeof issuePath !== "string" ||
      typeof message !== "string" ||
      !message
    )
      return invalid();
    return {
      entity_id: row.id,
      version: row.version,
      severity: "error",
      code,
      path: issuePath,
      message,
    };
  });
  if (status === "incomplete" && findings.length === 0)
    findings.push({
      entity_id: row.id,
      version: row.version,
      severity: "error",
      code: "process_business_validation_incomplete",
      path: "$",
      message: "Resolve exact Process reference evidence and repeat CLI business validation.",
    });
  return { complete, findings };
}

export function projectFlowValidation(
  row: RowIdentity,
  output: string,
  exit: number,
  receipt: unknown,
  bytes: Buffer,
) {
  return projectValidation("flow", row, output, exit, receipt, bytes).findings;
}

type ValidationOptions = {
  referenceFiles?: readonly string[];
  validationInput?: string;
  readRowsFile?: (file: string) => string;
};

type ValidationIo = {
  writeJson: (file: string, value: unknown) => void;
  readRowsFile: (file: string) => string;
  readResult: (file: string) => Buffer;
  run: (argv: string[]) => {
    exit: number;
    report: Record<string, unknown>;
    validate: <T>(check: () => T) => T;
  };
};

export function runFoundryTypedDatasetQa(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  writeJson: ValidationIo["writeJson"],
  type: ValidationType,
  rowsFile: string,
  output: string,
  options: ValidationOptions = {},
) {
  const directory = resolveFoundryOutput(context, output);
  return runTypedDatasetQa(type, rowsFile, directory, options, {
    writeJson,
    readRowsFile:
      options.readRowsFile ?? ((file) => readFoundryInput(context, file).toString("utf8")),
    readResult: (file) => fs.readFileSync(assertWorkflowReportArtifact(context, file, directory)),
    run: (argv) => runWorkflowLocalCliResult(context, qualified, temporary, argv),
  });
}

export function runTypedDatasetQa(
  type: ValidationType,
  rowsFile: string,
  directory: string,
  options: ValidationOptions,
  { writeJson, readRowsFile, readResult, run }: ValidationIo,
) {
  const rows = readRows(rowsFile, readRowsFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const referenceEvidence = [...new Set(options.referenceFiles ?? [])].map((file) => {
    const fact = captureFoundryInput(file);
    const contents = readRowsFile(file);
    if (sha256Text(contents) !== fact.sha256) return invalid();
    return { fact, rows: readRows(file, () => contents) };
  });
  const references = referenceEvidence.flatMap(({ rows }) => rows);
  const projected =
    type === "process" ? projectFoundryValidationReferences(rows, references) : rows;
  const massReferences: MassReferenceEvidence = { rows: new Map() };
  const support: unknown[] = [];
  for (const source of references) {
    const kind = detectDatasetType(source);
    if (kind !== "flow" && kind !== "unitgroup" && kind !== "flowproperty") return invalid();
    const supplied = datasetIdentity(source, 0, kind);
    const { id, version, payload } = datasetIdentity(supplied.payload, 0, kind);
    const key = `${kind}/${id}/${version}`;
    if (!id || !version || id === "row-1" || id !== supplied.id || version !== supplied.version)
      return invalid();
    const sha256 = canonicalPayloadSha256(payload);
    const prior = massReferences.rows.get(key);
    if (prior && prior.sha256 !== sha256) return invalid();
    if (!prior) {
      massReferences.rows.set(key, { payload: object(payload), sha256 });
      if (kind !== "flow") support.push(payload);
    }
  }
  const operation = operationFor(type);
  const validations = rows.map((source, index) => {
    const row = datasetIdentity(source, index, type);
    const input = path.join(directory, `${type}-${index + 1}.json`);
    const resultFile = path.join(directory, `validation-${index + 1}.json`);
    // 0.4 checks the typed root before its validation reader unwraps json and reads
    // semantic_context. The complete result must still hash to the original payload.
    const processInput = type === "process" ? object(projected[index]) : null;
    writeJson(
      input,
      processInput
        ? {
            ...object(row.payload),
            json: row.payload,
            semantic_context: processInput.semantic_context,
            ...(processInput.allocation_transformation === undefined
              ? {}
              : { allocation_transformation: processInput.allocation_transformation }),
          }
        : row.payload,
    );

    const argv = [
      ...operation.split(" "),
      "--input",
      input,
      "--checks",
      "schema,business",
      "--output",
      resultFile,
      "--json",
    ];
    let referenceDocuments;
    if (type === "process") {
      const flowDocs = object(processInput?.semantic_context).flow_documents;
      if (!Array.isArray(flowDocs)) return invalid();
      const documents = [
        ...new Map(
          [...flowDocs, ...support].map((document) => [canonicalPayloadSha256(document), document]),
        ).values(),
      ];
      if (documents.length) {
        referenceDocuments = path.join(directory, `references-${index + 1}.json`);
        writeJson(referenceDocuments, { documents });
        argv.push("--reference-documents", referenceDocuments);
      }
    }
    const validation = run(argv);
    const result = validation.validate(() =>
      projectValidation(
        type,
        row,
        resultFile,
        validation.exit,
        validation.report,
        readResult(resultFile),
      ),
    );
    return {
      id: row.id,
      version: row.version,
      result: resultFile,
      reference_documents: referenceDocuments ?? null,
      ...result,
    };
  });
  const reportFile =
    type === "process"
      ? path.join(directory, "outputs", "validation-report.json")
      : path.join(directory, `${type}-qa-report.json`);
  const report = {
    schema: `tiangong-foundry.typed-${type}-qa.v1`,
    status: `completed_typed_${type}_validation`,
    rows_file: rowsFile,
    validation_input: options.validationInput ?? rowsFile,
    validation_operation: operation,
    validations: validations.map(({ complete, findings: _findings, ...validation }) => ({
      ...validation,
      complete_sha256: canonicalPayloadSha256(complete),
    })),
    rows: validations.map(({ complete, findings }) => ({ ...complete, findings })),
    findings: validations.flatMap(({ findings }) => findings),
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  const exit = validations.some(({ complete }) => complete.status !== "passed") ? 1 : 0;
  if (type !== "process") return { reportFile, report, exit, validationReportFile: reportFile };
  const qaFile = path.join(directory, "process-qa-report.json");
  const qa = {
    ...foundryProcessQa(rows, massReferences),
    schema: "tiangong-foundry.process-qa.v1",
    rows_file: rowsFile,
    reference_evidence: referenceEvidence.map(({ fact }) => fact),
    files: { report: qaFile },
  };
  writeJson(qaFile, qa);
  return { reportFile: qaFile, report: qa, exit, validationReportFile: reportFile };
}
