import test from "node:test";
import {
  bafuBatchImportRunTestHooks,
  createBafuBatchImportRunCommands,
  filterAuthoringTaskManifestToRows,
} from "../../scripts/commands/bafu-batch-import-run.mjs";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";

const fixtureRoot = testTmpRoot("bafu-batch-import-run-test");
const processId = "11111111-2222-4333-8444-555555555555";

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  if (typeof value === "object") return textValue(value["#text"] ?? value.value ?? value.id);
  return "";
}

function datasetIdentity(row, type) {
  const root = row?.[`${type}DataSet`] ?? {};
  const information =
    root?.[`${type}Information`]?.dataSetInformation ??
    root?.[`${type}Information`]?.["common:dataSetInformation"] ??
    {};
  const publication =
    root?.administrativeInformation?.publicationAndOwnership ??
    root?.administrativeInformation?.["common:publicationAndOwnership"] ??
    {};
  return {
    id: textValue(information["common:UUID"]),
    version: textValue(publication["common:dataSetVersion"]),
  };
}

createBafuBatchImportRunCommands({
  asText: textValue,
  booleanOption: (value) => value === true || value === "true",
  datasetIdentity,
  directoryExists: (filePath) =>
    Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory(),
  fileExists: (filePath) =>
    Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  integerOption: (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  normalizedList: (value) =>
    value == null
      ? []
      : (Array.isArray(value) ? value : String(value).split(","))
          .map((entry) => String(entry).trim())
          .filter(Boolean),
  nowIso: () => "2026-01-01T00:00:00.000Z",
  readJson,
  readJsonLines: (filePath) => (fs.existsSync(filePath) ? readJsonLines(filePath) : []),
  repoRelativeMaybe: (filePath) => (filePath ? rel(filePath) : null),
  resolveRepoPath: (filePath) =>
    filePath ? (path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)) : null,
  shellQuote: (value) => {
    const text = String(value);
    return /^[A-Za-z0-9_./:=@%+-]+$/u.test(text) ? text : `'${text.replace(/'/gu, "'\\''")}'`;
  },
  writeJson,
  writeJsonLines,
});

function writeTextFile(filePath, text = "{}\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeRequiredContext(runDir, schemaDir) {
  for (const type of ["flow", "process"]) {
    writeTextFile(path.join(runDir, "context", type, "outputs", "schema.json"));
    writeTextFile(path.join(runDir, "context", type, "outputs", "runtime-ruleset.json"));
    writeTextFile(path.join(runDir, "context", type, "outputs", "methodology.yaml"), "rules: []\n");
  }
  for (const name of [
    "tidas_contacts_category.json",
    "tidas_flowproperties_category.json",
    "tidas_flows_elementary_category.json",
    "tidas_flows_product_category.json",
    "tidas_lciamethods_category.json",
    "tidas_processes_category.json",
    "tidas_sources_category.json",
    "tidas_unitgroups_category.json",
    "tidas_locations_category.json",
  ]) {
    writeTextFile(path.join(schemaDir, name));
  }
  writeJsonLines(
    path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
    [],
  );
}

function bafuFamilyProcessPayload({ id, name, location, inputAmount }) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": name },
            mixAndLocationTypes: { "@xml:lang": "en", "#text": location },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": location,
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Output",
            referenceToFlowDataSet: {
              "common:shortDescription": { "@xml:lang": "en", "#text": name },
            },
            meanAmount: "1.0",
            resultingAmount: "1.0",
            uncertaintyDistributionType: "undefined",
            dataDerivationTypeStatus: "Unknown derivation",
          },
          {
            exchangeDirection: "Input",
            referenceToFlowDataSet: {
              "common:shortDescription": {
                "@xml:lang": "en",
                "#text": `Natural gas supply {${location}}`,
              },
            },
            meanAmount: String(inputAmount),
            resultingAmount: String(inputAmount),
            uncertaintyDistributionType: "undefined",
            dataDerivationTypeStatus: "Unknown derivation",
          },
        ],
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function writeBafuFamilyBundleProcess(bundlesDir, payload) {
  const id = payload.processDataSet.processInformation.dataSetInformation["common:UUID"];
  writeJson(path.join(bundlesDir, id, "tidas", "processes", `${id}.json`), payload);
}

function coverageProcessPayload({ id, flowIds }) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          name: {
            baseName: { "@xml:lang": "en", "#text": `Process ${id}` },
          },
        },
      },
      exchanges: {
        exchange: flowIds.map((flowId, index) => ({
          exchangeDirection: index === 0 ? "Output" : "Input",
          referenceToFlowDataSet: {
            "@type": "flow data set",
            "@refObjectId": flowId,
            "@version": "00.00.001",
            "common:shortDescription": { "@xml:lang": "en", "#text": `Flow ${flowId}` },
          },
          meanAmount: "1.0",
          resultingAmount: "1.0",
        })),
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

function coverageFlowPayload({ id, typeOfDataSet = "Product flow" }) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
          typeOfDataSet,
          name: {
            baseName: { "@xml:lang": "en", "#text": `Flow ${id}` },
          },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

test("BAFU batch import runner publishes explicit commit stage contract", () => {
  const result = runFoundry(["dataset-bafu-batch-import-run", "--help"]);
  assert.equal(result.code, 0);
  assert.equal(result.json.remote_write_mode, "explicit-commit-only");
  assert.ok(Array.isArray(result.json.stage_pipeline));
  assert.deepEqual(
    result.json.stage_pipeline.map((stage) => stage.phase),
    ["prepare", "rewrite_cleanup", "gate_validate", "report"],
  );
  assert.equal(
    result.json.stage_pipeline[2].report_contract.remote_write_mode,
    "explicit-commit-only",
  );
});

test("BAFU batch import runner skips already verified scopes through resumable ledgers", () => {
  const root = path.join(fixtureRoot, "skip");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processId,
      process_version: "00.00.001",
      closure_status: "ready",
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      process_id: processId,
      process_version: "00.00.001",
      status: "verified",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "2",
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "completed");
    assert.equal(report.counts.skipped, 1);
    assert.equal(report.counts.verified, 0);
    const checkpoints = readJsonLines(path.join(repoRoot, report.files.scope_checkpoints));
    assert.equal(checkpoints.at(-1).state, "skipped_already_verified");
    assert.equal(fs.existsSync(path.join(outDir, "scopes", processId, "materialized")), false);
    const manifest = readJson(path.join(repoRoot, report.files.run_manifest));
    assert.equal(manifest.status, "completed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner skips already blocked scopes during normal resume", () => {
  const root = path.join(fixtureRoot, "skip-blocked");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processId,
      process_version: "00.00.001",
      closure_status: "ready",
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: processId,
      process_version: "00.00.001",
      stage: "flow.authoring",
      code: "bafu_name_split_unsupported",
      status: "blocked",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "2",
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "completed");
    assert.equal(report.counts.skipped_blocked, 1);
    assert.equal(report.counts.blocked, 0);
    const checkpoints = readJsonLines(path.join(repoRoot, report.files.scope_checkpoints));
    assert.equal(checkpoints.at(-1).state, "skipped_blocked_deferred");
    assert.equal(fs.existsSync(path.join(outDir, "scopes", processId, "materialized")), false);
    const blockers = readJsonLines(
      path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"),
    );
    assert.equal(blockers.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner can order selected scopes by estimated weight", () => {
  const root = path.join(fixtureRoot, "selection-order");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const processIds = [
    "11111111-2222-4333-8444-555555555551",
    "11111111-2222-4333-8444-555555555552",
    "11111111-2222-4333-8444-555555555553",
  ];
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processIds[0],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 20,
    },
    {
      schema_version: 1,
      process_id: processIds[1],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 5,
    },
    {
      schema_version: 1,
      process_id: processIds[2],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 10,
    },
  ]);
  writeJsonLines(
    path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"),
    processIds.map((id) => ({
      schema_version: 1,
      dataset_type: "process",
      dataset_id: id,
      dataset_version: "00.00.001",
      process_id: id,
      process_version: "00.00.001",
      status: "verified",
    })),
  );

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "1",
      "--selection-order",
      "estimated-weight-asc",
      "--limit",
      "2",
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "completed");
    assert.equal(report.selection.selection_order, "estimated-weight-asc");
    assert.equal(report.counts.selected_scopes, 2);
    assert.equal(report.counts.skipped, 2);
    const checkpoints = readJsonLines(path.join(repoRoot, report.files.scope_checkpoints));
    assert.deepEqual(
      checkpoints.slice(-2).map((checkpoint) => checkpoint.process_id),
      [processIds[1], processIds[2]],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner emits BAFU family signatures and can order masters before variants", () => {
  const root = path.join(fixtureRoot, "family-master-first");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const ids = [
    "11111111-2222-4333-8444-555555555581",
    "11111111-2222-4333-8444-555555555582",
    "11111111-2222-4333-8444-555555555583",
    "11111111-2222-4333-8444-555555555584",
  ];
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[0],
      name: "Natural gas, production CH, at long-distance pipeline {CH}",
      location: "CH",
      inputAmount: 5,
    }),
  );
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[1],
      name: "Natural gas, production DE, at long-distance pipeline {DE}",
      location: "DE",
      inputAmount: 5,
    }),
  );
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[2],
      name: "Heat production CH, at boiler {CH}",
      location: "CH",
      inputAmount: 2,
    }),
  );
  writeBafuFamilyBundleProcess(
    bundlesDir,
    bafuFamilyProcessPayload({
      id: ids[3],
      name: "Heat production DE, at boiler {DE}",
      location: "DE",
      inputAmount: 3,
    }),
  );
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(
    scopeFile,
    [ids[1], ids[0], ids[3], ids[2]].map((id) => ({
      schema_version: 1,
      process_id: id,
      process_version: "00.00.001",
      closure_status: "ready",
    })),
  );

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--selection-order",
      "family-master-first",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preflight_completed");
    assert.equal(result.json.selection.selection_order, "family-master-first");
    assert.equal(result.json.counts.selected_same_amount_vector_scopes, 2);
    assert.equal(result.json.counts.selected_same_skeleton_only_scopes, 2);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [ids[1], ids[3], ids[0], ids[2]],
    );
    assert.deepEqual(
      plan.map((row) => row.bafu_family_optimization_role),
      [
        "same_amount_master",
        "same_skeleton_master",
        "same_amount_variant",
        "same_skeleton_variant",
      ],
    );
    const familyReport = readJson(path.join(repoRoot, result.json.files.bafu_family_signatures));
    assert.equal(familyReport.counts.selected_scopes.same_amount_vector_scopes, 2);
    assert.equal(familyReport.counts.selected_scopes.same_skeleton_scopes, 4);
    assert.equal(familyReport.counts.selected_scopes.same_skeleton_only_scopes, 2);
    assert.equal(familyReport.entries.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner can require leaf classification decisions before selection", () => {
  const root = path.join(fixtureRoot, "leaf-classification-filter");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const ids = [
    "11111111-2222-4333-8444-555555555591",
    "11111111-2222-4333-8444-555555555592",
    "11111111-2222-4333-8444-555555555593",
  ];
  const flowIds = [
    "22222222-3333-4444-8555-666666666691",
    "22222222-3333-4444-8555-666666666692",
    "22222222-3333-4444-8555-666666666693",
  ];
  for (const [index, id] of ids.entries()) {
    writeBafuFamilyBundleProcess(
      bundlesDir,
      bafuFamilyProcessPayload({
        id,
        name: `Leaf filter sample ${index} {CH}`,
        location: "CH",
        inputAmount: index + 1,
      }),
    );
  }
  writeJsonLines(
    path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
    [
      {
        dataset_type: "process",
        dataset_id: ids[0],
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "35101",
      },
      {
        dataset_type: "flow",
        dataset_id: flowIds[0],
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "17100",
      },
      {
        dataset_type: "process",
        dataset_id: ids[1],
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        classification_decision_level: "broad_section",
        selected_code: "D",
      },
      {
        dataset_type: "flow",
        dataset_id: flowIds[1],
        dataset_version: "00.00.001",
        category_type: "flow-product",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "17100",
      },
      {
        dataset_type: "process",
        dataset_id: ids[2],
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        classification_decision_level: "leaf",
        selected_code: "35101",
      },
    ],
  );
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  writeJsonLines(
    scopeFile,
    ids.map((id, index) => ({
      schema_version: 1,
      process_id: id,
      process_version: "00.00.001",
      closure_status: "ready",
      dependency_ids: {
        flows: [
          {
            id: flowIds[index],
            version: "00.00.001",
            flow_type: "Product flow",
            reference_only: false,
          },
        ],
      },
    })),
  );

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--require-leaf-classification",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.selection.require_leaf_classification, true);
    assert.equal(result.json.counts.selected_scopes, 1);
    assert.equal(result.json.counts.filtered_classification_not_leaf_scopes, 1);
    assert.equal(result.json.counts.filtered_classification_missing_scopes, 1);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [ids[0]],
    );
    assert.equal(plan[0].classification_preflight_status, "leaf");
    assert.equal(plan[0].classification_preflight_checked_decisions, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner treats npm network apply failures as retryable", () => {
  const retryable = bafuBatchImportRunTestHooks.retryableStageFailure({
    stage: "classification.apply",
    blocker: {
      code: "classification_apply_stage_failed",
      message: "CLI classification apply failed for process.",
      stderr:
        "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/@tiangong-lca%2fcli failed",
    },
  });

  assert.equal(retryable.code, "ENOTFOUND");
});

test("BAFU batch import runner treats curation gate blocks from failed identity preflight execution as retryable", () => {
  const root = path.join(fixtureRoot, "retryable-identity-preflight-gate");
  fs.rmSync(root, { recursive: true, force: true });
  const preflightRunReport = path.join(root, "identity-preflight-run", "run-report.json");
  writeJson(preflightRunReport, {
    status: "failed",
    counts: { failed: 1, cli_exit_nonzero: 1 },
    blockers: [
      {
        code: "identity_preflight_report_missing_or_non_json",
        message: "Identity-preflight runner could not produce usable evidence for a selected row.",
      },
    ],
  });
  const finalizeReport = path.join(root, "finalize", "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "blocked",
    blockers: [
      {
        code: "post_authoring_curation_gate_not_ready",
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_deterministic_cleanup",
      },
    ],
    stages: [
      {
        stage: "identity_preflight_run",
        status: "failed",
        exit_code: 1,
        stderr: "",
        report_file: rel(preflightRunReport),
      },
      {
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_deterministic_cleanup",
        exit_code: 1,
      },
    ],
  });

  const retryable = bafuBatchImportRunTestHooks.retryableStageFailure({
    stage: "process.finalize",
    blocker: {
      code: "post_authoring_curation_gate_not_ready",
      message:
        "Post-authoring curation gate must be ready before dry-run or remote write planning.",
    },
    report: rel(finalizeReport),
  });

  assert.ok(retryable, "failed identity preflight execution should classify as retryable");
  assert.equal(retryable.code, "identity_preflight_report_missing_or_non_json");

  fs.rmSync(root, { recursive: true, force: true });
});

test("BAFU batch import runner keeps genuine curation gate blocks on the human review path", () => {
  const root = path.join(fixtureRoot, "non-retryable-curation-gate");
  fs.rmSync(root, { recursive: true, force: true });
  const finalizeReport = path.join(root, "finalize", "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "blocked",
    blockers: [
      {
        code: "post_authoring_curation_gate_not_ready",
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_ai_authoring",
      },
    ],
    stages: [
      {
        stage: "identity_preflight_run",
        status: "completed",
        exit_code: 0,
      },
      {
        stage: "post_authoring_curation_gate",
        status: "blocked_needs_foundry_ai_authoring",
        exit_code: 1,
      },
    ],
  });

  const retryable = bafuBatchImportRunTestHooks.retryableStageFailure({
    stage: "process.finalize",
    blocker: {
      code: "post_authoring_curation_gate_not_ready",
      message:
        "Post-authoring curation gate must be ready before dry-run or remote write planning.",
    },
    report: rel(finalizeReport),
  });

  assert.equal(retryable, null);

  fs.rmSync(root, { recursive: true, force: true });
});

test("BAFU universe coverage report compares full process universe with ready scopes and ledgers", () => {
  const root = path.join(fixtureRoot, "universe-coverage");
  fs.rmSync(root, { recursive: true, force: true });
  const inputDir = path.join(root, "input");
  const bundlesDir = path.join(inputDir, "process-bundles");
  const processesDir = path.join(inputDir, "tidas", "processes");
  const flowsDir = path.join(inputDir, "tidas", "flows");
  const ledgerDir = path.join(root, "previous-batch", "import-ledger");
  const outDir = path.join(root, "coverage");
  const readyScopes = path.join(root, "ready-scopes.jsonl");
  const p1 = "11111111-2222-4333-8444-555555555591";
  const p2 = "11111111-2222-4333-8444-555555555592";
  const p3 = "11111111-2222-4333-8444-555555555593";
  const f1 = "22222222-3333-4444-8555-666666666691";
  const f2 = "22222222-3333-4444-8555-666666666692";
  const f3 = "22222222-3333-4444-8555-666666666693";

  writeJson(path.join(bundlesDir, "index.json"), {
    bundles: [
      { process_id: p1, process_version: "00.00.001", manifest: `${p1}/manifest.json` },
      { process_id: p2, process_version: "00.00.001", manifest: `${p2}/manifest.json` },
      { process_id: p3, process_version: "00.00.001", manifest: `${p3}/manifest.json` },
    ],
  });
  writeJson(
    path.join(processesDir, `${p1}.json`),
    coverageProcessPayload({ id: p1, flowIds: [f1] }),
  );
  writeJson(
    path.join(processesDir, `${p2}.json`),
    coverageProcessPayload({ id: p2, flowIds: [f2] }),
  );
  writeJson(
    path.join(processesDir, `${p3}.json`),
    coverageProcessPayload({ id: p3, flowIds: [f3] }),
  );
  writeJson(path.join(flowsDir, `${f1}.json`), coverageFlowPayload({ id: f1 }));
  writeJson(path.join(flowsDir, `${f2}.json`), coverageFlowPayload({ id: f2 }));
  writeJson(path.join(flowsDir, `${f3}.json`), coverageFlowPayload({ id: f3 }));
  writeJsonLines(readyScopes, [
    {
      schema_version: 1,
      process_id: p1,
      process_version: "00.00.001",
      closure_status: "ready",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: p1,
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: f1,
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: p2,
      process_version: "00.00.001",
      stage: "classification.apply",
      code: "classification_apply_stage_failed",
    },
    {
      schema_version: 1,
      process_id: p3,
      process_version: "00.00.001",
      stage: "flow.commit",
      code: "finalize_report_missing",
    },
  ]);
  writeJsonLines(path.join(ledgerDir, "failed.scopes.retry.jsonl"), [
    {
      schema_version: 1,
      process_id: p3,
      process_version: "00.00.001",
      stage: "flow.commit",
      code: "finalize_report_missing",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-universe-coverage-report",
      "--input-dir",
      rel(inputDir),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--scope-file",
      rel(readyScopes),
      "--ledger-source-dir",
      rel(ledgerDir),
      "--out-dir",
      rel(outDir),
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "completed_with_coverage_gaps");
    assert.equal(result.json.counts.process_universe, 3);
    assert.equal(result.json.counts.ready_scope_unique, 1);
    assert.equal(result.json.counts.verified_process_scopes, 1);
    assert.equal(result.json.counts.active_human_review_scopes, 1);
    assert.equal(result.json.counts.retry_scopes, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_rows, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_unique, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_unique_in_universe, 1);
    assert.equal(result.json.counts.ledger_source_ok_flow_rows, 1);
    assert.equal(result.json.counts.ledger_source_ok_flow_unique, 1);
    assert.equal(result.json.counts.unverified_product_or_unknown_flow_references, 2);
    const gaps = readJsonLines(path.join(outDir, "bafu-process-coverage-gaps.jsonl"));
    assert.deepEqual(
      gaps.map((row) => [row.process_id, row.coverage_status]),
      [
        [p2, "active_human_review"],
        [p3, "retry"],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU identity decision carry-forward replaces unresolved rows only with completed reusable decisions", () => {
  const root = path.join(fixtureRoot, "identity-carry-forward");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const decisionDir = path.join(runDir, "decisions-v7-support-process-flow-product-leaf");
  const taskDir = path.join(root, "scope", "flow-identity-task");
  const sourceId = "33333333-4444-4555-8666-777777777791";
  const canonicalId = "44444444-5555-4666-8777-888888888891";
  const decisionsFile = path.join(taskDir, "identity-decisions.jsonl");

  writeJsonLines(path.join(decisionDir, "identity-decisions.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: sourceId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: canonicalId,
        version: "03.00.004",
        short_description: "canonical elementary flow",
      },
      basis: "Existing completed decision with physical-equivalence evidence.",
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
      evidence: {
        source: "prior_completed_identity_decision",
        selected_candidate: { id: canonicalId, version: "03.00.004" },
      },
    },
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: "33333333-4444-4555-8666-777777777792",
      dataset_version: "00.00.001",
      decision_status: "needs_review",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: "44444444-5555-4666-8777-888888888892",
        version: "03.00.004",
      },
      basis: "Incomplete rows must not be reused.",
      evidence: { source: "incomplete" },
    },
  ]);
  writeJsonLines(decisionsFile, [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: sourceId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "block_unresolved",
      canonical: null,
      basis: "Autofill could not prove reuse.",
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
      authoring_package: "current/flow.authoring-package.json",
      authoring_package_sha256: "current-sha",
      evidence: { source: "autofill" },
    },
  ]);

  try {
    const result = bafuBatchImportRunTestHooks.mergeCompletedReusableIdentityDecisions({
      runDir,
      decisionsFile,
      outDir: taskDir,
      datasetType: "flow",
    });

    assert.equal(result.report.status, "completed");
    assert.equal(result.report.counts.replacements, 1);
    assert.equal(result.report.counts.reusable_decisions, 1);
    const merged = readJsonLines(result.outputFile);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].identity_decision, "reuse_existing_reference");
    assert.equal(merged[0].canonical.ref_object_id, canonicalId);
    assert.equal(merged[0].authoring_package, "current/flow.authoring-package.json");
    assert.equal(merged[0].authoring_package_sha256, "current-sha");
    assert.deepEqual(merged[0].used_context_kinds, ["schema", "methodology_yaml", "ruleset"]);
    assert.deepEqual(merged[0].closes_action_items, ["elementary_flow_identity_manual_review"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner applies pending-only before limit and honors pause file", () => {
  const root = path.join(fixtureRoot, "pending-pause");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  const pauseFile = path.join(outDir, "pause.flag");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  writeTextFile(pauseFile, "pause\n");
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const verifiedId = "11111111-2222-4333-8444-555555555561";
  const blockedId = "11111111-2222-4333-8444-555555555562";
  const pendingId = "11111111-2222-4333-8444-555555555563";
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: verifiedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 1,
    },
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 2,
    },
    {
      schema_version: 1,
      process_id: pendingId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 3,
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: verifiedId,
      dataset_version: "00.00.001",
      process_id: verifiedId,
      process_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      stage: "flow.authoring",
      code: "bafu_name_split_unsupported",
      status: "blocked",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--target-user-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "--commit",
      "--parallel",
      "2",
      "--pending-only",
      "--limit",
      "1",
      "--pause-file",
      rel(pauseFile),
    ]);

    assert.equal(result.code, 0);
    const report = result.json;
    assert.equal(report.status, "paused");
    assert.equal(report.selection.pending_only, true);
    assert.equal(report.counts.selected_scopes, 1);
    assert.equal(report.counts.processed_scopes, 0);
    assert.equal(report.counts.paused_not_started, 1);
    assert.deepEqual(report.results, []);
    const manifest = readJson(path.join(repoRoot, report.files.run_manifest));
    assert.equal(manifest.counts.filtered_already_verified_scopes, 1);
    assert.equal(manifest.counts.filtered_already_blocked_scopes, 1);
    assert.equal(manifest.counts.pending_candidate_scopes, 1);
    assert.equal(manifest.pause_observed, true);
    assert.equal(fs.existsSync(path.join(repoRoot, report.files.scope_checkpoints)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner carries forward prior ledgers into fresh batch selection", () => {
  const root = path.join(fixtureRoot, "ledger-source-carry-forward");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const sourceOutDir = path.join(root, "previous-batch");
  const outDir = path.join(root, "fresh-batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const verifiedId = "11111111-2222-4333-8444-555555555581";
  const blockedId = "11111111-2222-4333-8444-555555555582";
  const pendingId = "11111111-2222-4333-8444-555555555583";
  const verifiedFlowId = "22222222-3333-4444-8555-666666666681";
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: verifiedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 1,
    },
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 2,
    },
    {
      schema_version: 1,
      process_id: pendingId,
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 3,
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "ok.scopes.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "process",
      dataset_id: verifiedId,
      dataset_version: "00.00.001",
      process_id: verifiedId,
      process_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "ok.flows.verified.jsonl"), [
    {
      schema_version: 1,
      dataset_type: "flow",
      dataset_id: verifiedFlowId,
      dataset_version: "00.00.001",
      status: "verified",
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "blocked.scopes.human-review.jsonl"), [
    {
      schema_version: 1,
      process_id: blockedId,
      process_version: "00.00.001",
      stage: "flow.authoring",
      code: "bafu_name_split_unsupported",
      status: "blocked",
    },
  ]);
  writeJsonLines(path.join(sourceOutDir, "import-ledger", "verified-support-identities.jsonl"), [
    {
      schema_version: 1,
      identity_key: "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
      type: "source",
      id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      version: "00.00.001",
      status: "verified",
    },
    {
      schema_version: 1,
      identity_key: "source:cccccccc-dddd-4eee-8fff-000000000000@00.00.001",
      type: "source",
      id: "cccccccc-dddd-4eee-8fff-000000000000",
      version: "00.00.001",
      status: "verified",
    },
    {
      schema_version: 1,
      identity_key: "source:cccccccc-dddd-4eee-8fff-000000000000@00.00.001",
      type: "source",
      id: "cccccccc-dddd-4eee-8fff-000000000000",
      version: "00.00.001",
      status: "invalidated_remote_missing",
    },
  ]);

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--ledger-source-dir",
      rel(sourceOutDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--pending-only",
      "--selection-order",
      "estimated-weight-asc",
      "--limit",
      "1",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preflight_completed");
    assert.equal(result.json.counts.selected_scopes, 1);
    assert.equal(result.json.counts.filtered_already_verified_scopes, 1);
    assert.equal(result.json.counts.filtered_already_blocked_scopes, 1);
    assert.equal(result.json.counts.already_verified_scopes, 1);
    assert.equal(result.json.counts.already_verified_flows, 1);
    assert.equal(result.json.counts.already_blocked_scopes, 1);
    assert.equal(result.json.counts.ledger_source_dirs, 1);
    assert.equal(result.json.counts.ledger_source_ok_scope_rows, 1);
    assert.equal(result.json.counts.ledger_source_ok_flow_rows, 1);
    assert.equal(result.json.counts.ledger_source_blocked_scope_rows, 1);
    assert.equal(result.json.support_identity_cache.loaded_from_ledger_sources, 1);
    assert.deepEqual(result.json.selection.ledger_source_dirs, [
      rel(path.join(sourceOutDir, "import-ledger")),
    ]);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [pendingId],
    );
    const cache = readJsonLines(path.join(repoRoot, result.json.files.support_identity_cache));
    assert.deepEqual(
      cache.map((row) => row.identity_key),
      [
        "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
        "source:cccccccc-dddd-4eee-8fff-000000000000@00.00.001",
      ],
    );
    assert.equal(cache[0].status, "verified");
    assert.equal(cache[1].status, "invalidated_remote_missing");
    assert.equal(
      cache[0].carried_forward_from,
      rel(path.join(sourceOutDir, "import-ledger", "verified-support-identities.jsonl")),
    );
    const manifest = readJson(path.join(repoRoot, result.json.files.run_manifest));
    assert.equal(manifest.counts.ledger_source_dirs, 1);
    assert.equal(manifest.policy.ledger_source_dirs_are_read_only_carry_forward_inputs, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner writes read-only preflight plan and primes support identity cache", () => {
  const root = path.join(fixtureRoot, "preflight-support-cache");
  fs.rmSync(root, { recursive: true, force: true });
  const runDir = path.join(root, "run");
  const schemaDir = path.join(root, "schemas");
  const bundlesDir = path.join(root, "process-bundles");
  const outDir = path.join(root, "batch");
  fs.mkdirSync(bundlesDir, { recursive: true });
  writeRequiredContext(runDir, schemaDir);
  const scopeFile = path.join(root, "ready-scopes.jsonl");
  const processIds = [
    "11111111-2222-4333-8444-555555555571",
    "11111111-2222-4333-8444-555555555572",
  ];
  writeJsonLines(scopeFile, [
    {
      schema_version: 1,
      process_id: processIds[0],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 10,
    },
    {
      schema_version: 1,
      process_id: processIds[1],
      process_version: "00.00.001",
      closure_status: "ready",
      estimated_weight: 2,
    },
  ]);
  const handoffDir = path.join(
    outDir,
    "scopes",
    "existing",
    "process-e2e",
    "source-contact-support-handoff",
  );
  const supportCommitReport = path.join(
    handoffDir,
    "commit",
    "support-save-draft",
    "outputs",
    "dataset-save-draft",
    "summary.json",
  );
  writeJson(path.join(handoffDir, "closeout", "dataset-post-write-closeout-report.json"), {
    schema_version: 1,
    status: "completed",
    commit_report: rel(supportCommitReport),
  });
  writeJson(supportCommitReport, {
    schema_version: 1,
    commit: true,
    status: "completed",
    rows: [
      {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        version: "00.00.001",
        type: "contact",
        table: "contacts",
        status: "executed",
      },
      {
        id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        version: "00.00.001",
        type: "source",
        table: "sources",
        status: "executed",
      },
    ],
  });

  try {
    const result = runFoundry([
      "dataset-bafu-batch-import-run",
      "--scope-file",
      rel(scopeFile),
      "--process-bundles-dir",
      rel(bundlesDir),
      "--run-dir",
      rel(runDir),
      "--out-dir",
      rel(outDir),
      "--tidas-schema-dir",
      rel(schemaDir),
      "--preflight-only",
      "--pending-only",
      "--selection-order",
      "estimated-weight-asc",
      "--limit",
      "1",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "preflight_completed");
    assert.equal(result.json.mode, "preflight");
    assert.equal(result.json.counts.selected_scopes, 1);
    assert.equal(result.json.counts.processed_scopes, 0);
    assert.equal(result.json.counts.verified_support_identities, 2);
    const plan = readJsonLines(path.join(repoRoot, result.json.files.preflight_plan));
    assert.deepEqual(
      plan.map((row) => row.process_id),
      [processIds[1]],
    );
    const cache = readJsonLines(path.join(repoRoot, result.json.files.support_identity_cache));
    assert.deepEqual(cache.map((row) => row.identity_key).sort(), [
      "contact:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@00.00.001",
      "source:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff@00.00.001",
    ]);
    const manifest = readJson(path.join(repoRoot, result.json.files.run_manifest));
    assert.equal(manifest.status, "preflight_completed");
    assert.equal(fs.existsSync(path.join(outDir, "scope-checkpoints.jsonl")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU authoring task filter removes rows already rewritten by identity apply", () => {
  const root = path.join(fixtureRoot, "filter-authoring");
  fs.rmSync(root, { recursive: true, force: true });
  const keepId = "22222222-3333-4444-8555-666666666666";
  const skippedId = "33333333-4444-4555-8666-777777777777";
  const rowsFile = path.join(root, "flows.identity-decisions-applied.jsonl");
  const taskManifest = path.join(root, "authoring-task-manifest.json");
  const reportPath = path.join(root, "authoring-task-filter-report.json");
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": keepId,
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        entity: {
          dataset_type: "flow",
          entity_id: keepId,
          version: "00.00.001",
        },
      },
      {
        entity: {
          dataset_type: "flow",
          entity_id: skippedId,
          version: "00.00.001",
        },
      },
    ],
  });

  try {
    const result = filterAuthoringTaskManifestToRows({
      taskManifest,
      rowsFile,
      type: "flow",
      reportPath,
    });
    assert.equal(result.status, "ready_for_ai_authoring_batch");
    assert.notEqual(result.taskManifest, taskManifest);
    const filtered = readJson(result.taskManifest);
    assert.equal(filtered.tasks.length, 1);
    assert.equal(filtered.tasks[0].entity.entity_id, keepId);
    const report = readJson(reportPath);
    assert.equal(report.counts.original_tasks, 2);
    assert.equal(report.counts.retained_tasks, 1);
    assert.equal(report.counts.skipped_tasks, 1);
    assert.equal(report.skipped_tasks[0].dataset_id, skippedId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch flow verification filter keeps only flows not in ok flow ledger", () => {
  const root = path.join(fixtureRoot, "flow-filter-carry-forward");
  fs.rmSync(root, { recursive: true, force: true });
  const verifiedId = "44444444-5555-4666-8777-888888888888";
  const pendingId = "55555555-6666-4777-8888-999999999999";
  const rows = [verifiedId, pendingId].map((id) => ({
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": id,
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  }));
  const plan = bafuBatchImportRunTestHooks.flowRowsPendingVerification(
    rows,
    new Set([`${verifiedId}@00.00.001`]),
  );

  assert.equal(plan.pendingRows.length, 1);
  assert.equal(plan.verifiedRows.length, 1);
  assert.equal(plan.pendingIdentities[0].id, pendingId);
  assert.equal(plan.verifiedIdentities[0].id, verifiedId);
  const ledgerDir = path.join(root, "scope", "import-ledger");
  const sourceRow = {
    schema_version: 1,
    dataset_type: "flow",
    dataset_id: verifiedId,
    dataset_version: "00.00.001",
    status: "verified",
    report: "prior/finalize-report.json",
  };
  const sourceRows = new Map([[`${verifiedId}@00.00.001`, sourceRow]]);

  try {
    const carried = bafuBatchImportRunTestHooks.writeScopeCarriedForwardVerifiedFlowRows({
      ledgerDir,
      processId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      verifiedIdentities: plan.verifiedIdentities,
      verifiedFlowRowsByKey: sourceRows,
    });
    assert.equal(carried.count, 1);
    const ledgerRows = readJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl"));
    assert.equal(ledgerRows.length, 1);
    assert.equal(ledgerRows[0].dataset_id, verifiedId);
    assert.equal(ledgerRows[0].carried_forward, true);
    assert.equal(
      ledgerRows[0].carried_forward_for_process_id,
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    assert.equal(ledgerRows[0].report, "prior/finalize-report.json");

    const repeated = bafuBatchImportRunTestHooks.writeScopeCarriedForwardVerifiedFlowRows({
      ledgerDir,
      processId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      verifiedIdentities: plan.verifiedIdentities,
      verifiedFlowRowsByKey: sourceRows,
    });
    assert.equal(repeated.count, 0);
    assert.equal(readJsonLines(path.join(ledgerDir, "ok.flows.verified.jsonl")).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner preserves blocked pre-finalize when authoring produces no evidence", () => {
  const finalizeReport = {
    status: "blocked",
    blockers: [
      {
        code: "post_authoring_curation_gate_not_ready",
        message: "Curation gate still has unresolved action items.",
      },
    ],
  };

  const blocker = bafuBatchImportRunTestHooks.preFinalizeRecoveryBlocker({
    type: "flow",
    finalizeReport,
    recovery: {
      status: "completed",
      identityApplyReport: null,
      patchCollectReport: null,
      patchApplyReport: null,
    },
  });

  assert.equal(blocker.code, "post_authoring_curation_gate_not_ready");

  const retryBlocker = bafuBatchImportRunTestHooks.preFinalizeRecoveryBlocker({
    type: "flow",
    finalizeReport,
    recovery: {
      status: "completed",
      identityApplyReport: null,
      patchCollectReport: "tmp/authoring-patch-collect-report.json",
      patchApplyReport: null,
    },
  });

  assert.equal(retryBlocker, null);
});

test("BAFU batch import runner blocks unresolved identity reference rows", () => {
  const root = path.join(fixtureRoot, "identity-unresolved-reference");
  fs.rmSync(root, { recursive: true, force: true });
  const unresolvedRows = path.join(root, "identity-unresolved-references.jsonl");
  writeJsonLines(unresolvedRows, [
    {
      dataset_type: "flow",
      dataset_id: "66666666-7777-4888-8999-000000000001",
      version: "00.00.001",
    },
  ]);

  try {
    const blocker = bafuBatchImportRunTestHooks.identityUnresolvedReferenceBlocker({
      type: "flow",
      report: {
        status: "completed",
        counts: {
          identity_unresolved_references: 1,
        },
        files: {
          identity_unresolved_references: rel(unresolvedRows),
        },
      },
    });

    assert.equal(blocker.code, "flow_identity_unresolved_references");
    assert.equal(blocker.unresolved_reference_rows, rel(unresolvedRows));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner merges --process-id-file ids with explicit process ids", () => {
  const root = path.join(fixtureRoot, "process-id-file-merge");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const idFile = path.join(root, "retry-ids.txt");
  fs.writeFileSync(
    idFile,
    [
      "# blocked retry batch",
      "",
      "aaaaaaaa-1111-4111-8111-111111111111",
      "  bbbbbbbb-2222-4222-8222-222222222222  ",
      "# trailing comment",
      "",
    ].join("\n"),
  );

  try {
    const merged = bafuBatchImportRunTestHooks.requestedProcessIdValues({
      processId: "cccccccc-3333-4333-8333-333333333333",
      processIdFile: idFile,
    });
    assert.deepEqual(merged, [
      "cccccccc-3333-4333-8333-333333333333",
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
    ]);

    const fileOnly = bafuBatchImportRunTestHooks.requestedProcessIdValues({
      processIdsFile: idFile,
    });
    assert.deepEqual(fileOnly, [
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
    ]);

    const absent = bafuBatchImportRunTestHooks.requestedProcessIdValues({
      processId: "cccccccc-3333-4333-8333-333333333333",
    });
    assert.deepEqual(absent, ["cccccccc-3333-4333-8333-333333333333"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU batch import runner rejects a missing --process-id-file with the path in the error", () => {
  const missingFile = path.join(fixtureRoot, "process-id-file-missing", "no-such-ids.txt");
  assert.throws(
    () =>
      bafuBatchImportRunTestHooks.requestedProcessIdValues({
        processIdFile: missingFile,
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes("--process-id-file not found:") &&
      error.message.includes(missingFile),
  );
});
