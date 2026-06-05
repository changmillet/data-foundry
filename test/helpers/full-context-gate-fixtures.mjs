import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const testRunId = process.env.FOUNDRY_FULL_CONTEXT_TEST_RUN_ID || process.pid;

export function testTmpRoot(name) {
  return path.join(repoRoot, "tmp", `${name}-${testRunId}`);
}

export const fixtureRoot = testTmpRoot("full-context-gate-test");
export const mutationFixtureRoot = testTmpRoot("mutation-manifest-trace-test");
export const referenceClosureFixtureRoot = testTmpRoot(
  "mutation-manifest-reference-closure-test",
);
export const supportManifestFixtureRoot = testTmpRoot(
  "mutation-manifest-support-scope-test",
);
export const classificationFixtureRoot = testTmpRoot(
  "classification-queue-gate-test",
);
export const flowClassificationFixtureRoot = testTmpRoot(
  "flow-classification-gate-test",
);
export const elementaryFlowManifestFixtureRoot = testTmpRoot(
  "elementary-flow-manifest-gate-test",
);
export const flowIdentityReferenceFixtureRoot = testTmpRoot(
  "flow-identity-reference-reuse-test",
);
export const locationFixtureRoot = testTmpRoot("location-queue-gate-test");
export const finalizeLocationFixtureRoot = testTmpRoot(
  "finalize-location-audit-test",
);
export const finalizeCurationGateFixtureRoot = testTmpRoot(
  "finalize-curation-gate-test",
);
export const finalizeIdentityPreflightFixtureRoot = testTmpRoot(
  "finalize-identity-preflight-test",
);
export const identityPreflightRunFixtureRoot = testTmpRoot(
  "identity-preflight-run-test",
);
export const finalizeAutoQueueFixtureRoot = testTmpRoot(
  "finalize-auto-queue-test",
);
export const packageContextFixtureRoot = testTmpRoot(
  "authoring-package-context-test",
);
export const annualSupplyFixtureRoot = testTmpRoot("annual-supply-deferral-test");
export const sourceExchangeFixtureRoot = testTmpRoot(
  "source-exchange-completeness-test",
);
export const qaPathFixtureRoot = testTmpRoot("qa-path-gate-test");
export const siblingCliRoot = path.resolve(repoRoot, "..", "tiangong-lca-cli");
export const targetUserId = "00000000-0000-4000-8000-000000000001";
export const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];
export const fullContextPatterns = [
  "schema.json",
  "methodology.yaml",
  "runtime-ruleset.json",
  "tidas_contacts_category.json",
  "tidas_flowproperties_category.json",
  "tidas_flows_elementary_category.json",
  "tidas_flows_product_category.json",
  "tidas_lciamethods_category.json",
  "tidas_processes_category.json",
  "tidas_sources_category.json",
  "tidas_unitgroups_category.json",
  "tidas_locations_category.json",
];

export function acquireFullContextGateFileLock() {
  const lockDir = path.join(repoRoot, "tmp", "full-context-gate-test.lock");
  const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (ageMs > 10 * 60 * 1000) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(sleepBuffer, 0, 0, 50);
    }
  }
  const release = () => fs.rmSync(lockDir, { recursive: true, force: true });
  process.once("exit", release);
  return release;
}

export function rel(filePath) {
  return path.relative(repoRoot, filePath);
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

export function writeJsonLines(filePath, rows) {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length ? "\n" : ""),
  );
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

export function siblingCliBuildAvailable() {
  return fs.existsSync(path.join(siblingCliRoot, "dist", "src", "main.js"));
}

export function runFoundry(args, options = {}) {
  const result = spawnSync(process.execPath, ["scripts/foundry.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    timeout: options.timeout,
  });
  const stdout = result.stdout.trim();
  assert.notEqual(
    stdout,
    "",
    `Expected JSON stdout for ${args.join(" ")}; status=${result.status}; stderr=${result.stderr}`,
  );
  return {
    code: result.status,
    json: JSON.parse(stdout),
  };
}

export function blockerCodes(report) {
  return new Set((report.blockers ?? []).map((blocker) => blocker.code));
}

export function itemBlockerCodes(report) {
  return new Set(
    (report.items ?? []).flatMap((item) =>
      (item.blockers ?? []).map((blocker) => blocker.code),
    ),
  );
}

export function scopeBlockerCodes(report) {
  return new Set(
    (report.evidence?.scope_blockers ?? report.scope_blockers ?? []).map(
      (blocker) => blocker.code,
    ),
  );
}

export function contextTextByPathSuffix(authoringPackage, suffix) {
  return (
    authoringPackage.contract_context_files.find((file) =>
      String(file.path ?? "").endsWith(suffix),
    )?.text ?? ""
  );
}

export function bundledCategorySchemaNames() {
  return fs
    .readdirSync(
      path.resolve(
        repoRoot,
        "..",
        "tiangong-lca-cli",
        "assets",
        "tidas-schemas",
      ),
    )
    .filter((name) => /^tidas_.*_category\.json$/u.test(name))
    .sort();
}

export function createFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });

  const rowsFile = path.join(fixtureRoot, "processes.jsonl");
  writeText(rowsFile, '{"id":"p1"}\n{"id":"p2"}\n');

  const checksFile = path.join(fixtureRoot, "remote-verification.jsonl");
  writeText(
    checksFile,
    [0, 1]
      .map((rowIndex) =>
        JSON.stringify({
          role: "root",
          path: `processes/${rowIndex}#readback`,
          status: "ok",
          local_payload_sha256: `hash-${rowIndex}`,
          remote_payload_sha256: `hash-${rowIndex}`,
          remote_user_id: targetUserId,
          remote_state_code: 0,
          row_index: rowIndex,
        }),
      )
      .join("\n") + "\n",
  );

  const commitReport = path.join(fixtureRoot, "commit-report.json");
  writeJson(commitReport, {
    status: "completed",
    mode: "commit",
    commit: true,
    input_path: rel(rowsFile),
    counts: {
      selected: 2,
      executed: 2,
      failed: 0,
    },
  });

  const verifyReport = path.join(
    fixtureRoot,
    "remote-verification-report.json",
  );
  writeJson(verifyReport, {
    status: "passed_remote_verification",
    input_path: rel(rowsFile),
    blockers: [],
    counts: {
      blockers: 0,
      root_readback_checks: 2,
      root_payload_mismatches: 0,
    },
    files: {
      checks: rel(checksFile),
    },
  });

  const finalizeReport = path.join(fixtureRoot, "finalize-ready.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    files: {
      final_rows: rel(rowsFile),
    },
    counts: {
      blockers: 0,
    },
  });

  const mutationMissingProof = path.join(
    fixtureRoot,
    "mutation-missing-proof.json",
  );
  writeJson(mutationMissingProof, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 2,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
    },
  });

	  const patchCollectReport = path.join(fixtureRoot, "patch-collect-ready.json");
	  const authoringPackage = path.join(fixtureRoot, "authoring-package.json");
	  writeJson(authoringPackage, {
	    schema_version: 2,
	    profile: "bafu",
	    dataset_type: "process",
	    entity_id: "process-a",
	    version: "00.00.001",
	    contract_context_files: fullContextKinds.map((kind) => ({
	      kind,
	      path: `${kind}.fixture`,
	      text: `${kind} context`,
	    })),
	    missing_context_files: [],
	  });
	  const authoringPackageSha256 = sha256Text(
	    fs.readFileSync(authoringPackage, "utf8"),
	  );
	  const taskManifest = path.join(fixtureRoot, "authoring-task-manifest.json");
	  writeJson(taskManifest, {
	    schema_version: 1,
	    status: "ready_for_ai_authoring_batch",
	    tasks: [
	      {
	        files: {
	          authoring_package: rel(authoringPackage),
	        },
	        context: {
	          authoring_package_sha256: authoringPackageSha256,
	        },
	      },
	    ],
	  });
	  writeJson(patchCollectReport, {
	    status: "ready_for_patch_apply",
	    task_manifest: rel(taskManifest),
	  });
  const patchEvidenceFile = path.join(fixtureRoot, "patch-evidence.jsonl");
  writeJsonLines(patchEvidenceFile, [
    {
      dataset_id: "process-a",
      dataset_version: "00.00.001",
	      authoring_package_sha256: authoringPackageSha256,
      closes_action_items: ["fixture-action"],
      resolution: {
        mode: "evidence_backed_completion",
        used_context_kinds: fullContextKinds,
      },
      evidence: {
        source: "fixture-authoring-package",
        quote_or_trace: "fixture trace",
      },
    },
  ]);
  const patchApplyReport = path.join(fixtureRoot, "patch-apply-completed.json");
  writeJson(patchApplyReport, {
    status: "completed",
    files: {
      patch_evidence: rel(patchEvidenceFile),
    },
  });

  const mutationWithProof = path.join(fixtureRoot, "mutation-with-proof.json");
  writeJson(mutationWithProof, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    evidence: {
      full_context_ai_completion_required: true,
      full_context_ai_completion_proof:
        "schema/methodology_yaml/ruleset/classification_schema/location_schema authoring package plus AI patch evidence",
      patch_collect_report: rel(patchCollectReport),
      patch_collect_status: "ready_for_patch_apply",
      patch_apply_report: rel(patchApplyReport),
      patch_apply_status: "completed",
      patch_evidence_file: rel(patchEvidenceFile),
    },
    counts: {
      blockers: 0,
      write_candidates: 2,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      ai_patch_evidence_entries: 1,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
    },
  });

  const handoffMissingProof = path.join(
    fixtureRoot,
    "handoff-missing-proof.json",
  );
  writeJson(handoffMissingProof, {
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationMissingProof),
    final_rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    expected_state_code: "0",
    counts: {
      blockers: 0,
      write_candidates: 2,
    },
    files: {
      trace_queues: {
        unresolved_traces: null,
        source_exchange_completeness_traces: null,
      },
    },
  });

  const handoffWithProof = path.join(fixtureRoot, "handoff-with-proof.json");
  writeJson(handoffWithProof, {
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationWithProof),
    final_rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    expected_state_code: "0",
    counts: {
      blockers: 0,
      write_candidates: 2,
    },
    files: {
      trace_queues: {
        unresolved_traces: null,
        source_exchange_completeness_traces: null,
      },
    },
  });

  const oldCloseoutMissingProof = path.join(
    fixtureRoot,
    "old-closeout-missing-proof.json",
  );
  writeJson(oldCloseoutMissingProof, {
    status: "completed",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationMissingProof),
    commit_report: rel(commitReport),
    post_write_verify_report: rel(verifyReport),
    final_rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    expected_state_code: 0,
    counts: {
      blockers: 0,
      root_readback_checks: 2,
      root_payload_mismatches: 0,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
    },
    files: {
      trace_queues: {
        unresolved_traces: null,
        source_exchange_completeness_traces: null,
      },
    },
  });

  return {
    rowsFile,
    finalizeReport,
    mutationWithProof,
    patchApplyReport,
    patchEvidenceFile,
    commitReport,
    verifyReport,
    handoffMissingProof,
    handoffWithProof,
    oldCloseoutMissingProof,
  };
}

export function writeReadyFinalizeFixture({
  root,
  datasetType,
  rowsFile,
  profile = "generic",
  finalizeReportPath = null,
}) {
  const mutationReport = path.join(
    root,
    `${datasetType}-mutation-manifest.json`,
  );
  writeJson(mutationReport, {
    status: "ready_for_remote_write",
    dataset_type: datasetType,
    profile,
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {
      unresolved_traces: null,
      source_exchange_completeness_traces: null,
      source_reference_rewrites: null,
    },
  });
  const finalizeReport =
    finalizeReportPath ||
    path.join(root, `${datasetType}-dataset-post-authoring-finalize-report.json`);
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: datasetType,
    profile,
    rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    files: {
      final_rows: rel(rowsFile),
      mutation_manifest: rel(mutationReport),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
  });
  return { mutationReport, finalizeReport };
}

export function contextFile(pathName, text) {
  return {
    kind:
      pathName === "schema.json"
        ? "schema"
        : pathName === "methodology.yaml"
          ? "methodology_yaml"
          : "ruleset",
    path: rel(path.join(mutationFixtureRoot, "context", pathName)),
    text,
  };
}

export function writeDecisionTaskFixture({
  root,
  kind,
  queueFile,
  contractContextFiles,
  dirName,
  status,
  taskKind,
}) {
  const resolvedTaskKind =
    taskKind ??
    (kind === "location"
      ? "location_decision_authoring"
      : "classification_decision_authoring");
  const taskStatus =
    status ??
    (kind === "location"
      ? "ready_for_ai_location_decisions"
      : "ready_for_ai_classification_decisions");
  const taskDir = path.join(root, dirName ?? `${kind}-decision-task`);
  const taskFile = path.join(taskDir, `${kind}-decision-task.json`);
  const queueText = fs.existsSync(queueFile) ? fs.readFileSync(queueFile, "utf8") : "";
  const contractContextDetails = contractContextFiles.map((file) => ({
    kind: file.kind,
    path: file.path,
    sha256: sha256Text(file.text),
    bytes: Buffer.byteLength(file.text, "utf8"),
  }));
  const contextBundlePayload = {
    task_kind: resolvedTaskKind,
    task: rel(taskFile),
    queue: rel(queueFile),
    queue_sha256: sha256Text(queueText),
    queue_rows: queueText.trim() ? queueText.trim().split(/\r?\n/u).length : 0,
    contract_context_files: contractContextDetails,
    missing_context_files: [],
    provenance_context: {},
    attached_input_rows: [],
  };
  const contextBundle = {
    ...contextBundlePayload,
    sha256: sha256Text(JSON.stringify(contextBundlePayload)),
  };
  writeJson(taskFile, {
    schema_version: 1,
    status: taskStatus,
    task_kind: resolvedTaskKind,
    ...(kind === "location"
      ? { location_queue: rel(queueFile) }
      : { classification_queue: rel(queueFile) }),
    context_bundle: contextBundle,
    contract_context_files: contractContextFiles,
    missing_context_files: [],
  });
  return {
    taskFile,
    contextBundleSha256: contextBundle.sha256,
    taskSha256: sha256Text(fs.readFileSync(taskFile, "utf8")),
    authoringContext: {
      task: rel(taskFile),
      context_bundle_sha256: contextBundle.sha256,
      required_context_kinds: fullContextKinds,
      context_files: contractContextDetails.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
      })),
    },
  };
}

export function processRowWithDeferredTrace(processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          "common:other": {
            "tiangongfoundry:unresolvedTrace": [
              {
                status: "unresolved_deferred",
                action_item_code: "source_system_boilerplate",
                blocked_path:
                  "processDataSet.processInformation.dataSetInformation.generalComment",
                reason:
                  "The source package did not provide a safe source-language value for this optional descriptive field.",
                evidence: {
                  source: "ai-authoring-package",
                  quote_or_trace:
                    "source_row.processDataSet.processInformation.dataSetInformation.generalComment absent",
                },
                next_action:
                  "Review the original source package if a richer user-facing description is later required.",
              },
            ],
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

export function processRowWithDefaultClassification(processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat, from natural gas",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "T",
                  "#text": "Other service activities",
                },
                {
                  "@level": "1",
                  "@classId": "94",
                  "#text": "Activities of membership organizations",
                },
                {
                  "@level": "2",
                  "@classId": "949",
                  "#text": "Activities of other membership organizations",
                },
                {
                  "@level": "3",
                  "@classId": "9499",
                  "#text":
                    "Activities of other membership organizations n.e.c.",
                },
              ],
            },
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

export function flowRowWithClassification({ flowId, typeOfDataSet, classification }) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Natural gas",
            },
            treatmentStandardsRoutes: {
              "@xml:lang": "en",
              "#text": "Not specified",
            },
            mixAndLocationTypes: {
              "@xml:lang": "en",
              "#text": "Not specified",
            },
          },
          classificationInformation: classification,
        },
      },
      modellingAndValidation: {
        LCIMethod: {
          typeOfDataSet,
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

export function processRowWithInvalidLocation(processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat, from natural gas",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "D",
                  "#text":
                    "Electricity, gas, steam and air conditioning supply",
                },
              ],
            },
          },
        },
        geography: {
          locationOfOperationSupplyOrProduction: {
            "@location": "Invalid region",
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

export function processRowWithInvalidAnnualSupply(processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat, from natural gas",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                {
                  "@level": "0",
                  "@classId": "D",
                  "#text":
                    "Electricity, gas, steam and air conditioning supply",
                },
              ],
            },
          },
        },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          dataCutOffAndCompletenessPrinciples: {
            "@xml:lang": "en",
            "#text": "Not specified",
          },
          referenceToDataSource: {
            "@refObjectId": "11111111-2222-4333-8444-555555555555",
            "@type": "source data set",
          },
          annualSupplyOrProductionVolume: {
            "@xml:lang": "en",
            "#text": "Not specified",
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

export function writeContextPackFiles(root) {
  const contextDir = path.join(root, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  writeText(schemaFile, '{"title":"process schema"}\n');
  writeText(yamlFile, "process:\n  source_language_only: true\n");
  writeText(rulesetFile, '{"rules":["classification-decision"]}\n');
  return { schemaFile, yamlFile, rulesetFile };
}

export function writeCompletedIdentityPreflightIndex(root, rows) {
  const requestsRoot = path.join(root, "identity-preflight-requests");
  const outputsRoot = path.join(root, "identity-preflight");
  const indexRows = rows.map((row) => {
    const datasetType = row.datasetType || row.dataset_type;
    const id = row.id || row.dataset_id;
    const version = row.version || row.dataset_version || "00.00.001";
    const plural = datasetType === "flow" ? "flows" : "processes";
    const requestFile = path.join(requestsRoot, plural, `${id}.json`);
    const reportFile = path.join(
      outputsRoot,
      plural,
      id,
      "outputs",
      "identity-decision.json",
    );
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const decision = row.decision || "create_new";
    const blocked = decision === "block_duplicate";
    writeJson(requestFile, {
      schema_version: 1,
      target: row.target || { id, version, name_en: row.name || "Fixture" },
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        limit: 20,
        ...(row.filter ? { filter: row.filter } : {}),
        query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
      },
    });
    writeJson(reportFile, {
      schema_version: 1,
      kind: datasetType,
      status: row.status || (blocked ? "blocked" : "passed"),
      decision,
      confidence: row.confidence || (blocked ? "high" : "medium"),
      target: {
        id,
        version,
        names: [row.name || "Fixture"],
        fields: row.fields || {},
        exchange_signature: [],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates,
      candidate_sources: [
        {
          kind: "remote_search",
          endpoint:
            datasetType === "flow"
              ? "flow_hybrid_search"
              : "process_hybrid_search",
          query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
          ...(row.filter ? { filter: row.filter } : {}),
          row_count: candidates.length,
          scanned_files: [],
        },
      ],
      findings:
        row.findings ||
        (blocked
          ? [
              {
                code: "flow_duplicate_candidate",
                severity: "blocker",
                message: "duplicate",
              },
            ]
          : []),
      blockers:
        row.blockers ||
        (blocked
          ? [
              {
                code: "flow_duplicate_candidate",
                severity: "blocker",
                message: "duplicate",
              },
            ]
          : []),
      next_action:
        row.next_action ||
        row.nextAction ||
        (blocked ? "stop_duplicate" : "materialize_new_payload"),
      files: {},
    });
    return {
      dataset_type: datasetType,
      dataset_id: id,
      dataset_version: version,
      request_file: rel(requestFile),
      output_dir: rel(path.dirname(path.dirname(reportFile))),
      expected_report_file: rel(reportFile),
      command: `tiangong-lca ${datasetType} identity-preflight --input ${path.basename(requestFile)}`,
      remote_search: {
        data_source: "tg",
        limit: 20,
        ...(row.filter ? { filter: row.filter } : {}),
        query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
      },
    };
  });
  const indexFile = path.join(requestsRoot, "identity-preflight-requests.jsonl");
  writeJsonLines(indexFile, indexRows);
  return indexFile;
}

export function processRowWithFlowRef(processId, flowId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Heat production",
            },
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Input",
            referenceToFlowDataSet: {
              "@refObjectId": flowId,
              "@version": "00.00.001",
            },
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

export function processRowWithOnlyOutputExchange(processId) {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Recovered solvent production",
            },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "C", "#text": "Manufacturing" },
                {
                  "@level": "1",
                  "@classId": "10",
                  "#text": "Manufacture of food products",
                },
                {
                  "@level": "2",
                  "@classId": "108",
                  "#text": "Manufacture of prepared animal feeds",
                },
                {
                  "@level": "3",
                  "@classId": "1080",
                  "#text": "Manufacture of prepared animal feeds",
                },
              ],
            },
          },
        },
      },
      exchanges: {
        exchange: [
          {
            exchangeDirection: "Output",
            meanAmount: 1,
            resultingAmount: 1,
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

export function flowRow(flowId) {
  return {
    flowDataSet: {
      flowInformation: {
        dataSetInformation: {
          "common:UUID": flowId,
          name: {
            baseName: {
              "@xml:lang": "en",
              "#text": "Natural gas",
            },
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

export function sourceRow(sourceId) {
  return {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": sourceId,
          "common:shortName": {
            "@xml:lang": "en",
            "#text": "Fixture report",
          },
        },
        sourceCitation: "Fixture report, 2026",
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
}

export function createMutationManifestFixture() {
  fs.rmSync(mutationFixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(mutationFixtureRoot, { recursive: true });

  const processId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const row = processRowWithDeferredTrace(processId);
  const patchOutputRows = path.join(
    mutationFixtureRoot,
    "patch-apply",
    "processes.patched.jsonl",
  );
  const rowsFile = path.join(
    mutationFixtureRoot,
    "final",
    "processes.cleaned.jsonl",
  );
  writeJsonLines(patchOutputRows, [row]);
  writeJsonLines(rowsFile, [row]);
  const sourceReferenceRewritesFile = path.join(
    mutationFixtureRoot,
    "source-reference-rewrites.jsonl",
  );
  writeJsonLines(sourceReferenceRewritesFile, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      source_file:
        "tmp/bafu/process-bundles/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/tidas/processes/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json",
      path: "processDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: {
        ref_object_id: "converted-format-source",
        version: "00.00.001",
        short_description: "ILCD format",
      },
      canonical: {
        ref_object_id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
        version: "03.00.003",
        short_description: "ILCD format",
      },
      reason:
        "Data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
    },
    {
      dataset_type: "process",
      dataset_id: "not-this-process",
      dataset_version: "00.00.001",
      path: "processDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: { ref_object_id: "unrelated" },
      canonical: {
        ref_object_id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
      },
    },
  ]);

  const schemaReport = path.join(
    mutationFixtureRoot,
    "schema",
    "validation-report.json",
  );
  writeJson(schemaReport, {
    generated_at_utc: "2026-06-02T00:00:00.000Z",
    input_path: rel(rowsFile),
    requested_type: "process",
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
    mutationFixtureRoot,
    "qa",
    "process-qa-report.json",
  );
  writeJson(qaReport, {
    generated_at_utc: "2026-06-02T00:00:00.000Z",
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });

  const progressJsonl = path.join(
    mutationFixtureRoot,
    "dry-run",
    "outputs",
    "save-draft-rpc",
    "progress.jsonl",
  );
  const failuresJsonl = path.join(
    mutationFixtureRoot,
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
    mutationFixtureRoot,
    "dry-run",
    "outputs",
    "save-draft-rpc",
    "summary.json",
  );
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry-run",
    commit: false,
    input_path: rel(rowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  const cleanupReport = path.join(
    mutationFixtureRoot,
    "cleanup",
    "dataset-curation-cleanup-report.json",
  );
  writeJson(cleanupReport, {
    schema_version: 2,
    status: "completed",
    dataset_type: "process",
    rows_file: rel(patchOutputRows),
    cleaned_rows_file: rel(rowsFile),
    files: {
      cleaned_rows: rel(rowsFile),
    },
  });

  const contractContextFiles = [
    contextFile("schema.json", '{"title":"process schema"}'),
    contextFile("methodology.yaml", "process:\n  required: true\n"),
    contextFile("runtime-ruleset.json", '{"rules":["source-language-only"]}'),
    ...fullContextPatterns
      .filter(
        (fileName) =>
          fileName.startsWith("tidas_") &&
          fileName !== "tidas_locations_category.json",
      )
      .map((fileName) => ({
        kind: "classification_schema",
        path: rel(path.join(mutationFixtureRoot, "context", fileName)),
        text: `{"oneOf":[{"const":"${fileName}","description":"Fixture ${fileName}"}]}`,
      })),
    {
      kind: "location_schema",
      path: rel(
        path.join(
          mutationFixtureRoot,
          "context",
          "tidas_locations_category.json",
        ),
      ),
      text: '{"oneOf":[{"const":"CH","description":"Switzerland"}]}',
    },
  ];
  for (const file of contractContextFiles) {
    writeText(path.join(repoRoot, file.path), file.text);
  }
  const contractContextDetails = contractContextFiles.map((file) => ({
    kind: file.kind,
    path: file.path,
    sha256: sha256Text(file.text),
    bytes: Buffer.byteLength(file.text, "utf8"),
  }));

  const actionItem = {
    code: "source_system_boilerplate",
    path: "processDataSet.processInformation.dataSetInformation.generalComment",
    ai_required: true,
  };
  const authoringPackage = path.join(
    mutationFixtureRoot,
    "curation",
    "ai-authoring-packages",
    `process-${processId}.authoring-package.json`,
  );
  const authoringPackagePayload = {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    contract_context_files: contractContextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: fullContextKinds,
      required_context_file_patterns: fullContextPatterns,
    },
    missing_context_files: [],
    action_items: [actionItem],
    source_row: row,
    entity_payload: row,
  };
  writeJson(authoringPackage, authoringPackagePayload);
  const authoringPackageSha256 = sha256Text(
    fs.readFileSync(authoringPackage, "utf8"),
  );

  const curationGateReport = path.join(
    mutationFixtureRoot,
    "curation",
    "dataset-curation-gate-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    profile: "bafu",
    dataset_type: "process",
    rows_file: rel(rowsFile),
    schema_report: rel(schemaReport),
    qa_report: rel(qaReport),
    context: {
      contract_context_files: contractContextFiles.map((file) => file.path),
      contract_context_file_details: contractContextDetails,
    },
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        status: "ready",
        action_item_count: 0,
        authoring_package: rel(authoringPackage),
        authoring_package_sha256: authoringPackageSha256,
      },
    ],
  });

  const batchPatch = path.join(
    mutationFixtureRoot,
    "authoring-tasks",
    "ai-patches.batch.json",
  );
  writeJson(batchPatch, {
    schema_version: 1,
    kind: "tiangong_foundry_dataset_patch_batch",
    patch_sets: [],
  });
  const taskManifest = path.join(
    mutationFixtureRoot,
    "authoring-tasks",
    "authoring-task-manifest.json",
  );
  writeJson(taskManifest, {
    schema_version: 1,
    status: "ready_for_ai_authoring_batch",
    tasks: [
      {
        status: "ready_for_ai_authoring",
        entity: {
          dataset_type: "process",
          entity_id: processId,
          version: "00.00.001",
        },
        context: {
          authoring_package_sha256: authoringPackageSha256,
          full_context_ai_completion: { required: true },
        },
        action_item_count: 1,
        action_items: [actionItem],
        files: {
          authoring_package: rel(authoringPackage),
        },
      },
    ],
  });
  const patchCollectReport = path.join(
    mutationFixtureRoot,
    "authoring-tasks",
    "authoring-patch-collect-report.json",
  );
  writeJson(patchCollectReport, {
    schema_version: 1,
    status: "ready_for_patch_apply",
    task_manifest: rel(taskManifest),
    files: {
      batch_patch: rel(batchPatch),
    },
  });

  const patchEvidenceFile = path.join(
    mutationFixtureRoot,
    "patch-apply",
    "outputs",
    "patch-evidence.jsonl",
  );
  writeJsonLines(patchEvidenceFile, [
    {
      row_index: 0,
      dataset_id: processId,
      dataset_version: "00.00.001",
      op: "add",
      path: "/processDataSet/processInformation/dataSetInformation/common:other/tiangongfoundry:unresolvedTrace/0",
      basis:
        "The source row lacks a safe value for the optional descriptive field; the unresolved trace preserves the source context for later curation.",
      evidence: {
        source: "ai-authoring-package",
        quote_or_trace:
          "source_row.processDataSet.processInformation.dataSetInformation.generalComment absent",
      },
      resolution: {
        mode: "deferred_to_common_other",
        used_context_kinds: fullContextKinds,
      },
      authoring_package: path.basename(authoringPackage),
      authoring_package_sha256: authoringPackageSha256,
      closes_action_items: [actionItem],
    },
  ]);
  const patchApplyReport = path.join(
    mutationFixtureRoot,
    "patch-apply",
    "outputs",
    "dataset-patch-apply-report.json",
  );
  writeJson(patchApplyReport, {
    schema_version: 1,
    status: "completed",
    input_path: rel(path.join(mutationFixtureRoot, "rows", "processes.jsonl")),
    patch_path: rel(batchPatch),
    out_path: rel(patchOutputRows),
    evidence_count: 1,
    files: {
      patched_rows: rel(patchOutputRows),
      patch_evidence: rel(patchEvidenceFile),
      report: rel(patchApplyReport),
    },
  });

  return {
    rowsFile,
    schemaReport,
    qaReport,
    dryRunReport,
    cleanupReport,
    curationGateReport,
    patchCollectReport,
	    patchApplyReport,
	    sourceReferenceRewritesFile,
	    contractContextFiles,
	    processId,
	  };
	}

export { assert, crypto, spawnSync, fs, path };
