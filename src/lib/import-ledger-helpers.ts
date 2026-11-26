import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bundleRowTypes } from "./bundle-row-types.ts";
import {
  type AppendJsonLinesResult,
  type BlockerBucket,
  type ImportLedgerBlocker,
  type JsonRecord,
  type JsonValue,
  type NormalizedBlockerInput,
} from "./import-ledger-types.ts";

export function sha256(value: unknown): string {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function jsonLine(row: JsonRecord): string {
  return `${JSON.stringify(row)}\n`;
}

export function readJsonLinesIfExists<T extends JsonRecord = JsonRecord>(
  filePath: string | null,
): T[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as T) : [];
}

export function writeJsonLinesFile(filePath: string, rows: readonly JsonRecord[]): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

export function appendJsonLinesDedup<T extends JsonRecord & { ledger_key?: string }>(
  filePath: string,
  rows: readonly T[],
): AppendJsonLinesResult {
  ensureDir(path.dirname(filePath));
  const seen = new Set(
    readJsonLinesIfExists<T>(filePath)
      .map((row) => String(row?.ledger_key ?? ""))
      .filter(Boolean),
  );
  const pending: T[] = [];
  for (const row of rows) {
    const key = String(row?.ledger_key ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pending.push(row);
  }
  if (pending.length > 0) {
    fs.appendFileSync(filePath, pending.map(jsonLine).join(""));
  }
  return {
    file: filePath,
    appended: pending.length,
    skipped_existing: rows.length - pending.length,
  };
}

export function supportPluralForType(datasetType: string): string {
  return (
    (bundleRowTypes as Record<string, { plural: string }>)[datasetType]?.plural ??
    `${datasetType || "unknown"}s`
  );
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizedBlockerInputs(value: unknown): NormalizedBlockerInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => ({
    raw: raw as JsonValue,
    blocker: isJsonRecord(raw) ? (raw as ImportLedgerBlocker) : {},
  }));
}

export function rowPayload(row: JsonValue): JsonValue {
  return isJsonRecord(row) && isJsonRecord(row.payload) ? row.payload : row;
}

export function inferRowDatasetType(payload: JsonValue, fallbackType: unknown): string {
  for (const [datasetType, config] of Object.entries(bundleRowTypes)) {
    if (isJsonRecord(payload) && payload[config.rootKey]) return datasetType;
  }
  return fallbackType === "support"
    ? "support"
    : typeof fallbackType === "string" && fallbackType
      ? fallbackType
      : "unknown";
}

export function rowsFromValue(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value;
  if (isJsonRecord(value) && Array.isArray(value.rows)) return value.rows;
  if (isJsonRecord(value) && Array.isArray(value.items)) return value.items;
  return value && typeof value === "object" ? [value] : [];
}

export function blockerBucket(blocker: ImportLedgerBlocker): BlockerBucket {
  const text = [
    blocker?.code,
    blocker?.stage,
    blocker?.message,
    blocker?.dataset_type,
    blocker?.blocking_dependency?.dataset_type,
    blocker?.reference_type,
    blocker?.table,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(elementary|flow_?elementary)/u.test(text)) return "elementary-flow";
  if (
    /(canonical_?support|flow_?property|flowproperty|unit_?group|unitgroup|reference_only_support)/u.test(
      text,
    )
  ) {
    return "canonical-support";
  }
  if (/classification/u.test(text)) return "classification";
  if (/(identity|preflight|candidate)/u.test(text)) return "identity";
  if (/(remote_write|commit|post_write|readback|write failure|save-draft|publish)/u.test(text)) {
    return "remote-write";
  }
  if (
    /(reference_closure|reference closure|remote_verify|verify_remote|unproven|source|contact)/u.test(
      text,
    )
  ) {
    return "reference-closure";
  }
  if (
    /(saturation|full_context|semantic|curation|location|name_plan|synonym|placeholder|authoring)/u.test(
      text,
    )
  ) {
    return "content-saturation";
  }
  return "other";
}

export function humanActionForBlocker(blocker: ImportLedgerBlocker): string {
  const bucket = blockerBucket(blocker);
  const code = String(blocker?.code ?? "").toLowerCase();
  if (bucket === "classification") {
    return "Produce full-context semantic classification decisions and apply them through the deterministic classification-decision command, then rerun finalize.";
  }
  if (bucket === "elementary-flow") {
    return "Resolve physical-equivalence evidence against an existing canonical elementary flow, or keep the affected scope blocked for human review.";
  }
  if (bucket === "canonical-support") {
    return "Map the generated flowproperty/unitgroup support reference to an existing canonical support row, or add database governance data before rerun.";
  }
  if (bucket === "reference-closure") {
    return "Commit and verify the referenced writable source/contact/flow scope first, or replace placeholder references with true canonical provenance.";
  }
  if (bucket === "identity") {
    return code.includes("timeout")
      ? "Retry only the failed identity/preflight request rows, then merge the refreshed index and rerun finalize."
      : "Produce or refresh exact-payload identity reuse decisions, then rerun finalize.";
  }
  if (bucket === "content-saturation") {
    return "Patch provable schema fields from full context in one AI completion pass, apply deterministically, then rerun validation and finalize.";
  }
  if (bucket === "remote-write") {
    return "Inspect the CLI commit/readback artifact, repair the write or account guard issue, then rerun closeout for the same final rows.";
  }
  return "Review the blocker evidence, repair the affected dependency or row content, and rerun only the affected scope.";
}

export function latestByKey<T, K>(rows: readonly T[], keyFn: (row: T) => K): T[] {
  const latest = new Map<K, T>();
  for (const row of rows) {
    latest.set(keyFn(row), row);
  }
  return [...latest.values()];
}
