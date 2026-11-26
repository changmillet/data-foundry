import crypto from "node:crypto";
import type { ValidateFunction } from "ajv";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface Entity extends JsonObject {
  table: string;
  id: string;
  version: string;
}

export interface EvidenceRule extends JsonObject {
  entity_key: string;
  pointer: string;
  old_value_sha256: string;
  candidate_value_sha256: string;
  current_value_sha256: string;
  evidence_sha256: string;
  transform_id?: string;
  mode?: string;
  element_identity_pointer?: string;
}

export interface TablePolicy extends JsonObject {
  allow_insert: boolean;
  allow_update: boolean;
  semantic_noise_rules: EvidenceRule[];
  conflict_rules: EvidenceRule[];
  array_merge_rules: EvidenceRule[];
}

export interface PreservationPolicy extends JsonObject {
  schema_version: string;
  semantic_domain?: string;
  type_rank: string[];
  table_policies: Record<string, TablePolicy>;
}

export interface RequestScope extends JsonObject {
  allowed_tables: string[];
  allowed_target_keys: string[];
  allowed_update_pointer_prefixes: Record<string, string[]>;
  allow_account_local_support?: boolean;
}

export interface ArtifactReference extends JsonObject {
  path: string;
  sha256: string;
  bytes: number;
  rows?: number;
  schema_version?: string;
}

export interface IncrementalRequest extends JsonObject {
  schema_version: string;
  target_mode: string;
  production_authority: boolean;
  change_set_id: string;
  producer_id: string;
  project_ref: string;
  owner: { user_id: string; email: string } & JsonObject;
  scope: RequestScope;
  consumer: {
    schema_version: string;
    cli_version: string;
    toolchain_fingerprint_sha256: string;
  } & JsonObject;
  input_artifacts: {
    comparisons: ArtifactReference;
    owner_snapshot: ArtifactReference;
    owner_snapshot_receipt: ArtifactReference;
    preservation_policy: ArtifactReference;
    terminal_exclusions?: ArtifactReference;
  } & JsonObject;
}

export interface ComparisonRow extends JsonObject {
  __line: number;
  __raw_sha256: string;
  schema_version: string;
  conversion_id: string;
  entity: Entity;
  dependency_conversion_ids: string[];
  old_payload: JsonValue;
  new_payload: JsonValue;
  old_payload_sha256: string | null;
  new_payload_sha256: string | null;
}

export interface ComposeOptions extends Record<string, unknown> {
  help?: unknown;
  request?: unknown;
  outDir?: unknown;
}

export interface OwnerRow extends JsonObject {
  schema_version: string;
  role: string;
  project_ref: string;
  owner: { user_id: string; email: string } & JsonObject;
  state_code: number;
  payload_sha256: string | null;
  json_ordered: JsonValue;
  entity: Entity;
}

export interface MergeConflict extends JsonObject {
  pointer: string;
  reason: string;
}

export const MISSING = Symbol("missing");

export interface MergeResult {
  value: JsonValue | typeof MISSING;
  conflicts: MergeConflict[];
  preserved_paths: string[];
  applied_paths: string[];
  noise_paths: string[];
  noise_evidence_sha256: string[];
  preserve_owner_evidence_sha256: string[];
  take_candidate_evidence_sha256: string[];
  stable_array_evidence_sha256: string[];
  forbidden_paths?: string[];
}

export interface HashPair extends JsonObject {
  payload_sha256: string | null;
  semantic_sha256: string | null;
}

export interface ExecutionContract extends JsonObject {
  actions: JsonObject[];
}

export interface ArtifactFacts {
  path: string;
  bytes: number;
  sha256: string;
  rows: number | null;
  schema_version: string | null;
}

export interface InputFacts {
  request: ArtifactFacts;
  comparisons: ArtifactFacts;
  owner_snapshot: ArtifactFacts;
  owner_snapshot_receipt: ArtifactFacts;
  policy: ArtifactFacts;
  terminal_exclusions: ArtifactFacts | null;
}

export interface TerminalExclusion extends JsonObject {
  action_id: string;
  desired_sha256: string;
  success_receipt: ArtifactReference;
}

export interface TerminalSuccessBinding extends JsonObject {
  action_id: string;
  desired_sha256: string;
  receipt_path: string;
  receipt_schema_version: string;
  receipt_status: string;
  receipt_bytes: number;
  receipt_sha256: string;
}

export interface ConversionResult {
  input_sequence: number;
  source_line: number;
  source_raw_sha256: string;
  conversion_id: string;
  requested_conversion_id: string;
  entity: Entity;
  key: string;
  dependencies: string[];
  old_payload: JsonValue;
  candidate_payload: JsonValue;
  current_payload: JsonValue;
  desired_payload: JsonValue | null;
  hashes: Record<string, HashPair>;
  merge: MergeResult;
  evidence: JsonObject;
  terminal_success: TerminalSuccessBinding | null;
  disposition: string;
  reason_codes: string[];
  expected_operation: string | null;
  before_sha256: string | null;
  desired_sha256: string | null;
  action_id: string | null;
  dependency_action_ids: string[];
  dependency_dispositions: JsonObject[];
  duration_ms: number;
}

export interface JsonLineMeta<T extends JsonObject = JsonObject> {
  value: T;
  line: number;
  raw_sha256: string;
}

export interface SchemaRuntime {
  validators: Record<string, ValidateFunction>;
}

export interface OwnerSnapshotReceipt extends JsonObject {
  schema_version: string;
  project_ref: string;
  owner: { user_id: string; email: string; state_code: number } & JsonObject;
  snapshot: { sha256: string; bytes: number; rows: number } & JsonObject;
  scope_binding: {
    allowed_target_keys: string[];
    allowed_target_keys_sha256: string;
    canonical_scope_sha256: string;
  } & JsonObject;
  target_ledger: JsonValue[];
  captured_at_utc: string;
}

export interface ConversionEvent extends JsonObject {
  previous_event_sha256: string | null;
  event_sha256: string;
  evidence: JsonObject;
  outcome: { terminal_success: TerminalSuccessBinding | null } & JsonObject;
  decision_binding_sha256: string;
}

export interface AjvRuntime {
  addSchema: (schema: object) => unknown;
  compile: (schema: object) => ValidateFunction;
}

export const REQUEST_SCHEMA = "foundry-incremental-change-set-request.v1";
export const COMPARISON_SCHEMA = "foundry-incremental-change-set-comparison-row.v1";
export const OWNER_ROW_SCHEMA = "foundry-incremental-change-set-owner-row.v1";
export const OWNER_SNAPSHOT_RECEIPT_SCHEMA =
  "foundry-incremental-change-set-owner-snapshot-receipt.v1";
export const POLICY_SCHEMA = "foundry-incremental-change-set-preservation-policy.v1";
export const TERMINAL_SUCCESS_RECEIPT_SCHEMA =
  "foundry-incremental-change-set-terminal-success-receipt.v1";
export const EVENT_SCHEMA = "foundry-incremental-change-set-conversion-event.v1";
export const REPORT_SCHEMA = "foundry-incremental-change-set-report.v1";
export const MANIFEST_SCHEMA = "foundry-incremental-change-set-manifest.v1";
export const DEPENDENCY_SCHEMA = "foundry-incremental-change-set-dependency-closure.v1";
export const CLI_CONTRACT_SCHEMA = "dataset-save-draft-execution-contract.v1";
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const SAFE_TABLES = new Set([
  "contacts",
  "sources",
  "unitgroups",
  "flowproperties",
  "flows",
  "processes",
]);
export const TRUST_BOUNDARY_REASONS = new Set([
  "HOLD_DUPLICATE_CONVERSION_ID",
  "HOLD_DUPLICATE_TARGET",
  "HOLD_FOREIGN_OWNER",
  "HOLD_IDENTITY_MISMATCH",
  "HOLD_MULTIPLE_VISIBLE_ROWS",
  "HOLD_PAYLOAD_HASH_MISMATCH",
  "HOLD_PUBLIC_OR_FOREIGN_STATE",
  "HOLD_SCOPE_WIDENING",
  "HOLD_UNKNOWN_TABLE",
]);

export const TABLE_IDENTITIES: Record<string, readonly [string, string]> = {
  contacts: ["contactDataSet", "contactInformation"],
  sources: ["sourceDataSet", "sourceInformation"],
  unitgroups: ["unitGroupDataSet", "unitGroupInformation"],
  flowproperties: ["flowPropertyDataSet", "flowPropertiesInformation"],
  flows: ["flowDataSet", "flowInformation"],
  processes: ["processDataSet", "processInformation"],
};

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

export function semanticSha256(domain: string, value: unknown): string {
  return sha256Bytes(`${domain}\0${stableJson(value)}`);
}

export function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function clone<T>(value: T): T {
  return (value === MISSING ? MISSING : structuredClone(value)) as T;
}

export function exact(left: unknown, right: unknown): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  return stableJson(left) === stableJson(right);
}

export function asToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function entityKey(entity: Entity): string {
  return `${entity.table}/${entity.id}@${entity.version}`;
}

export function normalizedEntity(value: Entity | JsonObject | undefined): Entity {
  return {
    table: asToken(value?.table),
    id: asToken(value?.id),
    version: asToken(value?.version),
  };
}

export function pointerSegment(value: unknown): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function childPointer(pointer: string, key: unknown): string {
  return `${pointer}/${pointerSegment(key)}`;
}

export function pointerMatches(prefix: string, pointer: string): boolean {
  return (
    prefix !== "" && prefix !== "/" && (pointer === prefix || pointer.startsWith(`${prefix}/`))
  );
}

export function matchingPrefix(prefixes: Iterable<string>, pointer: string): string | undefined {
  return [...prefixes]
    .filter((prefix) => pointerMatches(prefix, pointer))
    .sort((left, right) => right.length - left.length)[0];
}

export function policyForTable(policy: PreservationPolicy, table: string): TablePolicy {
  const value = policy?.table_policies?.[table];
  return isObject(value)
    ? value
    : {
        allow_insert: false,
        allow_update: false,
        semantic_noise_rules: [],
        conflict_rules: [],
        array_merge_rules: [],
      };
}

export function presentValue(value: unknown): boolean {
  return value !== MISSING && value !== undefined;
}

export function valueSha256(value: unknown): string {
  return sha256Json(
    presentValue(value)
      ? { schema_version: "foundry-bound-value.v1", presence: "present", value }
      : { schema_version: "foundry-bound-value.v1", presence: "missing" },
  );
}

export function ruleMatchesValues(
  rule: EvidenceRule,
  entityKeyValue: string,
  pointer: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): boolean {
  return (
    rule.entity_key === entityKeyValue &&
    rule.pointer === pointer &&
    rule.old_value_sha256 === valueSha256(oldValue) &&
    rule.candidate_value_sha256 === valueSha256(candidateValue) &&
    rule.current_value_sha256 === valueSha256(currentValue)
  );
}

export function boundRule(
  rules: EvidenceRule[] | undefined,
  entityKeyValue: string,
  pointer: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): EvidenceRule | undefined {
  return (rules ?? []).find((rule) =>
    ruleMatchesValues(rule, entityKeyValue, pointer, oldValue, candidateValue, currentValue),
  );
}

export function canonicalDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const token = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (!match) return null;
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent)) return null;
  const digits = `${integer}${fraction}`;
  const point = integer.length + exponent;
  const expanded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [rawWhole, rawFraction = ""] = expanded.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/u, "") || "0";
  const trimmedFraction = rawFraction.replace(/0+$/u, "");
  const magnitude = trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  return /^0(?:\.0+)?$/u.test(magnitude) ? "0" : `${sign}${magnitude}`;
}

export function noiseRuleFor(
  tablePolicy: TablePolicy,
  entityKeyValue: string,
  pointer: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): EvidenceRule | null {
  const rule = boundRule(
    tablePolicy.semantic_noise_rules,
    entityKeyValue,
    pointer,
    oldValue,
    candidateValue,
    currentValue,
  );
  if (!rule || rule.transform_id !== "decimal_lexical_equivalence_v1") return null;
  const values = [oldValue, candidateValue, currentValue].map(canonicalDecimal);
  return values.every((value) => value != null && value === values[0]) ? rule : null;
}

export function pointerValue(value: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") return value;
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) && !Array.isArray(current)) return MISSING;
    if (!Object.hasOwn(current, segment)) return MISSING;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function valueAt(value: unknown, key: string): unknown {
  return isObject(value) && Object.hasOwn(value, key) ? value[key] : MISSING;
}

export function matchingNoiseRules(
  tablePolicy: TablePolicy,
  entityKeyValue: string,
  oldValue: unknown,
  candidateValue: unknown,
  currentValue: unknown,
): EvidenceRule[] {
  return (tablePolicy.semantic_noise_rules ?? [])
    .filter(
      (rule) =>
        noiseRuleFor(
          tablePolicy,
          entityKeyValue,
          rule.pointer,
          pointerValue(oldValue, rule.pointer),
          pointerValue(candidateValue, rule.pointer),
          pointerValue(currentValue, rule.pointer),
        ) === rule,
    )
    .sort((left, right) => compareText(left.pointer, right.pointer));
}

function normalizedDecimalMarker(value: unknown): JsonObject {
  return {
    schema_version: "foundry-normalized-decimal.v1",
    canonical_decimal: canonicalDecimal(value),
  };
}

function replacePointer<T>(value: T, pointer: string, replacement: unknown): T {
  const output = clone(value);
  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current = output as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = replacement;
  return output;
}

function normalizedSemanticProjection(payload: JsonValue, rules: EvidenceRule[]): JsonValue {
  if (payload == null) return null;
  return rules.reduce(
    (projection, rule) =>
      replacePointer(
        projection,
        rule.pointer,
        normalizedDecimalMarker(pointerValue(payload, rule.pointer)),
      ),
    payload,
  );
}

export function conversionHashSets({
  oldValue,
  candidateValue,
  currentValue,
  tablePolicy,
  entityKey: entityKeyValue,
  domain,
}: {
  oldValue: JsonValue;
  candidateValue: JsonValue;
  currentValue: JsonValue;
  tablePolicy: TablePolicy;
  entityKey: string;
  domain: string;
}) {
  const noiseRules = matchingNoiseRules(
    tablePolicy,
    entityKeyValue,
    oldValue,
    candidateValue,
    currentValue,
  );
  const hashSet = (payload: JsonValue): HashPair => {
    if (payload == null) return { payload_sha256: null, semantic_sha256: null };
    return {
      payload_sha256: sha256Json(payload),
      semantic_sha256: semanticSha256(domain, normalizedSemanticProjection(payload, noiseRules)),
    };
  };
  return {
    hashes: {
      old: hashSet(oldValue),
      candidate: hashSet(candidateValue),
      current: hashSet(currentValue),
    },
    noise_rules: noiseRules,
  };
}
