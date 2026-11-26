import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { createAjv2020 } from "../ajv2020-factory.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
  flowDataSet?: JsonObject;
  processDataSet?: JsonObject;
  flowInformation?: JsonObject;
  processInformation?: JsonObject;
  dataSetInformation?: JsonObject;
  administrativeInformation?: JsonObject;
  publicationAndOwnership?: JsonObject;
  classificationInformation?: JsonObject;
  exchanges?: JsonObject;
  exchange?: JsonValue;
  referenceToFlowDataSet?: JsonObject;
  generalComment?: JsonValue;
  "common:classification"?: JsonObject;
  "common:class"?: JsonValue;
  "common:shortDescription"?: JsonValue;
  "common:synonyms"?: JsonValue;
  "common:other"?: JsonObject;
  "tidasimport:sourceTrace"?: JsonObject;
  payload?: JsonObject;
  sourceTrace?: JsonObject;
  attributes?: JsonValue;
  "#text"?: JsonValue;
  "@xml:lang"?: JsonValue;
  "@refObjectId"?: JsonValue;
}

export interface Entity extends JsonObject {
  table: string;
  id: string;
  version: string;
}

export interface ArtifactFacts extends JsonObject {
  path: string;
  schema_version: string | null;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface ArtifactRef extends JsonObject {
  path: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface VerifiedArtifact {
  filePath: string;
  facts: ArtifactRef;
}

export interface RawLine {
  line: number;
  offset: number;
  length: number;
  raw: Buffer;
}

export interface ParsedLine<T extends JsonObject = JsonObject> extends RawLine {
  value: T;
  raw_sha256: string;
}

export interface SchemaRuntime {
  request: ValidateFunction;
  admissionReceipt: ValidateFunction;
  candidateIndexRow: ValidateFunction;
  classificationRow: ValidateFunction;
}

export interface CandidateRow extends JsonObject {
  entity: Entity;
  path: string;
  filePath: string;
  bytes: number;
  sha256: string;
}

export interface SnapshotRow {
  entity: Entity;
  payload?: JsonObject;
  payload_sha256: string;
  user_id: string | null;
  state_code: number | null;
}

export interface SnapshotEntry extends SnapshotRow {
  offset: number;
  length: number;
  line: number;
  visibility: string;
}

export interface SnapshotIndex {
  filePath: string;
  fd: number;
  byKey: Map<string, SnapshotEntry[]>;
  entries: SnapshotEntry[];
}

export interface TopologyRequest extends JsonObject {
  campaign_id: string;
  production_authority: boolean;
  execution_id: string;
  candidate_package: ArtifactRef;
  input_artifacts: Record<string, ArtifactRef>;
  scope: { user_id: string; email: string; state_code: number; project_ref: string } & JsonObject;
  classification_policy: { conflict_flow_id: string; selected_code: string } & JsonObject;
  canonical_support: { flowproperties: string[]; unitgroups: string[] } & JsonObject;
  expected: {
    obsolete_flow_delete_ceiling: number;
    [key: string]: JsonValue | undefined;
  };
  cli_fingerprint: JsonObject;
}

export interface ClassificationRow extends JsonObject {
  entity: Entity;
  classification: JsonObject;
  selected_code: string | null;
  evidence_sha256: string;
}

export interface ActionRow extends JsonObject {
  action_id: string;
  desired_sha256: string;
}

export interface ExchangeOccurrence {
  token: string;
  number: string;
  occurrence: number;
  index: number;
  exchange: JsonObject;
}

export interface GermanSynonym {
  value: JsonObject;
  evidence_sha256: string;
}

export interface OverlayResult extends JsonObject {
  reference: JsonObject;
  chinese: JsonObject[];
}

export interface FlowMapping extends JsonObject {
  old_flow_id: string | null;
  new_flow_id: string;
  mapping_kind: string;
  evidence_sha256: string;
}

export interface ComposeOptions extends Record<string, unknown> {
  help?: unknown;
  request?: unknown;
  outDir?: unknown;
}

export interface AdmissionReceipt extends JsonObject {
  schema_version: string;
  select_only: boolean;
  fresh_owner_session: boolean;
  captured_at_utc: string;
  scope: JsonObject;
  candidate_package_sha256: string;
  request_binding_sha256: string;
  input_artifact_sha256: Record<string, string>;
  cli_fingerprint: JsonObject;
  fingerprints: Record<string, string>;
  guards: Record<string, number>;
}

export interface AjvRuntime {
  addSchema: (schema: object) => unknown;
  compile: (schema: object) => ValidateFunction;
}

export const REQUEST_SCHEMA = "foundry-topology-convergence-request.v1";
export const EVENT_SCHEMA = "foundry-topology-conversion-event.v1";
export const REPORT_SCHEMA = "foundry-topology-convergence-report.v1";
export const MANIFEST_SCHEMA = "foundry-topology-convergence-manifest.v1";
export const ADMISSION_SCHEMA = "foundry-topology-fresh-admission-receipt.v1";
export const SAVE_DRAFT_CONTRACT_SCHEMA = "dataset-save-draft-execution-contract.v1";
export const ABSENCE_DOMAIN = "foundry-topology-absence.v1";
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256Bytes(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Bytes(stableJson(value));
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function asToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function entityKey(entity: Entity): string {
  return `${entity.table}/${entity.id}@${entity.version}`;
}

export function artifactFacts(
  filePath: string,
  rows: number,
  schemaVersion: string | null,
): ArtifactFacts {
  const fd = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      bytes += read;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    path: path.basename(filePath),
    schema_version: schemaVersion,
    rows,
    bytes,
    sha256: hash.digest("hex"),
  };
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveInside(
  repoRoot: string,
  value: unknown,
  label: string,
  mustExist = true,
): string {
  const token = asToken(value);
  if (!token) throw new Error(`${label} is required.`);
  const resolved = path.resolve(repoRoot, token);
  if (!pathInside(repoRoot, resolved)) throw new Error(`${label} must be inside the repository.`);
  if (!mustExist) {
    const parent = fs.realpathSync(path.dirname(resolved));
    const realRoot = fs.realpathSync(repoRoot);
    if (!pathInside(realRoot, parent)) throw new Error(`${label} parent escapes the repository.`);
    return path.join(parent, path.basename(resolved));
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} file not found.`);
  }
  const realRoot = fs.realpathSync(repoRoot);
  const realPath = fs.realpathSync(resolved);
  if (!pathInside(realRoot, realPath) || !fs.statSync(realPath).isFile()) {
    throw new Error(`${label} must resolve to a regular file inside the repository.`);
  }
  return realPath;
}

export function resolveFreshOutput(repoRoot: string, value: unknown): string {
  const outDir = resolveInside(repoRoot, value, "--out-dir", false);
  if (fs.existsSync(outDir)) throw new Error("--out-dir must not already exist.");
  return outDir;
}

export function* rawJsonLines(filePath: string): Generator<RawLine> {
  const fd = fs.openSync(filePath, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let carry = Buffer.alloc(0);
  let carryOffset = 0;
  let fileOffset = 0;
  let line = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, fileOffset);
      if (!read) break;
      const incoming = Buffer.from(chunk.subarray(0, read));
      const combined = carry.length ? Buffer.concat([carry, incoming]) : incoming;
      const combinedOffset = carry.length ? carryOffset : fileOffset;
      let start = 0;
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) continue;
        let end = index;
        if (end > start && combined[end - 1] === 0x0d) end -= 1;
        const raw = combined.subarray(start, end);
        if (raw.toString("utf8").trim()) {
          line += 1;
          yield { line, offset: combinedOffset + start, length: end - start, raw };
        }
        start = index + 1;
      }
      carry = Buffer.from(combined.subarray(start));
      carryOffset = combinedOffset + start;
      fileOffset += read;
    }
    if (carry.toString("utf8").trim()) {
      line += 1;
      yield { line, offset: carryOffset, length: carry.length, raw: carry };
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function* jsonLines<T extends JsonObject = JsonObject>(
  filePath: string,
): Generator<ParsedLine<T>> {
  for (const line of rawJsonLines(filePath)) {
    let value: T;
    try {
      value = JSON.parse(line.raw.toString("utf8")) as T;
    } catch (error: unknown) {
      throw new Error(
        `${path.basename(filePath)} line ${line.line} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    yield { ...line, value, raw_sha256: sha256Bytes(line.raw) };
  }
}

export class JsonlWriter {
  readonly filePath: string;
  readonly fd: number;
  rows: number;
  closed: boolean;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, "wx", 0o600);
    this.rows = 0;
    this.closed = false;
  }

  write(value: unknown): number {
    if (this.closed) throw new Error(`Writer already closed: ${this.filePath}`);
    fs.writeSync(this.fd, `${stableJson(value)}\n`, null, "utf8");
    this.rows += 1;
    return this.rows;
  }

  close(): void {
    if (!this.closed) {
      fs.fsyncSync(this.fd);
      fs.closeSync(this.fd);
      this.closed = true;
    }
  }

  facts(schemaVersion: string | null): ArtifactFacts {
    this.close();
    return artifactFacts(this.filePath, this.rows, schemaVersion);
  }
}

export class ConversionEventWriter extends JsonlWriter {
  previous: string | null;

  constructor(filePath: string) {
    super(filePath);
    this.previous = null;
  }

  event(value: JsonObject): JsonObject {
    const event = {
      schema_version: EVENT_SCHEMA,
      sequence: this.rows + 1,
      ...value,
      previous_event_sha256: this.previous,
    } as JsonObject & { event_sha256?: string };
    event.event_sha256 = sha256Json(event);
    this.previous = event.event_sha256;
    this.write(event);
    return event;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  const fd = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function createSchemaRuntime(repoRoot: string): SchemaRuntime {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "specs", "schemas", "topology-convergence.schema.json"),
      "utf8",
    ),
  );
  const ajv = createAjv2020({ allErrors: true, strict: true, formats: { email: true } });
  ajv.addSchema(schema);
  return {
    request: ajv.compile({ $ref: `${schema.$id}#/$defs/request` }),
    admissionReceipt: ajv.compile({ $ref: `${schema.$id}#/$defs/admissionReceipt` }),
    candidateIndexRow: ajv.compile({ $ref: `${schema.$id}#/$defs/candidateIndexRow` }),
    classificationRow: ajv.compile({ $ref: `${schema.$id}#/$defs/classificationRow` }),
  };
}

export function assertSchema(validate: ValidateFunction, value: unknown, label: string): void {
  if (validate(value)) return;
  const details = (validate.errors ?? [])
    .map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ");
  throw new Error(`${label} schema mismatch: ${details}`);
}

export function verifyArtifactRef(
  repoRoot: string,
  ref: ArtifactRef,
  label: string,
  singleDocument = false,
): VerifiedArtifact {
  const filePath = resolveInside(repoRoot, ref?.path, `${label}.path`);
  const facts = artifactFacts(filePath, ref.rows, null);
  if (facts.sha256 !== ref.sha256 || facts.bytes !== ref.bytes) {
    throw new Error(`${label} SHA-256 or byte binding mismatch.`);
  }
  let rows = singleDocument ? 1 : 0;
  if (!singleDocument) {
    for (const ignored of rawJsonLines(filePath)) {
      void ignored;
      rows += 1;
    }
  }
  if (rows !== ref.rows) throw new Error(`${label} row-count binding mismatch.`);
  return { filePath, facts: { ...ref, path: ref.path } };
}

export function readCandidateIndex(
  repoRoot: string,
  verified: VerifiedArtifact,
  table: string,
  validate: ValidateFunction,
): CandidateRow[] {
  const rows: CandidateRow[] = [];
  const seen = new Set<string>();
  for (const { value, line } of jsonLines<CandidateRow>(verified.filePath)) {
    assertSchema(validate, value, `${table} candidate index line ${line}`);
    if (value.entity.table !== table)
      throw new Error(`${table} candidate line ${line} table mismatch.`);
    const key = entityKey(value.entity);
    if (seen.has(key)) throw new Error(`Duplicate candidate identity: ${key}`);
    seen.add(key);
    rows.push({ ...value, filePath: resolveInside(repoRoot, value.path, `${key}.path`) });
  }
  rows.sort((left, right) => compareText(entityKey(left.entity), entityKey(right.entity)));
  return rows;
}

export function loadCandidate(row: CandidateRow): JsonObject {
  const bytes = fs.readFileSync(row.filePath);
  if (bytes.length !== row.bytes || sha256Bytes(bytes) !== row.sha256) {
    throw new Error(`Candidate payload binding mismatch: ${entityKey(row.entity)}`);
  }
  return JSON.parse(bytes.toString("utf8")) as JsonObject;
}

function extractIdentity(payload: JsonObject, table: string): Entity {
  const root = table === "flows" ? payload?.flowDataSet : payload?.processDataSet;
  const information = table === "flows" ? root?.flowInformation : root?.processInformation;
  return {
    table,
    id: asToken(information?.dataSetInformation?.["common:UUID"]),
    version: asToken(
      root?.administrativeInformation?.publicationAndOwnership?.["common:dataSetVersion"],
    ),
  };
}

export function assertPayloadIdentity(payload: JsonObject, entity: Entity): void {
  const actual = extractIdentity(payload, entity.table);
  if (entityKey(actual) !== entityKey(entity)) {
    throw new Error(`Payload identity mismatch for ${entityKey(entity)}.`);
  }
}

function normalizeSnapshotRow(row: JsonObject, expectedTable: string, line: number): SnapshotRow {
  const entity = (row.entity ?? {
    table: row.table,
    id: row.id,
    version: row.version,
  }) as Entity;
  const payload = (row.payload ?? row.json_ordered) as JsonObject;
  if (
    entity?.table !== expectedTable ||
    !asToken(entity.id) ||
    !asToken(entity.version) ||
    !payload ||
    typeof payload !== "object"
  ) {
    throw new Error(`${expectedTable} snapshot line ${line} is malformed.`);
  }
  const payloadSha256 = row.payload_sha256 ?? sha256Json(payload);
  if (payloadSha256 !== sha256Json(payload)) {
    throw new Error(`${expectedTable} snapshot line ${line} payload hash mismatch.`);
  }
  assertPayloadIdentity(payload, entity);
  const stateCode = row.state_code ?? (row.owner as JsonObject | undefined)?.state_code;
  return {
    entity,
    payload,
    payload_sha256: payloadSha256,
    user_id: asToken(row.user_id ?? (row.owner as JsonObject | undefined)?.user_id) || null,
    state_code: stateCode == null ? null : Number(stateCode),
  };
}

export function buildSnapshotIndex(
  verified: VerifiedArtifact,
  table: string,
  visibility: string,
  request: TopologyRequest,
): SnapshotIndex {
  const byKey = new Map<string, SnapshotEntry[]>();
  const entries: SnapshotEntry[] = [];
  for (const { value, line, offset, length } of jsonLines(verified.filePath)) {
    const normalized = normalizeSnapshotRow(value, table, line);
    if (visibility === "owner") {
      if (
        normalized.user_id !== request.scope.user_id ||
        normalized.state_code !== request.scope.state_code
      ) {
        throw new Error(`${table} owner snapshot line ${line} is outside owner/state scope.`);
      }
    } else if (visibility === "public" && normalized.state_code !== 100) {
      throw new Error(`${table} public snapshot line ${line} is not state_code=100.`);
    } else if (
      visibility === "foreign" &&
      (normalized.user_id === request.scope.user_id || normalized.state_code !== 0)
    ) {
      throw new Error(`${table} foreign snapshot line ${line} is not foreign owner-draft.`);
    }
    const entry = {
      ...normalized,
      payload: undefined,
      offset,
      length,
      line,
      visibility,
    };
    const key = entityKey(normalized.entity);
    const same = byKey.get(key) ?? [];
    same.push(entry);
    byKey.set(key, same);
    entries.push(entry);
  }
  return { filePath: verified.filePath, fd: fs.openSync(verified.filePath, "r"), byKey, entries };
}

export function loadSnapshotPayload(index: SnapshotIndex, entry: SnapshotEntry): JsonObject {
  const buffer = Buffer.allocUnsafe(entry.length);
  fs.readSync(index.fd, buffer, 0, entry.length, entry.offset);
  const row = JSON.parse(buffer.toString("utf8")) as JsonObject;
  return (row.payload ?? row.json_ordered) as JsonObject;
}

export function closeSnapshotIndex(index: SnapshotIndex): void {
  if (index?.fd != null) fs.closeSync(index.fd);
}
