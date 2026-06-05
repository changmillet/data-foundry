import test from "node:test";
import { acquireFullContextGateFileLock, annualSupplyFixtureRoot, assert, blockerCodes, bundledCategorySchemaNames, classificationFixtureRoot, contextFile, contextTextByPathSuffix, createFixture, createMutationManifestFixture, crypto, elementaryFlowManifestFixtureRoot, finalizeAutoQueueFixtureRoot, finalizeCurationGateFixtureRoot, finalizeIdentityPreflightFixtureRoot, finalizeLocationFixtureRoot, fixtureRoot, flowClassificationFixtureRoot, flowIdentityReferenceFixtureRoot, flowRow, flowRowWithClassification, fs, fullContextKinds, fullContextPatterns, identityPreflightRunFixtureRoot, itemBlockerCodes, locationFixtureRoot, mutationFixtureRoot, packageContextFixtureRoot, path, processRowWithDefaultClassification, processRowWithDeferredTrace, processRowWithFlowRef, processRowWithInvalidAnnualSupply, processRowWithInvalidLocation, processRowWithOnlyOutputExchange, qaPathFixtureRoot, readJson, readJsonLines, referenceClosureFixtureRoot, rel, repoRoot, runFoundry, scopeBlockerCodes, sha256Text, siblingCliBuildAvailable, siblingCliRoot, sourceExchangeFixtureRoot, sourceRow, spawnSync, supportManifestFixtureRoot, targetUserId, writeCompletedIdentityPreflightIndex, writeContextPackFiles, writeDecisionTaskFixture, writeJson, writeJsonLines, writeReadyFinalizeFixture, writeText } from "./helpers/full-context-gate-fixtures.mjs";

acquireFullContextGateFileLock();

test("identity decision task deduplicates repeated targets and keeps source evidence", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "identity-decision-task-dedupe-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000061";
  const firstProcessId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000062";
  const secondProcessId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000063";

  function writePackage(processId, label) {
    const authoringPackage = path.join(root, `${label}.authoring-package.json`);
    writeJson(authoringPackage, {
      schema_version: 2,
      profile: "bafu",
      dataset_type: "process",
      entity_id: processId,
      version: "00.00.001",
      contract_context_files: fullContextKinds.map((kind) => ({
        kind,
        path: `${kind}.fixture`,
        text: `${kind} context`,
      })),
      missing_context_files: [],
      full_context_ai_completion: {
        required_context_kinds: fullContextKinds,
      },
      action_items: [
        {
          code: "identity_preflight_manual_review",
          dependency_type: "flow",
          dependency_id: flowId,
          dependency_version: "00.00.001",
          relation: "exchange",
          evidence: {
            target: {
              dataset_type: "flow",
              id: flowId,
              name: "Natural gas",
            },
            remote_search: {
              endpoint: "flow_hybrid_search",
              query: `flow name: Natural gas\nusing process: ${label}`,
              candidate_count: 1,
            },
            top_candidates: [
              {
                id: `candidate-${label}`,
                name: "Natural gas, burned in boiler",
              },
            ],
          },
        },
      ],
    });
    return {
      packageRef: rel(authoringPackage),
      packageSha: sha256Text(fs.readFileSync(authoringPackage, "utf8")),
    };
  }

  const firstPackage = writePackage(firstProcessId, "first-process");
  const secondPackage = writePackage(secondProcessId, "second-process");
  const curationGateReport = path.join(root, "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 1,
    status: "blocked",
    entities: [
      {
        dataset_type: "process",
        entity_id: firstProcessId,
        version: "00.00.001",
        authoring_package: firstPackage.packageRef,
        authoring_package_sha256: firstPackage.packageSha,
      },
      {
        dataset_type: "process",
        entity_id: secondProcessId,
        version: "00.00.001",
        authoring_package: secondPackage.packageRef,
        authoring_package_sha256: secondPackage.packageSha,
      },
    ],
  });

  try {
    const identityTask = runFoundry([
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--out-dir",
      rel(path.join(root, "identity-decision-task")),
    ]);
    assert.equal(identityTask.code, 0);
    assert.equal(identityTask.json.status, "ready_for_ai_identity_decisions");
    assert.equal(identityTask.json.counts.identity_action_items, 2);
    assert.equal(identityTask.json.counts.unique_identity_targets, 1);
    assert.equal(identityTask.json.counts.selected_identity_action_items, 2);
    assert.equal(identityTask.json.counts.selected_unique_identity_targets, 1);
    assert.equal(identityTask.json.counts.deduplicated_identity_action_items, 1);
    assert.equal(identityTask.json.counts.template_decisions, 1);

    const templateRows = readJsonLines(
      path.join(repoRoot, identityTask.json.files.template),
    );
    assert.equal(templateRows.length, 1);
    assert.equal(templateRows[0].dataset_type, "flow");
    assert.equal(templateRows[0].dataset_id, flowId);
    assert.deepEqual(templateRows[0].closes_action_items, [
      "identity_preflight_manual_review",
    ]);
    assert.equal(templateRows[0].evidence.source_action_item_count, 2);
    assert.equal(templateRows[0].evidence.source_action_items.length, 2);
    assert.deepEqual(
      templateRows[0].evidence.related_authoring_packages.map(
        (item) => item.authoring_package,
      ),
      [firstPackage.packageRef, secondPackage.packageRef],
    );

    const identityBundle = readJson(
      path.join(repoRoot, identityTask.json.files.shared_context_bundle),
    );
    assert.equal(identityBundle.counts.files, fullContextKinds.length);
    assert.equal(identityBundle.counts.references, fullContextKinds.length * 2);
    assert.equal(identityBundle.counts.duplicate_references, fullContextKinds.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("curation gate turns flow identity manual review into an AI action item", () => {
  const root = path.join(repoRoot, "tmp", "flow-identity-manual-review-gate-test");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000020";
  const rowsFile = path.join(root, "rows", "flows.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Elementary flow",
      classification: {
        "common:elementaryFlowCategorization": {
          "common:category": [
            { "@level": "0", "@catId": "Emissions", "#text": "Emissions" },
            {
              "@level": "1",
              "@catId": "Emissions to air",
              "#text": "Emissions to air",
            },
          ],
        },
      },
    }),
  ]);

  try {
    const context = writeContextPackFiles(root);
    const schemaReport = path.join(root, "schema", "validation-report.json");
    writeJson(schemaReport, {
      input_path: rel(rowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: flowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const qaReport = path.join(root, "qa", "flow_qa_report.json");
    writeJson(qaReport, {
      rows_file: rel(rowsFile),
      status: "completed_local_flow_qa",
      findings: [],
      rule_findings: [],
    });
    const identityIndex = writeCompletedIdentityPreflightIndex(root, [
      {
        datasetType: "flow",
        id: flowId,
        name: "Methane",
        decision: "manual_review",
        status: "needs_review",
        confidence: "low",
        fields: { type_of_dataset: "Elementary flow" },
        candidates: [
          {
            index: 0,
            id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000021",
            version: "03.00.004",
            state_code: 100,
            names: ["Methane"],
            fields: { type_of_dataset: "Elementary flow" },
            match_score: 60,
            match_reasons: ["overlapping_name", "same_flow_type"],
            decision_hint: "manual_review",
          },
        ],
      },
    ]);

    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
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
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(root, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.identity_action_items, 1);
    const authoringPackage = readJson(
      path.join(repoRoot, gate.json.entities[0].authoring_package),
    );
    const actionCodes = new Set(
      authoringPackage.action_items.map((item) => item.code),
    );
    assert.equal(
      actionCodes.has("elementary_flow_identity_manual_review"),
      true,
    );
    assert.equal(
      actionCodes.has("elementary_flow_requires_existing_database_match"),
      true,
    );
    const identityAction = authoringPackage.action_items.find(
      (item) => item.code === "elementary_flow_identity_manual_review",
    );
    assert.equal(identityAction.common_other_deferral_allowed, false);
    assert.equal(identityAction.evidence.candidate_count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("curation gate authoring package carries full contract text and queue dependency rows", () => {
  fs.rmSync(packageContextFixtureRoot, { recursive: true, force: true });
  const processId = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
  const flowId = "dddddddd-eeee-4fff-8aaa-cccccccccccc";
  const sourceId = "eeeeeeee-ffff-4000-8aaa-dddddddddddd";
  const rowsDir = path.join(packageContextFixtureRoot, "rows");
  const processRows = path.join(rowsDir, "processes.jsonl");
  const flowRows = path.join(rowsDir, "flows.jsonl");
  const sourceRows = path.join(rowsDir, "sources.jsonl");
  writeJsonLines(processRows, [processRowWithFlowRef(processId, flowId)]);
  writeJsonLines(flowRows, [flowRow(flowId)]);
  writeJsonLines(sourceRows, [sourceRow(sourceId)]);

  try {
    const queue = runFoundry([
      "dataset-curation-queue-build",
      "--processes",
      rel(processRows),
      "--flows",
      rel(flowRows),
      "--support",
      rel(sourceRows),
      "--out-dir",
      rel(path.join(packageContextFixtureRoot, "curation-queue")),
    ]);
    assert.equal(queue.code, 0);
    assert.equal(queue.json.status, "ready");

    const schemaReport = path.join(
      packageContextFixtureRoot,
      "schema",
      "validation-report.json",
    );
    writeJson(schemaReport, {
      input_path: rel(processRows),
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
      packageContextFixtureRoot,
      "qa",
      "process-qa-report.json",
    );
    writeJson(qaReport, {
      rows_file: rel(processRows),
      status: "completed",
      blockers: [],
      findings: [],
    });
    const context = writeContextPackFiles(packageContextFixtureRoot);
    const identityPreflightRoot = path.join(
      packageContextFixtureRoot,
      "identity-preflight",
    );
    const identityPreflightRequestsRoot = path.join(
      packageContextFixtureRoot,
      "identity-preflight-requests",
    );
    const processRequest = path.join(
      identityPreflightRequestsRoot,
      "processes",
      `${processId}.json`,
    );
    const flowRequest = path.join(
      identityPreflightRequestsRoot,
      "flows",
      `${flowId}.json`,
    );
    writeJson(processRequest, {
      schema_version: 1,
      target: processRowWithFlowRef(processId, flowId),
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        limit: 20,
        query:
          "process name: Fixture process\nreference flow: Fixture flow\ngeography: CH",
      },
    });
    writeJson(flowRequest, {
      schema_version: 1,
      target: flowRow(flowId),
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        limit: 20,
        filter: { flowType: "Product flow" },
        query:
          "flow name: Fixture flow\nflow type: Product flow\nreference property: Mass",
      },
    });
    const processPreflightReport = path.join(
      identityPreflightRoot,
      "processes",
      processId,
      "outputs",
      "identity-decision.json",
    );
    const flowPreflightReport = path.join(
      identityPreflightRoot,
      "flows",
      flowId,
      "outputs",
      "identity-decision.json",
    );
    const flowCandidates = path.join(
      identityPreflightRoot,
      "flows",
      flowId,
      "outputs",
      "identity-candidates.jsonl",
    );
    writeJson(processPreflightReport, {
      schema_version: 1,
      kind: "process",
      status: "passed",
      decision: "create_new",
      confidence: "medium",
      target: {
        id: processId,
        version: "00.00.001",
        names: ["Fixture process"],
        fields: { geography: "CH" },
        exchange_signature: [`${flowId}:output:1`],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates: [],
      candidate_sources: [
        {
          kind: "remote_search",
          endpoint: "process_hybrid_search",
          query:
            "process name: Fixture process\nreference flow: Fixture flow\ngeography: CH",
          row_count: 0,
          scanned_files: [],
        },
      ],
      findings: [],
      blockers: [],
      next_action: "materialize_new_payload",
      files: {},
    });
    writeJson(flowPreflightReport, {
      schema_version: 1,
      kind: "flow",
      status: "passed",
      decision: "reuse",
      confidence: "high",
      target: {
        id: flowId,
        version: "00.00.001",
        names: ["Fixture flow"],
        fields: { type_of_dataset: "Product flow", flow_property: "Mass" },
        exchange_signature: [],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates: [
        {
          index: 0,
          id: "ffffffff-1111-4222-8333-444444444444",
          version: "00.00.001",
          state_code: 100,
          names: ["Existing fixture flow"],
          fields: { type_of_dataset: "Product flow", flow_property: "Mass" },
          exchange_signature: [],
          identity_key: "existing fixture flow|product flow|mass",
          match_score: 100,
          match_reasons: ["same_dataset_id"],
          decision_hint: "reuse",
        },
      ],
      candidate_sources: [
        {
          kind: "remote_search",
          endpoint: "flow_hybrid_search",
          query:
            "flow name: Fixture flow\nflow type: Product flow\nreference property: Mass",
          filter: { flowType: "Product flow" },
          row_count: 1,
          scanned_files: [],
        },
      ],
      findings: [],
      blockers: [],
      next_action: "reuse_existing",
      files: {
        candidates: rel(flowCandidates),
      },
    });
    writeJsonLines(flowCandidates, [
      {
        index: 0,
        id: "ffffffff-1111-4222-8333-444444444444",
        version: "00.00.001",
        state_code: 100,
        names: ["Existing fixture flow"],
        fields: { type_of_dataset: "Product flow", flow_property: "Mass" },
        exchange_signature: [],
        identity_key: "existing fixture flow|product flow|mass",
        match_score: 100,
        match_reasons: ["same_dataset_id"],
        decision_hint: "reuse",
      },
    ]);
    const identityPreflightIndex = path.join(
      identityPreflightRequestsRoot,
      "identity-preflight-requests.jsonl",
    );
    writeJsonLines(identityPreflightIndex, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        request_file: rel(processRequest),
        output_dir: rel(path.dirname(path.dirname(processPreflightReport))),
        expected_report_file: rel(processPreflightReport),
        command: "tiangong-lca process identity-preflight --input process.json",
        remote_search: {
          data_source: "tg",
          limit: 20,
          query:
            "process name: Fixture process\nreference flow: Fixture flow\ngeography: CH",
        },
      },
      {
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        request_file: rel(flowRequest),
        output_dir: rel(path.dirname(path.dirname(flowPreflightReport))),
        expected_report_file: rel(flowPreflightReport),
        expected_candidates_file: rel(flowCandidates),
        command: "tiangong-lca flow identity-preflight --input flow.json",
        remote_search: {
          data_source: "tg",
          limit: 20,
          filter: { flowType: "Product flow" },
          query:
            "flow name: Fixture flow\nflow type: Product flow\nreference property: Mass",
        },
      },
    ]);
    const identityReferenceRewrites = path.join(
      packageContextFixtureRoot,
      "identity-reference-rewrites",
      "identity-reference-rewrites.jsonl",
    );
    writeJsonLines(identityReferenceRewrites, [
      {
        relation: "flow_reference_to_identity_preflight_duplicate",
        action: "rewrite_to_identity_preflight_duplicate_reference",
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        row_index: 0,
        path: "processDataSet.exchanges.exchange.0.referenceToFlowDataSet",
        original: {
          table: "flows",
          ref_object_id: flowId,
          version: "00.00.001",
          short_description: "Fixture flow",
        },
        canonical: {
          table: "flows",
          ref_object_id: "ffffffff-1111-4222-8333-444444444444",
          version: "00.00.001",
          short_description: "Existing fixture flow",
        },
        identity_preflight: {
          index_file: rel(identityPreflightIndex),
          report_file: rel(flowPreflightReport),
          decision: "reuse",
          status: "passed",
          confidence: "high",
          candidate_index: 0,
          candidate_match_reasons: ["same_dataset_id"],
        },
        reason:
          "Fixture rewrite proof shows the final process reference can point at the existing database flow selected by identity-preflight.",
      },
    ]);
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(processRows),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--queue-dir",
      rel(path.join(packageContextFixtureRoot, "curation-queue")),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--identity-reference-rewrites",
      rel(identityReferenceRewrites),
      "--out-dir",
      rel(path.join(packageContextFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 0);
    assert.equal(gate.json.status, "ready");
    assert.equal(gate.json.counts.identity_preflight_rows, 2);
    assert.equal(gate.json.context.identity_preflight.completed, 2);
    assert.equal(gate.json.counts.identity_reference_rewrites, 1);
    assert.equal(gate.json.context.identity_reference_rewrites.scoped_rows, 1);

    const authoringPackage = readJson(
      path.join(repoRoot, gate.json.entities[0].authoring_package),
    );
    const contextByKind = new Map(
      authoringPackage.contract_context_files.map((file) => [
        file.kind,
        file.text,
      ]),
    );
    assert.match(contextByKind.get("schema"), /process schema/u);
    assert.match(
      contextByKind.get("methodology_yaml"),
      /source_language_only/u,
    );
    assert.match(contextByKind.get("ruleset"), /classification-decision/u);
    assert.match(
      contextTextByPathSuffix(
        authoringPackage,
        "tidas_processes_category.json",
      ),
      /Manufacturing/u,
    );
    assert.match(
      contextTextByPathSuffix(
        authoringPackage,
        "tidas_flows_product_category.json",
      ),
      /Electrical energy/u,
    );
    assert.match(
      contextTextByPathSuffix(
        authoringPackage,
        "tidas_locations_category.json",
      ),
      /Switzerland/u,
    );
    assert.equal(
      authoringPackage.identity_preflight_context.current.result.decision,
      "create_new",
    );
    assert.match(
      authoringPackage.identity_preflight_context.current.remote_search.query,
      /reference flow: Fixture flow/u,
    );
    assert.equal(
      authoringPackage.identity_preflight_context.dependencies[0]
        .identity_preflight.result.decision,
      "reuse",
    );
    assert.deepEqual(
      authoringPackage.identity_preflight_context.dependencies[0]
        .identity_preflight.result.candidates[0].names,
      ["Existing fixture flow"],
    );
    assert.equal(
      authoringPackage.identity_reference_rewrite_context.status,
      "attached",
    );
    assert.equal(
      authoringPackage.identity_reference_rewrite_context.rows[0].canonical
        .ref_object_id,
      "ffffffff-1111-4222-8333-444444444444",
    );
    assert.equal(authoringPackage.curation_queue_context.status, "attached");
    assert.equal(
      authoringPackage.curation_queue_context.dependency_rows.length,
      1,
    );
    assert.equal(
      authoringPackage.curation_queue_context.support_rows.length,
      1,
    );
    assert.match(
      JSON.stringify(
        authoringPackage.curation_queue_context.dependency_rows[0].input_rows,
      ),
      new RegExp(flowId, "u"),
    );
    assert.match(
      JSON.stringify(
        authoringPackage.curation_queue_context.support_rows[0].input_rows,
      ),
      new RegExp(sourceId, "u"),
    );
  } finally {
    fs.rmSync(packageContextFixtureRoot, { recursive: true, force: true });
  }
});

test("curation gate can require completed identity preflight before full-context AI authoring", () => {
  const root = path.join(repoRoot, "tmp", "identity-preflight-gate-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "abababab-cccc-4ddd-8eee-ffffffffffff";
  const flowId = "bcbcbcbc-dddd-4eee-8fff-aaaaaaaaaaaa";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, flowId)]);
  const schemaReport = path.join(root, "schema", "validation-report.json");
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
  const qaReport = path.join(root, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const context = writeContextPackFiles(root);

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
      "--require-identity-preflight",
      "--out-dir",
      rel(path.join(root, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.entities[0].deterministic_cleanup_count, 1);
    const authoringPackage = readJson(
      path.join(repoRoot, gate.json.entities[0].authoring_package),
    );
    assert.equal(
      authoringPackage.deterministic_cleanup_items[0].code,
      "identity_preflight_index_required",
    );

    const requestFile = path.join(
      root,
      "identity-preflight-requests",
      "processes",
      `${processId}.json`,
    );
    writeJson(requestFile, {
      schema_version: 1,
      target: processRowWithFlowRef(processId, flowId),
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        query: "process name: Heat production",
      },
    });
    const reportFile = path.join(
      root,
      "identity-preflight",
      "processes",
      processId,
      "outputs",
      "identity-decision.json",
    );
    writeJson(reportFile, {
      schema_version: 1,
      kind: "process",
      status: "passed",
      decision: "create_new",
      confidence: "medium",
      target: {
        id: processId,
        version: "00.00.001",
        names: ["Heat production"],
        fields: {},
        exchange_signature: [],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates: [],
      candidate_sources: [],
      findings: [],
      blockers: [],
      next_action: "materialize_new_payload",
      files: {},
    });
    const indexFile = path.join(
      root,
      "identity-preflight-requests",
      "identity-preflight-requests.jsonl",
    );
    writeJsonLines(indexFile, [
      {
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        request_file: rel(requestFile),
        output_dir: rel(path.dirname(path.dirname(reportFile))),
        expected_report_file: rel(reportFile),
      },
    ]);
    const gateWithIdentity = runFoundry([
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
      "--identity-preflight-index",
      rel(indexFile),
      "--require-identity-preflight",
      "--out-dir",
      rel(path.join(root, "curation-gate-with-identity")),
    ]);
    assert.equal(gateWithIdentity.code, 1);
    assert.equal(
      gateWithIdentity.json.status,
      "blocked_needs_foundry_ai_authoring",
    );
    assert.equal(gateWithIdentity.json.entities[0].deterministic_cleanup_count, 0);
    assert.equal(gateWithIdentity.json.context.identity_preflight.completed, 1);

    writeJson(requestFile, {
      schema_version: 1,
      target: processRowWithFlowRef(
        processId,
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      ),
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        query: "process name: Heat production",
      },
    });
    const gateWithStaleIdentity = runFoundry([
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
      "--identity-preflight-index",
      rel(indexFile),
      "--require-identity-preflight",
      "--out-dir",
      rel(path.join(root, "curation-gate-with-stale-identity")),
    ]);
    assert.equal(gateWithStaleIdentity.code, 1);
    assert.equal(
      gateWithStaleIdentity.json.entities[0].deterministic_cleanup_count,
      1,
    );
    const staleAuthoringPackage = readJson(
      path.join(
        repoRoot,
        gateWithStaleIdentity.json.entities[0].authoring_package,
      ),
    );
    assert.equal(
      staleAuthoringPackage.deterministic_cleanup_items[0].code,
      "identity_preflight_current_scope_stale",
    );
    assert.equal(
      staleAuthoringPackage.identity_preflight_context.current.freshness
        .current_payload_matches_request,
      false,
    );
    writeJson(requestFile, {
      schema_version: 1,
      target: processRowWithFlowRef(processId, flowId),
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        query: "process name: Heat production",
      },
    });

    const gateWithRequiredQueue = runFoundry([
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
      "--identity-preflight-index",
      rel(indexFile),
      "--require-identity-preflight",
      "--require-queue-context",
      "--out-dir",
      rel(path.join(root, "curation-gate-with-required-queue")),
    ]);
    assert.equal(gateWithRequiredQueue.code, 1);
    assert.equal(
      gateWithRequiredQueue.json.entities[0].deterministic_cleanup_count,
      1,
    );
    assert.equal(
      gateWithRequiredQueue.json.context.require_queue_context,
      true,
    );
    const queuePackage = readJson(
      path.join(repoRoot, gateWithRequiredQueue.json.entities[0].authoring_package),
    );
    assert.equal(
      queuePackage.deterministic_cleanup_items[0].code,
      "curation_queue_context_required",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bafu curation gate rejects refreshed identity preflight that drops source context", () => {
  const root = path.join(repoRoot, "tmp", "identity-preflight-source-context-gate-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "abababab-cccc-4ddd-8eee-ffffffff0001";
  const flowId = "bcbcbcbc-dddd-4eee-8fff-aaaaaaaa0001";
  const rowsDir = path.join(root, "rows");
  const processRows = path.join(rowsDir, "processes.jsonl");
  const flowRows = path.join(rowsDir, "flows.jsonl");
  const processPayload = processRowWithFlowRef(processId, flowId);
  const flowPayload = flowRow(flowId);
  writeJsonLines(processRows, [processPayload]);
  writeJsonLines(flowRows, [flowPayload]);
  const schemaReport = path.join(root, "schema", "validation-report.json");
  writeJson(schemaReport, {
    input_path: rel(processRows),
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
  const qaReport = path.join(root, "qa", "process-qa-report.json");
  writeJson(qaReport, {
    rows_file: rel(processRows),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const context = writeContextPackFiles(root);
  const sourceFile = path.join(root, "source", "flow-original.json");
  writeJson(sourceFile, flowPayload);

  const requestRoot = path.join(root, "identity-preflight-requests");
  const outputRoot = path.join(root, "identity-preflight");
  const processRequest = path.join(requestRoot, "processes", `${processId}.json`);
  const flowRequest = path.join(requestRoot, "flows", `${flowId}.json`);
  const processReport = path.join(
    outputRoot,
    "processes",
    processId,
    "outputs",
    "identity-decision.json",
  );
  const flowReport = path.join(
    outputRoot,
    "flows",
    flowId,
    "outputs",
    "identity-decision.json",
  );
  writeJson(processRequest, {
    schema_version: 1,
    target: processPayload,
    remote_candidate_search: {
      enabled: true,
      data_source: "tg",
      query: "process name: Heat production",
    },
  });
  writeJson(flowRequest, {
    schema_version: 1,
    target: flowPayload,
    remote_candidate_search: {
      enabled: true,
      data_source: "tg",
      query: "flow name: Fixture flow",
    },
  });
  for (const [kind, reportFile, id] of [
    ["process", processReport, processId],
    ["flow", flowReport, flowId],
  ]) {
    writeJson(reportFile, {
      schema_version: 1,
      kind,
      status: "passed",
      decision: "create_new",
      confidence: "medium",
      target: {
        id,
        version: "00.00.001",
        names: ["Fixture"],
        fields: {},
        exchange_signature: [],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates: [],
      candidate_sources: [],
      findings: [],
      blockers: [],
      next_action: "materialize_new_payload",
      files: {},
    });
  }
  const indexFile = path.join(requestRoot, "identity-preflight-requests.jsonl");
  writeJsonLines(indexFile, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      request_file: rel(processRequest),
      output_dir: rel(path.dirname(path.dirname(processReport))),
      expected_report_file: rel(processReport),
    },
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      source_file: rel(sourceFile),
      request_file: rel(flowRequest),
      output_dir: rel(path.dirname(path.dirname(flowReport))),
      expected_report_file: rel(flowReport),
    },
  ]);

  try {
    const queue = runFoundry([
      "dataset-curation-queue-build",
      "--processes",
      rel(processRows),
      "--flows",
      rel(flowRows),
      "--out-dir",
      rel(path.join(root, "curation-queue")),
    ]);
    assert.equal(queue.code, 0);
    assert.equal(queue.json.status, "ready");

    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(processRows),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--queue-dir",
      rel(path.join(root, "curation-queue")),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(indexFile),
      "--require-identity-preflight",
      "--out-dir",
      rel(path.join(root, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    const authoringPackage = readJson(
      path.join(repoRoot, gate.json.entities[0].authoring_package),
    );
    const deterministicCodes = new Set(
      authoringPackage.deterministic_cleanup_items.map((item) => item.code),
    );
    assert.equal(
      deterministicCodes.has("identity_preflight_current_source_context_missing"),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity preflight batch runner records timed-out CLI rows without hanging", () => {
  fs.rmSync(identityPreflightRunFixtureRoot, { recursive: true, force: true });
  const flowId = "12345678-2222-4333-8444-555555555555";
  const requestFile = path.join(
    identityPreflightRunFixtureRoot,
    "requests",
    "flows",
    `${flowId}.json`,
  );
  const outputDir = path.join(
    identityPreflightRunFixtureRoot,
    "identity-preflight",
    "flows",
    flowId,
  );
  const reportFile = path.join(outputDir, "outputs", "identity-decision.json");
  const indexFile = path.join(
    identityPreflightRunFixtureRoot,
    "identity-preflight-requests",
    "identity-preflight-requests.jsonl",
  );
  const fakeCli = path.join(identityPreflightRunFixtureRoot, "bin", "fake-cli.js");
  writeText(
    fakeCli,
    [
      "#!/usr/bin/env node",
      "setTimeout(() => {}, 10_000);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(fakeCli, 0o755);
  writeJson(requestFile, {
    schema_version: 1,
    target: {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": flowId,
            "common:shortName": [{ "@xml:lang": "en", "#text": "Mercury" }],
          },
        },
      },
    },
    remote_candidate_search: {
      enabled: true,
      data_source: "tg",
      query: "flow name: Mercury",
    },
  });
  writeJsonLines(indexFile, [
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      request_file: rel(requestFile),
      output_dir: rel(outputDir),
      expected_report_file: rel(reportFile),
    },
  ]);

  try {
    const result = runFoundry(
      [
        "dataset-identity-preflight-run",
        "--index",
        rel(indexFile),
        "--out-dir",
        rel(path.join(identityPreflightRunFixtureRoot, "run")),
        "--timeout-ms",
        "20",
      ],
      {
        env: {
          TIANGONG_LCA_CLI_BIN: fakeCli,
        },
        timeout: 2_000,
      },
    );
    assert.equal(result.code, 1);
    assert.equal(result.json.status, "failed");
    assert.equal(result.json.runtime_options.timeout_ms, 20);
    assert.ok(result.json.runtime_options.spawn_timeout_ms >= 270);
    assert.equal(result.json.counts.failed, 1);
    assert.equal(result.json.results[0].failure_code, "identity_preflight_timeout");
    assert.equal(result.json.results[0].status, "failed");
    assert.equal(result.json.results[0].report_status, null);
    assert.equal(result.json.results[0].decision, null);
    assert.ok(fs.existsSync(path.join(repoRoot, result.json.results[0].stdout_log)));
    assert.ok(fs.existsSync(path.join(repoRoot, result.json.results[0].stderr_log)));
  } finally {
    fs.rmSync(identityPreflightRunFixtureRoot, { recursive: true, force: true });
  }
});

test("identity preflight index merge preserves dependency rows while refreshing current scope", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "identity-preflight-index-merge-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const baseIndex = path.join(root, "base", "identity-preflight-requests.jsonl");
  const updateIndex = path.join(
    root,
    "fresh",
    "identity-preflight-requests.jsonl",
  );
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000501";
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000502";
  writeJsonLines(baseIndex, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      target_sha256: "old-process-sha",
      request_file: "base/process.json",
      report_file: "base/process-report.json",
    },
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      target_sha256: "dependency-flow-sha",
      request_file: "base/flow.json",
      report_file: "base/flow-report.json",
    },
  ]);
  writeJsonLines(updateIndex, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      target_sha256: "fresh-process-sha",
      request_file: "fresh/process.json",
      report_file: "fresh/process-report.json",
    },
  ]);

  try {
    const merge = runFoundry([
      "dataset-identity-preflight-index-merge",
      "--base-index",
      rel(baseIndex),
      "--update-index",
      rel(updateIndex),
      "--out-dir",
      rel(path.join(root, "merged")),
    ]);
    assert.equal(merge.code, 0, JSON.stringify(merge.json, null, 2));
    assert.equal(merge.json.status, "ready");
    assert.equal(merge.json.counts.base_rows, 2);
    assert.equal(merge.json.counts.update_rows, 1);
    assert.equal(merge.json.counts.replaced_rows, 1);
    assert.equal(merge.json.counts.added_rows, 0);
    assert.equal(merge.json.counts.output_rows, 2);

    const mergedRows = readJsonLines(
      path.join(repoRoot, merge.json.files.merged_index),
    );
    assert.equal(mergedRows.length, 2);
    const processRow = mergedRows.find((row) => row.dataset_type === "process");
    const flowRow = mergedRows.find((row) => row.dataset_type === "flow");
    assert.equal(processRow.target_sha256, "fresh-process-sha");
    assert.equal(processRow.request_file, "fresh/process.json");
    assert.equal(processRow.merge_source, "update");
    assert.equal(flowRow.target_sha256, "dependency-flow-sha");
    assert.equal(flowRow.request_file, "base/flow.json");
    assert.equal(flowRow.merge_source, "base");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity preflight request refresh inherits source trace context from source index", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "identity-preflight-source-index-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000601";
  const processRow = {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Fixture process from patched row",
            },
          },
        },
        quantitativeReference: {
          functionalUnitOrOther: {
            "@xml:lang": "en",
            "#text": "1 fixture product",
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
  const sourcePayload = JSON.parse(JSON.stringify(processRow));
  sourcePayload.processDataSet.processInformation.dataSetInformation[
    "common:other"
  ] = {
    "tidasimport:sourceTrace": {
      payload: {
        sourceClassification: {
          category: "source energy supply",
          subCategory: "source natural gas transport",
        },
        attributes: [
          { name: "localName", value: "Quellprozess lokaler Name" },
          { name: "location", value: "CH" },
          { name: "text", value: "Source technology route from package" },
          {
            name: "includedProcesses",
            value: "Source system boundary from package",
          },
        ],
      },
    },
  };

  const rowsFile = path.join(root, "rows", "processes.patched.jsonl");
  const sourceFile = path.join(root, "source", "process.original.json");
  const sourceIndex = path.join(root, "base", "identity-preflight-requests.jsonl");
  writeJsonLines(rowsFile, [processRow]);
  writeJson(sourceFile, sourcePayload);
  writeJsonLines(sourceIndex, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      source_file: rel(sourceFile),
      request_file: "base/process.json",
    },
  ]);

  try {
    const build = runFoundry([
      "dataset-identity-preflight-requests-build",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--source-index",
      rel(sourceIndex),
      "--out-dir",
      rel(path.join(root, "refresh")),
    ]);
    assert.equal(build.code, 0, JSON.stringify(build.json, null, 2));
    assert.equal(build.json.status, "ready");
    assert.equal(build.json.counts.source_index_files, 1);
    assert.equal(build.json.counts.source_context_matches, 1);
    assert.equal(build.json.counts.source_context_missing_matches, 0);

    const indexRows = readJsonLines(
      path.join(repoRoot, build.json.files.identity_preflight_requests),
    );
    assert.equal(indexRows.length, 1);
    assert.equal(indexRows[0].source_file, rel(sourceFile));
    const request = readJson(path.join(repoRoot, indexRows[0].request_file));
    const query = request.remote_candidate_search.query;
    assert.match(query, /Quellprozess lokaler Name/u);
    assert.match(query, /source energy supply/u);
    assert.match(query, /source natural gas transport/u);
    assert.match(query, /Source technology route from package/u);
    assert.match(query, /Source system boundary from package/u);
    assert.match(query, /geography: CH/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("curation gate attaches location queue context as a concrete AI action item", () => {
  fs.rmSync(locationFixtureRoot, { recursive: true, force: true });
  const processId = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
  const rowsFile = path.join(locationFixtureRoot, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);
  const schemaReport = path.join(
    locationFixtureRoot,
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
    locationFixtureRoot,
    "qa",
    "process-qa-report.json",
  );
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const locationQueue = path.join(
    locationFixtureRoot,
    "location-authoring-queue.jsonl",
  );
  const locationPath =
    "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location";
  writeJsonLines(locationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      code: "location_code_requires_authoring",
      path: locationPath,
      current_location: "Invalid region",
      location_workflow: {
        schema_type: "location",
        commands: {
          audit: "tiangong-lca dataset classification audit --type location",
          apply: "tiangong-lca dataset classification apply --type location",
        },
      },
      required_resolution:
        "Choose a valid TIDAS location code from tidas_locations_category.json.",
    },
  ]);
  const context = writeContextPackFiles(locationFixtureRoot);

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
      "--location-queue",
      rel(locationQueue),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(locationFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.action_items, 1);
    assert.equal(gate.json.counts.location_queue_action_items, 1);
    assert.deepEqual(
      bundledCategorySchemaNames().filter(
        (name) =>
          !gate.json.context.full_context_ai_completion.required_context_file_patterns.includes(
            name,
          ),
      ),
      [],
    );

    const packagePath = path.join(
      repoRoot,
      gate.json.entities[0].authoring_package,
    );
    const authoringPackage = readJson(packagePath);
    assert.equal(authoringPackage.location_authoring_context.rows.length, 1);
    assert.equal(authoringPackage.action_items[0].path, locationPath);
    assert.match(
      contextTextByPathSuffix(
        authoringPackage,
        "tidas_locations_category.json",
      ),
      /Switzerland/u,
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(locationFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    assert.equal(task.json.status, "ready_no_action_items");
    assert.equal(task.json.counts.action_items, 0);
    assert.equal(task.json.counts.decision_only_action_items, 1);
    assert.equal(
      task.json.batch_patch_contract.status,
      "not_required_no_patch_action_items",
    );
    assert.equal(task.json.commands.apply_all_patches, null);
    assert.ok(
      task.json.tasks[0].context.contract_context_files.some(
        (file) => file.kind === "location_schema" && file.bytes > 0,
      ),
    );
    assert.deepEqual(task.json.tasks[0].action_items, []);
    const decisionItem = task.json.tasks[0].decision_only_action_items[0];
    assert.deepEqual(
      decisionItem.allowed_resolution_modes,
      ["location_decision"],
    );
    assert.equal(
      decisionItem.json_pointer,
      "/processDataSet/processInformation/geography/locationOfOperationSupplyOrProduction/@location",
    );
    const patchTemplate = readJson(
      path.join(repoRoot, task.json.tasks[0].files.patch_template),
    );
    assert.equal(patchTemplate.patch_sets[0].operations.length, 0);
  } finally {
    fs.rmSync(locationFixtureRoot, { recursive: true, force: true });
  }
});

test("post-authoring finalize runs location audit as a hard prewrite gate", () => {
  fs.rmSync(finalizeLocationFixtureRoot, { recursive: true, force: true });
  const processId = "abababab-cdcd-4efe-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(
    finalizeLocationFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);

  try {
    const finalize = runFoundry([
      "dataset-post-authoring-finalize",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(finalizeLocationFixtureRoot, "finalize")),
    ]);
    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.location_audit_blockers, 1);
    assert.equal(finalize.json.counts.location_code_invalid, 1);
    assert.ok(
      finalize.json.stages.some(
        (stage) => stage.stage === "location_audit" && stage.exit_code === 1,
      ),
    );
    assert.ok(
      finalize.json.blockers.some(
        (blocker) => blocker.code === "location_code_invalid",
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
    assert.ok(finalize.json.files.location_audit_report);
    const locationAuditReport = readJson(
      path.join(repoRoot, finalize.json.files.location_audit_report),
    );
    assert.equal(locationAuditReport.status, "blocked");
    assert.equal(locationAuditReport.counts.invalid, 1);
    assert.equal(
      locationAuditReport.findings[0].path,
      "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
    );
    const mutationManifest = readJson(
      path.join(repoRoot, finalize.json.files.mutation_manifest),
    );
    assert.ok(scopeBlockerCodes(mutationManifest).has("dry_run_report_required"));
  } finally {
    fs.rmSync(finalizeLocationFixtureRoot, { recursive: true, force: true });
  }
});

test("post-authoring finalize auto-requires identity preflight for BAFU process scopes", () => {
  fs.rmSync(finalizeIdentityPreflightFixtureRoot, {
    recursive: true,
    force: true,
  });
  const processId = "adadadad-cdcd-4efe-8aaa-bbbbbbbbbbbb";
  const rowsFile = path.join(
    finalizeIdentityPreflightFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
    "@location"
  ] = "CH";
  writeJsonLines(rowsFile, [row]);
  const context = writeContextPackFiles(finalizeIdentityPreflightFixtureRoot);

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
      rel(path.join(finalizeIdentityPreflightFixtureRoot, "finalize")),
    ]);

    assert.equal(finalize.code, 1);
    assert.equal(finalize.json.status, "blocked");
    assert.equal(finalize.json.counts.identity_preflight_required, true);
    assert.ok(finalize.json.files.curation_gate_report);
    assert.ok(
      finalize.json.stages.some(
        (stage) =>
          stage.stage === "process_save_draft_dry_run" &&
          stage.status === "skipped",
      ),
    );
    const gateReport = readJson(
      path.join(repoRoot, finalize.json.files.curation_gate_report),
    );
    const deterministicCodes = new Set(
      gateReport.entities.flatMap((entity) =>
        readJson(path.join(repoRoot, entity.authoring_package))
          .deterministic_cleanup_items.map((item) => item.code),
      ),
    );
    assert.equal(gateReport.counts.identity_preflight_rows, 0);
    assert.ok(deterministicCodes.has("identity_preflight_index_required"));
  } finally {
    fs.rmSync(finalizeIdentityPreflightFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});
