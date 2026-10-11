type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isJsonRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Preserve individual language texts so query owners can filter and bound each value. */
export function namePartText(
  value: unknown,
  asText: (value: unknown) => string,
): string | string[] {
  if (Array.isArray(value)) return value.flatMap((item) => namePartText(item, asText));
  return asText(isJsonRecord(value) ? value["#text"] : value);
}

export function createBundleSourceContextUtils({ asText }: { asText: (value: unknown) => string }) {
  function isLikelyLocationCodeText(value: unknown): boolean {
    const text = asText(value).trim();
    if (!text || /\s/u.test(text) || text.length > 24) return false;
    return /^[A-Za-z]{2,5}(?:-[A-Za-z0-9]{1,8})*$/u.test(text);
  }

  function flowNameParts(payload: JsonRecord | null) {
    const name = asJsonRecord(
      nestedValue(payload, "flowDataSet", "flowInformation", "dataSetInformation", "name"),
    );
    return {
      base_name: namePartText(name.baseName, asText),
      treatment_standards_routes: namePartText(name.treatmentStandardsRoutes, asText),
      mix_and_location_types: namePartText(name.mixAndLocationTypes, asText),
      functional_unit_flow_properties: namePartText(name.flowProperties, asText),
    };
  }

  function collectSourceTracePayloads(value: unknown, traces: JsonRecord[] = []): JsonRecord[] {
    if (!value || typeof value !== "object") return traces;
    if (Array.isArray(value)) {
      for (const item of value) collectSourceTracePayloads(item, traces);
      return traces;
    }
    const record = value as JsonRecord;
    const sourceTrace = record["tidasimport:sourceTrace"];
    if (isJsonRecord(sourceTrace)) {
      traces.push(asJsonRecord(sourceTrace.payload ?? sourceTrace));
    }
    for (const child of Object.values(record)) collectSourceTracePayloads(child, traces);
    return traces;
  }

  function walkSourceTraceNode(node: unknown, visitor: (node: JsonRecord) => void): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walkSourceTraceNode(item, visitor);
      return;
    }
    const record = node as JsonRecord;
    visitor(record);
    for (const child of Object.values(record)) {
      walkSourceTraceNode(child, visitor);
    }
  }

  function sourceTraceAttribute(sourceTraces: JsonRecord[], attributeName: string): string | null {
    for (const trace of sourceTraces) {
      let found: string | null = null;
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

  function sourceTraceLocationCode(sourceTraces: JsonRecord[]): string | null {
    const location = sourceTraceAttribute(sourceTraces, "location");
    return isLikelyLocationCodeText(location) ? location : null;
  }

  function sourceTraceChildText(sourceTraces: JsonRecord[], childName: string): string | null {
    for (const trace of sourceTraces) {
      let found: string | null = null;
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

  function processSourceClassificationSummary(sourceTraces: JsonRecord[]) {
    for (const trace of sourceTraces) {
      const sourceClassification = trace?.sourceClassification;
      if (isJsonRecord(sourceClassification)) {
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

  function processAuthoringContextFromTrace(sourceTraces: JsonRecord[]) {
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
  return {
    flowNameParts,
    collectSourceTracePayloads,
    sourceTraceAttribute,
    sourceTraceLocationCode,
    sourceTraceChildText,
    processSourceClassificationSummary,
    processAuthoringContextFromTrace,
  };
}
