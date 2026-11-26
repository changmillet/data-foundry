import { normalizeTidasLanguageCode } from "../../tidas-language-utils.ts";
import { datasetRoot } from "./dataset-payload.ts";
import { dataSetInformation } from "./dataset-payload.ts";
import { asText, ensureArray } from "./runtime-io.ts";

export interface JsonRecord {
  [key: string]: unknown;
}

interface TextEntry {
  path: string;
  text: string;
}

export interface SemanticActionOptions {
  code: string;
  path?: string | null;
  message: string;
  evidence?: unknown;
  instruction: string;
  common_other_deferral_allowed?: boolean;
  action_kind?: string;
}

export interface SemanticAction extends JsonRecord {
  code: string;
  path: string | null;
  message: string;
  evidence: unknown;
  instruction: string;
}

export interface PlaceholderOptions {
  allowNone?: boolean;
}

export interface TraceObject {
  node: JsonRecord;
  trace_path: string;
}

export interface TraceAttribute {
  object_name: string;
  attribute_name: string;
  value: string;
  trace_path: string;
}

interface NameFinding extends JsonRecord {
  code: string;
  path_field: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function collectTextEntries(value: unknown, pathName = ""): TextEntry[] {
  const entries: TextEntry[] = [];
  const visit = (node: unknown, currentPath: string): void => {
    if (typeof node === "string") {
      entries.push({ path: currentPath, text: node });
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("@")) continue;
      visit(child, currentPath ? `${currentPath}.${key}` : key);
    }
  };
  visit(value, pathName);
  return entries;
}

export function nameCarrier(root: unknown, datasetType: string): JsonRecord {
  const info = dataSetInformation(root, datasetType);
  return info?.name && typeof info.name === "object" ? info.name : {};
}

export function nameTextForPayload(payload: unknown, datasetType: string): string {
  const root = datasetRoot(payload, datasetType);
  return collectTextEntries(nameCarrier(root, datasetType))
    .map((entry) => entry.text)
    .join(" ");
}

export function semanticActionItem({
  code,
  path: itemPath,
  message,
  evidence,
  instruction,
  common_other_deferral_allowed = false,
  action_kind = "ai_authoring",
}: SemanticActionOptions): SemanticAction {
  return {
    source: "profile_semantic_gate",
    code,
    path: itemPath ?? null,
    message,
    evidence: evidence ?? null,
    instruction,
    action_kind,
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed,
  };
}

export function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" | ");
  if (typeof value !== "object") return "";
  const record = value as JsonRecord;
  const direct = record["#text"] ?? record.text ?? record.value;
  if (direct !== undefined && direct !== value) return textValue(direct);
  return Object.entries(record)
    .filter(([key]) => !key.startsWith("@"))
    .map(([, child]) => textValue(child))
    .filter(Boolean)
    .join(" | ");
}

export function isPlaceholderishText(
  value: unknown,
  { allowNone = false }: PlaceholderOptions = {},
): boolean {
  const text = textValue(value);
  if (!text) return true;
  if (allowNone && /^none$/iu.test(text)) return false;
  return /^(na|n\/a|not specified|not declared|unspecified|undefined|-|--|unknown)$/iu.test(text);
}

export function hasMeaningfulFieldValue(value: unknown): boolean {
  return !isPlaceholderishText(value);
}

export function sourceTracePayloads(value: unknown): unknown[] {
  const payloads: unknown[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as JsonRecord;
    const trace = record["tidasimport:sourceTrace"];
    if (isRecord(trace) && trace.payload) {
      payloads.push(trace.payload);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return payloads;
}

export function traceObjectsNamed(value: unknown, names: unknown): TraceObject[] {
  const wanted = new Set(
    ensureArray(names)
      .map((name) => asText(name))
      .filter(Boolean),
  );
  const found: TraceObject[] = [];
  const visit = (node: unknown, pathParts: string[] = []): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    const record = node as JsonRecord;
    const name = asText(record.name);
    if (wanted.has(name) && Array.isArray(record.attributes)) {
      found.push({ node: record, trace_path: pathParts.join(".") || "<root>" });
    }
    for (const [key, child] of Object.entries(record)) visit(child, [...pathParts, key]);
  };
  for (const payload of ensureArray(value)) visit(payload);
  return found;
}

export function traceAttributeMap(traceObject: unknown): Map<string, string> {
  const record = asRecord(traceObject);
  return new Map(
    ensureArray(record.attributes)
      .map((attribute): [string, string] => {
        const typedAttribute = asRecord(attribute);
        return [asText(typedAttribute.name), textValue(typedAttribute.value)];
      })
      .filter(([name, value]) => Boolean(name && value)),
  );
}

export function firstTraceAttribute(
  payloads: unknown,
  objectNames: unknown,
  attributeNames: unknown,
  options: PlaceholderOptions = {},
): TraceAttribute | null {
  const names = ensureArray(attributeNames)
    .map((name) => asText(name))
    .filter(Boolean);
  for (const traceObject of traceObjectsNamed(payloads, objectNames)) {
    const attributes = traceAttributeMap(traceObject.node);
    for (const name of names) {
      const value = attributes.get(name);
      if (value && !isPlaceholderishText(value, options)) {
        return {
          object_name: asText(traceObject.node.name),
          attribute_name: name,
          value,
          trace_path: traceObject.trace_path,
        };
      }
    }
  }
  return null;
}

export function sourceTraceLanguage(payloads: unknown, fallback = "en"): string {
  const rawLanguage = (
    firstTraceAttribute(payloads, "dataSetInformation", "localLanguageCode")?.value ||
    firstTraceAttribute(payloads, "dataSetInformation", "languageCode")?.value ||
    fallback
  )
    .slice(0, 8)
    .toLowerCase();
  return normalizeTidasLanguageCode(rawLanguage, { field: "source trace language" });
}

export function multiLangSuggestion(value: unknown, language = "en"): JsonRecord {
  return {
    "@xml:lang": normalizeTidasLanguageCode(language),
    "#text": textValue(value),
  };
}

export function sourceTraceEvidence(
  attribute: TraceAttribute | null | undefined,
  extra: JsonRecord = {},
): JsonRecord {
  return {
    source: "tidasimport:sourceTrace",
    trace_path: attribute?.trace_path ?? null,
    object_name: attribute?.object_name ?? null,
    attribute_name: attribute?.attribute_name ?? null,
    value: attribute?.value ?? null,
    ...extra,
  };
}

export function locationCodeCandidate(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const normalized = text.replace(/[{}]/gu, "").trim();
  if (/^RoW$/u.test(normalized)) return normalized;
  if (/^[A-Z0-9]{2,}(?:[-+&][A-Z0-9]{2,})*$/u.test(normalized)) {
    return normalized;
  }
  return null;
}

export function flowNameLocationEvidence(root: JsonRecord): JsonRecord | null {
  const flowInformation = asRecord(root.flowInformation);
  const dataSetInfo = asRecord(flowInformation.dataSetInformation);
  const name = asRecord(dataSetInfo.name);
  const value = name.mixAndLocationTypes;
  const code = locationCodeCandidate(value);
  if (!code) return null;
  return {
    source: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
    source_kind: "flow_name_mix_and_location_types",
    value: textValue(value),
    suggested_value: code,
  };
}

export function nameFieldPath(datasetType: string, field: string): string {
  const prefix =
    datasetType === "flow"
      ? "flowDataSet.flowInformation.dataSetInformation.name"
      : datasetType === "lifecyclemodel"
        ? "lifeCycleModelDataSet.lifeCycleModelInformation.dataSetInformation.name"
        : "processDataSet.processInformation.dataSetInformation.name";
  return `${prefix}.${field}`;
}

// A trailing "{LOC}" brace in baseName that merely restates the dataset location
// (mixAndLocationTypes) is redundant, not an unsplit qualifier. Strip it before the
// base-segment scan so it does not raise a false
// `semantic_name_base_contains_unsplit_segments` finding (which would otherwise force an
// unsupported name split, e.g. "Tyre wear emissions, passenger car {RER}" with
// mixAndLocationTypes "RER"). Genuine qualifier braces, or location braces that do NOT
// match the dataset location, are left in place and still flagged.
function stripRedundantTrailingLocationBrace(baseName: unknown, mix: unknown): string {
  const text = String(baseName ?? "").trim();
  const match = /\{(?<code>[A-Z0-9][A-Z0-9+&-]*)\}\s*$/u.exec(text);
  if (!match?.groups?.code) return text;
  const mixCode = locationCodeCandidate(mix);
  if (!mixCode) return text;
  const braceCode = locationCodeCandidate(match.groups.code);
  if (!braceCode || braceCode !== mixCode) return text;
  return text.slice(0, match.index).trim();
}

export function namePlanQualityFindings(name: unknown): NameFinding[] {
  const typedName = asRecord(name);
  const baseName = textValue(typedName.baseName);
  const treatment = textValue(typedName.treatmentStandardsRoutes);
  const mix = textValue(typedName.mixAndLocationTypes);
  const quantitative =
    textValue(typedName.functionalUnitFlowProperties) || textValue(typedName.flowProperties);
  const findings: NameFinding[] = [];
  const sourceLocatorPatterns = [
    {
      kind: "latin-author-year",
      // Season/period qualifiers ("summer 2018") are temporal scope, not citations.
      regex:
        /\b(?!(?:summer|winter|spring|autumn|fall)\s)[A-Z][A-Za-z]+(?:\s+et\s+al\.)?\s+(?:19|20)\d{2}\b/iu,
    },
    {
      kind: "cjk-author-year",
      regex: /[\p{Script=Han}·]{2,12}\s*(?:19|20)\d{2}/u,
    },
    {
      kind: "numbered-table",
      regex: /\b(?:Table|Tbl\.)\s*\d+[A-Za-z]?\b/iu,
    },
    {
      kind: "numbered-table-cjk",
      regex: /表\s*\d+/u,
    },
    {
      kind: "numbered-figure",
      regex: /\b(?:Figure|Fig\.)\s*\d+[A-Za-z]?\b/iu,
    },
    {
      kind: "numbered-figure-cjk",
      regex: /图\s*\d+/u,
    },
  ];
  for (const field of [
    ["baseName", baseName],
    ["treatmentStandardsRoutes", treatment],
    ["mixAndLocationTypes", mix],
    ["functionalUnitFlowProperties", quantitative],
  ]) {
    const [fieldName, text] = field;
    if (!text) continue;
    const matches = sourceLocatorPatterns
      .filter((pattern) => pattern.regex.test(text))
      .map((pattern) => pattern.kind);
    if (matches.length === 0) continue;
    findings.push({
      code: "semantic_name_source_locator_in_name",
      field: fieldName,
      path_field: fieldName,
      text,
      evidence_kind: "name_plan_source_locator_scan",
      detected_segments: matches,
    });
  }

  const basePatterns = [
    {
      kind: "availability_or_location_phrase",
      regex:
        /\b(?:at|to)\s+(?:freight ship|ship|plant|user|grid|market|sawmill|refinery|warehouse|consumer|regional storage|power plant|feed mill)\b/iu,
    },
    {
      kind: "mix_phrase",
      regex: /\b(?:production|market|consumption)\s+mix\b/iu,
    },
    {
      kind: "source_location_after_production",
      regex: /\bproduction\s+[A-Z]{2,3}\b/u,
    },
    {
      kind: "braced_location_or_qualifier",
      regex: /\{[A-Z0-9][A-Z0-9+&-]*\}/u,
    },
  ];
  const baseNameForBaseScan = stripRedundantTrailingLocationBrace(baseName, mix);
  const baseMatches = basePatterns
    .filter((pattern) => pattern.regex.test(baseNameForBaseScan))
    .map((pattern) => pattern.kind);
  if (baseMatches.length > 0) {
    findings.push({
      code: "semantic_name_base_contains_unsplit_segments",
      field: "baseName",
      path_field: "baseName",
      text: baseName,
      evidence_kind: "name_plan_base_segment_scan",
      detected_segments: baseMatches,
    });
  }

  const quantitativeBaseMatches = [
    // "wet & dry processes" is a manufacturing-route phrase (fibreboard), not a moisture state.
    /\b(?:wet(?!\s*&\s*dry|\s+and\s+dry)|dry mass|measured as dry mass|moisture|water content|allocation exergy)\b/iu,
    /\b(?:net calorific value|gross calorific value|lower heating value|upper heating value)\b/iu,
  ]
    .filter((regex) => regex.test(baseName))
    .map((regex) => regex.source);
  const quantitativeContainsSpecificQualifier =
    /\b(?:wet(?!\s*&\s*dry|\s+and\s+dry)|dry mass|measured as dry mass|moisture|water content|allocation exergy|net calorific value|gross calorific value|lower heating value|upper heating value)\b/iu.test(
      quantitative,
    );
  if (quantitativeBaseMatches.length > 0 && !quantitativeContainsSpecificQualifier) {
    findings.push({
      code: "semantic_name_quantitative_property_not_split",
      field: "baseName",
      path_field: "baseName",
      text: baseName,
      evidence_kind: "name_plan_quantitative_segment_scan",
      detected_segments: quantitativeBaseMatches,
    });
  }

  if (/^source-described route$/iu.test(treatment)) {
    findings.push({
      code: "semantic_name_treatment_placeholder",
      field: "treatmentStandardsRoutes",
      path_field: "treatmentStandardsRoutes",
      text: treatment,
      evidence_kind: "name_plan_placeholder_scan",
    });
  }

  const mixCode = locationCodeCandidate(mix);
  if (mixCode && mix === mixCode) {
    findings.push({
      code: "semantic_name_mix_location_too_bare",
      field: "mixAndLocationTypes",
      path_field: "mixAndLocationTypes",
      text: mix,
      evidence_kind: "name_plan_mix_location_scan",
      location_code_candidate: mixCode,
    });
  }

  return findings;
}

export function collectNamePlanQualitySemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  if (!["flow", "process", "lifecyclemodel"].includes(datasetType)) return [];
  const root = datasetRoot(payload, datasetType);
  const name = nameCarrier(root, datasetType);
  const findings = namePlanQualityFindings(name);
  return findings.map((finding) =>
    semanticActionItem({
      code: finding.code,
      path: nameFieldPath(datasetType, finding.path_field),
      message:
        finding.code === "semantic_name_treatment_placeholder"
          ? "name.treatmentStandardsRoutes still contains the generated placeholder source-described route."
          : finding.code === "semantic_name_mix_location_too_bare"
            ? "name.mixAndLocationTypes contains only a bare location code; the name plan should include the availability/mix/location-type phrase and keep the code in the formal geography/location field."
            : finding.code === "semantic_name_source_locator_in_name"
              ? "name contains source citation or source-locator text that belongs in provenance, source references, or source-backed property evidence rather than the dataset name."
              : finding.code === "semantic_name_quantitative_property_not_split"
                ? "name.baseName contains quantitative or allocation qualifiers that should be split into the formal name property field when source-backed."
                : "name.baseName contains route, mix, availability, or location segments that should be split into the structured TIDAS name fields.",
      evidence: {
        ...finding,
        // W8 public premises are referenced by identity; source-specific detection and
        // the decision to block remain Foundry policy, not copied public definitions.
        public_rule_refs:
          finding.code === "semantic_name_base_contains_unsplit_segments" ||
          finding.code === "semantic_name_quantitative_property_not_split"
            ? datasetType === "flow"
              ? ["tidas.flow.name.base-name.technical"]
              : datasetType === "process"
                ? ["tidas.process.name.qualifiers.structured"]
                : []
            : [],
        public_rule_source:
          "tiangong-lca/tidas-spec@ea4a58984c22734f2d54cda6d45b2733d9920ac0:assets/tidas/rules/public-rules.v1.json",
        current_name: {
          baseName: textValue(name?.baseName) || null,
          treatmentStandardsRoutes: textValue(name?.treatmentStandardsRoutes) || null,
          mixAndLocationTypes: textValue(name?.mixAndLocationTypes) || null,
          functionalUnitFlowProperties:
            textValue(name?.functionalUnitFlowProperties) ||
            textValue(name?.flowProperties) ||
            null,
        },
      },
      instruction:
        "Use the source-language name-plan workflow and full source context to split the name once: baseName keeps only the core product/process/service name; treatmentStandardsRoutes receives production/treatment/route qualifiers; mixAndLocationTypes receives availability, mix, and location-type phrases such as at plant {CH}; functionalUnitFlowProperties or flowProperties receives quantitative qualifiers. Preserve the original full source name in provenance/mapping, not in baseName.",
    }),
  );
}

export function sourceTraceLocationEvidence(traces: unknown): JsonRecord | null {
  const candidates = [
    firstTraceAttribute(traces, "exchange", "location"),
    firstTraceAttribute(
      traces,
      ["flow", "flowInformation", "dataSetInformation"],
      ["locationOfSupply", "mixAndLocationTypes", "location"],
    ),
    firstTraceAttribute(
      traces,
      ["process", "processInformation", "geography"],
      ["locationOfOperationSupplyOrProduction", "@location", "location"],
    ),
  ].filter((candidate): candidate is TraceAttribute => candidate !== null);
  if (candidates.length === 0) return null;
  const primary = candidates[0];
  return sourceTraceEvidence(primary, {
    suggested_value: locationCodeCandidate(primary.value) ?? primary.value,
    candidate_sources: candidates.map((candidate) => ({
      object_name: candidate.object_name,
      attribute_name: candidate.attribute_name,
      value: candidate.value,
      trace_path: candidate.trace_path,
      location_code_candidate: locationCodeCandidate(candidate.value),
    })),
  });
}

export function collectTextQualitySemanticActions(
  payload: unknown,
  datasetType: string,
): SemanticAction[] {
  const entries = collectTextEntries(payload);
  const actions: SemanticAction[] = [];
  const seen = new Set<string>();
  const add = (item: SemanticAction): void => {
    const key = JSON.stringify([item.code, item.path, item.message]);
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(item);
  };
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const pathLower = entry.path.toLowerCase();
    const isNameLike =
      pathLower.includes(".name.") ||
      pathLower.endsWith(".common:shortdescription.#text") ||
      pathLower.endsWith(".common:shortname.#text") ||
      pathLower.endsWith(".common:name.#text") ||
      pathLower.includes("functionalunitorother");
    if (
      /__AI_FILL_[A-Z0-9_]*__|TIDAS_IMPORT_PLACEHOLDER|UNSPECIFIED_TEXT|Not declared in source package|placeholder\.example|pending-confirmation/iu.test(
        text,
      )
    ) {
      add(
        semanticActionItem({
          code: "semantic_placeholder_text",
          path: entry.path,
          message:
            "Payload contains placeholder or unresolved import text that schema validation alone cannot accept.",
          evidence: { text },
          instruction:
            "Use the full schema/YAML/context authoring package to replace this with source-language content, or move unresolved provenance into common:other when schema permits.",
        }),
      );
    }
    if (/\bxx\b/iu.test(text) && isNameLike) {
      add(
        semanticActionItem({
          code: "semantic_name_placeholder_token",
          path: entry.path,
          message: 'Name-like text contains the placeholder token "xx".',
          evidence: { text },
          instruction:
            "Derive a source-language name plan from source evidence and TIDAS name YAML semantics; do not keep placeholder tokens in final name fields.",
        }),
      );
    }
    if (/\{[A-Z]{2,3}\}/u.test(text) && isNameLike) {
      add(
        semanticActionItem({
          code: "semantic_geography_token_in_name",
          path: entry.path,
          message:
            "Name-like text contains a geography token such as {GLO}; geography belongs in the geography/location fields or name-plan mix/location segment as defined by the contract.",
          evidence: { text },
          instruction:
            "Use the full schema/YAML/context authoring package to split geography out of base names and materialize display names from proper fields.",
        }),
      );
    }
    if (
      /\bBAFU ecoSpold1 source\b/iu.test(text) &&
      /\b(Not specified|No |not declared|is specified)\b/iu.test(text)
    ) {
      add(
        semanticActionItem({
          code: "semantic_source_system_boilerplate_visible",
          path: entry.path,
          message:
            "User-facing text contains source-system boilerplate. Source-system details should be evidence/provenance, not visible filler.",
          evidence: { text },
          instruction:
            'Use neutral source-language text such as "Not specified" when the schema requires content; preserve BAFU/ecoSpold provenance in evidence or common:other.',
          common_other_deferral_allowed: true,
        }),
      );
    }
    if (/\/Users\/|\.zip:|LCI ecoSpold version2 Files/iu.test(text)) {
      add(
        semanticActionItem({
          code: "semantic_local_source_path_visible",
          path: entry.path,
          message: "Payload contains local source path or package trace text in a visible field.",
          evidence: { text },
          instruction:
            "Move local/package trace to authoring evidence or safe common:other provenance before remote write.",
          common_other_deferral_allowed: true,
        }),
      );
    }
  }
  return actions.map((item) => ({ ...item, dataset_type: datasetType }));
}
