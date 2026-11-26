import { dataSetInformation, datasetRoot } from "./dataset-payload.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";
import { type ProfileLike } from "./workflow-context-types.ts";
import {
  classCode,
  classLevel,
  classText,
  locationCodeMapForPatch,
  processCategoryPathForCode,
} from "./workflow-patch-evidence.ts";
import {
  classificationEntriesForPayload,
  flowTypeForPayload,
  flowUsesElementaryClassification,
  jsonPointerToken,
  nameTextForPayload,
} from "./workflow-semantic-actions.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface TextLeaf {
  path: string;
  path_segments: string[];
  text: string;
}

interface PrewriteContentPolicy {
  path: string;
  relative_path: string;
  value: JsonRecord;
}

interface ContentQualityOptions {
  repoRoot: string | null;
  payload: unknown;
  datasetType: string;
  profile?: ProfileLike | null;
}

interface PrewriteIdentityOptions {
  allowAccountLocalSupportAndElementary?: boolean;
  profile?: ProfileLike | null;
}

interface QueueAuthoringOptions {
  repoRoot: string;
  datasetType?: string;
  payload: unknown;
  row: unknown;
}

interface QueueActionItem extends JsonRecord {
  code: string;
  path: string | null;
  instruction: string;
  evidence: JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function comparableText(value: unknown): string {
  return asText(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

export function classificationClassesForPayload(
  payload: unknown,
  datasetType: string,
): JsonRecord[] {
  const root = datasetRoot(payload, datasetType);
  const info = dataSetInformation(root, datasetType);
  const classification = info?.classificationInformation?.["common:classification"] ?? null;
  const classes = classification?.["common:class"] ?? classification?.["common:category"] ?? null;
  return ensureArray(classes).filter(isRecord);
}

export function classificationDisplayForPayload(payload: unknown, datasetType: string): string {
  return classificationClassesForPayload(payload, datasetType)
    .map((item) => asText(item?.["#text"] ?? item?.text ?? item?.label))
    .filter(Boolean)
    .join(" > ");
}

export function textContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(textContent).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    return asText(record["#text"] ?? record.text ?? record.label ?? record.name);
  }
  return asText(value);
}

export function sourcePrewriteIdentityBlockers(
  payload: unknown,
  datasetType: string,
): JsonRecord[] {
  if (datasetType !== "source") return [];
  const root = datasetRoot(payload, "source");
  const info = dataSetInformation(root, "source");
  const shortName = textContent(info?.["common:shortName"] ?? info?.shortName);
  const sourceCitation = textContent(info?.sourceCitation ?? info?.["common:sourceCitation"]);
  const classification = classificationDisplayForPayload(payload, "source");
  const blockers: JsonRecord[] = [];
  if (/^(ILCD format|Not specified|Not declared|Unspecified)$/iu.test(shortName)) {
    blockers.push({
      code: "source_identity_not_true_source",
      stage: "source_semantics",
      message:
        "Source shortName is a format/compliance/placeholder identity, not a true report, publication, or traceable source record.",
      short_name: shortName,
      source_citation: sourceCitation || null,
      classification: classification || null,
    });
  }
  if (/^(ILCD format|Not specified|Not declared|Unspecified)$/iu.test(sourceCitation)) {
    blockers.push({
      code: "source_citation_not_true_source",
      stage: "source_semantics",
      message:
        "Source citation is a format/compliance/placeholder identity, not bibliographic or report evidence.",
      short_name: shortName || null,
      source_citation: sourceCitation,
      classification: classification || null,
    });
  }
  if (/\b(Data set formats|Compliance systems)\b/iu.test(classification)) {
    blockers.push({
      code: "source_classification_not_true_source",
      stage: "source_semantics",
      message:
        "Source classification identifies a data format or compliance system. BAFU-owned source rows must be reports, publications, or traceable source records.",
      short_name: shortName || null,
      source_citation: sourceCitation || null,
      classification,
    });
  }
  return blockers;
}

export function flowPrewriteIdentityBlockers(
  payload: unknown,
  datasetType: string,
  allowAccountLocalSupportAndElementary = false,
): JsonRecord[] {
  if (datasetType !== "flow") return [];
  if (allowAccountLocalSupportAndElementary) return [];
  if (!flowUsesElementaryClassification(payload)) return [];
  const root = datasetRoot(payload, "flow");
  const info = dataSetInformation(root, "flow");
  const name = nameTextForPayload(payload, "flow");
  const classification = classificationEntriesForPayload(payload, "flow")
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(" > ");
  return [
    {
      code: "elementary_flow_write_blocked",
      stage: "flow_identity_reuse_policy",
      message:
        "Elementary flows are reference-only for Foundry imports. Select an existing TianGong database elementary flow and rewrite references instead of writing a BAFU-owned elementary flow.",
      flow_name: name || null,
      flow_type: flowTypeForPayload(payload) || null,
      flow_uuid: asText(info?.["common:UUID"] ?? info?.UUID) || null,
      classification: classification || null,
    },
  ];
}

const defaultPrewriteContentPolicyFile = "specs/prewrite-content-policy.json";

function readPrewriteContentPolicy(repoRoot: string | null): PrewriteContentPolicy | null {
  const policyPath = resolveRepoPath(repoRoot!, defaultPrewriteContentPolicyFile);
  if (!policyPath || !fileExists(policyPath)) return null;
  return {
    path: policyPath,
    relative_path: repoRelativePath(repoRoot!, policyPath),
    value: readJson<JsonRecord>(policyPath),
  };
}

function isFoundryTracePathSegments(pathSegments: string[]): boolean {
  return pathSegments.some((segment) => {
    const text = String(segment).toLowerCase();
    return text === "common:other" || text.startsWith("tiangongfoundry:");
  });
}

function payloadTextLeaves(
  value: unknown,
  pathSegments: string[] = [],
  leaves: TextLeaf[] = [],
): TextLeaf[] {
  if (isFoundryTracePathSegments(pathSegments)) return leaves;
  if (typeof value === "string") {
    leaves.push({
      path: pathSegments.length > 0 ? `/${pathSegments.map(jsonPointerToken).join("/")}` : "/",
      path_segments: pathSegments,
      text: value,
    });
    return leaves;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      payloadTextLeaves(item, [...pathSegments, String(index)], leaves),
    );
    return leaves;
  }
  if (!value || typeof value !== "object") return leaves;
  for (const [key, child] of Object.entries(value)) {
    payloadTextLeaves(child, [...pathSegments, key], leaves);
  }
  return leaves;
}

function normalizedPathSegments(pathSegments: string[]): string[] {
  return pathSegments.map((segment) => String(segment).replace(/^common:/u, ""));
}

function pathScopeMatches(pathSegments: string[], pathScope: unknown = {}): boolean {
  const typedScope = asRecord(pathScope);
  const raw = pathSegments.map(String);
  const normalized = normalizedPathSegments(pathSegments);
  const contains = ensureArray(typedScope.contains).map(String);
  const excludeContains = ensureArray(typedScope.exclude_contains).map(String);
  const hasSegment = (segment: string): boolean =>
    raw.includes(segment) || normalized.includes(segment.replace(/^common:/u, ""));
  if (contains.some((segment) => !hasSegment(segment))) return false;
  if (excludeContains.some((segment) => hasSegment(segment))) return false;
  return true;
}

function compilePolicyPattern(entry: unknown): RegExp | null {
  const typedEntry = asRecord(entry);
  try {
    return new RegExp(asText(typedEntry.pattern), asText(typedEntry.flags) || "u");
  } catch {
    return null;
  }
}

function policyLexiconEntries(policy: JsonRecord, rule: unknown): unknown[] {
  const typedRule = asRecord(rule);
  const lexiconName = asText(typedRule.lexicon);
  if (!lexiconName) return [];
  return ensureArray(asRecord(policy.lexicons)[lexiconName]);
}

export function prewriteContentQualityBlockers({
  repoRoot,
  payload,
  datasetType,
  profile = null,
}: ContentQualityOptions): JsonRecord[] {
  if (!["flow", "process", "lifecyclemodel"].includes(datasetType)) return [];
  const policy = readPrewriteContentPolicy(repoRoot);
  if (!policy) return [];
  const leaves = payloadTextLeaves(payload);
  const blockers: JsonRecord[] = [];
  for (const rule of ensureArray(policy.value.rules)) {
    const typedRule = asRecord(rule);
    const allowedTypes = ensureArray(typedRule.dataset_types).map(asText);
    if (allowedTypes.length > 0 && !allowedTypes.includes(datasetType)) continue;
    const entries = policyLexiconEntries(policy.value, rule);
    for (const leaf of leaves) {
      if (!pathScopeMatches(leaf.path_segments, typedRule.path_scope)) continue;
      for (const entry of entries) {
        const typedEntry = asRecord(entry);
        const pattern = compilePolicyPattern(entry);
        if (!pattern || !pattern.test(leaf.text)) continue;
        // A source naming convention classifies only its trailing metadata match.
        // Other matches, markers and fields still take the normal blocker path.
        const namingRule = asRecord(
          asRecord(asRecord(profile).domainRules).process_name_geography_year,
        );
        const geographySuffix = /\b(Global|EU)\s+(?:19|20)\d{2}(?:\s+v\d+)?$/iu.exec(leaf.text);
        if (
          datasetType === "process" &&
          asRecord(profile).id === "worldsteel" &&
          typedRule.code === "source_locator_in_dataset_name" &&
          typedEntry.id === "latin-author-year" &&
          namingRule.marker === "latin-author-year" &&
          namingRule.field === "baseName" &&
          leaf.path_segments.includes("baseName") &&
          geographySuffix &&
          geographySuffix.index > 0 &&
          ensureArray(namingRule.geographies).some(
            (geo) => asText(geo).toLowerCase() === geographySuffix[1].toLowerCase(),
          )
        ) {
          const matches = [
            ...leaf.text.matchAll(
              new RegExp(pattern.source, `${pattern.flags.replace(/g/gu, "")}g`),
            ),
          ];
          if (matches.length === 1 && matches[0].index === geographySuffix.index) continue;
        }
        blockers.push({
          code: asText(typedRule.code) || "prewrite_content_quality_blocked",
          stage: asText(typedRule.stage) || "prewrite_content_quality",
          message:
            asText(typedRule.message) ||
            "Write payload text violates the configured prewrite content policy.",
          dataset_type: datasetType,
          policy: policy.relative_path,
          rule_id: asText(typedRule.id) || null,
          lexicon: asText(typedRule.lexicon) || null,
          marker_id: asText(typedEntry.id) || null,
          path: leaf.path,
          text: leaf.text,
        });
      }
    }
  }
  return blockers;
}

export function prewriteIdentityBlockers(
  payload: unknown,
  datasetType: string,
  repoRoot: string | null = null,
  { allowAccountLocalSupportAndElementary = false, profile = null }: PrewriteIdentityOptions = {},
): JsonRecord[] {
  return [
    ...sourcePrewriteIdentityBlockers(payload, datasetType),
    ...flowPrewriteIdentityBlockers(payload, datasetType, allowAccountLocalSupportAndElementary),
    ...prewriteContentQualityBlockers({ repoRoot, payload, datasetType, profile }),
  ];
}

export function processClassificationClassesAreCanonical(
  repoRoot: string,
  classes: JsonRecord[],
): boolean {
  const rawCodes = classes.map(classCode).filter(Boolean);
  const leafCode = rawCodes.at(-1);
  const canonical = processCategoryPathForCode(repoRoot, leafCode);
  if (!leafCode || canonical.length === 0) return false;
  const canonicalPrefix = canonical.slice(0, rawCodes.length);
  if (rawCodes.join("/") !== canonicalPrefix.map((entry) => entry.code).join("/")) {
    return false;
  }
  return classes.every((item, index) => {
    const expected = canonicalPrefix[index];
    if (!expected) return false;
    const level = classLevel(item);
    const text = classText(item);
    return (level === null || level === expected.level) && (!text || text === expected.text);
  });
}

export function classificationQueueRowStillNeedsAuthoring({
  repoRoot,
  datasetType = "process",
  payload,
  row,
}: QueueAuthoringOptions): boolean {
  const typedRow = asRecord(row);
  const expectedDisplay = comparableText(typedRow.current_classification);
  if (!expectedDisplay) return true;
  const currentDisplay = comparableText(classificationDisplayForPayload(payload, datasetType));
  if (!currentDisplay) return true;
  if (currentDisplay === expectedDisplay) return true;
  if (
    datasetType === "process" &&
    !processClassificationClassesAreCanonical(
      repoRoot,
      classificationClassesForPayload(payload, datasetType),
    )
  ) {
    return true;
  }
  return false;
}

export function valueAtDotPath(value: unknown, dotPath: unknown): unknown {
  const parts = asText(dotPath).split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

export function locationQueueRowStillNeedsAuthoring({
  repoRoot,
  payload,
  row,
}: QueueAuthoringOptions): boolean {
  const typedRow = asRecord(row);
  const targetPath = asText(typedRow.target_path ?? typedRow.path);
  if (!targetPath) return true;
  const currentLocation = asText(valueAtDotPath(payload, targetPath));
  if (!currentLocation) return true;
  const queuedLocation = asText(typedRow.current_location ?? typedRow.location);
  if (!locationCodeMapForPatch(repoRoot).has(currentLocation)) return true;
  if (queuedLocation && currentLocation === queuedLocation) return true;
  return false;
}

export function classificationQueueActionItem(row: unknown): QueueActionItem {
  const typedRow = asRecord(row);
  const datasetType = asText(typedRow.dataset_type) || "process";
  const classificationPath =
    datasetType === "flow"
      ? "flowDataSet.flowInformation.dataSetInformation.classificationInformation.common:classification"
      : "processDataSet.processInformation.dataSetInformation.classificationInformation.common:classification";
  return {
    source: "classification_authoring_queue",
    code: asText(typedRow.code) || "process_classification_requires_authoring",
    path: classificationPath,
    message:
      asText(typedRow.message) ||
      "Converted classification requires AI authoring before remote write.",
    evidence: {
      current_classification: typedRow.current_classification ?? null,
      source_classification: typedRow.source_classification ?? null,
      authoring_context: typedRow.authoring_context ?? null,
      source_file: typedRow.source_file ?? null,
      classification_workflow: typedRow.classification_workflow ?? null,
    },
    instruction:
      asText(typedRow.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS classification workflow to choose the target classification. Preserve source classification only as provenance.",
    action_kind: "classification_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}

export function locationQueueActionItem(row: unknown): QueueActionItem {
  const typedRow = asRecord(row);
  return {
    source: "location_authoring_queue",
    code: asText(typedRow.code) || "location_code_requires_authoring",
    path: asText(typedRow.target_path ?? typedRow.path) || null,
    message:
      asText(typedRow.message) ||
      "Location value must be replaced with a valid TIDAS location code before remote write.",
    evidence: {
      current_location: typedRow.current_location ?? typedRow.location ?? null,
      target_path: typedRow.target_path ?? typedRow.path ?? null,
      location_workflow: typedRow.location_workflow ?? null,
      source_file: typedRow.source_file ?? null,
    },
    instruction:
      asText(typedRow.required_resolution) ||
      "Use the full schema/YAML/context package and TIDAS location classification workflow to choose the target location code.",
    action_kind: "location_decision_authoring",
    required_owner: "foundry_ai_authoring",
    ai_required: true,
    common_other_deferral_allowed: false,
  };
}
