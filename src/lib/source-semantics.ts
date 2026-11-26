import {
  createSourceProfileFallbackUtils,
  normalizeDoiText,
  type MutableStats,
  type ProcessSourceReferenceRow,
  type SourceMetadata,
  type SourceSemanticDependencies,
  type SourceSummary,
  type UnknownRecord,
} from "./source-semantics-profile-fallbacks.ts";
import { createSourceReferenceRewriteUtils } from "./source-semantics-reference-rewrites.ts";

export type { ProcessSourceReferenceRow, SourceMetadata, SourceSemanticDependencies };

export function createSourceSemanticUtils({
  asText,
  bundleClassificationPath,
  cloneJson,
  datasetIdentity,
  deterministicUuid,
  languageForText,
  multiLang,
  pathExpression,
  repoRelativeMaybe,
  textValue,
}: SourceSemanticDependencies) {
  const fallbacks = createSourceProfileFallbackUtils({
    asText,
    cloneJson,
    deterministicUuid,
    multiLang,
    textValue,
  });
  const rewrites = createSourceReferenceRewriteUtils({
    asText,
    cloneJson,
    datasetIdentity,
    languageForText,
    multiLang,
    pathExpression,
    repoRelativeMaybe,
    textValue,
    canonicalSourceReferenceForRelation: fallbacks.canonicalSourceReferenceForRelation,
    canonicalSourceReferenceForSourceKind: fallbacks.canonicalSourceReferenceForSourceKind,
    sourceReferenceFromSummary: fallbacks.sourceReferenceFromSummary,
    sourceReferenceKind: fallbacks.sourceReferenceKind,
    sourceReferenceSnapshot: fallbacks.sourceReferenceSnapshot,
  });

  function sourceDataSetInformation(payload: unknown): UnknownRecord {
    const payloadRecord = payload as UnknownRecord | null | undefined;
    const sourceDataSet = payloadRecord?.sourceDataSet as UnknownRecord | undefined;
    const sourceInformation = sourceDataSet?.sourceInformation as UnknownRecord | undefined;
    const dataSetInformation = sourceInformation?.dataSetInformation;
    return dataSetInformation && typeof dataSetInformation === "object"
      ? (dataSetInformation as UnknownRecord)
      : {};
  }

  function sourceShortName(payload: unknown) {
    const dataSetInformation = sourceDataSetInformation(payload);
    return (
      textValue(dataSetInformation["common:shortName"]) ||
      textValue(dataSetInformation.shortName) ||
      textValue(dataSetInformation.name)
    );
  }

  function sourceCitationText(payload: unknown) {
    const dataSetInformation = sourceDataSetInformation(payload);
    return textValue(dataSetInformation.sourceCitation);
  }

  function sourceDescriptionText(payload: unknown) {
    const dataSetInformation = sourceDataSetInformation(payload);
    return textValue(dataSetInformation.sourceDescriptionOrComment);
  }

  function isBareSourceDescriptionText(value: unknown) {
    const text = asText(value).trim();
    return text === "" || /^(Report|Publication|Source)$/iu.test(text);
  }

  function isGenericEcoSpoldCompatibilitySourceText(value: unknown) {
    return /^Created for EcoSpold 1 compatibility$/iu.test(asText(value));
  }

  function isPlaceholderSourceIdentityText(value: unknown) {
    return /^(Not specified|Not declared|Unspecified)$/iu.test(asText(value));
  }

  function sourceMetadataFromDescription(description: unknown): SourceMetadata | null {
    const text = asText(description).replace(/\\n/gu, "\n");
    if (!text) return null;
    const originalTitle = text.match(/^Original title:\s*(.+)$/imu)?.[1]?.trim();
    const year = text.match(/^Year:\s*(\d{4})$/imu)?.[1] ?? text.match(/\((\d{4})\)/u)?.[1] ?? null;
    const firstAuthor =
      text.match(/^First author:\s*(.+)$/imu)?.[1]?.trim() ??
      text.match(/^([^(\n]+?)\s*\(\d{4}\)/u)?.[1]?.trim() ??
      null;
    const title =
      originalTitle ?? text.match(/\(\d{4}\)\s*([^.\n]+(?:\.[^.\n]+)*)/u)?.[1]?.trim() ?? null;
    if (!title || !year) return null;
    const firstAuthorLastName =
      firstAuthor?.split(",")[0]?.trim() || firstAuthor?.split(/\s+/u)[0] || null;
    const shortName = [year, title, firstAuthorLastName].filter(Boolean).join(" - ");
    const firstLine = text.split(/\r?\n/u)[0]?.trim();
    return {
      shortName,
      citation:
        firstLine && !isGenericEcoSpoldCompatibilitySourceText(firstLine) ? firstLine : shortName,
    };
  }

  function normalizeDoi(value: unknown) {
    return normalizeDoiText(asText, value);
  }

  function cleanOriginalSourceText(value: unknown) {
    return asText(value)
      .replace(/\s+/gu, " ")
      .replace(/\s*UUID:\s*[0-9a-f-]{36}\b.*$/iu, "")
      .replace(/\s*$/u, "")
      .trim();
  }

  function processSourceContextTexts(payload: unknown) {
    const payloadRecord = payload as UnknownRecord | null | undefined;
    const process = (payloadRecord?.processDataSet ?? payload) as UnknownRecord | null | undefined;
    const processInformation = process?.processInformation as UnknownRecord | undefined;
    const dataSetInformation = (processInformation?.dataSetInformation ?? {}) as UnknownRecord;
    const modellingAndValidation = process?.modellingAndValidation as UnknownRecord | undefined;
    const treatment = (modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness ??
      {}) as UnknownRecord;
    const technology = processInformation?.technology as UnknownRecord | undefined;
    return [
      textValue(dataSetInformation["common:generalComment"]),
      textValue(technology?.technologyDescriptionAndIncludedProcesses),
      textValue(treatment.dataCutOffAndCompletenessPrinciples),
      textValue(treatment.useAdviceForDataSet),
    ]
      .map(cleanOriginalSourceText)
      .filter((text) => text && !/^(Unspecified|Not specified|Not declared)$/iu.test(text));
  }

  function authorLastName(value: unknown) {
    const firstAuthor = asText(value)
      .split(/\s*(?:,| and )\s*/u)
      .find(Boolean);
    if (!firstAuthor) return "";
    const particles = new Set(["de", "del", "der", "di", "dos", "du", "la", "le", "van", "von"]);
    const tokens = firstAuthor
      .replace(/\b[A-Z]\./gu, "")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    if (tokens.length === 0) return "";
    const last = tokens[tokens.length - 1];
    if (particles.has(last.toLowerCase()) && tokens.length > 1) return tokens[tokens.length - 2];
    return last;
  }

  function originalSourceMetadataFromText(value: unknown): SourceMetadata | null {
    const text = cleanOriginalSourceText(value);
    if (!text) return null;
    const markerMatch = text.match(/Original source:\s*(.+)$/isu);
    const sourceText = cleanOriginalSourceText(markerMatch?.[1] ?? text);
    if (!markerMatch && !/\bdoi\s*:/iu.test(sourceText)) return null;
    const doi = normalizeDoi(sourceText);
    const withoutDoi = cleanOriginalSourceText(
      sourceText.replace(/\s*,?\s*doi\s*:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+/iu, ""),
    );
    const sourcePattern =
      /^(?<authors>.+),\s*(?<title>[^,]+),\s*(?<container>.+?)\s+(?<year>(?:19|20)\d{2})\s*(?<details>.*)$/u;
    const match = withoutDoi.match(sourcePattern);
    const year = match?.groups?.year ?? withoutDoi.match(/\b((?:19|20)\d{2})\b/u)?.[1] ?? "";
    const title = cleanOriginalSourceText(match?.groups?.title ?? "");
    const authors = cleanOriginalSourceText(match?.groups?.authors ?? "");
    const container = cleanOriginalSourceText(match?.groups?.container ?? "");
    const details = cleanOriginalSourceText(match?.groups?.details ?? "");
    if (!doi || !year || !title || !authors) return null;
    const firstAuthorLastName = authorLastName(authors);
    return {
      shortName: [year, title, firstAuthorLastName].filter(Boolean).join(" - "),
      citation: sourceText,
      description: [container || null, year || null, details || null, doi ? `DOI: ${doi}` : null]
        .filter(Boolean)
        .join("; "),
      doi,
      title,
      year,
      authors,
      container: container || null,
      details: details || null,
    };
  }

  function processOriginalSourceMetadata(payload: unknown) {
    for (const text of processSourceContextTexts(payload)) {
      const metadata = originalSourceMetadataFromText(text);
      if (metadata) return metadata;
    }
    return null;
  }

  function sourceSummaryMatchesOriginalMetadata(
    source: SourceSummary | null | undefined,
    metadata: SourceMetadata | null | undefined,
  ) {
    if (!source?.dataset_id || !metadata) return false;
    const haystack = [
      source.short_name,
      source.source_citation,
      source.source_description,
      source.classification_path,
    ]
      .map(asText)
      .join(" ")
      .toLowerCase();
    const doi = normalizeDoi(metadata.doi).toLowerCase();
    if (doi && haystack.includes(doi)) return true;
    const title = asText(metadata.title).toLowerCase();
    return Boolean(title && haystack.includes(title));
  }

  function repairTrueSourceIdentity(
    payload: unknown,
    {
      sourceFile,
      stats,
      repairRows,
    }: { sourceFile: unknown; stats: MutableStats; repairRows: UnknownRecord[] },
  ) {
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

  function repairTrueSourceDescription(
    payload: unknown,
    {
      sourceFile,
      stats,
      repairRows,
    }: { sourceFile: unknown; stats: MutableStats; repairRows: UnknownRecord[] },
  ) {
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
    dataSetInformation.sourceDescriptionOrComment = multiLang(repairedDescription, "en");
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

  function sourceSemanticKind(payload: unknown) {
    // A reference to a known public canonical support source — the ILCD format spec
    // (a97a0155) or the ILCD Data Network compliance system (d92a1a12) — IS that canonical
    // dataset by identity, regardless of how a converted package classifies or names it.
    // Some packages (e.g. USLCI) ship "ILCD format" classified as "Publications and
    // communications" or list it under referenceToDataSource; without this it reads as a
    // placeholder/true_source and is minted at the package version instead of reused, which
    // trips the source-identity prewrite gate and would version_outdated against the
    // published canonical. Recognize it by UUID so the canonical reference rewrite and the
    // reference-only write exclusion both fire (matching its classified-as-format peers).
    const canonicalSupportKind = fallbacks.canonicalSupportSourceKindForId(
      datasetIdentity(payload, "source")?.id,
    );
    if (canonicalSupportKind) return canonicalSupportKind;
    const classificationPath = bundleClassificationPath(payload, "source");
    const classification = classificationPath.toLowerCase();
    const citation = sourceCitationText(payload);
    const shortNameText = sourceShortName(payload);
    const shortName = shortNameText.toLowerCase();
    if (classification.includes("data set formats")) return "format_support_source";
    if (classification.includes("compliance systems")) return "compliance_support_source";
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

  function repairTrueSourceClassification(
    payload: unknown,
    {
      sourceFile,
      stats,
      repairRows,
    }: { sourceFile: unknown; stats: MutableStats; repairRows: UnknownRecord[] },
  ) {
    if (sourceSemanticKind(payload) !== "true_source") return;
    const currentClassification = bundleClassificationPath(payload, "source");
    if (currentClassification && !/^Other source types$/iu.test(currentClassification)) {
      return;
    }
    const dataSetInformation = sourceDataSetInformation(payload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return;
    const classificationInformation = (dataSetInformation.classificationInformation ??=
      {}) as UnknownRecord;
    const classification = (classificationInformation["common:classification"] ??=
      {}) as UnknownRecord;
    classification["common:class"] = {
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

  function sourceSemanticSummary(payload: unknown, sourceFile: unknown) {
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

  return {
    buildBafuFallbackSourcePayload: fallbacks.buildBafuFallbackSourcePayload,
    buildDatabaseFallbackSourcePayload: fallbacks.buildDatabaseFallbackSourcePayload,
    buildBafuProcessContextSourcePayload: fallbacks.buildBafuProcessContextSourcePayload,
    canonicalSourceReferenceForRelation: fallbacks.canonicalSourceReferenceForRelation,
    processSourceReferenceRows: rewrites.processSourceReferenceRows,
    processOriginalSourceMetadata,
    repairTrueSourceClassification,
    repairTrueSourceDescription,
    repairTrueSourceIdentity,
    rewriteCanonicalSourceReferences: rewrites.rewriteCanonicalSourceReferences,
    rewriteProcessDataSourceReferences: rewrites.rewriteProcessDataSourceReferences,
    rewriteTrueSourceReferenceDescriptions: rewrites.rewriteTrueSourceReferenceDescriptions,
    sourceReferenceSemanticBlockers: rewrites.sourceReferenceSemanticBlockers,
    sourceReferenceSnapshot: fallbacks.sourceReferenceSnapshot,
    sourceSummaryMatchesOriginalMetadata,
    sourceSemanticSummary,
  };
}
