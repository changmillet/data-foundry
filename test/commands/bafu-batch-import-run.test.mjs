import test from "node:test";
import {
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
