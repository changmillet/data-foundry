import crypto from "node:crypto";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

type RawHash = {
  algorithm?: string;
  sha256?: string;
  bytes?: number;
};

type SemanticHash = {
  algorithm?: string;
  domain?: string;
  canonicalizer_id?: string;
  sha256?: string;
};

type Freshness = {
  toolchain_fingerprint_sha256?: string;
  activation_epoch_id?: string;
  captured_at_utc?: string;
  source_fingerprint_sha256?: string;
  owner_session_fingerprint_sha256?: string;
  no_known_mutation_after_capture?: boolean;
};

export type StageLeaf = JsonRecord & {
  leaf_id?: string;
  role?: string;
  path?: string;
  raw_hash?: RawHash;
  semantic_hash?: SemanticHash;
  scope_binding_sha256?: string;
  dependency_leaf_ids?: string[];
  freshness_class?: string;
  freshness?: Freshness;
  executable_input?: boolean;
};

type AttemptState = JsonRecord & {
  status?: string;
  attempt_count?: number;
  primary_attempt_count?: number;
  dispatch_state?: string;
  mutation_state?: string;
  readback_state?: string;
};

export type StageManifest = JsonRecord & {
  schema_version?: string;
  stage_id?: string;
  producer_id?: string;
  revision?: number;
  predecessor_stage_manifest_sha256?: string | null;
  stage_root?: string;
  admission_mode?: string;
  production_authority?: boolean;
  scope_binding_sha256?: string;
  attempt_state?: AttemptState;
  findings?: { p0?: number; p1?: number };
  leaves?: StageLeaf[];
  boundary_contract_leaf_id?: string;
  reviewer_report_leaf_ids?: string[];
};

type BoundaryShape = JsonRecord & {
  cwd?: string;
  argv?: string[];
  program_path?: string;
  declared_fields?: string[];
  producer_outputs?: Record<string, string>;
  consumer_inputs?: Record<string, string>;
  network_mode?: string;
  network_dispatch_count?: number;
  database_dispatch_count?: number;
};

export type BoundaryContract = JsonRecord & {
  schema_version?: string;
  required?: BoundaryShape;
  observed?: BoundaryShape;
};

export type ReviewerReport = JsonRecord & {
  status?: string;
  reviewer_id?: string;
  scope_binding_sha256?: string;
  reviewed_leaf_ids?: string[];
  findings?: { p0?: number; p1?: number };
};

export type LedgerRow = {
  schema_version: string;
  check_id: string;
  status: "PASS" | "FAIL";
  severity: "P0" | "P1" | null;
  detail: string;
  evidence: unknown;
};

export type MaterializedLeaf = {
  leaf_id: string | null;
  path: string | null;
  role: string | null;
  executable_input: boolean;
  raw_sha256: string | null;
  semantic_sha256: string | null;
  freshness_class: string | null;
};

export type ValidationResult = {
  rows: LedgerRow[];
  materializedLeaves: MaterializedLeaf[];
  stageRoot: string | null;
  manifestSha256: string;
};

export type AddCheck = (
  checkId: string,
  passed: boolean,
  detail: string,
  evidence?: unknown,
) => boolean;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const STAGE_SCHEMA = "foundry-execution-capsule-stage.v1";
const BOUNDARY_SCHEMA = "foundry-execution-capsule-boundary.v1";
export const SEAL_SCHEMA = "foundry-execution-capsule-seal.v1";
export const REPORT_SCHEMA = "foundry-execution-capsule-admission-report.v1";
export const LEDGER_SCHEMA = "foundry-execution-capsule-admission-ledger-row.v1";

const FRESHNESS_CLASSES = new Set([
  "SEMANTIC_IMMUTABLE",
  "TOOLCHAIN_BOUND",
  "LIVE_RECONCILIATION",
  "OWNER_SESSION",
  "DERIVED_REPORT",
]);

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

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function canonicalSemanticBytes(
  buffer: Buffer,
  canonicalizerId: string | undefined,
): Buffer {
  switch (canonicalizerId) {
    case "raw-bytes-v1":
      return buffer;
    case "utf8-lf-v1":
      return Buffer.from(buffer.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
    case "canonical-json-v1":
      return Buffer.from(stableJson(JSON.parse(buffer.toString("utf8"))), "utf8");
    default:
      throw new Error(`Unsupported semantic canonicalizer: ${canonicalizerId || "<missing>"}`);
  }
}

export function semanticSha256(domain: string, canonicalBytes: Buffer): string {
  return sha256(Buffer.concat([Buffer.from(`${domain}\0`, "utf8"), canonicalBytes]));
}

export function dependencyIds(leaf: StageLeaf | undefined): string[] {
  return Array.isArray(leaf?.dependency_leaf_ids) ? leaf.dependency_leaf_ids : [];
}

function severityFor(code: string): "P0" | "P1" {
  if (
    code.startsWith("attempt_") ||
    code.startsWith("leaf_raw_") ||
    code.startsWith("leaf_semantic_") ||
    code.startsWith("leaf_path_") ||
    code.startsWith("leaf_file_") ||
    code.startsWith("dependency_") ||
    code.startsWith("scope_") ||
    code.startsWith("stage_")
  ) {
    return "P0";
  }
  return "P1";
}

export function checkCollector() {
  const rows: LedgerRow[] = [];
  function add(checkId: string, passed: boolean, detail: string, evidence: unknown = null) {
    rows.push({
      schema_version: LEDGER_SCHEMA,
      check_id: checkId,
      status: passed ? "PASS" : "FAIL",
      severity: passed ? null : severityFor(checkId),
      detail,
      evidence,
    });
    return passed;
  }
  return { add, rows };
}

export function dependencyCycle(leavesById: Map<string, StageLeaf>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(leafId: string, trail: string[]): string[] | null {
    if (visiting.has(leafId)) return [...trail, leafId];
    if (visited.has(leafId)) return null;
    visiting.add(leafId);
    const leaf = leavesById.get(leafId);
    for (const dependencyId of dependencyIds(leaf)) {
      if (!leavesById.has(dependencyId)) continue;
      const cycle = visit(dependencyId, [...trail, leafId]);
      if (cycle) return cycle;
    }
    visiting.delete(leafId);
    visited.add(leafId);
    return null;
  }
  for (const leafId of leavesById.keys()) {
    const cycle = visit(leafId, []);
    if (cycle) return cycle;
  }
  return null;
}

export function boundaryChecks(
  boundary: BoundaryContract,
  materializedLeafPaths: Set<string>,
  add: AddCheck,
): void {
  const schemaOk = boundary?.schema_version === BOUNDARY_SCHEMA;
  add(
    "boundary_schema",
    schemaOk,
    schemaOk ? "Boundary contract schema is supported." : `Expected ${BOUNDARY_SCHEMA}.`,
  );
  const required = boundary?.required;
  const observed = boundary?.observed;
  const shapesOk = isPlainObject(required) && isPlainObject(observed);
  add(
    "boundary_shapes",
    shapesOk,
    shapesOk ? "Required and observed boundary objects are present." : "Boundary objects missing.",
  );
  if (!shapesOk) return;

  const materializedShapeOk = Boolean(
    typeof required.cwd === "string" &&
    required.cwd.length > 0 &&
    Array.isArray(required.argv) &&
    required.argv.length > 0 &&
    required.argv.every((value) => typeof value === "string" && value.length > 0) &&
    typeof required.program_path === "string" &&
    required.program_path.length > 0 &&
    Array.isArray(required.declared_fields) &&
    required.declared_fields.length > 0 &&
    required.declared_fields.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(required.declared_fields).size === required.declared_fields.length &&
    isPlainObject(required.producer_outputs) &&
    Object.keys(required.producer_outputs).length > 0 &&
    Object.values(required.producer_outputs).every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    isPlainObject(required.consumer_inputs) &&
    Object.values(required.consumer_inputs).every(
      (value) => typeof value === "string" && value.length > 0,
    ),
  );
  add(
    "boundary_materialized_shape",
    materializedShapeOk,
    "The required boundary must fully type CWD, argv, program, declared fields, and materialized paths.",
  );

  for (const field of [
    "cwd",
    "argv",
    "program_path",
    "declared_fields",
    "producer_outputs",
    "consumer_inputs",
    "network_mode",
  ]) {
    const passed = exactJson(required[field], observed[field]);
    add(
      `boundary_exact_${field}`,
      passed,
      passed ? `${field} is exact.` : `${field} differs between required and observed boundary.`,
      passed ? null : { required: required[field] ?? null, observed: observed[field] ?? null },
    );
  }

  add(
    "boundary_network_disabled",
    required.network_mode === "disabled" && observed.network_mode === "disabled",
    "The capsule boundary must declare disabled network access.",
  );
  add(
    "boundary_zero_dispatch",
    observed.network_dispatch_count === 0 && observed.database_dispatch_count === 0,
    "Observed network and database dispatch counts must both be zero.",
    {
      network_dispatch_count: observed.network_dispatch_count ?? null,
      database_dispatch_count: observed.database_dispatch_count ?? null,
    },
  );
  add(
    "boundary_paths_materialized",
    isPlainObject(required.producer_outputs) &&
      Object.keys(required.producer_outputs).length > 0 &&
      exactJson(required.producer_outputs, required.consumer_inputs),
    "Producer outputs and consumer inputs must bind the same named materialized paths.",
  );
  const boundaryPaths = [
    required.program_path,
    ...Object.values(required.producer_outputs ?? {}),
    ...Object.values(required.consumer_inputs ?? {}),
  ];
  add(
    "boundary_paths_content_addressed",
    boundaryPaths.every((value) => materializedLeafPaths.has(value as string)),
    "The consumer program and every producer/consumer path must resolve to a content-addressed stage leaf.",
    { boundary_paths: boundaryPaths },
  );
  add(
    "boundary_argv_materialized",
    Array.isArray(required.argv) && required.argv.length > 0 && required.argv.every(Boolean),
    "The exact consumer argv must be a non-empty materialized array.",
  );
}

export function freshnessChecks(leaf: StageLeaf, add: AddCheck): void {
  const freshnessClass = leaf?.freshness_class;
  const known = FRESHNESS_CLASSES.has(freshnessClass ?? "");
  add(
    `freshness_class:${leaf?.leaf_id ?? "unknown"}`,
    known,
    known ? `Freshness class ${freshnessClass} is supported.` : "Unknown freshness class.",
  );
  if (!known) return;
  const freshness = leaf?.freshness;
  if (freshnessClass === "TOOLCHAIN_BOUND") {
    add(
      `freshness_toolchain:${leaf.leaf_id}`,
      isSha256(freshness?.toolchain_fingerprint_sha256),
      "Toolchain-bound leaves require a SHA-256 toolchain fingerprint.",
    );
  }
  if (freshnessClass === "LIVE_RECONCILIATION") {
    add(
      `freshness_live:${leaf.leaf_id}`,
      Boolean(
        freshness?.activation_epoch_id &&
        isIsoTimestamp(freshness?.captured_at_utc) &&
        isSha256(freshness?.source_fingerprint_sha256) &&
        freshness?.no_known_mutation_after_capture === true,
      ),
      "Live reconciliation leaves require epoch, capture time, source fingerprint, and no-mutation attestation.",
    );
  }
  if (freshnessClass === "OWNER_SESSION") {
    add(
      `freshness_owner_session:${leaf.leaf_id}`,
      Boolean(
        freshness?.activation_epoch_id &&
        isIsoTimestamp(freshness?.captured_at_utc) &&
        isSha256(freshness?.owner_session_fingerprint_sha256) &&
        freshness?.no_known_mutation_after_capture === true,
      ),
      "Owner-session leaves require epoch, capture time, session fingerprint, and no-mutation attestation.",
    );
  }
  if (freshnessClass === "DERIVED_REPORT") {
    add(
      `freshness_derived_dependencies:${leaf.leaf_id}`,
      dependencyIds(leaf).length > 0,
      "Derived reports require at least one dependency leaf.",
    );
  }
}
