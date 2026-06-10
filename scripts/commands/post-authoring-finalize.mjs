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
      "Apply identity reference rewrites, unresolved exchange externalization, BAFU source/contact rewrites, canonical support rewrites, and deterministic curation cleanup.",
    inputs: [
      "input rows",
      "identity/preflight indexes",
      "BAFU source/contact policy",
      "canonical support cache",
    ],
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
    side_effects: ["runs published CLI read-only checks", "writes local .foundry artifact files"],
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

function verifiedReferenceLedgerFilesForDir(ledgerDir) {
  if (!ledgerDir) return [];
  return [
    "ok.flows.verified.jsonl",
    "ok.processes.verified.jsonl",
    "ok.sources.verified.jsonl",
    "ok.contacts.verified.jsonl",
    "ok.unitgroups.verified.jsonl",
    "ok.flowproperties.verified.jsonl",
  ]
    .map((name) => path.join(ledgerDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

export function createPostAuthoringFinalizeCommands({
  appendOption,
  applyCanonicalSupportRewrites,
  applyIdentityReferenceRewrites,
  asText,
  blockersFromLocationAuditStage,
  buildLibraryContactPayload,
  booleanOption,
  compactStageReport,
  cloneJson,
  contactGlobalReference,
  datasetIdentity,
  datasetRowsFileStem,
  ensureArray,
  externalizeUnresolvedProcessFlowExchanges,
  fileExists,
  normalizedList,
  nowIso,
  postAuthoringPrewriteGateBlockers,
  processSourceReferenceRows,
  profileFullContextRequirement,
  repoRelativeMaybe,
  repoRelativePath,
  repoRoot,
  reportFileFromCliStage,
  readRowsFile,
  repairTrueSourceClassification,
  repairTrueSourceDescription,
  repairTrueSourceIdentity,
  resolveRepoPath,
  rewriteCanonicalSourceReferences,
  rewriteContactReferences,
  rewriteTrueSourceReferenceDescriptions,
  runDatasetCommitHandoffPlan,
  runDatasetCurationCleanup,
  runDatasetCurationGate,
  runDatasetMutationManifest,
  runFinalizeAutoCurationQueue,
  runFinalizeIdentityPreflightStage,
  runTiangongJsonStage,
  skippedPrewriteStage,
  sourceReferenceSemanticBlockers,
  sourceReferenceRewritesFileForRowsFile,
  sourceSemanticSummary,
  unique,
  writeFinalizeImportLedger,
  writeJson,
  writeJsonLines,
}) {
  function stageStatus(value) {
    if (!value || typeof value !== "object") return "completed";
    return value.status ?? value.report?.status ?? "completed";
  }

  function timedFinalizeStage(timings, stage, fn) {
    const startedAtUtc = nowIso();
    const startedAtMs = Date.now();
    try {
      const result = fn();
      timings.push({
        stage,
        status: stageStatus(result),
        started_at_utc: startedAtUtc,
        finished_at_utc: nowIso(),
        duration_ms: Date.now() - startedAtMs,
      });
      return result;
    } catch (error) {
      timings.push({
        stage,
        status: "failed",
        started_at_utc: startedAtUtc,
        finished_at_utc: nowIso(),
        duration_ms: Date.now() - startedAtMs,
        error: String(error?.message || error),
      });
      throw error;
    }
  }

  function compactStageReportWithTiming(stageReport, timingsByStage) {
    const compacted = compactStageReport(stageReport);
    const timing = timingsByStage.get(compacted.stage);
    if (!timing) return compacted;
    return {
      ...compacted,
      started_at_utc: timing.started_at_utc,
      finished_at_utc: timing.finished_at_utc,
      duration_ms: timing.duration_ms,
    };
  }

  function rowDatasetType(payload, fallbackType) {
    if (payload?.processDataSet) return "process";
    if (payload?.flowDataSet) return "flow";
    if (payload?.lifeCycleModelDataSet) return "lifecyclemodel";
    if (payload?.contactDataSet) return "contact";
    if (payload?.sourceDataSet) return "source";
    if (payload?.flowPropertyDataSet) return "flowproperty";
    if (payload?.unitGroupDataSet) return "unitgroup";
    return fallbackType;
  }

  function applySourceContactRewrites({ datasetType, rowsFile, outDir, options }) {
    const profile = String(options.profile || "generic")
      .trim()
      .toLowerCase();
    const supportedForProfile = profile === "bafu";
    const outputRowsFile = path.join(
      outDir,
      `${datasetRowsFileStem(datasetType)}.source-contact-rewritten.jsonl`,
    );
    const reportPath = path.join(outDir, "source-contact-rewrites-report.json");
    const sourceReferenceRewritesPath = path.join(outDir, "source-reference-rewrites.jsonl");
    const supportRowsPath = path.join(outDir, "support.jsonl");
    fs.mkdirSync(outDir, { recursive: true });
    if (!supportedForProfile || booleanOption(options.skipSourceContactRewrites)) {
      const report = {
        schema_version: 1,
        status: "skipped",
        reason: supportedForProfile
          ? "Skipped by --skip-source-contact-rewrites."
          : "Source/contact deterministic rewrites are currently profile-specific and only required for BAFU.",
        profile,
        rows_file: repoRelativePath(rowsFile),
        counts: {
          input_rows: 0,
          output_rows: 0,
          contact_reference_rewrites: 0,
          source_reference_rewrites: 0,
          support_rows: 0,
        },
        files: {},
      };
      writeJson(reportPath, report);
      return {
        ...report,
        output_rows_file: repoRelativePath(rowsFile),
        files: {
          report: repoRelativePath(reportPath),
        },
      };
    }

    const rows = readRowsFile(rowsFile);
    const sourceReferenceRewriteRows = [];
    const stats = {
      source_reference_rewrites: 0,
      true_source_identity_repairs: 0,
      true_source_description_repairs: 0,
      true_source_classification_repairs: 0,
      true_source_reference_description_repairs: 0,
    };
    const sourceSupportRepairRows = [];
    const sourceSupportSemanticsRows = [];
    const libraryContact = buildLibraryContactPayload(options, null, {
      rewriteRows: sourceReferenceRewriteRows,
      stats,
    });
    const libraryContactIdentity = datasetIdentity(libraryContact, "contact");
    const libraryContactName = asText(
      libraryContact.contactDataSet.contactInformation.dataSetInformation["common:name"]?.["#text"],
    );
    const libraryContactRef = contactGlobalReference({
      id: libraryContactIdentity.id,
      version: libraryContactIdentity.version,
      shortDescription: libraryContactName,
      language: asText(options.language || options.lang || "en") || "en",
    });
    const sourceSupportRowsFile = resolveRepoPath(
      options.sourceSupportRowsFile || options.supportSourceRowsFile || options.sourceSupportRows,
    );
    const sourceSupportPayloads = new Map();
    const sourceLookup = new Map();
    if (fileExists(sourceSupportRowsFile)) {
      const supportContactRewriteStats = {
        rewritten: 0,
        previous_ids: new Set(),
        previous_descriptions: new Set(),
      };
      for (const sourceRow of readRowsFile(sourceSupportRowsFile)) {
        if (!sourceRow?.sourceDataSet) continue;
        const payload = cloneJson(sourceRow);
        const identity = datasetIdentity(payload, "source");
        if (!identity.id) continue;
        rewriteContactReferences(payload, libraryContactRef, supportContactRewriteStats);
        repairTrueSourceIdentity(payload, {
          sourceFile: sourceSupportRowsFile,
          stats,
          repairRows: sourceSupportRepairRows,
        });
        repairTrueSourceDescription(payload, {
          sourceFile: sourceSupportRowsFile,
          stats,
          repairRows: sourceSupportRepairRows,
        });
        repairTrueSourceClassification(payload, {
          sourceFile: sourceSupportRowsFile,
          stats,
          repairRows: sourceSupportRepairRows,
        });
        rewriteCanonicalSourceReferences(payload, {
          datasetType: "source",
          sourceFile: sourceSupportRowsFile,
          stats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: datasetIdentity(payload, "source"),
        });
        const repairedIdentity = datasetIdentity(payload, "source");
        const summary = sourceSemanticSummary(payload, sourceSupportRowsFile);
        sourceSupportSemanticsRows.push(summary);
        sourceLookup.set(summary.dataset_id, summary);
        sourceSupportPayloads.set(
          `${repairedIdentity.id}::${repairedIdentity.version || "00.00.001"}`,
          payload,
        );
      }
    }
    const contactRewriteStats = {
      rewritten: 0,
      previous_ids: new Set(),
      previous_descriptions: new Set(),
    };
    const rewrittenRows = rows.map((row) => {
      const payload = cloneJson(row);
      const type = rowDatasetType(payload, datasetType);
      rewriteContactReferences(payload, libraryContactRef, contactRewriteStats);
      rewriteCanonicalSourceReferences(payload, {
        datasetType: type,
        sourceFile: rowsFile,
        stats,
        rewriteRows: sourceReferenceRewriteRows,
        datasetIdentityCache: datasetIdentity(payload, type),
      });
      if (type === "process" && sourceLookup.size > 0) {
        rewriteTrueSourceReferenceDescriptions(payload.processDataSet, {
          sourceLookup,
          sourceFile: rowsFile,
          stats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: datasetIdentity(payload, type),
        });
      }
      return payload;
    });
    const processSourceReferenceRowsForScope =
      sourceLookup.size > 0
        ? rewrittenRows.flatMap((payload) => {
            const type = rowDatasetType(payload, datasetType);
            return type === "process"
              ? processSourceReferenceRows(payload, sourceLookup, rowsFile).filter(
                  (row) => row.relation === "process_data_source",
                )
              : [];
          })
        : [];
    const sourceSemanticBlockers =
      typeof sourceReferenceSemanticBlockers === "function"
        ? sourceReferenceSemanticBlockers(processSourceReferenceRowsForScope)
        : [];
    const referencedTrueSourceKeys = new Set(
      processSourceReferenceRowsForScope
        .filter((row) => row.referenced_source_kind === "true_source" && row.ref_object_id)
        .map((row) => `${row.ref_object_id}::${row.version || "00.00.001"}`),
    );
    const referencedTrueSourceRows = [...referencedTrueSourceKeys]
      .map((key) => sourceSupportPayloads.get(key))
      .filter(Boolean);

    writeJsonLines(outputRowsFile, rewrittenRows);
    writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteRows);
    const sourceSupportSemanticsPath = path.join(outDir, "source-support-semantics.jsonl");
    const sourceSupportRepairsPath = path.join(outDir, "source-support-repairs.jsonl");
    writeJsonLines(sourceSupportSemanticsPath, sourceSupportSemanticsRows);
    writeJsonLines(sourceSupportRepairsPath, sourceSupportRepairRows);
    writeJsonLines(supportRowsPath, [libraryContact, ...referencedTrueSourceRows]);
    const totalRewrites =
      Number(contactRewriteStats.rewritten ?? 0) + Number(stats.source_reference_rewrites ?? 0);
    const report = {
      schema_version: 1,
      status:
        sourceSemanticBlockers.length > 0
          ? "blocked"
          : totalRewrites > 0
            ? "completed"
            : "completed_no_rewrites",
      profile,
      rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(outputRowsFile),
      policy: {
        contact:
          "BAFU imports use one database-level FOEN/BAFU ownership contact for every row in the library.",
        source:
          "Data set format and compliance source references are canonical public support references, not BAFU source rows.",
      },
      counts: {
        input_rows: rows.length,
        output_rows: rewrittenRows.length,
        contact_reference_rewrites: contactRewriteStats.rewritten,
        source_reference_rewrites: sourceReferenceRewriteRows.length,
        support_rows: 1 + referencedTrueSourceRows.length,
        support_contact_rows: 1,
        support_source_rows: referencedTrueSourceRows.length,
        source_support_candidate_rows: sourceSupportSemanticsRows.length,
        true_source_identity_repairs: stats.true_source_identity_repairs,
        true_source_description_repairs: stats.true_source_description_repairs,
        true_source_classification_repairs: stats.true_source_classification_repairs,
        true_source_reference_description_repairs: stats.true_source_reference_description_repairs,
      },
      contact: {
        id: libraryContactIdentity.id,
        version: libraryContactIdentity.version,
        name: libraryContactName,
        previous_ids: [...contactRewriteStats.previous_ids].sort(),
        previous_descriptions: [...contactRewriteStats.previous_descriptions].sort(),
      },
      source_support: {
        source_support_rows_file: fileExists(sourceSupportRowsFile)
          ? repoRelativePath(sourceSupportRowsFile)
          : null,
        referenced_true_source_ids: referencedTrueSourceRows.map(
          (payload) => datasetIdentity(payload, "source").id,
        ),
      },
      files: {
        output_rows: repoRelativePath(outputRowsFile),
        source_reference_rewrites: repoRelativePath(sourceReferenceRewritesPath),
        support_rows: repoRelativePath(supportRowsPath),
        source_support_semantics: repoRelativePath(sourceSupportSemanticsPath),
        source_support_repairs: repoRelativePath(sourceSupportRepairsPath),
        report: repoRelativePath(reportPath),
      },
      blockers: sourceSemanticBlockers,
    };
    writeJson(reportPath, report);
    return {
      ...report,
      output_rows_file: repoRelativePath(outputRowsFile),
    };
  }

  function runDatasetPostAuthoringFinalize(options) {
    const finalizeStartedAtUtc = nowIso();
    const finalizeStartedAtMs = Date.now();
    const finalizeTimings = [];
    const timeStage = (stage, fn) => timedFinalizeStage(finalizeTimings, stage, fn);
    const datasetType = String(options.type || options.datasetType || "process")
      .trim()
      .toLowerCase();
    const supportTypes = ["contact", "source"];
    const mixedSupportTypes = ["support"];
    const authoredTypes = ["process", "flow", "lifecyclemodel"];
    const curationGateTypes = [...supportTypes, ...mixedSupportTypes, ...authoredTypes];
    const supportedTypes = [...supportTypes, ...mixedSupportTypes, ...authoredTypes];
    const requiresDeterministicQa = authoredTypes.includes(datasetType);
    const requiresCurationGate = curationGateTypes.includes(datasetType);
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-post-authoring-finalize",
        usage: [
          "node scripts/foundry.mjs dataset-post-authoring-finalize --type <support|contact|source|process|flow|lifecyclemodel> --rows-file <patched-or-classified-rows.jsonl> --out-dir <finalize-dir> --profile <profile> --queue-dir <queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --run-identity-preflight --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <ruleset.json> --classification-decision-apply-report <classification-decisions-apply-report.json> --location-decision-apply-report <location-decisions-apply-report.json> --patch-collect-report <authoring-patch-collect-report.json> --patch-apply-report <dataset-patch-apply-report.json> --require-patch-collect-report --target-user-id <uuid> --verify-remote --finalize-source-contact-support --ledger-dir <task-import-ledger-dir>",
        ],
        purpose:
          "Run the post-AI authoring prewrite chain for support, process, flow, or lifecyclemodel rows: cleanup, SDK validate, location audit, post-authoring curation gate, dry-run publish/save, optional remote reference verification, and mutation manifest. Process/flow/lifecyclemodel rows additionally run deterministic QA. This command never commits rows.",
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

    const outDir = resolveRepoPath(
      options.outDir || `.foundry/workspaces/${datasetType}-post-authoring-finalize`,
    );
    fs.mkdirSync(outDir, { recursive: true });
    const fullContextRequirement = profileFullContextRequirement(options.profile, datasetType);
    const identityPreflightRequired =
      ["flow", "process"].includes(datasetType) &&
      (booleanOption(options.requireIdentityPreflight) || Boolean(fullContextRequirement));
    const identityReferenceRewriteStage = timeStage("identity_reference_rewrites", () =>
      applyIdentityReferenceRewrites({
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
      }),
    );
    const identityReferenceRewriteFile = resolveRepoPath(
      identityReferenceRewriteStage.rewrite_file,
    );
    const identityRewrittenRowsFile =
      Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
        ? resolveRepoPath(identityReferenceRewriteStage.output_rows_file)
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
            `${datasetRowsFileStem(datasetType)}.unresolved-exchanges-externalized.jsonl`,
          ),
          outDir: path.join(outDir, "unresolved-exchange-externalization"),
          options,
        }),
    );
    const preCleanupRowsFile =
      Number(unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0) > 0
        ? resolveRepoPath(unresolvedExchangeExternalizeStage.output_rows_file)
        : identityRewrittenRowsFile;
    const sourceContactRewriteStage = timeStage("source_contact_rewrites", () =>
      applySourceContactRewrites({
        datasetType,
        rowsFile: preCleanupRowsFile,
        outDir: path.join(outDir, "source-contact-rewrites"),
        options,
      }),
    );
    const sourceContactRowsFile = resolveRepoPath(
      sourceContactRewriteStage.files?.output_rows || sourceContactRewriteStage.output_rows_file,
    );
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
      Number(sourceContactRewriteStage.counts?.support_source_rows ?? 0) > 0
        ? "support"
        : "contact";
    const sourceContactSupportFinalize = sourceContactSupportFinalizeRequested
      ? timeStage("source_contact_support_finalize", () =>
          runDatasetPostAuthoringFinalize({
            ...options,
            type: sourceContactSupportFinalizeType,
            rowsFile: sourceContactSupportRowsFile,
            outDir: path.join(outDir, "source-contact-support-finalize"),
            skipSourceContactRewrites: true,
            finalizeSourceContactSupport: false,
            prepareSourceContactSupport: false,
            autoFinalizeSourceContactSupport: false,
            requireIdentityPreflight: false,
            runIdentityPreflight: false,
            identityPreflightIndex: null,
            identityPreflightRequests: null,
            identityPreflightRequestsIndex: null,
            classificationDecisionApplyReport: null,
            classificationDecisionsApplyReport: null,
            locationDecisionApplyReport: null,
            locationDecisionsApplyReport: null,
            identityDecisionApplyReport: null,
            identityDecisionsApplyReport: null,
            identityDecisionApplyReports: [],
            identityDecisionsApplyReports: [],
            patchCollectReport: null,
            authoringPatchCollectReport: null,
            patchApplyReport: null,
            verifyRemote: false,
            precommitVerifyRemote: false,
          }),
        )
      : {
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

    const canonicalSupportRewriteStage = timeStage("canonical_support_rewrites", () =>
      applyCanonicalSupportRewrites({
        datasetType,
        rowsFile: sourceContactRowsFile || preCleanupRowsFile,
        outFile: path.join(
          outDir,
          "canonical-support-rewrites",
          `${datasetRowsFileStem(datasetType)}.canonical-support-rewritten.jsonl`,
        ),
        outDir: path.join(outDir, "canonical-support-rewrites"),
        options,
      }),
    );
    const canonicalSupportRowsFile = resolveRepoPath(
      canonicalSupportRewriteStage.files?.output_rows ||
        canonicalSupportRewriteStage.output_rows_file,
    );
    const canonicalSupportReportFile = resolveRepoPath(canonicalSupportRewriteStage.files?.report);
    const canonicalSupportPrewriteBlockers = ensureArray(canonicalSupportRewriteStage.blockers).map(
      (blocker) => ({
        ...blocker,
        stage: "canonical_support_rewrites",
        source: "canonical_support_rewrites",
        severity: blocker.severity || "error",
      }),
    );

    const cleanup = timeStage("curation_cleanup", () =>
      runDatasetCurationCleanup({
        repoRoot,
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
    const cleanedRowsFile = resolveRepoPath(
      cleanup.files?.cleaned_rows || cleanup.cleaned_rows_file,
    );
    const cleanupReportFile = resolveRepoPath(cleanup.files?.report);
    const identityPreflightRunStage = timeStage("identity_preflight_run", () =>
      runFinalizeIdentityPreflightStage({
        rowsFile: cleanedRowsFile,
        outDir,
        options: {
          ...options,
          type: datasetType,
        },
      }),
    );
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

    const schemaOutDir = path.join(outDir, "schema", datasetType);
    const schemaStage = timeStage("schema_validate", () => {
      const stage = runTiangongJsonStage("schema_validate", [
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
      stage.report_file = reportFileFromCliStage(
        stage,
        ["files.report"],
        path.join(schemaOutDir, "outputs", "validation-report.json"),
      );
      return stage;
    });

    const qaOutDir = path.join(outDir, "qa", datasetType);
    const qaStage = timeStage(`${datasetType}_qa`, () => {
      const stage = requiresDeterministicQa
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
        stage.report_file = reportFileFromCliStage(
          stage,
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
      } else {
        const supportQaOutDir = path.join(outDir, "qa", datasetType);
        const supportQaReportFile = path.join(supportQaOutDir, `${datasetType}-qa-report.json`);
        const supportQaReport = {
          schema_version: 1,
          status: "not_required_for_support_rows",
          dataset_type: datasetType,
          rows_file: repoRelativePath(cleanedRowsFile),
          findings: [],
          blockers: [],
          counts: {
            blockers: 0,
            findings: 0,
          },
          files: {
            report: repoRelativePath(supportQaReportFile),
          },
        };
        writeJson(supportQaReportFile, supportQaReport);
        stage.report = supportQaReport;
        stage.report_file = supportQaReportFile;
      }
      return stage;
    });

    const locationAuditOutDir = path.join(outDir, "location-audit", datasetType);
    const locationAuditStage = timeStage("location_audit", () => {
      const stage = runTiangongJsonStage("location_audit", [
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
      stage.report_file = reportFileFromCliStage(
        stage,
        ["files.report"],
        path.join(locationAuditOutDir, "outputs", "location-audit-report.json"),
      );
      return stage;
    });
    const locationAuditBlockers = blockersFromLocationAuditStage(locationAuditStage);

    const curationGate = timeStage("post_authoring_curation_gate", () =>
      requiresCurationGate
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
              identityPreflightIndex:
                identityPreflightRunStage.index_file ||
                options.identityPreflightIndex ||
                options.identityPreflightRequests ||
                options.identityPreflightRequestsIndex,
              identityReferenceRewrites: identityReferenceRewriteFile,
              classificationDecisionApplyReport:
                options.classificationDecisionApplyReport ||
                options.classificationDecisionsApplyReport,
              unresolvedExchangeExternalizationReport:
                unresolvedExchangeExternalizeStage.files?.report,
              sourceContactRewriteReport: sourceContactRewriteStage.files?.report,
              canonicalSupportRewriteReport: canonicalSupportReportFile,
              cleanupReport: cleanupReportFile,
              identityDecisionApplyReport:
                options.identityDecisionApplyReport || options.identityDecisionsApplyReport,
              queueDir: curationQueueDir,
              requireQueueContext:
                booleanOption(options.requireQueueContext || options.requireCurationQueueContext) ||
                (Boolean(fullContextRequirement) && datasetType === "process"),
            },
          })
        : {
            status: "not_required_for_support_rows",
            files: {},
          },
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
    const dryRunStageName =
      datasetType === "support" || supportTypes.includes(datasetType)
        ? `${datasetType}_save_draft_dry_run`
        : datasetType === "flow"
          ? "flow_publish_version_dry_run"
          : datasetType === "lifecyclemodel"
            ? "lifecyclemodel_save_draft_dry_run"
            : "process_save_draft_dry_run";
    const dryRunStage = timeStage(dryRunStageName, () => {
      const stage = prewriteGateReady
        ? runTiangongJsonStage(dryRunStageName, dryRunArgs)
        : skippedPrewriteStage(
            dryRunStageName,
            "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
          );
      if (prewriteGateReady) {
        stage.report_file = reportFileFromCliStage(
          stage,
          datasetType === "flow" ? ["files.report"] : ["files.summary_json"],
          datasetType === "support" || supportTypes.includes(datasetType)
            ? path.join(dryRunOutDir, "outputs", "dataset-save-draft", "summary.json")
            : datasetType === "flow"
              ? path.join(dryRunOutDir, "flows_tidas_sdk_plus_classification_mcp_sync_report.json")
              : datasetType === "lifecyclemodel"
                ? path.join(dryRunOutDir, "outputs", "save-draft-bundle", "summary.json")
                : path.join(dryRunOutDir, "outputs", "save-draft-rpc", "summary.json"),
        );
      }
      return stage;
    });

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
      if (booleanOption(options.compareRootPayload || options.remoteCompareRootPayload)) {
        remoteArgs.push("--compare-root-payload");
      }
      appendOption(
        remoteArgs,
        "--target-user-id",
        options.remoteTargetUserId || options.targetUserId,
      );
      appendOption(remoteArgs, "--state-code", options.remoteStateCode || options.stateCode || "0");
      remoteVerifyStage = timeStage("remote_verify_precommit", () => {
        const stage = prewriteGateReady
          ? runTiangongJsonStage("remote_verify_precommit", remoteArgs)
          : skippedPrewriteStage(
              "remote_verify_precommit",
              "Skipped because schema, QA, canonical support, location audit, or post-authoring curation gate is not ready.",
            );
        if (prewriteGateReady) {
          stage.report_file = reportFileFromCliStage(
            stage,
            ["files.report"],
            path.join(remoteOutDir, "outputs", "remote-verification-report.json"),
          );
          remoteVerifyReportFile = stage.report_file;
        }
        return stage;
      });
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
    const verifiedReferenceLedgerDir = resolveRepoPath(
      options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
    );
    const verifiedReferenceLedgerFiles = verifiedReferenceLedgerFilesForDir(
      verifiedReferenceLedgerDir,
    );

    const mutationManifest = timeStage("mutation_manifest", () =>
      runDatasetMutationManifest({
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
          curationGateReport: requiresCurationGate ? curationGateReportFile : null,
          cleanupReport: cleanupReportFile,
          dryRunReport: prewriteGateReady ? dryRunStage.report_file : null,
          remoteVerifyReport: remoteVerifyReportFile,
          unresolvedExchangeExternalizationReport: unresolvedExchangeExternalizeStage.files?.report,
          sourceContactRewriteReport: sourceContactRewriteStage.files?.report,
          canonicalSupportRewriteReport: canonicalSupportReportFile,
          classificationDecisionApplyReport:
            options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
          locationDecisionApplyReport:
            options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
          identityDecisionApplyReport:
            options.identityDecisionApplyReport || options.identityDecisionsApplyReport,
          identityDecisionApplyReports: identityDecisionApplyReportOptions,
          identityReferenceRewriteStatus: identityReferenceRewriteStage.status,
          identityReferenceRewriteInputRows: rowsFile,
          identityReferenceRewriteOutputRows: identityReferenceRewriteStage.output_rows_file,
          sourceReferenceRewrites:
            sourceContactRewriteStage.files?.source_reference_rewrites ||
            sourceReferenceRewritesFileForRowsFile(rowsFile, options),
          identityReferenceRewrites: identityReferenceRewriteFile,
          verifiedReferenceLedgers: verifiedReferenceLedgerFiles,
          outDir: path.join(outDir, "mutation-manifest"),
          requireCurationGate: requiresCurationGate,
        },
      }),
    );
    const patchApplyReportFile = resolveRepoPath(options.patchApplyReport);
    const patchCollectReportFile = resolveRepoPath(
      options.patchCollectReport || options.authoringPatchCollectReport,
    );
    const classificationDecisionApplyReportFile = resolveRepoPath(
      options.classificationDecisionApplyReport || options.classificationDecisionsApplyReport,
    );
    const locationDecisionApplyReportFile = resolveRepoPath(
      options.locationDecisionApplyReport || options.locationDecisionsApplyReport,
    );
    const sourceContactSupportFinalizeRawBlockers = Number(
      sourceContactSupportFinalize.counts?.blockers ?? 0,
    );
    const sourceContactSupportCommitHandoffRawBlockers = ensureArray(
      sourceContactSupportFinalize.commit_handoff?.blockers,
    ).length;
    const sourceContactSupportFinalizeAdvisory = Boolean(
      sourceContactSupportFinalizeRequested &&
      sourceContactSupportFinalize.status === "blocked" &&
      mutationManifest.status === "ready_for_remote_write" &&
      Number(mutationManifest.counts?.blockers ?? 0) === 0,
    );
    const sourceContactSupportFinalizeStatus = sourceContactSupportFinalizeAdvisory
      ? "advisory_blocked_top_level_remote_verified"
      : sourceContactSupportFinalize.status;
    const sourceContactSupportFinalizeBlockers = sourceContactSupportFinalizeAdvisory
      ? 0
      : sourceContactSupportFinalizeRawBlockers;
    const sourceContactSupportCommitHandoffBlockers = sourceContactSupportFinalizeAdvisory
      ? 0
      : sourceContactSupportCommitHandoffRawBlockers;
    const stageReports = [
      {
        stage: "identity_preflight_run",
        status: identityPreflightRunStage.status,
        exit_code: [
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
        stage: "source_contact_rewrites",
        status: sourceContactRewriteStage.status,
        exit_code: 0,
        command: "foundry.dataset-source-contact-rewrites-apply",
        args: [],
        stderr: "",
        report_file: resolveRepoPath(sourceContactRewriteStage.files?.report),
      },
      {
        stage: "source_contact_support_finalize",
        status: sourceContactSupportFinalizeStatus,
        exit_code: sourceContactSupportFinalizeBlockers > 0 ? 1 : 0,
        command: sourceContactSupportFinalizeRequested
          ? "foundry.dataset-post-authoring-finalize"
          : "skipped",
        args: [],
        stderr: "",
        report_file: resolveRepoPath(sourceContactSupportFinalize.files?.report),
      },
      {
        stage: "canonical_support_rewrites",
        status: canonicalSupportRewriteStage.status,
        exit_code: canonicalSupportRewriteStage.counts?.blockers > 0 ? 1 : 0,
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
          curationQueueStage.status === "not_required" || curationQueueStage.status === "provided"
            ? "skipped"
            : "foundry.dataset-curation-queue-build",
        args: [],
        stderr: curationQueueStage.report?.foundry_wrapper?.stderr || "",
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
    const timingsByStage = new Map(finalizeTimings.map((timing) => [timing.stage, timing]));
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
      started_at_utc: finalizeStartedAtUtc,
      generated_at_utc: nowIso(),
      status,
      dataset_type: datasetType,
      profile: mutationManifest.profile || String(options.profile || "generic"),
      rows_file: repoRelativePath(rowsFile),
      pre_cleanup_rows_file: repoRelativeMaybe(preCleanupRowsFile),
      source_contact_rows_file: repoRelativeMaybe(sourceContactRowsFile),
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
        identity_preflight_gate: identityPreflightRequired
          ? "Process/flow full-context profiles require completed CLI identity-preflight evidence from flow_hybrid_search/process_hybrid_search before post-authoring dry-run or remote write planning."
          : "Not required for this dataset type/profile unless --require-identity-preflight is provided.",
        location_code_audit:
          "Final rows must pass tiangong-lca dataset classification audit --type location against tidas_locations_category.json before remote write.",
      },
      counts: {
        finalize_duration_ms: Date.now() - finalizeStartedAtMs,
        finalize_substage_count: finalizeTimings.length,
        blockers: blockerCount,
        mutation_manifest_blockers: mutationBlockerCount,
        prewrite_gate_blockers: prewriteGateBlockers.length,
        canonical_support_blockers: canonicalSupportRewriteStage.counts?.blockers ?? 0,
        source_contact_rewrite_input_rows: sourceContactRewriteStage.counts?.input_rows ?? null,
        source_contact_rewrite_output_rows: sourceContactRewriteStage.counts?.output_rows ?? null,
        source_contact_reference_rewrites:
          sourceContactRewriteStage.counts?.contact_reference_rewrites ?? 0,
        source_contact_source_reference_rewrites:
          sourceContactRewriteStage.counts?.source_reference_rewrites ?? 0,
        source_contact_support_rows: sourceContactRewriteStage.counts?.support_rows ?? 0,
        source_contact_support_finalize_status: sourceContactSupportFinalizeStatus,
        source_contact_support_finalize_raw_status: sourceContactSupportFinalize.status,
        source_contact_support_finalize_advisory: sourceContactSupportFinalizeAdvisory,
        source_contact_support_finalize_write_candidates:
          sourceContactSupportFinalize.counts?.write_candidates ?? 0,
        source_contact_support_finalize_blockers: sourceContactSupportFinalizeBlockers,
        source_contact_support_finalize_raw_blockers: sourceContactSupportFinalizeRawBlockers,
        source_contact_support_commit_handoff_blockers: sourceContactSupportCommitHandoffBlockers,
        source_contact_support_commit_handoff_raw_blockers:
          sourceContactSupportCommitHandoffRawBlockers,
        canonical_support_input_rows: canonicalSupportRewriteStage.counts?.input_rows ?? null,
        canonical_support_output_rows: canonicalSupportRewriteStage.counts?.output_rows ?? null,
        canonical_support_deferred_rows: canonicalSupportRewriteStage.counts?.deferred_rows ?? 0,
        canonical_support_deferred_blockers:
          canonicalSupportRewriteStage.counts?.deferred_blockers ?? 0,
        canonical_flow_property_reference_rewrites:
          canonicalSupportRewriteStage.counts?.canonical_flow_property_reference_rewrites ?? 0,
        canonical_unit_group_reference_proofs:
          canonicalSupportRewriteStage.counts?.canonical_unit_group_reference_proofs ?? 0,
        full_context_ai_completion_required: Boolean(fullContextRequirement),
        identity_preflight_required: identityPreflightRequired,
        identity_preflight_run_selected:
          identityPreflightRunStage.report?.counts?.selected_rows ?? 0,
        identity_preflight_run_completed: identityPreflightRunStage.report?.counts?.completed ?? 0,
        identity_preflight_run_skipped_existing:
          identityPreflightRunStage.report?.counts?.skipped_existing_report ?? 0,
        identity_preflight_run_failed: identityPreflightRunStage.report?.counts?.failed ?? 0,
        identity_preflight_refresh_required: Boolean(identityPreflightRunStage.refresh_required),
        identity_preflight_refresh_forced: Boolean(identityPreflightRunStage.refresh_forced),
        identity_preflight_refresh_reason: identityPreflightRunStage.refresh_plan?.reason ?? null,
        identity_preflight_refresh_force_skipped_exact: Boolean(
          identityPreflightRunStage.refresh_force_skipped_exact,
        ),
        identity_preflight_refreshed_current_rows:
          identityPreflightRunStage.refresh_report?.counts?.request_rows ?? 0,
        identity_preflight_merge_replaced_rows:
          identityPreflightRunStage.merge_report?.counts?.replaced_rows ?? 0,
        location_audit_blockers: locationAuditBlockers.length,
        location_code_targets: locationAuditStage.report?.counts?.location_targets ?? 0,
        location_code_invalid: locationAuditStage.report?.counts?.invalid ?? 0,
        write_candidates: mutationManifest.counts?.write_candidates ?? 0,
        ai_patch_evidence_entries: mutationManifest.counts?.ai_patch_evidence_entries ?? 0,
        ai_classification_decision_entries:
          mutationManifest.counts?.ai_classification_decision_entries ?? 0,
        ai_location_decision_entries: mutationManifest.counts?.ai_location_decision_entries ?? 0,
        ai_identity_decision_entries: mutationManifest.counts?.ai_identity_decision_entries ?? 0,
        source_contact_rewrite_semantic_evidence_entries:
          mutationManifest.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0,
        ai_semantic_evidence_entries:
          (Number(mutationManifest.counts?.ai_patch_evidence_entries ?? 0) || 0) +
          (Number(mutationManifest.counts?.ai_classification_decision_entries ?? 0) || 0) +
          (Number(mutationManifest.counts?.ai_location_decision_entries ?? 0) || 0) +
          (Number(mutationManifest.counts?.ai_identity_decision_entries ?? 0) || 0) +
          (Number(mutationManifest.counts?.source_contact_rewrite_semantic_evidence_entries ?? 0) ||
            0),
        unresolved_trace_entries: mutationManifest.counts?.unresolved_trace_entries ?? 0,
        unresolved_exchange_externalized:
          unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0,
        blocked_flow_dependency_externalized:
          unresolvedExchangeExternalizeStage.counts?.blocked_flow_dependency_externalized ?? 0,
        source_exchange_completeness_entries:
          mutationManifest.counts?.source_exchange_completeness_entries ?? 0,
        source_reference_rewrites: mutationManifest.counts?.source_reference_rewrites ?? 0,
        identity_reference_rewrites: mutationManifest.counts?.identity_reference_rewrites ?? 0,
        identity_flow_reference_rewrites:
          identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0,
        identity_reference_reuse_rows: identityReferenceRewriteStage.counts?.reference_rows ?? 0,
        curation_queue_status:
          curationQueueStage.status === "not_required" ? "not_required" : curationQueueStage.status,
        curation_queue_blockers: curationQueueStage.report?.counts?.blockers ?? 0,
        curation_queue_tasks: curationQueueStage.report?.counts?.tasks ?? 0,
        curation_queue_process_rows: curationQueueStage.report?.counts?.process_rows ?? 0,
        curation_queue_flow_rows: curationQueueStage.report?.counts?.flow_rows ?? 0,
        curation_queue_external_flow_refs:
          curationQueueStage.report?.counts?.external_flow_refs ?? 0,
        full_context_scope_blockers:
          mutationManifest.evidence?.scope_blockers?.filter((blocker) =>
            String(blocker?.stage ?? "").includes("full_context_ai_completion"),
          ).length ?? 0,
      },
      blockers: [...prewriteGateBlockers, ...mutationManifestBlockers],
      stages: stageReports.map((stage) => compactStageReportWithTiming(stage, timingsByStage)),
      timings: finalizeTimings,
      files: {
        source_contact_rewrite_report: sourceContactRewriteStage.files?.report ?? null,
        source_contact_rewritten_rows: sourceContactRewriteStage.files?.output_rows ?? null,
        source_contact_support_rows: sourceContactRewriteStage.files?.support_rows ?? null,
        source_contact_support_finalize_report: sourceContactSupportFinalize.files?.report ?? null,
        source_contact_support_finalize_rows:
          sourceContactSupportFinalize.files?.final_rows ?? null,
        source_contact_support_commit_handoff_plan:
          sourceContactSupportFinalize.files?.commit_handoff_plan ?? null,
        source_contact_source_reference_rewrites:
          sourceContactRewriteStage.files?.source_reference_rewrites ?? null,
        cleanup_report: repoRelativeMaybe(cleanupReportFile),
        canonical_support_rewrite_report: repoRelativeMaybe(canonicalSupportReportFile),
        canonical_support_rewritten_rows: repoRelativeMaybe(canonicalSupportRowsFile),
        canonical_support_deferred_rows: canonicalSupportRewriteStage.files?.deferred_rows ?? null,
        canonical_support_rewrites:
          canonicalSupportRewriteStage.files?.canonical_support_rewrites ?? null,
        canonical_support_blockers:
          canonicalSupportRewriteStage.files?.canonical_support_blockers ?? null,
        identity_reference_rewrites: identityReferenceRewriteStage.rewrite_file ?? null,
        identity_preflight_run_report: repoRelativeMaybe(identityPreflightRunStage.report_file),
        identity_preflight_index: identityPreflightRunStage.index_file ?? null,
        identity_preflight_base_index: identityPreflightRunStage.base_index_file ?? null,
        identity_preflight_refresh_report: identityPreflightRunStage.refresh_report_file ?? null,
        identity_preflight_merge_report: identityPreflightRunStage.merge_report_file ?? null,
        identity_rewritten_rows:
          Number(identityReferenceRewriteStage.counts?.flow_reference_rewrites ?? 0) > 0
            ? identityReferenceRewriteStage.output_rows_file
            : null,
        unresolved_exchange_externalization_report:
          unresolvedExchangeExternalizeStage.files?.report ?? null,
        unresolved_exchange_externalized_rows:
          Number(unresolvedExchangeExternalizeStage.counts?.externalized_exchanges ?? 0) > 0
            ? unresolvedExchangeExternalizeStage.files?.output_rows
            : null,
        unresolved_exchange_traces: unresolvedExchangeExternalizeStage.files?.traces ?? null,
        identity_reference_reuse_rows: identityReferenceRewriteStage.reference_rows_file ?? null,
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
        location_decision_apply_report: repoRelativeMaybe(locationDecisionApplyReportFile),
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
        source_reference_rewrites: mutationManifest.files?.source_reference_rewrites ?? null,
        mutation_identity_reference_rewrites:
          mutationManifest.files?.identity_reference_rewrites ?? null,
      },
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
    const finalReportBase = {
      ...report,
      counts: {
        ...report.counts,
        commit_handoff_blockers: commitHandoffPlan.counts?.blockers ?? 0,
      },
      commit_handoff: {
        status: commitHandoffPlan.status,
        command: commitHandoffPlan.commands?.commit ?? null,
        post_write_verify_command: commitHandoffPlan.commands?.post_write_verify ?? null,
        blockers: commitHandoffPlan.blockers ?? [],
      },
      files: {
        ...report.files,
        commit_handoff_plan: commitHandoffPlan.files?.report ?? null,
      },
    };
    const importLedger = writeFinalizeImportLedger
      ? timeStage("import_ledger", () =>
          writeFinalizeImportLedger({
            report: finalReportBase,
            reportPath,
            ledgerDir: resolveRepoPath(
              options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
            ),
          }),
        )
      : { status: "skipped", files: {}, counts: { entries_written: 0 } };
    const finalReport = {
      ...finalReportBase,
      counts: {
        ...finalReportBase.counts,
        finalize_duration_ms: Date.now() - finalizeStartedAtMs,
        finalize_substage_count: finalizeTimings.length,
        import_ledger_entries: importLedger.counts?.entries_written ?? 0,
      },
      timings: finalizeTimings,
      files: {
        ...finalReportBase.files,
        import_ledger: importLedger.files ?? {},
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
