import fs from "node:fs";
import path from "node:path";
import { bundleRowTypeOrder, bundleRowTypes } from "../lib/bundle-row-types.mjs";
import { readOnlyStageContract } from "../lib/stage-contract.mjs";

const bundleSampleStageContract = readOnlyStageContract([
  {
    stage: "select_bundles",
    phase: "prepare",
    purpose: "Resolve requested process ids or deterministic sample selection.",
    inputs: ["process-bundles directory", "process id or sample options"],
    outputs: ["selected bundle manifest list"],
    side_effects: [],
  },
  {
    stage: "materialize_rows",
    phase: "rewrite_cleanup",
    purpose: "Read selected bundle dependencies and materialize source-language JSONL rows.",
    inputs: ["selected manifests", "bundle TIDAS payload files"],
    outputs: ["rows/*.jsonl", "support.jsonl"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "deterministic_rewrites",
    phase: "rewrite_cleanup",
    purpose:
      "Apply library contact, canonical source, canonical support, trace, source semantics, and placeholder repairs before write planning.",
    inputs: ["materialized row payloads", "canonical support cache"],
    outputs: [
      "source-reference-rewrites.jsonl",
      "canonical-support-rewrites.jsonl",
      "source-semantics.jsonl",
      "flow location context traces embedded in flow rows",
    ],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "authoring_queues",
    phase: "gate_validate",
    purpose:
      "Produce classification, location, identity-preflight, and elementary-flow reuse queues for unresolved policy work.",
    inputs: ["rewritten rows", "TIDAS classification/location schemas"],
    outputs: [
      "classification-authoring-queue.jsonl",
      "location-authoring-queue.jsonl",
      "identity-preflight-requests.jsonl",
      "elementary-flow-reuse-queue.jsonl",
    ],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "report",
    phase: "report",
    purpose:
      "Emit a command report with row files, generated handoff commands, counts, and blockers.",
    inputs: ["all generated local artifacts"],
    outputs: ["dataset-bundle-sample-rows-report.json", "process-scope-ledger.jsonl"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);

export function createBundleSampleRowsCommands({
  addDedupedBundleRow,
  asText,
  attachIdentityPreflightRows,
  buildBafuFallbackSourcePayload,
  buildIdentityPreflightArtifacts,
  buildLibraryContactPayload,
  classificationAuthoringCommands,
  cloneJson,
  collectBundleQualityFindings,
  collectElementaryFlowReuseFindings,
  collectLocationQualityFindings,
  collectSourceTracePayloads,
  contactGlobalReference,
  datasetIdentity,
  ensureArray,
  fileExists,
  findFirstBundleContactTemplate,
  listProcessBundleDirs,
  loadCanonicalSupportCache,
  loadTidasLocationCodeMap,
  locationAuthoringCommands,
  nowIso,
  processSourceReferenceRows,
  readJson,
  repairTrueSourceClassification,
  repairTrueSourceDescription,
  repairTrueSourceIdentity,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  resolveTiangongLcaCliBin,
  rewriteCanonicalFlowPropertyReferences,
  rewriteCanonicalSourceReferences,
  rewriteProcessDataSourceReferences,
  rewriteContactReferences,
  rewriteTrueSourceReferenceDescriptions,
  sanitizeBundlePayload,
  selectProcessBundleDirs,
  shellQuote,
  sourceReferenceSemanticBlockers,
  sourceSemanticSummary,
  writeJson,
  writeJsonLines,
}) {
  function locationCodeFromValue(value, locationCodeMap) {
    const code = asText(value);
    return code && locationCodeMap.has(code) ? code : null;
  }

  function processLocationCode(payload, locationCodeMap) {
    return locationCodeFromValue(
      payload?.processDataSet?.processInformation?.geography
        ?.locationOfOperationSupplyOrProduction?.["@location"],
      locationCodeMap,
    );
  }

  function exchangeLocationCode(exchange, locationCodeMap) {
    return locationCodeFromValue(
      exchange?.location ?? exchange?.["@location"] ?? exchange?.locationOfSupply,
      locationCodeMap,
    );
  }

  function flowLocationOfSupply(payload) {
    return asText(payload?.flowDataSet?.flowInformation?.geography?.locationOfSupply);
  }

  function flowDataSetInformation(payload) {
    return payload?.flowDataSet?.flowInformation?.dataSetInformation ?? null;
  }

  function buildFlowLocationTracePayload(evidence) {
    return {
      process: {
        name: "process",
        attributes: [
          { name: "processId", value: evidence.process_id },
          { name: "processVersion", value: evidence.process_version },
        ].filter((item) => item.value),
      },
      geography: evidence.process_location
        ? {
            name: "geography",
            attributes: [
              {
                name: "locationOfOperationSupplyOrProduction",
                value: evidence.process_location,
              },
            ],
          }
        : undefined,
      exchange: {
        name: "exchange",
        attributes: [
          { name: "referenceToFlowDataSet", value: evidence.flow_id },
          { name: "referenceToFlowDataSetVersion", value: evidence.flow_version },
          evidence.exchange_location
            ? { name: "location", value: evidence.exchange_location }
            : null,
        ].filter(Boolean),
      },
    };
  }

  function appendFlowLocationSourceTrace(flowPayload, evidence) {
    if (!flowPayload?.flowDataSet || flowLocationOfSupply(flowPayload)) return false;
    const dataSetInformation = flowDataSetInformation(flowPayload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return false;
    if (
      dataSetInformation["common:other"] &&
      (typeof dataSetInformation["common:other"] !== "object" ||
        Array.isArray(dataSetInformation["common:other"]))
    ) {
      return false;
    }
    const commonOther = (dataSetInformation["common:other"] ??= {});
    commonOther["@xmlns:tidasimport"] = "https://tiangong.earth/tidas/import-trace/1.0";
    const locationTrace = buildFlowLocationTracePayload(evidence);
    if (commonOther["tidasimport:sourceTrace"]) {
      const existingTrace = commonOther["tidasimport:sourceTrace"];
      if (!existingTrace || typeof existingTrace !== "object" || Array.isArray(existingTrace)) {
        return false;
      }
      const payload = existingTrace.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      if (payload.flowLocationEvidence) return false;
      payload.flowLocationEvidence = locationTrace;
      return true;
    }
    commonOther["tidasimport:sourceTrace"] = {
      "@marker": "TIDAS_IMPORT_TRACE_V1",
      payload: locationTrace,
    };
    return true;
  }

  function projectProcessFlowLocationEvidence({
    rowsByType,
    sourceByType,
    locationCodeMap,
    stats,
  }) {
    const evidenceByFlowKey = new Map();
    for (const [processKey, processPayload] of rowsByType.process.entries()) {
      const processIdentity = datasetIdentity(processPayload, "process");
      const processLocation = processLocationCode(processPayload, locationCodeMap);
      const exchanges = ensureArray(processPayload?.processDataSet?.exchanges?.exchange).filter(
        (exchange) => exchange && typeof exchange === "object",
      );
      for (const exchange of exchanges) {
        const reference = exchange.referenceToFlowDataSet ?? {};
        const flowId = asText(reference["@refObjectId"]);
        const flowVersion = asText(reference["@version"]) || "00.00.001";
        if (!flowId) continue;
        const exchangeLocation = exchangeLocationCode(exchange, locationCodeMap);
        if (!exchangeLocation && !processLocation) continue;
        const flowKey = `${flowId}::${flowVersion}`;
        if (evidenceByFlowKey.has(flowKey)) continue;
        evidenceByFlowKey.set(flowKey, {
          flow_id: flowId,
          flow_version: flowVersion,
          process_id: processIdentity.id,
          process_version: processIdentity.version,
          process_source_file: sourceByType.process.get(processKey) ?? null,
          process_location: processLocation,
          exchange_location: exchangeLocation,
        });
      }
    }

    for (const [flowKey, evidence] of evidenceByFlowKey.entries()) {
      const flowPayload = rowsByType.flow.get(flowKey);
      if (!flowPayload) continue;
      if (appendFlowLocationSourceTrace(flowPayload, evidence)) {
        stats.flow_location_context_traces += 1;
      }
    }
  }

  function processIdFromBundleRef(value) {
    const text = asText(value);
    if (!text) return "";
    const match = text.match(/(?:^|\/)process-bundles\/([^/]+)/u);
    return match?.[1] ?? "";
  }

  function blockerProcessId(blocker) {
    return (
      asText(blocker?.process_id) ||
      processIdFromBundleRef(blocker?.source_file) ||
      processIdFromBundleRef(blocker?.bundle) ||
      processIdFromBundleRef(blocker?.file) ||
      processIdFromBundleRef(blocker?.manifest)
    );
  }

  function blockerCountsByCode(blockersForScope) {
    const counts = new Map();
    for (const blocker of blockersForScope) {
      const code = asText(blocker?.code) || "unknown_blocker";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  function isHumanDependencyBlocker(blocker) {
    const code = asText(blocker?.code);
    return [
      "canonical_flow_property_reference_unresolved",
      "canonical_unit_group_reference_unresolved",
      "flow_property_reference_unresolved",
      "unit_group_reference_unresolved",
      "library_contact_count_invalid",
      "library_contact_identity_missing",
      "source_reference_semantics_unresolved",
      "process_data_source_reference_unresolved",
      "bundle_manifest_file_missing",
      "process_rows_missing",
    ].includes(code);
  }

  function scopeRerunCommand({ bundlesDir, outDir, profile, processId }) {
    return [
      "node",
      "scripts/foundry.mjs",
      "dataset-bundle-sample-rows",
      "--bundles-dir",
      repoRelativeMaybe(resolveRepoPath(bundlesDir)) || bundlesDir,
      "--process-id",
      processId,
      "--out-dir",
      repoRelativePath(path.join(outDir, "scopes", processId)),
      "--profile",
      profile,
    ]
      .map(shellQuote)
      .join(" ");
  }

  function buildProcessScopeLedger({ selectedBundles, blockers, bundlesDir, outDir, profile }) {
    const blockersByProcess = new Map();
    const globalBlockers = [];
    for (const blocker of blockers) {
      const processId = blockerProcessId(blocker);
      if (!processId) {
        globalBlockers.push(blocker);
        continue;
      }
      const rows = blockersByProcess.get(processId) ?? [];
      rows.push(blocker);
      blockersByProcess.set(processId, rows);
    }
    const ledger = selectedBundles.map((bundle) => {
      const processBlockers = blockersByProcess.get(bundle.process_id) ?? [];
      const humanDependencyBlockers = processBlockers.filter(isHumanDependencyBlocker);
      const scopedGlobalBlockers =
        globalBlockers.length > 0
          ? globalBlockers.map((blocker) => ({
              code: blocker.code,
              message: blocker.message,
            }))
          : [];
      const status =
        processBlockers.length === 0 && globalBlockers.length === 0
          ? "ready"
          : humanDependencyBlockers.length > 0 || globalBlockers.length > 0
            ? "blocked_deferred"
            : "needs_ai_authoring";
      return {
        process_id: bundle.process_id,
        bundle_dir: bundle.bundle_dir,
        manifest: bundle.manifest,
        status,
        blocker_count: processBlockers.length + globalBlockers.length,
        ai_authoring_blockers: processBlockers.length - humanDependencyBlockers.length,
        human_dependency_blockers: humanDependencyBlockers.length + globalBlockers.length,
        blocker_counts_by_code: blockerCountsByCode([...processBlockers, ...globalBlockers]),
        blocker_examples: processBlockers.slice(0, 5).map((blocker) => ({
          code: blocker.code,
          dataset_type: blocker.dataset_type ?? null,
          dataset_id: blocker.dataset_id ?? null,
          message: blocker.message,
        })),
        global_blockers: scopedGlobalBlockers,
        next_step:
          status === "ready"
            ? "ready_for_validation_and_write_planning"
            : status === "needs_ai_authoring"
              ? "run classification/location/identity authoring, deterministic apply, then rerun this process scope"
              : "defer this scope until human/canonical dependency blockers are resolved",
        rerun_command: scopeRerunCommand({
          bundlesDir,
          outDir,
          profile,
          processId: bundle.process_id,
        }),
      };
    });
    const summaryCounts = ledger.reduce(
      (counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
      },
      { ready: 0, needs_ai_authoring: 0, blocked_deferred: 0 },
    );
    return {
      ledger,
      summary: {
        ...summaryCounts,
        selected_scopes: ledger.length,
        global_blockers: globalBlockers.length,
        recommended_next_process_ids: [...ledger]
          .filter((row) => row.status !== "blocked_deferred")
          .sort((left, right) => {
            const statusRank = { ready: 0, needs_ai_authoring: 1, blocked_deferred: 2 };
            return (
              (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99) ||
              left.blocker_count - right.blocker_count ||
              left.process_id.localeCompare(right.process_id)
            );
          })
          .map((row) => row.process_id),
      },
    };
  }

  function runDatasetBundleSampleRows(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bundle-sample-rows",
        usage: [
          "node scripts/foundry.mjs dataset-bundle-sample-rows --bundles-dir tmp/bafu-2025-v2-tidas/process-bundles --sample-size 3 --out-dir .foundry/workspaces/bafu-sample-rows",
        ],
        purpose:
          "Sample process bundles, materialize support/process JSONL rows, replace all converted tool contacts with one library-level contact, and write commit-ready row files.",
        ...bundleSampleStageContract,
      };
    }

    const bundlesDir =
      options.bundlesDir || options.input || "tmp/bafu-2025-v2-tidas/process-bundles";
    const allBundleDirs = listProcessBundleDirs(bundlesDir);
    const selection = selectProcessBundleDirs(allBundleDirs, options);
    const outDir = resolveRepoPath(
      options.outDir || `.foundry/workspaces/bafu-bundle-sample-rows/${Date.now()}`,
    );
    const rowsDir = path.join(outDir, "rows");
    const cliBin = resolveTiangongLcaCliBin();
    const canonicalSupportCache = loadCanonicalSupportCache(options);
    const classificationCommandsByType = {
      process: classificationAuthoringCommands({
        cliBin,
        outDir,
        rowsDir,
        type: "process",
      }),
      "flow-product": classificationAuthoringCommands({
        cliBin,
        outDir,
        rowsDir,
        type: "flow-product",
        rowType: "flow",
      }),
      "flow-elementary": classificationAuthoringCommands({
        cliBin,
        outDir,
        rowsDir,
        type: "flow-elementary",
        rowType: "flow",
      }),
    };
    const locationCommandsByType = Object.fromEntries(
      bundleRowTypeOrder.map((type) => [
        type,
        locationAuthoringCommands({ cliBin, outDir, rowsDir, type }),
      ]),
    );
    const locationCodeMap = loadTidasLocationCodeMap();
    fs.mkdirSync(rowsDir, { recursive: true });

    const blockers = [];
    for (const missingId of selection.missing_process_ids) {
      blockers.push({
        code: "requested_process_bundle_missing",
        message: `Requested process bundle ${missingId} was not found.`,
        process_id: missingId,
      });
    }

    const sanitizeStats = {
      removed_import_traces: 0,
      removed_import_trace_namespaces: 0,
      placeholder_text_replacements: 0,
      timestamp_normalizations: 0,
      reference_year_repairs: 0,
      annual_supply_repairs: 0,
      true_source_classification_repairs: 0,
      default_process_classification_blockers: 0,
      default_flow_classification_blockers: 0,
      location_code_targets: 0,
      location_code_valid: 0,
      location_code_blockers: 0,
      source_reference_rewrites: 0,
      process_source_reference_rewrites: 0,
      process_source_reference_fallback_rewrites: 0,
      true_source_identity_repairs: 0,
      true_source_description_repairs: 0,
      true_source_reference_description_repairs: 0,
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
      elementary_flow_reuse_blockers: 0,
      flow_location_context_traces: 0,
    };
    const sourceReferenceRewriteRows = [];
    const canonicalSupportRewriteRows = [];
    const sourceClassificationRepairRows = [];
    const templateContact = findFirstBundleContactTemplate(selection.selected);
    const libraryContact = buildLibraryContactPayload(options, templateContact, {
      rewriteRows: sourceReferenceRewriteRows,
      stats: sanitizeStats,
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

    const rowsByType = Object.fromEntries(bundleRowTypeOrder.map((type) => [type, new Map()]));
    const sourceByType = Object.fromEntries(bundleRowTypeOrder.map((type) => [type, new Map()]));
    rowsByType.contact.set(
      `${libraryContactIdentity.id}::${libraryContactIdentity.version}`,
      libraryContact,
    );
    sourceByType.contact.set(
      `${libraryContactIdentity.id}::${libraryContactIdentity.version}`,
      "foundry:library-contact",
    );

    const rewriteStats = {
      rewritten: 0,
      previous_ids: new Set(),
      previous_descriptions: new Set(),
    };
    const traceRows = [];
    const classificationQueueRows = [];
    const locationQueueRows = [];
    const elementaryFlowReuseRows = [];
    const selectedBundles = [];
    for (const bundleDir of selection.selected) {
      const manifestPath = path.join(bundleDir, "manifest.json");
      const manifest = readJson(manifestPath);
      selectedBundles.push({
        process_id: manifest.process_id || path.basename(bundleDir),
        bundle_dir: repoRelativeMaybe(bundleDir),
        manifest: repoRelativeMaybe(manifestPath),
      });
      for (const type of bundleRowTypeOrder.filter((rowType) => rowType !== "contact")) {
        const plural = bundleRowTypes[type].plural;
        for (const relativeFile of ensureArray(manifest.files?.[plural])) {
          const sourceFile = path.join(bundleDir, relativeFile);
          if (!fileExists(sourceFile)) {
            blockers.push({
              code: "bundle_manifest_file_missing",
              message: `${type} file listed in bundle manifest is not readable.`,
              bundle: repoRelativeMaybe(bundleDir),
              file: relativeFile,
            });
            continue;
          }
          const payload = cloneJson(readJson(sourceFile));
          const sourceTraces = collectSourceTracePayloads(payload);
          rewriteContactReferences(payload, libraryContactRef, rewriteStats);
          sanitizeBundlePayload(payload, type, sourceFile, sanitizeStats, traceRows, sourceTraces);
          if (type === "source") {
            repairTrueSourceIdentity(payload, {
              sourceFile,
              stats: sanitizeStats,
              repairRows: sourceClassificationRepairRows,
            });
            repairTrueSourceDescription(payload, {
              sourceFile,
              stats: sanitizeStats,
              repairRows: sourceClassificationRepairRows,
            });
            repairTrueSourceClassification(payload, {
              sourceFile,
              stats: sanitizeStats,
              repairRows: sourceClassificationRepairRows,
            });
          }
          rewriteCanonicalSourceReferences(payload, {
            datasetType: type,
            sourceFile,
            stats: sanitizeStats,
            rewriteRows: sourceReferenceRewriteRows,
            datasetIdentityCache: datasetIdentity(payload, type),
          });
          rewriteCanonicalFlowPropertyReferences(payload, {
            cacheContext: canonicalSupportCache,
            datasetType: type,
            sourceFile,
            stats: sanitizeStats,
            rewriteRows: canonicalSupportRewriteRows,
            blockers,
            datasetIdentityCache: datasetIdentity(payload, type),
            language: asText(options.language || options.lang || "en") || "en",
          });
          collectBundleQualityFindings({
            payload,
            type,
            sourceFile,
            sourceTraces,
            blockers,
            stats: sanitizeStats,
            classificationQueueRows,
            classificationCommandsByType,
          });
          collectElementaryFlowReuseFindings({
            payload,
            type,
            sourceFile,
            sourceTraces,
            blockers,
            stats: sanitizeStats,
            elementaryFlowReuseRows,
          });
          collectLocationQualityFindings({
            payload,
            type,
            sourceFile,
            blockers,
            stats: sanitizeStats,
            locationQueueRows,
            locationCodeMap,
            locationCommands: locationCommandsByType[type],
          });
          addDedupedBundleRow({
            rowsByType,
            sourceByType,
            blockers,
            type,
            payload,
            sourceFile,
          });
        }
      }
    }

    let sourceSemanticsRows = [...rowsByType.source.entries()].map(([key, payload]) =>
      sourceSemanticSummary(payload, sourceByType.source.get(key)),
    );
    const sourceLookup = new Map(
      sourceSemanticsRows.filter((row) => row.dataset_id).map((row) => [row.dataset_id, row]),
    );
    const processSourceReplacement = (() => {
      const trueSources = sourceSemanticsRows.filter((row) => row.kind === "true_source");
      if (trueSources.length === 1) return trueSources[0];
      return null;
    })();
    const needsFallbackSource = [...rowsByType.process.entries()].some(([key, payload]) =>
      processSourceReferenceRows(payload, sourceLookup, sourceByType.process.get(key)).some(
        (row) =>
          row.relation === "process_data_source" && row.referenced_source_kind !== "true_source",
      ),
    );
    let fallbackSourceSummary = null;
    if (!processSourceReplacement && needsFallbackSource) {
      const fallbackSource = buildBafuFallbackSourcePayload({
        contactReference: libraryContactRef,
        language: asText(options.language || options.lang || "en") || "en",
        timestamp: nowIso(),
      });
      const fallbackIdentity = datasetIdentity(fallbackSource, "source");
      const fallbackKey = `${fallbackIdentity.id}::${fallbackIdentity.version}`;
      rowsByType.source.set(fallbackKey, fallbackSource);
      sourceByType.source.set(fallbackKey, "foundry:bafu-database-fallback-source");
      fallbackSourceSummary = {
        ...sourceSemanticSummary(fallbackSource, "foundry:bafu-database-fallback-source"),
        fallback_database_source: true,
      };
      sourceSemanticsRows = [...sourceSemanticsRows, fallbackSourceSummary];
      sourceLookup.set(fallbackSourceSummary.dataset_id, fallbackSourceSummary);
    }
    for (const [key, payload] of rowsByType.process.entries()) {
      rewriteProcessDataSourceReferences(payload.processDataSet, {
        sourceLookup,
        replacementSource: processSourceReplacement || fallbackSourceSummary,
        sourceFile: sourceByType.process.get(key),
        stats: sanitizeStats,
        rewriteRows: sourceReferenceRewriteRows,
        datasetIdentityCache: datasetIdentity(payload, "process"),
        language: asText(options.language || options.lang || "en") || "en",
      });
    }
    const allProcessSourceReferenceRows = [];
    for (const [key, payload] of rowsByType.process.entries()) {
      allProcessSourceReferenceRows.push(
        ...processSourceReferenceRows(payload, sourceLookup, sourceByType.process.get(key)),
      );
    }
    const processSourceReferenceQueueRows = allProcessSourceReferenceRows.filter(
      (row) => row.relation === "process_data_source",
    );
    blockers.push(...sourceReferenceSemanticBlockers(allProcessSourceReferenceRows));
    const omittedSourceSemanticsRows = sourceSemanticsRows.filter(
      (row) => row.kind !== "true_source",
    );
    for (const row of omittedSourceSemanticsRows) {
      if (!row.dataset_id) continue;
      rowsByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      sourceByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
    }

    projectProcessFlowLocationEvidence({
      rowsByType,
      sourceByType,
      locationCodeMap,
      stats: sanitizeStats,
    });

    const identityPreflightArtifacts = buildIdentityPreflightArtifacts({
      rowsByType,
      sourceByType,
      outDir,
      cliBin,
    });
    attachIdentityPreflightRows(elementaryFlowReuseRows, identityPreflightArtifacts);

    const traceQueuePath = path.join(outDir, "import-traces.jsonl");
    writeJsonLines(traceQueuePath, traceRows);
    const classificationQueuePath = path.join(outDir, "classification-authoring-queue.jsonl");
    writeJsonLines(classificationQueuePath, classificationQueueRows);
    const locationQueuePath = path.join(outDir, "location-authoring-queue.jsonl");
    writeJsonLines(locationQueuePath, locationQueueRows);
    const elementaryFlowReuseQueuePath = path.join(outDir, "elementary-flow-reuse-queue.jsonl");
    writeJsonLines(elementaryFlowReuseQueuePath, elementaryFlowReuseRows);
    const sourceSemanticsPath = path.join(outDir, "source-semantics.jsonl");
    writeJsonLines(sourceSemanticsPath, sourceSemanticsRows);
    const sourceClassificationRepairsPath = path.join(
      outDir,
      "source-classification-repairs.jsonl",
    );
    writeJsonLines(sourceClassificationRepairsPath, sourceClassificationRepairRows);
    const processSourceReferencesPath = path.join(outDir, "process-source-references.jsonl");
    writeJsonLines(processSourceReferencesPath, processSourceReferenceQueueRows);
    const sourceReferenceRewritesPath = path.join(outDir, "source-reference-rewrites.jsonl");
    writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteRows);
    const canonicalSupportRewritesPath = path.join(outDir, "canonical-support-rewrites.jsonl");
    writeJsonLines(canonicalSupportRewritesPath, canonicalSupportRewriteRows);

    const rowFiles = {};
    const countsByType = {};
    for (const type of bundleRowTypeOrder) {
      const rows = [...rowsByType[type].values()];
      countsByType[type] = rows.length;
      const filePath = path.join(rowsDir, `${bundleRowTypes[type].plural}.jsonl`);
      writeJsonLines(filePath, rows);
      rowFiles[type] = repoRelativePath(filePath);
    }
    const supportRows = ["contact", "source"].flatMap((type) => [...rowsByType[type].values()]);
    countsByType.support = supportRows.length;
    const supportRowsPath = path.join(rowsDir, "support.jsonl");
    writeJsonLines(supportRowsPath, supportRows);
    rowFiles.support = repoRelativePath(supportRowsPath);

    if (countsByType.contact !== 1) {
      blockers.push({
        code: "library_contact_count_invalid",
        message: `Expected exactly one shared contact row, got ${countsByType.contact}.`,
        actual: countsByType.contact,
      });
    }
    if (!libraryContactIdentity.id || !libraryContactIdentity.version) {
      blockers.push({
        code: "library_contact_identity_missing",
        message: "Generated library contact is missing common:UUID or common:dataSetVersion.",
        id: libraryContactIdentity.id,
        version: libraryContactIdentity.version,
      });
    }
    if (selection.selected.length === 0) {
      blockers.push({
        code: "process_bundle_selection_empty",
        message: "No process bundles were selected.",
      });
    }
    if (countsByType.process < selection.selected.length) {
      blockers.push({
        code: "process_rows_missing",
        message: `Selected ${selection.selected.length} bundles but materialized ${countsByType.process} process rows.`,
        selected_bundles: selection.selected.length,
        process_rows: countsByType.process,
      });
    }

    const profile = asText(options.profile || "bafu");
    const processScopeProjection = buildProcessScopeLedger({
      selectedBundles,
      blockers,
      bundlesDir,
      outDir,
      profile,
    });
    const processScopeLedgerPath = path.join(outDir, "process-scope-ledger.jsonl");
    writeJsonLines(processScopeLedgerPath, processScopeProjection.ledger);

    const rowTypeCommand = (type, mode) => {
      const modeFlag = mode === "commit" ? "--commit" : "--dry-run";
      if (type === "lifecyclemodel") {
        return [
          cliBin,
          "lifecyclemodel",
          "save-draft",
          "--input",
          resolveRepoPath(rowFiles[type]),
          "--out-dir",
          path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
          modeFlag,
          "--json",
        ]
          .map(shellQuote)
          .join(" ");
      }
      return [
        cliBin,
        "dataset",
        "save-draft",
        "--input",
        resolveRepoPath(rowFiles[type]),
        "--type",
        type,
        "--out-dir",
        path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
        modeFlag,
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
    };
    const commands = Object.fromEntries(
      bundleRowTypeOrder
        .filter((type) => !["unitgroup", "flowproperty"].includes(type))
        .map((type) => [
          type,
          {
            validate: rowTypeCommand(type, "validate"),
            commit: rowTypeCommand(type, "commit"),
          },
        ]),
    );
    commands.unitgroup = {
      validate: null,
      commit: null,
      policy: "reference_only_existing_database_rows",
    };
    commands.flowproperty = {
      validate: null,
      commit: null,
      policy: "reference_only_existing_database_rows",
    };
    commands.support = {
      validate: [
        cliBin,
        "dataset",
        "save-draft",
        "--input",
        resolveRepoPath(rowFiles.support),
        "--type",
        "auto",
        "--out-dir",
        path.join(outDir, "dry-run", "support"),
        "--dry-run",
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
      commit: [
        cliBin,
        "dataset",
        "save-draft",
        "--input",
        resolveRepoPath(rowFiles.support),
        "--type",
        "auto",
        "--out-dir",
        path.join(outDir, "commit", "support"),
        "--commit",
        "--json",
      ]
        .map(shellQuote)
        .join(" "),
    };

    const reportPath = path.join(outDir, "dataset-bundle-sample-rows-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "ready" : "blocked",
      command: "dataset-bundle-sample-rows",
      profile,
      source_bundles_dir: repoRelativeMaybe(resolveRepoPath(bundlesDir)),
      sample: {
        seed: selection.seed,
        requested_count: selection.selected.length + selection.missing_process_ids.length,
        selected_count: selection.selected.length,
        selected_bundles: selectedBundles,
        missing_process_ids: selection.missing_process_ids,
      },
      library_contact: {
        id: libraryContactIdentity.id,
        version: libraryContactIdentity.version,
        name: libraryContactName,
        website:
          libraryContact.contactDataSet.contactInformation.dataSetInformation.WWWAddress ?? null,
        policy: "one_shared_contact_per_source_library",
        replaced_contact_ids: [...rewriteStats.previous_ids].sort(),
        replaced_contact_descriptions: [...rewriteStats.previous_descriptions].sort(),
      },
      policy: {
        source_language_only: true,
        tidas_tools_conversion_boundary:
          "tidas-tools may emit a generic conversion contact; Foundry replaces it during library import materialization.",
        support_rows_before_process_rows: true,
        source_rows_only_true_sources: true,
        unitgroup_rows_reference_only: true,
        flowproperty_rows_reference_only: true,
        canonical_support_cache: repoRelativeMaybe(canonicalSupportCache.cachePath),
        source_rows_exclude:
          "Converted data-format, compliance-system, placeholder, and Not specified support sources are omitted from source/support rows; they remain only in source-semantics provenance.",
        unitgroup_flowproperty_write_policy:
          "Unit Groups and Flow Properties are selected from existing canonical database rows. Converted rows may be kept for audit, but support.jsonl and generated commit commands never write them to My Data.",
        elementary_flow_write_policy:
          "Elementary flows are selected from existing TianGong database rows and are never written as BAFU-owned flow rows. Unresolved elementary matches remain in elementary-flow-reuse-queue.jsonl and block referencing process writes.",
        identity_preflight_search_policy:
          "Process and flow matching uses CLI identity-preflight with complete fielded search briefs. The CLI sends query, filter, match_count, page_size, and data_source to process_hybrid_search or flow_hybrid_search, then applies deterministic local identity decisions to returned candidates.",
        canonical_flow_property_reference_rewrite:
          "Flow referenceToFlowPropertyDataSet values are rewritten from converted package-local Amount-in-unit rows to canonical Flow Property rows listed in the local support cache.",
        true_source_classification_repair:
          "Report/publication sources with sourceCitation and converted Other source types classification are repaired to TIDAS Publications and communications before dry-run/write planning.",
        true_source_identity_repair:
          "Report/publication sources with generic EcoSpold compatibility names are repaired from sourceDescriptionOrComment metadata before dry-run/write planning.",
        true_source_description_repair:
          "Report/publication sources with empty or generic sourceDescriptionOrComment values are repaired from sourceCitation/shortName evidence before dry-run/write planning.",
        true_source_reference_description_repair:
          "Process data source reference shortDescription values are synchronized to curated true source row names before dry-run/write planning.",
        canonical_source_reference_rewrite:
          "referenceToDataSetFormat and referenceToComplianceSystem are rewritten to public canonical source references before dry-run/write planning.",
        sdk_validation_before_remote_write:
          "Use the generated dataset save-draft dry-run/commit commands; each command validates with @tiangong-lca/tidas-sdk before writing.",
      },
      counts: {
        blockers: blockers.length,
        total_available_bundles: allBundleDirs.length,
        selected_bundles: selection.selected.length,
        process_scopes_ready: processScopeProjection.summary.ready,
        process_scopes_needs_ai_authoring: processScopeProjection.summary.needs_ai_authoring,
        process_scopes_blocked_deferred: processScopeProjection.summary.blocked_deferred,
        rewritten_contact_refs: rewriteStats.rewritten,
        import_trace_queue_rows: traceRows.length,
        classification_authoring_queue_rows: classificationQueueRows.length,
        location_authoring_queue_rows: locationQueueRows.length,
        elementary_flow_reuse_queue_rows: elementaryFlowReuseRows.length,
        identity_preflight_request_rows: identityPreflightArtifacts.rows.length,
        source_semantics_rows: sourceSemanticsRows.length,
        source_classification_repair_rows: sourceClassificationRepairRows.length,
        true_source_rows: sourceSemanticsRows.filter((row) => row.kind === "true_source").length,
        format_support_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "format_support_source",
        ).length,
        compliance_support_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "compliance_support_source",
        ).length,
        placeholder_or_unspecified_source_rows: sourceSemanticsRows.filter(
          (row) => row.kind === "placeholder_or_unspecified_source",
        ).length,
        omitted_non_true_source_rows: omittedSourceSemanticsRows.length,
        process_source_reference_rows: processSourceReferenceQueueRows.length,
        source_reference_rewrite_rows: sourceReferenceRewriteRows.length,
        canonical_support_rewrite_rows: canonicalSupportRewriteRows.length,
        reference_only_unitgroup_rows: countsByType.unitgroup,
        reference_only_flowproperty_rows: countsByType.flowproperty,
        true_source_identity_repairs: sanitizeStats.true_source_identity_repairs,
        true_source_description_repairs: sanitizeStats.true_source_description_repairs,
        true_source_reference_description_repairs:
          sanitizeStats.true_source_reference_description_repairs,
        ...sanitizeStats,
        ...Object.fromEntries(
          Object.entries(countsByType).map(([type, count]) => [`${type}_rows`, count]),
        ),
      },
      process_scope_summary: processScopeProjection.summary,
      files: {
        report: repoRelativePath(reportPath),
        rows: rowFiles,
        process_scope_ledger: repoRelativePath(processScopeLedgerPath),
        import_traces: repoRelativePath(traceQueuePath),
        classification_authoring_queue: repoRelativePath(classificationQueuePath),
        location_authoring_queue: repoRelativePath(locationQueuePath),
        elementary_flow_reuse_queue: repoRelativePath(elementaryFlowReuseQueuePath),
        identity_preflight_requests: repoRelativePath(identityPreflightArtifacts.indexPath),
        source_semantics: repoRelativePath(sourceSemanticsPath),
        source_classification_repairs: repoRelativePath(sourceClassificationRepairsPath),
        process_source_references: repoRelativePath(processSourceReferencesPath),
        source_reference_rewrites: repoRelativePath(sourceReferenceRewritesPath),
        canonical_support_rewrites: repoRelativePath(canonicalSupportRewritesPath),
      },
      commands,
      blockers,
    };
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetBundleSampleRows };
}
