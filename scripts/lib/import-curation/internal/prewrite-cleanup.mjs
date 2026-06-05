import { datasetRoot, unwrapDatasetPayload } from "./dataset-payload.mjs";
import { sha256Json, sha256Text } from "./hash-utils.mjs";
import { asText, ensureArray } from "./runtime-io.mjs";

export const annualSupplyMissingDataSentinelText =
  "9999 missing-data-sentinel/year";

export const foundryTraceNamespace =
  "https://tiangong-lca.dev/foundry/import-curation/1";

const datetimeFieldsToNormalize = new Set([
  "common:timeStamp",
  "common:dateOfLastRevision",
]);

const foundryTraceKeys = [
  "tiangongfoundry:unresolvedTrace",
  "tiangongfoundry:sourceExchangeCompleteness",
];

const localSourceLocatorKeys = new Set([
  "source_path",
  "sourcePath",
  "local_source_path",
  "localSourcePath",
  "package_path",
  "packagePath",
  "source_object",
  "sourceObject",
]);

export function normalizeUtcDateTimeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      trimmed,
    )
  ) {
    return null;
  }
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) return null;
  const normalized = new Date(time).toISOString();
  return normalized === value ? null : normalized;
}

export function normalizeDateTimeMetadata(value) {
  let normalized = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (datetimeFieldsToNormalize.has(key)) {
        const nextValue = normalizeUtcDateTimeString(child);
        if (nextValue) {
          node[key] = nextValue;
          normalized += 1;
        }
        continue;
      }
      visit(child);
    }
  };
  visit(value);
  return normalized;
}

function annualSupplyTextValue(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(value["#text"] ?? value.value);
  }
  return "";
}

function isPlaceholderAnnualSupplyValue(value) {
  const text = annualSupplyTextValue(value);
  return (
    !text ||
    /^9999$/u.test(text) ||
    /^not\s+specified\.?$/iu.test(text) ||
    /^not\s+declared\s+in\s+source\s+package\.?$/iu.test(text)
  );
}

function annualSupplySentinelValue() {
  return {
    "@xml:lang": "en",
    "#text": annualSupplyMissingDataSentinelText,
  };
}

export function applyAnnualSupplyMissingDataSentinel(row, datasetType) {
  if (datasetType !== "process") return false;
  const payload = unwrapDatasetPayload(row, datasetType);
  const root = datasetRoot(payload, datasetType);
  const dataSources =
    root?.modellingAndValidation?.dataSourcesTreatmentAndRepresentativeness;
  if (!dataSources || typeof dataSources !== "object") return false;
  const current = dataSources.annualSupplyOrProductionVolume;
  if (current !== undefined && !isPlaceholderAnnualSupplyValue(current)) {
    return false;
  }
  dataSources.annualSupplyOrProductionVolume = annualSupplySentinelValue();
  return true;
}

function appendImportTraceSummary(commonOther, sourceTrace) {
  commonOther["@xmlns:tiangongfoundry"] =
    commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
  const summary = {
    "@sourceExtension": "tidasimport:sourceTrace",
    "@status": "externalized_before_remote_write",
    traceHash: sha256Json(sourceTrace),
    note: "Original import trace was captured in the Foundry AI authoring package and removed from the write payload.",
  };
  const existing = commonOther["tiangongfoundry:importTraceSummary"];
  if (existing === undefined) {
    commonOther["tiangongfoundry:importTraceSummary"] = summary;
  } else if (Array.isArray(existing)) {
    existing.push(summary);
  } else {
    commonOther["tiangongfoundry:importTraceSummary"] = [existing, summary];
  }
}

export function externalizeImportTraceMetadata(value) {
  let removed = 0;
  let summaries = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      if (Object.hasOwn(commonOther, "tidasimport:sourceTrace")) {
        appendImportTraceSummary(
          commonOther,
          commonOther["tidasimport:sourceTrace"],
        );
        delete commonOther["tidasimport:sourceTrace"];
        removed += 1;
        summaries += 1;
      }
      if (Object.hasOwn(commonOther, "@xmlns:tidasimport")) {
        delete commonOther["@xmlns:tidasimport"];
      }
      if (Object.keys(commonOther).length === 0) {
        delete node["common:other"];
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return { removed, summaries };
}

export function ensureFoundryTraceNamespaces(value) {
  let added = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      const hasFoundryExtension = Object.keys(commonOther).some((key) =>
        key.startsWith("tiangongfoundry:"),
      );
      if (
        hasFoundryExtension &&
        !Object.hasOwn(commonOther, "@xmlns:tiangongfoundry")
      ) {
        commonOther["@xmlns:tiangongfoundry"] = foundryTraceNamespace;
        added += 1;
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return added;
}

function containsLocalSourceLocator(value) {
  const text = asText(value);
  return Boolean(
    text &&
      /(?:^|["'\s])(?:\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|file:\/\/|[A-Za-z]:\\)|\.zip:|LCI ecoSpold version2 Files/iu.test(
        text,
      ),
  );
}

function sanitizeTraceEvidenceValue(value, stats) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) sanitizeTraceEvidenceValue(item, stats);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      sanitizeTraceEvidenceValue(child, stats);
      continue;
    }
    if (!containsLocalSourceLocator(child)) continue;

    const hash = sha256Text(String(child));
    if (localSourceLocatorKeys.has(key)) {
      delete value[key];
    } else {
      value[key] = `redacted local source locator sha256:${hash}`;
    }
    value.source_locator_sha256 = value.source_locator_sha256 ?? hash;
    value.source_locator_status =
      value.source_locator_status ?? "redacted_before_remote_write";
    stats.redacted += 1;
  }
}

export function sanitizeFoundryTraceEvidenceLocators(value) {
  const stats = { redacted: 0 };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const commonOther = node["common:other"];
    if (
      commonOther &&
      typeof commonOther === "object" &&
      !Array.isArray(commonOther)
    ) {
      for (const traceKey of foundryTraceKeys) {
        for (const traceEntry of ensureArray(commonOther[traceKey])) {
          if (
            !traceEntry ||
            typeof traceEntry !== "object" ||
            Array.isArray(traceEntry)
          ) {
            continue;
          }
          const evidence =
            traceEntry.evidence ??
            traceEntry.source_evidence ??
            traceEntry.sourceEvidence;
          sanitizeTraceEvidenceValue(evidence, stats);
        }
      }
    }

    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return stats.redacted;
}
