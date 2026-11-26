import fs from "node:fs";
import path from "node:path";
import { selectFinalizeReferenceInputs } from "./finalize-reference-inputs.ts";
import {
  attachHandoffAndLedgerToFinalizeReport,
  attachLocationAuditReportFile,
  attachQaReportFile,
  buildCurationGateOptions,
  buildDeterministicQaArgs,
  buildFinalizeReportCountsAndFiles,
  buildFinalizeReportPolicy,
  buildImportLedgerReportInput,
  buildLocationAuditArgs,
  buildMutationManifestOptions,
  buildNestedSupportFinalizeResetDefaults,
  buildRemoteVerifyCliArgs,
  buildSkippedSupportQaStage,
  normalizeSchemaValidateStage,
  readFinalizeValidationReferences,
} from "./post-authoring-report-counts.ts";
import {
  attachDryRunReportFile,
  buildCleanupBlockedFinalizeResult,
  buildDryRunCliArgs,
  buildFinalizeStageReports,
  collectMutationManifestBlockers,
  computeSourceContactSupportSummary,
  resolveDryRunStageTarget,
  runRemoteVerifyFinalizeStageBody,
} from "./post-authoring-reports.ts";
import { createSourceContactRewriteRunner } from "./post-authoring-support-rewrites.ts";
import {
  compactStageReportWithTiming,
  postAuthoringFinalizeStageContract,
  stageStatus,
  timedFinalizeStage,
  verifiedReferenceLedgerFilesForDir,
  type FinalizeDependencies,
  type FinalizeIdentityRequest,
  type FinalizeOptions,
  type FinalizeStage,
  type FinalizeTiming,
} from "./post-authoring-types.ts";

export function createPostAuthoringFinalizeCommands(deps: FinalizeDependencies) {
  const {
    applyCanonicalSupportRewrites,
    applyIdentityReferenceRewrites,
    profileFor,
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
    readReferenceBytes = (file: string) => fs.readFileSync(file),
    resolveRepoPath,
    runDatasetCommitHandoffPlan,
    runDatasetCurationCleanup,
    runDatasetCurationGate,
    runDatasetMutationManifest,
    runFinalizeAutoCurationQueue,
    runFinalizeIdentityPreflightStage,
    runTidasRowsValidation,
    runTiangongJsonStage,
    skippedPrewriteStage,
    sourceReferenceRewritesFileForRowsFile,
    unique,
    writeFinalizeImportLedger,
    writeJson,
  } = deps;
  const applySourceContactRewrites = createSourceContactRewriteRunner(deps);

  function* finalizeStages(
    options: FinalizeOptions,
    asynchronousIdentity: boolean,
  ): Generator<FinalizeIdentityRequest, FinalizeStage, FinalizeStage> {
    const finalizeStartedAtUtc = nowIso();
    const finalizeStartedAtMs = Date.now();
    const finalizeTimings: FinalizeTiming[] = [];
    const timeStage = <T extends FinalizeStage>(stage: string, fn: () => T): T =>
      timedFinalizeStage(finalizeTimings, stage, nowIso, fn);
    const datasetType = String(options.type || options.datasetType || "process")
      .trim()
      .toLowerCase();
    const taskAuthorization =
      typeof profileFor === "function"
        ? profileFor(
            repoRoot,
            String(options.profile || "generic")
              .trim()
              .toLowerCase(),
            options,
          )?.authorization
        : null;
    const supportTypes = ["contact", "source"];
    const authoredTypes = ["process", "flow", "lifecyclemodel"];
    const supportedTypes = [...supportTypes, "support", ...authoredTypes];
    const requiresDeterministicQa = authoredTypes.includes(datasetType);
    const requiresCurationGate = supportedTypes.includes(datasetType);
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-post-authoring-finalize",
        usage: [
          "node src/dev-cli.ts dataset-post-authoring-finalize --type <support|contact|source|process|flow|lifecyclemodel> --rows-file <patched-or-classified-rows.jsonl> --out-dir <finalize-dir> --profile <profile> --queue-dir <queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --run-identity-preflight --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <ruleset.json> --classification-decision-apply-report <classification-decisions-apply-report.json> --location-decision-apply-report <location-decisions-apply-report.json> --patch-collect-report <authoring-patch-collect-report.json> --patch-apply-report <dataset-patch-apply-report.json> --require-patch-collect-report --target-user-id <uuid> --verify-remote --finalize-source-contact-support --ledger-dir <task-import-ledger-dir>",
        ],
        purpose:
          "Run the post-AI authoring prewrite chain for support, process, flow, or lifecyclemodel rows: cleanup, native Rust tidas validation, location audit, post-authoring curation gate, dry-run publish/save, optional remote reference verification, and mutation manifest. Process/flow/lifecyclemodel rows additionally run deterministic QA. This command never commits rows.",
        ...postAuthoringFinalizeStageContract,
        supported_types: supportedTypes,
      };
    }
    if (!supportedTypes.includes(datasetType)) {
      throw new Error(
        `dataset-post-authoring-finalize supports support, contact, source, process, flow, and lifecyclemodel rows. Unsupported type: ${datasetType}.`,
      );
    }
    const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.rows);
    if (!rowsFile || !fileExists(rowsFile)) {
      throw new Error("--rows-file is required and must point to patched or authored TIDAS rows.");
    }
    const referenceInputs = selectFinalizeReferenceInputs({
      options,
      datasetType,
      verifyRemote: booleanOption(options.verifyRemote || options.precommitVerifyRemote),
      resolveFile: resolveRepoPath,
    });
    const outDir = resolveRepoPath(
      options.outDir || `.foundry/workspaces/${datasetType}-post-authoring-finalize`,
    )!;
    fs.mkdirSync(outDir, { recursive: true });
    const fullContextRequirement = profileFullContextRequirement(options.profile, datasetType);
    const identityPreflightRequired =
      ["flow", "process"].includes(datasetType) &&
      (booleanOption(options.requireIdentityPreflight) || Boolean(fullContextRequirement));
    const stem = datasetRowsFileStem(datasetType);
    const identityReferenceRewriteStage = timeStage("identity_reference_rewrites", () =>
      applyIdentityReferenceRewrites({
        datasetType,
        rowsFile,
        outFile: path.join(
          outDir,
          "identity-reference-rewrites",
          `${stem}.identity-rewritten.jsonl`,
        ),
        outDir: path.join(outDir, "identity-reference-rewrites"),
        options,
        allowMissingIndex: true,
      }),
    );
    const identityReferenceRewriteFile = resolveRepoPath(
      identityReferenceRewriteStage.rewrite_file,
    );
    const identityRewrittenRowsFile =
      Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
        ? resolveRepoPath(identityReferenceRewriteStage.output_rows_file)!
        : rowsFile;
    const unresolvedExchangeExternalizeStage = timeStage(
      "unresolved_exchange_externalization",
      () =>
        externalizeUnresolvedProcessFlowExchanges({
          datasetType,
          rowsFile: identityRewrittenRowsFile,
          outFile: path.join(
            outDir,
            "unresolved-exchange-externalization",
            `${stem}.unresolved-exchanges-externalized.jsonl`,
          ),
          outDir: path.join(outDir, "unresolved-exchange-externalization"),
          options,
        }),
    );
    const preCleanupRowsFile =
      Number(unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0) > 0
        ? resolveRepoPath(unresolvedExchangeExternalizeStage.output_rows_file)!
        : identityRewrittenRowsFile;
    const sourceContactRewriteStage = timeStage("source_contact_rewrites", () =>
      applySourceContactRewrites({
        datasetType,
        rowsFile: preCleanupRowsFile,
        outDir: path.join(outDir, "source-contact-rewrites"),
        options,
      }),
    );
    const canonicalUnitGroupReferenceKeys =
      sourceContactRewriteStage.canonical_support?.canonical_unit_group_reference_keys ?? [];
    void canonicalUnitGroupReferenceKeys;
    const sourceContactRowsFile = resolveRepoPath(
      sourceContactRewriteStage.files?.output_rows || sourceContactRewriteStage.output_rows_file,
    )!;
    const sourceContactSupportRowsFile = resolveRepoPath(
      sourceContactRewriteStage.files?.support_rows,
    );
    const sourceContactSupportFinalizeRequested =
      authoredTypes.includes(datasetType) &&
      fileExists(sourceContactSupportRowsFile) &&
      booleanOption(
        options.finalizeSourceContactSupport ||
          options.prepareSourceContactSupport ||
          options.autoFinalizeSourceContactSupport,
      );
    const sourceContactSupportFinalizeType =
      Number(sourceContactRewriteStage.counts?.support_source_rows ?? 0) > 0 ||
      Number(sourceContactRewriteStage.counts?.support_account_local_fp_ug_rows ?? 0) > 0
        ? "support"
        : "contact";
    let sourceContactSupportFinalize: FinalizeStage = {
      status: sourceContactSupportRowsFile ? "available_not_requested" : "not_required",
      counts: { blockers: 0, write_candidates: 0 },
      files: {
        report: null,
        final_rows: sourceContactSupportRowsFile
          ? repoRelativePath(sourceContactSupportRowsFile)
          : null,
      },
      commit_handoff: { status: "not_requested", blockers: [] },
      blockers: [],
    };
    const finalizeSourceContactSupport = (): FinalizeStage =>
      runDatasetPostAuthoringFinalize({
        ...options,
        type: sourceContactSupportFinalizeType,
        rowsFile: sourceContactSupportRowsFile,
        outDir: path.join(outDir, "source-contact-support-finalize"),
        cleanedRowsFile: null,
        cleanedRows: null,
        outFile: null,
        out: null,
        ...buildNestedSupportFinalizeResetDefaults(),
      });

    const canonicalSupportRewriteStage = timeStage("canonical_support_rewrites", () =>
      applyCanonicalSupportRewrites({
        datasetType,
        rowsFile: sourceContactRowsFile || preCleanupRowsFile,
        outFile: path.join(
          outDir,
          "canonical-support-rewrites",
          `${stem}.canonical-support-rewritten.jsonl`,
        ),
        outDir: path.join(outDir, "canonical-support-rewrites"),
        options: {
          ...options,
          prepareAccountLocalSupportCandidates: booleanOption(options.mintUnmatchedFpUgSupport),
        },
      }),
    );
    const canonicalSupportRowsFile = resolveRepoPath(
      canonicalSupportRewriteStage.files?.output_rows ||
        canonicalSupportRewriteStage.output_rows_file,
    )!;
    const canonicalSupportReportFile = resolveRepoPath(canonicalSupportRewriteStage.files?.report);
    const canonicalSupportPrewriteBlockers = ensureArray(canonicalSupportRewriteStage.blockers).map(
      (blocker) => ({
        ...blocker,
        stage: "canonical_support_rewrites",
        source: "canonical_support_rewrites",
        severity: blocker.severity || "error",
      }),
    );

    const validationReferences = readFinalizeValidationReferences({
      qaFiles: referenceInputs.qaFiles,
      readReferenceBytes,
      repoRelativePath,
    });
    const cleanup = timeStage("curation_cleanup", () =>
      runDatasetCurationCleanup({
        repoRoot,
        ...(validationReferences.length
          ? {
              processValidationReferences: {
                rows: validationReferences.flatMap((reference) => reference.rows),
                files: validationReferences.map((reference) => reference.fact),
              },
            }
          : {}),
        options: {
          ...options,
          type: datasetType,
          rowsFile: canonicalSupportRowsFile || preCleanupRowsFile,
          sourceRowsFile:
            options.sourceRowsFile ||
            options.sourceRows ||
            options.originalSourceRowsFile ||
            options.originalRowsFile,
          outDir: path.join(outDir, "cleanup"),
          outFile: options.cleanedRowsFile || options.cleanedRows || options.outFile,
        },
      }),
    );
    const cleanupReportFile = resolveRepoPath(cleanup.files?.report);
    const cleanedRowsFile = resolveRepoPath(
      cleanup.files?.cleaned_rows || cleanup.cleaned_rows_file,
    );
    if (cleanup.status !== "completed" || !cleanedRowsFile) {
      return buildCleanupBlockedFinalizeResult({
        deps,
        datasetType,
        options,
        rowsFile,
        preCleanupRowsFile,
        sourceContactRowsFile,
        canonicalSupportRowsFile,
        canonicalSupportReportFile,
        canonicalSupportPrewriteBlockers,
        outDir,
        finalizeStartedAtUtc,
        finalizeStartedAtMs,
        finalizeTimings,
        timeStage,
        identityReferenceRewriteStage,
        unresolvedExchangeExternalizeStage,
        sourceContactRewriteStage,
        sourceContactSupportFinalize,
        canonicalSupportRewriteStage,
        cleanup,
        cleanupReportFile,
      });
    }
    if (sourceContactSupportFinalizeRequested) {
      sourceContactSupportFinalize = timeStage(
        "source_contact_support_finalize",
        finalizeSourceContactSupport,
      );
    }
    const identityRequest = {
      rowsFile: cleanedRowsFile,
      outDir,
      options: { ...options, type: datasetType },
    };
    let identityPreflightRunStage: FinalizeStage;
    if (asynchronousIdentity && booleanOption(options.runIdentityPreflight)) {
      const started_at_utc = nowIso();
      const startedAt = Date.now();
      identityPreflightRunStage = yield identityRequest;
      finalizeTimings.push({
        stage: "identity_preflight_run",
        status: stageStatus(identityPreflightRunStage),
        started_at_utc,
        finished_at_utc: nowIso(),
        duration_ms: Date.now() - startedAt,
      });
    } else {
      identityPreflightRunStage = timeStage("identity_preflight_run", () =>
        runFinalizeIdentityPreflightStage(identityRequest),
      );
    }
    const curationQueueStage = timeStage("curation_queue", () =>
      runFinalizeAutoCurationQueue({
        datasetType,
        rowsFile,
        cleanedRowsFile,
        outDir,
        options,
        fullContextRequirement,
        identityReferenceRewriteStage,
      }),
    );
    const curationQueueDir =
      curationQueueStage.queue_dir || resolveRepoPath(options.queueDir || options.curationQueueDir);

    const schemaStage = timeStage("schema_validate", () =>
      normalizeSchemaValidateStage(
        runTidasRowsValidation({
          rowsFile: cleanedRowsFile,
          type: datasetType === "support" ? "auto" : datasetType,
          outDir: path.join(outDir, "schema", datasetType),
        }),
      ),
    );

    const qaOutDir = path.join(outDir, "qa", datasetType);
    const qaStage = timeStage(`${datasetType}_qa`, () => {
      if (!requiresDeterministicQa) {
        return buildSkippedSupportQaStage({
          outDir,
          datasetType,
          cleanedRowsFile,
          repoRelativePath,
          writeJson,
        });
      }
      const qaArgs = buildDeterministicQaArgs(
        datasetType,
        cleanedRowsFile,
        qaOutDir,
        referenceInputs.qaFiles,
      );
      const stage = runTiangongJsonStage(`${datasetType}_qa`, qaArgs);
      return attachQaReportFile(stage, datasetType, qaOutDir, reportFileFromCliStage);
    });

    const locationAuditOutDir = path.join(outDir, "location-audit", datasetType);
    const locationAuditStage = timeStage("location_audit", () => {
      const locationAuditArgs = buildLocationAuditArgs(cleanedRowsFile, locationAuditOutDir);
      const stage = runTiangongJsonStage("location_audit", locationAuditArgs);
      return attachLocationAuditReportFile(stage, locationAuditOutDir, reportFileFromCliStage);
    });
    const locationAuditBlockers = blockersFromLocationAuditStage(locationAuditStage);

    const curationGate = timeStage("post_authoring_curation_gate", () =>
      requiresCurationGate
        ? runDatasetCurationGate({
            repoRoot,
            cliValidation: qaStage.cli_validation,
            options: buildCurationGateOptions({
              options,
              datasetType,
              cleanedRowsFile,
              schemaStage,
              qaStage,
              outDir,
              identityPreflightRequired,
              identityPreflightRunStage,
              identityReferenceRewriteFile,
              unresolvedExchangeExternalizeStage,
              sourceContactRewriteStage,
              canonicalSupportReportFile,
              cleanupReportFile,
              curationQueueDir,
              fullContextRequirement,
              booleanOption,
            }),
          })
        : { status: "not_required_for_support_rows", files: {} },
    );
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

    const { dryRunOutDir, dryRunStageName } = resolveDryRunStageTarget(
      datasetType,
      outDir,
      supportTypes,
    );
    const dryRunArgs = buildDryRunCliArgs({
      deps,
      datasetType,
      supportTypes,
      cleanedRowsFile,
      dryRunOutDir,
      options,
      taskAuthorization,
    });
    const dryRunStage = timeStage(dryRunStageName, () =>
      attachDryRunReportFile({
        stage: prewriteGateReady
          ? runTiangongJsonStage(dryRunStageName, dryRunArgs)
          : skippedPrewriteStage(
              dryRunStageName,
              "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
            ),
        datasetType,
        supportTypes,
        dryRunOutDir,
        prewriteGateReady,
        reportFileFromCliStage,
      }),
    );

    let remoteVerifyStage: FinalizeStage | null = null;
    let remoteVerifyReportFile: string | null = null;
    if (booleanOption(options.verifyRemote || options.precommitVerifyRemote)) {
      const remoteOutDir = path.join(outDir, "precommit-verify-remote");
      const remoteArgs = buildRemoteVerifyCliArgs({
        deps,
        cleanedRowsFile,
        remoteOutDir,
        options,
        referenceIntentFile: referenceInputs.intentFile,
      });
      remoteVerifyStage = timeStage("remote_verify_precommit", () => {
        const result = runRemoteVerifyFinalizeStageBody({
          deps,
          remoteOutDir,
          remoteArgs,
          prewriteGateReady,
          prewriteGateBlockers,
        });
        remoteVerifyReportFile = result.reportFile;
        return result.stage;
      });
    }

    const identityDecisionApplyReportOptions = unique([
      ...normalizedList(options.identityDecisionApplyReport),
      ...normalizedList(options.identityDecisionsApplyReport),
      ...normalizedList(options.identityDecisionApplyReports),
      ...normalizedList(options.identityDecisionsApplyReports),
    ]);
    const verifiedReferenceLedgerFiles = verifiedReferenceLedgerFilesForDir(
      resolveRepoPath(
        options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
      ),
    );
    const mutationManifest = timeStage("mutation_manifest", () =>
      runDatasetMutationManifest({
        repoRoot,
        options: buildMutationManifestOptions({
          options,
          datasetType,
          rowsFile,
          cleanedRowsFile,
          outDir,
          schemaStage,
          qaStage,
          curationGateReportFile,
          requiresDeterministicQa,
          requiresCurationGate,
          cleanupReportFile,
          prewriteGateReady,
          dryRunStage,
          remoteVerifyReportFile,
          unresolvedExchangeExternalizeStage,
          sourceContactRewriteStage,
          canonicalSupportReportFile,
          identityDecisionApplyReportOptions,
          identityReferenceRewriteStage,
          identityReferenceRewriteFile,
          verifiedReferenceLedgerFiles,
          sourceReferenceRewrites:
            sourceContactRewriteStage.files?.source_reference_rewrites ||
            sourceReferenceRewritesFileForRowsFile(rowsFile, options),
        }),
      }),
    );
    const supportSummary = computeSourceContactSupportSummary({
      ensureArray,
      sourceContactSupportFinalizeRequested,
      sourceContactSupportFinalize,
      mutationManifest,
    });
    const sourceContactSupportFinalizeRawBlockers = supportSummary.rawBlockers;
    const sourceContactSupportCommitHandoffRawBlockers = supportSummary.rawHandoffBlockers;
    const sourceContactSupportFinalizeAdvisory = supportSummary.advisory;
    const sourceContactSupportFinalizeStatus = supportSummary.status;
    const sourceContactSupportFinalizeBlockers = supportSummary.blockers;
    const sourceContactSupportCommitHandoffBlockers = supportSummary.commitHandoffBlockers;
    const stageReports = buildFinalizeStageReports({
      resolveRepoPath,
      identityPreflightRunStage,
      identityReferenceRewriteStage,
      unresolvedExchangeExternalizeStage,
      sourceContactRewriteStage,
      sourceContactSupportFinalizeRequested,
      sourceContactSupportFinalizeStatus,
      sourceContactSupportFinalizeBlockers,
      sourceContactSupportFinalize,
      canonicalSupportRewriteStage,
      canonicalSupportReportFile,
      cleanup,
      cleanupReportFile,
      curationQueueStage,
      schemaStage,
      qaStage,
      locationAuditStage,
      curationGate,
      curationGateReportFile,
      requiresCurationGate,
      dryRunStage,
      remoteVerifyStage,
      mutationManifest,
    });
    const timingsByStage = new Map(finalizeTimings.map((timing) => [timing.stage, timing]));
    const mutationBlockerCount = Number(mutationManifest.counts?.blockers ?? 0);
    const mutationManifestBlockers = collectMutationManifestBlockers(ensureArray, mutationManifest);
    const blockerCount = mutationBlockerCount + prewriteGateBlockers.length;
    const status =
      prewriteGateBlockers.length > 0
        ? "blocked"
        : mutationManifest.status === "ready_for_remote_write"
          ? "ready_for_remote_write"
          : mutationBlockerCount > 0
            ? "blocked"
            : mutationManifest.status;
    const reportProjection = buildFinalizeReportCountsAndFiles({
      deps,
      options,
      finalizeStartedAtMs,
      finalizeTimings,
      fullContextRequirement,
      identityPreflightRequired,
      preCleanupRowsFile,
      sourceContactRowsFile,
      canonicalSupportRowsFile,
      canonicalSupportReportFile,
      cleanupReportFile,
      cleanedRowsFile,
      curationQueueDir,
      curationQueueStage,
      schemaStage,
      qaStage,
      locationAuditStage,
      locationAuditBlockers,
      curationGateReportFile,
      patchCollectReportFile: resolveRepoPath(
        options.patchCollectReport || options.authoringPatchCollectReport,
      ),
      patchApplyReportFile: resolveRepoPath(options.patchApplyReport),
      classificationDecisionApplyReportFile: resolveRepoPath(
        options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
      ),
      locationDecisionApplyReportFile: resolveRepoPath(
        options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
      ),
      identityDecisionApplyReportFiles: identityDecisionApplyReportOptions
        .map(resolveRepoPath)
        .filter((file): file is string => Boolean(file) && fileExists(file)),
      dryRunStage,
      remoteVerifyReportFile,
      identityPreflightRunStage,
      identityReferenceRewriteStage,
      unresolvedExchangeExternalizeStage,
      sourceContactRewriteStage,
      sourceContactSupportFinalize,
      sourceContactSupportFinalizeStatus,
      sourceContactSupportFinalizeAdvisory,
      sourceContactSupportFinalizeBlockers,
      sourceContactSupportFinalizeRawBlockers,
      sourceContactSupportCommitHandoffBlockers,
      sourceContactSupportCommitHandoffRawBlockers,
      canonicalSupportRewriteStage,
      mutationManifest,
      blockerCount,
      mutationBlockerCount,
      prewriteGateBlockers,
    });
    const {
      canonical_support_blockers,
      location_audit_blockers,
      full_context_scope_blockers,
      mutation_manifest_blockers,
    } = reportProjection.counts;
    const { final_rows, patch_evidence } = reportProjection.files;
    void [
      canonical_support_blockers,
      location_audit_blockers,
      full_context_scope_blockers,
      mutation_manifest_blockers,
      final_rows,
      patch_evidence,
    ];
    const report = {
      schema_version: 1,
      started_at_utc: finalizeStartedAtUtc,
      generated_at_utc: nowIso(),
      ...(referenceInputs.intentFile
        ? { reference_intent_file: repoRelativePath(referenceInputs.intentFile) }
        : {}),
      status,
      dataset_type: datasetType,
      profile: mutationManifest.profile || reportProjection.profile,
      rows_file: repoRelativePath(rowsFile),
      pre_cleanup_rows_file: reportProjection.preCleanupRowsRef,
      source_contact_rows_file: reportProjection.sourceContactRowsRef,
      canonical_support_rows_file: reportProjection.canonicalSupportRowsRef,
      final_rows_file: repoRelativeMaybe(cleanedRowsFile),
      remote_write_mode: "read-only",
      policy: buildFinalizeReportPolicy(identityPreflightRequired),
      counts: reportProjection.counts,
      blockers: [...prewriteGateBlockers, ...mutationManifestBlockers],
      stages: stageReports.map((stage) =>
        compactStageReportWithTiming(stage, timingsByStage, compactStageReport),
      ),
      timings: finalizeTimings,
      files: reportProjection.files,
    };
    const reportPath = path.join(outDir, "dataset-post-authoring-finalize-report.json");
    writeJson(reportPath, report);
    const commitHandoffPlan = timeStage("commit_handoff_plan", () =>
      runDatasetCommitHandoffPlan({
        finalizeReport: reportPath,
        outDir: path.join(outDir, "commit-handoff"),
        stateCode:
          options.commitStateCode ?? options.postWriteStateCode ?? options.stateCode ?? "0",
        targetUserId: options.targetUserId,
        rootPolicy: options.postWriteRootPolicy || options.rootPolicy || options.remoteRootPolicy,
      }),
    );
    const commit_handoff_blockers = commitHandoffPlan.counts?.blockers ?? 0;
    const importLedger = writeFinalizeImportLedger
      ? timeStage("import_ledger", () =>
          writeFinalizeImportLedger({
            report: buildImportLedgerReportInput(
              report,
              commitHandoffPlan,
              commit_handoff_blockers,
            ),
            reportPath,
            ledgerDir: resolveRepoPath(
              options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
            ),
          }),
        )
      : { status: "skipped", files: {}, counts: { entries_written: 0 } };
    return attachHandoffAndLedgerToFinalizeReport({
      report,
      reportPath,
      commitHandoffPlan,
      importLedger,
      finalizeStartedAtMs,
      finalizeTimings,
      writeJson,
      repoRelativePath,
    });
  }

  function runDatasetPostAuthoringFinalize(options: FinalizeOptions): FinalizeStage {
    const result = finalizeStages(options, false).next();
    if (!result.done) throw new Error("Unexpected asynchronous identity stage.");
    return result.value;
  }

  return { runDatasetPostAuthoringFinalize, finalizeStages };
}
