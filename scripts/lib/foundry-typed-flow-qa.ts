import fs from "node:fs";
import path from "node:path";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { canonicalPayloadSha256 } from "./post-write-root-proof.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { assertWorkflowReportArtifact, runWorkflowLocalCliResult } from "./foundry-workflow-io.ts";

function invalid(): never {
  throw new FoundryContextError(
    "workflow_qa_failed",
    "The complete typed Flow validation does not match the selected row and receipt.",
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

type FlowIdentity = { id: string; version: string; payload: unknown };

export function projectFlowValidation(
  flow: FlowIdentity,
  output: string,
  exit: number,
  receipt: unknown,
  bytes: Buffer,
) {
  const report = object(receipt);
  const artifact = Array.isArray(report.artifacts) ? object(report.artifacts[0]) : invalid();
  if (
    report.schemaVersion !== 1 ||
    report.operation !== "dataset flow validate" ||
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
  const status = exit === 0 ? "passed" : exit === 1 ? "failed" : null;
  if (
    !status ||
    report.outcome !== `validation_${status}` ||
    complete.status !== status ||
    complete.type !== "flow" ||
    complete.index !== 0 ||
    complete.id !== flow.id ||
    complete.version !== flow.version ||
    complete.payload_sha256 !== canonicalPayloadSha256(flow.payload) ||
    JSON.stringify(complete.checks) !== '["schema","business"]' ||
    !Array.isArray(issues) ||
    !Array.isArray(previewIssues) ||
    complete.issue_count !== issues.length ||
    (status === "passed") !== (issues.length === 0) ||
    receiptKeys.some((key) => complete[key] !== preview[key]) ||
    canonicalPayloadSha256(previewIssues) !==
      canonicalPayloadSha256(issues.slice(0, previewIssues.length))
  )
    return invalid();

  return issues.map((raw: unknown) => {
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
      entity_id: flow.id,
      version: flow.version,
      severity: "error",
      code,
      path: issuePath,
      message,
    };
  });
}

export function runFoundryTypedFlowQa(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  writeJson: (file: string, value: unknown) => void,
  rowsFile: string,
  output: string,
) {
  const rows = readRows(rowsFile, (file) => readFoundryInput(context, file).toString("utf8"));
  const directory = resolveFoundryOutput(context, output);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const validations = rows.map((row, index) => {
    const flow = datasetIdentity(row, index, "flow");
    const input = path.join(directory, `flow-${index + 1}.json`);
    const resultFile = path.join(directory, `validation-${index + 1}.json`);
    writeJson(input, flow.payload);
    const validation = runWorkflowLocalCliResult(context, qualified, temporary, [
      "dataset",
      "flow",
      "validate",
      "--input",
      input,
      "--checks",
      "schema,business",
      "--output",
      resultFile,
      "--json",
    ]);
    const findings = validation.validate(() => {
      const artifact = assertWorkflowReportArtifact(context, resultFile, directory);
      return projectFlowValidation(
        flow,
        artifact,
        validation.exit,
        validation.report,
        fs.readFileSync(artifact),
      );
    });
    return { id: flow.id, version: flow.version, result: resultFile, findings };
  });
  const reportFile = path.join(directory, "flow-qa-report.json");
  const report = {
    schema: "tiangong-foundry.typed-flow-qa.v1",
    status: "completed_typed_flow_validation",
    rows_file: rowsFile,
    validation_operation: "dataset flow validate",
    validations: validations.map(({ id, version, result }) => ({ id, version, result })),
    findings: validations.flatMap(({ findings }) => findings),
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  return { reportFile, report };
}
