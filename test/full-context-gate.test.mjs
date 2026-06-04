import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureRoot = path.join(repoRoot, "tmp", "full-context-gate-test");
const mutationFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "mutation-manifest-trace-test",
);
const referenceClosureFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "mutation-manifest-reference-closure-test",
);
const supportManifestFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "mutation-manifest-support-scope-test",
);
const classificationFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "classification-queue-gate-test",
);
const flowClassificationFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "flow-classification-gate-test",
);
const elementaryFlowManifestFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "elementary-flow-manifest-gate-test",
);
const flowIdentityReferenceFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "flow-identity-reference-reuse-test",
);
const locationFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "location-queue-gate-test",
);
const finalizeLocationFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "finalize-location-audit-test",
);
const finalizeCurationGateFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "finalize-curation-gate-test",
);
const finalizeIdentityPreflightFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "finalize-identity-preflight-test",
);
const identityPreflightRunFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "identity-preflight-run-test",
);
const finalizeAutoQueueFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "finalize-auto-queue-test",
);
const packageContextFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "authoring-package-context-test",
);
const annualSupplyFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "annual-supply-deferral-test",
);
const sourceExchangeFixtureRoot = path.join(
  repoRoot,
  "tmp",
  "source-exchange-completeness-test",
);
const qaPathFixtureRoot = path.join(repoRoot, "tmp", "qa-path-gate-test");
const siblingCliRoot = path.resolve(repoRoot, "..", "tiangong-lca-cli");
const targetUserId = "00000000-0000-4000-8000-000000000001";
const fullContextKinds = [
  "schema",
  "methodology_yaml",
  "ruleset",
  "classification_schema",
  "location_schema",
];
const fullContextPatterns = [
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

function rel(filePath) {
  return path.relative(repoRoot, filePath);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJsonLines(filePath, rows) {
  writeText(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length ? "\n" : ""),
  );
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

function siblingCliBuildAvailable() {
  return fs.existsSync(path.join(siblingCliRoot, "dist", "src", "main.js"));
}

function runFoundry(args, options = {}) {
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

function blockerCodes(report) {
  return new Set((report.blockers ?? []).map((blocker) => blocker.code));
}

function itemBlockerCodes(report) {
  return new Set(
    (report.items ?? []).flatMap((item) =>
      (item.blockers ?? []).map((blocker) => blocker.code),
    ),
  );
}

function scopeBlockerCodes(report) {
  return new Set(
    (report.evidence?.scope_blockers ?? report.scope_blockers ?? []).map(
      (blocker) => blocker.code,
    ),
  );
}

function contextTextByPathSuffix(authoringPackage, suffix) {
  return (
    authoringPackage.contract_context_files.find((file) =>
      String(file.path ?? "").endsWith(suffix),
    )?.text ?? ""
  );
}

function bundledCategorySchemaNames() {
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

function createFixture() {
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

test("full-context import completion gates block missing proof and pass evidenced BAFU scopes", () => {
  const fixture = createFixture();
  try {
    const blockedCloseout = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffMissingProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-closeout")),
    ]);
    assert.equal(blockedCloseout.code, 1);
    assert.equal(blockedCloseout.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedCloseout.json).has(
        "post_write_closeout_full_context_mutation_proof_missing",
      ),
    );

    const blockedCompletion = runFoundry([
      "dataset-import-completion-report",
      "--closeout-report",
      rel(fixture.oldCloseoutMissingProof),
      "--require-type",
      "process",
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-completion")),
    ]);
    assert.equal(blockedCompletion.code, 1);
    assert.equal(blockedCompletion.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedCompletion.json).has(
        "closeout_full_context_mutation_proof_missing",
      ),
    );

    const commitReportRowsMismatch = path.join(
      fixtureRoot,
      "commit-report-rows-mismatch.json",
    );
    writeJson(commitReportRowsMismatch, {
      ...readJson(fixture.commitReport),
      input_path: rel(path.join(fixtureRoot, "other-processes.jsonl")),
    });
    const blockedCommitRowsMismatch = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(commitReportRowsMismatch),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-commit-rows-mismatch")),
    ]);
    assert.equal(blockedCommitRowsMismatch.code, 1);
    assert.equal(blockedCommitRowsMismatch.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedCommitRowsMismatch.json).has(
        "commit_report_input_mismatch",
      ),
    );

    const verifyReportRowsMismatch = path.join(
      fixtureRoot,
      "verify-report-rows-mismatch.json",
    );
    writeJson(verifyReportRowsMismatch, {
      ...readJson(fixture.verifyReport),
      input_path: rel(path.join(fixtureRoot, "other-processes.jsonl")),
    });
    const blockedVerifyRowsMismatch = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(verifyReportRowsMismatch),
      "--out-dir",
      rel(path.join(fixtureRoot, "blocked-verify-rows-mismatch")),
    ]);
    assert.equal(blockedVerifyRowsMismatch.code, 1);
    assert.equal(blockedVerifyRowsMismatch.json.status, "blocked");
	    assert.ok(
	      blockerCodes(blockedVerifyRowsMismatch.json).has(
	        "post_write_verify_input_mismatch",
	      ),
	    );

	    const originalPatchApplyReport = readJson(fixture.patchApplyReport);
	    writeJson(fixture.patchApplyReport, {
	      ...originalPatchApplyReport,
	      status: "failed",
	    });
	    const blockedHandoffStaleAiProof = runFoundry([
	      "dataset-commit-handoff-plan",
	      "--type",
	      "process",
	      "--finalize-report",
	      rel(fixture.finalizeReport),
	      "--mutation-manifest",
	      rel(fixture.mutationWithProof),
	      "--target-user-id",
	      targetUserId,
	      "--state-code",
	      "0",
	      "--out-dir",
	      rel(path.join(fixtureRoot, "blocked-handoff-stale-ai-proof")),
	    ]);
	    assert.equal(blockedHandoffStaleAiProof.code, 1);
	    assert.equal(blockedHandoffStaleAiProof.json.status, "blocked");
	    assert.ok(
	      blockerCodes(blockedHandoffStaleAiProof.json).has(
	        "commit_handoff_full_context_patch_apply_not_completed",
	      ),
	    );

	    const blockedCloseoutStaleAiProof = runFoundry([
	      "dataset-post-write-closeout",
	      "--handoff-plan",
	      rel(fixture.handoffWithProof),
	      "--commit-report",
	      rel(fixture.commitReport),
	      "--post-write-verify-report",
	      rel(fixture.verifyReport),
	      "--out-dir",
	      rel(path.join(fixtureRoot, "blocked-closeout-stale-ai-proof")),
	    ]);
	    assert.equal(blockedCloseoutStaleAiProof.code, 1);
	    assert.equal(blockedCloseoutStaleAiProof.json.status, "blocked");
	    assert.ok(
	      blockerCodes(blockedCloseoutStaleAiProof.json).has(
	        "post_write_closeout_full_context_patch_apply_not_completed",
	      ),
	    );
	    writeJson(fixture.patchApplyReport, originalPatchApplyReport);

	    const originalPatchEvidenceRows = readJsonLines(fixture.patchEvidenceFile);
	    writeJsonLines(fixture.patchEvidenceFile, [
	      {
	        ...originalPatchEvidenceRows[0],
	        resolution: {
	          mode: "evidence_backed_completion",
	          used_context_kinds: ["schema"],
	        },
	      },
	    ]);
	    const blockedHandoffMissingPatchContext = runFoundry([
	      "dataset-commit-handoff-plan",
	      "--type",
	      "process",
	      "--finalize-report",
	      rel(fixture.finalizeReport),
	      "--mutation-manifest",
	      rel(fixture.mutationWithProof),
	      "--target-user-id",
	      targetUserId,
	      "--state-code",
	      "0",
	      "--out-dir",
	      rel(path.join(fixtureRoot, "blocked-handoff-patch-context")),
	    ]);
	    assert.equal(blockedHandoffMissingPatchContext.code, 1);
	    assert.equal(blockedHandoffMissingPatchContext.json.status, "blocked");
	    assert.ok(
	      blockerCodes(blockedHandoffMissingPatchContext.json).has(
	        "commit_handoff_full_context_patch_resolution_context_missing",
	      ),
	    );
	    writeJsonLines(fixture.patchEvidenceFile, originalPatchEvidenceRows);

	    writeJsonLines(fixture.patchEvidenceFile, [
	      {
	        ...originalPatchEvidenceRows[0],
	        authoring_package_sha256: "not-a-known-authoring-package-sha256",
	      },
	    ]);
	    const blockedHandoffUnknownPackageHash = runFoundry([
	      "dataset-commit-handoff-plan",
	      "--type",
	      "process",
	      "--finalize-report",
	      rel(fixture.finalizeReport),
	      "--mutation-manifest",
	      rel(fixture.mutationWithProof),
	      "--target-user-id",
	      targetUserId,
	      "--state-code",
	      "0",
	      "--out-dir",
	      rel(path.join(fixtureRoot, "blocked-handoff-package-hash")),
	    ]);
	    assert.equal(blockedHandoffUnknownPackageHash.code, 1);
	    assert.equal(blockedHandoffUnknownPackageHash.json.status, "blocked");
	    assert.ok(
	      blockerCodes(blockedHandoffUnknownPackageHash.json).has(
	        "commit_handoff_full_context_patch_package_hash_unknown",
	      ),
	    );
	    writeJsonLines(fixture.patchEvidenceFile, originalPatchEvidenceRows);

	    const passedCloseout = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(fixture.handoffWithProof),
      "--commit-report",
      rel(fixture.commitReport),
      "--post-write-verify-report",
      rel(fixture.verifyReport),
      "--out-dir",
      rel(path.join(fixtureRoot, "passed-closeout")),
    ]);
    assert.equal(passedCloseout.code, 0);
    assert.equal(passedCloseout.json.status, "completed");
    assert.equal(
      passedCloseout.json.counts.full_context_ai_completion_required,
      true,
    );
    assert.equal(passedCloseout.json.counts.ai_patch_evidence_entries, 1);

    const supportCloseoutReport = path.join(
      fixtureRoot,
      "support-closeout-report.json",
    );
    const supportFinalizeReport = path.join(
      fixtureRoot,
      "support-finalize-ready.json",
    );
    writeJson(supportFinalizeReport, {
      ...readJson(fixture.finalizeReport),
      dataset_type: "support",
    });
    const supportMutationReport = path.join(
      fixtureRoot,
      "support-mutation-ready.json",
    );
    writeJson(supportMutationReport, {
      ...readJson(fixture.mutationWithProof),
      dataset_type: "support",
      evidence: {},
      counts: {
        ...readJson(fixture.mutationWithProof).counts,
        ai_patch_evidence_entries: 0,
      },
    });
    writeJson(supportCloseoutReport, {
      ...passedCloseout.json,
      dataset_type: "support",
      finalize_report: rel(supportFinalizeReport),
      mutation_manifest: rel(supportMutationReport),
      counts: {
        ...passedCloseout.json.counts,
        full_context_ai_completion_required: false,
        ai_patch_evidence_entries: 0,
      },
    });

    const supportCompletion = runFoundry([
      "dataset-import-completion-report",
      "--closeout-report",
      rel(
        path.join(
          fixtureRoot,
          "passed-closeout",
          "dataset-post-write-closeout-report.json",
        ),
      ),
      "--closeout-report",
      rel(supportCloseoutReport),
      "--require-type",
      "process",
      "--require-type",
      "support",
      "--out-dir",
      rel(path.join(fixtureRoot, "support-completion")),
    ]);
    assert.equal(supportCompletion.code, 0);
    assert.equal(supportCompletion.json.status, "completed");
    assert.deepEqual(
      new Set(supportCompletion.json.dataset_types),
      new Set(["process", "support"]),
    );

    const passedCompletion = runFoundry([
      "dataset-import-completion-report",
      "--closeout-report",
      rel(
        path.join(
          fixtureRoot,
          "passed-closeout",
          "dataset-post-write-closeout-report.json",
        ),
      ),
      "--require-type",
      "process",
      "--task-id",
      "full-context-gate-test",
      "--out-dir",
      rel(path.join(fixtureRoot, "passed-completion")),
    ]);
    assert.equal(passedCompletion.code, 0);
    assert.equal(passedCompletion.json.status, "completed");
    assert.equal(passedCompletion.json.counts.full_context_scopes, 1);

    const taskId = "full-context-gate-test";
    const activeTask = path.join(repoRoot, "tasks", "active", `${taskId}.md`);
    writeText(
      activeTask,
      `---\nid: ${taskId}\ntitle: Full context gate test\nstate: Active\nkind: external-dataset-curated-import\ndataset_type: process\nprofile: bafu\npriority: P1\nallow_remote_commit: true\n---\n\n## Goal\n\nTest fixture.\n`,
    );
    const taskComplete = runFoundry([
      "task-complete",
      "--task",
      taskId,
      "--completion-report",
      rel(
        path.join(
          fixtureRoot,
          "passed-completion",
          "dataset-import-completion-report.json",
        ),
      ),
    ]);
    assert.equal(taskComplete.code, 0);
    assert.equal(taskComplete.json.status, "completed");
    assert.equal(
      fs.existsSync(path.join(repoRoot, "tasks", "done", `${taskId}.md`)),
      true,
    );
  } finally {
    fs.rmSync(
      path.join(repoRoot, "tasks", "active", "full-context-gate-test.md"),
      { force: true },
    );
    fs.rmSync(
      path.join(repoRoot, "tasks", "done", "full-context-gate-test.md"),
      { force: true },
    );
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("post-write closeout requires common:other trace queues to match final rows", () => {
  const root = path.join(fixtureRoot, "trace-queue-coverage");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const processId = "11111111-2222-3333-8444-555555555555";
  const traceEntry = {
    status: "unresolved_deferred",
    action_item_code: "annual_supply_or_production_volume_invalid",
    blocked_path:
      "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume",
    reason: "No annualized source evidence is present in the source row.",
    evidence: {
      source: "source-row",
      quote_or_trace:
        "source row has process name and unit, but no annual production quantity",
    },
    next_action:
      "Review original report or database documentation for annual production volume.",
  };
  const rowsFile = path.join(root, "processes.jsonl");
  writeJsonLines(rowsFile, [
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": processId,
            "common:other": {
              "tiangongfoundry:unresolvedTrace": [traceEntry],
            },
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
  const checksFile = path.join(root, "remote-verification.jsonl");
  writeJsonLines(checksFile, [
    {
      role: "root",
      path: "processes/0#readback",
      status: "ok",
      local_payload_sha256: "hash-0",
      remote_payload_sha256: "hash-0",
      remote_user_id: targetUserId,
      remote_state_code: 0,
      row_index: 0,
    },
  ]);
  const commitReport = path.join(root, "commit-report.json");
  writeJson(commitReport, {
    status: "completed",
    mode: "commit",
    commit: true,
    input_path: rel(rowsFile),
    counts: { selected: 1, executed: 1, failed: 0 },
  });
  const verifyReport = path.join(root, "remote-verification-report.json");
  writeJson(verifyReport, {
    status: "passed_remote_verification",
    input_path: rel(rowsFile),
    blockers: [],
    counts: {
      blockers: 0,
      root_readback_checks: 1,
      root_payload_mismatches: 0,
    },
    files: { checks: rel(checksFile) },
  });
  const finalizeReport = path.join(root, "finalize-ready.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    files: { final_rows: rel(rowsFile) },
    counts: { blockers: 0, unresolved_trace_entries: 1 },
  });
  const unresolvedQueue = path.join(root, "unresolved-traces.jsonl");
  writeJsonLines(unresolvedQueue, [
    {
      dataset_type: "process",
      entity_id: processId,
      version: "00.00.001",
      row_index: 0,
      trace_kind: "unresolved_trace",
      path:
        "$.processDataSet.processInformation.dataSetInformation.common:other.tiangongfoundry:unresolvedTrace[0]",
      status: "unresolved_deferred",
      action_item_code: "wrong_action_item",
      blocked_path: traceEntry.blocked_path,
      reason: traceEntry.reason,
      next_action: traceEntry.next_action,
      evidence: traceEntry.evidence,
      trace_sha256: sha256Text(JSON.stringify(traceEntry)),
    },
  ]);
  const sourceExchangeQueue = path.join(
    root,
    "source-exchange-completeness-traces.jsonl",
  );
  writeJsonLines(sourceExchangeQueue, []);
	  const patchCollectReport = path.join(root, "patch-collect-ready.json");
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
	  });
	  const authoringPackageSha256 = sha256Text(
	    fs.readFileSync(authoringPackage, "utf8"),
	  );
	  const taskManifest = path.join(root, "authoring-task-manifest.json");
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
  const patchEvidenceFile = path.join(root, "patch-evidence.jsonl");
  writeJsonLines(patchEvidenceFile, [
    {
      dataset_id: processId,
      dataset_version: "00.00.001",
	      authoring_package_sha256: authoringPackageSha256,
      closes_action_items: [traceEntry.action_item_code],
      resolution: {
        mode: "deferred_to_common_other",
        used_context_kinds: fullContextKinds,
      },
      evidence: traceEntry.evidence,
    },
  ]);
  const patchApplyReport = path.join(root, "patch-apply-completed.json");
  writeJson(patchApplyReport, {
    status: "completed",
    files: {
      patch_evidence: rel(patchEvidenceFile),
    },
  });
  const mutationReport = path.join(root, "mutation-ready.json");
  writeJson(mutationReport, {
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
      write_candidates: 1,
      unresolved_trace_entries: 1,
      source_exchange_completeness_entries: 0,
      ai_patch_evidence_entries: 1,
    },
    files: {
      unresolved_traces: rel(unresolvedQueue),
      source_exchange_completeness_traces: rel(sourceExchangeQueue),
    },
  });
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "process",
    profile: "bafu",
    target_user_id: targetUserId,
    files: {
      final_rows: rel(rowsFile),
      mutation_manifest: rel(mutationReport),
      unresolved_traces: rel(unresolvedQueue),
      source_exchange_completeness_traces: rel(sourceExchangeQueue),
    },
    counts: {
      blockers: 0,
      location_audit_blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 1,
      source_exchange_completeness_entries: 0,
    },
  });
  const handoffReport = path.join(root, "handoff-ready.json");
  writeJson(handoffReport, {
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "bafu",
    finalize_report: rel(finalizeReport),
    mutation_manifest: rel(mutationReport),
    final_rows_file: rel(rowsFile),
    target_user_id: targetUserId,
    expected_state_code: "0",
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 1,
      source_exchange_completeness_entries: 0,
    },
    files: {
      trace_queues: {
        unresolved_traces: rel(unresolvedQueue),
        source_exchange_completeness_traces: rel(sourceExchangeQueue),
      },
    },
  });

  try {
    const blockedHandoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(root, "blocked-handoff")),
    ]);
    assert.equal(blockedHandoff.code, 1);
    assert.equal(blockedHandoff.json.status, "blocked");
    assert.ok(
      blockerCodes(blockedHandoff.json).has(
        "trace_queue_final_rows_entry_missing",
      ),
    );
    assert.ok(
      blockerCodes(blockedHandoff.json).has("trace_queue_stale_or_extra_entry"),
    );

    const blocked = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(handoffReport),
      "--commit-report",
      rel(commitReport),
      "--post-write-verify-report",
      rel(verifyReport),
      "--out-dir",
      rel(path.join(root, "blocked-closeout")),
    ]);
    assert.equal(blocked.code, 1);
    assert.equal(blocked.json.status, "blocked");
    assert.ok(
      blockerCodes(blocked.json).has("trace_queue_final_rows_entry_missing"),
    );
    assert.ok(
      blockerCodes(blocked.json).has("trace_queue_stale_or_extra_entry"),
    );

    writeJsonLines(unresolvedQueue, [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        row_index: 0,
        trace_kind: "unresolved_trace",
        path:
          "$.processDataSet.processInformation.dataSetInformation.common:other.tiangongfoundry:unresolvedTrace[0]",
        status: "unresolved_deferred",
        action_item_code: traceEntry.action_item_code,
        blocked_path: traceEntry.blocked_path,
        reason: traceEntry.reason,
        next_action: traceEntry.next_action,
        evidence: traceEntry.evidence,
        trace_sha256: sha256Text(JSON.stringify(traceEntry)),
      },
    ]);

    const passed = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(root, "passed-handoff")),
    ]);
    assert.equal(passed.code, 0);
    assert.equal(passed.json.status, "ready_for_explicit_commit");
    assert.equal(passed.json.counts.unresolved_trace_entries, 1);

    const passedCloseout = runFoundry([
      "dataset-post-write-closeout",
      "--handoff-plan",
      rel(handoffReport),
      "--commit-report",
      rel(commitReport),
      "--post-write-verify-report",
      rel(verifyReport),
      "--out-dir",
      rel(path.join(root, "passed-closeout")),
    ]);
    assert.equal(passedCloseout.code, 0);
    assert.equal(passedCloseout.json.status, "completed");
    assert.equal(passedCloseout.json.counts.unresolved_trace_entries, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit handoff blocks nonzero location audit blockers", () => {
  const fixture = createFixture();
  try {
    const finalizeWithLocationBlockers = path.join(
      fixtureRoot,
      "finalize-location-blocked.json",
    );
    writeJson(finalizeWithLocationBlockers, {
      ...readJson(fixture.finalizeReport),
      files: {
        final_rows: rel(fixture.rowsFile),
        mutation_manifest: rel(fixture.mutationWithProof),
      },
      counts: {
        blockers: 0,
        location_audit_blockers: 1,
      },
    });

    const handoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeWithLocationBlockers),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(fixtureRoot, "handoff-location-blocked")),
    ]);
    assert.equal(handoff.code, 1);
    assert.equal(handoff.json.status, "blocked");
    assert.ok(
      blockerCodes(handoff.json).has("location_audit_blockers_present"),
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("flow commit handoff includes target user id on publish-version command", () => {
  const root = path.join(fixtureRoot, "flow-commit-handoff-target-user");
  fs.rmSync(root, { recursive: true, force: true });
  const rowsFile = path.join(root, "flows.jsonl");
  writeJsonLines(rowsFile, [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": "f1111111-1111-4111-8111-111111111111",
            "common:dataSetVersion": "00.00.001",
          },
        },
      },
    },
  ]);
  const mutationReport = path.join(root, "dataset-mutation-manifest.json");
  writeJson(mutationReport, {
    status: "ready_for_remote_write",
    dataset_type: "flow",
    profile: "generic",
    target_user_id: targetUserId,
    counts: {
      blockers: 0,
      write_candidates: 1,
      unresolved_trace_entries: 0,
      source_exchange_completeness_entries: 0,
      source_reference_rewrites: 0,
    },
    files: {},
  });
  const finalizeReport = path.join(root, "dataset-post-authoring-finalize-report.json");
  writeJson(finalizeReport, {
    status: "ready_for_remote_write",
    dataset_type: "flow",
    profile: "generic",
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

  try {
    const handoff = runFoundry([
      "dataset-commit-handoff-plan",
      "--finalize-report",
      rel(finalizeReport),
      "--state-code",
      "0",
      "--out-dir",
      rel(path.join(root, "handoff")),
    ]);
    assert.equal(handoff.code, 0, JSON.stringify(handoff.json, null, 2));
    assert.equal(handoff.json.status, "ready_for_explicit_commit");
    assert.match(handoff.json.commands.commit, / flow publish-version /);
    assert.match(
      handoff.json.commands.commit,
      new RegExp(`--target-user-id ${targetUserId}`),
    );
    assert.doesNotMatch(handoff.json.commands.commit, /--state-code/);
    assert.match(
      handoff.json.commands.post_write_verify,
      new RegExp(`--target-user-id ${targetUserId}`),
    );
    assert.match(handoff.json.commands.post_write_verify, /--state-code 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeReadyFinalizeFixture({
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

test("authoring task batch writes shared full-context bundle for repeated package context", () => {
  const root = path.join(fixtureRoot, "authoring-task-shared-context");
  fs.rmSync(root, { recursive: true, force: true });
  const packageDir = path.join(root, "curation-gate", "ai-authoring-packages");
  const contextFiles = [
    {
      kind: "schema",
      path: rel(path.join(root, "context", "schema.json")),
      text: '{"title":"process schema"}',
    },
    {
      kind: "methodology_yaml",
      path: rel(path.join(root, "context", "methodology.yaml")),
      text: "process:\n  source_language_only: true\n",
    },
  ];
  for (const file of contextFiles) {
    writeText(path.join(repoRoot, file.path), file.text);
  }
  const actionItem = {
    code: "source_system_boilerplate",
    path: "processDataSet.processInformation.dataSetInformation.generalComment",
    ai_required: true,
  };
  const packages = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map(
    (processId) => {
      const row = processRowWithInvalidLocation(processId);
      row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
        "@location"
      ] = "CH";
      const packagePath = path.join(
        packageDir,
        `process-${processId}.authoring-package.json`,
      );
      writeJson(packagePath, {
        schema_version: 2,
        profile: "bafu",
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        contract_context_files: contextFiles,
        full_context_ai_completion: {
          required: true,
          required_context_kinds: ["schema", "methodology_yaml"],
        },
        missing_context_files: [],
        action_items: [actionItem],
        source_row: row,
        entity_payload: row,
      });
      return {
        processId,
        packagePath,
        sha256: sha256Text(fs.readFileSync(packagePath, "utf8")),
      };
    },
  );
  const curationGateReport = path.join(
    root,
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    entities: packages.map((entry) => ({
      dataset_type: "process",
      entity_id: entry.processId,
      version: "00.00.001",
      status: "needs_foundry_ai_authoring",
      action_item_count: 1,
      authoring_package: rel(entry.packagePath),
      authoring_package_sha256: entry.sha256,
    })),
  });
  const sharedContextCacheDir = path.join(root, "shared-context-cache");

  try {
    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--shared-context-cache-dir",
      rel(sharedContextCacheDir),
      "--out-dir",
      rel(path.join(root, "authoring-tasks")),
    ]);
    const taskCached = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--shared-context-cache-dir",
      rel(sharedContextCacheDir),
      "--out-dir",
      rel(path.join(root, "authoring-tasks-cached")),
    ]);
    assert.equal(task.code, 0, JSON.stringify(task.json, null, 2));
    assert.equal(taskCached.code, 0, JSON.stringify(taskCached.json, null, 2));
    assert.equal(task.json.status, "ready_for_ai_authoring_batch");
    assert.equal(task.json.counts.tasks, 2);
    assert.equal(task.json.counts.shared_context_files, 2);
    assert.equal(task.json.counts.shared_context_references, 4);
    assert.equal(task.json.counts.duplicate_context_references, 2);
    assert.ok(task.json.counts.duplicate_context_bytes_avoided > 0);
    assert.ok(task.json.files.shared_context_bundle);
    assert.equal(
      task.json.shared_context_bundle.path,
      task.json.files.shared_context_bundle,
    );
    assert.equal(
      task.json.files.shared_context_bundle,
      taskCached.json.files.shared_context_bundle,
    );
    assert.equal(task.json.shared_context_bundle.cache.enabled, true);
    assert.equal(task.json.shared_context_bundle.cache.reused, false);
    assert.equal(taskCached.json.shared_context_bundle.cache.reused, true);
    assert.equal(
      task.json.tasks[0].context.shared_context_bundle.path,
      task.json.files.shared_context_bundle,
    );
    const bundle = readJson(
      path.join(repoRoot, task.json.files.shared_context_bundle),
    );
    assert.equal(bundle.sha256, task.json.shared_context_bundle.sha256);
    const { generated_at_utc: _generatedAt, hash_scope: _hashScope, sha256, ...stableBundlePayload } = bundle;
    assert.equal(sha256, sha256Text(JSON.stringify(stableBundlePayload)));
    assert.equal(bundle.counts.files, 2);
    assert.equal(bundle.counts.references, 4);
    assert.deepEqual(
      bundle.files.map((file) => file.kind).sort(),
      ["methodology_yaml", "schema"],
    );
    assert.match(
      bundle.files.find((file) => file.kind === "schema").text,
      /process schema/u,
    );
    assert.equal(
      task.json.tasks[0].context.contract_context_files.some((file) =>
        Object.hasOwn(file, "text"),
      ),
      false,
    );
    const firstTaskJson = readJson(
      path.join(repoRoot, task.json.tasks[0].files.task_json),
    );
    assert.equal(
      firstTaskJson.context.shared_context_bundle.path,
      task.json.files.shared_context_bundle,
    );
    assert.equal(
      firstTaskJson.context.contract_context_files.some((file) =>
        Object.hasOwn(file, "text"),
      ),
      false,
    );
    assert.match(
      fs.readFileSync(
        path.join(repoRoot, task.json.tasks[0].files.task_markdown),
        "utf8",
      ),
      /shared context bundle:/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("authoring patch collect verifies referenced shared full-context bundle", () => {
  const root = path.join(fixtureRoot, "authoring-patch-shared-context-proof");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "12121212-1212-4121-8121-121212121212";
  const packageDir = path.join(root, "curation-gate", "ai-authoring-packages");
  const contextFiles = [
    {
      kind: "schema",
      path: rel(path.join(root, "context", "schema.json")),
      text: '{"title":"process schema"}',
    },
    {
      kind: "methodology_yaml",
      path: rel(path.join(root, "context", "methodology.yaml")),
      text: "process:\n  source_language_only: true\n",
    },
  ];
  for (const file of contextFiles) {
    writeText(path.join(repoRoot, file.path), file.text);
  }
  const row = processRowWithInvalidLocation(processId);
  row.processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction[
    "@location"
  ] = "CH";
  const actionItem = {
    code: "process_placeholder_content",
    path: "processDataSet.processInformation.dataSetInformation.generalComment",
    message: "General comment still contains placeholder-like content.",
    ai_required: true,
  };
  const packagePath = path.join(
    packageDir,
    `process-${processId}.authoring-package.json`,
  );
  writeJson(packagePath, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: processId,
    version: "00.00.001",
    contract_context_files: contextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: ["schema", "methodology_yaml"],
    },
    missing_context_files: [],
    action_items: [actionItem],
    source_row: row,
    entity_payload: row,
  });
  const curationGateReport = path.join(
    root,
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        status: "needs_foundry_ai_authoring",
        action_item_count: 1,
        authoring_package: rel(packagePath),
        authoring_package_sha256: sha256Text(
          fs.readFileSync(packagePath, "utf8"),
        ),
      },
    ],
  });

  try {
    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      rel(curationGateReport),
      "--shared-context-cache-dir",
      rel(path.join(root, "shared-context-cache")),
      "--out-dir",
      rel(path.join(root, "authoring-tasks")),
    ]);
    assert.equal(task.code, 0, JSON.stringify(task.json, null, 2));
    assert.equal(task.json.status, "ready_for_ai_authoring_batch");
    const taskEntry = task.json.tasks[0];
    const taskActionItem = taskEntry.action_items[0];
    const outputPatchFile = path.join(
      repoRoot,
      taskEntry.files.output_patch_file,
    );
    writeJson(outputPatchFile, {
      schema_version: 1,
      kind: "tiangong_foundry_dataset_patch",
      patch_status: "completed",
      patch_sets: [
        {
          dataset_id: processId,
          version: "00.00.001",
          authoring_package: path.basename(packagePath),
          operations: [
            {
              op: "add",
              path: "/processDataSet/processInformation/dataSetInformation/generalComment",
              value: {
                "@xml:lang": "en",
                "#text": "The source row was reviewed against the process schema and BAFU authoring context.",
              },
              basis:
                "The converted source row and schema context support replacing placeholder-like prose with source-traced process documentation.",
              evidence: {
                source: "authoring_package.source_row",
                quote_or_trace:
                  "processDataSet.processInformation.dataSetInformation.name.baseName.#text = Heat, from natural gas",
              },
              resolution: {
                mode: "evidence_backed_completion",
                used_context_kinds: ["schema", "methodology_yaml"],
              },
              closes_action_items: [
                {
                  code: taskActionItem.code,
                  path: taskActionItem.path,
                },
              ],
            },
          ],
        },
      ],
    });

    const collect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(root, "authoring-patches-ok")),
    ]);
    assert.equal(collect.code, 0, JSON.stringify(collect.json, null, 2));
    assert.equal(collect.json.status, "ready_for_patch_apply");

    const bundlePath = path.join(repoRoot, task.json.files.shared_context_bundle);
    const bundle = readJson(bundlePath);
    fs.rmSync(bundlePath);
    const missingCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(root, "authoring-patches-missing-bundle")),
    ]);
    assert.equal(missingCollect.code, 1);
    assert.equal(missingCollect.json.status, "blocked");
    assert.ok(
      blockerCodes(missingCollect.json).has(
        "authoring_manifest_shared_context_bundle_missing",
      ),
    );
    assert.ok(
      blockerCodes(missingCollect.json).has(
        "authoring_task_shared_context_bundle_missing",
      ),
    );

    writeJson(bundlePath, {
      ...bundle,
      files: [
        ...bundle.files,
        {
          kind: "schema",
          path: "tampered-schema.json",
          sha256: sha256Text("tampered"),
          bytes: 8,
          text: "tampered",
        },
      ],
    });
    const tamperedCollect = runFoundry([
      "dataset-authoring-patch-collect",
      "--task-manifest",
      task.json.files.manifest,
      "--out-dir",
      rel(path.join(root, "authoring-patches-tampered-bundle")),
    ]);
    assert.equal(tamperedCollect.code, 1);
    assert.equal(tamperedCollect.json.status, "blocked");
    assert.ok(
      blockerCodes(tamperedCollect.json).has(
        "authoring_manifest_shared_context_bundle_content_hash_mismatch",
      ),
    );
    assert.ok(
      blockerCodes(tamperedCollect.json).has(
        "authoring_task_shared_context_bundle_content_hash_mismatch",
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("decision tasks externalize full context into stable shared bundles", () => {
  const root = path.join(fixtureRoot, "decision-task-shared-context");
  fs.rmSync(root, { recursive: true, force: true });
  const processId = "33333333-3333-4333-8333-333333333333";
  const rowsFile = path.join(root, "rows", "processes.jsonl");
  writeJsonLines(rowsFile, [processRowWithInvalidLocation(processId)]);
  const classificationQueue = path.join(
    root,
    "classification-authoring-queue.jsonl",
  );
  const locationQueue = path.join(root, "location-authoring-queue.jsonl");
  writeJsonLines(classificationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      classification_workflow: {
        schema_type: "process",
        row_type: "process",
        commands: {
          input_rows: rel(rowsFile),
          output_rows: rel(
            path.join(root, "rows", "processes.classified.jsonl"),
          ),
        },
      },
    },
  ]);
  writeJsonLines(locationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      path:
        "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
      location_workflow: {
        schema_type: "location",
        commands: {
          input_rows: rel(rowsFile),
          output_rows: rel(path.join(root, "rows", "processes.located.jsonl")),
        },
      },
    },
  ]);
  const context = writeContextPackFiles(root);
  const classificationSchema = path.join(
    root,
    "context",
    "tidas_processes_category.json",
  );
  const locationSchema = path.join(
    root,
    "context",
    "tidas_locations_category.json",
  );
  writeText(
    classificationSchema,
    '{"categories":[{"code":"1080","name":"Fixture process category"}]}\n',
  );
  writeText(
    locationSchema,
    '{"locations":[{"code":"CH","name":"Switzerland"}]}\n',
  );
  const sharedContextCacheDir = path.join(root, "shared-context-cache");

  try {
    const buildClassification = (outDir) =>
      runFoundry([
        "dataset-classification-decision-task-build",
        "--classification-queue",
        rel(classificationQueue),
        "--schema-file",
        rel(context.schemaFile),
        "--yaml-file",
        rel(context.yamlFile),
        "--ruleset-file",
        rel(context.rulesetFile),
        "--classification-schema",
        rel(classificationSchema),
        "--location-schema",
        rel(locationSchema),
        "--limit",
        "1",
        "--chunk-label",
        "stable-test",
        "--shared-context-cache-dir",
        rel(sharedContextCacheDir),
        "--out-dir",
        rel(path.join(root, outDir)),
      ]);
    const firstClassification = buildClassification("classification-task-a");
    const secondClassification = buildClassification("classification-task-b");
    assert.equal(
      firstClassification.code,
      0,
      JSON.stringify(firstClassification.json, null, 2),
    );
    assert.equal(
      firstClassification.json.status,
      "ready_for_ai_classification_decisions",
    );
    assert.equal(
      firstClassification.json.context_bundle.sha256,
      secondClassification.json.context_bundle.sha256,
    );
    assert.notEqual(
      firstClassification.json.context_bundle.task,
      secondClassification.json.context_bundle.task,
    );
    assert.ok(firstClassification.json.files.shared_context_bundle);
    assert.equal(
      firstClassification.json.shared_context_bundle.path,
      firstClassification.json.files.shared_context_bundle,
    );
    assert.equal(
      firstClassification.json.files.shared_context_bundle,
      secondClassification.json.files.shared_context_bundle,
    );
    assert.equal(firstClassification.json.shared_context_bundle.cache.enabled, true);
    assert.equal(firstClassification.json.shared_context_bundle.cache.reused, false);
    assert.equal(secondClassification.json.shared_context_bundle.cache.reused, true);
    assert.equal(
      firstClassification.json.contract_context_files.some((file) =>
        Object.hasOwn(file, "text"),
      ),
      false,
    );
    const classificationBundle = readJson(
      path.join(repoRoot, firstClassification.json.files.shared_context_bundle),
    );
    assert.equal(
      classificationBundle.sha256,
      firstClassification.json.shared_context_bundle.sha256,
    );
    assert.equal(
      classificationBundle.counts.duplicate_context_bytes_avoided,
      0,
    );
    assert.match(
      classificationBundle.files.find((file) => file.kind === "schema").text,
      /process schema/u,
    );
    assert.match(
      classificationBundle.files.find(
        (file) => file.kind === "classification_schema",
      ).text,
      /Fixture process category/u,
    );

    const buildLocation = (outDir) =>
      runFoundry([
        "dataset-location-decision-task-build",
        "--location-queue",
        rel(locationQueue),
        "--schema-file",
        rel(context.schemaFile),
        "--yaml-file",
        rel(context.yamlFile),
        "--ruleset-file",
        rel(context.rulesetFile),
        "--location-schema",
        rel(locationSchema),
        "--limit",
        "1",
        "--chunk-label",
        "stable-test",
        "--shared-context-cache-dir",
        rel(sharedContextCacheDir),
        "--out-dir",
        rel(path.join(root, outDir)),
      ]);
    const firstLocation = buildLocation("location-task-a");
    const secondLocation = buildLocation("location-task-b");
    assert.equal(firstLocation.code, 0, JSON.stringify(firstLocation.json, null, 2));
    assert.equal(firstLocation.json.status, "ready_for_ai_location_decisions");
    assert.equal(
      firstLocation.json.context_bundle.sha256,
      secondLocation.json.context_bundle.sha256,
    );
    assert.equal(
      firstLocation.json.files.shared_context_bundle,
      secondLocation.json.files.shared_context_bundle,
    );
    assert.equal(firstLocation.json.shared_context_bundle.cache.enabled, true);
    assert.equal(secondLocation.json.shared_context_bundle.cache.reused, true);
    assert.equal(
      firstLocation.json.contract_context_files.some((file) =>
        Object.hasOwn(file, "text"),
      ),
      false,
    );
    const locationBundle = readJson(
      path.join(repoRoot, firstLocation.json.files.shared_context_bundle),
    );
    assert.match(
      locationBundle.files.find((file) => file.kind === "location_schema").text,
      /Switzerland/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("authoring plan propagates shared context cache to decision chunks", () => {
  const root = path.join(fixtureRoot, "authoring-plan-shared-context-cache");
  fs.rmSync(root, { recursive: true, force: true });
  const context = writeContextPackFiles(root);
  const classificationSchema = path.join(
    root,
    "context",
    "tidas_processes_category.json",
  );
  const locationSchema = path.join(
    root,
    "context",
    "tidas_locations_category.json",
  );
  writeText(classificationSchema, '{"categories":[]}\n');
  writeText(locationSchema, '{"locations":[]}\n');
  const classificationQueue = path.join(
    root,
    "classification-authoring-queue.jsonl",
  );
  const queueRows = [
    {
      dataset_type: "process",
      dataset_id: "44444444-4444-4444-8444-444444444444",
      dataset_version: "00.00.001",
      classification_workflow: {
        schema_type: "process",
      },
    },
    {
      dataset_type: "process",
      dataset_id: "55555555-5555-4555-8555-555555555555",
      dataset_version: "00.00.001",
      classification_workflow: {
        schema_type: "process",
      },
    },
  ];
  writeJsonLines(classificationQueue, queueRows);
  const curationGateReport = path.join(
    root,
    "curation-gate",
    "dataset-curation-gate-report.json",
  );
  const contextDetails = [
    { kind: "schema", path: rel(context.schemaFile) },
    { kind: "methodology_yaml", path: rel(context.yamlFile) },
    { kind: "ruleset", path: rel(context.rulesetFile) },
    { kind: "classification_schema", path: rel(classificationSchema) },
    { kind: "location_schema", path: rel(locationSchema) },
  ];
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "blocked_needs_foundry_ai_authoring",
    profile: "bafu",
    dataset_type: "process",
    rows_file: rel(path.join(root, "rows", "processes.jsonl")),
    counts: {
      action_items: 2,
      classification_queue_action_items: 2,
    },
    context: {
      contract_context_file_details: contextDetails,
      classification_queue: {
        queue_file: rel(classificationQueue),
        rows: 2,
      },
    },
  });
  const classificationTask = path.join(
    root,
    "classification-decision-task",
    "classification-decision-task.json",
  );
  writeJson(classificationTask, {
    schema_version: 1,
    status: "ready_for_ai_classification_decisions",
    task_kind: "classification_decision_authoring",
    classification_queue: rel(classificationQueue),
    classification_queue_rows: queueRows,
  });

  try {
    const plan = runFoundry([
      "dataset-authoring-plan",
      "--curation-gate-report",
      rel(curationGateReport),
      "--classification-chunk-size",
      "1",
      "--out-dir",
      rel(path.join(root, "authoring-plan")),
    ]);
    assert.equal(plan.code, 0, JSON.stringify(plan.json, null, 2));
    const expectedCacheDir = rel(path.join(root, "shared-context-cache"));
    assert.equal(plan.json.context.shared_context_cache_dir, expectedCacheDir);
    assert.match(
      plan.json.phases.find((phase) => phase.phase === "classification_decisions")
        .commands.build_task,
      /--shared-context-cache-dir/u,
    );
    const chunkCommands = plan.json.phases.find(
      (phase) => phase.phase === "classification_decisions",
    ).chunk_plan.commands;
    assert.equal(chunkCommands.length, 2);
    assert.equal(
      chunkCommands.every((command) =>
        command.command.includes("--shared-context-cache-dir"),
      ),
      true,
    );
    assert.equal(
      chunkCommands.every((command) => command.command.includes(expectedCacheDir)),
      true,
    );
    const patchPhase = plan.json.phases.find(
      (phase) => phase.phase === "field_patches",
    );
    assert.match(patchPhase.commands.build_task, /--shared-context-cache-dir/u);
    assert.match(patchPhase.commands.build_task, new RegExp(expectedCacheDir, "u"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function contextFile(pathName, text) {
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

function writeDecisionTaskFixture({
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

function processRowWithDeferredTrace(processId) {
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

function processRowWithDefaultClassification(processId) {
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

function flowRowWithClassification({ flowId, typeOfDataSet, classification }) {
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

function processRowWithInvalidLocation(processId) {
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

function processRowWithInvalidAnnualSupply(processId) {
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

function writeContextPackFiles(root) {
  const contextDir = path.join(root, "context");
  const schemaFile = path.join(contextDir, "schema.json");
  const yamlFile = path.join(contextDir, "methodology.yaml");
  const rulesetFile = path.join(contextDir, "runtime-ruleset.json");
  writeText(schemaFile, '{"title":"process schema"}\n');
  writeText(yamlFile, "process:\n  source_language_only: true\n");
  writeText(rulesetFile, '{"rules":["classification-decision"]}\n');
  return { schemaFile, yamlFile, rulesetFile };
}

function writeCompletedIdentityPreflightIndex(root, rows) {
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

function processRowWithFlowRef(processId, flowId) {
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

function processRowWithOnlyOutputExchange(processId) {
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

function flowRow(flowId) {
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

function sourceRow(sourceId) {
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

function createMutationManifestFixture() {
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

test("curation gate attaches classification queue context as a concrete AI action item", () => {
  fs.rmSync(classificationFixtureRoot, { recursive: true, force: true });
  const processId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  const rowsFile = path.join(
    classificationFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  writeJsonLines(rowsFile, [processRowWithDefaultClassification(processId)]);
  const schemaReport = path.join(
    classificationFixtureRoot,
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
    classificationFixtureRoot,
    "qa",
    "process-qa-report.json",
  );
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed",
    blockers: [],
    findings: [],
  });
  const classificationQueue = path.join(
    classificationFixtureRoot,
    "classification-authoring-queue.jsonl",
  );
  writeJsonLines(classificationQueue, [
    {
      dataset_type: "process",
      dataset_id: processId,
      dataset_version: "00.00.001",
      code: "process_classification_requires_authoring",
      current_classification:
        "Other service activities > Activities of membership organizations > Activities of other membership organizations > Activities of other membership organizations n.e.c.",
      source_classification: {
        category: "heat",
        subCategory: "gas",
      },
      authoring_context: {
        source_name: "Heat, from natural gas {GR}",
        source_location: "GR",
        source_unit: "MJ",
      },
      classification_workflow: {
        schema_type: "process",
        commands: {
          children_root:
            "tiangong-lca dataset classification children --type process",
          apply: "tiangong-lca dataset classification apply --type process",
        },
      },
      required_resolution:
        "Replace the converted default ISIC path with a target TIDAS process classification.",
    },
  ]);
  const context = writeContextPackFiles(classificationFixtureRoot);

  try {
    const gate = runFoundry([
      "dataset-curation-gate",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--qa-report",
      rel(qaReport),
      "--classification-queue",
      rel(classificationQueue),
      "--schema-file",
      rel(context.schemaFile),
      "--yaml-file",
      rel(context.yamlFile),
      "--ruleset-file",
      rel(context.rulesetFile),
      "--out-dir",
      rel(path.join(classificationFixtureRoot, "curation-gate")),
    ]);
    assert.equal(gate.code, 1);
    assert.equal(gate.json.status, "blocked_needs_foundry_ai_authoring");
    assert.equal(gate.json.counts.action_items, 1);
    assert.equal(gate.json.counts.classification_queue_action_items, 1);

    const packagePath = path.join(
      repoRoot,
      gate.json.entities[0].authoring_package,
    );
    const authoringPackage = readJson(packagePath);
    assert.equal(
      authoringPackage.classification_authoring_context.rows.length,
      1,
    );
    assert.equal(
      authoringPackage.action_items[0].path,
      "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification",
    );

    const task = runFoundry([
      "dataset-authoring-task-build",
      "--curation-gate-report",
      gate.json.files.report,
      "--out-dir",
      rel(path.join(classificationFixtureRoot, "authoring-tasks")),
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
    assert.deepEqual(task.json.tasks[0].action_items, []);
    const decisionItem = task.json.tasks[0].decision_only_action_items[0];
    assert.deepEqual(decisionItem.allowed_resolution_modes, [
      "classification_decision",
    ]);
    assert.equal(
      decisionItem.json_pointer,
      "/processDataSet/processInformation/dataSetInformation/classificationInformation/common:classification",
    );
    const patchTemplate = readJson(
      path.join(repoRoot, task.json.tasks[0].files.patch_template),
    );
    assert.equal(patchTemplate.patch_sets[0].operations.length, 0);
  } finally {
    fs.rmSync(classificationFixtureRoot, { recursive: true, force: true });
  }
});

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
    assert.equal(manifest.json.counts.write_candidates, 1);
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
  const root = path.join(repoRoot, "tmp", "flow-identity-decisions-apply-test");
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
    assert.equal(manifest.json.counts.write_candidates, 1);
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
  const root = path.join(
    repoRoot,
    "tmp",
    "elementary-flow-identity-unresolved-trace-test",
  );
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
  const root = path.join(repoRoot, "tmp", "flow-identity-decision-proof-test");
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
  const root = path.join(
    repoRoot,
    "tmp",
    "process-identity-decision-template-test",
  );
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

test("mutation manifest requires full-context AI evidence and preserves deferred trace queues", () => {
  const fixture = createMutationManifestFixture();
  try {
    const blocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "blocked-manifest")),
    ]);
    assert.equal(blocked.code, 1);
    assert.equal(blocked.json.status, "blocked");
    assert.equal(blocked.json.evidence.patch_collect_required, true);
    assert.ok(
      itemBlockerCodes(blocked.json).has(
        "full_context_ai_completion_output_required",
      ),
    );
    assert.ok(
      itemBlockerCodes(blocked.json).has(
        "full_context_ai_deterministic_apply_required",
      ),
    );

    const blockedMissingDryRun = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "missing-dry-run-manifest")),
    ]);
    assert.equal(blockedMissingDryRun.code, 1);
    assert.equal(blockedMissingDryRun.json.status, "blocked");
    assert.equal(blockedMissingDryRun.json.evidence.dry_run_report, null);
    assert.ok(
      scopeBlockerCodes(blockedMissingDryRun.json).has(
        "dry_run_report_required",
      ),
    );
    assert.ok(
      itemBlockerCodes(blockedMissingDryRun.json).has(
        "dry_run_evidence_missing",
      ),
    );

    const dryRunRowsMismatchReport = path.join(
      mutationFixtureRoot,
      "dry-run-mismatch",
      "summary.json",
    );
    writeJson(dryRunRowsMismatchReport, {
      ...readJson(fixture.dryRunReport),
      input_path: rel(path.join(mutationFixtureRoot, "final", "other.jsonl")),
    });
    const mismatchedDryRun = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(dryRunRowsMismatchReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "dry-run-mismatch-manifest")),
    ]);
    assert.equal(mismatchedDryRun.code, 1);
    assert.ok(
      itemBlockerCodes(mismatchedDryRun.json).has(
        "dry_run_report_rows_mismatch",
      ),
    );

	    const classificationDecisionsFile = path.join(
	      mutationFixtureRoot,
	      "classification-decisions",
	      "classification-decisions.jsonl",
	    );
	    const classificationQueueFile = path.join(
	      mutationFixtureRoot,
	      "classification-decisions",
	      "classification-authoring-queue.jsonl",
	    );
	    const decisionOutputBeforeCleanup = path.join(
	      mutationFixtureRoot,
	      "patch-apply",
	      "processes.patched.jsonl",
	    );
	    writeJsonLines(classificationQueueFile, [
	      {
	        dataset_type: "process",
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        classification_workflow: {
	          schema_type: "process",
	          row_type: "process",
	          commands: {
	            input_rows: rel(decisionOutputBeforeCleanup),
	            output_rows: rel(decisionOutputBeforeCleanup),
	          },
	        },
	      },
	    ]);
	    const classificationDecisionTask = writeDecisionTaskFixture({
	      root: mutationFixtureRoot,
	      kind: "classification",
	      queueFile: classificationQueueFile,
	      contractContextFiles: fixture.contractContextFiles,
	    });
	    writeJsonLines(classificationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "process",
	        code: "1080",
	        basis:
	          "AI selected the process class from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
	        authoring_context: classificationDecisionTask.authoringContext,
	        evidence: {
	          source: "classification-authoring-queue",
	          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const classificationDecisionApplyReport = path.join(
      mutationFixtureRoot,
      "classification-decisions",
      "classification-decisions-apply-report.json",
    );
    writeJson(classificationDecisionApplyReport, {
	      schema_version: 1,
	      status: "completed",
	      decisions_file: rel(classificationDecisionsFile),
	      decision_task: {
	        path: rel(classificationDecisionTask.taskFile),
	        sha256: classificationDecisionTask.taskSha256,
	        context_bundle_sha256:
	          classificationDecisionTask.contextBundleSha256,
	      },
	      files: {
	        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    const classificationTraceBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-passed-manifest")),
    ]);
    assert.equal(classificationTraceBlocked.code, 1);
    assert.equal(classificationTraceBlocked.json.status, "blocked");
    assert.equal(
      classificationTraceBlocked.json.evidence.patch_collect_required,
      false,
    );
    assert.equal(
      classificationTraceBlocked.json.counts.ai_classification_decision_entries,
      1,
    );
    assert.equal(
      classificationTraceBlocked.json.counts.ai_patch_evidence_entries,
      0,
    );
	    assert.ok(
	      itemBlockerCodes(classificationTraceBlocked.json).has(
	        "unresolved_trace_patch_evidence_required",
	      ),
	    );

	    writeJsonLines(classificationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "process",
	        code: "1080",
	        basis:
	          "AI selected the process class from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
	        authoring_context: classificationDecisionTask.authoringContext,
	        evidence: {
	          source: "classification-authoring-queue",
	          quote_or_trace: "process baseName Fixture process",
	          used_context_kinds: fullContextKinds,
	        },
	      },
	    ]);
	    const classificationStatusBlocked = runFoundry([
	      "dataset-mutation-manifest",
	      "--type",
	      "process",
	      "--profile",
	      "bafu",
	      "--rows-file",
	      rel(fixture.rowsFile),
	      "--schema-report",
	      rel(fixture.schemaReport),
	      "--curation-gate-report",
	      rel(fixture.curationGateReport),
	      "--cleanup-report",
	      rel(fixture.cleanupReport),
	      "--dry-run-report",
	      rel(fixture.dryRunReport),
	      "--classification-decision-apply-report",
	      rel(classificationDecisionApplyReport),
	      "--target-user-id",
	      targetUserId,
	      "--out-dir",
	      rel(
	        path.join(
	          mutationFixtureRoot,
	          "classification-status-blocked-manifest",
	        ),
	      ),
	    ]);
	    assert.equal(classificationStatusBlocked.code, 1);
	    assert.ok(
	      scopeBlockerCodes(classificationStatusBlocked.json).has(
	        "full_context_ai_classification_decision_status_not_completed",
	      ),
	    );

	    const wrongKindClassificationTask = writeDecisionTaskFixture({
	      root: mutationFixtureRoot,
	      kind: "location",
	      queueFile: classificationQueueFile,
	      contractContextFiles: fixture.contractContextFiles,
	      dirName: "classification-wrong-kind-decision-task",
	    });
	    writeJsonLines(classificationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "process",
	        decision_status: "completed",
	        code: "1080",
	        basis:
	          "AI selected the process class from a task with the wrong task kind.",
	        authoring_context: wrongKindClassificationTask.authoringContext,
	        evidence: {
	          source: "classification-authoring-queue",
	          quote_or_trace: "process baseName Fixture process",
	          used_context_kinds: fullContextKinds,
	        },
	      },
	    ]);
	    writeJson(classificationDecisionApplyReport, {
	      schema_version: 1,
	      status: "completed",
	      decisions_file: rel(classificationDecisionsFile),
	      decision_task: {
	        path: rel(wrongKindClassificationTask.taskFile),
	        sha256: wrongKindClassificationTask.taskSha256,
	        context_bundle_sha256:
	          wrongKindClassificationTask.contextBundleSha256,
	      },
	      files: {
	        output_rows: [rel(decisionOutputBeforeCleanup)],
	      },
	      counts: {
	        applied: 1,
	      },
	    });
	    const classificationWrongTaskKindBlocked = runFoundry([
	      "dataset-mutation-manifest",
	      "--type",
	      "process",
	      "--profile",
	      "bafu",
	      "--rows-file",
	      rel(fixture.rowsFile),
	      "--schema-report",
	      rel(fixture.schemaReport),
	      "--curation-gate-report",
	      rel(fixture.curationGateReport),
	      "--cleanup-report",
	      rel(fixture.cleanupReport),
	      "--dry-run-report",
	      rel(fixture.dryRunReport),
	      "--classification-decision-apply-report",
	      rel(classificationDecisionApplyReport),
	      "--target-user-id",
	      targetUserId,
	      "--out-dir",
	      rel(
	        path.join(
	          mutationFixtureRoot,
	          "classification-wrong-task-kind-manifest",
	        ),
	      ),
	    ]);
	    assert.equal(classificationWrongTaskKindBlocked.code, 1);
	    assert.ok(
	      scopeBlockerCodes(classificationWrongTaskKindBlocked.json).has(
	        "full_context_ai_classification_decision_task_kind_invalid",
	      ),
	    );

	    const blockedStatusClassificationTask = writeDecisionTaskFixture({
	      root: mutationFixtureRoot,
	      kind: "classification",
	      queueFile: classificationQueueFile,
	      contractContextFiles: fixture.contractContextFiles,
	      dirName: "classification-blocked-status-decision-task",
	      status: "blocked_missing_full_context",
	    });
	    writeJsonLines(classificationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "process",
	        decision_status: "completed",
	        code: "1080",
	        basis:
	          "AI selected the process class from a task that is not ready.",
	        authoring_context: blockedStatusClassificationTask.authoringContext,
	        evidence: {
	          source: "classification-authoring-queue",
	          quote_or_trace: "process baseName Fixture process",
	          used_context_kinds: fullContextKinds,
	        },
	      },
	    ]);
	    writeJson(classificationDecisionApplyReport, {
	      schema_version: 1,
	      status: "completed",
	      decisions_file: rel(classificationDecisionsFile),
	      decision_task: {
	        path: rel(blockedStatusClassificationTask.taskFile),
	        sha256: blockedStatusClassificationTask.taskSha256,
	        context_bundle_sha256:
	          blockedStatusClassificationTask.contextBundleSha256,
	      },
	      files: {
	        output_rows: [rel(decisionOutputBeforeCleanup)],
	      },
	      counts: {
	        applied: 1,
	      },
	    });
	    const classificationTaskStatusBlocked = runFoundry([
	      "dataset-mutation-manifest",
	      "--type",
	      "process",
	      "--profile",
	      "bafu",
	      "--rows-file",
	      rel(fixture.rowsFile),
	      "--schema-report",
	      rel(fixture.schemaReport),
	      "--curation-gate-report",
	      rel(fixture.curationGateReport),
	      "--cleanup-report",
	      rel(fixture.cleanupReport),
	      "--dry-run-report",
	      rel(fixture.dryRunReport),
	      "--classification-decision-apply-report",
	      rel(classificationDecisionApplyReport),
	      "--target-user-id",
	      targetUserId,
	      "--out-dir",
	      rel(
	        path.join(
	          mutationFixtureRoot,
	          "classification-task-status-blocked-manifest",
	        ),
	      ),
	    ]);
	    assert.equal(classificationTaskStatusBlocked.code, 1);
	    assert.ok(
	      scopeBlockerCodes(classificationTaskStatusBlocked.json).has(
	        "full_context_ai_classification_decision_task_status_invalid",
	      ),
	    );

	    writeJson(classificationDecisionApplyReport, {
	      schema_version: 1,
	      status: "completed",
	      decisions_file: rel(classificationDecisionsFile),
	      decision_task: {
	        path: rel(classificationDecisionTask.taskFile),
	        sha256: classificationDecisionTask.taskSha256,
	        context_bundle_sha256:
	          classificationDecisionTask.contextBundleSha256,
	      },
	      files: {
	        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
	      counts: {
	        applied: 1,
	      },
	    });
	    writeJsonLines(classificationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "process",
	        decision_status: "completed",
	        code: "1080",
	        basis:
	          "AI selected the process class from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
	        authoring_context: classificationDecisionTask.authoringContext,
	        evidence: {
	          source: "classification-authoring-queue",
	          quote_or_trace: "process baseName Fixture process",
	          used_context_kinds: fullContextKinds,
	        },
	      },
	    ]);
	    const classificationChainedThroughCleanup = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-cleanup-chain")),
    ]);
    assert.equal(classificationChainedThroughCleanup.code, 1);
    assert.equal(
      classificationChainedThroughCleanup.json.status,
      "blocked",
    );
    assert.equal(
      classificationChainedThroughCleanup.json.evidence.patch_collect_required,
      false,
    );
    assert.equal(
      classificationChainedThroughCleanup.json.counts
        .ai_classification_decision_entries,
      1,
    );
    assert.ok(
      itemBlockerCodes(classificationChainedThroughCleanup.json).has(
        "unresolved_trace_patch_evidence_required",
      ),
    );

    const chainDir = path.join(
      mutationFixtureRoot,
      "identity-classification-chain",
    );
    const identityRowsFile = path.join(chainDir, "processes.identity.jsonl");
    const classifiedRowsFile = path.join(chainDir, "processes.classified.jsonl");
    writeJsonLines(identityRowsFile, readJsonLines(decisionOutputBeforeCleanup));
    writeJsonLines(classifiedRowsFile, readJsonLines(decisionOutputBeforeCleanup));
    const chainQueueFile = path.join(
      chainDir,
      "classification-authoring-queue.jsonl",
    );
    const chainClassificationDecisionsFile = path.join(
      chainDir,
      "classification-decisions.jsonl",
    );
    writeJsonLines(chainQueueFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        classification_workflow: {
          schema_type: "process",
          row_type: "process",
          commands: {
            input_rows: rel(identityRowsFile),
            output_rows: rel(classifiedRowsFile),
          },
        },
      },
    ]);
    const chainClassificationTask = writeDecisionTaskFixture({
      root: mutationFixtureRoot,
      kind: "classification",
      queueFile: chainQueueFile,
      contractContextFiles: fixture.contractContextFiles,
      dirName: "identity-chain-classification-decision-task",
    });
    writeJsonLines(chainClassificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis:
          "AI selected the process class after reading the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: chainClassificationTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const chainClassificationApplyReport = path.join(
      chainDir,
      "classification-decisions-apply-report.json",
    );
    writeJson(chainClassificationApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(chainClassificationDecisionsFile),
      decision_task: {
        path: rel(chainClassificationTask.taskFile),
        sha256: chainClassificationTask.taskSha256,
        context_bundle_sha256: chainClassificationTask.contextBundleSha256,
      },
      files: {
        input_rows: [rel(identityRowsFile)],
        output_rows: [rel(classifiedRowsFile)],
      },
      counts: {
        applied: 1,
      },
    });

    const curationGate = readJson(fixture.curationGateReport);
    const packageBinding = curationGate.entities[0];
    const identityDecisionsFile = path.join(
      chainDir,
      "identity-decisions.jsonl",
    );
    writeJsonLines(identityDecisionsFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        decision_status: "completed",
        identity_decision: "create_new",
        authoring_package: packageBinding.authoring_package,
        authoring_package_sha256: packageBinding.authoring_package_sha256,
        closes_action_items: ["identity_preflight_manual_review"],
        basis:
          "The process identity preflight did not find a reusable public candidate; the row remains a new process write candidate.",
        evidence: {
          source: "identity-preflight",
          quote_or_trace: "No duplicate process candidate exceeded the reuse threshold.",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const identityDecisionApplyReport = path.join(
      chainDir,
      "identity-decisions-apply-report.json",
    );
    writeJson(identityDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      dataset_type: "process",
      decisions_file: rel(identityDecisionsFile),
      files: {
        output_rows: [rel(identityRowsFile)],
      },
      counts: {
        decisions: 1,
        writes: 1,
        reference_reuse: 0,
      },
    });
    const chainCanonicalSupportRowsFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "processes.canonical-support-rewritten.jsonl",
    );
    writeJsonLines(
      chainCanonicalSupportRowsFile,
      readJsonLines(decisionOutputBeforeCleanup),
    );
    const chainCanonicalSupportRewritesFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "canonical-support-rewrites.jsonl",
    );
    const chainCanonicalSupportBlockersFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "canonical-support-blockers.jsonl",
    );
    const chainCanonicalSupportDeferredRowsFile = path.join(
      chainDir,
      "canonical-support-rewrites",
      "processes.canonical-support-deferred.jsonl",
    );
    writeJsonLines(chainCanonicalSupportRewritesFile, []);
    writeJsonLines(chainCanonicalSupportDeferredRowsFile, [
      {
        processDataSet: {
          processInformation: {
            dataSetInformation: {
              "common:UUID": "deferred-support-row",
            },
          },
        },
      },
    ]);
    writeJsonLines(chainCanonicalSupportBlockersFile, [
      {
        code: "canonical_flow_property_reference_unresolved",
        dataset_type: "process",
        dataset_id: "deferred-support-row",
        dataset_version: "00.00.001",
        source_unit: "my",
        message:
          "This row is isolated into the canonical support deferred rows file and must not block the ready output rows.",
      },
    ]);
    const chainCanonicalSupportReport = path.join(
      chainDir,
      "canonical-support-rewrites",
      "canonical-support-rewrite-report.json",
    );
    writeJson(chainCanonicalSupportReport, {
      schema_version: 1,
      status: "completed_with_deferred_rows",
      dataset_type: "process",
      rows_file: rel(decisionOutputBeforeCleanup),
      output_rows_file: rel(chainCanonicalSupportRowsFile),
      counts: {
        input_rows: 2,
        output_rows: 1,
        deferred_rows: 1,
        blockers: 0,
        deferred_blockers: 1,
        canonical_flow_property_reference_rewrites: 0,
        canonical_unit_group_reference_proofs: 0,
      },
      files: {
        report: rel(chainCanonicalSupportReport),
        input_rows: rel(decisionOutputBeforeCleanup),
        output_rows: rel(chainCanonicalSupportRowsFile),
        deferred_rows: rel(chainCanonicalSupportDeferredRowsFile),
        canonical_support_rewrites: rel(chainCanonicalSupportRewritesFile),
        canonical_support_blockers: rel(chainCanonicalSupportBlockersFile),
      },
      blockers: [],
      deferred_blockers: readJsonLines(chainCanonicalSupportBlockersFile),
    });
    const cleanupAfterCanonicalSupportReport = path.join(
      chainDir,
      "cleanup",
      "dataset-curation-cleanup-after-canonical-support-report.json",
    );
    writeJson(cleanupAfterCanonicalSupportReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "process",
      rows_file: rel(chainCanonicalSupportRowsFile),
      cleaned_rows_file: rel(fixture.rowsFile),
      files: {
        cleaned_rows: rel(fixture.rowsFile),
      },
    });
    const chainManifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(cleanupAfterCanonicalSupportReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--classification-decision-apply-report",
      rel(chainClassificationApplyReport),
      "--identity-decision-apply-report",
      rel(identityDecisionApplyReport),
      "--identity-reference-rewrite-input-rows",
      rel(classifiedRowsFile),
      "--identity-reference-rewrite-output-rows",
      rel(decisionOutputBeforeCleanup),
      "--canonical-support-rewrite-report",
      rel(chainCanonicalSupportReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(chainDir, "manifest")),
    ]);
    assert.equal(chainManifest.code, 0, JSON.stringify(chainManifest.json, null, 2));
    assert.equal(chainManifest.json.status, "ready_for_remote_write");
    assert.equal(
      scopeBlockerCodes(chainManifest.json).has(
        "full_context_ai_identity_rows_mismatch",
      ),
      false,
    );
    assert.equal(
      scopeBlockerCodes(chainManifest.json).has(
        "full_context_ai_classification_rows_mismatch",
      ),
      false,
    );
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_status,
      "completed_with_deferred_rows",
    );
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_blockers,
      0,
    );
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_deferred_blockers,
      1,
    );
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_deferred_row_count,
      1,
    );
    assert.equal(
      chainManifest.json.evidence.canonical_support_rewrite_deferred_rows,
      rel(chainCanonicalSupportDeferredRowsFile),
    );

	    const locationDecisionsFile = path.join(
	      mutationFixtureRoot,
	      "location-decisions",
	      "location-decisions.jsonl",
	    );
	    const locationQueueFile = path.join(
	      mutationFixtureRoot,
	      "location-decisions",
	      "location-authoring-queue.jsonl",
	    );
	    writeJsonLines(locationQueueFile, [
	      {
	        dataset_type: "process",
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        path:
	          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
	        location_workflow: {
	          schema_type: "location",
	          commands: {
	            input_rows: rel(decisionOutputBeforeCleanup),
	            output_rows: rel(decisionOutputBeforeCleanup),
	          },
	        },
	      },
	    ]);
	    const locationDecisionTask = writeDecisionTaskFixture({
	      root: mutationFixtureRoot,
	      kind: "location",
	      queueFile: locationQueueFile,
	      contractContextFiles: fixture.contractContextFiles,
	    });
		    writeJsonLines(locationDecisionsFile, [
		      {
		        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "location",
	        decision_status: "completed",
	        code: "CH",
        target_path:
          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
	        basis:
	          "AI selected the location code from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
	        authoring_context: locationDecisionTask.authoringContext,
	        evidence: {
	          source: "location-authoring-queue",
          quote_or_trace: "source geography Switzerland",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const locationDecisionApplyReport = path.join(
      mutationFixtureRoot,
      "location-decisions",
      "location-decisions-apply-report.json",
    );
    writeJson(locationDecisionApplyReport, {
	      schema_version: 1,
	      status: "completed",
	      decisions_file: rel(locationDecisionsFile),
	      decision_task: {
	        path: rel(locationDecisionTask.taskFile),
	        sha256: locationDecisionTask.taskSha256,
	        context_bundle_sha256: locationDecisionTask.contextBundleSha256,
	      },
	      files: {
	        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
      counts: {
        applied: 1,
      },
    });
    const locationTraceBlocked = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-passed-manifest")),
    ]);
    assert.equal(locationTraceBlocked.code, 1);
    assert.equal(locationTraceBlocked.json.status, "blocked");
    assert.equal(locationTraceBlocked.json.evidence.patch_collect_required, false);
    assert.equal(
      locationTraceBlocked.json.counts.ai_location_decision_entries,
      1,
    );
    assert.equal(locationTraceBlocked.json.counts.ai_patch_evidence_entries, 0);
	    assert.ok(
	      itemBlockerCodes(locationTraceBlocked.json).has(
	        "unresolved_trace_patch_evidence_required",
	      ),
	    );

	    writeJsonLines(locationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "location",
	        code: "CH",
	        target_path:
	          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
	        basis:
	          "AI selected the location code from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
	        authoring_context: locationDecisionTask.authoringContext,
	        evidence: {
	          source: "location-authoring-queue",
	          quote_or_trace: "source geography Switzerland",
	          used_context_kinds: fullContextKinds,
	        },
	      },
	    ]);
	    const locationStatusBlocked = runFoundry([
	      "dataset-mutation-manifest",
	      "--type",
	      "process",
	      "--profile",
	      "bafu",
	      "--rows-file",
	      rel(fixture.rowsFile),
	      "--schema-report",
	      rel(fixture.schemaReport),
	      "--curation-gate-report",
	      rel(fixture.curationGateReport),
	      "--cleanup-report",
	      rel(fixture.cleanupReport),
	      "--dry-run-report",
	      rel(fixture.dryRunReport),
	      "--location-decision-apply-report",
	      rel(locationDecisionApplyReport),
	      "--target-user-id",
	      targetUserId,
	      "--out-dir",
	      rel(path.join(mutationFixtureRoot, "location-status-blocked-manifest")),
	    ]);
	    assert.equal(locationStatusBlocked.code, 1);
	    assert.ok(
	      scopeBlockerCodes(locationStatusBlocked.json).has(
	        "full_context_ai_location_decision_status_not_completed",
	      ),
	    );

	    writeJson(locationDecisionApplyReport, {
	      schema_version: 1,
	      status: "completed",
	      decisions_file: rel(locationDecisionsFile),
	      decision_task: {
	        path: rel(locationDecisionTask.taskFile),
	        sha256: locationDecisionTask.taskSha256,
	        context_bundle_sha256: locationDecisionTask.contextBundleSha256,
	      },
	      files: {
	        output_rows: [rel(decisionOutputBeforeCleanup)],
      },
	      counts: {
	        applied: 1,
	      },
	    });
	    writeJsonLines(locationDecisionsFile, [
	      {
	        dataset_id: fixture.processId,
	        dataset_version: "00.00.001",
	        category_type: "location",
	        decision_status: "completed",
	        code: "CH",
	        target_path:
	          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
	        basis:
	          "AI selected the location code from the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
	        authoring_context: locationDecisionTask.authoringContext,
	        evidence: {
	          source: "location-authoring-queue",
	          quote_or_trace: "source geography Switzerland",
	          used_context_kinds: fullContextKinds,
	        },
	      },
	    ]);
	    const locationChainedThroughCleanup = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-cleanup-chain")),
    ]);
    assert.equal(locationChainedThroughCleanup.code, 1);
    assert.equal(
      locationChainedThroughCleanup.json.status,
      "blocked",
    );
    assert.equal(
      locationChainedThroughCleanup.json.evidence.patch_collect_required,
      false,
    );
    assert.equal(
      locationChainedThroughCleanup.json.counts.ai_location_decision_entries,
      1,
    );
    assert.ok(
      itemBlockerCodes(locationChainedThroughCleanup.json).has(
        "unresolved_trace_patch_evidence_required",
      ),
    );

    const patchApplyInputRows = readJson(fixture.patchApplyReport).input_path;
    writeJson(classificationDecisionApplyReport, {
      schema_version: 1,
      status: "completed",
      decisions_file: rel(classificationDecisionsFile),
      decision_task: {
        path: rel(classificationDecisionTask.taskFile),
        sha256: classificationDecisionTask.taskSha256,
        context_bundle_sha256:
          classificationDecisionTask.contextBundleSha256,
      },
      files: {
        output_rows: [patchApplyInputRows],
      },
      counts: {
        applied: 1,
      },
    });
    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        decision_status: "completed",
        code: "1080",
        basis:
          "AI selected the process class before field patching, using the full schema, methodology YAML, ruleset, classification schema, and location schema context.",
        authoring_context: classificationDecisionTask.authoringContext,
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: fullContextKinds,
        },
      },
    ]);
    const classificationChainedThroughPatch = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "classification-patch-chain")),
    ]);
    assert.equal(classificationChainedThroughPatch.code, 0);
    assert.equal(
      classificationChainedThroughPatch.json.status,
      "ready_for_remote_write",
    );
    assert.equal(
      scopeBlockerCodes(classificationChainedThroughPatch.json).has(
        "full_context_ai_classification_rows_mismatch",
      ),
      false,
    );

    const patchApplyReportPayload = readJson(fixture.patchApplyReport);
    const patchApplyOutputRows = path.join(
      repoRoot,
      patchApplyReportPayload.out_path,
    );
    const identityRewriteOutputRows = path.join(
      mutationFixtureRoot,
      "identity-reference-rewrites",
      "processes.identity-rewritten.jsonl",
    );
    writeJsonLines(identityRewriteOutputRows, readJsonLines(patchApplyOutputRows));
    const identityReferenceRewritesFile = path.join(
      mutationFixtureRoot,
      "identity-reference-rewrites",
      "identity-reference-rewrites.jsonl",
    );
    writeJsonLines(identityReferenceRewritesFile, [
      {
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        relation: "flow_reference_to_identity_preflight_duplicate",
        path: "processDataSet.exchanges.exchange.0.referenceToFlowDataSet",
        original: {
          ref_object_id: "fixture-original-flow",
          version: "00.00.001",
        },
        canonical: {
          ref_object_id: "fixture-canonical-flow",
          version: "00.00.001",
        },
        reason:
          "Fixture proves patch output was passed through identity reference rewrite before unresolved exchange externalization.",
      },
    ]);
    const externalizedRows = path.join(
      mutationFixtureRoot,
      "unresolved-exchange-externalization",
      "processes.externalized.jsonl",
    );
    writeJsonLines(externalizedRows, readJsonLines(identityRewriteOutputRows));
    const unresolvedExchangeTraces = path.join(
      mutationFixtureRoot,
      "unresolved-exchange-externalization",
      "unresolved-exchanges.jsonl",
    );
    writeJsonLines(unresolvedExchangeTraces, [
      {
        relation: "process_exchange_to_unresolved_elementary_flow_trace",
        action: "externalize_exchange_before_remote_write",
        dataset_type: "process",
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        row_index: 0,
        exchange_index: 0,
      },
    ]);
    const unresolvedExchangeExternalizationReport = path.join(
      mutationFixtureRoot,
      "unresolved-exchange-externalization",
      "unresolved-exchange-externalization-report.json",
    );
    writeJson(unresolvedExchangeExternalizationReport, {
      schema_version: 1,
      status: "completed",
      input_rows_file: rel(identityRewriteOutputRows),
      output_rows_file: rel(externalizedRows),
      counts: {
        rows: 1,
        affected_rows: 1,
        externalized_exchanges: 1,
      },
      files: {
        report: rel(unresolvedExchangeExternalizationReport),
        output_rows: rel(externalizedRows),
        traces: rel(unresolvedExchangeTraces),
      },
    });
    const canonicalSupportAfterExternalizationRows = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "processes.canonical-support-rewritten.jsonl",
    );
    writeJsonLines(
      canonicalSupportAfterExternalizationRows,
      readJsonLines(externalizedRows),
    );
    const canonicalSupportAfterExternalizationRewrites = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "canonical-support-rewrites.jsonl",
    );
    const canonicalSupportAfterExternalizationBlockers = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "canonical-support-blockers.jsonl",
    );
    writeJsonLines(canonicalSupportAfterExternalizationRewrites, []);
    writeJsonLines(canonicalSupportAfterExternalizationBlockers, []);
    const canonicalSupportAfterExternalizationReport = path.join(
      mutationFixtureRoot,
      "canonical-support-after-externalization",
      "canonical-support-rewrite-report.json",
    );
    writeJson(canonicalSupportAfterExternalizationReport, {
      schema_version: 1,
      status: "completed_no_rewrites",
      dataset_type: "process",
      rows_file: rel(externalizedRows),
      output_rows_file: rel(canonicalSupportAfterExternalizationRows),
      counts: {
        rows: 1,
        blockers: 0,
        canonical_flow_property_reference_rewrites: 0,
        canonical_unit_group_reference_proofs: 0,
      },
      files: {
        report: rel(canonicalSupportAfterExternalizationReport),
        input_rows: rel(externalizedRows),
        output_rows: rel(canonicalSupportAfterExternalizationRows),
        canonical_support_rewrites: rel(
          canonicalSupportAfterExternalizationRewrites,
        ),
        canonical_support_blockers: rel(
          canonicalSupportAfterExternalizationBlockers,
        ),
      },
    });
    const cleanupAfterExternalizationReport = path.join(
      mutationFixtureRoot,
      "cleanup",
      "dataset-curation-cleanup-after-externalization-report.json",
    );
    writeJson(cleanupAfterExternalizationReport, {
      schema_version: 2,
      status: "completed",
      dataset_type: "process",
      rows_file: rel(canonicalSupportAfterExternalizationRows),
      cleaned_rows_file: rel(fixture.rowsFile),
      files: {
        cleaned_rows: rel(fixture.rowsFile),
      },
    });
    const classificationChainedThroughPatchIdentityAndExternalization =
      runFoundry([
        "dataset-mutation-manifest",
        "--type",
        "process",
        "--profile",
        "bafu",
        "--rows-file",
        rel(fixture.rowsFile),
        "--schema-report",
        rel(fixture.schemaReport),
        "--curation-gate-report",
        rel(fixture.curationGateReport),
        "--cleanup-report",
        rel(cleanupAfterExternalizationReport),
        "--dry-run-report",
        rel(fixture.dryRunReport),
        "--classification-decision-apply-report",
        rel(classificationDecisionApplyReport),
        "--patch-collect-report",
        rel(fixture.patchCollectReport),
        "--require-patch-collect-report",
        "--patch-apply-report",
        rel(fixture.patchApplyReport),
        "--identity-reference-rewrite-status",
        "completed",
        "--identity-reference-rewrite-input-rows",
        rel(patchApplyOutputRows),
        "--identity-reference-rewrite-output-rows",
        rel(identityRewriteOutputRows),
        "--identity-reference-rewrites",
        rel(identityReferenceRewritesFile),
        "--unresolved-exchange-externalization-report",
        rel(unresolvedExchangeExternalizationReport),
        "--canonical-support-rewrite-report",
        rel(canonicalSupportAfterExternalizationReport),
        "--target-user-id",
        targetUserId,
        "--out-dir",
        rel(
          path.join(
            mutationFixtureRoot,
            "classification-patch-identity-externalization-chain",
          ),
        ),
      ]);
    assert.equal(classificationChainedThroughPatchIdentityAndExternalization.code, 0);
    assert.equal(
      classificationChainedThroughPatchIdentityAndExternalization.json.status,
      "ready_for_remote_write",
    );
    assert.equal(
      scopeBlockerCodes(
        classificationChainedThroughPatchIdentityAndExternalization.json,
      ).has("patch_apply_cleanup_input_mismatch"),
      false,
    );
    assert.equal(
      scopeBlockerCodes(
        classificationChainedThroughPatchIdentityAndExternalization.json,
      ).has("full_context_ai_classification_rows_mismatch"),
      false,
    );
    assert.equal(
      classificationChainedThroughPatchIdentityAndExternalization.json.evidence
        .unresolved_exchange_externalization_status,
      "completed",
    );
    assert.equal(
      classificationChainedThroughPatchIdentityAndExternalization.json.counts
        .unresolved_exchange_externalized,
      1,
    );

    writeJsonLines(classificationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "process",
        code: "1080",
        basis: "Context is intentionally incomplete.",
        evidence: {
          source: "classification-authoring-queue",
          quote_or_trace: "process baseName Fixture process",
          used_context_kinds: ["schema"],
        },
      },
    ]);
    const missingClassificationContext = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--classification-decision-apply-report",
      rel(classificationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(
        path.join(
          mutationFixtureRoot,
          "classification-context-blocked-manifest",
        ),
      ),
    ]);
    assert.equal(missingClassificationContext.code, 1);
    assert.ok(
      itemBlockerCodes(missingClassificationContext.json).has(
        "full_context_ai_classification_context_missing",
      ),
    );

    writeJsonLines(locationDecisionsFile, [
      {
        dataset_id: fixture.processId,
        dataset_version: "00.00.001",
        category_type: "location",
        code: "CH",
        target_path:
          "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
        basis: "Context is intentionally incomplete.",
        evidence: {
          source: "location-authoring-queue",
          quote_or_trace: "source geography Switzerland",
          used_context_kinds: ["schema"],
        },
      },
    ]);
    const missingLocationContext = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--location-decision-apply-report",
      rel(locationDecisionApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "location-context-blocked-manifest")),
    ]);
    assert.equal(missingLocationContext.code, 1);
    assert.ok(
      itemBlockerCodes(missingLocationContext.json).has(
        "full_context_ai_location_context_missing",
      ),
    );

    const passed = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "bafu",
      "--rows-file",
      rel(fixture.rowsFile),
      "--schema-report",
      rel(fixture.schemaReport),
      "--curation-gate-report",
      rel(fixture.curationGateReport),
      "--cleanup-report",
      rel(fixture.cleanupReport),
      "--dry-run-report",
      rel(fixture.dryRunReport),
      "--patch-collect-report",
      rel(fixture.patchCollectReport),
      "--require-patch-collect-report",
      "--patch-apply-report",
      rel(fixture.patchApplyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(mutationFixtureRoot, "passed-manifest")),
    ]);
    assert.equal(passed.code, 0);
    assert.equal(passed.json.status, "ready_for_remote_write");
    assert.equal(passed.json.counts.ai_patch_evidence_entries, 1);
    assert.equal(passed.json.counts.unresolved_trace_entries, 1);
    assert.equal(passed.json.counts.source_reference_rewrites, 1);
    assert.equal(passed.json.items[0].blockers.length, 0);
    assert.equal(passed.json.items[0].source_reference_rewrite_count, 1);

    const traceRows = readJsonLines(
      path.join(repoRoot, passed.json.files.unresolved_traces),
    );
    assert.equal(traceRows.length, 1);
    assert.equal(traceRows[0].entity_id, fixture.processId);
    assert.equal(traceRows[0].action_item_code, "source_system_boilerplate");
    assert.equal(traceRows[0].status, "unresolved_deferred");
    assert.equal(
      traceRows[0].evidence.quote_or_trace,
      "source_row.processDataSet.processInformation.dataSetInformation.generalComment absent",
    );
    const rewriteRows = readJsonLines(
      path.join(repoRoot, passed.json.files.source_reference_rewrites),
    );
    assert.equal(rewriteRows.length, 1);
    assert.equal(rewriteRows[0].dataset_id, fixture.processId);
    assert.equal(rewriteRows[0].relation, "dataset_format_source");
    assert.equal(
      rewriteRows[0].canonical.ref_object_id,
      "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    );
    assert.equal(
      rewriteRows[0].action,
      "rewrite_to_canonical_source_reference",
    );

    const manifest = readJson(path.join(repoRoot, passed.json.files.report));
    assert.equal(manifest.evidence.full_context_ai_completion_required, true);
    assert.equal(
      manifest.evidence.patch_collect_status,
      "ready_for_patch_apply",
    );
    assert.equal(manifest.evidence.patch_apply_status, "completed");
    assert.equal(manifest.counts.source_reference_rewrites, 1);
    assert.equal(
      manifest.files.source_reference_rewrites,
      passed.json.files.source_reference_rewrites,
    );
  } finally {
    fs.rmSync(mutationFixtureRoot, { recursive: true, force: true });
  }
});

test("mutation manifest blocks process writes when referenced datasets are not proven", () => {
  fs.rmSync(referenceClosureFixtureRoot, { recursive: true, force: true });
  const processId = "cccccccc-dddd-4eee-8fff-000000000001";
  const flowId = "dddddddd-eeee-4fff-8000-000000000002";
  const rowsFile = path.join(
    referenceClosureFixtureRoot,
    "rows",
    "processes.jsonl",
  );
  writeJsonLines(rowsFile, [processRowWithFlowRef(processId, flowId)]);

  const schemaReport = path.join(
    referenceClosureFixtureRoot,
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
    referenceClosureFixtureRoot,
    "qa",
    "process-qa-report.json",
  );
  writeJson(qaReport, {
    rows_file: rel(rowsFile),
    status: "completed_local_process_qa",
    blockers: [],
    findings: [],
  });
  const curationGateReport = path.join(
    referenceClosureFixtureRoot,
    "curation",
    "dataset-curation-gate-report.json",
  );
  writeJson(curationGateReport, {
    schema_version: 2,
    status: "ready",
    profile: "generic",
    dataset_type: "process",
    rows_file: rel(rowsFile),
    schema_report: rel(schemaReport),
    qa_report: rel(qaReport),
    entities: [
      {
        dataset_type: "process",
        entity_id: processId,
        version: "00.00.001",
        status: "ready",
        action_item_count: 0,
      },
    ],
  });
  const cleanupReport = path.join(
    referenceClosureFixtureRoot,
    "cleanup",
    "dataset-curation-cleanup-report.json",
  );
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(rowsFile),
    cleaned_rows_file: rel(rowsFile),
  });
  const progressJsonl = path.join(
    referenceClosureFixtureRoot,
    "dry-run",
    "progress.jsonl",
  );
  const failuresJsonl = path.join(
    referenceClosureFixtureRoot,
    "dry-run",
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
    referenceClosureFixtureRoot,
    "dry-run",
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

  try {
    const missingProof = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--curation-gate-report",
      rel(curationGateReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "missing-proof")),
    ]);
    assert.equal(missingProof.code, 1);
    assert.equal(missingProof.json.status, "blocked");
    assert.ok(
      scopeBlockerCodes(missingProof.json).has(
        "reference_closure_remote_verify_required",
      ),
    );
    assert.ok(
      itemBlockerCodes(missingProof.json).has(
        "reference_closure_remote_verify_required",
      ),
    );

    const remoteChecks = path.join(
      referenceClosureFixtureRoot,
      "remote-verify",
      "checks.jsonl",
    );
    writeJsonLines(remoteChecks, [
      {
        row_index: 0,
        role: "reference",
        table: "flows",
        type: "flow data set",
        id: flowId,
        version: "00.00.001",
        path: "/processDataSet/exchanges/exchange/0/referenceToFlowDataSet",
        status: "ok",
        latest_version: "00.00.001",
      },
    ]);
    const remoteVerifyReport = path.join(
      referenceClosureFixtureRoot,
      "remote-verify",
      "remote-verification-report.json",
    );
    writeJson(remoteVerifyReport, {
      schema_version: 1,
      status: "passed_remote_verification",
      root_policy: "candidate",
      input_path: rel(rowsFile),
      counts: {
        rows: 1,
        references: 1,
        checked: 1,
        blockers: 0,
      },
      blockers: [],
      files: {
        checks: rel(remoteChecks),
      },
    });
    const proven = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rowsFile),
      "--schema-report",
      rel(schemaReport),
      "--curation-gate-report",
      rel(curationGateReport),
      "--cleanup-report",
      rel(cleanupReport),
      "--dry-run-report",
      rel(dryRunReport),
      "--remote-verify-report",
      rel(remoteVerifyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "proven")),
    ]);
    assert.equal(proven.code, 0);
    assert.equal(proven.json.status, "ready_for_remote_write");
    assert.equal(proven.json.items[0].blockers.length, 0);

    const existingFlowId = "eeeeeeee-ffff-4000-8000-000000000003";
    const identityIndex = writeCompletedIdentityPreflightIndex(
      referenceClosureFixtureRoot,
      [
        {
          datasetType: "flow",
          id: flowId,
          name: "Methane",
          decision: "block_duplicate",
          status: "blocked",
          candidates: [
            {
              index: 0,
              id: existingFlowId,
              version: "00.00.001",
              state_code: 100,
              names: ["Methane"],
              fields: { type_of_dataset: "Elementary flow" },
              match_score: 100,
              match_reasons: ["equivalent_flow_core_fields"],
              decision_hint: "block_duplicate",
            },
          ],
        },
      ],
    );
    const rewriteReport = runFoundry([
      "dataset-identity-reference-rewrites-apply",
      "--type",
      "process",
      "--rows-file",
      rel(rowsFile),
      "--identity-preflight-index",
      rel(identityIndex),
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "identity-rewrites")),
    ]);
    assert.equal(rewriteReport.code, 0);
    assert.equal(rewriteReport.json.status, "completed");
    assert.equal(rewriteReport.json.counts.flow_reference_rewrites, 1);
    const rewrittenRowsFile = path.join(
      repoRoot,
      rewriteReport.json.files.output_rows,
    );
    const rewrittenProcess = readJsonLines(rewrittenRowsFile)[0];
    assert.equal(
      rewrittenProcess.processDataSet.exchanges.exchange[0]
        .referenceToFlowDataSet["@refObjectId"],
      existingFlowId,
    );

    const rewrittenSchemaReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-schema",
      "validation-report.json",
    );
    writeJson(rewrittenSchemaReport, {
      input_path: rel(rewrittenRowsFile),
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
    const rewrittenQaReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-qa",
      "process-qa-report.json",
    );
    writeJson(rewrittenQaReport, {
      rows_file: rel(rewrittenRowsFile),
      status: "completed_local_process_qa",
      blockers: [],
      findings: [],
    });
    const rewrittenCurationGateReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-curation",
      "dataset-curation-gate-report.json",
    );
    writeJson(rewrittenCurationGateReport, {
      schema_version: 2,
      status: "ready",
      profile: "generic",
      dataset_type: "process",
      rows_file: rel(rewrittenRowsFile),
      schema_report: rel(rewrittenSchemaReport),
      qa_report: rel(rewrittenQaReport),
      entities: [
        {
          dataset_type: "process",
          entity_id: processId,
          version: "00.00.001",
          status: "ready",
          action_item_count: 0,
        },
      ],
    });
    const rewrittenCleanupReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(rewrittenCleanupReport, {
      status: "completed",
      rows_file: rel(rewrittenRowsFile),
      cleaned_rows_file: rel(rewrittenRowsFile),
    });
    const rewrittenProgressJsonl = path.join(
      referenceClosureFixtureRoot,
      "rewritten-dry-run",
      "progress.jsonl",
    );
    const rewrittenFailuresJsonl = path.join(
      referenceClosureFixtureRoot,
      "rewritten-dry-run",
      "failures.jsonl",
    );
    writeJsonLines(rewrittenProgressJsonl, [
      {
        id: processId,
        version: "00.00.001",
        status: "prepared",
        operation: "would_insert",
      },
    ]);
    writeJsonLines(rewrittenFailuresJsonl, []);
    const rewrittenDryRunReport = path.join(
      referenceClosureFixtureRoot,
      "rewritten-dry-run",
      "summary.json",
    );
    writeJson(rewrittenDryRunReport, {
      status: "completed",
      mode: "dry-run",
      commit: false,
      input_path: rel(rewrittenRowsFile),
      files: {
        progress_jsonl: rel(rewrittenProgressJsonl),
        failures_jsonl: rel(rewrittenFailuresJsonl),
      },
    });
    const provenByIdentityRewrite = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "process",
      "--profile",
      "generic",
      "--rows-file",
      rel(rewrittenRowsFile),
      "--schema-report",
      rel(rewrittenSchemaReport),
      "--curation-gate-report",
      rel(rewrittenCurationGateReport),
      "--cleanup-report",
      rel(rewrittenCleanupReport),
      "--dry-run-report",
      rel(rewrittenDryRunReport),
      "--identity-reference-rewrites",
      rewriteReport.json.files.identity_reference_rewrites,
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(referenceClosureFixtureRoot, "proven-by-identity-rewrite")),
    ]);
    assert.equal(
      provenByIdentityRewrite.code,
      0,
      JSON.stringify(
        {
          status: provenByIdentityRewrite.json.status,
          counts: provenByIdentityRewrite.json.counts,
          scope_blockers:
            provenByIdentityRewrite.json.evidence?.scope_blockers ?? [],
          item_blockers:
            provenByIdentityRewrite.json.items?.flatMap(
              (item) => item.blockers ?? [],
            ) ?? [],
        },
        null,
        2,
      ),
    );
    assert.equal(
      provenByIdentityRewrite.json.status,
      "ready_for_remote_write",
    );
    assert.equal(
      provenByIdentityRewrite.json.counts.identity_reference_rewrites,
      1,
    );
    assert.equal(
      provenByIdentityRewrite.json.items[0].identity_reference_rewrite_count,
      1,
    );
    assert.equal(provenByIdentityRewrite.json.items[0].blockers.length, 0);
  } finally {
    fs.rmSync(referenceClosureFixtureRoot, { recursive: true, force: true });
  }
});

test("mutation manifest accepts mixed support rows with internal reference closure", () => {
  fs.rmSync(supportManifestFixtureRoot, { recursive: true, force: true });
  const contactId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const rowsFile = path.join(supportManifestFixtureRoot, "support.jsonl");
  const contactRow = {
    contactDataSet: {
      contactInformation: {
        dataSetInformation: {
          "common:UUID": contactId,
          shortName: { "@xml:lang": "en", "#text": "BAFU" },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToDataSetFormat": {
            "@type": "source data set",
            refObjectId: sourceId,
            version: "00.00.001",
            "common:shortDescription": {
              "@xml:lang": "en",
              "#text": "TIDAS",
            },
          },
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
        },
      },
    },
  };
  const sourceRow = {
    sourceDataSet: {
      sourceInformation: {
        dataSetInformation: {
          "common:UUID": sourceId,
          shortName: { "@xml:lang": "en", "#text": "TIDAS" },
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": {
            "@type": "contact data set",
            refObjectId: contactId,
            version: "00.00.001",
            "common:shortDescription": {
              "@xml:lang": "en",
              "#text": "BAFU",
            },
          },
        },
      },
    },
  };
  writeJsonLines(rowsFile, [contactRow, sourceRow]);
  const schemaReport = path.join(
    supportManifestFixtureRoot,
    "schema",
    "validation-report.json",
  );
  writeJson(schemaReport, {
    status: "completed",
    input_path: rel(rowsFile),
    rows: [
      {
        index: 0,
        id: contactId,
        version: "00.00.001",
        status: "valid",
        issues: [],
      },
      {
        index: 1,
        id: sourceId,
        version: "00.00.001",
        status: "valid",
        issues: [],
      },
    ],
  });
  const cleanupReport = path.join(
    supportManifestFixtureRoot,
    "cleanup",
    "dataset-curation-cleanup-report.json",
  );
  writeJson(cleanupReport, {
    status: "completed",
    rows_file: rel(rowsFile),
    cleaned_rows_file: rel(rowsFile),
  });
  const progressJsonl = path.join(
    supportManifestFixtureRoot,
    "dry-run",
    "progress.jsonl",
  );
  const failuresJsonl = path.join(
    supportManifestFixtureRoot,
    "dry-run",
    "failures.jsonl",
  );
  writeJsonLines(progressJsonl, [
    {
      id: contactId,
      version: "00.00.001",
      type: "contact",
      table: "contacts",
      status: "prepared",
      operation: "would_sync",
    },
    {
      id: sourceId,
      version: "00.00.001",
      type: "source",
      table: "sources",
      status: "prepared",
      operation: "would_sync",
    },
  ]);
  writeJsonLines(failuresJsonl, []);
  const dryRunReport = path.join(
    supportManifestFixtureRoot,
    "dry-run",
    "summary.json",
  );
  writeJson(dryRunReport, {
    status: "completed",
    mode: "dry_run",
    commit: false,
    input_path: rel(rowsFile),
    files: {
      progress_jsonl: rel(progressJsonl),
      failures_jsonl: rel(failuresJsonl),
    },
  });

  try {
    const result = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
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
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(supportManifestFixtureRoot, "manifest")),
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.json.status, "ready_for_remote_write");
    assert.equal(result.json.counts.write_candidates, 2);
    assert.equal(result.json.items[0].operation, "would_sync");
    assert.equal(result.json.items[0].dry_run_status, "success");
    assert.equal(result.json.items[1].operation, "would_sync");
    assert.equal(result.json.items[1].dry_run_status, "success");
    assert.equal(
      scopeBlockerCodes(result.json).has("curation_gate_report_required"),
      false,
    );
    assert.equal(
      scopeBlockerCodes(result.json).has(
        "reference_closure_remote_verify_required",
      ),
      false,
    );

    const remoteVerifyReport = path.join(
      supportManifestFixtureRoot,
      "remote-verify",
      "remote-verification-report.json",
    );
    writeJson(remoteVerifyReport, {
      schema_version: 1,
      status: "blocked_remote_verification",
      root_policy: "candidate",
      input_path: rel(rowsFile),
      counts: {
        rows: 2,
        references: 2,
        checked: 2,
        blockers: 2,
      },
      blockers: [
        {
          code: "missing_dataset",
          role: "reference",
          table: "sources",
          id: sourceId,
          version: "00.00.001",
          path: "/contactDataSet/administrativeInformation/dataEntryBy/common:referenceToDataSetFormat",
        },
        {
          code: "missing_dataset",
          role: "reference",
          table: "contacts",
          id: contactId,
          version: "00.00.001",
          path: "/sourceDataSet/administrativeInformation/publicationAndOwnership/common:referenceToOwnershipOfDataSet",
        },
      ],
    });
    const withInternalRemoteBlockers = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
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
      "--remote-verify-report",
      rel(remoteVerifyReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(supportManifestFixtureRoot, "manifest-with-remote")),
    ]);
    assert.equal(withInternalRemoteBlockers.code, 0);
    assert.equal(
      withInternalRemoteBlockers.json.status,
      "ready_for_remote_write",
    );
	    assert.equal(
	      itemBlockerCodes(withInternalRemoteBlockers.json).has(
	        "remote_reference_closure_blocked",
	      ),
	      false,
	    );

    const badSourceRowsFile = path.join(
      supportManifestFixtureRoot,
      "bad-source-support.jsonl",
    );
    const badSourceRow = JSON.parse(JSON.stringify(sourceRow));
    badSourceRow.sourceDataSet.sourceInformation.dataSetInformation[
      "common:shortName"
    ] = { "@xml:lang": "en", "#text": "ILCD format" };
    delete badSourceRow.sourceDataSet.sourceInformation.dataSetInformation
      .shortName;
    badSourceRow.sourceDataSet.sourceInformation.dataSetInformation.sourceCitation =
      "ILCD format";
    badSourceRow.sourceDataSet.sourceInformation.dataSetInformation.classificationInformation =
      {
        "common:classification": {
          "common:class": [
            {
              "@level": "0",
              "@classId": "data-format",
              "#text": "Data set formats",
            },
          ],
        },
      };
    writeJsonLines(badSourceRowsFile, [contactRow, badSourceRow]);
    const badSchemaReport = path.join(
      supportManifestFixtureRoot,
      "bad-source-schema",
      "validation-report.json",
    );
    writeJson(badSchemaReport, {
      status: "completed",
      input_path: rel(badSourceRowsFile),
      rows: [
        {
          index: 0,
          id: contactId,
          version: "00.00.001",
          status: "valid",
          issues: [],
        },
        {
          index: 1,
          id: sourceId,
          version: "00.00.001",
          status: "valid",
          issues: [],
        },
      ],
    });
    const badCleanupReport = path.join(
      supportManifestFixtureRoot,
      "bad-source-cleanup",
      "dataset-curation-cleanup-report.json",
    );
    writeJson(badCleanupReport, {
      status: "completed",
      rows_file: rel(badSourceRowsFile),
      cleaned_rows_file: rel(badSourceRowsFile),
    });
    const badProgressJsonl = path.join(
      supportManifestFixtureRoot,
      "bad-source-dry-run",
      "progress.jsonl",
    );
    const badFailuresJsonl = path.join(
      supportManifestFixtureRoot,
      "bad-source-dry-run",
      "failures.jsonl",
    );
    writeJsonLines(badProgressJsonl, [
      {
        id: contactId,
        version: "00.00.001",
        type: "contact",
        table: "contacts",
        status: "prepared",
        operation: "would_sync",
      },
      {
        id: sourceId,
        version: "00.00.001",
        type: "source",
        table: "sources",
        status: "prepared",
        operation: "would_sync",
      },
    ]);
    writeJsonLines(badFailuresJsonl, []);
    const badDryRunReport = path.join(
      supportManifestFixtureRoot,
      "bad-source-dry-run",
      "summary.json",
    );
    writeJson(badDryRunReport, {
      status: "completed",
      mode: "dry_run",
      commit: false,
      input_path: rel(badSourceRowsFile),
      files: {
        progress_jsonl: rel(badProgressJsonl),
        failures_jsonl: rel(badFailuresJsonl),
      },
    });
    const badSourceManifest = runFoundry([
      "dataset-mutation-manifest",
      "--type",
      "support",
      "--profile",
      "generic",
      "--rows-file",
      rel(badSourceRowsFile),
      "--schema-report",
      rel(badSchemaReport),
      "--cleanup-report",
      rel(badCleanupReport),
      "--dry-run-report",
      rel(badDryRunReport),
      "--target-user-id",
      targetUserId,
      "--out-dir",
      rel(path.join(supportManifestFixtureRoot, "bad-source-manifest")),
    ]);
    assert.equal(badSourceManifest.code, 1);
    assert.equal(badSourceManifest.json.status, "blocked");
    assert.equal(
      itemBlockerCodes(badSourceManifest.json).has(
        "source_identity_not_true_source",
      ),
      true,
    );
    assert.equal(
      itemBlockerCodes(badSourceManifest.json).has(
        "source_classification_not_true_source",
      ),
      true,
    );
	  } finally {
	    fs.rmSync(supportManifestFixtureRoot, { recursive: true, force: true });
	  }
	});
