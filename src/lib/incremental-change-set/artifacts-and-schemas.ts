import fs from "node:fs";
import path from "node:path";
import type { ErrorObject } from "ajv";
import { createAjv2020 } from "../ajv2020-factory.ts";
import {
  SHA256_PATTERN,
  TERMINAL_SUCCESS_RECEIPT_SCHEMA,
  asToken,
  isObject,
  sha256Bytes,
  type ArtifactFacts,
  type JsonLineMeta,
  type JsonObject,
  type SchemaRuntime,
  type TerminalExclusion,
  type TerminalSuccessBinding,
} from "./types-and-primitives.ts";

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveLexicalInside(repoRoot: string, value: unknown, label: string): string {
  const token = asToken(value);
  if (!token) throw new Error(`${label} is required.`);
  const resolved = path.resolve(repoRoot, token);
  if (!pathInside(repoRoot, resolved)) throw new Error(`${label} must be inside the repository.`);
  return resolved;
}

export function resolveInputInside(repoRoot: string, value: unknown, label: string): string {
  const resolved = resolveLexicalInside(repoRoot, value, label);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} file not found.`);
  }
  const realRepoRoot = fs.realpathSync(repoRoot);
  const realPath = fs.realpathSync(resolved);
  if (!pathInside(realRepoRoot, realPath) || !fs.statSync(realPath).isFile()) {
    throw new Error(`${label} must resolve to a regular file inside the repository.`);
  }
  return realPath;
}

export function resolveFreshOutputInside(repoRoot: string, value: unknown, label: string): string {
  const resolved = resolveLexicalInside(repoRoot, value, label);
  if (fs.existsSync(resolved)) throw new Error(`${label} must not already exist.`);
  const realRepoRoot = fs.realpathSync(repoRoot);
  const parent = fs.realpathSync(path.dirname(resolved));
  if (!pathInside(realRepoRoot, parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`${label} parent must resolve inside the repository.`);
  }
  return path.join(parent, path.basename(resolved));
}

export function readJson<T = JsonObject>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function createSchemaValidators(repoRoot: string): SchemaRuntime {
  const schemaPath = path.join(repoRoot, "specs", "schemas", "incremental-change-set.schema.json");
  const schema = readJson(schemaPath);
  const ajv = createAjv2020({ allErrors: true, strict: true });
  ajv.addSchema(schema);
  const names = [
    "request",
    "comparisonRow",
    "ownerRow",
    "ownerSnapshotReceipt",
    "preservationPolicy",
    "terminalExclusion",
    "terminalSuccessReceipt",
    "conversionEvent",
    "noWriteRow",
    "holdRow",
    "dependencyClosure",
    "cliContract",
    "report",
    "manifest",
  ];
  return {
    validators: Object.fromEntries(
      names.map((name) => [name, ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` })]),
    ),
  };
}

export function assertSchema(
  schemaRuntime: SchemaRuntime,
  name: string,
  value: unknown,
  label: string,
): void {
  const validate = schemaRuntime.validators[name];
  if (!validate(value)) {
    const errors = (validate.errors ?? [])
      .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
      .join("; ");
    throw new Error(`${label} does not match ${name}: ${errors}`);
  }
}

export function readJsonLinesWithMeta<T extends JsonObject = JsonObject>(
  filePath: string,
): JsonLineMeta<T>[] {
  const buffer = fs.readFileSync(filePath);
  const rows: JsonLineMeta<T>[] = [];
  let line = 1;
  let start = 0;
  while (start <= buffer.length) {
    const newline = buffer.indexOf(0x0a, start);
    let end = newline === -1 ? buffer.length : newline;
    if (end > start && buffer[end - 1] === 0x0d) end -= 1;
    const raw = buffer.toString("utf8", start, end);
    if (raw.trim()) {
      rows.push({ value: JSON.parse(raw) as T, line, raw_sha256: sha256Bytes(raw) });
    }
    if (newline === -1) break;
    start = newline + 1;
    line += 1;
  }
  return rows;
}

export function artifactFacts(
  filePath: string,
  rows: number | null = null,
  schemaVersion: string | null = null,
): ArtifactFacts {
  const buffer = fs.readFileSync(filePath);
  return {
    path: path.basename(filePath),
    schema_version: schemaVersion,
    rows,
    bytes: buffer.byteLength,
    sha256: sha256Bytes(buffer),
  };
}

export function verifyArtifactRef(
  repoRoot: string,
  reference: unknown,
  label: string,
  jsonLines: boolean,
): { filePath: string; facts: ArtifactFacts } {
  if (!isObject(reference)) throw new Error(`${label} artifact reference is required.`);
  const filePath = resolveInputInside(repoRoot, reference.path, `${label}.path`);
  const facts = artifactFacts(filePath, jsonLines ? readJsonLinesWithMeta(filePath).length : null);
  if (
    typeof reference.sha256 !== "string" ||
    !SHA256_PATTERN.test(reference.sha256) ||
    reference.sha256 !== facts.sha256
  ) {
    throw new Error(`${label} SHA-256 mismatch.`);
  }
  if (
    typeof reference.bytes !== "number" ||
    !Number.isInteger(reference.bytes) ||
    reference.bytes !== facts.bytes
  ) {
    throw new Error(`${label} byte count mismatch.`);
  }
  if (
    jsonLines &&
    (typeof reference.rows !== "number" ||
      !Number.isInteger(reference.rows) ||
      reference.rows !== facts.rows)
  ) {
    throw new Error(`${label} row count mismatch.`);
  }
  return { filePath, facts };
}

export function verifyTerminalSuccessReceipt(
  repoRoot: string,
  exclusion: TerminalExclusion,
  line: number,
  schemaRuntime: SchemaRuntime,
): TerminalSuccessBinding {
  const reference = exclusion.success_receipt;
  const label = `terminal exclusion line ${line} success receipt`;
  const filePath = resolveInputInside(repoRoot, reference.path, `${label}.path`);
  const facts = artifactFacts(filePath, 1, reference.schema_version);
  if (
    reference.schema_version !== TERMINAL_SUCCESS_RECEIPT_SCHEMA ||
    reference.status !== "success" ||
    reference.sha256 !== facts.sha256 ||
    reference.bytes !== facts.bytes
  ) {
    throw new Error(`${label} path/schema/status/bytes/SHA binding is invalid.`);
  }
  const receipt = readJson(filePath);
  assertSchema(schemaRuntime, "terminalSuccessReceipt", receipt, label);
  if (
    receipt.schema_version !== reference.schema_version ||
    receipt.status !== reference.status ||
    receipt.action_id !== exclusion.action_id ||
    receipt.desired_sha256 !== exclusion.desired_sha256
  ) {
    throw new Error(`${label} does not bind the excluded action and desired payload.`);
  }
  return {
    action_id: exclusion.action_id,
    desired_sha256: exclusion.desired_sha256,
    receipt_path: reference.path,
    receipt_schema_version: reference.schema_version,
    receipt_status: reference.status,
    receipt_bytes: facts.bytes,
    receipt_sha256: facts.sha256,
  };
}

export function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function writeJsonLines(filePath: string, rows: readonly unknown[]): void {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    { mode: 0o600 },
  );
  fs.chmodSync(filePath, 0o600);
}
