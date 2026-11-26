import { asText } from "./runtime-io.ts";

interface JsonRecord {
  [key: string]: unknown;
}

export function evidenceEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function firstNonEmptyEvidenceValue(entry: unknown, keys: readonly string[]): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  const record = entry as JsonRecord;
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) return value;
  }
  return "";
}

export const evidenceSourceKeys = [
  "source",
  "source_id",
  "sourceId",
  "source_file",
  "sourceFile",
  "context_kind",
  "contextKind",
  "citation",
  "cited_source",
  "citedSource",
  "provenance",
];

export const evidenceTraceKeys = [
  "quote_or_trace",
  "quoteOrTrace",
  "quote",
  "trace",
  "source_trace",
  "sourceTrace",
  "source_path",
  "sourcePath",
  "source_field",
  "sourceField",
  "field_path",
  "fieldPath",
  "json_pointer",
  "jsonPointer",
  "path",
  "evidence_path",
  "evidencePath",
  "pointer",
  "note",
  "excerpt",
];

export function hasNonEmptyTraceEvidence(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasNonEmptyTraceEvidence(item));
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

export function hasStructuredTraceEvidence(value: unknown): boolean {
  return evidenceEntries(value)
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .some(
      (entry) =>
        firstNonEmptyEvidenceValue(entry, evidenceSourceKeys) &&
        firstNonEmptyEvidenceValue(entry, evidenceTraceKeys),
    );
}
