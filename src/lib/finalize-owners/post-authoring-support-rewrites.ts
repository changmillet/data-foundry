import fs from "node:fs";
import path from "node:path";
import {
  rowDatasetType,
  type DatasetReference,
  type DatasetRow,
  type FinalizeDependencies,
  type FinalizeOptions,
  type FinalizeStage,
  type JsonRecord,
  type SourceSummary,
} from "./post-authoring-types.ts";

/** Builds the deterministic source, contact, and account-local FP/UG rewrite runner for post-authoring finalize. */
export function createSourceContactRewriteRunner(deps: FinalizeDependencies) {
  const {
    asText,
    booleanOption,
    buildLibraryContactPayload,
    cloneJson,
    contactGlobalReference,
    datasetIdentity,
    datasetRowsFileStem,
    fileExists,
    loadCanonicalSupportCache,
    processSourceReferenceRows,
    readRowsFile,
    repairTrueSourceClassification,
    repairTrueSourceDescription,
    repairTrueSourceIdentity,
    repoRelativePath,
    resolveRepoPath,
    rewriteCanonicalSourceReferences,
    rewriteContactReferences,
    rewriteTrueSourceReferenceDescriptions,
    sourceReferenceSemanticBlockers,
    sourceSemanticSummary,
    writeJson,
    writeJsonLines,
  } = deps;

  // Read a Flow Property row's referenceToReferenceUnitGroup id + version.
  function flowPropertyReferenceUnitGroup(fpRow: DatasetRow): {
    reference: DatasetReference | null;
    id: string;
    version: string;
  } {
    const referenceUnitGroup =
      fpRow?.flowPropertyDataSet?.flowPropertiesInformation?.quantitativeReference
        ?.referenceToReferenceUnitGroup;
    if (!referenceUnitGroup) return { reference: null, id: "", version: "" };
    return {
      reference: referenceUnitGroup,
      id: asText(
        referenceUnitGroup["@refObjectId"] ??
          referenceUnitGroup.refObjectId ??
          referenceUnitGroup.ref_object_id,
      ),
      version: asText(referenceUnitGroup["@version"]),
    };
  }

  // Coherent model — REUSED (canonical) dependency proof. Given a set of support rows
  // (the exact rows a SUPPORT scope writes), derive the canonical Unit Group
  // id@published-version proof keys for every minted Flow Property whose reference Unit
  // Group is a public canonical dataset (present in the canonical-support cache) and is
  // therefore NOT written as account-local My Data.
  function deriveCanonicalUnitGroupProofKeysFromSupportRows(
    supportRows: DatasetRow[],
    options: FinalizeOptions,
  ): Array<{ id: string; version: string }> {
    const { index } = loadCanonicalSupportCache(options);
    const writtenUnitGroupIds = new Set(
      supportRows
        .filter((row) => row?.unitGroupDataSet)
        .map((row) => datasetIdentity(row, "unitgroup").id)
        .filter(Boolean),
    );
    const proofKeys = [];
    const seen = new Set();
    for (const row of supportRows) {
      if (!row?.flowPropertyDataSet) continue;
      const { id: ugId } = flowPropertyReferenceUnitGroup(row);
      if (!ugId || writtenUnitGroupIds.has(ugId)) continue;
      const canonicalUnitGroup = index.unitGroupById.get(ugId);
      if (!canonicalUnitGroup) continue;
      const canonicalVersion = asText(canonicalUnitGroup.version);
      if (!canonicalVersion) continue;
      const proofKey = `unitgroups:${ugId}@${canonicalVersion}`;
      if (seen.has(proofKey)) continue;
      seen.add(proofKey);
      proofKeys.push({ id: ugId, version: canonicalVersion });
    }
    return proofKeys;
  }

  function collectAccountLocalFpUgSupportRows(options: FinalizeOptions): {
    rows: DatasetRow[];
    canonicalUnitGroupProofKeys: Array<{ id: string; version: string }>;
  } {
    if (!booleanOption(options.mintUnmatchedFpUgSupport))
      return { rows: [], canonicalUnitGroupProofKeys: [] };
    const { index } = loadCanonicalSupportCache(options);
    const ugFile = resolveRepoPath(options.supportUnitgroupRowsFile);
    const fpFile = resolveRepoPath(options.supportFlowpropertyRowsFile);
    const ugRows = ugFile && fileExists(ugFile) ? readRowsFile(ugFile) : [];
    const fpRows = fpFile && fileExists(fpFile) ? readRowsFile(fpFile) : [];
    const ACCOUNT_LOCAL_MINT_VERSION = "00.00.001";
    const setSupportOwnVersion = (
      row: DatasetRow,
      rootKey: "flowPropertyDataSet" | "unitGroupDataSet",
    ): DatasetRow => {
      const next = cloneJson(row);
      const admin = next[rootKey]?.administrativeInformation;
      if (admin) {
        admin.publicationAndOwnership = admin.publicationAndOwnership || {};
        admin.publicationAndOwnership["common:dataSetVersion"] = ACCOUNT_LOCAL_MINT_VERSION;
      }
      return next;
    };
    const mintUnitGroups = ugRows
      .filter((row) => {
        const id = datasetIdentity(row, "unitgroup").id;
        return id && !index.unitGroupById.has(id);
      })
      .map((row) => setSupportOwnVersion(row, "unitGroupDataSet"));
    const mintFlowProperties = fpRows.filter((row) => {
      const id = datasetIdentity(row, "flowproperty").id;
      return id && !index.flowPropertyById.has(id);
    });
    const canonicalUnitGroupProofKeys: Array<{ id: string; version: string }> = [];
    const seenCanonicalProofKeys = new Set<string>();
    const rewrittenFlowProperties = mintFlowProperties.map((fpRow) => {
      const { id: ugId, version: currentVersion } = flowPropertyReferenceUnitGroup(fpRow);
      const canonicalUnitGroup = ugId ? index.unitGroupById.get(ugId) : null;
      let out = fpRow;
      if (canonicalUnitGroup) {
        const canonicalVersion = asText(canonicalUnitGroup.version);
        if (canonicalVersion) {
          const proofKey = `unitgroups:${ugId}@${canonicalVersion}`;
          if (!seenCanonicalProofKeys.has(proofKey)) {
            seenCanonicalProofKeys.add(proofKey);
            canonicalUnitGroupProofKeys.push({ id: ugId, version: canonicalVersion });
          }
          if (currentVersion !== canonicalVersion) {
            out = cloneJson(fpRow);
            out.flowPropertyDataSet!.flowPropertiesInformation!.quantitativeReference!.referenceToReferenceUnitGroup![
              "@version"
            ] = canonicalVersion;
          }
        }
      }
      return setSupportOwnVersion(out, "flowPropertyDataSet");
    });
    return {
      rows: [...mintUnitGroups, ...rewrittenFlowProperties],
      canonicalUnitGroupProofKeys,
    };
  }

  return function applySourceContactRewrites({
    datasetType,
    rowsFile,
    outDir,
    options,
  }: {
    datasetType: string;
    rowsFile: string;
    outDir: string;
    options: FinalizeOptions;
  }): FinalizeStage {
    const profile = String(options.profile || "generic")
      .trim()
      .toLowerCase();
    const supportedForProfile =
      profile === "bafu" || profile === "uslci" || profile === "worldsteel";
    const outputRowsFile = path.join(
      outDir,
      `${datasetRowsFileStem(datasetType)}.source-contact-rewritten.jsonl`,
    );
    const reportPath = path.join(outDir, "source-contact-rewrites-report.json");
    const sourceReferenceRewritesPath = path.join(outDir, "source-reference-rewrites.jsonl");
    const supportRowsPath = path.join(outDir, "support.jsonl");
    fs.mkdirSync(outDir, { recursive: true });
    if (!supportedForProfile || booleanOption(options.skipSourceContactRewrites)) {
      const skippedCanonicalUnitGroupProofKeys = fileExists(rowsFile)
        ? deriveCanonicalUnitGroupProofKeysFromSupportRows(readRowsFile(rowsFile), options)
        : [];
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
        canonical_support: {
          canonical_unit_group_reference_keys: skippedCanonicalUnitGroupProofKeys,
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
    const sourceReferenceRewriteRows: JsonRecord[] = [];
    const stats = {
      source_reference_rewrites: 0,
      true_source_identity_repairs: 0,
      true_source_description_repairs: 0,
      true_source_classification_repairs: 0,
      true_source_reference_description_repairs: 0,
    };
    const sourceSupportRepairRows: JsonRecord[] = [];
    const sourceSupportSemanticsRows: SourceSummary[] = [];
    const libraryContact = buildLibraryContactPayload(options, null, {
      rewriteRows: sourceReferenceRewriteRows,
      stats,
    });
    const libraryContactIdentity = datasetIdentity(libraryContact, "contact");
    const libraryContactName = asText(
      libraryContact.contactDataSet!.contactInformation.dataSetInformation["common:name"]?.[
        "#text"
      ],
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
    const sourceSupportPayloads = new Map<string, DatasetRow>();
    const sourceLookup = new Map<string, SourceSummary>();
    if (fileExists(sourceSupportRowsFile)) {
      const supportContactRewriteStats = {
        rewritten: 0,
        previous_ids: new Set<string>(),
        previous_descriptions: new Set<string>(),
      };
      for (const sourceRow of readRowsFile(sourceSupportRowsFile!)) {
        if (!sourceRow?.sourceDataSet) continue;
        const payload = cloneJson(sourceRow);
        const identity = datasetIdentity(payload, "source");
        if (!identity.id) continue;
        rewriteContactReferences(payload, libraryContactRef, supportContactRewriteStats);
        repairTrueSourceIdentity(payload, {
          sourceFile: sourceSupportRowsFile!,
          stats,
          repairRows: sourceSupportRepairRows,
        });
        repairTrueSourceDescription(payload, {
          sourceFile: sourceSupportRowsFile!,
          stats,
          repairRows: sourceSupportRepairRows,
        });
        repairTrueSourceClassification(payload, {
          sourceFile: sourceSupportRowsFile!,
          stats,
          repairRows: sourceSupportRepairRows,
        });
        rewriteCanonicalSourceReferences(payload, {
          datasetType: "source",
          sourceFile: sourceSupportRowsFile!,
          stats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: datasetIdentity(payload, "source"),
        });
        const repairedIdentity = datasetIdentity(payload, "source");
        const summary = sourceSemanticSummary(payload, sourceSupportRowsFile!);
        sourceSupportSemanticsRows.push(summary);
        if (summary.dataset_id) sourceLookup.set(summary.dataset_id, summary);
        sourceSupportPayloads.set(
          `${repairedIdentity.id}::${repairedIdentity.version || "00.00.001"}`,
          payload,
        );
      }
    }
    const contactRewriteStats = {
      rewritten: 0,
      previous_ids: new Set<string>(),
      previous_descriptions: new Set<string>(),
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
        sourceLookup: sourceLookup.size > 0 ? sourceLookup : null,
      });
      if (type === "process" && sourceLookup.size > 0) {
        rewriteTrueSourceReferenceDescriptions(payload.processDataSet!, {
          sourceLookup,
          sourceFile: rowsFile,
          stats,
          rewriteRows: sourceReferenceRewriteRows,
          datasetIdentityCache: datasetIdentity(payload, type),
        });
      }
      return payload;
    });
    const allProcessSourceReferenceRowsForScope =
      sourceLookup.size > 0
        ? rewrittenRows.flatMap((payload) => {
            const type = rowDatasetType(payload, datasetType);
            return type === "process"
              ? processSourceReferenceRows(payload, sourceLookup, rowsFile)
              : [];
          })
        : [];
    const processSourceReferenceRowsForScope = allProcessSourceReferenceRowsForScope.filter(
      (row) => row.relation === "process_data_source",
    );
    const sourceSemanticBlockers =
      typeof sourceReferenceSemanticBlockers === "function"
        ? sourceReferenceSemanticBlockers(processSourceReferenceRowsForScope)
        : [];
    const referencedTrueSourceKeys = new Set(
      allProcessSourceReferenceRowsForScope
        .filter((row) => row.referenced_source_kind === "true_source" && row.ref_object_id)
        .map((row) => `${row.ref_object_id}::${row.version || "00.00.001"}`),
    );
    const trueSourceSupportIds = new Set(
      sourceSupportSemanticsRows
        .filter((summary) => summary?.kind === "true_source")
        .map((summary) => summary?.dataset_id)
        .filter(Boolean),
    );
    for (const row of allProcessSourceReferenceRowsForScope) {
      if (!row.ref_object_id) continue;
      const pathText = String(row.path || "");
      const isReviewReportRef = pathText.includes("validation") && pathText.includes("review");
      if (!isReviewReportRef || !trueSourceSupportIds.has(row.ref_object_id)) continue;
      const key = `${row.ref_object_id}::${row.version || "00.00.001"}`;
      if (sourceSupportPayloads.has(key)) referencedTrueSourceKeys.add(key);
    }
    const referencedTrueSourceRows = [...referencedTrueSourceKeys]
      .map((key) => sourceSupportPayloads.get(key))
      .filter((row): row is DatasetRow => Boolean(row));

    writeJsonLines(outputRowsFile, rewrittenRows);
    writeJsonLines(sourceReferenceRewritesPath, sourceReferenceRewriteRows);
    const sourceSupportSemanticsPath = path.join(outDir, "source-support-semantics.jsonl");
    const sourceSupportRepairsPath = path.join(outDir, "source-support-repairs.jsonl");
    writeJsonLines(sourceSupportSemanticsPath, sourceSupportSemanticsRows);
    writeJsonLines(sourceSupportRepairsPath, sourceSupportRepairRows);
    const { rows: accountLocalFpUgSupportRows, canonicalUnitGroupProofKeys } =
      collectAccountLocalFpUgSupportRows(options);
    writeJsonLines(supportRowsPath, [
      ...accountLocalFpUgSupportRows,
      libraryContact,
      ...referencedTrueSourceRows,
    ]);
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
        support_rows: 1 + referencedTrueSourceRows.length + accountLocalFpUgSupportRows.length,
        support_contact_rows: 1,
        support_source_rows: referencedTrueSourceRows.length,
        support_account_local_fp_ug_rows: accountLocalFpUgSupportRows.length,
        support_unitgroup_rows: accountLocalFpUgSupportRows.filter((row) => row?.unitGroupDataSet)
          .length,
        support_flowproperty_rows: accountLocalFpUgSupportRows.filter(
          (row) => row?.flowPropertyDataSet,
        ).length,
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
          ? repoRelativePath(sourceSupportRowsFile!)
          : null,
        referenced_true_source_ids: referencedTrueSourceRows.map(
          (payload) => datasetIdentity(payload, "source").id,
        ),
        referenced_true_source_keys: referencedTrueSourceRows.map((payload) => {
          const identity = datasetIdentity(payload, "source");
          return { id: identity.id, version: identity.version || "00.00.001" };
        }),
      },
      canonical_support: {
        canonical_unit_group_reference_keys: canonicalUnitGroupProofKeys,
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
  };
}
