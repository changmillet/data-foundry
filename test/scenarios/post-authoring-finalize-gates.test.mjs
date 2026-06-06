import test from "node:test";
import {
  finalizeAutoQueueFixtureRoot,
  finalizeCurationGateFixtureRoot,
  fixtureRoot,
} from "../fixtures/fixture-roots.mjs";
import {
  assert,
  fs,
  path,
  readJson,
  readJsonLines,
  rel,
  repoRoot,
  runFoundry,
  scopeBlockerCodes,
  targetUserId,
  writeJsonLines,
  writeText,
} from "../fixtures/foundry-core.mjs";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.mjs";
import { writeCompletedIdentityPreflightIndex } from "../fixtures/identity-fixtures.mjs";
import {
  flowRow,
  flowRowWithClassification,
  processRowWithFlowRef,
  processRowWithInvalidLocation,
  sourceRow,
} from "../fixtures/row-builders.mjs";

test("flow post-authoring finalize dry-run omits unsupported state-code flag", () => {
  const root = path.join(fixtureRoot, "flow-finalize-dry-run-state-code");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "12345678-9999-4aaa-8bbb-cccccccccccc";
  const rowsFile = path.join(root, "rows", "flows.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Product flow",
      classification: {
        "common:classification": {
          "common:class": [
            {
              "@level": "0",
              "@classId": "9",
              "#text": "Community, social and personal services",
            },
          ],
        },
      },
    }),
  ]);
  const fakeCli = path.join(root, "bin", "fake-cli.cjs");
  const callsFile = path.join(root, "fake-cli-calls.jsonl");
  writeText(
    fakeCli,
    String.raw`#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const callsFile = process.env.FOUNDRY_FAKE_CLI_CALLS;
if (callsFile) {
  fs.mkdirSync(path.dirname(callsFile), { recursive: true });
  fs.appendFileSync(callsFile, JSON.stringify({ args }) + "\n");
}
function opt(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
function readRows(filePath) {
  return fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function identity(row) {
  const info = row.flowDataSet.flowInformation.dataSetInformation;
  return {
    id: info["common:UUID"],
    version:
      row.flowDataSet.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"] ||
      "00.00.001",
  };
}
if (args[0] === "dataset" && args[1] === "validate") {
  const input = opt("--input");
  const outDir = opt("--out-dir");
  const rows = readRows(input).map(identity);
  const reportFile = path.join(outDir, "outputs", "validation-report.json");
  const report = {
    status: "completed",
    input_path: input,
    rows: rows.map((row, index) => ({
      index,
      id: row.id,
      version: row.version,
      type: "flow",
      status: "valid",
      issues: [],
    })),
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "qa" && args[1] === "flow") {
  const rowsFile = opt("--rows-file");
  const outDir = opt("--out-dir");
  const reportFile = path.join(outDir, "flow_qa_report.json");
  const report = {
    status: "completed_local_flow_qa",
    rows_file: rowsFile,
    blockers: [],
    findings: [],
    counts: { blockers: 0 },
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "dataset" && args[1] === "classification" && args[2] === "audit") {
  const input = opt("--input");
  const outDir = opt("--out-dir");
  const reportFile = path.join(outDir, "outputs", "location-audit-report.json");
  const report = {
    status: "completed",
    input_path: input,
    blockers: [],
    findings: [],
    counts: { invalid: 0, blockers: 0 },
    files: { report: reportFile },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
if (args[0] === "flow" && args[1] === "publish-version") {
  if (args.includes("--state-code")) {
    process.stderr.write("unexpected --state-code for flow publish-version\n");
    process.exit(2);
  }
  const input = opt("--input-file");
  const outDir = opt("--out-dir");
  const rows = readRows(input).map(identity);
  const successFile = path.join(outDir, "flows_tidas_sdk_plus_classification_mcp_success_list.json");
  const failedFile = path.join(outDir, "flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl");
  const reportFile = path.join(outDir, "flows_tidas_sdk_plus_classification_mcp_sync_report.json");
  writeJson(successFile, rows.map((row) => ({ ...row, operation: "would_insert" })));
  fs.mkdirSync(path.dirname(failedFile), { recursive: true });
  fs.writeFileSync(failedFile, "");
  const report = {
    status: "completed_flow_publish_version",
    mode: "dry_run",
    dry_run: true,
    commit: false,
    input_path: input,
    target_user_id_override: opt("--target-user-id"),
    files: {
      report: reportFile,
      success_list: successFile,
      remote_failed: failedFile,
    },
  };
  writeJson(reportFile, report);
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}
process.stderr.write("unexpected fake CLI args: " + args.join(" ") + "\n");
process.exit(2);
`,
  );
  fs.chmodSync(fakeCli, 0o755);

  try {
    const finalize = runFoundry(
      [
        "dataset-post-authoring-finalize",
        "--type",
        "flow",
        "--profile",
        "generic",
        "--rows-file",
        rel(rowsFile),
        "--target-user-id",
        targetUserId,
        "--state-code",
        "0",
        "--out-dir",
        rel(path.join(root, "finalize")),
      ],
      {
        env: {
          TIANGONG_LCA_CLI_BIN: fakeCli,
          FOUNDRY_FAKE_CLI_CALLS: callsFile,
        },
      },
    );
    assert.equal(finalize.code, 0, JSON.stringify(finalize.json, null, 2));
    assert.equal(finalize.json.status, "ready_for_remote_write");
    assert.ok(finalize.json.files.dry_run_report);
    const dryRunStage = finalize.json.stages.find(
      (stage) => stage.stage === "flow_publish_version_dry_run",
    );
    assert.equal(dryRunStage.exit_code, 0);
    assert.equal(dryRunStage.args.includes("--target-user-id"), true);
    assert.equal(dryRunStage.args.includes("--state-code"), false);
    const calls = readJsonLines(callsFile);
    const publishCall = calls.find(
      (call) => call.args[0] === "flow" && call.args[1] === "publish-version",
    );
    assert.ok(publishCall);
    assert.equal(publishCall.args.includes("--target-user-id"), true);
    assert.equal(publishCall.args.includes("--state-code"), false);
    const mutationManifest = readJson(path.join(repoRoot, finalize.json.files.mutation_manifest));
    assert.equal(mutationManifest.status, "ready_for_remote_write");
    assert.equal(mutationManifest.counts.blockers, 0);
    assert.equal(mutationManifest.items[0].dry_run_status, "success");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize auto-builds curation queue context from sibling process bundle rows", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "with-local-flow");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "b0b0b0b0-1111-4222-8333-444444444444";
  const flowId = "c0c0c0c0-2222-4333-8444-555555555555";
  const sourceId = "d0d0d0d0-3333-4444-8555-666666666666";
  const rowsDir = path.join(root, "rows");
  const rowsFile = path.join(rowsDir, "processes.jsonl");
  const flowsFile = path.join(rowsDir, "flows.jsonl");
  const supportFile = path.join(rowsDir, "support.jsonl");
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, flowId)]);
  writeJsonLines(flowsFile, [flowRow(flowId)]);
  writeJsonLines(supportFile, [sourceRow(sourceId)]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: processRowWithFlowRef(processId, flowId),
      name: "Heat production",
    },
    {
      datasetType: "flow",
      id: flowId,
      target: flowRow(flowId),
      name: "Natural gas",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--run-identity-preflight",
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.identity_preflight_run_selected, 2);
    assert.equal(finalize.json.counts.identity_preflight_run_skipped_existing, 2);
    assert.equal(finalize.json.counts.curation_queue_status, "ready");
    assert.equal(finalize.json.counts.curation_queue_process_rows, 1);
    assert.equal(finalize.json.counts.curation_queue_flow_rows, 1);
    assert.ok(finalize.json.files.curation_queue_report);
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "identity_preflight_run" &&
          stage.status === "completed" &&
          stage.exit_code === 0,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "curation_queue" && stage.status === "ready" && stage.exit_code === 0,
      ),
    );

    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    assert.equal(gateReport.context.require_queue_context, true);
    assert.equal(gateReport.context.curation_queue.status, "ready");
    const authoringPackage = readJson(
      path.join(repoRoot, gateReport.entities[0].authoring_package),
    );
    const deterministicCodes = new Set(
      authoringPackage.deterministic_cleanup_items.map((item) => item.code),
    );
    assert.equal(deterministicCodes.has("curation_queue_context_required"), false);
    assert.equal(authoringPackage.curation_queue_context.status, "attached");
    assert.equal(authoringPackage.curation_queue_context.dependency_rows.length, 1);
    assert.match(
      JSON.stringify(authoringPackage.curation_queue_context.dependency_rows[0].input_rows),
      new RegExp(flowId, "u"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize declares external process flow refs for remote proof", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "missing-local-flow");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "e0e0e0e0-4444-4555-8666-777777777777";
  const missingFlowId = "f0f0f0f0-5555-4666-8777-888888888888";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, missingFlowId)]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: processRowWithFlowRef(processId, missingFlowId),
      name: "Heat production",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.curation_queue_status, "ready");
    assert.equal(finalize.json.counts.curation_queue_blockers, 0);
    assert.ok(
      finalize.json.blockers.some(
        (blocker) =>
          blocker.code === "reference_closure_remote_verify_required" &&
          blocker.reference_id === missingFlowId,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "curation_queue" && stage.status === "ready" && stage.exit_code === 0,
      ),
    );

    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    assert.equal(gateReport.context.curation_queue.status, "ready");
    const authoringPackage = readJson(
      path.join(repoRoot, gateReport.entities[0].authoring_package),
    );
    const deterministicCodes = new Set(
      authoringPackage.deterministic_cleanup_items.map((item) => item.code),
    );
    assert.equal(deterministicCodes.has("curation_queue_context_required"), false);
    assert.equal(deterministicCodes.has("curation_queue_not_ready"), false);
    assert.equal(deterministicCodes.has("curation_queue_dependency_refs_unresolved"), false);
    assert.deepEqual(
      authoringPackage.curation_queue_context.closure.dependencies.external_refs.map(
        (ref) => ref.entity_id,
      ),
      [missingFlowId],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize externalizes unresolved elementary flow exchanges", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "unresolved-exchange-trace");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "e1e1e1e1-4444-4555-8666-777777777777";
  const missingFlowId = "f1f1f1f1-5555-4666-8777-888888888888";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const row = processRowWithFlowRef(processId, missingFlowId);
  row.processDataSet.processInformation.dataSetInformation["common:other"] = {
    "tiangongfoundry:unresolvedTrace": [
      {
        status: "unresolved_deferred",
        action_item_code: "elementary_flow_identity_manual_review",
        blocked_path: "processDataSet.exchanges.exchange.0.referenceToFlowDataSet",
        reference_id: missingFlowId,
        reference_version: "00.00.001",
        reason: "Fixture unresolved elementary flow cannot be safely mapped to a public flow.",
      },
    ],
  };
  writeJsonLines(rowsFile, [row]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: row,
      name: "Heat production",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.json.counts.unresolved_exchange_externalized, 1);
    assert.ok(finalize.json.files.unresolved_exchange_externalized_rows);
    assert.ok(finalize.json.files.unresolved_exchange_traces);
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "unresolved_exchange_externalization" &&
          stage.status === "completed" &&
          stage.exit_code === 0,
      ),
    );
    const externalizedRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.unresolved_exchange_externalized_rows),
    );
    const exchanges = externalizedRows[0].processDataSet.exchanges.exchange;
    assert.deepEqual(exchanges, []);
    const traces =
      externalizedRows[0].processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:unresolvedExchangeTrace"
      ];
    assert.equal(traces.length, 1);
    assert.equal(traces[0].reference_id, missingFlowId);
    assert.equal(traces[0].original_exchange.referenceToFlowDataSet["@refObjectId"], missingFlowId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize externalizes exchanges for upstream blocked flow dependencies", () => {
  const root = path.join(finalizeAutoQueueFixtureRoot, "blocked-flow-dependency-trace");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "e2e2e2e2-4444-4555-8666-777777777777";
  const blockedFlowId = "f2f2f2f2-5555-4666-8777-888888888888";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  const row = processRowWithFlowRef(processId, blockedFlowId);
  writeJsonLines(rowsFile, [row]);
  const blockedFlowReferences = path.join(
    root,
    "upstream-flow-finalize",
    "canonical-support-blockers.jsonl",
  );
  writeJsonLines(blockedFlowReferences, [
    {
      code: "canonical_flow_property_reference_unresolved",
      dataset_type: "flow",
      dataset_id: blockedFlowId,
      dataset_version: "00.00.001",
      source_unit: "my",
      original_ref_object_id: "flow-property-my",
      required_resolution:
        "Add the public canonical flow property/unit group support row before this flow can be written.",
    },
  ]);
  const context = writeContextPackFiles(root);
  const identityPreflightIndex = writeCompletedIdentityPreflightIndex(root, [
    {
      datasetType: "process",
      id: processId,
      target: row,
      name: "Transport service",
    },
  ]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--blocked-flow-reference-blockers",
      rel(blockedFlowReferences),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "finalize")),
    ]);

    assert.equal(finalize.json.counts.unresolved_exchange_externalized, 1);
    assert.equal(finalize.json.counts.blocked_flow_dependency_externalized, 1);
    const externalizedRows = readJsonLines(
      path.join(repoRoot, finalize.json.files.unresolved_exchange_externalized_rows),
    );
    assert.deepEqual(externalizedRows[0].processDataSet.exchanges.exchange, []);
    const traces =
      externalizedRows[0].processDataSet.processInformation.dataSetInformation["common:other"][
        "tiangongfoundry:unresolvedExchangeTrace"
      ];
    assert.equal(traces.length, 1);
    assert.equal(traces[0].action_item_code, "blocked_flow_dependency_exchange_externalized");
    assert.equal(traces[0].reference_id, blockedFlowId);
    assert.equal(
      traces[0].upstream_flow_blockers[0].code,
      "canonical_flow_property_reference_unresolved",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize blocks residual BAFU AI action items after location codes pass", () => {
  fs.rmSync(finalizeCurationGateFixtureRoot, {
    recursive: true,
    force: true,
  });
  const processId = "afafafaf-cdcd-4efe-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(finalizeCurationGateFixtureRoot, "rows", "processes.jsonl");
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.dataSetInformation.name.baseName["#text"] =
    "xx Li salt, hydrometallurgical processing Li-ion batteries, at plant {GLO}";
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
    "@location"
  ] = "CH";
  writeJsonLines(rowsFile, [row]);
  const context = writeContextPackFiles(finalizeCurationGateFixtureRoot);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(finalizeCurationGateFixtureRoot, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.location_audit_blockers, 0);
    assert.equal(finalize.json.counts.location_code_invalid, 0);
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "post_authoring_curation_gate" && stage.exit_code === 1,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "process_save_draft_dry_run" && stage.status === "skipped",
      ),
    );
    assert.equal(finalize.json.files.dry_run_report, null);
    assert.ok(finalize.json.files.curation_gate_report);
    const gateReport = readJson(path.join(repoRoot, finalize.json.files.curation_gate_report));
    assert.equal(gateReport.status, "blocked_needs_foundry_ai_authoring");
    assert.ok(gateReport.counts.action_items > 0);

    const authoringPackageFile = path.join(repoRoot, gateReport.entities[0].authoring_package);
    const authoringPackage = readJson(authoringPackageFile);
    const actionCodes = new Set(authoringPackage.action_items.map((item) => item.code));
    assert.ok(actionCodes.has("semantic_name_placeholder_token"));
    assert.ok(actionCodes.has("semantic_geography_token_in_name"));
    assert.ok(
      finalize.json.counts.mutation_manifest_blockers > 0,
      "Mutation manifest must keep residual AI action items out of remote write.",
    );
    const mutationManifest = readJson(path.join(repoRoot, finalize.json.files.mutation_manifest));
    assert.ok(scopeBlockerCodes(mutationManifest).has("dry_run_report_required"));
  } finally {
    fs.rmSync(finalizeCurationGateFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});
