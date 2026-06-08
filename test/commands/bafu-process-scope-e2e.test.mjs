import test from "node:test";
import {
  bafuProcessScopeE2eTestHooks,
  createBafuProcessScopeE2eCommands,
} from "../../scripts/commands/bafu-process-scope-e2e.mjs";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  spawnSync,
  testTmpRoot,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";

const fixtureRoot = testTmpRoot("bafu-process-scope-e2e-test");
const processId = "11111111-2222-4333-8444-555555555555";

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object") return textValue(value["#text"] ?? value.value ?? value.id);
  return "";
}

createBafuProcessScopeE2eCommands({
  booleanOption: (value) => value === true || value === "true",
  fileExists: (filePath) =>
    Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  nowIso: () => "2026-01-01T00:00:00.000Z",
  readJson,
  readJsonLines,
  readRowsFile: (filePath) => {
    if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
    const value = readJson(filePath);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.rows)) return value.rows;
    return [value];
  },
  repoRelativeMaybe: (filePath) => (filePath ? rel(filePath) : null),
  resolveRepoPath: (filePath) =>
    filePath ? (path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)) : null,
  shellQuote: (value) => {
    const text = String(value);
    return /^[A-Za-z0-9_./:=@%+-]+$/u.test(text) ? text : `'${text.replace(/'/gu, "'\\''")}'`;
  },
  textValue,
  writeJson,
});

function processRow(id = processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": id,
          "common:name": { "#text": "BAFU process scope fixture" },
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

function runHelper(args) {
  const result = spawnSync(
    process.execPath,
    ["scripts/foundry.mjs", "dataset-bafu-process-scope-e2e", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.notEqual(
    result.stdout.trim(),
    "",
    `expected helper JSON stdout; status=${result.status}; stderr=${result.stderr}`,
  );
  return {
    code: result.status,
    json: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
}

function writeRows(root) {
  const rowsFile = path.join(root, "rows", "process.jsonl");
  writeJsonLines(rowsFile, [processRow()]);
  const sourceSupportRowsFile = path.join(root, "rows", "sources.jsonl");
  writeJsonLines(sourceSupportRowsFile, [
    {
      sourceDataSet: {
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            shortName: { "#text": "BAFU source fixture" },
          },
        },
      },
    },
  ]);
  return { rowsFile, sourceSupportRowsFile };
}

test("BAFU process scope helper plans existing finalize command with source support rows", () => {
  const root = path.join(fixtureRoot, "plan");
  fs.rmSync(root, { recursive: true, force: true });
  const { rowsFile, sourceSupportRowsFile } = writeRows(root);
  const outDir = path.join(root, "run");

  try {
    const result = runHelper([
      "--rows-file",
      rel(rowsFile),
      "--source-support-rows-file",
      rel(sourceSupportRowsFile),
      "--out-dir",
      rel(outDir),
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "planned");
    assert.equal(result.json.policy.remote_commit_executed, false);
    assert.match(result.json.commands.post_authoring_finalize, /dataset-post-authoring-finalize/u);
    assert.match(result.json.commands.post_authoring_finalize, /--source-support-rows-file/u);
    assert.match(result.json.commands.post_authoring_finalize, /sources\.jsonl/u);
    assert.match(result.json.resume.rerun_command, /--source-support-rows-file/u);
    assert.equal(fs.existsSync(path.join(repoRoot, result.json.files.report)), true);
    const ledger = readJsonLines(path.join(repoRoot, result.json.files.run_ledger));
    assert.equal(ledger.at(-1).stage, "plan");
    assert.equal(ledger.at(-1).state, "planned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper hard-blocks unresolved AI curation items on resume", () => {
  const root = path.join(fixtureRoot, "blocked-ai");
  fs.rmSync(root, { recursive: true, force: true });
  const { rowsFile } = writeRows(root);
  const outDir = path.join(root, "run");
  const curationGateReport = path.join(
    outDir,
    "finalize",
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  const finalizeReport = path.join(
    outDir,
    "finalize",
    "dataset-post-authoring-finalize-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 2,
      identity_action_items: 1,
      semantic_action_items: 1,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        action_item_count: 2,
        authoring_package: "tmp/fixture/authoring-package.json",
      },
    ],
  });
  writeJson(finalizeReport, {
    schema_version: 1,
    status: "blocked",
    rows_file: rel(rowsFile),
    counts: {
      blockers: 1,
      commit_handoff_blockers: 1,
    },
    files: {
      curation_gate_report: rel(curationGateReport),
    },
    commit_handoff: {
      status: "blocked",
      command: null,
      post_write_verify_command: null,
      blockers: [{ code: "finalize_not_ready" }],
    },
    blockers: [{ code: "post_authoring_curation_gate_not_ready" }],
  });

  try {
    const result = runHelper(["--rows-file", rel(rowsFile), "--out-dir", rel(outDir)]);

    assert.equal(result.code, 1);
    assert.equal(result.json.status, "blocked_unresolved_ai_curation");
    assert.equal(result.json.counts.ai_action_items, 2);
    assert.equal(
      result.json.blockers.some((blocker) => blocker.code === "unresolved_ai_curation_items"),
      true,
    );
    const report = readJson(path.join(repoRoot, result.json.files.report));
    assert.equal(report.status, "blocked_unresolved_ai_curation");
    const ledger = readJsonLines(path.join(repoRoot, result.json.files.run_ledger));
    assert.equal(ledger.at(-1).stage, "resume");
    assert.equal(ledger.at(-1).state, "blocked_unresolved_ai_curation");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper recognizes post-finalize semantic-only recovery", () => {
  const root = path.join(fixtureRoot, "semantic-recovery-gate");
  fs.rmSync(root, { recursive: true, force: true });
  const curationGateReport = path.join(root, "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    counts: {
      action_items: 1,
      identity_action_items: 0,
      semantic_action_items: 1,
      classification_queue_action_items: 0,
      location_queue_action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        action_item_count: 1,
        authoring_package: "tmp/fixture/process.authoring-package.json",
      },
    ],
  });

  try {
    const finalizeReport = {
      files: {
        curation_gate_report: rel(curationGateReport),
      },
    };

    assert.equal(
      bafuProcessScopeE2eTestHooks.canRunPostFinalizeSemanticRecovery(finalizeReport),
      true,
    );
    assert.equal(
      bafuProcessScopeE2eTestHooks.canRunPostFinalizeIdentityRecovery(finalizeReport),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("BAFU process scope helper resumes ready handoff without executing remote commit", () => {
  const root = path.join(fixtureRoot, "ready");
  fs.rmSync(root, { recursive: true, force: true });
  const { rowsFile } = writeRows(root);
  const outDir = path.join(root, "run");
  const curationGateReport = path.join(
    outDir,
    "finalize",
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  const finalizeReport = path.join(
    outDir,
    "finalize",
    "dataset-post-authoring-finalize-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    counts: {
      action_items: 0,
      deterministic_cleanup_items: 0,
    },
    entities: [],
  });
  writeJson(finalizeReport, {
    schema_version: 1,
    status: "ready_for_remote_write",
    rows_file: rel(rowsFile),
    counts: {
      blockers: 0,
      commit_handoff_blockers: 0,
    },
    files: {
      curation_gate_report: rel(curationGateReport),
      mutation_manifest: "tmp/fixture/mutation-manifest.json",
      commit_handoff_plan: "tmp/fixture/dataset-commit-handoff-plan.json",
    },
    commit_handoff: {
      status: "ready_for_explicit_commit",
      command: "npx --yes @tiangong-lca/cli@latest process save-draft --input rows.jsonl",
      post_write_verify_command:
        "npx --yes @tiangong-lca/cli@latest dataset verify-remote --input rows.jsonl",
      blockers: [],
    },
    blockers: [],
  });

  try {
    const result = runHelper(["--rows-file", rel(rowsFile), "--out-dir", rel(outDir)]);

    assert.equal(result.code, 0);
    assert.equal(result.json.status, "ready_for_explicit_commit");
    assert.equal(result.json.policy.remote_commit_executed, false);
    assert.match(result.json.commands.commit_handoff, /process save-draft/u);
    const ledger = readJsonLines(path.join(repoRoot, result.json.files.run_ledger));
    assert.equal(ledger.at(-1).state, "ready_for_explicit_commit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
