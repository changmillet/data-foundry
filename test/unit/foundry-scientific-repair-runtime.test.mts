import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureFoundryInput } from "../../src/lib/foundry-runtime-context.ts";
import {
  runScientificRepairDiagnostic,
  type ScientificRepairEvidence,
} from "../../src/lib/foundry-scientific-repair.ts";

// This exercises the native producer contract and refusal paths. Scientific schema/QA/curation
// qualification is exercised separately with explicitly deployed native Worker and TIDAS binaries.
test("synthetic Worker producer contract retains exact reviewed bytes and refuses unsafe readiness or operation counts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-science-runtime-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name: string, value: unknown) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return captureFoundryInput(file);
  };
  const executable = write("synthetic-worker", { fixture: "native producer transport contract" });
  const workerInput = write("worker-input.json", {
    schema_version: "worker.provider-impact.input.v1",
    mode: "matrix_only",
    expected_worker_sha256: executable.sha256,
  });
  const report = {
    schema_version: "worker.provider-impact.report.v1",
    mode: "matrix_only",
    status: "diagnostic_complete",
    input_sha256: workerInput.sha256,
    runtime: { worker_binary_sha256: executable.sha256 },
    operation_counts: {
      matrix_assemblies: 2,
      factorizations: 0,
      unit_solves: 0,
      database_queries: 0,
      queue_writes: 0,
      object_store_operations: 0,
    },
    scope: {
      kind: "supplied_finite_universe",
      frozen_selection_contract: "worker.provider-impact.frozen-census.v1",
      online_census_verified: false,
      online_effective_selection_verified: false,
      scientific_qualified: false,
      save_admitted: false,
      publication_qualified: false,
    },
    after: { readiness: { blockers: [] as unknown[] }, unresolved_balances: [] as unknown[] },
  };
  const workerReport = write("reviewed-report.json", report);
  const inert = write("inert-evidence.json", { fixture: true });
  const evidence: ScientificRepairEvidence = {
    schema: "tiangong-foundry.scientific-repair-evidence.v1",
    descriptor: inert,
    worker_input: workerInput,
    worker_report: workerReport,
    changes: inert,
    review: inert,
    sources: [inert],
    runtime: { configuration: inert, executable },
  };
  let emitted: unknown = report;
  t.mock.method(childProcess, "spawnSync", (command: string, argv: readonly string[]) => {
    assert.equal(command, evidence.runtime.executable.path);
    assert.equal(argv[argv.indexOf("--provider-impact-input") + 1], workerInput.path);
    assert.equal(argv[argv.indexOf("--provider-impact-input-sha256") + 1], workerInput.sha256);
    fs.writeFileSync(argv[argv.indexOf("--provider-impact-out") + 1], JSON.stringify(emitted));
    return { status: 0, signal: null, stdout: "", stderr: "", pid: 1, output: [] };
  });
  const run = (selected: ScientificRepairEvidence, name: string) => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    return runScientificRepairDiagnostic(selected, directory);
  };
  assert.deepEqual(run(evidence, "positive"), report);
  for (const mutation of [
    "database-query",
    "blocked",
    "unresolved",
    "online-claim",
    "raw-drift",
    "legacy-contract",
  ]) {
    const changed = structuredClone(report);
    if (mutation === "database-query") changed.operation_counts.database_queries = 1;
    if (mutation === "blocked")
      changed.after.readiness.blockers = [{ code: "fixture_missing_provider" }];
    if (mutation === "unresolved") changed.after.unresolved_balances = [{ flow: "fixture" }];
    if (mutation === "online-claim") changed.scope.online_census_verified = true;
    if (mutation === "legacy-contract")
      changed.scope.frozen_selection_contract = "legacy-unqualified-prototype";
    const reviewed = write(`reviewed-${mutation}.json`, changed);
    emitted = mutation === "raw-drift" ? { ...changed, unreviewed: true } : changed;
    assert.throws(
      () => run({ ...evidence, worker_report: reviewed }, mutation),
      { code: "repair_scientific_evidence_invalid" },
      mutation,
    );
  }
});
