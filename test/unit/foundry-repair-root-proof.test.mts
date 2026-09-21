import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertFoundryRepairRootProof,
  type FoundryRepairExpectation,
} from "../../scripts/lib/foundry-repair-preflight.ts";
const expectation: FoundryRepairExpectation = {
  dataset_type: "process",
  contract_sha256: "a".repeat(64),
  execution_id: "test",
  owner_user_id: "owner",
  project_ref: "project",
  state_code: "0",
  actions: [
    {
      action_id: "a",
      table: "processes",
      id: "id",
      version: "00.00.001",
      before_sha256: "b".repeat(64),
      desired_sha256: "c".repeat(64),
    },
  ],
};
const report = {
  status: "passed_remote_verification",
  root_policy: "existing",
  counts: {
    rows: 1,
    references: 1,
    checked: 2,
    root_readback_checks: 1,
    root_payload_mismatches: 0,
    blockers: 0,
    by_status: { ok: 2 },
  },
  blockers: [],
};
function checks() {
  return [
    { role: "root", path: "processDataSet", status: "ok" },
    {
      role: "root",
      path: "processDataSet#readback",
      row_index: 0,
      table: "processes",
      id: "id",
      version: "00.00.001",
      status: "ok",
      remote_user_id: "owner",
      remote_state_code: 0,
      local_payload_sha256: "b".repeat(64),
      remote_payload_sha256: "b".repeat(64),
    },
  ];
}
test("repair root proof binds before content separately from candidate content", () => {
  assert.doesNotThrow(() => assertFoundryRepairRootProof(report, checks(), expectation, "before"));
  assert.throws(
    () => assertFoundryRepairRootProof(report, checks(), expectation, "candidate"),
    /payload_mismatch/,
  );
});
test("green summary never replaces exact owner, state, payload, unique root and record count proofs", () => {
  for (const delta of [
    { remote_user_id: "other" },
    { remote_state_code: 100 },
    { remote_payload_sha256: "c".repeat(64) },
    { row_index: 2 },
    { role: "reference" },
    { path: "processDataSet" },
    { id: "another" },
    { status: "missing" },
  ]) {
    const changed = checks();
    Object.assign(changed[1], delta);
    assert.throws(() => assertFoundryRepairRootProof(report, changed, expectation, "before"));
  }
  assert.throws(() => assertFoundryRepairRootProof(report, [], expectation, "before"));
  assert.throws(
    () => assertFoundryRepairRootProof(report, [checks()[1], checks()[1]], expectation, "before"),
    /duplicate/,
  );
  const bad = structuredClone(report);
  bad.counts.references = 2;
  assert.throws(() => assertFoundryRepairRootProof(bad, checks(), expectation, "before"));
});
