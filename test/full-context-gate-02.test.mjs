import test from "node:test";
import { annualSupplyFixtureRoot, assert, blockerCodes, bundledCategorySchemaNames, classificationFixtureRoot, contextFile, contextTextByPathSuffix, createFixture, createMutationManifestFixture, crypto, elementaryFlowManifestFixtureRoot, finalizeAutoQueueFixtureRoot, finalizeCurationGateFixtureRoot, finalizeIdentityPreflightFixtureRoot, finalizeLocationFixtureRoot, fixtureRoot, flowClassificationFixtureRoot, flowIdentityReferenceFixtureRoot, flowRow, flowRowWithClassification, fs, fullContextKinds, fullContextPatterns, identityPreflightRunFixtureRoot, itemBlockerCodes, locationFixtureRoot, mutationFixtureRoot, packageContextFixtureRoot, path, processRowWithDefaultClassification, processRowWithDeferredTrace, processRowWithFlowRef, processRowWithInvalidAnnualSupply, processRowWithInvalidLocation, processRowWithOnlyOutputExchange, qaPathFixtureRoot, readJson, readJsonLines, referenceClosureFixtureRoot, rel, repoRoot, runFoundry, scopeBlockerCodes, sha256Text, siblingCliBuildAvailable, siblingCliRoot, sourceExchangeFixtureRoot, sourceRow, spawnSync, supportManifestFixtureRoot, targetUserId, testTmpRoot, writeCompletedIdentityPreflightIndex, writeContextPackFiles, writeDecisionTaskFixture, writeJson, writeJsonLines, writeReadyFinalizeFixture, writeText } from "./helpers/full-context-gate-fixtures.mjs";


test("flow curation gate distinguishes elementary and product category schemas", () => {
  fs.rmSync(flowClassificationFixtureRoot, {
    recursive: true,
    force: true,
  });
  const elementaryId = "11111111-2222-4333-8444-555555555555";
  const productId = "22222222-3333-4444-8555-666666666666";
  const context = writeContextPackFiles(flowClassificationFixtureRoot);

  try {
    const elementaryRowsFile = path.join(
      flowClassificationFixtureRoot,
      "rows",
      "elementary-flows.jsonl",
    );
    writeJsonLines(elementaryRowsFile, [
      flowRowWithClassification({
        flowId: elementaryId,
        typeOfDataSet: "Elementary flow",
        classification: {
          "common:elementaryFlowCategorization": {
            "common:category": [
              { "@level": "0", "@catId": "1", "#text": "Emissions" },
              {
                "@level": "1",
                "@catId": "1.3",
                "#text": "Emissions to air",
              },
              {
                "@level": "2",
                "@catId": "1.3.4",
                "#text": "Emissions to air, unspecified",
              },
            ],
          },
        },
      }),
    ]);
    const elementarySchemaReport = path.join(
      flowClassificationFixtureRoot,
      "schema",
      "elementary-validation-report.json",
    );
    writeJson(elementarySchemaReport, {
      input_path: rel(elementaryRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: elementaryId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const qaReport = path.join(
      flowClassificationFixtureRoot,
      "qa",
      "flow-qa-report.json",
    );
    writeJson(qaReport, {
      rows_file: rel(elementaryRowsFile),
      status: "completed",
      blockers: [],
      findings: [],
    });
    const elementaryGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(elementaryRowsFile),
      "--schema-report",
      rel(elementarySchemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "elementary-gate")),
    ]);
    assert.equal(elementaryGate.code, 1);
    assert.equal(
      elementaryGate.json.status,
      "blocked_needs_foundry_ai_authoring",
    );
    assert.equal(elementaryGate.json.counts.action_items, 1);
    assert.equal(
      elementaryGate.json.entities[0].status,
      "needs_foundry_ai_authoring",
    );
    const elementaryPackage = readJson(
      path.join(
        repoRoot,
        elementaryGate.json.entities[0].authoring_package,
      ),
    );
    assert.equal(
      elementaryPackage.action_items[0].code,
      "elementary_flow_requires_existing_database_match",
    );

    const productRowsFile = path.join(
      flowClassificationFixtureRoot,
      "rows",
      "product-flows.jsonl",
    );
    writeJsonLines(productRowsFile, [
      flowRowWithClassification({
        flowId: productId,
        typeOfDataSet: "Product flow",
        classification: {
          "common:classification": {
            "common:class": [
              {
                "@level": "0",
                "@classId": "9",
                "#text": "Community, social and personal services",
              },
              {
                "@level": "1",
                "@classId": "94",
                "#text":
                  "Sewage and waste collection, treatment and disposal and other environmental protection services",
              },
              {
                "@level": "2",
                "@classId": "949",
                "#text": "Other environmental protection services n.e.c.",
              },
              {
                "@level": "3",
                "@classId": "9490",
                "#text": "Other environmental protection services n.e.c.",
              },
              {
                "@level": "4",
                "@classId": "94900",
                "#text": "Other environmental protection services n.e.c.",
              },
            ],
          },
        },
      }),
    ]);
    const productSchemaReport = path.join(
      flowClassificationFixtureRoot,
      "schema",
      "product-validation-report.json",
    );
    writeJson(productSchemaReport, {
      input_path: rel(productRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: productId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const productGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(productRowsFile),
      "--schema-report",
      rel(productSchemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "product-gate")),
    ]);
    assert.equal(productGate.code, 1);
    assert.equal(productGate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(productGate.json.counts.semantic_action_items, 1);
    const productPackage = readJson(
      path.join(repoRoot, productGate.json.entities[0].authoring_package),
    );
    assert.equal(
      productPackage.action_items[0].code,
      "semantic_classification_converted_default",
    );
    assert.equal(
      productPackage.action_items[0].path,
      "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification",
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      productGate.json.files.report,
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0);
    const actionItem = task.json.tasks[0].action_items[0];
    assert.equal(
      actionItem.json_pointer,
      "/flowDataSet/flowInformation/dataSetInformation/classificationInformation/common:classification",
    );
    const outputPatchFile = path.join(
      repoRoot,
      task.json.tasks[0].files.output_patch_file,
    );
    const authoringPackageFile = path.join(
      repoRoot,
      task.json.tasks[0].files.authoring_package,
    );
    const patchPayload = (value) => ({
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: productId,
          version: "00.00.001",
          authoring_package: path.basename(authoringPackageFile),
          operations: [
            {
              op: "replace",
              path: actionItem.json_pointer,
              value,
              basis:
                "The product flow is natural gas and the selected path is the canonical bundled product-flow category path.",
              evidence: {
                source:
                  "source_row.flowDataSet.flowInformation.dataSetInformation.name.baseName",
                quote_or_trace: "Natural gas",
              },
              resolution: {
                mode: "classification_decision",
                used_context_kinds: fullContextKinds,
                summary:
                  "Select product-flow category Natural gas, liquefied or in the gaseous state.",
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
    writeJson(
      outputPatchFile,
      patchPayload({
        "common:class": [
          { "@level": "0", "@classId": "9", "#text": "Wrong root" },
        ],
      }),
    );
    const invalidCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "patches-invalid")),
    ]);
    assert.equal(invalidCollect.code, 1);
    assert.equal(invalidCollect.json.status, "blocked");
    assert.equal(
      blockerCodes(invalidCollect.json).has(
        "patch_classification_decision_entry_invalid",
      ),
      true,
    );

    writeJson(
      outputPatchFile,
      patchPayload({
        "common:class": [
          {
            "@level": "0",
            "@classId": "1",
            "#text": "Ores and minerals; electricity, gas and water",
          },
          {
            "@level": "1",
            "@classId": "12",
            "#text": "Crude petroleum and natural gas",
          },
          {
            "@level": "2",
            "@classId": "120",
            "#text": "Crude petroleum and natural gas",
          },
          {
            "@level": "3",
            "@classId": "1202",
            "#text": "Natural gas, liquefied or in the gaseous state",
          },
          {
            "@level": "4",
            "@classId": "12020",
            "#text": "Natural gas, liquefied or in the gaseous state",
          },
        ],
      }),
    );
    const validCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "patches-valid")),
    ]);
    assert.equal(validCollect.code, 0);
    assert.equal(validCollect.json.status, "ready_for_patch_apply");

    const patchedRowsFile = path.join(
      flowClassificationFixtureRoot,
      "rows",
      "product-flows.patched.jsonl",
    );
    const apply = runFoundry([
      "dataset-patch-apply",
      "--input",
      rel(productRowsFile),
      "--patch",
      validCollect.json.files.batch_patch,
      "--out",
      rel(patchedRowsFile),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "patch-apply")),
      "--authoring-package-dir",
      rel(path.dirname(authoringPackageFile)),
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
    assert.equal(apply.code, 0);
    const patchedRow = readJsonLines(patchedRowsFile)[0];
    assert.equal(
      patchedRow.flowDataSet.flowInformation.dataSetInformation
        .classificationInformation["common:classification"][
        "common:class"
      ][4]["@classId"],
      "12020",
    );

    const patchedSchemaReport = path.join(
      flowClassificationFixtureRoot,
      "schema",
      "product-patched-validation-report.json",
    );
    writeJson(patchedSchemaReport, {
      input_path: rel(patchedRowsFile),
      status: "completed",
      rows: [
        {
          index: 0,
          id: productId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
	    const identityPreflightIndex = writeCompletedIdentityPreflightIndex(
	      flowClassificationFixtureRoot,
	      [
	        {
	          datasetType: "flow",
	          id: productId,
	          target: patchedRow,
	          name: "Fixture product flow",
	          filter: { flowType: "Product flow" },
	          query:
            "flow name: Fixture product flow\nflow type: Product flow\nreference property: Mass",
        },
      ],
    );
    const resolvedGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      rel(patchedRowsFile),
      "--schema-report",
      rel(patchedSchemaReport),
      "--qa-report",
      rel(qaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityPreflightIndex),
      "--out-dir",
      rel(path.join(flowClassificationFixtureRoot, "product-gate-resolved")),
    ]);
    assert.equal(resolvedGate.code, 0);
    assert.equal(resolvedGate.json.status, "ready");
  } finally {
    fs.rmSync(flowClassificationFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("mutation manifest blocks elementary flow write candidates", () => {
  fs.rmSync(elementaryFlowManifestFixtureRoot, {
    recursive: true,
    force: true,
  });
  const flowId = "33333333-4444-4555-8666-777777777777";
  const rowsFile = path.join(
    elementaryFlowManifestFixtureRoot,
    "rows",
    "elementary-flows.jsonl",
  );
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Elementary flow",
      classification: {
        "common:elementaryFlowCategorization": {
          "common:category": [
            { "@level": "0", "@catId": "1", "#text": "Emissions" },
            { "@level": "1", "@catId": "1.3", "#text": "Emissions to air" },
            {
              "@level": "2",
              "@catId": "1.3.4",
              "#text": "Emissions to air, unspecified",
            },
          ],
        },
      },
    }),
  ]);

  try {
    const schemaReport = path.join(
      elementaryFlowManifestFixtureRoot,
      "schema",
      "validation-report.json",
    );
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
    const successList = path.join(
      elementaryFlowManifestFixtureRoot,
      "dry-run",
      "success-list.jsonl",
    );
    const remoteFailed = path.join(
      elementaryFlowManifestFixtureRoot,
      "dry-run",
      "remote-failed.jsonl",
    );
    writeJsonLines(successList, [
      {
        id: flowId,
        version: "00.00.001",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(remoteFailed, []);
    const dryRunReport = path.join(
      elementaryFlowManifestFixtureRoot,
      "dry-run",
      "summary.json",
    );
    writeJson(dryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(rowsFile),
      files: {
        success_list: rel(successList),
        remote_failed: rel(remoteFailed),
      },
    });
    const cleanupReport = path.join(
      elementaryFlowManifestFixtureRoot,
      "cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(cleanupReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "flow",
      rows_file: rel(rowsFile),
      cleaned_rows_file: rel(rowsFile),
      files: {
        cleaned_rows: rel(rowsFile),
      },
    });

    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--require-curation-gate",
      "false",
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(elementaryFlowManifestFixtureRoot, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 1);
    assert.equal(manifest.json.status, "blocked");
    assert.equal(
      itemBlockerCodes(manifest.json).has("elementary_flow_write_blocked"),
      true,
    );
    assert.equal(manifest.json.items[0].decision, "blocked");
    assert.equal(manifest.json.counts.write_candidates, 0);
    assert.equal(manifest.json.counts.planned_write_candidates, 1);
    assert.equal(manifest.json.counts.blocked_write_candidates, 1);
    assert.deepEqual(
      readJsonLines(path.join(repoRoot, manifest.json.files.write_candidates)),
      [],
    );
    assert.equal(
      readJsonLines(
        path.join(repoRoot, manifest.json.files.blocked_write_candidates),
      )[0].flowDataSet.flowInformation.dataSetInformation["common:UUID"],
      flowId,
    );
  } finally {
    fs.rmSync(elementaryFlowManifestFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("identity duplicate flow decisions become reference reuse rows before mutation planning", () => {
  fs.rmSync(flowIdentityReferenceFixtureRoot, {
    recursive: true,
    force: true,
  });
  const duplicateFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000010";
  const newFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000011";
  const existingFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000012";
  const rowsFile = path.join(flowIdentityReferenceFixtureRoot, "flows.jsonl");
  writeJsonLines(rowsFile, [flowRow(duplicateFlowId), flowRow(newFlowId)]);

  try {
    const identityIndex = writeCompletedIdentityPreflightIndex(
      flowIdentityReferenceFixtureRoot,
      [
        {
          datasetType: "flow",
          id: duplicateFlowId,
          name: "Natural gas",
          decision: "block_duplicate",
          status: "blocked",
          candidates: [
            {
              index: 0,
              id: existingFlowId,
              version: "03.00.004",
              state_code: 100,
              names: ["Natural gas"],
              fields: { type_of_dataset: "Product flow" },
              match_score: 100,
              match_reasons: ["equivalent_flow_core_fields"],
              decision_hint: "block_duplicate",
            },
          ],
        },
        {
          datasetType: "flow",
          id: newFlowId,
          name: "New product flow",
          decision: "create_new",
          status: "passed",
          candidates: [],
        },
      ],
    );

    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(flowIdentityReferenceFixtureRoot, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed");
    assert.equal(rewriteReport.json.counts.input_rows, 2);
    assert.equal(rewriteReport.json.counts.output_rows, 1);
    assert.equal(rewriteReport.json.counts.reference_rows, 1);
    assert.equal(rewriteReport.json.counts.flow_reference_rewrites, 1);

    const outputRows = readJsonLines(
      path.join(repoRoot, rewriteReport.json.files.output_rows),
    );
    const referenceRows = readJsonLines(
      path.join(repoRoot, rewriteReport.json.files.reference_rows),
    );
    assert.equal(
      outputRows[0].flowDataSet.flowInformation.dataSetInformation[
        "common:UUID"
      ],
      newFlowId,
    );
    assert.equal(
      referenceRows[0].flowDataSet.flowInformation.dataSetInformation[
        "common:UUID"
      ],
      duplicateFlowId,
    );

    const schemaReport = path.join(
      flowIdentityReferenceFixtureRoot,
      "schema",
      "validation-report.json",
    );
    writeJson(schemaReport, {
      input_path: rewriteReport.json.files.output_rows,
      status: "completed",
      rows: [
        {
          index: 0,
          id: newFlowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "generic",
      "--rows-file",
      rewriteReport.json.files.output_rows,
      "--reference-rows",
      rewriteReport.json.files.reference_rows,
      "--identity-reference-rewrites",
      rewriteReport.json.files.identity_reference_rewrites,
      "--schema-report",
      rel(schemaReport),
      "--require-curation-gate",
      "false",
      "--out-dir",
      rel(path.join(flowIdentityReferenceFixtureRoot, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 1);
    assert.equal(manifest.json.status, "blocked");
    assert.equal(manifest.json.counts.write_candidates, 0);
    assert.equal(manifest.json.counts.planned_write_candidates, 1);
    assert.equal(manifest.json.counts.blocked_write_candidates, 1);
    assert.equal(manifest.json.counts.reference_reuse, 1);
    assert.equal(manifest.json.counts.identity_reference_rewrites, 1);
    assert.equal(manifest.json.counts.identity_reference_reuse_rows, 1);
    assert.deepEqual(
      manifest.json.items.map((item) => item.role),
      ["write_candidate", "reference_reuse"],
    );
    const referenceItem = manifest.json.items.find(
      (item) => item.role === "reference_reuse",
    );
    assert.equal(referenceItem.entity_id, duplicateFlowId);
    assert.equal(referenceItem.identity_reference_rewrite_count, 1);
    assert.equal(
      referenceItem.canonical_references[0].ref_object_id,
      existingFlowId,
    );
  } finally {
    fs.rmSync(flowIdentityReferenceFixtureRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("unresolved root flow identity decisions are deferred before flow write planning", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "flow-root-identity-unresolved-reference-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const unresolvedFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000015";
  const writeFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000016";
  const rowsFile = path.join(root, "flows.jsonl");
  const unresolvedReferencesFile = path.join(
    root,
    "identity-unresolved-references.jsonl",
  );
  writeJsonLines(rowsFile, [flowRow(unresolvedFlowId), flowRow(writeFlowId)]);
  writeJsonLines(unresolvedReferencesFile, [
    {
      relation: "elementary_flow_identity_ai_decision_unresolved",
      action: "preserve_dependent_process_reference_with_trace",
      dataset_type: "flow",
      dataset_id: unresolvedFlowId,
      dataset_version: "00.00.001",
      original: {
        table: "flows",
        ref_object_id: unresolvedFlowId,
        version: "00.00.001",
        short_description: "Unresolved elementary flow",
      },
      identity_decision: {
        decision: "block_unresolved",
        basis:
          "No sufficient public elementary flow candidate was available; do not create an account-local elementary flow.",
      },
      evidence: {
        target: {
          id: unresolvedFlowId,
          fields: { type_of_dataset: "Elementary flow" },
        },
      },
    },
  ]);

  try {
    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--identity-unresolved-references",
      rel(unresolvedReferencesFile),
      "--out-dir",
      rel(path.join(root, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed");
    assert.equal(rewriteReport.json.counts.input_rows, 2);
    assert.equal(rewriteReport.json.counts.output_rows, 1);
    assert.equal(rewriteReport.json.counts.root_flow_unresolved_rows, 1);
    assert.equal(
      rewriteReport.json.counts.flow_reference_unresolved_traces,
      1,
    );

    const outputRows = readJsonLines(
      path.join(repoRoot, rewriteReport.json.files.output_rows),
    );
    const unresolvedRows = readJsonLines(
      path.join(repoRoot, rewriteReport.json.files.identity_unresolved_references),
    );
    assert.equal(
      outputRows[0].flowDataSet.flowInformation.dataSetInformation[
        "common:UUID"
      ],
      writeFlowId,
    );
    assert.equal(unresolvedRows[0].relation, "root_flow_identity_unresolved");
    assert.equal(unresolvedRows[0].dataset_id, unresolvedFlowId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity duplicate flow rewrites require high-confidence preflight evidence", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "flow-identity-low-confidence-reference-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const duplicateFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000013";
  const existingFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000014";
  const rowsFile = path.join(root, "flows.jsonl");
  writeJsonLines(rowsFile, [flowRow(duplicateFlowId)]);

  try {
    const identityIndex = writeCompletedIdentityPreflightIndex(root, [
      {
        datasetType: "flow",
        id: duplicateFlowId,
        name: "Natural gas",
        decision: "block_duplicate",
        status: "blocked",
        confidence: "medium",
        candidates: [
          {
            index: 0,
            id: existingFlowId,
            version: "03.00.004",
            state_code: 100,
            names: ["Natural gas"],
            fields: { type_of_dataset: "Product flow" },
            match_score: 100,
            match_reasons: ["equivalent_flow_core_fields"],
            decision_hint: "block_duplicate",
          },
        ],
      },
    ]);

    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(root, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed_no_rewrites");
    assert.equal(rewriteReport.json.counts.output_rows, 1);
    assert.equal(rewriteReport.json.counts.reference_rows, 0);
    assert.equal(rewriteReport.json.counts.duplicate_flow_mappings, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI identity decisions apply split flow rows into writes and reference reuse", () => {
  const root = testTmpRoot("flow-identity-decisions-apply-test");
  fs.rmSync(root, { recursive: true, force: true });
  const reuseFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000030";
  const createFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000031";
  const existingFlowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000032";
  const rowsFile = path.join(root, "flows.jsonl");
  const decisionsFile = path.join(root, "identity-decisions.jsonl");
  const incompleteDecisionsFile = path.join(
    root,
    "identity-decisions-incomplete.jsonl",
  );
  writeJsonLines(rowsFile, [flowRow(reuseFlowId), flowRow(createFlowId)]);
  writeJsonLines(incompleteDecisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: reuseFlowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: "__AI_FILL_CANONICAL_REF_OBJECT_ID__",
        version: "03.00.004",
      },
      basis:
        "The selected database flow matches the source-language base name and identity preflight candidate fields.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
  ]);
  writeJsonLines(decisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: reuseFlowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "reuse_existing_reference",
      canonical: {
        table: "flows",
        ref_object_id: existingFlowId,
        version: "03.00.004",
        short_description: "Natural gas",
      },
      basis:
        "The selected database flow matches the source-language base name and identity preflight candidate fields, so this row should reuse the existing reference.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
        remote_search: {
          endpoint: "flow_hybrid_search",
          candidate_id: existingFlowId,
          match_reasons: ["source_name_match", "flow_type_match"],
        },
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
    {
      dataset_type: "flow",
      dataset_id: createFlowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "create_new",
      basis:
        "No existing database candidate matched the source-language base name and source flow identity closely enough, so this row remains a write candidate.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
        remote_search: {
          endpoint: "flow_hybrid_search",
          candidate_count: 0,
        },
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["identity_preflight_manual_review"],
    },
  ]);

  try {
    const incompleteApplyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(incompleteDecisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-incomplete-applied")),
    ]);
    assert.equal(incompleteApplyReport.code, 1);
    assert.equal(incompleteApplyReport.json.status, "blocked");
    assert.ok(
      incompleteApplyReport.json.blockers.some(
        (blocker) => blocker.code === "identity_decision_template_incomplete",
      ),
    );

    const applyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(decisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-applied")),
    ]);
    assert.equal(applyReport.code, 0);
    assert.equal(applyReport.json.status, "completed");
    assert.equal(applyReport.json.counts.input_rows, 2);
    assert.equal(applyReport.json.counts.output_rows, 1);
    assert.equal(applyReport.json.counts.reference_rows, 1);
    assert.equal(applyReport.json.counts.identity_reference_rewrites, 1);
    assert.equal(applyReport.json.counts.evidence_rows, 2);

    const outputRows = readJsonLines(
      path.join(repoRoot, applyReport.json.files.output_rows),
    );
    const referenceRows = readJsonLines(
      path.join(repoRoot, applyReport.json.files.reference_rows),
    );
    const rewriteRows = readJsonLines(
      path.join(repoRoot, applyReport.json.files.identity_reference_rewrites),
    );
    assert.equal(
      outputRows[0].flowDataSet.flowInformation.dataSetInformation[
        "common:UUID"
      ],
      createFlowId,
    );
    assert.equal(
      referenceRows[0].flowDataSet.flowInformation.dataSetInformation[
        "common:UUID"
      ],
      reuseFlowId,
    );
    assert.equal(rewriteRows[0].canonical.ref_object_id, existingFlowId);

    const schemaReport = path.join(root, "schema", "validation-report.json");
    writeJson(schemaReport, {
      input_path: applyReport.json.files.output_rows,
      status: "completed",
      rows: [
        {
          index: 0,
          id: createFlowId,
          version: "00.00.001",
          type: "flow",
          status: "valid",
          issues: [],
        },
      ],
    });
    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "generic",
      "--rows-file",
      applyReport.json.files.output_rows,
      "--reference-rows",
      applyReport.json.files.reference_rows,
      "--identity-reference-rewrites",
      applyReport.json.files.identity_reference_rewrites,
      "--schema-report",
      rel(schemaReport),
      "--require-curation-gate",
      "false",
      "--out-dir",
      rel(path.join(root, "mutation-manifest")),
    ]);
    assert.equal(manifest.json.counts.write_candidates, 0);
    assert.equal(manifest.json.counts.planned_write_candidates, 1);
    assert.equal(manifest.json.counts.blocked_write_candidates, 1);
    assert.equal(manifest.json.counts.reference_reuse, 1);
    assert.equal(manifest.json.counts.identity_reference_rewrites, 1);
    assert.equal(manifest.json.counts.identity_reference_reuse_rows, 1);

    const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000033";
    const processRowsFile = path.join(root, "processes.jsonl");
    writeJsonLines(processRowsFile, [
      processRowWithFlowRef(processId, reuseFlowId),
    ]);
    const processRewrite = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "process",
      "--rows-file",
      rel(processRowsFile),
      "--identity-decision-apply-report",
      applyReport.json.files.report,
      "--out-dir",
      rel(path.join(root, "process-identity-rewrites")),
    ]);
    assert.equal(processRewrite.code, 0);
    assert.equal(processRewrite.json.status, "completed");
    assert.equal(processRewrite.json.counts.flow_reference_rewrites, 1);
    const rewrittenProcess = readJsonLines(
      path.join(repoRoot, processRewrite.json.files.output_rows),
    )[0];
    assert.equal(
      rewrittenProcess.processDataSet.exchanges.exchange[0]
        .referenceToFlowDataSet["@refObjectId"],
      existingFlowId,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AI identity decisions apply blocks create_new for elementary flows", () => {
  const root = path.join(
    repoRoot,
    "tmp",
    "elementary-flow-identity-create-new-block-test",
  );
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000039";
  const rowsFile = path.join(root, "flows.jsonl");
  const decisionsFile = path.join(root, "identity-decisions.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Elementary flow",
      classification: {
        "common:elementaryFlowCategorization": {
          "common:category": [
            { "@level": "0", "#text": "Emissions" },
            { "@level": "1", "#text": "Emissions to air" },
          ],
        },
      },
    }),
  ]);
  writeJsonLines(decisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "create_new",
      basis:
        "The AI could not select an existing elementary flow candidate.",
      evidence: {
        used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
        remote_search: {
          endpoint: "flow_hybrid_search",
          candidate_count: 0,
        },
      },
      used_context_kinds: ["schema", "methodology_yaml", "ruleset"],
      closes_action_items: ["elementary_flow_identity_manual_review"],
    },
  ]);

  try {
    const applyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(decisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-applied")),
    ]);
    assert.equal(applyReport.code, 1);
    assert.equal(applyReport.json.status, "blocked");
    assert.ok(
      blockerCodes(applyReport.json).has(
        "elementary_flow_identity_create_new_blocked",
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unresolved elementary flow identity decisions defer references as Foundry traces", () => {
  const root = testTmpRoot("elementary-flow-identity-unresolved-trace-test");
  fs.rmSync(root, { recursive: true, force: true });
  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000041";
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000042";
  const rowsFile = path.join(root, "flows.jsonl");
  const decisionsFile = path.join(root, "identity-decisions.jsonl");
  writeJsonLines(rowsFile, [
    flowRowWithClassification({
      flowId,
      typeOfDataSet: "Elementary flow",
      classification: {
        "common:elementaryFlowCategorization": {
          "common:category": [
            { "@level": "0", "#text": "Emissions" },
            { "@level": "1", "#text": "Emissions to air" },
            { "@level": "2", "#text": "Emissions to air, unspecified" },
          ],
        },
      },
    }),
  ]);
  writeJsonLines(decisionsFile, [
    {
      dataset_type: "flow",
      dataset_id: flowId,
      dataset_version: "00.00.001",
      decision_status: "completed",
      identity_decision: "block_unresolved",
      basis:
        "The full context and flow_hybrid_search evidence did not provide an identity-equivalent public elementary flow, and Foundry must not create account-local elementary flows.",
      evidence: {
        used_context_kinds: fullContextKinds,
        remote_search: {
          endpoint: "flow_hybrid_search",
          query: "flow name: Noise, road, passenger car, average",
          candidate_count: 0,
        },
        target: {
          id: flowId,
          fields: {
            type_of_dataset: "Elementary flow",
            flow_property: "Length",
          },
        },
        top_candidates: [],
      },
      used_context_kinds: fullContextKinds,
      closes_action_items: ["elementary_flow_identity_manual_review"],
    },
  ]);

  try {
    const applyReport = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(decisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-applied")),
    ]);
    assert.equal(applyReport.code, 0);
    assert.equal(applyReport.json.status, "completed");
    assert.equal(applyReport.json.counts.output_rows, 0);
    assert.equal(applyReport.json.counts.unresolved_reference_rows, 1);
    assert.equal(applyReport.json.counts.identity_unresolved_references, 1);
    assert.equal(
      readJsonLines(path.join(repoRoot, applyReport.json.files.output_rows))
        .length,
      0,
    );

    const processRowsFile = path.join(root, "processes.jsonl");
    writeJsonLines(processRowsFile, [
      processRowWithFlowRef(processId, flowId),
    ]);
    const processRewrite = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "process",
      "--rows-file",
      rel(processRowsFile),
      "--identity-decision-apply-report",
      applyReport.json.files.report,
      "--out-dir",
      rel(path.join(root, "process-identity-rewrites")),
    ]);
    assert.equal(processRewrite.code, 0);
    assert.equal(processRewrite.json.status, "completed");
    assert.equal(processRewrite.json.counts.flow_reference_rewrites, 0);
    assert.equal(
      processRewrite.json.counts.flow_reference_unresolved_traces,
      1,
    );
    const rewrittenProcess = readJsonLines(
      path.join(repoRoot, processRewrite.json.files.output_rows),
    )[0];
    assert.equal(
      rewrittenProcess.processDataSet.exchanges.exchange[0]
        .referenceToFlowDataSet["@refObjectId"],
      flowId,
    );
    const trace =
      rewrittenProcess.processDataSet.processInformation.dataSetInformation[
        "common:other"
      ]["tiangongfoundry:unresolvedTrace"][0];
    assert.equal(
      trace.action_item_code,
      "elementary_flow_identity_manual_review",
    );
    assert.equal(trace.reference_id, flowId);
    assert.equal(trace.evidence.source, "dataset-identity-decisions-apply");

    const schemaReport = path.join(root, "schema", "validation-report.json");
    writeJson(schemaReport, {
      input_path: processRewrite.json.files.output_rows,
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
    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      processRewrite.json.files.output_rows,
      "--schema-report",
      rel(schemaReport),
      "--identity-decision-apply-report",
      applyReport.json.files.report,
      "--require-curation-gate",
      "false",
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "mutation-manifest")),
    ]);
    assert.equal(manifest.json.status, "blocked");
    assert.equal(manifest.json.counts.unresolved_trace_entries, 1);
    assert.equal(
      itemBlockerCodes(manifest.json).has(
        "reference_closure_remote_verify_required",
      ),
      false,
    );
    assert.equal(
      itemBlockerCodes(manifest.json).has(
        "unresolved_trace_patch_evidence_required",
      ),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity decision apply closes flow identity curation and counts as full-context evidence", () => {
  const root = testTmpRoot("flow-identity-decision-proof-test");
	  fs.rmSync(root, { recursive: true, force: true });
	  const flowId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000040";
	  const rowsFile = path.join(root, "rows", "flows.jsonl");
	  const flowRow = flowRowWithClassification({
	      flowId,
	      typeOfDataSet: "Product flow",
	      classification: {
        "common:classification": {
          "common:class": [
            { "@level": "0", "@classId": "C", "#text": "Manufacturing" },
            {
              "@level": "1",
              "@classId": "20",
              "#text": "Manufacture of chemicals and chemical products",
            },
          ],
	        },
	      },
	    });
	  writeJsonLines(rowsFile, [flowRow]);

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
      blockers: [],
      findings: [],
    });
	    const identityIndex = writeCompletedIdentityPreflightIndex(root, [
	      {
	        datasetType: "flow",
	        id: flowId,
	        target: flowRow,
	        name: "Natural gas",
	        decision: "manual_review",
        status: "needs_review",
        fields: { type_of_dataset: "Product flow" },
        candidates: [],
      },
    ]);

    const firstGate = runFoundry([
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
      rel(path.join(root, "curation-before-identity-decision")),
    ]);
    assert.equal(firstGate.code, 1);
    assert.equal(firstGate.json.counts.identity_action_items, 1);
    const packageRef = firstGate.json.entities[0].authoring_package;
    const packageSha = firstGate.json.entities[0].authoring_package_sha256;
    const identityTask = runFoundry([
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      firstGate.json.files.report,
      "--rows-file",
      rel(rowsFile),
      "--out-dir",
      rel(path.join(root, "identity-decision-task")),
    ]);
    assert.equal(identityTask.code, 0);
    assert.equal(identityTask.json.status, "ready_for_ai_identity_decisions");
    assert.equal(identityTask.json.counts.identity_action_items, 1);
    assert.equal(identityTask.json.counts.template_decisions, 1);
    assert.equal(
      identityTask.json.identity_action_items[0].authoring_package,
      packageRef,
    );
    assert.ok(identityTask.json.files.shared_context_bundle);
    assert.equal(
      identityTask.json.shared_context_bundle.path,
      identityTask.json.files.shared_context_bundle,
    );
    const identityBundle = readJson(
      path.join(repoRoot, identityTask.json.files.shared_context_bundle),
    );
    assert.equal(identityBundle.sha256, identityTask.json.shared_context_bundle.sha256);
    assert.match(
      identityBundle.files.find((file) => file.kind === "schema").text,
      /process schema/u,
    );
    const identityTemplate = readJsonLines(
      path.join(repoRoot, identityTask.json.files.template),
    );
    assert.equal(identityTemplate.length, 1);
    assert.equal(identityTemplate[0].dataset_id, flowId);
    assert.equal(identityTemplate[0].authoring_package_sha256, packageSha);
    assert.equal(
      identityTemplate[0].authoring_context.context_bundle_sha256,
      identityTask.json.context_bundle.sha256,
    );
    assert.deepEqual(identityTemplate[0].closes_action_items, [
      "identity_preflight_manual_review",
    ]);

    const decisionsFile = path.join(root, "identity-decisions.jsonl");
    writeJsonLines(decisionsFile, [
      {
        dataset_type: "flow",
        dataset_id: flowId,
        dataset_version: "00.00.001",
        decision_status: "completed",
        identity_decision: "create_new",
        authoring_package: packageRef,
        authoring_package_sha256: packageSha,
        basis:
          "The full authoring package and identity-preflight candidates show no existing TianGong flow is identity-equivalent, so this product flow remains a write candidate.",
        evidence: {
          used_context_kinds: fullContextKinds,
          remote_search: {
            endpoint: "flow_hybrid_search",
            candidate_count: 0,
          },
        },
        used_context_kinds: fullContextKinds,
        closes_action_items: ["identity_preflight_manual_review"],
      },
    ]);
    const identityApply = runFoundry([
      "dataset-identity-decisions-apply",
      "--type",
      "flow",
      "--rows-file",
      rel(rowsFile),
      "--decisions",
      rel(decisionsFile),
      "--out-dir",
      rel(path.join(root, "identity-decisions-applied")),
    ]);
    assert.equal(identityApply.code, 0);
    assert.equal(identityApply.json.status, "completed");
    assert.equal(identityApply.json.counts.output_rows, 1);

    const appliedSchemaReport = path.join(
      root,
      "schema-after-identity-decision",
      "validation-report.json",
    );
    writeJson(appliedSchemaReport, {
      input_path: identityApply.json.files.output_rows,
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
    const appliedQaReport = path.join(
      root,
      "qa-after-identity-decision",
      "flow_qa_report.json",
    );
    writeJson(appliedQaReport, {
      rows_file: identityApply.json.files.output_rows,
      status: "completed_local_flow_qa",
      blockers: [],
      findings: [],
    });

    const secondGate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      identityApply.json.files.output_rows,
      "--schema-report",
      rel(appliedSchemaReport),
      "--qa-report",
      rel(appliedQaReport),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--identity-decision-apply-report",
      identityApply.json.files.report,
      "--out-dir",
      rel(path.join(root, "curation-after-identity-decision")),
    ]);
    assert.equal(secondGate.code, 0);
    assert.equal(secondGate.json.status, "ready");
    assert.equal(secondGate.json.counts.identity_action_items, 0);
    assert.equal(secondGate.json.counts.identity_decisions, 1);

    const successList = path.join(root, "dry-run", "success-list.jsonl");
    const remoteFailed = path.join(root, "dry-run", "remote-failed.jsonl");
    writeJsonLines(successList, [
      { id: flowId, version: "00.00.001", operation: "would_insert" },
    ]);
    writeJsonLines(remoteFailed, []);
    const dryRunReport = path.join(root, "dry-run", "summary.json");
    writeJson(dryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: identityApply.json.files.output_rows,
      files: {
        success_list: rel(successList),
        remote_failed: rel(remoteFailed),
      },
    });
    const cleanupReport = path.join(
      root,
      "cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(cleanupReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "flow",
      rows_file: identityApply.json.files.output_rows,
      cleaned_rows_file: identityApply.json.files.output_rows,
      files: {
        cleaned_rows: identityApply.json.files.output_rows,
      },
    });

    const manifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "flow",
      "--profile",
      "bafu",
      "--rows-file",
      identityApply.json.files.output_rows,
      "--schema-report",
      rel(appliedSchemaReport),
      "--curation-gate-report",
      secondGate.json.files.report,
      "--cleanup-report",
      rel(cleanupReport),
      "--identity-decision-apply-report",
      identityApply.json.files.report,
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(root, "mutation-manifest")),
    ]);
    assert.equal(manifest.code, 0);
    assert.equal(manifest.json.status, "ready_for_remote_write");
    assert.equal(manifest.json.counts.ai_identity_decision_entries, 1);
    assert.equal(
      manifest.json.evidence.identity_decision_apply_status,
      "completed",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("identity decision task template uses canonical process table name", () => {
  const root = testTmpRoot("process-identity-decision-template-test");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000041";
  const authoringPackage = path.join(root, "authoring-package.json");
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
        dataset_type: "process",
        dataset_id: processId,
        dataset_version: "00.00.001",
        evidence: {
          remote_search: {
            endpoint: "process_hybrid_search",
            query: "process name: Fixture process",
            candidate_count: 0,
          },
        },
      },
    ],
  });
  const authoringPackageSha256 = sha256Text(
    fs.readFileSync(authoringPackage, "utf8"),
  );
  const curationGateReport = path.join(root, "dataset-curation-gate-report.json");
  writeJson(curationGateReport, {
    schema_version: 1,
    status: "blocked",
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        authoring_package: rel(authoringPackage),
        authoring_package_sha256: authoringPackageSha256,
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
    const templateRows = readJsonLines(
      path.join(repoRoot, identityTask.json.files.template),
    );
    assert.equal(templateRows.length, 1);
    assert.equal(templateRows[0].dataset_type, "process");
    assert.equal(templateRows[0].canonical.table, "processes");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
