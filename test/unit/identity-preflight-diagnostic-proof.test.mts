import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createIdentityPreflightBinding,
  sha256Text,
  validateIdentityPreflightExecution,
  validateIdentityPreflightEvidence,
} from "../../scripts/lib/identity-preflight-proof.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const started = Date.parse("2026-08-25T01:00:00.000Z");
function fixture(type: "flow" | "process", version = "0.1.27") {
  const target = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    version: "00.00.001",
    name: "Example",
  };
  const requestText = JSON.stringify({ schema_version: 1, target });
  const binding = createIdentityPreflightBinding({
    datasetType: type,
    datasetId: target.id,
    datasetVersion: target.version,
    targetSha256: sha256Text(JSON.stringify(target)),
    requestText,
    semanticArgv: [type, "identity-preflight", "--json", "--timeout-ms", "60000"],
    cli: {
      packageName: "@tiangong-lca/cli",
      packageVersion: version,
      packageIntegrity: `sha256-${"a".repeat(64)}`,
    },
    authReceipt: testAuthIdentityReceipt({
      packageVersion: version,
      capturedAtUtc: "2026-08-25T00:59:50.000Z",
    }),
    relevantInputHashes: { source_file: "b".repeat(64) },
  });
  const report = {
    schema_version: 1,
    kind: type,
    generated_at_utc: "2026-08-25T01:00:00.010Z",
    status: "needs_review",
    decision: "manual_review",
    target,
    next_action: "queue_manual_review",
    candidates: [],
    candidate_sources: [],
    findings: [],
    blockers: [],
    input_path: "/fixture/request.json",
    out_dir: "/fixture/output",
    files: { identity_decision: "/fixture/output/outputs/identity-decision.json" },
  };
  const input = {
    binding,
    exitCode: 1,
    stdoutText: JSON.stringify(report),
    diskReportText: JSON.stringify(report, null, 2),
    startedAtMs: started,
    diskReportMtimeMs: started + 10,
    completedAtUtc: "2026-08-25T01:00:01.000Z",
    requestFile: report.input_path,
    outputDir: report.out_dir,
    reportFile: report.files.identity_decision,
    signal: null,
    stderrText: "",
  };
  return { binding, report, input };
}

for (const type of ["flow", "process"] as const) {
  test(`${type} exact diagnostic stays manual review and is consumable downstream`, () => {
    const { binding, input } = fixture(type);
    const checked = validateIdentityPreflightExecution(input);
    assert.equal(checked.ok, true);
    assert.equal(checked.manifest.report.status, "needs_review");
    assert.equal(checked.manifest.report.decision, "manual_review");
    assert.equal(
      validateIdentityPreflightEvidence(checked.manifest, {
        requestText: binding.inputs.requestText,
        reportText: input.diskReportText,
        datasetType: type,
        datasetId: binding.dataset.id,
        datasetVersion: binding.dataset.version,
        targetSha256: binding.dataset.target_sha256,
      }).ok,
      true,
    );
  });
  test(`${type} incomplete, failed, wrong or unbound diagnostics fail closed`, () => {
    const { binding, report, input } = fixture(type);
    const reportChanges: Array<Record<string, unknown>> = [
      { status: "passed" },
      { status: "blocked", decision: "block_duplicate", next_action: "stop_duplicate" },
      { status: "failed" },
      { status: "error" },
      { decision: "create_new" },
      { ok: false },
      { kind: type === "flow" ? "process" : "flow" },
      { next_action: "retry" },
      { target: { ...report.target, id: "foreign" } },
      { target: { ...report.target, version: "00.00.002" } },
      { candidates: null },
      { candidate_sources: null },
      { findings: null },
      { blockers: null },
      { blockers: [{ code: "search_failed" }] },
      { error: "failed" },
      { errors: ["failed"] },
      { generated_at_utc: "2026-08-25T00:59:59.999Z" },
      { generated_at_utc: "2026-08-25T01:00:02.000Z" },
    ];
    for (const change of reportChanges) {
      const value = { ...report, ...change };
      assert.equal(
        validateIdentityPreflightExecution({
          ...input,
          stdoutText: JSON.stringify(value),
          diskReportText: JSON.stringify(value),
        }).ok,
        false,
      );
    }
    for (const change of [
      { exitCode: 2 },
      { exitCode: 9 },
      { signal: "SIGTERM" },
      { signal: undefined },
      { stderrText: "failed" },
      { stderrText: undefined },
      { stdoutText: "malformed" },
      { diskReportText: null },
      { diskReportMtimeMs: started - 1 },
      { requestFile: "/wrong" },
      { outputDir: "/wrong" },
      { reportFile: "/wrong" },
      { stdoutText: JSON.stringify({ ...report, confidence: "different" }) },
      {
        binding: createIdentityPreflightBinding({
          ...binding.inputs,
          targetSha256: "c".repeat(64),
        }),
      },
      {
        binding: createIdentityPreflightBinding({
          ...binding.inputs,
          cli: { ...binding.inputs.cli, packageVersion: "0.1.26" },
        }),
      },
      {
        binding: createIdentityPreflightBinding({
          ...binding.inputs,
          authReceipt: testAuthIdentityReceipt({ packageVersion: "0.1.22" }),
        }),
      },
      {
        binding: createIdentityPreflightBinding({
          ...binding.inputs,
          semanticArgv: [...binding.inputs.semanticArgv, "--extra"],
        }),
      },
      { binding: { ...binding, binding_sha256: "d".repeat(64) } },
    ])
      assert.equal(validateIdentityPreflightExecution({ ...input, ...change }).ok, false);
  });
}

test("the separately supported retained 0.1.22 diagnostic requires its own exact receipt", () => {
  assert.equal(validateIdentityPreflightExecution(fixture("flow", "0.1.22").input).ok, true);
});

for (const type of ["flow", "process"] as const) {
  test(`${type} Windows diagnostic accepts pinned owner native paths for the same absolute files`, (t) => {
    t.mock.method(path, "resolve", (...paths: string[]) => path.win32.resolve(...paths));
    t.mock.method(path, "isAbsolute", (value: string) => path.win32.isAbsolute(value));
    const { report, input } = fixture(type, "0.1.28");
    const selected = {
      ...input,
      requestFile: "C:/proof/项目 workspace/request.json",
      outputDir: "C:/proof/项目 workspace/output",
      reportFile: "C:/proof/项目 workspace/output/outputs/identity-decision.json",
    };
    const native = {
      ...report,
      input_path: "C:\\proof\\项目 workspace\\request.json",
      out_dir: "C:\\proof\\项目 workspace\\output",
      files: {
        identity_decision: "C:\\proof\\项目 workspace\\output\\outputs\\identity-decision.json",
      },
    };
    const checked = validateIdentityPreflightExecution({
      ...selected,
      stdoutText: JSON.stringify(native),
      diskReportText: JSON.stringify(native, null, 2),
    });
    assert.equal(checked.ok, true);
    assert.equal(checked.manifest.report.decision, "manual_review");
    for (const change of [
      { input_path: "D:\\proof\\项目 workspace\\request.json" },
      { input_path: "proof\\项目 workspace\\request.json" },
      { out_dir: "C:\\proof\\项目 workspace\\foreign" },
      { files: { identity_decision: "C:\\proof\\foreign\\identity-decision.json" } },
    ]) {
      const value = { ...native, ...change };
      assert.equal(
        validateIdentityPreflightExecution({
          ...selected,
          stdoutText: JSON.stringify(value),
          diskReportText: JSON.stringify(value),
        }).ok,
        false,
      );
    }
  });
}

test("POSIX backslashes remain filename bytes rather than Windows separators", () => {
  const { report, input } = fixture("flow", "0.1.28");
  const changed = { ...report, input_path: "\\fixture\\request.json" };
  assert.equal(
    validateIdentityPreflightExecution({
      ...input,
      stdoutText: JSON.stringify(changed),
      diskReportText: JSON.stringify(changed),
    }).ok,
    false,
  );
});
