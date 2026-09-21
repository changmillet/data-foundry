import { validateUniqueRootReadbacks } from "./post-write-root-proof.ts";
import { FoundryContextError } from "./foundry-runtime-context.ts";

type JsonRecord = Record<string, unknown>;

/**
 * Pure, strict parsers for the owner CLI evidence a repair preparation binds.
 *
 * This module never spawns a process and never reads the ambient environment: the owner CLI is
 * invoked by the repair preparation owner through the qualified runtime only, and every report that
 * comes back is validated here against the exact contract, scope and expectation Foundry admitted.
 * Anything unexpected - a wrong hash, an extra or reordered row, a claimed readback, a consumed
 * attempt, a false mode - fails closed instead of being accepted as success.
 */

export const FOUNDRY_REPAIR_PREPARATION_SCHEMA = "tiangong-foundry.repair-preparation.v1" as const;
export const FOUNDRY_REPAIR_EVIDENCE_SCHEMA = "tiangong-foundry.repair-cli-evidence.v1" as const;

export interface FoundryRepairActionExpectation {
  readonly action_id: string;
  readonly table: string;
  readonly id: string;
  readonly version: string;
  readonly before_sha256: string;
  readonly desired_sha256: string;
}

export interface FoundryRepairExpectation {
  readonly dataset_type: string;
  readonly contract_sha256: string;
  readonly execution_id: string;
  readonly owner_user_id: string;
  readonly project_ref: string;
  readonly state_code: string;
  readonly actions: readonly FoundryRepairActionExpectation[];
}

export interface FoundryRepairAdmission {
  readonly schema: string;
  readonly status: string;
  readonly policy: string;
  readonly before_sha256: string;
  readonly desired_sha256: string;
  readonly changed_paths: readonly string[];
  readonly publication_ready: false;
}

export interface FoundryRepairPreparedRow {
  readonly index: number;
  readonly action_id: string;
  readonly table: string;
  readonly id: string;
  readonly version: string;
  readonly desired_sha256: string;
  readonly validation_payload_sha256: string;
  readonly validation_layers: JsonRecord;
  readonly admission: FoundryRepairAdmission | null;
}

export interface FoundryRepairDryRunEvidence {
  readonly schema: typeof FOUNDRY_REPAIR_EVIDENCE_SCHEMA;
  readonly kind: "metadata_dry_run";
  readonly mode: "dry_run";
  readonly commit: false;
  readonly status: string;
  readonly contract_sha256: string;
  readonly execution_id: string;
  readonly rows: readonly FoundryRepairPreparedRow[];
}

export interface FoundryRepairNoChangeEvidence {
  readonly schema: typeof FOUNDRY_REPAIR_EVIDENCE_SCHEMA;
  readonly kind: "no_change_remote_readback";
  readonly validation_payload_sha256: string;
  readonly validation_layers: JsonRecord;
  readonly remote_status: string;
  readonly remote_rows: number;
  readonly remote_references: number;
  readonly remote_checks: number;
}

const shaPattern = /^[0-9a-f]{64}$/u;
const admissionKeys = [
  "schema",
  "status",
  "policy",
  "before_sha256",
  "desired_sha256",
  "changed_paths",
  "publication_ready",
] as const;
const admissionSchema = "dataset-draft-repair-admission.v1";
const admissionPolicy = "process-metadata-unknown-annual.v1";
const annualOnlyAuthoringCodes = new Set(["annual_supply_or_production_volume_missing"]);
const validationLayerNames = ["schema", "authoring_evidence", "content", "multilingual"] as const;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, code: string, label: string): JsonRecord {
  if (!isRecord(value)) fail(code, `${label} must be an object.`);
  return value;
}

function exactKeys(value: JsonRecord, keys: readonly string[], code: string, label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail(code, `${label} has missing or unsupported fields.`);
}

function sha(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || !shaPattern.test(value))
    fail(code, `${label} must be a lowercase SHA-256 hex digest.`);
  return value;
}

function text(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || !value.trim())
    fail(code, `${label} must be a non-empty string.`);
  return value.trim();
}

function validationLayers(value: unknown, code: string, label: string): JsonRecord {
  const layers = record(value, code, label);
  for (const name of validationLayerNames) {
    const layer = record(layers[name], code, `${label}.${name}`);
    if (!["passed", "failed"].includes(String(layer.status)))
      fail(code, `${label}.${name}.status must be passed or failed.`);
    if (
      !Array.isArray(layer.issues) ||
      layer.issue_count !== layer.issues.length ||
      (layer.status === "passed" && layer.issues.length !== 0) ||
      (layer.status === "failed" && layer.issues.length === 0)
    )
      fail(code, `${label}.${name} has inconsistent issue evidence.`);
  }
  return layers;
}

function layerStatus(layers: JsonRecord, name: string): string {
  return String(record(layers[name], "repair_evidence_invalid", name).status);
}

function layerIssues(layers: JsonRecord, name: string): JsonRecord[] {
  const layer = record(layers[name], "repair_evidence_invalid", name);
  if (!Array.isArray(layer.issues))
    fail("repair_evidence_invalid", `${name} layer must report its issues array.`);
  return layer.issues.map((issue) => record(issue, "repair_evidence_invalid", `${name} issue`));
}

function parseAdmission(
  value: unknown,
  action: FoundryRepairActionExpectation,
): FoundryRepairAdmission {
  const admission = record(value, "repair_admission_invalid", "Draft repair admission");
  exactKeys(admission, admissionKeys, "repair_admission_invalid", "Draft repair admission");
  if (
    admission.schema !== admissionSchema ||
    admission.status !== "admitted" ||
    admission.policy !== admissionPolicy ||
    admission.publication_ready !== false
  )
    fail(
      "repair_admission_invalid",
      "Draft repair admission schema, status, policy or publication flag is invalid.",
    );
  const before = sha(admission.before_sha256, "repair_admission_invalid", "Admission before hash");
  const desired = sha(
    admission.desired_sha256,
    "repair_admission_invalid",
    "Admission desired hash",
  );
  if (before !== action.before_sha256 || desired !== action.desired_sha256)
    fail(
      "repair_admission_invalid",
      "Draft repair admission must bind the exact action before and desired content.",
    );
  if (
    !Array.isArray(admission.changed_paths) ||
    !admission.changed_paths.length ||
    admission.changed_paths.some((path) => typeof path !== "string" || !path.trim())
  )
    fail("repair_admission_invalid", "Draft repair admission must list its changed paths.");
  return Object.freeze({
    schema: admissionSchema,
    status: "admitted" as const,
    policy: admissionPolicy,
    before_sha256: before,
    desired_sha256: desired,
    changed_paths: Object.freeze([...(admission.changed_paths as string[])]),
    publication_ready: false as const,
  });
}

/** The narrow unknown-annual exception: schema/content/multilingual pass, only the annual gap fails. */
function assertAnnualOnlyAuthoringGap(layers: JsonRecord): void {
  for (const name of ["schema", "content", "multilingual"] as const)
    if (layerStatus(layers, name) !== "passed")
      fail(
        "repair_evidence_invalid",
        `The unknown-annual exception requires the ${name} validation layer to pass.`,
      );
  if (layerStatus(layers, "authoring_evidence") !== "failed")
    fail(
      "repair_evidence_invalid",
      "A metadata repair row must keep its authoring evidence status truthful.",
    );
  const issues = layerIssues(layers, "authoring_evidence");
  if (!issues.length || issues.some((issue) => !annualOnlyAuthoringCodes.has(String(issue.code))))
    fail(
      "repair_evidence_invalid",
      "The only admissible authoring gap is the unknown annual supply or production volume.",
    );
}

/**
 * Validate the owner CLI's read-only `dataset save-draft --dry-run` report for one changed-scope
 * repair: nothing dispatched, nothing consumed, every action prepared and bound to the exact scope.
 */
export function parseFoundryRepairDryRunReport(
  report: unknown,
  expectation: FoundryRepairExpectation,
): FoundryRepairDryRunEvidence {
  const value = record(report, "repair_dry_run_invalid", "Owner CLI dry-run report");
  if (
    value.schema_version !== 2 ||
    value.status !== "completed" ||
    value.requested_type !== expectation.dataset_type ||
    value.mode !== "dry_run" ||
    value.commit !== false
  )
    fail(
      "repair_dry_run_invalid",
      "The owner CLI report must prove a read-only dry run with commit=false.",
    );
  const bound = record(value.execution_contract, "repair_dry_run_invalid", "Bound contract");
  if (
    bound.sha256 !== expectation.contract_sha256 ||
    bound.execution_id !== expectation.execution_id ||
    bound.target_mode !== "owner_draft"
  )
    fail(
      "repair_dry_run_invalid",
      "The owner CLI report must bind the exact canonical contract Foundry admitted.",
    );
  const counts = record(value.counts, "repair_dry_run_invalid", "Dry-run counts");
  const expectedActions = expectation.actions.length;
  if (
    expectation.state_code !== "0" ||
    expectedActions === 0 ||
    counts.selected !== expectedActions ||
    counts.prepared !== expectedActions ||
    counts.executed !== 0 ||
    counts.failed !== 0 ||
    counts.blocked !== 0 ||
    counts.unknown !== 0 ||
    counts.attempts_consumed !== 0
  )
    fail(
      "repair_dry_run_invalid",
      "A repair preflight must prepare every selected action with zero writes, zero blocks and zero consumed attempts.",
    );
  const reportRows: unknown[] = Array.isArray(value.rows) ? value.rows : [];
  if (reportRows.length !== expectedActions)
    fail("repair_dry_run_invalid", "The dry-run report must carry exactly one row per action.");
  const rows: FoundryRepairPreparedRow[] = expectation.actions.map((action, index) => {
    const row = record(reportRows[index], "repair_dry_run_invalid", `Row ${index + 1}`);
    if (
      row.index !== index ||
      row.type !== expectation.dataset_type ||
      row.table !== action.table ||
      row.id !== action.id ||
      row.version !== action.version ||
      row.action_id !== action.action_id ||
      row.desired_sha256 !== action.desired_sha256 ||
      row.status !== "prepared" ||
      row.operation !== "would_sync" ||
      row.attempt_consumed !== false ||
      row.replayed !== false
    )
      fail(
        "repair_dry_run_invalid",
        `Row ${index + 1} does not match the admitted action, order, draft operation or un-attempted state.`,
      );
    // A read-only preflight never claims a readback of the desired content.
    if (row.readback !== "not_performed")
      fail("repair_dry_run_invalid", `Row ${index + 1} must not claim a post-write readback.`);
    const visible = record(
      row.visible_row,
      "repair_dry_run_invalid",
      "Fresh owner-draft observation",
    );
    if (
      visible.id !== action.id ||
      visible.version !== action.version ||
      visible.user_id !== expectation.owner_user_id ||
      visible.state_code !== 0
    )
      fail("repair_dry_run_invalid", `Row ${index + 1} must bind the admitted owner account.`);
    const validation = record(
      row.validation,
      "repair_dry_run_invalid",
      `Row ${index + 1} validation`,
    );
    const payloadSha256 = sha(
      validation.payload_sha256,
      "repair_dry_run_invalid",
      `Row ${index + 1} validation payload hash`,
    );
    if (payloadSha256 !== action.desired_sha256)
      fail(
        "repair_dry_run_invalid",
        `Row ${index + 1} validation must hash the exact admitted candidate payload.`,
      );
    const layers = validationLayers(
      validation.validation_layers,
      "repair_dry_run_invalid",
      `Row ${index + 1} layers`,
    );
    let admission: FoundryRepairAdmission | null = null;
    if (row.draft_repair_admission !== undefined && row.draft_repair_admission !== null) {
      if (validation.ok !== false)
        fail(
          "repair_dry_run_invalid",
          `Row ${index + 1} must not claim a passing validation alongside a repair admission.`,
        );
      assertAnnualOnlyAuthoringGap(layers);
      admission = parseAdmission(row.draft_repair_admission, action);
    } else if (validation.ok !== true) {
      fail(
        "repair_dry_run_invalid",
        `Row ${index + 1} is neither fully valid nor covered by an admitted metadata repair exception.`,
      );
    } else if (
      validationLayerNames.some(
        (name) => layerStatus(layers, name) !== "passed" || layerIssues(layers, name).length !== 0,
      )
    ) {
      fail(
        "repair_dry_run_invalid",
        `Row ${index + 1} claims validity while a validation layer failed or retains issues.`,
      );
    }
    return Object.freeze({
      index,
      action_id: action.action_id,
      table: action.table,
      id: action.id,
      version: action.version,
      desired_sha256: action.desired_sha256,
      validation_payload_sha256: payloadSha256,
      validation_layers: layers,
      admission,
    });
  });
  return Object.freeze({
    schema: FOUNDRY_REPAIR_EVIDENCE_SCHEMA,
    kind: "metadata_dry_run" as const,
    mode: "dry_run" as const,
    commit: false as const,
    status: text(value.status, "repair_dry_run_invalid", "Dry-run status"),
    contract_sha256: expectation.contract_sha256,
    execution_id: expectation.execution_id,
    rows: Object.freeze(rows),
  });
}

/**
 * Validate the local `dataset validate` report used by the no-change path. The candidate may be
 * authoring-incomplete (unknown annual volume) but must never be schema, content or multilingual
 * invalid, and its payload hash must match the admitted content exactly.
 */
export function parseFoundryRepairValidateReport(
  report: unknown,
  expectation: FoundryRepairExpectation,
): { readonly payload_sha256: string; readonly validation_layers: JsonRecord } {
  const value = record(report, "repair_validate_invalid", "Local validation report");
  if (!Array.isArray(value.rows) || !value.rows.length)
    fail("repair_validate_invalid", "Local validation must report every selected row.");
  const wanted = expectation.actions.map((action) => action.desired_sha256).sort();
  const seen = new Set<string>();
  for (const entry of value.rows) {
    const row = record(entry, "repair_validate_invalid", "Validation row");
    const payloadSha256 = sha(
      row.payload_sha256,
      "repair_validate_invalid",
      "Validation row payload hash",
    );
    if (!wanted.includes(payloadSha256))
      fail(
        "repair_validate_invalid",
        "Every validated row must hash the exact admitted repair content.",
      );
    if (seen.has(payloadSha256))
      fail(
        "repair_validate_invalid",
        "Validation must report each selected identity exactly once.",
      );
    seen.add(payloadSha256);
    const layers = validationLayers(row.validation_layers, "repair_validate_invalid", "Row layers");
    for (const name of ["schema", "content", "multilingual"] as const)
      if (layerStatus(layers, name) !== "passed")
        fail(
          "repair_validate_invalid",
          `The no-change proof requires the ${name} validation layer to pass.`,
        );
    const authoring = layerStatus(layers, "authoring_evidence");
    if (authoring === "failed") {
      const issues = layerIssues(layers, "authoring_evidence");
      if (
        !issues.length ||
        issues.some((issue) => !annualOnlyAuthoringCodes.has(String(issue.code)))
      )
        fail(
          "repair_validate_invalid",
          "A failing authoring layer is only admissible for the unknown annual supply volume gap.",
        );
    }
  }
  if (seen.size !== wanted.length)
    fail("repair_validate_invalid", "Local validation must cover every admitted repair action.");
  const first = record(value.rows[0], "repair_validate_invalid", "Validation row");
  return Object.freeze({
    payload_sha256: sha(
      first.payload_sha256,
      "repair_validate_invalid",
      "Validation row payload hash",
    ),
    validation_layers: validationLayers(
      first.validation_layers,
      "repair_validate_invalid",
      "Validation layers",
    ),
  });
}

/**
 * Validate the `dataset verify-remote --compare-root-payload` report. Only a fully passed remote
 * readback with zero blockers, zero payload mismatches and no non-ok check status may support the
 * no-change proof; the same check runs for the before and the candidate rows.
 */
export function parseFoundryRepairRemoteReport(
  report: unknown,
  expectation: FoundryRepairExpectation,
): { readonly rows: number; readonly references: number; readonly checks: number } {
  const value = record(report, "repair_remote_invalid", "Remote verification report");
  if (value.status !== "passed_remote_verification")
    fail(
      "repair_remote_invalid",
      "The no-change proof requires a passed remote verification against the current rows.",
    );
  if (value.root_policy !== "existing")
    fail("repair_remote_invalid", "The no-change proof requires the existing root policy.");
  const counts = record(value.counts, "repair_remote_invalid", "Remote verification counts");
  const rows = counts.rows;
  const references = counts.references;
  const checks = counts.checked;
  if (
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(references) ||
    !Number.isSafeInteger(checks) ||
    rows !== expectation.actions.length ||
    (references as number) < expectation.actions.length ||
    (checks as number) !== (references as number) + expectation.actions.length ||
    counts.blockers !== 0
  )
    fail(
      "repair_remote_invalid",
      "Remote verification must cover every selected root and reference with zero blockers.",
    );
  if (
    counts.root_readback_checks !== expectation.actions.length ||
    counts.root_payload_mismatches !== 0 ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0
  )
    fail(
      "repair_remote_invalid",
      "A no-change proof requires exact root payload readback with zero mismatches.",
    );
  const byStatus = record(counts.by_status, "repair_remote_invalid", "Remote status counts");
  for (const [status, count] of Object.entries(byStatus))
    if (!Number.isSafeInteger(count) || (count as number) < 0)
      fail("repair_remote_invalid", "Remote status counts must be nonnegative integers.");
    else if (status !== "ok" && (count as number) > 0)
      fail(
        "repair_remote_invalid",
        `Remote verification reported a non-ok check status (${status}).`,
      );
  if (byStatus.ok !== checks)
    fail("repair_remote_invalid", "Remote verification must account for every check as passed.");
  return Object.freeze({
    rows,
    references: references as number,
    checks: checks as number,
  });
}

/** Bind the actual JSONL root proofs, rather than trusting summary counters. */
export function assertFoundryRepairRootProof(
  report: unknown,
  checks: unknown,
  expectation: FoundryRepairExpectation,
  content: "before" | "candidate",
): void {
  const counts = parseFoundryRepairRemoteReport(report, expectation);
  if (!Array.isArray(checks) || checks.length !== counts.checks)
    fail("repair_remote_invalid", "Remote check records must match the reported check count.");
  const records = checks.map((value) => record(value, "repair_remote_invalid", "Remote check"));
  if (records.some((value) => value.status !== "ok"))
    fail("repair_remote_invalid", "Every recorded remote check must pass.");
  const proof = validateUniqueRootReadbacks({
    intended: expectation.actions.map((action, index) => ({
      rowIndex: index,
      table: action.table,
      id: action.id,
      version: action.version,
      payloadSha256: content === "before" ? action.before_sha256 : action.desired_sha256,
    })),
    checks: records,
    targetUserId: expectation.owner_user_id,
    expectedStateCode: Number(expectation.state_code),
    allowTraceHashOnlyNormalization: false,
  });
  if (proof.blockers.length || proof.uniqueReadbackCount !== expectation.actions.length)
    fail(
      "repair_remote_invalid",
      "Exact root proof rejected: " + proof.blockers.map((item) => item.code).join(", "),
    );
}
