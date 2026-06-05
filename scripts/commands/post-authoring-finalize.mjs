import fs from "node:fs";
import path from "node:path";
import { readOnlyStageContract } from "../lib/stage-contract.mjs";

const postAuthoringFinalizeStageContract = readOnlyStageContract([
  {
    stage: "prepare_scope",
    phase: "prepare",
    purpose:
      "Resolve dataset type, input rows, profile requirements, output directory, and full-context identity-preflight requirement.",
    inputs: ["rows file", "profile options", "queue/context options"],
    outputs: ["finalize scope"],
    side_effects: [],
  },
  {
    stage: "rewrite_and_cleanup",
    phase: "rewrite_cleanup",
    purpose:
      "Apply identity reference rewrites, unresolved exchange externalization, canonical support rewrites, and deterministic curation cleanup.",
    inputs: ["input rows", "identity/preflight indexes", "canonical support cache"],
    outputs: ["rewritten rows", "cleaned rows", "rewrite reports"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "gate_and_validate",
    phase: "gate_validate",
    purpose:
      "Run curation queue preparation, SDK validation, deterministic QA, location audit, curation gate, dry-run write planning, and optional remote reference verification.",
    inputs: ["cleaned rows", "context files", "queue artifacts"],
    outputs: ["validation/QA/gate/dry-run/remote-verify reports"],
    side_effects: ["runs sibling CLI read-only checks", "writes local .foundry artifact files"],
  },
  {
    stage: "mutation_manifest",
    phase: "gate_validate",
    purpose:
      "Build exact-scope mutation evidence and aggregate prewrite blockers before any explicit commit handoff.",
    inputs: ["cleaned rows", "all prewrite reports"],
    outputs: ["dataset-mutation-manifest report"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "report",
    phase: "report",
    purpose:
      "Emit the post-authoring finalize report with runtime stages, counts, files, and blockers.",
    inputs: ["runtime stage reports", "mutation manifest"],
    outputs: ["dataset-post-authoring-finalize-report.json"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);

export function createPostAuthoringFinalizeCommands({
  appendOption,
  applyCanonicalSupportRewrites,
  applyIdentityReferenceRewrites,
  blockersFromLocationAuditStage,
  booleanOption,
  compactStageReport,
  datasetRowsFileStem,
  ensureArray,
  externalizeUnresolvedProcessFlowExchanges,
  fileExists,
  normalizedList,
  nowIso,
  postAuthoringPrewriteGateBlockers,
  profileFullContextRequirement,
  repoRelativeMaybe,
  repoRelativePath,
  repoRoot,
  reportFileFromCliStage,
  resolveRepoPath,
  runDatasetCommitHandoffPlan,
  runDatasetCurationCleanup,
  runDatasetCurationGate,
  runDatasetMutationManifest,
  runFinalizeAutoCurationQueue,
  runFinalizeIdentityPreflightStage,
  runTiangongJsonStage,
  skippedPrewriteStage,
  sourceReferenceRewritesFileForRowsFile,
  unique,
  writeJson,
}) {
  function runDatasetPostAuthoringFinalize(options) {
    const datasetType = String(options.type || options.datasetType || "process")
      .trim()
      .toLowerCase();
    const supportTypes = ["contact", "source"];
    const mixedSupportTypes = ["support"];
    const authoredTypes = ["process", "flow", "lifecyclemodel"];
    const supportedTypes = [...supportTypes, ...mixedSupportTypes, ...authoredTypes];
    const requiresDeterministicQa = authoredTypes.includes(datasetType);
    const requiresCurationGate = authoredTypes.includes(datasetType);
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-post-authoring-finalize",
        usage: [
          "node scripts/foundry.mjs dataset-post-authoring-finalize --type <support|contact|source|process|flow|lifecyclemodel> --rows-file <patched-or-classified-rows.jsonl> --out-dir <finalize-dir> --profile <profile> --queue-dir <queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --run-identity-preflight --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <ruleset.json> --classification-decision-apply-report <classification-decisions-apply-report.json> --location-decision-apply-report <location-decisions-apply-report.json> --patch-collect-report <authoring-patch-collect-report.json> --patch-apply-report <dataset-patch-apply-report.json> --require-patch-collect-report --target-user-id <uuid> --verify-remote",
        ],
        purpose:
          "Run the post-AI authoring prewrite chain for support, process, flow, or lifecyclemodel rows: cleanup, SDK validate, location audit, dry-run publish/save, optional remote reference verification, and mutation manifest. Process/flow/lifecyclemodel rows additionally run deterministic QA and post-authoring curation gate. This command never commits rows.",
        ...postAuthoringFinalizeStageContract,
        supported_types: supportedTypes,
      };
    }
    if (!supportedTypes.includes(datasetType)) {
      throw new Error(
        `dataset-post-authoring-finalize supports support, contact, source, process, flow, and lifecyclemodel rows. Unsupported type: ${datasetType}.`,
      );
    }

    const rowsFile = resolveRepoPath(
      options.rowsFile || options.input || options.rows,
    );
    if (!rowsFile || !fileExists(rowsFile)) {
      throw new Error(
        "--rows-file is required and must point to patched or authored TIDAS rows.",
      );
    }

    const outDir = resolveRepoPath(
      options.outDir ||
        `.foundry/workspaces/${datasetType}-post-authoring-finalize`,
    );
    fs.mkdirSync(outDir, { recursive: true });
    const fullContextRequirement = profileFullContextRequirement(
      options.profile,
      datasetType,
    );
    const identityPreflightRequired =
      ["flow", "process"].includes(datasetType) &&
      (booleanOption(options.requireIdentityPreflight) ||
        Boolean(fullContextRequirement));
    const identityPreflightRunStage = runFinalizeIdentityPreflightStage({
      rowsFile,
      outDir,
      options,
    });

    const identityReferenceRewriteStage = applyIdentityReferenceRewrites({
      datasetType,
      rowsFile,
      outFile: path.join(
        outDir,
        "identity-reference-rewrites",
        `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`,
      ),
      outDir: path.join(outDir, "identity-reference-rewrites"),
      options,
      allowMissingIndex: true,
    });
    const identityReferenceRewriteFile = resolveRepoPath(
      identityReferenceRewriteStage.rewrite_file,
    );
    const identityRewrittenRowsFile =
      Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
        ? resolveRepoPath(identityReferenceRewriteStage.output_rows_file)
        : rowsFile;
    const unresolvedExchangeExternalizeStage =
      externalizeUnresolvedProcessFlowExchanges({
        datasetType,
        rowsFile: identityRewrittenRowsFile,
        outFile: path.join(
          outDir,
          "unresolved-exchange-externalization",
          `${datasetRowsFileStem(datasetType)}.unresolved-exchanges-externalized.jsonl`,
        ),
        outDir: path.join(outDir, "unresolved-exchange-externalization"),
        options,
      });
    const preCleanupRowsFile =
      Number(
        unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
      ) > 0
        ? resolveRepoPath(unresolvedExchangeExternalizeStage.output_rows_file)
        : identityRewrittenRowsFile;

    const canonicalSupportRewriteStage = applyCanonicalSupportRewrites({
      datasetType,
      rowsFile: preCleanupRowsFile,
      outFile: path.join(
        outDir,
        "canonical-support-rewrites",
        `${datasetRowsFileStem(datasetType)}.canonical-support-rewritten.jsonl`,
      ),
      outDir: path.join(outDir, "canonical-support-rewrites"),
      options,
    });
    const canonicalSupportRowsFile = resolveRepoPath(
      canonicalSupportRewriteStage.files?.output_rows ||
        canonicalSupportRewriteStage.output_rows_file,
    );
    const canonicalSupportReportFile = resolveRepoPath(
      canonicalSupportRewriteStage.files?.report,
    );
    const canonicalSupportPrewriteBlockers = ensureArray(
      canonicalSupportRewriteStage.blockers,
    ).map((blocker) => ({
      ...blocker,
      stage: "canonical_support_rewrites",
      source: "canonical_support_rewrites",
      severity: blocker.severity || "error",
    }));

    const cleanup = runDatasetCurationCleanup({
      repoRoot,
      options: {
        ...options,
        type: datasetType,
        rowsFile: canonicalSupportRowsFile || preCleanupRowsFile,
        outDir: path.join(outDir, "cleanup"),
        outFile:
          options.cleanedRowsFile || options.cleanedRows || options.outFile,
      },
    });
    const cleanedRowsFile = resolveRepoPath(
      cleanup.files?.cleaned_rows || cleanup.cleaned_rows_file,
    );
    const cleanupReportFile = resolveRepoPath(cleanup.files?.report);
    const curationQueueStage = runFinalizeAutoCurationQueue({
      datasetType,
      rowsFile,
      cleanedRowsFile,
      outDir,
      options,
      fullContextRequirement,
      identityReferenceRewriteStage,
    });
    const curationQueueDir =
      curationQueueStage.queue_dir ||
      resolveRepoPath(options.queueDir || options.curationQueueDir);

    const schemaOutDir = path.join(outDir, "schema", datasetType);
    const schemaStage = runTiangongJsonStage("schema_validate", [
        "dataset",
        "validate",
        "--type",
        datasetType === "support" ? "auto" : datasetType,
      "--input",
      cleanedRowsFile,
      "--out-dir",
      schemaOutDir,
      "--json",
    ]);
    schemaStage.report_file = reportFileFromCliStage(
      schemaStage,
      ["files.report"],
      path.join(schemaOutDir, "outputs", "validation-report.json"),
    );

    const qaOutDir = path.join(outDir, "qa", datasetType);
    const qaStage = requiresDeterministicQa
      ? runTiangongJsonStage(`${datasetType}_qa`, [
          "qa",
          datasetType,
          "--rows-file",
          cleanedRowsFile,
          "--out-dir",
          qaOutDir,
          "--json",
        ])
      : {
          stage: `${datasetType}_qa`,
          status: "not_required_for_support_rows",
          exit_code: 0,
          command: "skipped",
          args: [],
          stderr: "Support rows do not have a deterministic qa <type> gate.",
          report: { status: "not_required_for_support_rows" },
          report_file: null,
        };
    if (requiresDeterministicQa) {
      qaStage.report_file = reportFileFromCliStage(
        qaStage,
        ["files.report"],
        path.join(
          qaOutDir,
          datasetType === "flow"
            ? "flow_qa_report.json"
            : datasetType === "lifecyclemodel"
              ? "lifecyclemodel_qa_report.json"
              : "process-qa-report.json",
        ),
      );
    }

    const locationAuditOutDir = path.join(outDir, "location-audit", datasetType);
    const locationAuditStage = runTiangongJsonStage("location_audit", [
      "dataset",
      "classification",
      "audit",
      "--type",
      "location",
      "--input",
      cleanedRowsFile,
      "--out-dir",
      locationAuditOutDir,
      "--json",
    ]);
    locationAuditStage.report_file = reportFileFromCliStage(
      locationAuditStage,
      ["files.report"],
      path.join(locationAuditOutDir, "outputs", "location-audit-report.json"),
    );
    const locationAuditBlockers =
      blockersFromLocationAuditStage(locationAuditStage);

    const curationGate = requiresCurationGate
      ? runDatasetCurationGate({
          repoRoot,
          options: {
            ...options,
            type: datasetType,
            rowsFile: cleanedRowsFile,
            schemaReport: schemaStage.report_file,
            qaReport: qaStage.report_file,
  	          outDir: path.join(outDir, "curation-gate"),
  		          requireIdentityPreflight: identityPreflightRequired,
            identityReferenceRewrites: identityReferenceRewriteFile,
            classificationDecisionApplyReport:
              options.classificationDecisionApplyReport ||
              options.classificationDecisionsApplyReport,
            unresolvedExchangeExternalizationReport:
              unresolvedExchangeExternalizeStage.files?.report,
  	          identityDecisionApplyReport:
              options.identityDecisionApplyReport ||
              options.identityDecisionsApplyReport,
  	          queueDir: curationQueueDir,
            requireQueueContext:
              booleanOption(
                options.requireQueueContext ||
                  options.requireCurationQueueContext,
              ) ||
              (Boolean(fullContextRequirement) && datasetType === "process"),
          },
        })
      : {
          status: "not_required_for_support_rows",
          files: {},
        };
    const curationGateReportFile = requiresCurationGate
      ? resolveRepoPath(curationGate.files?.report)
      : null;
    const prewriteGateBlockers = postAuthoringPrewriteGateBlockers({
      schemaStage,
      qaStage,
      locationAuditBlockers,
      curationGate,
      curationGateReportFile,
      requireDeterministicQa: requiresDeterministicQa,
      requireCurationGate: requiresCurationGate,
    }).concat(canonicalSupportPrewriteBlockers);
    const prewriteGateReady = prewriteGateBlockers.length === 0;

    const dryRunOutDir = path.join(
      outDir,
      "dry-run",
      datasetType === "support" || supportTypes.includes(datasetType)
        ? `${datasetType}-save-draft`
        : datasetType === "flow"
        ? "flow-publish-version"
        : datasetType === "lifecyclemodel"
          ? "lifecyclemodel-save-draft"
          : "process-save-draft",
    );
    const dryRunArgs = (() => {
      if (datasetType === "support" || supportTypes.includes(datasetType)) {
        return [
          "dataset",
          "save-draft",
          "--type",
          datasetType === "support" ? "auto" : datasetType,
          "--input",
          cleanedRowsFile,
          "--out-dir",
          dryRunOutDir,
          "--dry-run",
          "--json",
        ];
      }
      if (datasetType === "flow") {
        return [
          "flow",
          "publish-version",
          "--input-file",
          cleanedRowsFile,
          "--out-dir",
          dryRunOutDir,
          "--dry-run",
          "--json",
        ];
      }
      if (datasetType === "lifecyclemodel") {
        return [
          "lifecyclemodel",
          "save-draft",
          "--input",
          cleanedRowsFile,
          "--out-dir",
          dryRunOutDir,
          "--dry-run",
          "--json",
        ];
      }
      return [
        "process",
        "save-draft",
        "--input",
        cleanedRowsFile,
        "--out-dir",
        dryRunOutDir,
        "--dry-run",
        "--json",
      ];
    })();
    if (datasetType === "flow") {
      appendOption(
        dryRunArgs,
        "--target-user-id",
        options.remoteTargetUserId || options.targetUserId,
      );
    }
    const dryRunStage = prewriteGateReady
      ? runTiangongJsonStage(
          datasetType === "support" || supportTypes.includes(datasetType)
            ? `${datasetType}_save_draft_dry_run`
            : datasetType === "flow"
            ? "flow_publish_version_dry_run"
            : datasetType === "lifecyclemodel"
              ? "lifecyclemodel_save_draft_dry_run"
              : "process_save_draft_dry_run",
          dryRunArgs,
        )
      : skippedPrewriteStage(
          datasetType === "support" || supportTypes.includes(datasetType)
            ? `${datasetType}_save_draft_dry_run`
            : datasetType === "flow"
            ? "flow_publish_version_dry_run"
            : datasetType === "lifecyclemodel"
              ? "lifecyclemodel_save_draft_dry_run"
              : "process_save_draft_dry_run",
          "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
        );
    if (prewriteGateReady) {
      dryRunStage.report_file = reportFileFromCliStage(
        dryRunStage,
        datasetType === "flow" ? ["files.report"] : ["files.summary_json"],
        datasetType === "support" || supportTypes.includes(datasetType)
          ? path.join(
              dryRunOutDir,
              "outputs",
              "dataset-save-draft",
              "summary.json",
            )
          : datasetType === "flow"
          ? path.join(
              dryRunOutDir,
              "flows_tidas_sdk_plus_classification_mcp_sync_report.json",
            )
          : datasetType === "lifecyclemodel"
            ? path.join(
                dryRunOutDir,
                "outputs",
                "save-draft-bundle",
                "summary.json",
              )
            : path.join(
                dryRunOutDir,
                "outputs",
                "save-draft-rpc",
                "summary.json",
              ),
      );
    }

    let remoteVerifyStage = null;
    let remoteVerifyReportFile = null;
    if (booleanOption(options.verifyRemote || options.precommitVerifyRemote)) {
      const remoteOutDir = path.join(outDir, "precommit-verify-remote");
      const remoteArgs = [
        "dataset",
        "verify-remote",
        "--input",
        cleanedRowsFile,
        "--out-dir",
        remoteOutDir,
        "--root-policy",
        String(options.remoteRootPolicy || options.rootPolicy || "candidate"),
        "--json",
      ];
      if (
        booleanOption(
          options.compareRootPayload || options.remoteCompareRootPayload,
        )
      ) {
        remoteArgs.push("--compare-root-payload");
      }
      appendOption(
        remoteArgs,
        "--target-user-id",
        options.remoteTargetUserId || options.targetUserId,
      );
      appendOption(
        remoteArgs,
        "--state-code",
        options.remoteStateCode || options.stateCode,
      );
      remoteVerifyStage = prewriteGateReady
        ? runTiangongJsonStage("remote_verify_precommit", remoteArgs)
        : skippedPrewriteStage(
            "remote_verify_precommit",
            "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
          );
      if (prewriteGateReady) {
        remoteVerifyStage.report_file = reportFileFromCliStage(
          remoteVerifyStage,
          ["files.report"],
          path.join(remoteOutDir, "outputs", "remote-verification-report.json"),
        );
        remoteVerifyReportFile = remoteVerifyStage.report_file;
      }
    }

    const identityDecisionApplyReportOptions = unique([
      ...normalizedList(options.identityDecisionApplyReport),
      ...normalizedList(options.identityDecisionsApplyReport),
      ...normalizedList(options.identityDecisionApplyReports),
      ...normalizedList(options.identityDecisionsApplyReports),
    ]);
    const identityDecisionApplyReportFiles = identityDecisionApplyReportOptions
      .map(resolveRepoPath)
      .filter(fileExists);

    const mutationManifest = runDatasetMutationManifest({
      repoRoot,
      options: {
        ...options,
        type: datasetType,
        rowsFile: cleanedRowsFile,
        referenceRowsFile:
          identityReferenceRewriteStage.reference_rows_file ||
          options.referenceRowsFile ||
          options.referenceRows ||
          options.reuseRowsFile,
        schemaReport: schemaStage.report_file,
        qaReport: requiresDeterministicQa ? qaStage.report_file : null,
        curationGateReport: requiresCurationGate
          ? curationGateReportFile
          : null,
        cleanupReport: cleanupReportFile,
        canonicalSupportRewriteReport: canonicalSupportReportFile,
        dryRunReport: prewriteGateReady ? dryRunStage.report_file : null,
        remoteVerifyReport: remoteVerifyReportFile,
        unresolvedExchangeExternalizationReport:
          unresolvedExchangeExternalizeStage.files?.report,
        classificationDecisionApplyReport:
          options.classificationDecisionApplyReport ||
          options.classificationDecisionsApplyReport,
  	      locationDecisionApplyReport:
  	        options.locationDecisionApplyReport ||
  	        options.locationDecisionsApplyReport,
        identityDecisionApplyReport:
          options.identityDecisionApplyReport ||
          options.identityDecisionsApplyReport,
        identityDecisionApplyReports: identityDecisionApplyReportOptions,
        identityReferenceRewriteStatus: identityReferenceRewriteStage.status,
        identityReferenceRewriteInputRows: rowsFile,
        identityReferenceRewriteOutputRows:
          identityReferenceRewriteStage.output_rows_file,
  	      sourceReferenceRewrites: sourceReferenceRewritesFileForRowsFile(
          rowsFile,
          options,
        ),
        identityReferenceRewrites: identityReferenceRewriteFile,
        outDir: path.join(outDir, "mutation-manifest"),
        requireCurationGate: requiresCurationGate,
      },
    });
    const patchApplyReportFile = resolveRepoPath(options.patchApplyReport);
    const patchCollectReportFile = resolveRepoPath(
      options.patchCollectReport || options.authoringPatchCollectReport,
    );
    const classificationDecisionApplyReportFile = resolveRepoPath(
      options.classificationDecisionApplyReport ||
        options.classificationDecisionsApplyReport,
    );
  	  const locationDecisionApplyReportFile = resolveRepoPath(
  	    options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
  	  );
    const stageReports = [
      {
        stage: "identity_preflight_run",
        status: identityPreflightRunStage.status,
        exit_code:
          [
            "not_requested",
            "planned",
            "completed",
            "completed_with_identity_findings",
          ].includes(identityPreflightRunStage.status)
            ? 0
            : 1,
        command:
          identityPreflightRunStage.status === "not_requested"
            ? "skipped"
            : "foundry.dataset-identity-preflight-run",
        args: [],
        stderr: "",
        report_file: identityPreflightRunStage.report_file,
      },
      {
        stage: "identity_reference_rewrites",
        status: identityReferenceRewriteStage.status,
        exit_code: identityReferenceRewriteStage.blockers.length > 0 ? 1 : 0,
        command: "foundry.dataset-identity-reference-rewrites-apply",
        args: [],
        stderr: "",
        report_file: null,
      },
      {
        stage: "unresolved_exchange_externalization",
        status: unresolvedExchangeExternalizeStage.status,
        exit_code: 0,
        command: "foundry.externalize-unresolved-process-flow-exchanges",
        args: [],
        stderr: "",
        report_file: resolveRepoPath(unresolvedExchangeExternalizeStage.files?.report),
      },
      {
        stage: "canonical_support_rewrites",
        status: canonicalSupportRewriteStage.status,
        exit_code:
          canonicalSupportRewriteStage.counts?.blockers > 0 ? 1 : 0,
        command: "foundry.dataset-canonical-support-rewrites-apply",
        args: [],
        stderr: "",
        report_file: canonicalSupportReportFile,
      },
      {
        stage: "curation_cleanup",
        status: cleanup.status,
        exit_code: 0,
        command: "foundry.dataset-curation-cleanup",
        args: [],
        stderr: "",
        report_file: cleanupReportFile,
      },
      {
        stage: "curation_queue",
        status: curationQueueStage.status,
        exit_code:
          curationQueueStage.status === "not_required" ||
          curationQueueStage.status === "provided" ||
          curationQueueStage.status === "ready"
            ? 0
            : 1,
        command:
          curationQueueStage.status === "not_required" ||
          curationQueueStage.status === "provided"
            ? "skipped"
            : "foundry.dataset-curation-queue-build",
        args: [],
        stderr:
          curationQueueStage.report?.foundry_wrapper?.stderr ||
          "",
        report_file: curationQueueStage.report_file,
      },
      schemaStage,
      qaStage,
      locationAuditStage,
      {
        stage: "post_authoring_curation_gate",
        status: curationGate.status,
        exit_code:
          !requiresCurationGate ||
          ["ready", "ready_with_profile_waivers"].includes(curationGate.status)
            ? 0
            : 1,
        command: "foundry.dataset-curation-gate",
        args: [],
        stderr: "",
        report_file: curationGateReportFile,
      },
      dryRunStage,
      ...(remoteVerifyStage ? [remoteVerifyStage] : []),
      {
        stage: "mutation_manifest",
        status: mutationManifest.status,
        exit_code: ["ready_for_remote_write", "ready_reference_only"].includes(
          mutationManifest.status,
        )
          ? 0
          : 1,
        command: "foundry.dataset-mutation-manifest",
        args: [],
        stderr: "",
        report_file: resolveRepoPath(mutationManifest.files?.report),
      },
    ];
    const mutationBlockerCount = Number(mutationManifest.counts?.blockers ?? 0);
    const mutationManifestBlockers = [];
    const seenMutationBlockers = new Set();
    const addMutationBlocker = (blocker, extra = {}) => {
      if (!blocker || typeof blocker !== "object") return;
      const normalized = {
        ...blocker,
        stage: blocker.stage || "mutation_manifest",
        source: "mutation_manifest",
        ...extra,
      };
      const key = JSON.stringify([
        normalized.code,
        normalized.stage,
        normalized.row_index,
        normalized.table,
        normalized.reference_id,
        normalized.reference_version,
        normalized.path,
      ]);
      if (seenMutationBlockers.has(key)) return;
      seenMutationBlockers.add(key);
      mutationManifestBlockers.push(normalized);
    };
    for (const blocker of ensureArray(mutationManifest.evidence?.scope_blockers)) {
      addMutationBlocker(blocker);
    }
    for (const item of ensureArray(mutationManifest.items)) {
      for (const blocker of ensureArray(item?.blockers)) {
        addMutationBlocker(blocker, {
          dataset_type: item?.dataset_type ?? null,
          entity_id: item?.entity_id ?? null,
          version: item?.version ?? null,
        });
      }
    }
    const blockerCount = mutationBlockerCount + prewriteGateBlockers.length;
    const status =
      prewriteGateBlockers.length > 0
        ? "blocked"
        : mutationManifest.status === "ready_for_remote_write"
          ? "ready_for_remote_write"
          : mutationBlockerCount > 0
            ? "blocked"
            : mutationManifest.status;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status,
      dataset_type: datasetType,
      profile: mutationManifest.profile || String(options.profile || "generic"),
      rows_file: repoRelativePath(rowsFile),
      pre_cleanup_rows_file: repoRelativeMaybe(preCleanupRowsFile),
      canonical_support_rows_file: repoRelativeMaybe(canonicalSupportRowsFile),
      final_rows_file: repoRelativeMaybe(cleanedRowsFile),
      remote_write_mode: "read-only",
      policy: {
        purpose:
          "Finalize AI-authored or support TIDAS rows into exact-scope prewrite evidence without committing to the database.",
        commit_boundary:
          "A later explicit CLI commit command is required after this report and mutation manifest are ready.",
        source_language_only_before_import: true,
        full_context_ai_patch_evidence:
          "When the active profile requires full-context AI completion, mutation manifest must prove deterministic AI semantic evidence: classification/location decision apply evidence for queued decisions, or patch collect/apply evidence with authoring package hash, closed action items, resolution.mode, and resolution.used_context_kinds for field patches.",
        identity_preflight_gate:
          identityPreflightRequired
            ? "Process/flow full-context profiles require completed CLI identity-preflight evidence from flow_hybrid_search/process_hybrid_search before post-authoring dry-run or remote write planning."
            : "Not required for this dataset type/profile unless --require-identity-preflight is provided.",
        location_code_audit:
          "Final rows must pass tiangong-lca dataset classification audit --type location against tidas_locations_category.json before remote write.",
      },
      counts: {
        blockers: blockerCount,
        mutation_manifest_blockers: mutationBlockerCount,
        prewrite_gate_blockers: prewriteGateBlockers.length,
        canonical_support_blockers:
          canonicalSupportRewriteStage.counts?.blockers ?? 0,
        canonical_support_input_rows:
          canonicalSupportRewriteStage.counts?.input_rows ?? null,
        canonical_support_output_rows:
          canonicalSupportRewriteStage.counts?.output_rows ?? null,
        canonical_support_deferred_rows:
          canonicalSupportRewriteStage.counts?.deferred_rows ?? 0,
        canonical_support_deferred_blockers:
          canonicalSupportRewriteStage.counts?.deferred_blockers ?? 0,
        canonical_flow_property_reference_rewrites:
          canonicalSupportRewriteStage.counts
            ?.canonical_flow_property_reference_rewrites ?? 0,
        canonical_unit_group_reference_proofs:
          canonicalSupportRewriteStage.counts
            ?.canonical_unit_group_reference_proofs ?? 0,
        full_context_ai_completion_required: Boolean(fullContextRequirement),
        identity_preflight_required: identityPreflightRequired,
        identity_preflight_run_selected:
          identityPreflightRunStage.report?.counts?.selected_rows ?? 0,
        identity_preflight_run_completed:
          identityPreflightRunStage.report?.counts?.completed ?? 0,
        identity_preflight_run_skipped_existing:
          identityPreflightRunStage.report?.counts?.skipped_existing_report ?? 0,
        identity_preflight_run_failed:
          identityPreflightRunStage.report?.counts?.failed ?? 0,
        location_audit_blockers: locationAuditBlockers.length,
        location_code_targets:
          locationAuditStage.report?.counts?.location_targets ?? 0,
        location_code_invalid: locationAuditStage.report?.counts?.invalid ?? 0,
        write_candidates: mutationManifest.counts?.write_candidates ?? 0,
        ai_patch_evidence_entries:
          mutationManifest.counts?.ai_patch_evidence_entries ?? 0,
        ai_classification_decision_entries:
          mutationManifest.counts?.ai_classification_decision_entries ?? 0,
  	      ai_location_decision_entries:
  	        mutationManifest.counts?.ai_location_decision_entries ?? 0,
        ai_identity_decision_entries:
          mutationManifest.counts?.ai_identity_decision_entries ?? 0,
  	      ai_semantic_evidence_entries:
  	        (Number(mutationManifest.counts?.ai_patch_evidence_entries ?? 0) ||
  	          0) +
  	        (Number(
  	          mutationManifest.counts?.ai_classification_decision_entries ?? 0,
  	        ) || 0) +
          (Number(mutationManifest.counts?.ai_location_decision_entries ?? 0) ||
            0) +
          (Number(mutationManifest.counts?.ai_identity_decision_entries ?? 0) ||
            0),
        unresolved_trace_entries:
          mutationManifest.counts?.unresolved_trace_entries ?? 0,
        unresolved_exchange_externalized:
          unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
        blocked_flow_dependency_externalized:
          unresolvedExchangeExternalizeStage.counts
            ?.blocked_flow_dependency_externalized ?? 0,
        source_exchange_completeness_entries:
          mutationManifest.counts?.source_exchange_completeness_entries ?? 0,
        source_reference_rewrites:
          mutationManifest.counts?.source_reference_rewrites ?? 0,
        identity_reference_rewrites:
          mutationManifest.counts?.identity_reference_rewrites ?? 0,
        identity_flow_reference_rewrites:
          identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0,
        identity_reference_reuse_rows:
          identityReferenceRewriteStage.counts?.reference_rows ?? 0,
        curation_queue_status:
          curationQueueStage.status === "not_required"
            ? "not_required"
            : curationQueueStage.status,
        curation_queue_blockers:
          curationQueueStage.report?.counts?.blockers ?? 0,
        curation_queue_tasks:
          curationQueueStage.report?.counts?.tasks ?? 0,
        curation_queue_process_rows:
          curationQueueStage.report?.counts?.process_rows ?? 0,
        curation_queue_flow_rows:
          curationQueueStage.report?.counts?.flow_rows ?? 0,
        curation_queue_external_flow_refs:
          curationQueueStage.report?.counts?.external_flow_refs ?? 0,
        full_context_scope_blockers:
          mutationManifest.evidence?.scope_blockers?.filter((blocker) =>
            String(blocker?.stage ?? "").includes("full_context_ai_completion"),
          ).length ?? 0,
      },
      blockers: [...prewriteGateBlockers, ...mutationManifestBlockers],
      stages: stageReports.map(compactStageReport),
      files: {
        cleanup_report: repoRelativeMaybe(cleanupReportFile),
        canonical_support_rewrite_report:
          repoRelativeMaybe(canonicalSupportReportFile),
        canonical_support_rewritten_rows:
          repoRelativeMaybe(canonicalSupportRowsFile),
        canonical_support_deferred_rows:
          canonicalSupportRewriteStage.files?.deferred_rows ?? null,
        canonical_support_rewrites:
          canonicalSupportRewriteStage.files?.canonical_support_rewrites ?? null,
        canonical_support_blockers:
          canonicalSupportRewriteStage.files?.canonical_support_blockers ?? null,
        identity_reference_rewrites:
          identityReferenceRewriteStage.rewrite_file ?? null,
        identity_preflight_run_report:
          repoRelativeMaybe(identityPreflightRunStage.report_file),
        identity_rewritten_rows:
          Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
            ? identityReferenceRewriteStage.output_rows_file
            : null,
        unresolved_exchange_externalization_report:
          unresolvedExchangeExternalizeStage.files?.report ?? null,
        unresolved_exchange_externalized_rows:
          Number(
            unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
          ) > 0
            ? unresolvedExchangeExternalizeStage.files?.output_rows
            : null,
        unresolved_exchange_traces:
          unresolvedExchangeExternalizeStage.files?.traces ?? null,
        identity_reference_reuse_rows:
          identityReferenceRewriteStage.reference_rows_file ?? null,
        curation_queue_dir: repoRelativeMaybe(curationQueueDir),
        curation_queue_report: repoRelativeMaybe(curationQueueStage.report_file),
        curation_queue_identity_external_flow_refs:
          curationQueueStage.files?.identity_external_flow_refs ?? null,
        curation_queue_process_reference_external_flow_refs:
          curationQueueStage.files?.process_reference_external_flow_refs ?? null,
        final_rows: repoRelativeMaybe(cleanedRowsFile),
        schema_report: repoRelativeMaybe(schemaStage.report_file),
        qa_report: repoRelativeMaybe(qaStage.report_file),
        location_audit_report: repoRelativeMaybe(locationAuditStage.report_file),
        curation_gate_report: repoRelativeMaybe(curationGateReportFile),
        patch_collect_report: repoRelativeMaybe(patchCollectReportFile),
        patch_apply_report: repoRelativeMaybe(patchApplyReportFile),
        classification_decision_apply_report: repoRelativeMaybe(
          classificationDecisionApplyReportFile,
        ),
  	      location_decision_apply_report: repoRelativeMaybe(
  	        locationDecisionApplyReportFile,
  	      ),
        identity_decision_apply_reports: identityDecisionApplyReportFiles.map((file) =>
          repoRelativePath(file),
        ),
  	      patch_evidence: mutationManifest.evidence?.patch_evidence_file ?? null,
        dry_run_report: repoRelativeMaybe(dryRunStage.report_file),
        remote_verify_report: repoRelativeMaybe(remoteVerifyReportFile),
        mutation_manifest: mutationManifest.files?.report ?? null,
        unresolved_traces: mutationManifest.files?.unresolved_traces ?? null,
        source_exchange_completeness_traces:
          mutationManifest.files?.source_exchange_completeness_traces ?? null,
        source_reference_rewrites:
          mutationManifest.files?.source_reference_rewrites ?? null,
        mutation_identity_reference_rewrites:
          mutationManifest.files?.identity_reference_rewrites ?? null,
      },
    };
    const reportPath = path.join(
      outDir,
      "dataset-post-authoring-finalize-report.json",
    );
    writeJson(reportPath, report);
    const commitHandoffPlan = runDatasetCommitHandoffPlan({
      finalizeReport: reportPath,
      outDir: path.join(outDir, "commit-handoff"),
      stateCode:
        options.commitStateCode ??
        options.postWriteStateCode ??
        options.stateCode,
      targetUserId: options.targetUserId,
      rootPolicy:
        options.postWriteRootPolicy ||
        options.rootPolicy ||
        options.remoteRootPolicy,
    });
    const finalReport = {
      ...report,
      counts: {
        ...report.counts,
        commit_handoff_blockers: commitHandoffPlan.counts?.blockers ?? 0,
      },
      commit_handoff: {
        status: commitHandoffPlan.status,
        command: commitHandoffPlan.commands?.commit ?? null,
        post_write_verify_command:
          commitHandoffPlan.commands?.post_write_verify ?? null,
        blockers: commitHandoffPlan.blockers ?? [],
      },
      files: {
        ...report.files,
        commit_handoff_plan: commitHandoffPlan.files?.report ?? null,
      },
    };
    writeJson(reportPath, finalReport);
    return {
      ...finalReport,
      files: {
        ...finalReport.files,
        report: repoRelativePath(reportPath),
      },
    };
  }

  return { runDatasetPostAuthoringFinalize };
}
