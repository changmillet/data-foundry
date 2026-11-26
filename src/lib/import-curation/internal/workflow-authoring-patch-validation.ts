import { asText, ensureArray } from "./runtime-io.ts";
import {
  evidenceEntries,
  evidenceSourceKeys,
  evidenceTraceKeys,
  firstNonEmptyEvidenceValue,
} from "./workflow-evidence-primitives.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface EvidenceOperationOptions {
  operation: unknown;
  task: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function patchSetOperations(value: unknown): JsonRecord[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const operations = Array.isArray(record.operations)
    ? record.operations
    : Array.isArray(record.patches)
      ? record.patches
      : null;
  if (!operations || !operations.every((operation) => operation && typeof operation === "object")) {
    return null;
  }
  return operations as JsonRecord[];
}

export function patchPayloadPatchSets(rawPatch: unknown): unknown[] {
  if (Array.isArray(rawPatch)) return rawPatch;
  if (!rawPatch || typeof rawPatch !== "object") return [];
  if (patchSetOperations(rawPatch)) return [rawPatch];
  const record = rawPatch as JsonRecord;
  for (const key of ["patch_sets", "patchSets", "patches", "suggestions", "items"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

export function patchSetDatasetId(patchSet: unknown): string {
  const record = asRecord(patchSet);
  return asText(record.dataset_id ?? record.id ?? record.uuid ?? record.entity_id);
}

export function patchSetDatasetVersion(patchSet: unknown): string {
  const record = asRecord(patchSet);
  return asText(record.dataset_version ?? record.version) || "00.00.001";
}

export function patchSetAuthoringPackage(patchSet: unknown): string {
  const record = asRecord(patchSet);
  return asText(record.authoring_package ?? record.authoringPackage);
}

export function operationHasEvidence(operation: unknown): boolean {
  const record = asRecord(operation);
  const basis = asText(record.basis);
  const evidence = record.evidence;
  if (basis) return true;
  if (typeof evidence === "string") return evidence.trim().length > 0;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (evidence && typeof evidence === "object") return Object.keys(evidence).length > 0;
  return false;
}

export function taskRequiresFullContextEvidence(task: unknown): boolean {
  const context = asRecord(asRecord(task).context);
  return (
    asRecord(context.full_context_ai_completion).required === true ||
    asRecord(context.fullContextAiCompletion).required === true
  );
}

export function operationFullContextEvidenceBlockers({
  operation,
  task,
}: EvidenceOperationOptions): JsonRecord[] {
  if (!taskRequiresFullContextEvidence(task)) return [];
  const blockers: JsonRecord[] = [];
  const typedOperation = asRecord(operation);
  if (!asText(typedOperation.basis)) {
    blockers.push({
      code: "patch_basis_required_full_context",
      message:
        "Full-context AI patch operations must include basis explaining why the value follows from the package/context.",
    });
  }
  const structuredEntries = evidenceEntries(typedOperation.evidence).filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  );
  if (structuredEntries.length === 0) {
    blockers.push({
      code: "patch_structured_evidence_required_full_context",
      message:
        "Full-context AI patch operations require structured evidence; a free-text basis alone is invalid.",
    });
    return blockers;
  }
  const hasEvidencePointer = structuredEntries.some(
    (entry) =>
      firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
      firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
  );
  if (!hasEvidencePointer) {
    blockers.push({
      code: "patch_structured_evidence_incomplete_full_context",
      message:
        "Full-context AI patch evidence must include both a source/context identifier and a quote, trace, field path, citation, or equivalent pointer.",
    });
  }
  return blockers;
}

export function operationResolution(operation: unknown): JsonRecord | null {
  const resolution = asRecord(operation).resolution;
  return resolution && typeof resolution === "object" && !Array.isArray(resolution)
    ? (resolution as JsonRecord)
    : null;
}

export function operationResolutionMode(operation: unknown): string {
  return asText(operationResolution(operation)?.mode);
}

export function operationUsedContextKinds(operation: unknown): string[] {
  return ensureArray(
    operationResolution(operation)?.used_context_kinds ??
      operationResolution(operation)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

export function taskRequiredContextKinds(task: unknown): string[] {
  const context = asRecord(asRecord(task).context);
  const kinds = new Set(
    ensureArray(context.contract_context_files)
      .map((file) => asText(asRecord(file).kind))
      .filter(Boolean),
  );
  const requiredKinds = ensureArray(
    asRecord(context.full_context_ai_completion).required_context_kinds ??
      asRecord(context.fullContextAiCompletion).requiredContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
  const candidates =
    requiredKinds.length > 0
      ? requiredKinds
      : ["schema", "methodology_yaml", "ruleset", "classification_schema", "location_schema"];
  return candidates.filter((kind) => kinds.has(kind) || requiredKinds.includes(kind));
}

export function operationTouchesCommonOther(operation: unknown): boolean {
  const record = asRecord(operation);
  const pointer = asText(record.path);
  if (pointer.includes("/common:other") || pointer.includes("/tiangongfoundry:")) return true;
  return (
    JSON.stringify(record.value ?? "").includes("common:other") ||
    JSON.stringify(record.value ?? "").includes("tiangongfoundry:")
  );
}
