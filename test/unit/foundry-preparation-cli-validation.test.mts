import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import {
  parseFoundryPreparationCliReport,
  preparationValidationActions,
} from "../../scripts/lib/foundry-preparation-cli-validation.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;
function fixture() {
  const source = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  ) as { payload: Json; context: { flow_documents: Json[] } };
  const payload = source.payload;
  const root = object(payload.processDataSet);
  const id = object(object(root.processInformation).dataSetInformation)["common:UUID"];
  const version = object(object(root.administrativeInformation).publicationAndOwnership)[
    "common:dataSetVersion"
  ];
  const outDir = path.resolve("synthetic-validation");
  const input = path.resolve("synthetic-process.rows.json");
  const layers: Json = Object.fromEntries(
    ["schema", "authoring_evidence", "content", "multilingual"].map((name) => [
      name,
      { status: "passed", issues: [], issue_count: 0 },
    ]),
  );
  const flow = object(source.context.flow_documents[0].flowDataSet);
  const flowId = object(object(flow.flowInformation).dataSetInformation)["common:UUID"];
  const flowVersion = object(object(flow.administrativeInformation).publicationAndOwnership)[
    "common:dataSetVersion"
  ];
  const row: Json = {
    index: 0,
    id,
    version,
    type: "process",
    status: "valid",
    issue_count: 0,
    issues: [],
    payload_sha256: sha256Json(payload),
    validation_layers: layers,
    allocation_semantics: {
      profile: "tidas.process-allocation-reference.v1",
      tolerance: 0.0010000001,
      candidate_sha256: sha256Json(payload),
      options_sha256: sha256Json({
        profile: "tidas.process-allocation-reference.v1",
        tolerance: 0.0010000001,
      }),
      status: "passed",
      issue_count: 0,
      issues: [],
      coverage: [
        "allocation-fraction",
        "allocation-target",
        "allocation-target-direction",
        "allocation-target-type",
        "allocation-vector",
        "exchange-identity",
        "quantitative-reference",
      ].map((check) => ({ check, status: "passed", path: [] })),
      dependencies: [
        {
          uuid: flowId,
          version: flowVersion,
          content_sha256: sha256Json(source.context.flow_documents[0]),
        },
      ],
    },
  };
  const report: Json = {
    input_path: input,
    requested_type: "process",
    status: "completed",
    counts: { total: 1, valid: 1, invalid: 0, by_type: { process: 1 } },
    files: { report: path.join(outDir, "outputs", "validation-report.json") },
    rows: [row],
  };
  return {
    report,
    input,
    outDir,
    rows: [{ json_ordered: payload, semantic_context: source.context }],
    exit: 0,
    row,
    layers,
  };
}

test("preparation retains the complete owning report and exact candidate/Flow evidence", () => {
  const f = fixture();
  const result = parseFoundryPreparationCliReport(f);
  assert.deepEqual(result, [f.row]);
  assert.deepEqual(preparationValidationActions(result[0]), []);
});

test("owner annual finding becomes existing bounded field authoring with truthful layers", () => {
  const f = fixture();
  const issue = {
    code: "annual_supply_or_production_volume_not_annualized",
    path: "processDataSet.processInformation.time.annualSupplyOrProductionVolume",
    message: "Annual evidence needs its source-backed period.",
  };
  f.layers.authoring_evidence = { status: "failed", issue_count: 1, issues: [issue] };
  Object.assign(f.row, { status: "invalid", issue_count: 1, issues: [issue] });
  Object.assign(f.report, {
    status: "completed_with_failures",
    counts: { total: 1, valid: 0, invalid: 1, by_type: { process: 1 } },
  });
  f.exit = 1;
  const actions = preparationValidationActions(parseFoundryPreparationCliReport(f)[0]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].code, issue.code);
  assert.equal(actions[0].action_kind, "ai_authoring");
  assert.equal(actions[0].path, issue.path);
  assert.equal(object(actions[0].evidence).candidate_sha256, f.row.payload_sha256);
  assert.match(String(actions[0].instruction), /source evidence/u);
});

for (const [name, change] of [
  [
    "candidate hash",
    (f: ReturnType<typeof fixture>) => {
      f.row.payload_sha256 = "0".repeat(64);
    },
  ],
  [
    "semantic candidate hash",
    (f: ReturnType<typeof fixture>) => {
      object(f.row.allocation_semantics).candidate_sha256 = "0".repeat(64);
    },
  ],
  [
    "dependency hash",
    (f: ReturnType<typeof fixture>) => {
      object((object(f.row.allocation_semantics).dependencies as Json[])[0]).content_sha256 =
        "0".repeat(64);
    },
  ],
  [
    "missing layer",
    (f: ReturnType<typeof fixture>) => {
      delete f.layers.content;
    },
  ],
  [
    "passed layer with finding",
    (f: ReturnType<typeof fixture>) => {
      object(f.layers.content).issues = [{ code: "bad", path: "x", message: "bad" }];
    },
  ],
  [
    "row order",
    (f: ReturnType<typeof fixture>) => {
      f.row.index = 1;
    },
  ],
  [
    "wrong identity",
    (f: ReturnType<typeof fixture>) => {
      f.row.id = "other";
    },
  ],
  [
    "wrong output",
    (f: ReturnType<typeof fixture>) => {
      object(f.report.files).report = path.resolve("foreign.json");
    },
  ],
  [
    "forged exit",
    (f: ReturnType<typeof fixture>) => {
      f.exit = 1;
    },
  ],
] as const) {
  test(`preparation refuses stale or malformed ${name}`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => parseFoundryPreparationCliReport(f), /validation/iu);
  });
}

test("missing or malformed Process identity remains the owner schema finding rather than transport rejection", () => {
  const f = fixture();
  const root = object(object(f.rows[0]).json_ordered);
  const process = object(root.processDataSet);
  delete object(object(process.processInformation).dataSetInformation)["common:UUID"];
  delete object(object(process.administrativeInformation).publicationAndOwnership)[
    "common:dataSetVersion"
  ];
  f.row.id = null;
  f.row.version = null;
  f.row.payload_sha256 = sha256Json(root);
  object(f.row.allocation_semantics).candidate_sha256 = sha256Json(root);
  const finding = {
    code: "invalid_type",
    path: "processDataSet.processInformation.dataSetInformation.common:UUID",
    message: "Required",
  };
  f.layers.schema = { status: "failed", issues: [finding], issue_count: 1 };
  f.row.issues = [finding];
  f.row.issue_count = 1;
  f.row.status = "invalid";
  f.report.status = "completed_with_failures";
  f.report.counts = { total: 1, valid: 0, invalid: 1, by_type: { process: 1 } };
  f.exit = 1;
  assert.deepEqual(parseFoundryPreparationCliReport(f), [f.row]);
});

for (const [name, change] of [
  [
    "unresolved coverage cannot be passed",
    (s: Json) => {
      (s.coverage as Json[])[0].status = "unresolved";
    },
  ],
  [
    "required coverage cannot be omitted",
    (s: Json) => {
      s.coverage = [];
    },
  ],
] as const)
  test(name, () => {
    const f = fixture();
    change(object(f.row.allocation_semantics));
    assert.throws(
      () => parseFoundryPreparationCliReport(f),
      /workflow_validation_invalid|Owner CLI validation/,
    );
  });

test("nested payload context does not supply dependency bindings absent from the original row context", () => {
  const f = fixture();
  const wrapper = object(f.rows[0]);
  const payload = object(wrapper.json_ordered);
  payload.semantic_context = wrapper.semantic_context;
  delete wrapper.semantic_context;
  const candidate = sha256Json(payload);
  f.row.payload_sha256 = candidate;
  object(f.row.allocation_semantics).candidate_sha256 = candidate;
  assert.throws(() => parseFoundryPreparationCliReport(f), /Owner CLI validation/);
});

// SDK 0.5.1 core/validation/process-semantics emits only applicable checks.
for (const mode of ["undeclared", "legacy-scalar-empty", "legacy-targetless-full"]) {
  test(`preparation retains applicable coverage for ${mode}`, () => {
    const f = fixture();
    const semantics = object(f.row.allocation_semantics);
    semantics.coverage = (semantics.coverage as Json[]).filter((entry) =>
      [
        "exchange-identity",
        "quantitative-reference",
        "allocation-vector",
        "allocation-target-type",
      ].includes(String(entry.check)),
    );
    if (mode === "legacy-targetless-full")
      (semantics.coverage as Json[]).push({
        check: "allocation-legacy",
        status: "passed",
        path: [],
      });
    assert.deepEqual(parseFoundryPreparationCliReport(f), [f.row]);
  });
}
