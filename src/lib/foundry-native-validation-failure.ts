import path from "node:path";
import { createHash } from "node:crypto";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readWorkflowArtifact, workflowObject } from "./foundry-workflow-state.ts";
import { runTidasRowsValidation } from "./tidas-adapter.ts";

export const nativeFailureFileName = "native-validation-failure.json";
export const nativeFailureResultName = "foundry-assessment-failure.json";
const nativeFailureSchema = "tiangong-foundry.native-validation-failure.v1";
const nativeFailureResultSchema = "tiangong-foundry.assessment-failure.v1";
const maxNativeReportBytes = 256 * 1024;
const maxNativeStderrBytes = 64 * 1024;
const exitClasses = new Map([
  [64, "usage"],
  [69, "unavailable"],
  [70, "internal"],
  [74, "io"],
  [130, "cancelled"],
]);

function invalid(): never {
  throw new FoundryContextError(
    "workflow_native_report_invalid",
    "Native validation did not return complete bounded failure evidence.",
  );
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function nativeValidationFailureEvidence(
  native: ReturnType<typeof runTidasRowsValidation>,
  datasetType: string,
  rowsFile: string,
  rowsSha256: string,
  rowCount: number,
) {
  const report = workflowObject(native.report);
  const diagnostics = report.diagnostics;
  const stderr = native.stderr ?? "";
  if (
    !exitClasses.has(native.exit_code) ||
    report.schema_version !== "tidas.operation-report.v1" ||
    report.command !== "validate" ||
    report.status !== (native.exit_code === 130 ? "cancelled" : "failed") ||
    report.exit_class !== exitClasses.get(native.exit_code) ||
    !Array.isArray(diagnostics) ||
    diagnostics.length < 1 ||
    ![
      "process",
      "flow",
      "source",
      "contact",
      "unitgroup",
      "flowproperty",
      "lifecyclemodel",
    ].includes(datasetType) ||
    !/^[0-9a-f]{64}$/u.test(rowsSha256) ||
    !Number.isSafeInteger(rowCount) ||
    rowCount < 0 ||
    Buffer.byteLength(JSON.stringify(report)) > maxNativeReportBytes ||
    Buffer.byteLength(stderr) > maxNativeStderrBytes
  )
    invalid();
  for (const candidate of diagnostics) {
    const detail = workflowObject(candidate);
    if (
      detail.schema_version !== "tidas.diagnostic.v1" ||
      typeof detail.code !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/u.test(detail.code) ||
      typeof detail.message !== "string" ||
      !detail.message.trim() ||
      detail.message.length > 4096 ||
      Array.from(detail.message).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 && ![9, 10, 13].includes(codePoint);
      })
    )
      invalid();
  }
  const first = workflowObject(diagnostics[0]);
  return {
    schema: nativeFailureSchema,
    dataset_type: datasetType,
    rows_file: rowsFile,
    rows_sha256: rowsSha256,
    row_count: rowCount,
    exit_code: native.exit_code,
    exit_class: report.exit_class,
    diagnostic_code: first.code,
    diagnostic_message: first.message,
    native_report: report,
    stderr: stderr ? { bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) } : null,
    stderr_text: stderr,
  };
}

export function currentNativeValidationFailure(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  rowsReport: {
    file: string;
    sha256: string;
    sets: readonly { type: string; file: string; count: number }[];
  } | null,
) {
  for (const entry of [...entries].reverse()) {
    if (
      entry.command !== "dataset-workflow-assessment" ||
      path.basename(entry.path) !== nativeFailureResultName
    )
      continue;
    const result = readWorkflowArtifact(context, entry);
    const value = result.value;
    if (
      value.schema !== nativeFailureResultSchema ||
      value.status !== "blocked" ||
      value.task_id !== context.taskId ||
      value.rows_report !== rowsReport?.file ||
      value.rows_report_sha256 !== rowsReport?.sha256 ||
      typeof value.evidence_file !== "string" ||
      typeof value.evidence_sha256 !== "string" ||
      typeof value.dataset_type !== "string" ||
      typeof value.rows_file !== "string" ||
      !Number.isSafeInteger(value.row_count)
    )
      invalid();
    const detailEntry = entries.find(
      (candidate) =>
        candidate.command === entry.command &&
        candidate.operation_id === entry.operation_id &&
        candidate.sha256 === value.evidence_sha256 &&
        path.join(context.taskRoot!, candidate.path) === value.evidence_file &&
        path.basename(candidate.path) === nativeFailureFileName,
    );
    if (!detailEntry) invalid();
    const detail = readWorkflowArtifact(context, detailEntry);
    const selected = rowsReport?.sets.find((set) => set.type === value.dataset_type);
    if (
      !selected ||
      selected.file !== value.rows_file ||
      selected.count !== value.row_count ||
      captureFoundryInput(selected.file).sha256 !== value.rows_file_sha256
    )
      invalid();
    const nativeReport = workflowObject(detail.value.native_report);
    const diagnostics = nativeReport.diagnostics;
    const first =
      Array.isArray(diagnostics) && diagnostics.length ? workflowObject(diagnostics[0]) : invalid();
    if (
      detail.value.schema !== nativeFailureSchema ||
      detail.value.dataset_type !== value.dataset_type ||
      detail.value.rows_file !== value.rows_file ||
      detail.value.rows_sha256 !== value.rows_file_sha256 ||
      detail.value.row_count !== value.row_count ||
      detail.value.exit_code !== value.exit_code ||
      detail.value.exit_class !== value.exit_class ||
      detail.value.diagnostic_code !== value.diagnostic_code ||
      detail.value.diagnostic_message !== value.diagnostic_message ||
      nativeReport.exit_class !== value.exit_class ||
      typeof first.code !== "string" ||
      first.code !== value.diagnostic_code ||
      first.message !== value.diagnostic_message
    )
      invalid();
    const stderrText = detail.value.stderr_text;
    const stderr = detail.value.stderr;
    if (
      typeof stderrText !== "string" ||
      (stderr === null && stderrText !== "") ||
      (stderr !== null &&
        (typeof stderr !== "object" ||
          (stderr as Record<string, unknown>).bytes !== Buffer.byteLength(stderrText) ||
          (stderr as Record<string, unknown>).sha256 !== sha256(stderrText)))
    )
      invalid();
    return { entry, result: value, detail: detail.value, file: detail.file };
  }
  return null;
}
