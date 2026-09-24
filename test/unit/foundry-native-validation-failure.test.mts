import assert from "node:assert/strict";
import test from "node:test";
import { nativeValidationFailureEvidence } from "../../scripts/lib/foundry-native-validation-failure.ts";

const rowSha = "a".repeat(64);
const report = {
  schema_version: "tidas.operation-report.v1",
  command: "validate",
  status: "failed",
  exit_class: "io",
  diagnostics: [
    {
      schema_version: "tidas.diagnostic.v1",
      code: "validation_io_failed",
      message: "failed to persist issue spool at validation-events.jsonl (os error 3)",
      path: null,
      details: {},
    },
  ],
  artifacts: [],
  next_actions: [],
};

test("native failure evidence keeps an authentic bounded I/O report but refuses missing diagnostics", () => {
  const native = { exit_code: 74, report, stderr: "" } as Parameters<
    typeof nativeValidationFailureEvidence
  >[0];
  const accepted = nativeValidationFailureEvidence(
    native,
    "process",
    "/selected/process.rows.json",
    rowSha,
    1,
  );
  assert.equal(accepted.exit_class, "io");
  assert.equal(accepted.diagnostic_code, "validation_io_failed");
  assert.equal(accepted.row_count, 1);
  assert.deepEqual(accepted.native_report.diagnostics, report.diagnostics);
  assert.throws(
    () =>
      nativeValidationFailureEvidence(
        {
          ...native,
          report: { ...report, diagnostics: [] },
        },
        "process",
        "/selected/process.rows.json",
        rowSha,
        1,
      ),
    /complete bounded failure evidence/u,
  );
  assert.throws(
    () =>
      nativeValidationFailureEvidence(
        {
          ...native,
          report: { ...report, diagnostics: [{ ...report.diagnostics[0], code: "unsafe code" }] },
        },
        "process",
        "/selected/process.rows.json",
        rowSha,
        1,
      ),
    /complete bounded failure evidence/u,
  );
});
