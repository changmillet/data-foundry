export function createSourceSemanticUtils({
  asText,
  bundleClassificationPath,
  cloneJson,
  datasetIdentity,
  languageForText,
  multiLang,
  pathExpression,
  repoRelativeMaybe,
  textValue,
}) {
function sourceDataSetInformation(payload) {
  return payload?.sourceDataSet?.sourceInformation?.dataSetInformation &&
    typeof payload.sourceDataSet.sourceInformation.dataSetInformation ===
      "object"
    ? payload.sourceDataSet.sourceInformation.dataSetInformation
    : {};
}

function sourceShortName(payload) {
  const dataSetInformation = sourceDataSetInformation(payload);
  return (
    textValue(dataSetInformation["common:shortName"]) ||
    textValue(dataSetInformation.shortName) ||
    textValue(dataSetInformation.name)
  );
}

function sourceCitationText(payload) {
  const dataSetInformation = sourceDataSetInformation(payload);
  return textValue(dataSetInformation.sourceCitation);
}

function sourceDescriptionText(payload) {
  const dataSetInformation = sourceDataSetInformation(payload);
  return textValue(dataSetInformation.sourceDescriptionOrComment);
}

function isBareSourceDescriptionText(value) {
  const text = asText(value).trim();
  return text === "" || /^(Report|Publication|Source)$/iu.test(text);
}

function isGenericEcoSpoldCompatibilitySourceText(value) {
  return /^Created for EcoSpold 1 compatibility$/iu.test(asText(value));
}

function isPlaceholderSourceIdentityText(value) {
  return /^(Not specified|Not declared|Unspecified)$/iu.test(asText(value));
}

function sourceMetadataFromDescription(description) {
  const text = asText(description).replace(/\\n/gu, "\n");
  if (!text) return null;
  const originalTitle = text.match(/^Original title:\s*(.+)$/imu)?.[1]?.trim();
  const year =
    text.match(/^Year:\s*(\d{4})$/imu)?.[1] ??
    text.match(/\((\d{4})\)/u)?.[1] ??
    null;
  const firstAuthor =
    text.match(/^First author:\s*(.+)$/imu)?.[1]?.trim() ??
    text.match(/^([^(\n]+?)\s*\(\d{4}\)/u)?.[1]?.trim() ??
    null;
  const title =
    originalTitle ??
    text.match(/\(\d{4}\)\s*([^.\n]+(?:\.[^.\n]+)*)/u)?.[1]?.trim() ??
    null;
  if (!title || !year) return null;
  const firstAuthorLastName =
    firstAuthor?.split(",")[0]?.trim() || firstAuthor?.split(/\s+/u)[0] || null;
  const shortName = [
    year,
    title,
    firstAuthorLastName,
  ]
    .filter(Boolean)
    .join(" - ");
  const firstLine = text.split(/\r?\n/u)[0]?.trim();
  return {
    shortName,
    citation:
      firstLine && !isGenericEcoSpoldCompatibilitySourceText(firstLine)
        ? firstLine
        : shortName,
  };
}

function repairTrueSourceIdentity(payload, { sourceFile, stats, repairRows }) {
  if (sourceSemanticKind(payload) !== "true_source") return;
  const dataSetInformation = sourceDataSetInformation(payload);
  if (!dataSetInformation || typeof dataSetInformation !== "object") return;
  const originalShortName = sourceShortName(payload);
  const originalCitation = sourceCitationText(payload);
  if (
    !isGenericEcoSpoldCompatibilitySourceText(originalShortName) &&
    !isGenericEcoSpoldCompatibilitySourceText(originalCitation)
  ) {
    return;
  }
  const repaired = sourceMetadataFromDescription(sourceDescriptionText(payload));
  if (!repaired?.shortName) return;
  dataSetInformation["common:shortName"] = multiLang(repaired.shortName, "en");
  dataSetInformation.sourceCitation = repaired.citation;
  const identity = datasetIdentity(payload, "source");
  stats.true_source_identity_repairs += 1;
  repairRows.push({
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    relation: "true_source_identity_from_description",
    original_short_name: originalShortName || null,
    original_source_citation: originalCitation || null,
    repaired_short_name: repaired.shortName,
    repaired_source_citation: repaired.citation,
    basis:
      "Converted EcoSpold compatibility source name was generic; sourceDescriptionOrComment contains report metadata with title, year, and author.",
  });
}

function repairTrueSourceDescription(payload, { sourceFile, stats, repairRows }) {
  if (sourceSemanticKind(payload) !== "true_source") return;
  const dataSetInformation = sourceDataSetInformation(payload);
  if (!dataSetInformation || typeof dataSetInformation !== "object") return;
  const originalDescription = sourceDescriptionText(payload);
  if (!isBareSourceDescriptionText(originalDescription)) return;
  const citation = sourceCitationText(payload);
  const shortName = sourceShortName(payload);
  const evidence = citation || shortName;
  if (!evidence) return;
  const repairedDescription = `Report/publication: ${evidence}.`;
  dataSetInformation.sourceDescriptionOrComment = multiLang(
    repairedDescription,
    "en",
  );
  const identity = datasetIdentity(payload, "source");
  stats.true_source_description_repairs += 1;
  repairRows.push({
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    relation: "true_source_description_from_citation",
    original_description: originalDescription || null,
    repaired_description: repairedDescription,
    basis:
      "Converted sourceDescriptionOrComment was empty or only a generic type word; citation/shortName identifies the report or publication source.",
  });
}

function sourceSemanticKind(payload) {
  const classificationPath = bundleClassificationPath(payload, "source");
  const classification = classificationPath.toLowerCase();
  const citation = sourceCitationText(payload);
  const shortNameText = sourceShortName(payload);
  const shortName = shortNameText.toLowerCase();
  if (classification.includes("data set formats"))
    return "format_support_source";
  if (classification.includes("compliance systems"))
    return "compliance_support_source";
  if (
    isPlaceholderSourceIdentityText(shortNameText) ||
    isPlaceholderSourceIdentityText(citation)
  ) {
    return "placeholder_or_unspecified_source";
  }
  if (
    isGenericEcoSpoldCompatibilitySourceText(shortNameText) ||
    isGenericEcoSpoldCompatibilitySourceText(citation)
  ) {
    const repaired = sourceMetadataFromDescription(sourceDescriptionText(payload));
    return repaired?.shortName ? "true_source" : "unresolved_source_semantics";
  }
  if (citation) return "true_source";
  if (
    shortName.includes("not specified") ||
    shortName.includes("not declared") ||
    shortName === "unspecified"
  ) {
    return "placeholder_or_unspecified_source";
  }
  return "unresolved_source_semantics";
}

function repairTrueSourceClassification(payload, { sourceFile, stats, repairRows }) {
  if (sourceSemanticKind(payload) !== "true_source") return;
  const currentClassification = bundleClassificationPath(payload, "source");
  if (
    currentClassification &&
    !/^Other source types$/iu.test(currentClassification)
  ) {
    return;
  }
  const dataSetInformation = sourceDataSetInformation(payload);
  if (!dataSetInformation || typeof dataSetInformation !== "object") return;
  dataSetInformation.classificationInformation ??= {};
  dataSetInformation.classificationInformation["common:classification"] ??= {};
  dataSetInformation.classificationInformation["common:classification"][
    "common:class"
  ] = {
    "@level": "0",
    "@classId": "5",
    "#text": "Publications and communications",
  };
  const identity = datasetIdentity(payload, "source");
  const alreadyReported = repairRows.some(
    (row) =>
      row.dataset_id === identity.id &&
      row.dataset_version === identity.version &&
      row.relation === "true_source_publication_classification",
  );
  if (alreadyReported) return;
  stats.true_source_classification_repairs += 1;
  repairRows.push({
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    relation: "true_source_publication_classification",
    original_classification: currentClassification || null,
    repaired_classification: "Publications and communications",
    basis:
      "sourceCitation is present and the converted source category was generic Other source types.",
  });
}

function sourceSemanticSummary(payload, sourceFile) {
  const identity = datasetIdentity(payload, "source");
  const kind = sourceSemanticKind(payload);
  return {
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    kind,
    materialized_as_source_row: kind === "true_source",
    short_name: sourceShortName(payload),
    source_citation: sourceCitationText(payload) || null,
    source_description: sourceDescriptionText(payload) || null,
    classification_path: bundleClassificationPath(payload, "source") || null,
  };
}

function sourceReferenceKind(pathSegments) {
  const pathText = pathSegments.join(".");
  if (pathText.includes("referenceToDataSource")) return "process_data_source";
  if (pathText.includes("referenceToDataSetFormat"))
    return "dataset_format_source";
  if (pathText.includes("referenceToComplianceSystem"))
    return "compliance_system_source";
  return "other_source_reference";
}

const canonicalSourceReferences = {
  dataset_format_source: {
    "@type": "source data set",
    "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    "@version": "03.00.003",
    "@uri":
      "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
    "common:shortDescription": multiLang("ILCD format", "en"),
  },
  compliance_system_source: {
    "@type": "source data set",
    "@refObjectId": "d92a1a12-2545-49e2-a585-55c259997756",
    "@version": "20.20.002",
    "@uri":
      "../sources/d92a1a12-2545-49e2-a585-55c259997756_20.20.002.xml",
    "common:shortDescription": multiLang(
      "ILCD Data Network - Entry-level",
      "en",
    ),
  },
};

function canonicalSourceReferenceForRelation(relation) {
  const reference = canonicalSourceReferences[relation];
  return reference ? cloneJson(reference) : null;
}

function sourceReferenceSnapshot(reference) {
  return {
    ref_object_id: asText(reference?.["@refObjectId"]) || null,
    version: asText(reference?.["@version"]) || null,
    uri: asText(reference?.["@uri"]) || null,
    short_description: textValue(reference?.["common:shortDescription"]) || null,
  };
}

function rewriteCanonicalSourceReferences(
  value,
  {
    datasetType,
    sourceFile,
    stats,
    rewriteRows,
    pathSegments = [],
    datasetIdentityCache = null,
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
      }),
    );
    return;
  }

  const relation = sourceReferenceKind(pathSegments);
  const canonical = canonicalSourceReferenceForRelation(relation);
  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (canonical && refObjectId && refType.includes("source")) {
    const before = sourceReferenceSnapshot(value);
    const after = sourceReferenceSnapshot(canonical);
    if (
      before.ref_object_id !== after.ref_object_id ||
      before.version !== after.version ||
      before.short_description !== after.short_description
    ) {
      const identity =
        datasetIdentityCache && datasetIdentityCache.id
          ? datasetIdentityCache
          : datasetIdentity(value, datasetType);
      stats.source_reference_rewrites += 1;
      rewriteRows.push({
        dataset_type: datasetType,
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        path: pathExpression(pathSegments),
        relation,
        original: before,
        canonical: after,
        reason:
          relation === "dataset_format_source"
            ? "Data set format uses the public canonical ILCD format source instead of a converted package-local support source."
            : "Compliance declaration uses the public canonical ILCD Data Network Entry-level source instead of a converted placeholder support source.",
      });
    }
    Object.keys(value).forEach((key) => {
      delete value[key];
    });
    Object.assign(value, cloneJson(canonical));
  }

  for (const [key, child] of Object.entries(value)) {
    rewriteCanonicalSourceReferences(child, {
      datasetType,
      sourceFile,
      stats,
      rewriteRows,
      pathSegments: [...pathSegments, key],
      datasetIdentityCache,
    });
  }
}

function rewriteTrueSourceReferenceDescriptions(
  value,
  {
    sourceLookup,
    sourceFile,
    stats,
    rewriteRows,
    pathSegments = [],
    datasetIdentityCache = null,
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

  const relation = sourceReferenceKind(pathSegments);
  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (
    relation === "process_data_source" &&
    refObjectId &&
    refType.includes("source")
  ) {
    const source = sourceLookup.get(refObjectId);
    const canonicalShortName = asText(source?.short_name);
    const currentShortName = textValue(value["common:shortDescription"]);
    if (
      source?.kind === "true_source" &&
      canonicalShortName &&
      currentShortName !== canonicalShortName
    ) {
      const before = sourceReferenceSnapshot(value);
      value["common:shortDescription"] = multiLang(
        canonicalShortName,
        languageForText(canonicalShortName),
      );
      const after = sourceReferenceSnapshot(value);
      stats.true_source_reference_description_repairs += 1;
      const identity = datasetIdentityCache && datasetIdentityCache.id
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

  for (const [key, child] of Object.entries(value)) {
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

function collectSourceReferences(value, pathSegments = [], refs = []) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectSourceReferences(item, [...pathSegments, index], refs),
    );
    return refs;
  }
  const refType = asText(value["@type"]).toLowerCase();
  const refObjectId = asText(value["@refObjectId"]);
  if (refObjectId && refType.includes("source")) {
    refs.push({
      path: pathExpression(pathSegments),
      relation: sourceReferenceKind(pathSegments),
      ref_object_id: refObjectId,
      version: asText(value["@version"]) || null,
      short_description: textValue(value["common:shortDescription"]) || null,
    });
  }
  for (const [key, child] of Object.entries(value)) {
    collectSourceReferences(child, [...pathSegments, key], refs);
  }
  return refs;
}

function processSourceReferenceRows(payload, sourceLookup, sourceFile) {
  if (!payload?.processDataSet) return [];
  const identity = datasetIdentity(payload, "process");
  return collectSourceReferences(payload.processDataSet).map((ref) => ({
    dataset_type: "process",
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    ...ref,
    referenced_source_kind: sourceLookup.get(ref.ref_object_id)?.kind ?? null,
    referenced_source_classification:
      sourceLookup.get(ref.ref_object_id)?.classification_path ?? null,
    referenced_source_citation:
      sourceLookup.get(ref.ref_object_id)?.source_citation ?? null,
  }));
}

function sourceReferenceSemanticBlockers(processSourceReferenceRows) {
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
  canonicalSourceReferenceForRelation,
  processSourceReferenceRows,
  repairTrueSourceClassification,
  repairTrueSourceDescription,
  repairTrueSourceIdentity,
  rewriteCanonicalSourceReferences,
  rewriteTrueSourceReferenceDescriptions,
  sourceReferenceSemanticBlockers,
  sourceReferenceSnapshot,
  sourceSemanticSummary,
};
}
