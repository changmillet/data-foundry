export type SourceSemanticDependencies = {
  asText: (value: unknown) => string;
  bundleClassificationPath: (payload: unknown, type: string) => string;
  cloneJson: <T>(value: T) => T;
  datasetIdentity: (payload: unknown, type: string) => DatasetIdentity;
  deterministicUuid: (seed: string) => string;
  languageForText: (text: unknown, fallback?: unknown) => string;
  multiLang: (text: unknown, language?: unknown) => UnknownRecord;
  pathExpression: (parts: PathSegment[]) => string;
  repoRelativeMaybe: (value: unknown) => unknown;
  textValue: (value: unknown) => string;
};

export type UnknownRecord = Record<string, unknown>;
export type PathSegment = string | number;
export type DatasetIdentity = { id: string | null; version: string | null };
export type MutableStats = Record<string, number>;

export type SourceMetadata = {
  shortName: string;
  citation: string;
  description?: string;
  doi?: string;
  title?: string;
  year?: string;
  authors?: string;
  container?: string | null;
  details?: string | null;
};

export type SourceSummary = {
  dataset_id?: unknown;
  dataset_version?: unknown;
  short_name?: unknown;
  source_citation?: unknown;
  source_description?: unknown;
  classification_path?: unknown;
  kind?: unknown;
  fallback_database_source?: unknown;
};

export type SourceLookup = {
  get: (id: string) => SourceSummary | undefined;
};

export type SourceReference = UnknownRecord & {
  "@type": string;
  "@refObjectId": string;
  "@version": string;
  "@uri": string;
  "common:shortDescription": UnknownRecord;
};

export type SourceReferenceSnapshot = {
  ref_object_id: string | null;
  version: string | null;
  uri: string | null;
  short_description: string | null;
};

type SourceAdministrativeInformation = UnknownRecord & {
  dataEntryBy: UnknownRecord;
  publicationAndOwnership: UnknownRecord;
};

export type SourceReferenceRow = {
  path: string;
  relation: string;
  ref_object_id: string;
  version: string | null;
  short_description: string | null;
};

export type ProcessSourceReferenceRow = SourceReferenceRow & {
  dataset_type: "process";
  dataset_id: string | null;
  dataset_version: string | null;
  source_file: unknown;
  referenced_source_kind: unknown;
  referenced_source_classification: unknown;
  referenced_source_citation: unknown;
};

export type DatabaseFallbackSourceConfig = {
  id: string;
  shortName: string;
  citation: string;
  description: string;
  permanentDataSetUri: (sourceId: string) => string;
};

export type SourceProfileFallbackDependencies = Pick<
  SourceSemanticDependencies,
  "asText" | "cloneJson" | "deterministicUuid" | "multiLang" | "textValue"
>;

export function normalizeDoiText(asText: (value: unknown) => string, value: unknown): string {
  const text = asText(value);
  const doi = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/iu)?.[0];
  return doi ? doi.replace(/[),.;\s]+$/u, "") : "";
}

export function createSourceProfileFallbackUtils({
  asText,
  cloneJson,
  deterministicUuid,
  multiLang,
  textValue,
}: SourceProfileFallbackDependencies) {
  function bafuFallbackSourceId() {
    if (typeof deterministicUuid === "function") {
      return deterministicUuid("tiangong-lca-foundry:bafu:database-source:BAFU 2025 Version 2");
    }
    return "7d6cb661-93f8-5c42-b23f-c3b73f8a6f97";
  }

  function processContextSourceId(metadata: SourceMetadata) {
    const identityText =
      normalizeDoiText(asText, metadata?.doi) ||
      asText(metadata?.citation) ||
      asText(metadata?.shortName);
    if (typeof deterministicUuid === "function") {
      return deterministicUuid(`tiangong-lca-foundry:bafu:process-context-source:${identityText}`);
    }
    return identityText;
  }

  const canonicalSourceReferences: Record<string, SourceReference> = {
    dataset_format_source: {
      "@type": "source data set",
      "@refObjectId": "a97a0155-0234-4b87-b4ce-a45da52f2a40",
      "@version": "03.00.003",
      "@uri": "../sources/a97a0155-0234-4b87-b4ce-a45da52f2a40_03.00.003.xml",
      "common:shortDescription": multiLang("ILCD format", "en"),
    },
    compliance_system_source: {
      "@type": "source data set",
      "@refObjectId": "d92a1a12-2545-49e2-a585-55c259997756",
      "@version": "20.20.002",
      "@uri": "../sources/d92a1a12-2545-49e2-a585-55c259997756_20.20.002.xml",
      "common:shortDescription": multiLang("ILCD Data Network - Entry-level", "en"),
    },
  };

  function canonicalSourceReferenceForRelation(relation: string) {
    const reference = canonicalSourceReferences[relation];
    return reference ? cloneJson(reference) : null;
  }

  // A format/compliance support source is the same public canonical dataset no matter
  // which slot references it. The path-relation maps a format/compliance slot to its
  // canonical; this maps the source's own semantic KIND to the same canonical, so a
  // format/compliance source landing in a non-format/compliance slot (e.g.
  // modellingAndValidation/validation/review/common:referenceToCompleteReviewReport)
  // is rewritten to the same public canonical source it would get on its format slot.
  const canonicalSourceReferenceByKind: Record<string, string> = {
    format_support_source: "dataset_format_source",
    compliance_support_source: "compliance_system_source",
  };

  function canonicalSourceReferenceForSourceKind(kind: unknown) {
    const relation = canonicalSourceReferenceByKind[asText(kind)];
    return relation ? canonicalSourceReferenceForRelation(relation) : null;
  }

  // Inverse of canonicalSourceReferenceByKind + canonicalSourceReferences: map a source's
  // own UUID to its canonical support KIND, so a public canonical support source is
  // recognized by identity even when its converted classification/shortName would not
  // otherwise resolve to format_support_source / compliance_support_source.
  function canonicalSupportSourceKindForId(refObjectId: unknown) {
    const id = asText(refObjectId);
    if (!id) return null;
    for (const [kind, relation] of Object.entries(canonicalSourceReferenceByKind)) {
      if (asText(canonicalSourceReferences[relation]?.["@refObjectId"]) === id) {
        return kind;
      }
    }
    return null;
  }

  function buildBafuProcessContextSourcePayload({
    metadata,
    contactReference,
    id = null,
    version = "00.00.001",
    language = "en",
    timestamp = null,
  }: {
    metadata?: SourceMetadata | null;
    contactReference?: unknown;
    id?: unknown;
    version?: string;
    language?: unknown;
    timestamp?: unknown;
  } = {}) {
    if (!metadata?.shortName || !metadata?.citation) return null;
    const sourceId = asText(id) || processContextSourceId(metadata);
    const dataEntryBy: UnknownRecord = {
      "common:referenceToDataSetFormat":
        canonicalSourceReferenceForRelation("dataset_format_source"),
    };
    if (timestamp) {
      dataEntryBy["common:timeStamp"] = timestamp;
    }
    const publicationAndOwnership: UnknownRecord = {
      "common:dataSetVersion": version,
      "common:permanentDataSetURI": `https://www.bafu.admin.ch/bafu-2025-v2/sources/${sourceId}`,
    };
    if (contactReference) {
      publicationAndOwnership["common:referenceToOwnershipOfDataSet"] = cloneJson(contactReference);
    }
    return {
      sourceDataSet: {
        "@xmlns": "http://lca.jrc.it/ILCD/Source",
        "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
        "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "@version": "1.1",
        "@xsi:schemaLocation": "http://lca.jrc.it/ILCD/Source ../../schemas/ILCD_SourceDataSet.xsd",
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": sourceId,
            "common:shortName": multiLang(metadata.shortName, language),
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "5",
                  "#text": "Publications and communications",
                },
              },
            },
            sourceCitation: metadata.citation,
            sourceDescriptionOrComment: multiLang(
              metadata.description || `Report/publication: ${metadata.citation}.`,
              language,
            ),
          },
        },
        administrativeInformation: {
          dataEntryBy,
          publicationAndOwnership,
        },
      },
    };
  }

  // Database-level fallback source identity is profile-specific. A converted
  // package whose process data source points at a non-source placeholder (and
  // that has no unambiguous process-specific report/publication source) is
  // rewritten to cite the package's own database-level source. That source must
  // belong to the package being imported — a USLCI process must cite the USLCI
  // database, never BAFU's. The BAFU branch is kept byte-identical to the
  // original so already-imported BAFU rows are unaffected.
  function databaseFallbackSourceConfig(profile: unknown): DatabaseFallbackSourceConfig {
    const key = asText(profile).toLowerCase();
    if (key === "uslci") {
      return {
        id: deterministicUuid(
          "tiangong-lca-foundry:uslci:database-source:U.S. Life Cycle Inventory Database (USLCI)",
        ),
        shortName: "U.S. Life Cycle Inventory Database (USLCI)",
        citation:
          "U.S. Life Cycle Inventory Database (USLCI), National Renewable Energy Laboratory (NREL), U.S. Federal LCA Commons, 2025.",
        description:
          "Database-level fallback source used when the converted USLCI package has no more specific report, publication, or data-source evidence for the process scope.",
        permanentDataSetUri: (sourceId: string) => `https://www.lcacommons.gov/uslci/${sourceId}`,
      };
    }
    if (key === "worldsteel") {
      // worldsteel ships no database-level source dataset of its own, so the
      // converted steel processes whose data source resolves to a placeholder
      // are cited to this synthesized worldsteel database source rather than
      // silently inheriting the BAFU default. A worldsteel process must never
      // cite the BAFU 2025 database.
      return {
        id: deterministicUuid(
          "tiangong-lca-foundry:worldsteel:database-source:worldsteel LCI database",
        ),
        shortName: "worldsteel LCI database",
        citation:
          "worldsteel Life Cycle Inventory (LCI) database, World Steel Association (worldsteel), 2022.",
        description:
          "Database-level fallback source used when the converted worldsteel package has no more specific report, publication, or data-source evidence for the process scope.",
        permanentDataSetUri: (sourceId: string) => `https://worldsteel.org/lci/${sourceId}`,
      };
    }
    // Default (BAFU and any unspecified profile): preserve the original behavior.
    return {
      id: bafuFallbackSourceId(),
      shortName: "BAFU 2025 Version 2 LCA database",
      citation:
        "BAFU 2025 Version 2 LCA database, Federal Office for the Environment (FOEN), 2025.",
      description:
        "Database-level fallback source used when the converted BAFU package has no more specific report, publication, or data-source evidence for the process scope.",
      permanentDataSetUri: (sourceId: string) =>
        `https://www.bafu.admin.ch/bafu-2025-v2/${sourceId}`,
    };
  }

  function buildDatabaseFallbackSourcePayload({
    profile = "bafu",
    contactReference,
    id = null,
    version = "00.00.001",
    language = "en",
    timestamp = null,
  }: {
    profile?: unknown;
    contactReference?: unknown;
    id?: unknown;
    version?: string;
    language?: unknown;
    timestamp?: unknown;
  } = {}) {
    const config = databaseFallbackSourceConfig(profile);
    const sourceId = asText(id) || config.id;
    const shortName = config.shortName;
    const citation = config.citation;
    const description = config.description;
    const dataFormatReference = canonicalSourceReferenceForRelation("dataset_format_source");
    // ILCD expects the format reference inside dataEntryBy (see
    // buildBafuProcessContextSourcePayload); at the administrativeInformation
    // root it fails schema validation as an unknown member.
    const dataEntryBy: UnknownRecord = {
      "common:referenceToDataSetFormat": dataFormatReference,
    };
    if (timestamp) {
      dataEntryBy["common:timeStamp"] = timestamp;
    }
    const publicationAndOwnership: UnknownRecord = {
      "common:dataSetVersion": version,
      "common:permanentDataSetURI": config.permanentDataSetUri(sourceId),
    };
    const admin: SourceAdministrativeInformation = {
      dataEntryBy,
      publicationAndOwnership,
    };
    if (contactReference) {
      publicationAndOwnership["common:referenceToOwnershipOfDataSet"] = cloneJson(contactReference);
    }
    return {
      sourceDataSet: {
        "@xmlns": "http://lca.jrc.it/ILCD/Source",
        "@xmlns:common": "http://lca.jrc.it/ILCD/Common",
        "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "@version": "1.1",
        "@xsi:schemaLocation": "http://lca.jrc.it/ILCD/Source ../../schemas/ILCD_SourceDataSet.xsd",
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": sourceId,
            "common:shortName": multiLang(shortName, language),
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "2",
                  "#text": "Databases",
                },
              },
            },
            sourceCitation: citation,
            sourceDescriptionOrComment: multiLang(description, language),
          },
        },
        administrativeInformation: admin,
      },
    };
  }

  // Backward-compatible alias: existing callers that explicitly want the BAFU
  // database-level fallback source. New callers should use
  // buildDatabaseFallbackSourcePayload({ profile }).
  function buildBafuFallbackSourcePayload(
    options: {
      contactReference?: unknown;
      id?: unknown;
      version?: string;
      language?: unknown;
      timestamp?: unknown;
    } = {},
  ) {
    return buildDatabaseFallbackSourcePayload({ ...options, profile: "bafu" });
  }

  function sourceReferenceFromSummary(
    source: SourceSummary | null | undefined,
    language: unknown = "en",
  ) {
    const id = asText(source?.dataset_id);
    if (!id) return null;
    const version = asText(source?.dataset_version) || "00.00.001";
    const shortName = asText(source?.short_name) || "BAFU 2025 Version 2 LCA database";
    return {
      "@type": "source data set",
      "@refObjectId": id,
      "@version": version,
      "@uri": `../sources/${id}_${version}.xml`,
      "common:shortDescription": multiLang(shortName, language),
    };
  }

  function sourceReferenceKind(pathSegments: PathSegment[]) {
    const pathText = pathSegments.join(".");
    if (pathText.includes("referenceToDataSource")) return "process_data_source";
    if (pathText.includes("referenceToDataSetFormat")) return "dataset_format_source";
    if (pathText.includes("referenceToComplianceSystem")) return "compliance_system_source";
    return "other_source_reference";
  }

  function sourceReferenceSnapshot(reference: unknown): SourceReferenceSnapshot {
    const referenceRecord = reference as UnknownRecord | null | undefined;
    return {
      ref_object_id: asText(referenceRecord?.["@refObjectId"]) || null,
      version: asText(referenceRecord?.["@version"]) || null,
      uri: asText(referenceRecord?.["@uri"]) || null,
      short_description: textValue(referenceRecord?.["common:shortDescription"]) || null,
    };
  }

  return {
    bafuFallbackSourceId,
    processContextSourceId,
    databaseFallbackSourceConfig,
    buildBafuFallbackSourcePayload,
    buildDatabaseFallbackSourcePayload,
    buildBafuProcessContextSourcePayload,
    canonicalSourceReferenceForRelation,
    canonicalSourceReferenceForSourceKind,
    canonicalSupportSourceKindForId,
    sourceReferenceFromSummary,
    sourceReferenceKind,
    sourceReferenceSnapshot,
  };
}
