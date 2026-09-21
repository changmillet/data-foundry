import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  parseFoundryRepairDryRunReport,
  parseFoundryRepairRemoteReport,
  parseFoundryRepairValidateReport,
  type FoundryRepairExpectation,
} from "../../scripts/lib/foundry-repair-preflight.ts";

const contractSha = "a".repeat(64);
const beforeSha = "b".repeat(64);
const desiredSha = "c".repeat(64);
const processId = "22222222-2222-4222-8222-222222222222";
const version = "01.00.000";

const expectation: FoundryRepairExpectation = Object.freeze({
  dataset_type: "process",
  contract_sha256: contractSha,
  execution_id: "repair-exec-1",
  owner_user_id: "11111111-1111-4111-8111-111111111111",
  project_ref: "abcdefghijklmnopqrst",
  state_code: "0",
  actions: Object.freeze([
    {
      action_id: "repair-1",
      table: "processes",
      id: processId,
      version,
      before_sha256: beforeSha,
      desired_sha256: desiredSha,
    },
  ]),
});

type Json = Record<string, unknown>;

function layers(
  shape: Partial<Record<"schema" | "authoring" | "content" | "multilingual", string>> = {},
  code = "annual_supply_or_production_volume_missing",
) {
  const layer = (
    status: string,
    issues: Json[] = status === "failed"
      ? [{ code: "fixture_invalid", message: "Validation failure", path: "field" }]
      : [],
  ) => ({
    status,
    issue_count: issues.length,
    issues,
  });
  const authoring = shape.authoring ?? "failed";
  return {
    schema: layer(shape.schema ?? "passed"),
    authoring_evidence: layer(
      authoring,
      authoring === "failed" ? [{ path: "annual", code, message: "gap" }] : [],
    ),
    content: layer(shape.content ?? "passed"),
    multilingual: layer(shape.multilingual ?? "passed"),
  };
}

function admission(overrides: Json = {}): Json {
  return {
    schema: "dataset-draft-repair-admission.v1",
    status: "admitted",
    policy: "process-metadata-unknown-annual.v1",
    before_sha256: beforeSha,
    desired_sha256: desiredSha,
    changed_paths: ["processDataSet.modellingAndValidation...shortDescription.0.#text"],
    publication_ready: false,
    ...overrides,
  };
}

function row(overrides: Json = {}, validation: Json = {}): Json {
  return {
    index: 0,
    type: "process",
    table: "processes",
    id: processId,
    version,
    action_id: "repair-1",
    desired_sha256: desiredSha,
    status: "prepared",
    operation: "would_sync",
    readback: "not_performed",
    visible_row: { id: processId, version, user_id: expectation.owner_user_id, state_code: 0 },
    attempt_consumed: false,
    replayed: false,
    validation: {
      ok: false,
      payload_sha256: desiredSha,
      validation_layers: layers(),
      ...validation,
    },
    draft_repair_admission: admission(),
    ...overrides,
  };
}

function dryRun(overrides: Json = {}, rowOverrides: Json = {}, validation: Json = {}): Json {
  return {
    schema_version: 2,
    requested_type: "process",
    mode: "dry_run",
    commit: false,
    status: "completed",
    counts: {
      selected: 1,
      prepared: 1,
      executed: 0,
      failed: 0,
      blocked: 0,
      unknown: 0,
      attempts_consumed: 0,
    },
    execution_contract: {
      sha256: contractSha,
      execution_id: "repair-exec-1",
      target_mode: "owner_draft",
    },
    rows: [row(rowOverrides, validation)],
    ...overrides,
  };
}

const rejects = (code: string) => (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === code,
  );

test("repair preflight accepts the captured CLI wire shape", () => {
  // Captured from the installed CLI 9484fae real-case preflight; identities, hashes and paths anonymized.
  const report = JSON.parse(
    fs.readFileSync(new URL("../fixtures/repair-cli-dry-run.json", import.meta.url), "utf8"),
  );
  const parsed = parseFoundryRepairDryRunReport(report, expectation);
  assert.equal(parsed.rows[0].admission?.publication_ready, false);
  assert.equal(parsed.rows[0].desired_sha256, desiredSha);
});

test("an admitted unknown-annual metadata repair is accepted without claiming readiness", () => {
  const evidence = parseFoundryRepairDryRunReport(dryRun(), expectation);
  assert.equal(evidence.mode, "dry_run");
  assert.equal(evidence.commit, false);
  assert.equal(evidence.rows.length, 1);
  const parsed = evidence.rows[0];
  assert.equal(parsed.admission?.publication_ready, false);
  assert.equal(parsed.admission?.policy, "process-metadata-unknown-annual.v1");
  assert.equal(parsed.validation_payload_sha256, desiredSha);
  // The row keeps its truthful failing validation and authoring layer.
  assert.equal((parsed.validation_layers.authoring_evidence as Json).status, "failed");
});

test("a fully valid row needs no repair admission and must not carry one", () => {
  const valid = dryRun(
    {},
    {
      draft_repair_admission: undefined,
      validation: {
        ok: true,
        payload_sha256: desiredSha,
        validation_layers: layers({ authoring: "passed" }),
      },
    },
  );
  const evidence = parseFoundryRepairDryRunReport(valid, expectation);
  assert.equal(evidence.rows[0].admission, null);
});

test("preflight binds the fresh visible owner draft and every passing validation layer", () => {
  for (const visible of [
    undefined,
    { id: processId, version, user_id: "other", state_code: 0 },
    { id: processId, version, user_id: expectation.owner_user_id, state_code: 100 },
    { id: processId, version: "02.00.000", user_id: expectation.owner_user_id, state_code: 0 },
  ]) {
    assert.throws(
      () => parseFoundryRepairDryRunReport(dryRun({}, { visible_row: visible }), expectation),
      rejects("repair_dry_run_invalid"),
    );
  }
  for (const failed of ["schema", "content", "multilingual"] as const) {
    const value = dryRun(
      {},
      { draft_repair_admission: undefined },
      {
        ok: true,
        validation_layers: layers({ authoring: "passed", [failed]: "failed" }),
      },
    );
    assert.throws(
      () => parseFoundryRepairDryRunReport(value, expectation),
      rejects("repair_dry_run_invalid"),
    );
  }
});

test("a claimed readiness, wrong mode or dispatched preflight is refused", () => {
  assert.throws(
    () => parseFoundryRepairDryRunReport(dryRun({ mode: "commit" }), expectation),
    rejects("repair_dry_run_invalid"),
  );
  assert.throws(
    () => parseFoundryRepairDryRunReport(dryRun({ commit: true }), expectation),
    rejects("repair_dry_run_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({
          counts: {
            selected: 1,
            prepared: 1,
            executed: 1,
            failed: 0,
            blocked: 0,
            unknown: 0,
            attempts_consumed: 0,
          },
        }),
        expectation,
      ),
    rejects("repair_dry_run_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({
          counts: {
            selected: 1,
            prepared: 1,
            executed: 0,
            failed: 0,
            blocked: 0,
            unknown: 0,
            attempts_consumed: 1,
          },
        }),
        expectation,
      ),
    rejects("repair_dry_run_invalid"),
  );
  assert.throws(
    () => parseFoundryRepairDryRunReport(dryRun({}, { attempt_consumed: true }), expectation),
    rejects("repair_dry_run_invalid"),
  );
});

test("contract, execution id, action identity and row order must match exactly", () => {
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({ execution_contract: { sha256: "d".repeat(64), execution_id: "repair-exec-1" } }),
        expectation,
      ),
    rejects("repair_dry_run_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({ execution_contract: { sha256: contractSha, execution_id: "other" } }),
        expectation,
      ),
    rejects("repair_dry_run_invalid"),
  );
  for (const override of [
    { action_id: "other" },
    { id: "33333333-3333-4333-8333-333333333333" },
    { version: "02.00.000" },
    { desired_sha256: "e".repeat(64) },
    { index: 1 },
    { status: "blocked" },
    { replayed: true },
    { readback: "desired_exact" },
  ])
    assert.throws(
      () => parseFoundryRepairDryRunReport(dryRun({}, override), expectation),
      rejects("repair_dry_run_invalid"),
      `row override ${JSON.stringify(override)} must be refused`,
    );
});

test("the validation payload hash and layer truthfulness are enforced", () => {
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({}, {}, { payload_sha256: "f".repeat(64) }),
        expectation,
      ),
    rejects("repair_dry_run_invalid"),
  );
  // A schema gap can never ride the annual exception.
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({}, {}, { validation_layers: layers({ schema: "failed" }) }),
        expectation,
      ),
    rejects("repair_evidence_invalid"),
  );
  // A second authoring code is not the unknown-annual gap.
  assert.throws(
    () =>
      parseFoundryRepairDryRunReport(
        dryRun({}, {}, { validation_layers: layers({}, "placeholder_text") }),
        expectation,
      ),
    rejects("repair_evidence_invalid"),
  );
  // An admitted row must not claim a passing validation.
  assert.throws(
    () => parseFoundryRepairDryRunReport(dryRun({}, {}, { ok: true }), expectation),
    rejects("repair_dry_run_invalid"),
  );
});

test("draft repair admissions are bound to seven exact fields and the admitted content", () => {
  for (const bad of [
    admission({ publication_ready: true }),
    admission({ policy: "other-policy.v1" }),
    admission({ status: "rejected" }),
    admission({ before_sha256: "9".repeat(64) }),
    admission({ desired_sha256: "9".repeat(64) }),
    admission({ changed_paths: [] }),
    admission({ changed_paths: "not-an-array" }),
    admission({ extra: true }),
  ])
    assert.throws(
      () =>
        parseFoundryRepairDryRunReport(dryRun({}, { draft_repair_admission: bad }), expectation),
      rejects("repair_admission_invalid"),
      `admission ${JSON.stringify(bad).slice(0, 60)} must be refused`,
    );
});

function validateReport(layerShape: Json, payloadSha256 = desiredSha): Json {
  return {
    schema_version: 2,
    status: "completed_with_failures",
    counts: { rows: 1 },
    rows: [{ index: 0, payload_sha256: payloadSha256, validation_layers: layerShape }],
  };
}

test("the no-change proof accepts only three passed layers with at most the annual gap", () => {
  const accepted = parseFoundryRepairValidateReport(validateReport(layers()), expectation);
  assert.equal(accepted.payload_sha256, desiredSha);
  // Authoring fully passed is also admissible (a valid row with no change).
  parseFoundryRepairValidateReport(validateReport(layers({ authoring: "passed" })), expectation);
  assert.throws(
    () =>
      parseFoundryRepairValidateReport(validateReport(layers({ content: "failed" })), expectation),
    rejects("repair_validate_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairValidateReport(validateReport(layers({}, "placeholder_text")), expectation),
    rejects("repair_validate_invalid"),
  );
  assert.throws(
    () => parseFoundryRepairValidateReport(validateReport(layers(), "f".repeat(64)), expectation),
    rejects("repair_validate_invalid"),
  );
});

function remoteReport(counts: Json = {}, status = "passed_remote_verification"): Json {
  return {
    schema_version: 1,
    status,
    root_policy: "existing",
    counts: {
      rows: 1,
      references: 3,
      checked: 4,
      blockers: 0,
      root_readback_checks: 1,
      root_payload_mismatches: 0,
      by_status: { ok: 4 },
      ...counts,
    },
    blockers: [],
  };
}

test("the remote no-change readback must be fully passed and exact", () => {
  const counts = parseFoundryRepairRemoteReport(remoteReport(), expectation);
  assert.equal(counts.rows, 1);
  assert.equal(counts.references, 3);
  assert.throws(
    () =>
      parseFoundryRepairRemoteReport(remoteReport({}, "blocked_remote_verification"), expectation),
    rejects("repair_remote_invalid"),
  );
  assert.throws(
    () => parseFoundryRepairRemoteReport(remoteReport({ blockers: 1 }), expectation),
    rejects("repair_remote_invalid"),
  );
  assert.throws(
    () => parseFoundryRepairRemoteReport(remoteReport({ root_payload_mismatches: 1 }), expectation),
    rejects("repair_remote_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairRemoteReport(
        remoteReport({ root_readback_checks: undefined }),
        expectation,
      ),
    rejects("repair_remote_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairRemoteReport(
        remoteReport({ by_status: { ok: 3, payload_mismatch: 1 } }),
        expectation,
      ),
    rejects("repair_remote_invalid"),
  );
  assert.throws(
    () => parseFoundryRepairRemoteReport(remoteReport({ rows: 0 }), expectation),
    rejects("repair_remote_invalid"),
  );
  assert.throws(
    () =>
      parseFoundryRepairRemoteReport({ ...remoteReport(), root_policy: "candidate" }, expectation),
    rejects("repair_remote_invalid"),
  );
});

test("no-op evidence requires every exact root readback and consistent totals", () => {
  for (const change of [
    { root_readback_checks: 0 },
    { rows: 2 },
    { references: 0 },
    { checked: 1 },
    { by_status: { ok: 1 } },
  ])
    assert.throws(
      () => parseFoundryRepairRemoteReport(remoteReport(change), expectation),
      rejects("repair_remote_invalid"),
    );
  assert.throws(
    () =>
      parseFoundryRepairRemoteReport(
        { ...remoteReport(), blockers: [{ code: "unresolved" }] },
        expectation,
      ),
    rejects("repair_remote_invalid"),
  );
});
