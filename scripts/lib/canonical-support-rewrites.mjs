import fs from "node:fs";
import path from "node:path";

export function createCanonicalSupportRewriteUtils({
  asText,
  booleanOption,
  cloneJson,
  datasetIdentity,
  datasetRowsFileStem,
  ensureArray,
  fileExists,
  multiLang,
  nowIso,
  pathExpression,
  readJson,
  readRowsFile,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeJsonLines,
}) {
  const defaultCanonicalSupportCacheFile =
    "specs/canonical-support/flow-properties-unit-groups.json";

  function supportText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) {
      return value.map(supportText).filter(Boolean).join(" | ");
    }
    if (typeof value === "object") {
      if (typeof value["#text"] === "string") return value["#text"].trim();
      return Object.values(value).map(supportText).filter(Boolean).join(" | ");
    }
    return "";
  }

  function normalizeSupportKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\u00b2/gu, "2")
      .replace(/\u00b3/gu, "3")
      .replace(/\u00b5/gu, "u")
      .replace(/[\u00b7\u2219]/gu, "*")
      .replace(/\s+/gu, "")
      .replace(/\./gu, "");
  }

  function canonicalSupportCachePath(options = {}) {
    return resolveRepoPath(
      options.canonicalSupportCache ||
        options.supportCache ||
        options.cacheFile ||
        defaultCanonicalSupportCacheFile,
    );
  }

  function flowPropertyReferenceText(reference) {
    return supportText(
      reference?.["common:shortDescription"] ?? reference?.shortDescription ?? reference?.name,
    );
  }

  function unitFromFlowPropertyReference(reference) {
    const text = flowPropertyReferenceText(reference);
    const match = text.match(/^amount\s+in\s+(.+)$/iu);
    return match ? match[1].trim() : text;
  }

  function buildCanonicalSupportIndex(cache) {
    const flowPropertyById = new Map();
    for (const row of ensureArray(cache?.flow_properties)) {
      const id = asText(row?.id);
      if (id) flowPropertyById.set(id, row);
    }
    const unitGroupById = new Map();
    for (const row of ensureArray(cache?.unit_groups)) {
      const id = asText(row?.id);
      if (id) unitGroupById.set(id, row);
    }
    const flowPropertyMappingByUnit = new Map();
    for (const mapping of ensureArray(cache?.flow_property_mappings)) {
      const canonicalId = asText(mapping?.canonical_flow_property_id);
      for (const unit of ensureArray(mapping?.source_units)) {
        const key = normalizeSupportKey(unit);
        if (key) flowPropertyMappingByUnit.set(key, { ...mapping, canonicalId });
      }
    }
    return { flowPropertyById, flowPropertyMappingByUnit, unitGroupById };
  }

  function loadCanonicalSupportCache(options = {}) {
    const cachePath = canonicalSupportCachePath(options);
    if (!cachePath || !fileExists(cachePath)) {
      return { cache: null, cachePath, index: buildCanonicalSupportIndex(null) };
    }
    const cache = readJson(cachePath);
    return { cache, cachePath, index: buildCanonicalSupportIndex(cache) };
  }

  function canonicalFlowPropertyReference(entry, language = "en") {
    const id = asText(entry?.id);
    const version = asText(entry?.version);
    const rawShortDescription =
      supportText(entry?.reference_short_description) ||
      supportText(entry?.short_description) ||
      supportText(entry?.name) ||
      id;
    const shortDescription = rawShortDescription.split("|")[0].trim() || id;
    return {
      "@type": "flow property data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../flowproperties/${id}.json`,
      "common:shortDescription": multiLang(shortDescription, language),
    };
  }

  function canonicalFlowPropertyUnitGroupProof(entry, cacheContext) {
    const referenceUnitGroup = entry?.reference_unit_group ?? {};
    const unitGroupId = asText(
      referenceUnitGroup.id ??
        referenceUnitGroup.ref_object_id ??
        referenceUnitGroup["@refObjectId"],
    );
    const unitGroup = unitGroupId ? cacheContext.index.unitGroupById.get(unitGroupId) : null;
    const unitGroupVersion =
      asText(referenceUnitGroup.version ?? referenceUnitGroup["@version"]) ||
      asText(unitGroup?.version) ||
      null;
    const shortDescription =
      supportText(referenceUnitGroup.short_description) ||
      supportText(referenceUnitGroup["common:shortDescription"]) ||
      supportText(unitGroup?.short_description) ||
      supportText(unitGroup?.name) ||
      null;
    return {
      proven: Boolean(unitGroupId && unitGroup),
      ref_object_id: unitGroupId || null,
      version: unitGroupVersion,
      short_description: shortDescription,
    };
  }

  function rewriteCanonicalFlowPropertyReferences(
    value,
    {
      cacheContext,
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      blockers,
      datasetIdentityCache,
      rowIndex = null,
      language = "en",
      pathSegments = [],
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteCanonicalFlowPropertyReferences(item, {
          cacheContext,
          datasetType,
          sourceFile,
          stats,
          rewriteRows,
          blockers,
          datasetIdentityCache,
          rowIndex,
          language,
          pathSegments: [...pathSegments, index],
        }),
      );
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathSegments, key];
      if (
        key === "referenceToFlowPropertyDataSet" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const originalId = asText(child["@refObjectId"]);
        const originalVersion = asText(child["@version"]);
        const unit = unitFromFlowPropertyReference(child);
        const normalizedUnit = normalizeSupportKey(unit);
        const alreadyCanonical = originalId && cacheContext.index.flowPropertyById.has(originalId);
        const mapping = cacheContext.index.flowPropertyMappingByUnit.get(normalizedUnit);
        const canonical = mapping
          ? cacheContext.index.flowPropertyById.get(mapping.canonicalId)
          : null;
        const provenCanonical = alreadyCanonical
          ? cacheContext.index.flowPropertyById.get(originalId)
          : canonical;
        const unitGroupProof = provenCanonical
          ? canonicalFlowPropertyUnitGroupProof(provenCanonical, cacheContext)
          : null;
        if (provenCanonical && !unitGroupProof?.proven) {
          blockers.push({
            code: "canonical_flow_property_unit_group_unproven",
            message:
              "The selected canonical Flow Property must prove its Reference Unit Group through the local canonical support cache. Foundry must not create account-local Unit Group support rows.",
            dataset_type: datasetType,
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(childPath),
            source_unit: unit || null,
            original_ref_object_id: originalId || null,
            canonical_flow_property_id: asText(provenCanonical.id) || null,
            canonical_reference_unit_group_id: unitGroupProof?.ref_object_id ?? null,
            required_resolution:
              "Refresh specs/canonical-support/flow-properties-unit-groups.json from the database or select a canonical Flow Property whose Reference Unit Group is present in that cache.",
          });
          continue;
        }
        if (!alreadyCanonical && canonical) {
          const next = canonicalFlowPropertyReference(canonical, language);
          value[key] = next;
          stats.canonical_flow_property_reference_rewrites += 1;
          stats.canonical_unit_group_reference_proofs += 1;
          rewriteRows.push({
            relation: "flow_property_reference_to_canonical_support",
            dataset_type: datasetType,
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(childPath),
            source_unit: unit,
            original: {
              ref_object_id: originalId || null,
              version: originalVersion || null,
              short_description: flowPropertyReferenceText(child) || null,
            },
            canonical: {
              ref_object_id: next["@refObjectId"],
              version: next["@version"],
              short_description: next["common:shortDescription"]["#text"],
            },
            canonical_reference_unit_group: unitGroupProof,
            mapping_reason: mapping.reason ?? null,
            legacy_support_note: mapping.legacy_support_note ?? null,
          });
        } else if (!alreadyCanonical) {
          blockers.push({
            code: "canonical_flow_property_reference_unresolved",
            message:
              "Flow property references must point to an existing canonical database row; Foundry must not write account-local flowproperty/unitgroup support rows.",
            dataset_type: datasetType,
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(childPath),
            source_unit: unit || null,
            original_ref_object_id: originalId || null,
            original_version: originalVersion || null,
            required_resolution:
              "Add or select a public canonical flow property mapping in the support cache, or block the import until the platform has the required canonical support row.",
          });
        }
        continue;
      }
      rewriteCanonicalFlowPropertyReferences(child, {
        cacheContext,
        datasetType,
        sourceFile,
        stats,
        rewriteRows,
        blockers,
        datasetIdentityCache,
        rowIndex,
        language,
        pathSegments: childPath,
      });
    }
  }

  function applyCanonicalSupportRewrites({ datasetType, rowsFile, outFile, outDir, options = {} }) {
    const resolvedOutDir =
      outDir || path.join(path.dirname(rowsFile), "canonical-support-rewrites");
    const resolvedOutFile =
      outFile ||
      path.join(
        resolvedOutDir,
        `${datasetRowsFileStem(datasetType)}.canonical-support-rewritten.jsonl`,
      );
    fs.mkdirSync(resolvedOutDir, { recursive: true });
    const cacheContext = loadCanonicalSupportCache(options);
    const rows = readRowsFile(rowsFile);
    const stats = {
      canonical_flow_property_reference_rewrites: 0,
      canonical_unit_group_reference_proofs: 0,
    };
    const rewriteRows = [];
    const blockers = [];
    const outputRows = rows.map((row, rowIndex) => {
      const next = cloneJson(row);
      rewriteCanonicalFlowPropertyReferences(next, {
        cacheContext,
        datasetType,
        sourceFile: rowsFile,
        stats,
        rewriteRows,
        blockers,
        datasetIdentityCache: datasetIdentity(next, datasetType),
        rowIndex,
        language: asText(options.language || options.lang || "en") || "en",
      });
      return next;
    });
    const deferBlockedRows =
      datasetType === "flow" &&
      blockers.length > 0 &&
      booleanOption(
        options.deferBlockedCanonicalSupportRows ||
          options.deferCanonicalSupportBlockedRows ||
          options.deferBlockedSupportRows,
      );
    const blockedRowIndexes = new Set(
      blockers
        .map((blocker) => Number(blocker.row_index))
        .filter((rowIndex) => Number.isInteger(rowIndex) && rowIndex >= 0),
    );
    const writeOutputRows = deferBlockedRows
      ? outputRows.filter((_, rowIndex) => !blockedRowIndexes.has(rowIndex))
      : outputRows;
    const deferredRows = deferBlockedRows
      ? outputRows.filter((_, rowIndex) => blockedRowIndexes.has(rowIndex))
      : [];

    const rewritesFile = path.join(resolvedOutDir, "canonical-support-rewrites.jsonl");
    const blockersFile = path.join(resolvedOutDir, "canonical-support-blockers.jsonl");
    const reportFile = path.join(resolvedOutDir, "canonical-support-rewrite-report.json");
    const deferredRowsFile = path.join(
      resolvedOutDir,
      `${datasetRowsFileStem(datasetType)}.canonical-support-deferred.jsonl`,
    );
    writeJsonLines(resolvedOutFile, writeOutputRows);
    writeJsonLines(deferredRowsFile, deferredRows);
    writeJsonLines(rewritesFile, rewriteRows);
    writeJsonLines(blockersFile, blockers);
    const hardBlockers = deferBlockedRows ? [] : blockers;
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: "dataset-canonical-support-rewrites-apply",
      stage: "canonical_support_rewrites",
      status: deferBlockedRows
        ? "completed_with_deferred_rows"
        : blockers.length > 0
          ? "blocked"
          : rewriteRows.length > 0
            ? "completed"
            : "completed_no_rewrites",
      dataset_type: datasetType,
      remote_write_mode: "read-only",
      rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(resolvedOutFile),
      policy: {
        reference_only_support:
          "Flow Properties and Unit Groups are reference-only support data for Foundry imports. Finalize must rewrite converted package-local flow property references to existing canonical database rows, or block before dry-run/remote write planning.",
        no_account_local_support_rows:
          "Foundry must not create account-local My Data rows for flowproperties or unitgroups.",
      },
      counts: {
        input_rows: rows.length,
        output_rows: writeOutputRows.length,
        deferred_rows: deferredRows.length,
        canonical_flow_property_reference_rewrites:
          stats.canonical_flow_property_reference_rewrites,
        canonical_unit_group_reference_proofs: stats.canonical_unit_group_reference_proofs,
        blockers: hardBlockers.length,
        deferred_blockers: deferBlockedRows ? blockers.length : 0,
      },
      files: {
        report: repoRelativePath(reportFile),
        output_rows: repoRelativePath(resolvedOutFile),
        deferred_rows: deferredRows.length > 0 ? repoRelativePath(deferredRowsFile) : null,
        canonical_support_rewrites: repoRelativePath(rewritesFile),
        canonical_support_blockers: repoRelativePath(blockersFile),
        canonical_support_cache: repoRelativeMaybe(cacheContext.cachePath),
      },
      blockers: hardBlockers,
      deferred_blockers: deferBlockedRows ? blockers : [],
    };
    writeJson(reportFile, report);
    return report;
  }

  return {
    applyCanonicalSupportRewrites,
    loadCanonicalSupportCache,
    rewriteCanonicalFlowPropertyReferences,
    supportText,
  };
}
