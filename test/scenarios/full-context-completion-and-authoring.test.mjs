import test from "node:test";
import { annualSupplyFixtureRoot, assert, blockerCodes, bundledCategorySchemaNames, classificationFixtureRoot, contextFile, contextTextByPathSuffix, createFixture, createMutationManifestFixture, crypto, elementaryFlowManifestFixtureRoot, finalizeAutoQueueFixtureRoot, finalizeCurationGateFixtureRoot, finalizeIdentityPreflightFixtureRoot, finalizeLocationFixtureRoot, fixtureRoot, flowClassificationFixtureRoot, flowIdentityReferenceFixtureRoot, flowRow, flowRowWithClassification, fs, fullContextKinds, fullContextPatterns, identityPreflightRunFixtureRoot, itemBlockerCodes, locationFixtureRoot, mutationFixtureRoot, packageContextFixtureRoot, path, processRowWithDefaultClassification, processRowWithDeferredTrace, processRowWithFlowRef, processRowWithInvalidAnnualSupply, processRowWithInvalidLocation, processRowWithOnlyOutputExchange, qaPathFixtureRoot, readJson, readJsonLines, referenceClosureFixtureRoot, rel, repoRoot, runFoundry, scopeBlockerCodes, sha256Text, siblingCliBuildAvailable, siblingCliRoot, sourceExchangeFixtureRoot, sourceRow, spawnSync, supportManifestFixtureRoot, targetUserId, writeCompletedIdentityPreflightIndex, writeContextPackFiles, writeDecisionTaskFixture, writeJson, writeJsonLines, writeReadyFinalizeFixture, writeText } from "../fixtures/foundry-harness.mjs";


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
