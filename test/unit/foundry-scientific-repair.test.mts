import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  readScientificRepairEvidence,
  readScientificRepairRuntime,
  scientificRepairChanges,
  assertScientificRepairDiagnosticReport,
} from "../../src/lib/foundry-scientific-repair.ts";
import { captureFoundryInput } from "../../src/lib/foundry-runtime-context.ts";
import { sha256Json } from "../../src/lib/identity-preflight-proof.ts";

type Json = Record<string, unknown>;
const actor = "agent/scientific-author";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const version = "01.00.000";
const pointer = "/processDataSet/exchanges/exchange/0/meanAmount";

function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-science-evidence-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(root, "host-config");
  t.after(() => {
    if (prior === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prior;
  });
  fs.mkdirSync(path.join(process.env.XDG_CONFIG_HOME, "tiangong-foundry"), { recursive: true });
  const executable = path.join(root, "trusted-worker");
  fs.writeFileSync(executable, "native provider-impact fixture bytes\n");
  const write = (name: string, value: unknown) => {
    const file = path.join(root, "inputs", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value) + "\n");
    return file;
  };
  const config = path.join(
    process.env.XDG_CONFIG_HOME,
    "tiangong-foundry",
    "provider-impact-runtime.json",
  );
  fs.writeFileSync(
    config,
    JSON.stringify({
      schema: "tiangong-foundry.provider-impact-runtime.v1",
      executable,
      sha256: captureFoundryInput(executable).sha256,
    }),
  );
  const before = {
    processDataSet: {
      processInformation: { dataSetInformation: { "common:UUID": id } },
      administrativeInformation: { publicationAndOwnership: { "common:dataSetVersion": version } },
      exchanges: { exchange: [{ meanAmount: "1.5" }] },
    },
  };
  const candidate = structuredClone(before);
  candidate.processDataSet.exchanges.exchange[0].meanAmount = "2.5";
  const beforeFile = write("before.jsonl", before),
    candidateFile = write("candidate.jsonl", candidate);
  const source = write("source.json", { observation: "The process consumes 2.5 kg of input." });
  const workerInput = write("worker-input.json", {
    schema_version: "worker.provider-impact.input.v1",
    mode: "matrix_only",
    expected_worker_sha256: captureFoundryInput(executable).sha256,
    baseline: {
      actor_user_id: owner,
      documents: [
        {
          identity: { dataset_type: "process", id, version },
          state_code: 0,
          user_id: owner,
          document: before,
        },
      ],
    },
    overlays: [{ identity: { dataset_type: "process", id, version }, document: candidate }],
  });
  // Source review covers a report file. Actual preparation independently invokes the trusted native
  // producer and requires identical complete bytes before any readiness claim can be made.
  const workerReport = write("worker-report.json", {
    fixture: "independently reviewed native evidence",
  });
  const changes = write("changes.json", {
    schema: "tiangong-foundry.scientific-repair-changes.v1",
    changes: [
      {
        id,
        version,
        path: pointer,
        before_sha256: sha256Json({ present: true, value: "1.5" }),
        after_sha256: sha256Json({ present: true, value: "2.5" }),
        basis: "Use the measured input quantity.",
        evidence: [
          {
            source,
            source_sha256: captureFoundryInput(source).sha256,
            quote: "The process consumes 2.5 kg of input.",
          },
        ],
      },
    ],
  });
  const artifacts = new Map([
    ["before", beforeFile],
    ["candidate", candidateFile],
    ["worker_input", workerInput],
    ["worker_report", workerReport],
    ["changes", changes],
    ["source_0", source],
  ]);
  const review = write("review.json", {
    reviewer_id: "reviewer/science",
    scope: "scientific-content-and-provider-impact",
    status: "PASS",
    findings: { p0: 0, p1: 0 },
    reviewed_artifacts: [...artifacts].map(([artifact_id, file]) => {
      const fact = captureFoundryInput(file);
      return { artifact_id, bytes: fact.bytes, sha256: fact.sha256 };
    }),
  });
  const ref = (file: string) => ({ file, sha256: captureFoundryInput(file).sha256 });
  const descriptorFile = write("scientific.json", {
    schema: "tiangong-foundry.scientific-repair.v1",
    author_id: actor,
    worker_input: ref(workerInput),
    worker_report: ref(workerReport),
    changes: ref(changes),
    sources: [ref(source)],
    review: ref(review),
  });
  const selectedFiles = [
    beforeFile,
    candidateFile,
    workerInput,
    workerReport,
    changes,
    source,
    review,
    descriptorFile,
  ];
  const options = {
    descriptorFile,
    beforeFile,
    candidateFile,
    actorId: actor,
    userId: owner,
    selectedFiles,
    excludedRuntimeRoots: [path.join(root, "project"), path.join(root, "cache"), ...selectedFiles],
    read: (file: string) => fs.readFileSync(file),
  };
  const update = (file: string, mutate: (value: Json) => void) => {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(value);
    fs.writeFileSync(file, JSON.stringify(value) + "\n");
  };
  const refresh = (key: string, file: string) =>
    update(descriptorFile, (value) => {
      value[key] = ref(file);
    });
  return {
    root,
    config,
    executable,
    options,
    descriptorFile,
    source,
    changes,
    review,
    workerInput,
    update,
    refresh,
  };
}

test("scientific source evidence binds every field, selected source and independently reviewed native inputs", (t) => {
  const f = fixture(t);
  const evidence = readScientificRepairEvidence(f.options);
  assert.equal(evidence.runtime.executable.sha256, captureFoundryInput(f.executable).sha256);
  assert.equal(evidence.worker_input.path, f.workerInput);
  assert.equal(evidence.sources[0].path, f.source);
});

test("scientific repair rejects omitted fields, source drift and self-review before execution", (t) => {
  const f = fixture(t);
  f.update(f.review, (value) => {
    value.reviewer_id = actor;
  });
  f.refresh("review", f.review);
  assert.throws(() => readScientificRepairEvidence(f.options), /Independent scientific review/u);
  f.update(f.review, (value) => {
    value.reviewer_id = "reviewer/science";
  });
  f.refresh("review", f.review);
  f.update(f.changes, (value) => {
    value.changes = [];
  });
  f.refresh("changes", f.changes);
  assert.throws(() => readScientificRepairEvidence(f.options), /omits changed values/u);
  fs.appendFileSync(f.source, "changed source\n");
  assert.throws(() => readScientificRepairEvidence(f.options), /selected bytes changed/u);
});

test("scientific repair rejects unselected evidence and candidate overlays outside the exact scope", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      readScientificRepairEvidence({
        ...f.options,
        selectedFiles: f.options.selectedFiles.filter((file) => file !== f.source),
      }),
    /independently selected task source/u,
  );
  f.update(f.workerInput, (value) => {
    (value.overlays as Json[])[0].document = { wrong: "candidate" };
  });
  f.refresh("worker_input", f.workerInput);
  assert.throws(
    () => readScientificRepairEvidence(f.options),
    /complete exact selected owner draft bodies/u,
  );
});

test("scientific source traces must resolve to actual quote bytes or a bound located value", (t) => {
  const f = fixture(t);
  f.update(f.changes, (value) => {
    ((value.changes as Json[])[0].evidence as Json[])[0].quote = "Unobserved invented quantity.";
  });
  f.refresh("changes", f.changes);
  assert.throws(
    () => readScientificRepairEvidence(f.options),
    /quote present in the selected source bytes/u,
  );
  f.update(f.changes, (value) => {
    const evidence = ((value.changes as Json[])[0].evidence as Json[])[0];
    delete evidence.quote;
    evidence.path = "/missing";
    evidence.value_sha256 = sha256Json({ present: true, value: "pretend" });
  });
  f.refresh("changes", f.changes);
  assert.throws(
    () => readScientificRepairEvidence(f.options),
    /exact JSON Pointer with its located-value hash/u,
  );
});

test("scientific source JSON locators are accepted only with the reviewed located-value binding", (t) => {
  const f = fixture(t);
  const value = JSON.parse(fs.readFileSync(f.source, "utf8")).observation;
  f.update(f.changes, (ledger) => {
    ((ledger.changes as Json[])[0].evidence as Json[])[0] = {
      source: f.source,
      source_sha256: captureFoundryInput(f.source).sha256,
      path: "/observation",
      value_sha256: sha256Json({ present: true, value }),
    };
  });
  f.refresh("changes", f.changes);
  f.update(f.review, (review) => {
    const binding = (review.reviewed_artifacts as Json[]).find(
      (entry) => entry.artifact_id === "changes",
    )!;
    const fact = captureFoundryInput(f.changes);
    binding.sha256 = fact.sha256;
    binding.bytes = fact.bytes;
  });
  f.refresh("review", f.review);
  assert.doesNotThrow(() => readScientificRepairEvidence(f.options));
});

test("provider-impact execution trust comes from a host configuration outside task inputs", (t) => {
  const f = fixture(t);
  assert.throws(() => readScientificRepairRuntime([f.root]), /outside task, workspace and cache/u);
  fs.appendFileSync(f.executable, "drift\n");
  assert.throws(
    () => readScientificRepairRuntime(f.options.excludedRuntimeRoots),
    /differs from its trusted deployment binding/u,
  );
});

test("scientific repair rejects a historical native report without frozen-census selection qualification", (t) => {
  const f = fixture(t);
  const evidence = readScientificRepairEvidence(f.options);
  const report = {
    schema_version: "worker.provider-impact.report.v1",
    mode: "matrix_only",
    status: "diagnostic_complete",
    input_sha256: evidence.worker_input.sha256,
    runtime: { worker_binary_sha256: evidence.runtime.executable.sha256 },
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
    after: { readiness: { blockers: [] }, unresolved_balances: [] },
  };
  assert.doesNotThrow(() => assertScientificRepairDiagnosticReport(report, evidence));
  const historical = structuredClone(report);
  delete (historical.scope as Partial<typeof historical.scope>).frozen_selection_contract;
  assert.throws(
    () => assertScientificRepairDiagnosticReport(historical, evidence),
    /exact matrix-only output/u,
  );
});

test("scientific field coverage preserves escaped pointers, absent/null distinctions and array boundaries", () => {
  assert.deepEqual(scientificRepairChanges({ "a/b": 1 }, { "a/b": 2 }), ["/a~1b"]);
  assert.deepEqual(scientificRepairChanges({ a: null }, {}), ["/a"]);
  assert.deepEqual(scientificRepairChanges({ a: [1] }, { a: [1, 2] }), ["/a/1"]);
});
