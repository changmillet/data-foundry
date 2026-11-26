import fs from "node:fs";
import path from "node:path";
import { bundleRowTypeOrder, bundleRowTypes, type BundleRowType } from "../bundle-row-types.ts";
import { taskAuthorizationAllows } from "../task-authorization.ts";
import { buildBundleSampleCommands, writeBundleSampleReport } from "./commands-and-report.ts";
import { createFlowLocationEvidenceHelpers } from "./flow-location-evidence.ts";
import { buildProcessScopeLedger } from "./process-scope-ledger.ts";
import {
  bundleSampleStageContract,
  type BundleSampleDependencies,
  type LooseRecord,
  type SelectedBundle,
  type SemanticSummary,
  type SourceReferenceRow,
} from "./types.ts";

/** Creates the dataset-bundle-sample-rows command runner backed by modular helpers. */
export function createBundleSampleRowsRunner(deps: BundleSampleDependencies) {
  const {
    addDedupedBundleRow,
    asText,
    attachIdentityPreflightRows,
    booleanOption,
    profileFor,
    repoRoot,
    buildDatabaseFallbackSourcePayload,
    buildBafuProcessContextSourcePayload,
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
    processOriginalSourceMetadata,
    processSourceReferenceRows,
    readJson,
    repairTrueSourceClassification,
    repairTrueSourceDescription,
    repairTrueSourceIdentity,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    resolveTiangongLcaCliCommandPrefix,
    resolveTiangongLcaCliBin,
    rewriteCanonicalFlowPropertyReferences,
    rewriteCanonicalSourceReferences,
    rewriteProcessDataSourceReferences,
    rewriteContactReferences,
    sanitizeBundlePayload,
    selectProcessBundleDirs,
    sourceReferenceSemanticBlockers,
    sourceSummaryMatchesOriginalMetadata,
    sourceSemanticSummary,
    writeJsonLines,
  } = deps;
  const { collectFlowLocationOfSupplyAuthoringRows, projectProcessFlowLocationEvidence } =
    createFlowLocationEvidenceHelpers(deps);

  function runDatasetBundleSampleRows(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-bundle-sample-rows",
        usage: [
          "node src/dev-cli.ts dataset-bundle-sample-rows --bundles-dir tmp/bafu-2025-v2-tidas/process-bundles --sample-size 3 --out-dir .foundry/workspaces/bafu-sample-rows",
        ],
        purpose:
          "Sample process bundles, materialize support/process JSONL rows, replace all converted tool contacts with one library-level contact, and write authoring input row files.",
        ...bundleSampleStageContract,
      };
    }

    const bundlesDir =
      options.bundlesDir || options.input || "tmp/bafu-2025-v2-tidas/process-bundles";
    const allBundleDirs = listProcessBundleDirs(bundlesDir);
    const selection = selectProcessBundleDirs(allBundleDirs, options);
    const outDir = resolveRepoPath(
      options.outDir || `.foundry/workspaces/bafu-bundle-sample-rows/${Date.now()}`,
    )!;
    const rowsDir = path.join(outDir, "rows");
    const cliBin = resolveTiangongLcaCliCommandPrefix
      ? resolveTiangongLcaCliCommandPrefix()
      : [resolveTiangongLcaCliBin()];
    const canonicalSupportCache = loadCanonicalSupportCache(options);
    const selectedProfile =
      typeof profileFor === "function"
        ? profileFor(
            repoRoot,
            asText(options.profile || "generic")
              .trim()
              .toLowerCase(),
            options,
          )
        : null;
    const allowAccountLocalSupportAndElementary = booleanOption(
      options.prepareAccountLocalSupportCandidates,
    );
    const domainRules = selectedProfile?.domainRules as Record<string, unknown> | undefined;
    const blockOnUnscaledCanonicalSupport = booleanOption(
      options.blockOnUnscaledCanonicalSupport || options.blockUnscaledCanonicalSupport,
    );
    const classificationCommandsByType = {
      process: classificationAuthoringCommands({ cliBin, outDir, rowsDir, type: "process" }),
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

    const sanitizeStats: Record<string, number> = {
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
      flow_location_of_supply_missing_with_evidence: 0,
      flow_location_of_supply_auto_decision_candidates: 0,
      flow_location_of_supply_conflict_blockers: 0,
      source_reference_rewrites: 0,
      process_source_reference_rewrites: 0,
      process_source_reference_fallback_rewrites: 0,
      process_source_context_rewrites: 0,
      omitted_unreferenced_true_source_rows: 0,
      true_source_identity_repairs: 0,
      true_source_description_repairs: 0,
      true_source_reference_description_repairs: 0,
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
      elementary_flow_reuse_blockers: 0,
      flow_location_context_traces: 0,
    };
    const sourceReferenceRewriteRows: LooseRecord[] = [];
    const canonicalSupportRewriteRows: LooseRecord[] = [];
    const canonicalSupportScalingRequirements: LooseRecord[] = [];
    const canonicalSupportStats = {
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
      amount_scaling_required_rewrites: 0,
      amount_scaling_blocked: 0,
      amount_scaling_unresolved: 0,
    };
    const sourceClassificationRepairRows: LooseRecord[] = [];
    const templateContact = findFirstBundleContactTemplate(selection.selected);
    const libraryContact = buildLibraryContactPayload(options, templateContact, {
      rewriteRows: sourceReferenceRewriteRows,
      stats: sanitizeStats,
    });
    const libraryContactIdentity = datasetIdentity(libraryContact, "contact");
    const libraryContactName = asText(
      libraryContact.contactDataSet?.contactInformation?.dataSetInformation?.["common:name"]?.[
        "#text"
      ],
    );
    const libraryContactRef = contactGlobalReference({
      id: libraryContactIdentity.id,
      version: libraryContactIdentity.version,
      shortDescription: libraryContactName,
      language: asText(options.language || options.lang || "en") || "en",
    });

    const rowsByType = Object.fromEntries(
      bundleRowTypeOrder.map((type) => [type, new Map<string, LooseRecord>()]),
    ) as Record<BundleRowType, Map<string, LooseRecord>>;
    const sourceByType = Object.fromEntries(
      bundleRowTypeOrder.map((type) => [type, new Map<string, string>()]),
    ) as Record<BundleRowType, Map<string, string>>;
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
      previous_ids: new Set<string>(),
      previous_descriptions: new Set<string>(),
    };
    const traceRows: LooseRecord[] = [];
    const classificationQueueRows: LooseRecord[] = [];
    const locationQueueRows: LooseRecord[] = [];
    const elementaryFlowReuseRows: LooseRecord[] = [];
    const selectedBundles: SelectedBundle[] = [];
    for (const bundleDir of selection.selected) {
      const manifestPath = path.join(bundleDir, "manifest.json");
      const manifest = readJson(manifestPath);
      selectedBundles.push({
        process_id: asText(manifest.process_id) || path.basename(bundleDir),
        bundle_dir: repoRelativeMaybe(bundleDir),
        manifest: repoRelativeMaybe(manifestPath),
      });
      for (const type of bundleRowTypeOrder.filter((rowType) => rowType !== "contact")) {
        const plural = bundleRowTypes[type].plural;
        for (const relativeFileValue of ensureArray(manifest.files?.[plural])) {
          const relativeFile = asText(relativeFileValue);
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
            stats: canonicalSupportStats,
            rewriteRows: canonicalSupportRewriteRows,
            blockers,
            scalingRequirements: canonicalSupportScalingRequirements,
            blockOnUnscaled: blockOnUnscaledCanonicalSupport,
            datasetIdentityCache: datasetIdentity(payload, type),
            language: asText(options.language || options.lang || "en") || "en",
            allowAccountLocalSupportAndElementary,
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
            allowAccountLocalSupportAndElementary: taskAuthorizationAllows(
              selectedProfile?.authorization,
              "elementary_flow_create_new",
            ),
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
    const sourceLookup = new Map<string, SemanticSummary>(
      sourceSemanticsRows
        .filter((row): row is SemanticSummary & { dataset_id: string } => Boolean(row.dataset_id))
        .map((row) => [row.dataset_id, row] as const),
    );
    for (const [key, payload] of rowsByType.process.entries()) {
      const metadata = processOriginalSourceMetadata(payload);
      if (!metadata) continue;
      const processIdentity = datasetIdentity(payload, "process");
      const processSourceRefs = processSourceReferenceRows(
        payload,
        sourceLookup,
        sourceByType.process.get(key),
      ).filter((row) => row.relation === "process_data_source");
      if (processSourceRefs.length === 0) continue;
      for (const sourceRef of processSourceRefs) {
        const referencedSource = sourceLookup.get(sourceRef.ref_object_id);
        if (sourceSummaryMatchesOriginalMetadata(referencedSource, metadata)) continue;
        const sourcePayload = buildBafuProcessContextSourcePayload({
          metadata,
          contactReference: libraryContactRef,
          language: asText(options.language || options.lang || "en") || "en",
          timestamp: nowIso(),
        });
        if (!sourcePayload) continue;
        const sourceIdentity = datasetIdentity(sourcePayload, "source");
        const sourceKey = `${sourceIdentity.id}::${sourceIdentity.version}`;
        if (!rowsByType.source.has(sourceKey)) {
          rowsByType.source.set(sourceKey, sourcePayload);
          sourceByType.source.set(
            sourceKey,
            `foundry:process-context-source:${processIdentity.id}`,
          );
          const summary: SemanticSummary = {
            ...sourceSemanticSummary(sourcePayload, sourceByType.source.get(sourceKey)),
            process_context_source: true,
            source_context_process_id: processIdentity.id,
          };
          sourceSemanticsRows = [...sourceSemanticsRows, summary];
          if (summary.dataset_id) sourceLookup.set(summary.dataset_id, summary);
          sourceClassificationRepairRows.push({
            dataset_id: sourceIdentity.id,
            dataset_version: sourceIdentity.version,
            source_file: repoRelativeMaybe(sourceByType.process.get(key)),
            relation: "true_source_identity_from_process_context",
            original_ref_object_id: sourceRef.ref_object_id,
            original_short_description: sourceRef.short_description,
            repaired_short_name: metadata.shortName,
            repaired_source_citation: metadata.citation,
            doi: metadata.doi,
            basis:
              "Process context contains an explicit Original source and DOI that is more specific than the converted process data source reference.",
          });
        }
        const replacementSource = sourceIdentity.id
          ? sourceLookup.get(sourceIdentity.id)
          : undefined;
        rewriteProcessDataSourceReferences(payload.processDataSet!, {
          sourceLookup,
          replacementSource,
          forceReplacementSource: true,
          replacementRelation: "process_data_source_context_source",
          replacementReason:
            "Process context contains an explicit Original source/DOI that is more specific than the converted process data source reference.",
          sourceFile: sourceByType.process.get(key),
          stats: sanitizeStats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: processIdentity,
          language: asText(options.language || options.lang || "en") || "en",
        });
      }
    }
    const processSourceReplacement = (() => {
      const trueSources = sourceSemanticsRows.filter((row) => row.kind === "true_source");
      return trueSources.length === 1 ? trueSources[0] : null;
    })();
    const needsFallbackSource = [...rowsByType.process.entries()].some(([key, payload]) =>
      processSourceReferenceRows(payload, sourceLookup, sourceByType.process.get(key)).some(
        (row) =>
          row.relation === "process_data_source" && row.referenced_source_kind !== "true_source",
      ),
    );
    let fallbackSourceSummary: SemanticSummary | null = null;
    if (!processSourceReplacement && needsFallbackSource) {
      const fallbackSource = buildDatabaseFallbackSourcePayload({
        profile: asText(options.profile) || "bafu",
        contactReference: libraryContactRef,
        language: asText(options.language || options.lang || "en") || "en",
        timestamp: nowIso(),
      });
      const fallbackIdentity = datasetIdentity(fallbackSource, "source");
      const fallbackKey = `${fallbackIdentity.id}::${fallbackIdentity.version}`;
      const fallbackProvenance = `foundry:${asText(options.profile) || "bafu"}-database-fallback-source`;
      rowsByType.source.set(fallbackKey, fallbackSource);
      sourceByType.source.set(fallbackKey, fallbackProvenance);
      fallbackSourceSummary = {
        ...sourceSemanticSummary(fallbackSource, fallbackProvenance),
        fallback_database_source: true,
      };
      sourceSemanticsRows = [...sourceSemanticsRows, fallbackSourceSummary];
      if (fallbackSourceSummary.dataset_id) {
        sourceLookup.set(fallbackSourceSummary.dataset_id, fallbackSourceSummary);
      }
    }
    for (const [key, payload] of rowsByType.process.entries()) {
      rewriteProcessDataSourceReferences(payload.processDataSet!, {
        sourceLookup,
        replacementSource: processSourceReplacement || fallbackSourceSummary,
        sourceFile: sourceByType.process.get(key),
        stats: sanitizeStats,
        rewriteRows: sourceReferenceRewriteRows,
        datasetIdentityCache: datasetIdentity(payload, "process"),
        language: asText(options.language || options.lang || "en") || "en",
      });
    }
    const allProcessSourceReferenceRows: SourceReferenceRow[] = [];
    for (const [key, payload] of rowsByType.process.entries()) {
      allProcessSourceReferenceRows.push(
        ...processSourceReferenceRows(payload, sourceLookup, sourceByType.process.get(key)),
      );
    }
    const processSourceReferenceQueueRows = allProcessSourceReferenceRows.filter(
      (row) => row.relation === "process_data_source",
    );
    blockers.push(...sourceReferenceSemanticBlockers(allProcessSourceReferenceRows));
    const referencedProcessSourceKeys = new Set(
      allProcessSourceReferenceRows
        .filter((row) => row.ref_object_id)
        .map((row) => `${row.ref_object_id}::${row.version || "00.00.001"}`),
    );
    const referencedReviewSourceKeys = new Set(
      allProcessSourceReferenceRows
        .filter(
          (row) =>
            row.ref_object_id && asText(row.path).includes("referenceToCompleteReviewReport"),
        )
        .map((row) => `${row.ref_object_id}::${row.version || "00.00.001"}`),
    );
    const unreferencedTrueSourceRows = sourceSemanticsRows.filter(
      (row) =>
        row.kind === "true_source" &&
        row.materialized_as_source_row !== false &&
        !referencedProcessSourceKeys.has(
          `${row.dataset_id}::${row.dataset_version || "00.00.001"}`,
        ),
    );
    for (const row of unreferencedTrueSourceRows) {
      if (!row.dataset_id) continue;
      rowsByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      sourceByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      row.materialized_as_source_row = false;
      row.omitted_reason = "unreferenced_by_selected_process_scope";
      sanitizeStats.omitted_unreferenced_true_source_rows += 1;
    }
    const omittedSourceSemanticsRows = sourceSemanticsRows.filter((row) => {
      if (row.kind === "true_source") return false;
      if (
        domainRules?.preserve_referenced_review_sources === true &&
        row.dataset_id &&
        referencedReviewSourceKeys.has(`${row.dataset_id}::${row.dataset_version || "00.00.001"}`)
      ) {
        row.materialized_as_source_row = true;
        row.retained_reason = "referenced_account_local_support_source";
        sanitizeStats.retained_referenced_account_local_support_source_rows =
          Number(sanitizeStats.retained_referenced_account_local_support_source_rows ?? 0) + 1;
        return false;
      }
      return true;
    });
    for (const row of omittedSourceSemanticsRows) {
      if (!row.dataset_id) continue;
      rowsByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
      sourceByType.source.delete(`${row.dataset_id}::${row.dataset_version || ""}`);
    }

    const processFlowLocationEvidenceRows = projectProcessFlowLocationEvidence({
      rowsByType,
      sourceByType,
      locationCodeMap,
      stats: sanitizeStats,
    });
    collectFlowLocationOfSupplyAuthoringRows({
      rowsByType,
      sourceByType,
      processFlowEvidenceRows: processFlowLocationEvidenceRows,
      locationCodeMap,
      locationQueueRows,
      locationCommands: locationCommandsByType.flow,
      blockers,
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
    const canonicalSupportScalingPath = path.join(outDir, "canonical-support-amount-scaling.jsonl");
    if (canonicalSupportScalingRequirements.length > 0) {
      writeJsonLines(canonicalSupportScalingPath, canonicalSupportScalingRequirements);
    }
    sanitizeStats.canonical_flow_property_reference_rewrites =
      canonicalSupportStats.canonical_flow_property_reference_rewrites;
    sanitizeStats.canonical_unit_group_reference_proofs =
      canonicalSupportStats.canonical_unit_group_reference_proofs;
    if (canonicalSupportStats.amount_scaling_required_rewrites > 0) {
      sanitizeStats.amount_scaling_required_rewrites =
        canonicalSupportStats.amount_scaling_required_rewrites;
    }
    if (canonicalSupportStats.amount_scaling_blocked > 0) {
      sanitizeStats.amount_scaling_blocked = canonicalSupportStats.amount_scaling_blocked;
    }
    if (canonicalSupportStats.amount_scaling_unresolved > 0) {
      sanitizeStats.amount_scaling_unresolved = canonicalSupportStats.amount_scaling_unresolved;
    }

    const rowFiles: Partial<Record<BundleRowType | "support", string>> = {};
    const countsByType: Record<string, number> = {};
    for (const type of bundleRowTypeOrder) {
      const rows = [...rowsByType[type].values()];
      countsByType[type] = rows.length;
      const filePath = path.join(rowsDir, `${bundleRowTypes[type].plural}.jsonl`);
      writeJsonLines(filePath, rows);
      rowFiles[type] = repoRelativePath(filePath);
    }
    const supportRows = (["contact", "source"] as BundleRowType[]).flatMap((type) => [
      ...rowsByType[type].values(),
    ]);
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
      deps,
      selectedBundles,
      blockers,
      bundlesDir,
      outDir,
      profile,
    });
    const processScopeLedgerPath = path.join(outDir, "process-scope-ledger.jsonl");
    writeJsonLines(processScopeLedgerPath, processScopeProjection.ledger);

    const commands = buildBundleSampleCommands({
      deps,
      outDir,
      profile,
      cliBin,
      rowFiles,
      classificationQueuePath,
      locationQueuePath,
      identityPreflightArtifacts,
    });

    return writeBundleSampleReport({
      deps,
      outDir,
      profile,
      bundlesDir,
      allBundleDirs,
      selection,
      selectedBundles,
      libraryContact,
      libraryContactIdentity,
      libraryContactName,
      rewriteStats,
      canonicalSupportCache,
      canonicalSupportScalingRequirements,
      blockOnUnscaledCanonicalSupport,
      blockers,
      processScopeProjection,
      traceRows,
      classificationQueueRows,
      locationQueueRows,
      elementaryFlowReuseRows,
      identityPreflightArtifacts,
      sourceSemanticsRows,
      sourceClassificationRepairRows,
      omittedSourceSemanticsRows,
      processSourceReferenceQueueRows,
      sourceReferenceRewriteRows,
      canonicalSupportRewriteRows,
      countsByType,
      sanitizeStats,
      rowFiles,
      processScopeLedgerPath,
      traceQueuePath,
      classificationQueuePath,
      locationQueuePath,
      elementaryFlowReuseQueuePath,
      sourceSemanticsPath,
      sourceClassificationRepairsPath,
      processSourceReferencesPath,
      sourceReferenceRewritesPath,
      canonicalSupportRewritesPath,
      canonicalSupportScalingPath,
      commands,
    });
  }

  return { runDatasetBundleSampleRows };
}
