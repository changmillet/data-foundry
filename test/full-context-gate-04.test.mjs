import test from "node:test";
import { annualSupplyFixtureRoot, assert, blockerCodes, bundledCategorySchemaNames, classificationFixtureRoot, contextFile, contextTextByPathSuffix, createFixture, createMutationManifestFixture, crypto, elementaryFlowManifestFixtureRoot, finalizeAutoQueueFixtureRoot, finalizeCurationGateFixtureRoot, finalizeIdentityPreflightFixtureRoot, finalizeLocationFixtureRoot, fixtureRoot, flowClassificationFixtureRoot, flowIdentityReferenceFixtureRoot, flowRow, flowRowWithClassification, fs, fullContextKinds, fullContextPatterns, identityPreflightRunFixtureRoot, itemBlockerCodes, locationFixtureRoot, mutationFixtureRoot, packageContextFixtureRoot, path, processRowWithDefaultClassification, processRowWithDeferredTrace, processRowWithFlowRef, processRowWithInvalidAnnualSupply, processRowWithInvalidLocation, processRowWithOnlyOutputExchange, qaPathFixtureRoot, readJson, readJsonLines, referenceClosureFixtureRoot, rel, repoRoot, runFoundry, scopeBlockerCodes, sha256Text, siblingCliBuildAvailable, siblingCliRoot, sourceExchangeFixtureRoot, sourceRow, spawnSync, supportManifestFixtureRoot, targetUserId, writeCompletedIdentityPreflightIndex, writeContextPackFiles, writeDecisionTaskFixture, writeJson, writeJsonLines, writeReadyFinalizeFixture, writeText } from "./helpers/full-context-gate-fixtures.mjs";


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
    const mutationManifest = readJson(
      path.join(repoRoot, finalize.json.files.mutation_manifest),
    );
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
          stage.stage === "curation_queue" &&
          stage.status === "ready" &&
          stage.exit_code === 0,
      ),
    );

    const gateReport = readJson(
      path.join(repoRoot, finalize.json.files.curation_gate_report),
    );
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
    assert.equal(
      authoringPackage.curation_queue_context.dependency_rows.length,
      1,
    );
    assert.match(
      JSON.stringify(
        authoringPackage.curation_queue_context.dependency_rows[0].input_rows,
      ),
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
          stage.stage === "curation_queue" &&
          stage.status === "ready" &&
          stage.exit_code === 0,
      ),
    );

    const gateReport = readJson(
      path.join(repoRoot, finalize.json.files.curation_gate_report),
    );
    assert.equal(gateReport.context.curation_queue.status, "ready");
    const authoringPackage = readJson(
      path.join(repoRoot, gateReport.entities[0].authoring_package),
    );
    const deterministicCodes = new Set(
      authoringPackage.deterministic_cleanup_items.map((item) => item.code),
    );
    assert.equal(deterministicCodes.has("curation_queue_context_required"), false);
    assert.equal(deterministicCodes.has("curation_queue_not_ready"), false);
    assert.equal(
      deterministicCodes.has("curation_queue_dependency_refs_unresolved"),
      false,
    );
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
        reason:
          "Fixture unresolved elementary flow cannot be safely mapped to a public flow.",
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
      externalizedRows[0].processDataSet.processInformation.dataSetInformation[
        "common:other"
      ]["tiangongfoundry:unresolvedExchangeTrace"];
    assert.equal(traces.length, 1);
    assert.equal(traces[0].reference_id, missingFlowId);
    assert.equal(
      traces[0].original_exchange.referenceToFlowDataSet["@refObjectId"],
      missingFlowId,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("post-authoring finalize externalizes exchanges for upstream blocked flow dependencies", () => {
  const root = path.join(
    finalizeAutoQueueFixtureRoot,
    "blocked-flow-dependency-trace",
  );
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
      externalizedRows[0].processDataSet.processInformation.dataSetInformation[
        "common:other"
      ]["tiangongfoundry:unresolvedExchangeTrace"];
    assert.equal(traces.length, 1);
    assert.equal(
      traces[0].action_item_code,
      "blocked_flow_dependency_exchange_externalized",
    );
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
  const rowsFile = path.join(
    finalizeCurationGateFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.dataSetInformation.name.baseName[
    "#text"
  ] = "xx Li salt, hydrometallurgical processing Li-ion batteries, at plant {GLO}";
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
        (stage) =>
          stage.stage === "post_authoring_curation_gate" &&
          stage.exit_code === 1,
      ),
    );
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "process_save_draft_dry_run" &&
          stage.status === "skipped",
      ),
    );
    assert.equal(finalize.json.files.dry_run_report, null);
    assert.ok(finalize.json.files.curation_gate_report);
    const gateReport = readJson(
      path.join(repoRoot, finalize.json.files.curation_gate_report),
    );
    assert.equal(gateReport.status, "blocked_needs_foundry_ai_authoring");
    assert.ok(gateReport.counts.action_items > 0);

    const authoringPackageFile = path.join(
      repoRoot,
      gateReport.entities[0].authoring_package,
    );
    const authoringPackage = readJson(authoringPackageFile);
    const actionCodes = new Set(
      authoringPackage.action_items.map((item) => item.code),
    );
    assert.ok(actionCodes.has("semantic_name_placeholder_token"));
    assert.ok(actionCodes.has("semantic_geography_token_in_name"));
    assert.ok(
      finalize.json.counts.mutation_manifest_blockers > 0,
      "Mutation manifest must keep residual AI action items out of remote write.",
    );
    const mutationManifest = readJson(
      path.join(repoRoot, finalize.json.files.mutation_manifest),
    );
    assert.ok(scopeBlockerCodes(mutationManifest).has("dry_run_report_required"));
  } finally {
    fs.rmSync(finalizeCurationGateFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("curation gate maps process QA functional unit findings to concrete TIDAS paths", () => {
  fs.rmSync(qaPathFixtureRoot, { recursive: true, force: true });
  const processId = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(qaPathFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);
  const schemaReport = path.join(
    qaPathFixtureRoot,
    "schema",
    "validation-report.json",
  );
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "completed",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "valid",
        issues: [],
      },
    ],
  });
  const qaReport = path.join(qaPathFixtureRoot, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "needs_review",
    blockers: [],
    findings: [
      {
        dataset_id: processId,
        dataset_version: "00.00.001",
        code: "process_missing_functional_unit",
        message:
          "Process quantitative reference functionalUnitOrOther is missing and should be curated by Foundry.",
      },
    ],
  });
  const context = writeContextPackFiles(qaPathFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(qaPathFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.counts.action_items, 1);

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(qaPathFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.equal(
      task.json.tasks[0].action_items[0].path,
      "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
    );
    assert.equal(
      task.json.tasks[0].action_items[0].json_pointer,
      "/processDataSet/processInformation/quantitativeReference/functionalUnitOrOther",
    );
    assert.notEqual(
      task.json.tasks[0].action_items[0].json_pointer,
      "/__AI_FILL_JSON_POINTER__",
    );
    assert.deepEqual(
      task.json.tasks[0].action_items[0].allowed_resolution_modes,
      ["evidence_backed_completion"],
    );

    const actionItem = task.json.tasks[0].action_items[0];
    const outputPatchFile = path.join(
      repoRoot,
      task.json.tasks[0].files.output_patch_file,
    );
    const authoringPackageFile = path.join(
      repoRoot,
      task.json.tasks[0].files.authoring_package,
    );
    writeJson(outputPatchFile, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(authoringPackageFile),
          operations: [
            {
              op: "add",
              path: "/processDataSet/processInformation/dataSetInformation/common:other",
              value: {
                "tiangongfoundry:unresolvedTrace": [
                  {
                    status: "unresolved_deferred",
                    action_item_code: actionItem.code,
                    blocked_path: actionItem.path,
                    reason:
                      "This test attempts to defer a required functional unit.",
                    evidence: {
                      source: "test",
                      quote_or_trace:
                        "functionalUnitOrOther is a formal business field and cannot be replaced by common:other trace.",
                    },
                    next_action:
                      "Provide an evidence-backed functionalUnitOrOther value instead of deferring it.",
                  },
                ],
              },
              basis:
                "Attempting to defer functionalUnitOrOther should be blocked.",
              evidence: {
                source: "test",
                quote_or_trace: "Functional unit is missing in the QA report.",
              },
              resolution: {
                mode: "deferred_to_common_other",
                used_context_kinds: fullContextKinds,
                summary:
                  "This mode is intentionally invalid for functional unit.",
              },
              closes_action_items: [
                {
                  code: actionItem.code,
                  path: actionItem.path,
                },
              ],
            },
          ],
        },
      ],
    });
    const deferredFunctionalUnit = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(qaPathFixtureRoot, "authoring-patches-deferred-fu")),
    ]);
    assert.equal(deferredFunctionalUnit.code, 1);
    assert.equal(deferredFunctionalUnit.json.status, "blocked");
    assert.ok(
      blockerCodes(deferredFunctionalUnit.json).has(
        "patch_resolution_mode_not_allowed_for_action_item",
      ),
    );
  } finally {
    fs.rmSync(qaPathFixtureRoot, { recursive: true, force: true });
  }
});

test("annual supply schema issues route to deterministic missing-data sentinel cleanup", () => {
  fs.rmSync(annualSupplyFixtureRoot, { recursive: true, force: true });
  const processId = "eeeeeeee-ffff-4000-8111-222222222222";
  const rowsFile = path.join(
    annualSupplyFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  writeJsonLines(rowsFile, [processRowWithInvalidAnnualSupply(processId)]);
  const schemaReport = path.join(
    annualSupplyFixtureRoot,
    "schema",
    "validation-report.json",
  );
  const annualSupplyPath =
    "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume";
  const annualSupplyTextPath = `${annualSupplyPath}.#text`;
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "invalid",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "invalid",
        issues: [
          {
            code: "invalid_format",
            path: annualSupplyTextPath,
            message:
              "annualSupplyOrProductionVolume.#text does not match the SDK numeric quantity pattern.",
          },
          {
            code: "annual_supply_or_production_volume_invalid",
            path: annualSupplyPath,
            message:
              "annualSupplyOrProductionVolume is not an annualized quantity.",
          },
        ],
      },
    ],
  });
  const qaReport = path.join(
    annualSupplyFixtureRoot,
    "qa",
    "process-qa-report.json",
  );
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const context = writeContextPackFiles(annualSupplyFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(annualSupplyFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_deterministic_cleanup");
    assert.equal(gate.json.counts.action_items, 0);
    assert.equal(gate.json.counts.deterministic_cleanup_items, 3);
    assert.equal(
      gate.json.processes[0].status,
      "needs_foundry_deterministic_cleanup",
    );
    const authoringPackage = readJson(
      path.join(repoRoot, gate.json.processes[0].authoring_package),
    );
    const annualCleanupItems =
      authoringPackage.deterministic_cleanup_items.filter(
        (item) => item.action_kind === "annual_supply_sentinel_completion",
      );
    assert.equal(annualCleanupItems.length, 2);
    assert.deepEqual(
      annualCleanupItems.map((item) => item.sentinel_value),
      ["9999 missing-data-sentinel/year", "9999 missing-data-sentinel/year"],
    );

    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(annualSupplyFixtureRoot, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    assert.equal(cleanup.json.counts.annual_supply_missing_data_sentinels, 1);
    const cleaned = readJsonLines(
      path.join(repoRoot, cleanup.json.files.cleaned_rows),
    )[0];
    assert.deepEqual(
      cleaned.processDataSet.modellingAndValidation
        .dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume,
      {
        "@xml:lang": "en",
        "#text": "9999 missing-data-sentinel/year",
      },
    );
    assert.equal(
      cleaned.processDataSet.processInformation.dataSetInformation[
        "common:other"
      ],
      undefined,
    );
  } finally {
    fs.rmSync(annualSupplyFixtureRoot, { recursive: true, force: true });
  }
});

test("curation cleanup fills placeholder annual supply with searchable sentinel", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "annual-supply-deterministic-cleanup-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "eeeeeeee-ffff-4000-8111-222222222223";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidAnnualSupply(processId)]);

  try {
    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(root, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    assert.equal(cleanup.json.counts.annual_supply_missing_data_sentinels, 1);

    const cleaned = readJsonLines(
      path.join(repoRoot, cleanup.json.files.cleaned_rows),
    )[0];
    assert.deepEqual(
      cleaned.processDataSet.modellingAndValidation
        .dataSourcesTreatmentAndRepresentativeness
        .annualSupplyOrProductionVolume,
      {
        "@xml:lang": "en",
        "#text": "9999 missing-data-sentinel/year",
      },
    );
    assert.equal(
      cleaned.processDataSet.processInformation.dataSetInformation[
        "common:other"
      ],
      undefined,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("output-only process exchanges require source exchange completeness trace", () => {
  fs.rmSync(sourceExchangeFixtureRoot, { recursive: true, force: true });
  const processId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  const rowsFile = path.join(
    sourceExchangeFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  writeJsonLines(rowsFile, [processRowWithOnlyOutputExchange(processId)]);
  const schemaReport = path.join(
    sourceExchangeFixtureRoot,
    "schema",
    "validation-report.json",
  );
  writeJson(schemaReport, {
    input_path: rel(rowsFile),
    status: "completed",
    rows: [
      {
        index: 0,
        id: processId,
        version: "00.00.001",
        type: "process",
        status: "valid",
        issues: [],
      },
    ],
  });
  const qaReport = path.join(
    sourceExchangeFixtureRoot,
    "qa",
    "process-qa-report.json",
  );
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const context = writeContextPackFiles(sourceExchangeFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.action_items, 1);
    const blockedAuthoringPackage = readJson(
      path.join(repoRoot, gate.json.entities[0].authoring_package),
    );
    assert.equal(
      blockedAuthoringPackage.action_items[0].code,
      "semantic_process_only_output_exchange_requires_review",
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.deepEqual(task.json.tasks[0].action_items[0].allowed_resolution_modes, [
      "source_trace_verified",
      "exchange_set_repaired",
    ]);
    const actionItem = task.json.tasks[0].action_items[0];
    const outputPatchFile = path.join(
      repoRoot,
      task.json.tasks[0].files.output_patch_file,
    );
    const authoringPackageFile = path.join(
      repoRoot,
      task.json.tasks[0].files.authoring_package,
    );
    const closes = [{ code: actionItem.code, path: actionItem.path }];
    const sourceCompletenessTrace = {
      status: "source_only_output_exchange_verified",
      action_item_code: actionItem.code,
      source: "source_trace",
      summary:
        "The source exchange list contains a product output and no input exchanges.",
      evidence: {
        source: "authoring_package.source_row",
        quote_or_trace:
          "processDataSet.exchanges.exchange[0].exchangeDirection = Output; no Input exchanges in source row.",
      },
    };
    const patchPayload = (commonOtherValue) => ({
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(authoringPackageFile),
          operations: [
            {
              op: "add",
              path: "/processDataSet/processInformation/dataSetInformation/common:other",
              value: commonOtherValue,
              basis:
                "The output-only exchange set is accepted only because the source row itself has only output exchanges.",
              evidence: {
                source: "authoring_package.source_row",
                quote_or_trace:
                  "The full authoring package source row lists only Output exchangeDirection values.",
              },
              resolution: {
                mode: "source_trace_verified",
                used_context_kinds: fullContextKinds,
                summary:
                  "Accept source-faithful output-only exchange set and preserve the verification trace.",
              },
              closes_action_items: closes,
            },
          ],
        },
      ],
    });

    writeJson(
      outputPatchFile,
      patchPayload({
        note: "Output-only exchanges were reviewed.",
      }),
    );
    const missingTraceCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(
        path.join(
          sourceExchangeFixtureRoot,
          "authoring-patches-missing-source-trace",
        ),
      ),
    ]);
    assert.equal(missingTraceCollect.code, 1);
    assert.equal(missingTraceCollect.json.status, "blocked");
    assert.equal(
      blockerCodes(missingTraceCollect.json).has(
        "patch_source_exchange_trace_missing",
      ),
      true,
    );

    writeJson(
      outputPatchFile,
      patchPayload({
        "@xmlns:tiangongfoundry":
          "https://tiangong-lca.dev/foundry/import-curation/1",
        "tiangongfoundry:sourceExchangeCompleteness": [
          sourceCompletenessTrace,
        ],
      }),
    );
    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "authoring-patches")),
    ]);
    assert.equal(collect.code, 0);
    assert.equal(collect.json.status, "ready_for_patch_apply");

    const patchedRowsFile = path.join(
      sourceExchangeFixtureRoot,
      "rows",
      "processes.patched.jsonl",
    );
    const apply = runFoundry([
      "dataset-patch-apply",
      "--input",
      rel(rowsFile),
      "--patch",
      collect.json.files.batch_patch,
      "--out",
      rel(patchedRowsFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "patch-apply")),
      "--authoring-package-dir",
      rel(path.dirname(authoringPackageFile)),
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.json.status, "completed");
    assert.equal(apply.json.evidence_count, 1);
    const patchedRow = readJsonLines(patchedRowsFile)[0];
    assert.equal(
      patchedRow.processDataSet.processInformation.dataSetInformation[
        "common:other"
      ]["tiangongfoundry:sourceExchangeCompleteness"][0].status,
      "source_only_output_exchange_verified",
    );

    const cleanup = runFoundry([
      "dataset-curation-cleanup",
      "--type",
      "process",
      "--rows-file",
      rel(patchedRowsFile),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "cleanup")),
    ]);
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.json.status, "completed");
    const cleanedRowsFile = path.join(repoRoot, cleanup.json.files.cleaned_rows);

    const cleanedSchemaReport = path.join(
      sourceExchangeFixtureRoot,
      "schema",
      "cleaned-validation-report.json",
    );
    writeJson(cleanedSchemaReport, {
      input_path: rel(cleanedRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: processId,
          version: "00.00.001",
          type: "process",
          status: "valid",
          issues: [],
        },
      ],
    });
    const cleanedQaReport = path.join(
      sourceExchangeFixtureRoot,
      "qa",
      "cleaned-process-qa-report.json",
    );
    writeJson(cleanedQaReport, {
      rows_file: rel(cleanedRowsFile),
      status: "completed",
      blockers: [],
      findings: [],
    });
	    const identityPreflightIndex = writeCompletedIdentityPreflightIndex(
	      sourceExchangeFixtureRoot,
	      [
	        {
	          datasetType: "process",
	          id: processId,
	          target: readJsonLines(cleanedRowsFile)[0],
	          name: "Heat production",
	          query:
            "process name: Heat production\nexchange signature: Output heat 1",
        },
      ],
    );
    const resolvedGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(cleanedRowsFile),
      "--schema-report",
      rel(cleanedSchemaReport),
      "--qa-report",
      rel(cleanedQaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "curation-gate-resolved")),
    ]);
    assert.equal(resolvedGate.code, 0);
    assert.equal(resolvedGate.json.status, "ready");
    assert.equal(resolvedGate.json.counts.action_items, 0);

    const progressJsonl = path.join(
      sourceExchangeFixtureRoot,
      "dry-run",
      "outputs",
      "save-draft-rpc",
      "progress.jsonl",
    );
    const failuresJsonl = path.join(
      sourceExchangeFixtureRoot,
      "dry-run",
      "outputs",
      "save-draft-rpc",
      "failures.jsonl",
    );
    writeJsonLines(progressJsonl, [
      {
        id: processId,
        version: "00.00.001",
        status: "prepared",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(failuresJsonl, []);
    const dryRunReport = path.join(
      sourceExchangeFixtureRoot,
      "dry-run",
      "outputs",
      "save-draft-rpc",
      "summary.json",
    );
    writeJson(dryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(cleanedRowsFile),
      files: {
        progress_jsonl: rel(progressJsonl),
        failures_jsonl: rel(failuresJsonl),
      },
    });

    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(cleanedRowsFile),
      "--schema-report",
      rel(cleanedSchemaReport),
      "--curation-gate-report",
      resolvedGate.json.files.report,
      "--cleanup-report",
      cleanup.json.files.report,
      "--dry-run-report",
      rel(dryRunReport),
      "--patch-collect-report",
      collect.json.files.report,
      "--require-patch-collect-report",
      "--patch-apply-report",
      apply.json.files.report,
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(sourceExchangeFixtureRoot, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 0);
    assert.equal(manifest.json.status, "ready_for_remote_write");
    assert.equal(
      manifest.json.counts.source_exchange_completeness_entries,
      1,
    );
    const traceRows = readJsonLines(
      path.join(repoRoot, manifest.json.files.source_exchange_completeness_traces),
    );
    assert.equal(traceRows.length, 1);
    assert.equal(traceRows[0].entity_id, processId);
    assert.equal(traceRows[0].trace_kind, "source_exchange_completeness");
    assert.equal(
      traceRows[0].status,
      "source_only_output_exchange_verified",
    );
    assert.equal(
      traceRows[0].evidence.quote_or_trace,
      sourceCompletenessTrace.evidence.quote_or_trace,
    );
  } finally {
    fs.rmSync(sourceExchangeFixtureRoot, { recursive: true, force: true });
  }
});
