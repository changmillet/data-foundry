import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function createBundleSampleUtils({
  asText,
  bundleClassificationPath,
  canonicalSourceReferenceForRelation,
  cloneJson,
  contactGlobalReference,
  datasetIdentity,
  deterministicUuid,
  directoryExists,
  ensureArray,
  fileExists,
  flowClassificationSchemaType,
  flowTypeOfDataSet,
  isConvertedDefaultClassification,
  isObjectEmpty,
  jsonSha256,
  languageForText,
  multiLang,
  normalizedList,
  nowIso,
  pathExpression,
  readJson,
  repoRelativeMaybe,
  repoRelativePath,
  resolveRepoPath,
  sanitizePlaceholderText,
  sourceReferenceSnapshot,
  textValue,
}) {
function isLikelyLocationCodeText(value) {
  const text = asText(value).trim();
  if (!text || /\s/u.test(text) || text.length > 24) return false;
  return /^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{1,8})*$/u.test(text);
}

function collectBundleQualityFindings({
  payload,
  type,
  sourceFile,
  sourceTraces,
  blockers,
  stats,
  classificationQueueRows,
  classificationCommandsByType,
}) {
  if (type !== "process" && type !== "flow") return;
  if (type === "flow" && flowClassificationSchemaType(payload) !== "flow-product")
    return;
  const identity = datasetIdentity(payload, type);
  const currentClassification = bundleClassificationPath(payload, type);
  if (!isConvertedDefaultClassification(currentClassification)) return;

  if (type === "process") {
    stats.default_process_classification_blockers += 1;
  } else {
    stats.default_flow_classification_blockers += 1;
  }
  const schemaType =
    type === "flow" ? flowClassificationSchemaType(payload) : "process";
  const code = `${type}_classification_requires_authoring`;
  const sourceClassification = processSourceClassificationSummary(sourceTraces);
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  const queueRow = {
    dataset_type: type,
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    code,
    current_classification: currentClassification,
    source_classification: sourceClassification,
    authoring_context: authoringContext,
    classification_workflow: {
      schema_type: schemaType,
      row_type: type,
      commands: classificationCommandsByType[schemaType],
      decision_contract: {
        required_selector: "row_index or dataset_id",
        required_classification:
          "code, leaf_code, class_id, cat_id, or classes[]",
        optional_fields: ["basis", "evidence"],
      },
    },
    required_resolution:
      "Use the Foundry AI authoring/classification gate with full TIDAS schema/YAML/context to replace the converted default classification before remote write.",
  };
  classificationQueueRows.push(queueRow);
  blockers.push({
    code,
    message: `${type} classification is the tidas-tools converted default path and must be resolved by AI/classification authoring before commit.`,
    dataset_type: type,
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    current_classification: currentClassification,
    source_classification: sourceClassification,
    schema_type: schemaType,
    queue: "classification-authoring-queue.jsonl",
  });
}

function flowNameParts(payload) {
  const name =
    payload?.flowDataSet?.flowInformation?.dataSetInformation?.name ?? {};
  return {
    base_name: asText(name.baseName?.["#text"] ?? name.baseName),
    treatment_standards_routes: asText(
      name.treatmentStandardsRoutes?.["#text"] ??
        name.treatmentStandardsRoutes,
    ),
    mix_and_location_types: asText(
      name.mixAndLocationTypes?.["#text"] ?? name.mixAndLocationTypes,
    ),
    functional_unit_flow_properties: asText(
      name.functionalUnitFlowProperties?.["#text"] ??
        name.functionalUnitFlowProperties,
    ),
  };
}

function collectElementaryFlowReuseFindings({
  payload,
  type,
  sourceFile,
  sourceTraces,
  blockers,
  stats,
  elementaryFlowReuseRows,
}) {
  if (type !== "flow") return;
  if (flowClassificationSchemaType(payload) !== "flow-elementary") return;
  const identity = datasetIdentity(payload, type);
  const sourceClassification = processSourceClassificationSummary(sourceTraces);
  const authoringContext = processAuthoringContextFromTrace(sourceTraces);
  stats.elementary_flow_reuse_blockers += 1;
  elementaryFlowReuseRows.push({
    dataset_type: "flow",
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    code: "elementary_flow_requires_existing_database_match",
    flow_type: flowTypeOfDataSet(payload),
    source_name_fields: flowNameParts(payload),
    source_classification: sourceClassification,
    authoring_context: authoringContext,
    required_resolution:
      "Search the existing TianGong elementary flow library by UUID/version, CAS/name/category/synonyms, and structured semantic candidates. Rewrite process exchanges to the selected existing flow. If no defensible match exists, keep this as an unresolved mapping blocker; do not write a BAFU-owned elementary flow.",
  });
  blockers.push({
    code: "elementary_flow_requires_existing_database_match",
    message:
      "Elementary flow must be selected from existing TianGong database flows before commit; Foundry must not publish BAFU-owned elementary flows.",
    dataset_type: type,
    dataset_id: identity.id,
    dataset_version: identity.version,
    source_file: repoRelativeMaybe(sourceFile),
    flow_type: flowTypeOfDataSet(payload),
    source_name_fields: flowNameParts(payload),
    source_classification: sourceClassification,
    queue: "elementary-flow-reuse-queue.jsonl",
  });
}

function normalizeTimestampText(text, pathSegments, stats) {
  if (pathSegments.at(-1) !== "common:timeStamp") return text;
  const value = String(text ?? "").trim();
  if (!value) return text;
  let normalized = value;
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/u.test(
      value,
    )
  ) {
    normalized = new Date(value).toISOString();
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)) {
    normalized = `${value}Z`;
  }
  if (normalized !== value) {
    stats.timestamp_normalizations += 1;
  }
  return normalized;
}

function collectSourceTracePayloads(value, traces = []) {
  if (!value || typeof value !== "object") return traces;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceTracePayloads(item, traces);
    return traces;
  }
  const sourceTrace = value["tidasimport:sourceTrace"];
  if (sourceTrace && typeof sourceTrace === "object") {
    traces.push(sourceTrace.payload ?? sourceTrace);
  }
  for (const child of Object.values(value))
    collectSourceTracePayloads(child, traces);
  return traces;
}

function walkSourceTraceNode(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkSourceTraceNode(item, visitor);
    return;
  }
  visitor(node);
  for (const child of Object.values(node)) {
    walkSourceTraceNode(child, visitor);
  }
}

function sourceTraceAttribute(sourceTraces, attributeName) {
  for (const trace of sourceTraces) {
    let found = null;
    walkSourceTraceNode(trace, (node) => {
      if (found) return;
      const attributes = Array.isArray(node.attributes) ? node.attributes : [];
      const attribute = attributes.find((item) => item?.name === attributeName);
      if (attribute?.value !== undefined && attribute?.value !== null) {
        found = String(attribute.value).trim();
      }
    });
    if (found) return found;
  }
  return null;
}

function sourceTraceLocationCode(sourceTraces) {
  const location = sourceTraceAttribute(sourceTraces, "location");
  return isLikelyLocationCodeText(location) ? location : null;
}

function sourceTraceChildText(sourceTraces, childName) {
  for (const trace of sourceTraces) {
    let found = null;
    walkSourceTraceNode(trace, (node) => {
      if (found || node?.name !== childName) return;
      if (node.text !== undefined && node.text !== null) {
        found = String(node.text).trim();
      }
    });
    if (found) return found;
  }
  return null;
}

function processSourceClassificationSummary(sourceTraces) {
  for (const trace of sourceTraces) {
    const sourceClassification = trace?.sourceClassification;
    if (sourceClassification && typeof sourceClassification === "object") {
      return {
        category: asText(sourceClassification.category),
        subCategory: asText(sourceClassification.subCategory),
        localCategory: asText(sourceClassification.localCategory),
        localSubCategory: asText(sourceClassification.localSubCategory),
      };
    }
  }
  return {
    category: sourceTraceAttribute(sourceTraces, "category"),
    subCategory: sourceTraceAttribute(sourceTraces, "subCategory"),
    localCategory: sourceTraceAttribute(sourceTraces, "localCategory"),
    localSubCategory: sourceTraceAttribute(sourceTraces, "localSubCategory"),
  };
}

function processAuthoringContextFromTrace(sourceTraces) {
  return {
    source_name: sourceTraceAttribute(sourceTraces, "name"),
    source_local_name: sourceTraceAttribute(sourceTraces, "localName"),
    source_location: sourceTraceLocationCode(sourceTraces),
    source_unit: sourceTraceAttribute(sourceTraces, "unit"),
    general_comment: sourceTraceAttribute(sourceTraces, "generalComment"),
    included_processes: sourceTraceAttribute(sourceTraces, "includedProcesses"),
    technology: sourceTraceAttribute(sourceTraces, "text"),
  };
}

function textItem(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return typeof value["#text"] === "string" ? value : null;
  }
  if (Array.isArray(value)) {
    return (
      value.find(
        (item) =>
          item && typeof item === "object" && typeof item["#text"] === "string",
      ) ?? null
    );
  }
  return null;
}

function productionVolumeToAnnualText(value) {
  const text = asText(value);
  if (!text) return null;
  let match = text.match(
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\s+(.+?)\s+per\s+year\b/iu,
  );
  if (!match) {
    match = text.match(
      /([+-]?(?:\d[\d'.,]*(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\s+([^\s,.;()]+)\s*\/\s*(?:year|yr|a)\b/iu,
    );
  }
  if (!match) return null;
  const amount = match[1].replace(/[',]/gu, "");
  const unit = match[2].replace(/[.。]\s*$/u, "").trim();
  return `${amount} ${unit}/year`;
}

function sourceTraceYear(sourceTraces) {
  for (const candidate of [
    sourceTraceChildText(sourceTraces, "endYear"),
    sourceTraceChildText(sourceTraces, "startYear"),
    sourceTraceAttribute(sourceTraces, "version"),
    sourceTraceAttribute(sourceTraces, "timestamp"),
  ]) {
    const match = asText(candidate).match(/\b(19|20)\d{2}\b/u);
    if (match) return Number(match[0]);
  }
  return null;
}

function repairProcessFieldsFromSourceTrace(payload, sourceTraces, stats) {
  const root = payload?.processDataSet;
  if (!root || typeof root !== "object") return;
  const processInformation =
    root.processInformation && typeof root.processInformation === "object"
      ? root.processInformation
      : {};
  const time =
    processInformation.time && typeof processInformation.time === "object"
      ? processInformation.time
      : null;
  if (time && time["common:referenceYear"] === 9999) {
    const year = sourceTraceYear(sourceTraces);
    if (Number.isInteger(year) && year > 0 && year < 9999) {
      time["common:referenceYear"] = year;
      stats.reference_year_repairs += 1;
    }
  }

  const modelling =
    root.modellingAndValidation &&
    typeof root.modellingAndValidation === "object"
      ? root.modellingAndValidation
      : {};
  const dataSources =
    modelling.dataSourcesTreatmentAndRepresentativeness &&
    typeof modelling.dataSourcesTreatmentAndRepresentativeness === "object"
      ? modelling.dataSourcesTreatmentAndRepresentativeness
      : null;
  if (!dataSources) return;

  const annualText = textItem(dataSources.annualSupplyOrProductionVolume);
  if (!annualText) return;
  const current = asText(annualText["#text"]);
  if (
    !current ||
    current.toLowerCase().includes("not declared in source package") ||
    !/(?:\/\s*(?:year|yr|a)\b|\bper\s+(?:year|annum)\b|\/\s*年|每年|年度|年供应|年产)/iu.test(
      current,
    )
  ) {
    const repaired = productionVolumeToAnnualText(
      sourceTraceAttribute(sourceTraces, "productionVolume"),
    );
    if (repaired) {
      annualText["#text"] = repaired;
      stats.annual_supply_repairs += 1;
    }
  }
}

function sanitizeImportContent(
  value,
  stats,
  traceRows,
  context,
  pathSegments = [],
) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const child = value[index];
      if (typeof child === "string") {
        value[index] = normalizeTimestampText(
          sanitizePlaceholderText(child, [...pathSegments, index], stats),
          [...pathSegments, index],
          stats,
        );
      } else if (
        sanitizeImportContent(child, stats, traceRows, context, [
          ...pathSegments,
          index,
        ])
      ) {
        value.splice(index, 1);
      }
    }
    return false;
  }

  if (value["tidasimport:sourceTrace"]) {
    traceRows.push({
      dataset_type: context.type,
      dataset_id: context.identity.id,
      dataset_version: context.identity.version,
      source_file: repoRelativeMaybe(context.sourceFile),
      path: pathExpression([...pathSegments, "tidasimport:sourceTrace"]),
      trace: cloneJson(value["tidasimport:sourceTrace"]),
    });
    delete value["tidasimport:sourceTrace"];
    stats.removed_import_traces += 1;
  }
  if (value["@xmlns:tidasimport"]) {
    delete value["@xmlns:tidasimport"];
    stats.removed_import_trace_namespaces += 1;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathSegments, key];
    if (typeof child === "string") {
      value[key] = normalizeTimestampText(
        sanitizePlaceholderText(child, childPath, stats),
        childPath,
        stats,
      );
      continue;
    }
    if (
      typeof child === "number" &&
      key === "common:referenceYear" &&
      child === 9999
    ) {
      continue;
    }
    if (sanitizeImportContent(child, stats, traceRows, context, childPath)) {
      delete value[key];
    }
  }

  return pathSegments.at(-1) === "common:other" && isObjectEmpty(value);
}

function sanitizeBundlePayload(
  payload,
  type,
  sourceFile,
  stats,
  traceRows,
  sourceTraces = null,
) {
  sourceTraces ??= collectSourceTracePayloads(payload);
  if (type === "process") {
    repairProcessFieldsFromSourceTrace(payload, sourceTraces, stats);
  }
  const identity = datasetIdentity(payload, type);
  sanitizeImportContent(payload, stats, traceRows, {
    type,
    identity,
    sourceFile,
  });
  return payload;
}

function findFirstBundleContactTemplate(bundleDirs) {
  for (const bundleDir of bundleDirs) {
    const contactsDir = path.join(bundleDir, "tidas", "contacts");
    if (!directoryExists(contactsDir)) continue;
    for (const name of fs.readdirSync(contactsDir).sort()) {
      if (name.endsWith(".json")) {
        return readJson(path.join(contactsDir, name));
      }
    }
  }
  return null;
}

function buildLibraryContactPayload(
  options,
  templateContact = null,
  rewriteContext = {},
) {
  const language = asText(options.language || options.lang || "en") || "en";
  const libraryName = asText(
    options.libraryName ||
      options.name ||
      "Federal Office for the Environment FOEN",
  );
  const shortName = asText(options.shortName || "FOEN");
  const website = asText(
    options.website ||
      options.url ||
      "https://www.bafu.admin.ch/bafu/en/home.html",
  );
  const email = asText(options.email || "info@bafu.admin.ch");
  const telephone = asText(
    options.telephone || options.phone || "+41 58 462 93 11",
  );
  const contactAddress = asText(
    options.contactAddress ||
      options.address ||
      "Mühlestrasse 2, 3063 Ittigen, Switzerland",
  );
  const centralContactPoint = asText(
    options.centralContactPoint ||
      "Federal Office for the Environment FOEN, Mühlestrasse 2, 3063 Ittigen, Switzerland; info@bafu.admin.ch; +41 58 462 93 11",
  );
  const description = asText(
    options.description ||
      "Library-level contact for the BAFU 2025 Version 2 LCA data package.",
  );
  const profile = asText(options.profile || "bafu");
  const version = asText(
    options.contactVersion || options.version || "00.00.001",
  );
  const id =
    asText(options.contactId || options.id) ||
    deterministicUuid(
      `tiangong-lca-foundry:library-contact:${profile}:${libraryName}:${website}`,
    );
  const now = nowIso();
  const templateRoot = templateContact?.contactDataSet;
  const templateDataEntryBy =
    templateRoot?.administrativeInformation?.dataEntryBy ?? {};
  const originalReferenceToDataSetFormat = cloneJson(
    templateDataEntryBy["common:referenceToDataSetFormat"] ?? {
      "@type": "source data set",
      "@refObjectId": "16938856-0a35-5654-8aff-56c17e61da4d",
      "@version": "00.00.001",
      "@uri": "../sources/16938856-0a35-5654-8aff-56c17e61da4d.json",
      "common:shortDescription": multiLang("ILCD format", language),
    },
  );
  const referenceToDataSetFormat =
    canonicalSourceReferenceForRelation("dataset_format_source") ??
    originalReferenceToDataSetFormat;
  const originalFormatSnapshot = sourceReferenceSnapshot(
    originalReferenceToDataSetFormat,
  );
  const canonicalFormatSnapshot = sourceReferenceSnapshot(
    referenceToDataSetFormat,
  );
  if (
    rewriteContext?.rewriteRows &&
    (originalFormatSnapshot.ref_object_id !==
      canonicalFormatSnapshot.ref_object_id ||
      originalFormatSnapshot.version !== canonicalFormatSnapshot.version ||
      originalFormatSnapshot.short_description !==
        canonicalFormatSnapshot.short_description)
  ) {
    rewriteContext.rewriteRows.push({
      dataset_type: "contact",
      dataset_id: id,
      dataset_version: version,
      source_file: "foundry:library-contact",
      path: "contactDataSet.administrativeInformation.dataEntryBy.common:referenceToDataSetFormat",
      relation: "dataset_format_source",
      original: originalFormatSnapshot,
      canonical: canonicalFormatSnapshot,
      reason:
        "Library contact data set format uses the public canonical ILCD format source instead of a converted package-local support source.",
    });
    if (rewriteContext.stats) {
      rewriteContext.stats.source_reference_rewrites =
        Number(rewriteContext.stats.source_reference_rewrites ?? 0) + 1;
    }
  }
  const selfRef = contactGlobalReference({
    id,
    version,
    shortDescription: libraryName,
    language,
  });

  const dataSetInformation = {
    "common:UUID": id,
    "common:shortName": multiLang(shortName, language),
    "common:name": multiLang(libraryName, language),
    classificationInformation: {
      "common:classification": {
        "common:class": {
          "@level": "0",
          "@classId": "5",
          "#text": "Other",
        },
      },
    },
    WWWAddress: website,
    email,
    telephone,
    contactAddress: multiLang(contactAddress, language),
    centralContactPoint: multiLang(centralContactPoint, language),
    contactDescriptionOrComment: multiLang(description, language),
    "common:other": {
      "@xmlns:foundry": "https://tiangong.earth/tidas/foundry/1.0",
      "foundry:libraryContactPolicy": {
        "@marker": "FOUNDRY_LIBRARY_CONTACT_POLICY_V1",
        profile,
        libraryName,
        sourceLanguage: language,
        policy:
          "One shared library contact is used for every dataset row imported from this source library.",
        evidence: {
          source:
            "Foundry BAFU import profile/library-level source attribution",
          website,
          email,
          telephone,
          contactAddress,
        },
      },
    },
  };

  return {
    contactDataSet: {
      "@version": templateRoot?.["@version"] ?? "1.1",
      "@xmlns": templateRoot?.["@xmlns"] ?? "http://lca.jrc.it/ILCD/Contact",
      "@xmlns:common":
        templateRoot?.["@xmlns:common"] ?? "http://lca.jrc.it/ILCD/Common",
      "@xmlns:xsi":
        templateRoot?.["@xmlns:xsi"] ??
        "http://www.w3.org/2001/XMLSchema-instance",
      "@xsi:schemaLocation":
        templateRoot?.["@xsi:schemaLocation"] ??
        "http://lca.jrc.it/ILCD/Contact ../../schemas/ILCD_ContactDataSet.xsd",
      contactInformation: {
        dataSetInformation,
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:timeStamp": now,
          "common:referenceToDataSetFormat": referenceToDataSetFormat,
        },
        publicationAndOwnership: {
          "common:dataSetVersion": version,
          "common:permanentDataSetURI": `https://lcdn.tiangong.earth/datasetdetail/contact.xhtml?uuid=${id}&version=${version}`,
          "common:referenceToOwnershipOfDataSet": selfRef,
        },
      },
    },
  };
}

function listProcessBundleDirs(bundlesDir) {
  const root = resolveRepoPath(bundlesDir);
  if (!root || !directoryExists(root)) {
    throw new Error(
      "--bundles-dir is required and must point to a process-bundles directory.",
    );
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter(
      (dir) =>
        fileExists(path.join(dir, "manifest.json")) &&
        directoryExists(path.join(dir, "tidas")),
    )
    .sort();
}

function selectProcessBundleDirs(allBundleDirs, options) {
  const requestedProcessIds = normalizedList(
    options.processId || options.processIds,
  );
  if (requestedProcessIds.length > 0) {
    const byName = new Map(
      allBundleDirs.map((dir) => [path.basename(dir), dir]),
    );
    const selected = requestedProcessIds
      .map((id) => byName.get(id))
      .filter(Boolean);
    return {
      seed: null,
      selected,
      missing_process_ids: requestedProcessIds.filter((id) => !byName.has(id)),
    };
  }

  const seed = asText(options.seed) || `sample-${Date.now()}`;
  const sampleSizeText = asText(
    options.sampleSize || options.limit || options.count || 3,
  );
  const sampleSize =
    sampleSizeText.toLowerCase() === "all"
      ? allBundleDirs.length
      : Math.max(1, Number(sampleSizeText));
  if (!Number.isFinite(sampleSize)) {
    throw new Error("--sample-size must be a positive number or all.");
  }
  const selected = [...allBundleDirs]
    .sort((left, right) =>
      createHash("sha256")
        .update(`${seed}:${path.basename(left)}`)
        .digest("hex")
        .localeCompare(
          createHash("sha256")
            .update(`${seed}:${path.basename(right)}`)
            .digest("hex"),
        ),
    )
    .slice(0, Math.min(sampleSize, allBundleDirs.length));
  return { seed, selected, missing_process_ids: [] };
}

function addDedupedBundleRow({
  rowsByType,
  sourceByType,
  blockers,
  type,
  payload,
  sourceFile,
}) {
  const identity = datasetIdentity(payload, type);
  const key = `${identity.id || path.basename(sourceFile)}::${identity.version || ""}`;
  if (!identity.id || !identity.version) {
    blockers.push({
      code: "bundle_row_identity_missing",
      message: `${type} row is missing common:UUID or common:dataSetVersion.`,
      source_file: repoRelativeMaybe(sourceFile),
      id: identity.id,
      version: identity.version,
    });
    return false;
  }
  if (!rowsByType[type].has(key)) {
    rowsByType[type].set(key, payload);
    sourceByType[type].set(key, sourceFile);
    return true;
  }
  const existing = rowsByType[type].get(key);
  if (jsonSha256(existing) !== jsonSha256(payload)) {
    blockers.push({
      code: "bundle_row_duplicate_payload_conflict",
      message: `${type} ${identity.id}@${identity.version} appears with different payloads in sampled bundles.`,
      kept_source_file: repoRelativeMaybe(sourceByType[type].get(key)),
      conflicting_source_file: repoRelativeMaybe(sourceFile),
    });
  }
  return false;
}

return {
  addDedupedBundleRow,
  buildLibraryContactPayload,
  collectBundleQualityFindings,
  collectElementaryFlowReuseFindings,
  collectSourceTracePayloads,
  findFirstBundleContactTemplate,
  flowNameParts,
  listProcessBundleDirs,
  processAuthoringContextFromTrace,
  processSourceClassificationSummary,
  sanitizeBundlePayload,
  selectProcessBundleDirs,
  sourceTraceAttribute,
  sourceTraceChildText,
  sourceTraceLocationCode,
};
}
