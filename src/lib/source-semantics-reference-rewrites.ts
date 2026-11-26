import type {
  DatasetIdentity,
  MutableStats,
  PathSegment,
  ProcessSourceReferenceRow,
  SourceLookup,
  SourceReference,
  SourceReferenceRow,
  SourceReferenceSnapshot,
  SourceSemanticDependencies,
  SourceSummary,
  UnknownRecord,
} from "./source-semantics-profile-fallbacks.ts";

export type SourceReferenceRewriteDependencies = Pick<
  SourceSemanticDependencies,
  | "asText"
  | "cloneJson"
  | "datasetIdentity"
  | "languageForText"
  | "multiLang"
  | "pathExpression"
  | "repoRelativeMaybe"
  | "textValue"
> & {
  canonicalSourceReferenceForRelation: (relation: string) => SourceReference | null;
  canonicalSourceReferenceForSourceKind: (kind: unknown) => SourceReference | null;
  sourceReferenceFromSummary: (
    source: SourceSummary | null | undefined,
    language?: unknown,
  ) => SourceReference | null;
  sourceReferenceKind: (pathSegments: PathSegment[]) => string;
  sourceReferenceSnapshot: (reference: unknown) => SourceReferenceSnapshot;
};

export function createSourceReferenceRewriteUtils({
  asText,
  cloneJson,
  datasetIdentity,
  languageForText,
  multiLang,
  pathExpression,
  repoRelativeMaybe,
  textValue,
  canonicalSourceReferenceForRelation,
  canonicalSourceReferenceForSourceKind,
  sourceReferenceFromSummary,
  sourceReferenceKind,
  sourceReferenceSnapshot,
}: SourceReferenceRewriteDependencies) {
  function rewriteCanonicalSourceReferences(
    value: unknown,
    {
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments = [],
      datasetIdentityCache = null,
      sourceLookup = null,
    }: {
      datasetType: string;
      sourceFile: unknown;
      stats: MutableStats;
      rewriteRows: UnknownRecord[];
      pathSegments?: PathSegment[];
      datasetIdentityCache?: DatasetIdentity | null;
      sourceLookup?: SourceLookup | null;
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteCanonicalSourceReferences(item, {
          datasetType,
          sourceFile,
          stats,
          rewriteRows,
          pathSegments: [...pathSegments, index],
          datasetIdentityCache,
          sourceLookup,
        }),
      );
      return;
    }

    const valueRecord = value as UnknownRecord;
    const relation = sourceReferenceKind(pathSegments);
    const refType = asText(valueRecord["@type"]).toLowerCase();
    const refObjectId = asText(valueRecord["@refObjectId"]);
    // The canonical target is fixed first by the reference path-relation (format /
    // compliance slots), then — for any other slot, e.g. referenceToCompleteReviewReport
    // — by the referenced source's own semantic KIND when a sourceLookup is supplied. A
    // format/compliance support source ("ILCD format"/"Data set formats",
    // "...compliance systems") is the same public canonical dataset wherever it is
    // referenced, so it must be rewritten on every path; a true source has no kind-based
    // canonical and is never touched here.
    let canonical = canonicalSourceReferenceForRelation(relation);
    // effectiveRelation records WHY the rewrite happened: a path-relation rewrite keeps
    // its slot relation; a kind-based rewrite on an otherwise-unmapped slot records the
    // referenced source's support kind so the rewrite row is traceable.
    let effectiveRelation = relation;
    let kindBasedRewrite = false;
    if (!canonical && sourceLookup && refObjectId && refType.includes("source")) {
      const referencedKind = sourceLookup.get(refObjectId)?.kind;
      canonical = canonicalSourceReferenceForSourceKind(referencedKind);
      if (canonical) {
        effectiveRelation = asText(referencedKind) || relation;
        kindBasedRewrite = true;
      }
    }
    if (canonical && refObjectId && refType.includes("source")) {
      const before = sourceReferenceSnapshot(valueRecord);
      const after = sourceReferenceSnapshot(canonical);
      if (
        before.ref_object_id !== after.ref_object_id ||
        before.version !== after.version ||
        before.short_description !== after.short_description
      ) {
        const identity =
          datasetIdentityCache && datasetIdentityCache.id
            ? datasetIdentityCache
            : datasetIdentity(valueRecord, datasetType);
        stats.source_reference_rewrites += 1;
        rewriteRows.push({
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(pathSegments),
          relation: effectiveRelation,
          original: before,
          canonical: after,
          reason: kindBasedRewrite
            ? "A format/compliance support source referenced outside its format/compliance slot (e.g. a review report reference) is rewritten to the same public canonical source it uses on its format/compliance slot, so reference closure proves it as a reusable public dataset."
            : relation === "dataset_format_source"
              ? "Data set format uses the public canonical ILCD format source instead of a converted package-local support source."
              : "Compliance declaration uses the public canonical ILCD Data Network Entry-level source instead of a converted placeholder support source.",
        });
      }
      Object.keys(valueRecord).forEach((key) => {
        delete valueRecord[key];
      });
      Object.assign(valueRecord, cloneJson(canonical));
    }

    for (const [key, child] of Object.entries(valueRecord)) {
      rewriteCanonicalSourceReferences(child, {
        datasetType,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, key],
        datasetIdentityCache,
        sourceLookup,
      });
    }
  }

  function rewriteTrueSourceReferenceDescriptions(
    value: unknown,
    {
      sourceLookup,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments = [],
      datasetIdentityCache = null,
    }: {
      sourceLookup: SourceLookup;
      sourceFile: unknown;
      stats: MutableStats;
      rewriteRows: UnknownRecord[];
      pathSegments?: PathSegment[];
      datasetIdentityCache?: DatasetIdentity | null;
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteTrueSourceReferenceDescriptions(item, {
          sourceLookup,
          sourceFile,
          stats,
          rewriteRows,
          pathSegments: [...pathSegments, index],
          datasetIdentityCache,
        }),
      );
      return;
    }

    const valueRecord = value as UnknownRecord;
    const relation = sourceReferenceKind(pathSegments);
    const refType = asText(valueRecord["@type"]).toLowerCase();
    const refObjectId = asText(valueRecord["@refObjectId"]);
    if (relation === "process_data_source" && refObjectId && refType.includes("source")) {
      const source = sourceLookup.get(refObjectId);
      const canonicalShortName = asText(source?.short_name);
      const currentShortName = textValue(valueRecord["common:shortDescription"]);
      if (
        source?.kind === "true_source" &&
        canonicalShortName &&
        currentShortName !== canonicalShortName
      ) {
        const before = sourceReferenceSnapshot(valueRecord);
        valueRecord["common:shortDescription"] = multiLang(
          canonicalShortName,
          languageForText(canonicalShortName),
        );
        const after = sourceReferenceSnapshot(valueRecord);
        stats.true_source_reference_description_repairs += 1;
        const identity =
          datasetIdentityCache && datasetIdentityCache.id
            ? datasetIdentityCache
            : { id: null, version: null };
        rewriteRows.push({
          dataset_type: "process",
          dataset_id: identity.id,
          dataset_version: identity.version,
          source_file: repoRelativeMaybe(sourceFile),
          path: pathExpression(pathSegments),
          relation: "process_data_source_short_description",
          original: before,
          canonical: after,
          reason:
            "Process data source reference shortDescription is synchronized to the curated true source row name.",
        });
      }
    }

    for (const [key, child] of Object.entries(valueRecord)) {
      rewriteTrueSourceReferenceDescriptions(child, {
        sourceLookup,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, key],
        datasetIdentityCache,
      });
    }
  }

  function rewriteProcessDataSourceReferences(
    value: unknown,
    {
      sourceLookup,
      replacementSource = null,
      forceReplacementSource = false,
      replacementRelation = null,
      replacementReason = null,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments = [],
      datasetIdentityCache = null,
      language = "en",
    }: {
      sourceLookup: SourceLookup;
      replacementSource?: SourceSummary | null;
      forceReplacementSource?: boolean;
      replacementRelation?: string | null;
      replacementReason?: string | null;
      sourceFile: unknown;
      stats: MutableStats;
      rewriteRows: UnknownRecord[];
      pathSegments?: PathSegment[];
      datasetIdentityCache?: DatasetIdentity | null;
      language?: unknown;
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteProcessDataSourceReferences(item, {
          sourceLookup,
          replacementSource,
          forceReplacementSource,
          replacementRelation,
          replacementReason,
          sourceFile,
          stats,
          rewriteRows,
          pathSegments: [...pathSegments, index],
          datasetIdentityCache,
          language,
        }),
      );
      return;
    }

    const valueRecord = value as UnknownRecord;
    const relation = sourceReferenceKind(pathSegments);
    const refType = asText(valueRecord["@type"]).toLowerCase();
    const refObjectId = asText(valueRecord["@refObjectId"]);
    if (relation === "process_data_source" && refObjectId && refType.includes("source")) {
      const referencedSource = sourceLookup.get(refObjectId);
      const currentShortName = textValue(valueRecord["common:shortDescription"]);
      let targetSource: SourceSummary | null = null;
      let rewriteRelation: string | null = null;
      let reason: string | null = null;

      if (forceReplacementSource && replacementSource?.dataset_id) {
        targetSource = replacementSource;
        rewriteRelation = replacementRelation || "process_data_source_context_source";
        reason =
          replacementReason ||
          "Process context identifies a more specific original report/publication source than the converted process data source reference.";
      } else if (referencedSource?.kind === "true_source") {
        const canonicalShortName = asText(referencedSource.short_name);
        if (canonicalShortName && currentShortName !== canonicalShortName) {
          targetSource = referencedSource;
          rewriteRelation = "process_data_source_short_description";
          reason =
            "Process data source reference shortDescription is synchronized to the curated true source row name.";
        }
      } else if (replacementSource?.dataset_id) {
        targetSource = replacementSource;
        rewriteRelation = replacementSource.fallback_database_source
          ? "process_data_source_fallback_database"
          : "process_data_source_true_source";
        reason = replacementSource.fallback_database_source
          ? "Converted process data source pointed to a non-source support placeholder and no unambiguous process-specific report/publication source was available; the reference is rewritten to the imported package's database-level fallback source."
          : "Converted process data source pointed to a non-source support placeholder; the bundle contains one unambiguous true source, so the reference is rewritten to that curated source row.";
      }

      const canonical = sourceReferenceFromSummary(targetSource, language);
      if (canonical && targetSource) {
        const before = sourceReferenceSnapshot(valueRecord);
        const after = sourceReferenceSnapshot(canonical);
        if (
          before.ref_object_id !== after.ref_object_id ||
          before.version !== after.version ||
          before.short_description !== after.short_description
        ) {
          Object.keys(valueRecord).forEach((key) => {
            delete valueRecord[key];
          });
          Object.assign(valueRecord, cloneJson(canonical));
          const identity =
            datasetIdentityCache && datasetIdentityCache.id
              ? datasetIdentityCache
              : { id: null, version: null };
          if (rewriteRelation === "process_data_source_short_description") {
            stats.true_source_reference_description_repairs += 1;
          } else {
            stats.process_source_reference_rewrites =
              Number(stats.process_source_reference_rewrites ?? 0) + 1;
            if (rewriteRelation === "process_data_source_context_source") {
              stats.process_source_context_rewrites =
                Number(stats.process_source_context_rewrites ?? 0) + 1;
            }
            if (targetSource.fallback_database_source) {
              stats.process_source_reference_fallback_rewrites =
                Number(stats.process_source_reference_fallback_rewrites ?? 0) + 1;
            }
          }
          rewriteRows.push({
            dataset_type: "process",
            dataset_id: identity.id,
            dataset_version: identity.version,
            source_file: repoRelativeMaybe(sourceFile),
            path: pathExpression(pathSegments),
            relation: rewriteRelation,
            original: before,
            canonical: after,
            referenced_source_kind: referencedSource?.kind ?? null,
            replacement_source_kind: targetSource.kind ?? null,
            reason,
          });
        }
      }
    }

    for (const [key, child] of Object.entries(valueRecord)) {
      rewriteProcessDataSourceReferences(child, {
        sourceLookup,
        replacementSource,
        forceReplacementSource,
        replacementRelation,
        replacementReason,
        sourceFile,
        stats,
        rewriteRows,
        pathSegments: [...pathSegments, key],
        datasetIdentityCache,
        language,
      });
    }
  }

  function collectSourceReferences(
    value: unknown,
    pathSegments: PathSegment[] = [],
    refs: SourceReferenceRow[] = [],
  ) {
    if (!value || typeof value !== "object") return refs;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectSourceReferences(item, [...pathSegments, index], refs));
      return refs;
    }
    const valueRecord = value as UnknownRecord;
    const refType = asText(valueRecord["@type"]).toLowerCase();
    const refObjectId = asText(valueRecord["@refObjectId"]);
    if (refObjectId && refType.includes("source")) {
      refs.push({
        path: pathExpression(pathSegments),
        relation: sourceReferenceKind(pathSegments),
        ref_object_id: refObjectId,
        version: asText(valueRecord["@version"]) || null,
        short_description: textValue(valueRecord["common:shortDescription"]) || null,
      });
    }
    for (const [key, child] of Object.entries(valueRecord)) {
      collectSourceReferences(child, [...pathSegments, key], refs);
    }
    return refs;
  }

  function processSourceReferenceRows(
    payload: unknown,
    sourceLookup: SourceLookup,
    sourceFile: unknown,
  ): ProcessSourceReferenceRow[] {
    const payloadRecord = payload as UnknownRecord | null | undefined;
    if (!payloadRecord?.processDataSet) return [];
    const identity = datasetIdentity(payload, "process");
    return collectSourceReferences(payloadRecord.processDataSet).map((ref) => ({
      dataset_type: "process",
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      ...ref,
      referenced_source_kind: sourceLookup.get(ref.ref_object_id)?.kind ?? null,
      referenced_source_classification:
        sourceLookup.get(ref.ref_object_id)?.classification_path ?? null,
      referenced_source_citation: sourceLookup.get(ref.ref_object_id)?.source_citation ?? null,
    }));
  }

  function sourceReferenceSemanticBlockers(
    processSourceReferenceRows: ProcessSourceReferenceRow[],
  ) {
    return processSourceReferenceRows
      .filter(
        (row) =>
          row.relation === "process_data_source" &&
          row.referenced_source_kind &&
          row.referenced_source_kind !== "true_source",
      )
      .map((row) => ({
        code: "process_data_source_not_true_source",
        message:
          "Process referenceToDataSource must point to a true report/publication/source row, not a format or compliance support source.",
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        ref_object_id: row.ref_object_id,
        referenced_source_kind: row.referenced_source_kind,
        referenced_source_classification: row.referenced_source_classification,
        source_file: row.source_file,
        path: row.path,
      }));
  }

  return {
    rewriteCanonicalSourceReferences,
    rewriteTrueSourceReferenceDescriptions,
    rewriteProcessDataSourceReferences,
    collectSourceReferences,
    processSourceReferenceRows,
    sourceReferenceSemanticBlockers,
  };
}
