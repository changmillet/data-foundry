import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export const MANIFEST_SCHEMA = "foundry-final-delivery-manifest.v1";
export const REPORT_SCHEMA = "foundry-final-delivery-promotion-report.v1";
export const LEDGER_SCHEMA = "foundry-final-delivery-promotion-ledger-row.v1";
export const SEAL_SCHEMA = "foundry-final-delivery-promotion-seal.v1";

export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

// Content-addressed evidence must hash the same regardless of object key insertion order.
export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function safeRelativePath(value: unknown): boolean {
  return Boolean(
    typeof value === "string" &&
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    path.posix.normalize(value) === value,
  );
}

// Every promotion artifact is written with an exclusive create so earlier evidence is never
// overwritten, and a failed run leaves no partial replacement of prior bytes.
export function writeExclusive(filePath: string, content: string | Buffer): void {
  fs.writeFileSync(filePath, content, { flag: "wx" });
}

export function writeJsonExclusive(filePath: string, value: unknown): void {
  writeExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function relativeToRepo(repoRoot: string, filePath: string): string {
  return pathIsInside(repoRoot, filePath) ? path.relative(repoRoot, filePath) : filePath;
}

export type CheckSeverity = "P0" | "P1";

export type LedgerRow = {
  schema_version: string;
  check_id: string;
  status: "PASS" | "FAIL";
  severity: CheckSeverity | null;
  detail: string;
  evidence: unknown;
};

export type CheckCollector = {
  add: (
    checkId: string,
    passed: boolean,
    severity: CheckSeverity,
    detail: string,
    evidence?: unknown,
  ) => boolean;
  rows: LedgerRow[];
};

function collectStrings(value: unknown, out: string[]): void {
  // Keys are collected as well as values: a decoded key reaches a reader exactly like a value does,
  // and an escaped key can carry a literal a raw-byte scan never sees.
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      collectStrings(child, out);
    }
  }
}

// JSON string escaping can hide a literal from a raw byte scan, so the decoded keys and values of
// already-parsed content are scanned alongside the exact source bytes.
export function scanTextWithDecodedStrings(raw: string, value: unknown): string {
  const decoded: string[] = [];
  collectStrings(value, decoded);
  return decoded.length > 0 ? `${raw}\n${decoded.join("\n")}` : raw;
}

// Tab, newline and carriage return are the only control characters a supported text artifact may
// carry; any other C0 control or DEL means the bytes are not the text they claim to be.
function hasUnsupportedControl(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// The supported text encoding is strict UTF-8. Silent replacement would scan text that is not the
// artifact's own content, so an undecodable byte fails closed instead.
export function decodeArtifactText(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new PromotionArtifactError(
      "artifact_text_encoding_invalid",
      "A text artifact must be valid UTF-8 and cannot contain undecodable bytes.",
    );
  }
  if (hasUnsupportedControl(text)) {
    throw new PromotionArtifactError(
      "artifact_control_byte",
      "A text artifact cannot contain an unsupported control byte.",
    );
  }
  return text;
}

// Every parse failure carries a stable category. The message is for local debugging only and is
// never written into the promotion ledger or report, so raw artifact text cannot leak outward.
export class PromotionArtifactError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PromotionArtifactError";
    this.code = code;
  }
}

export function artifactErrorCode(error: unknown): string {
  return error instanceof PromotionArtifactError ? error.code : "artifact_parse_failed";
}

export function checkCollector(): CheckCollector {
  const rows: LedgerRow[] = [];
  function add(
    checkId: string,
    passed: boolean,
    severity: CheckSeverity,
    detail: string,
    evidence: unknown = null,
  ): boolean {
    rows.push({
      schema_version: LEDGER_SCHEMA,
      check_id: checkId,
      status: passed ? "PASS" : "FAIL",
      severity: passed ? null : severity,
      detail,
      evidence,
    });
    return passed;
  }
  return { add, rows };
}
