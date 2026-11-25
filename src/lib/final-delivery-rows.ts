import {
  type JsonRecord,
  PromotionArtifactError,
  decodeArtifactText,
  isPlainObject,
  scanTextWithDecodedStrings,
} from "./final-delivery-manifest.ts";
import { type ParsedWorkbook, parseWorkbook } from "./final-delivery-workbook.ts";

export type ArtifactDescriptor = JsonRecord & {
  artifact_id?: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  rows?: number;
  schema?: string;
  row_count?: JsonRecord & { kind?: string; required_columns?: unknown };
};

export type ParsedArtifact = {
  json?: unknown;
  csv?: string[][];
  workbook?: ParsedWorkbook;
  rows: number | null;
  scanText: string | null;
};

export type ArtifactRuntime = {
  descriptor: ArtifactDescriptor;
  buffer: Buffer | null;
  parsed: ParsedArtifact | null;
  actualRows: number | null;
  path: string | null;
};

export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted)
    throw new PromotionArtifactError(
      "artifact_csv_invalid",
      "CSV contains an unterminated quoted field.",
    );
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

function normalizedJsonPointerToken(token: string): string {
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

export function jsonPointer(value: unknown, pointer: unknown): unknown {
  if (pointer === "") return value;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new PromotionArtifactError(
      "artifact_json_pointer_invalid",
      "JSON pointer must be empty or start with '/'.",
    );
  }
  return pointer
    .slice(1)
    .split("/")
    .map(normalizedJsonPointerToken)
    .reduce<unknown>((current, token) => {
      if (current === null || current === undefined || !Object.hasOwn(Object(current), token)) {
        throw new PromotionArtifactError(
          "artifact_json_pointer_invalid",
          `JSON pointer segment is missing: ${token}`,
        );
      }
      return (current as JsonRecord)[token];
    }, value);
}

// The supported text encoding is strict UTF-8. Silent replacement would scan text that is not the
// artifact's own content, so an undecodable byte fails closed instead.
// A no-row artifact is still scanned. Content that happens to be JSON is parsed so this path can
// never be weaker than an explicit JSON or JSONL row contract.
function bestEffortJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // fall through to JSONL
  }
  const rows: unknown[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    try {
      rows.push(JSON.parse(line) as unknown);
    } catch {
      return undefined;
    }
  }
  return rows.length > 0 ? rows : undefined;
}

// Each declared row contract is parsed and cross-checked against its own declared schema, so a
// descriptor cannot silently describe content of another kind.
export function parseArtifactRows(artifact: ArtifactDescriptor, buffer: Buffer): ParsedArtifact {
  const kind = artifact?.row_count?.kind;
  switch (kind) {
    case "json-object": {
      const text = decodeArtifactText(buffer);
      const value = JSON.parse(text);
      if (!isPlainObject(value))
        throw new PromotionArtifactError("artifact_json_invalid", "Expected one JSON object.");
      if (value.schema_version !== artifact.schema)
        throw new PromotionArtifactError(
          "artifact_json_schema_mismatch",
          "JSON schema_version mismatch.",
        );
      return { json: value, rows: 1, scanText: scanTextWithDecodedStrings(text, value) };
    }
    case "json-object-rows": {
      const text = decodeArtifactText(buffer);
      const value = JSON.parse(text);
      if (!isPlainObject(value) || !Array.isArray(value.rows)) {
        throw new PromotionArtifactError(
          "artifact_json_shape_invalid",
          "Expected a JSON object with a rows array.",
        );
      }
      if (value.schema_version !== artifact.schema)
        throw new PromotionArtifactError(
          "artifact_json_schema_mismatch",
          "JSON schema_version mismatch.",
        );
      return {
        json: value,
        rows: value.rows.length,
        scanText: scanTextWithDecodedStrings(text, value),
      };
    }
    case "json-array": {
      const text = decodeArtifactText(buffer);
      const value = JSON.parse(text);
      if (!Array.isArray(value))
        throw new PromotionArtifactError("artifact_json_shape_invalid", "Expected a JSON array.");
      return { json: value, rows: value.length, scanText: scanTextWithDecodedStrings(text, value) };
    }
    case "jsonl": {
      const text = decodeArtifactText(buffer);
      const values = text
        .split(/\r?\n/gu)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown);
      if (
        values.some((value) => !isPlainObject(value) || value.schema_version !== artifact.schema)
      ) {
        throw new PromotionArtifactError(
          "artifact_jsonl_schema_mismatch",
          "A JSONL row has a mismatched schema_version.",
        );
      }
      return {
        json: values,
        rows: values.length,
        scanText: scanTextWithDecodedStrings(text, values),
      };
    }
    case "csv": {
      const text = decodeArtifactText(buffer);
      const records = parseCsv(text);
      if (records.length === 0)
        throw new PromotionArtifactError("artifact_csv_invalid", "CSV contains no header row.");
      const headers = records[0] ?? [];
      const required = Array.isArray(artifact.row_count?.required_columns)
        ? (artifact.row_count.required_columns as unknown[])
        : [];
      if (required.some((column) => !headers.includes(String(column)))) {
        throw new PromotionArtifactError(
          "artifact_csv_columns_missing",
          "CSV required columns are missing.",
        );
      }
      // Quoted and escaped cells only appear after decoding, so the decoded records are scanned
      // alongside the raw bytes.
      return {
        csv: records,
        rows: Math.max(0, records.length - 1),
        scanText: scanTextWithDecodedStrings(text, records),
      };
    }
    case "xlsx": {
      const workbook = parseWorkbook(buffer);
      return { workbook, rows: null, scanText: workbook.scanText };
    }
    case "none": {
      // A no-row declaration describes row shape only; the bytes are still scanned. The strict
      // text contract rejects an opaque binary rather than claiming a full scan, and JSON content
      // is parsed so this path is never weaker than an explicit JSON row contract.
      const text = decodeArtifactText(buffer);
      return { rows: 0, scanText: scanTextWithDecodedStrings(text, bestEffortJson(text)) };
    }
    default:
      throw new PromotionArtifactError(
        "artifact_kind_unsupported",
        `Unsupported row_count.kind: ${kind ?? "<missing>"}`,
      );
  }
}
