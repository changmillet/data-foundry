import { FoundryContextError } from "./foundry-runtime-context.ts";
import { validateUniqueRootReadbacks, type RootReadbackCheck } from "./post-write-root-proof.ts";

type JsonRecord = Record<string, unknown>;

/**
 * Derive an integrity proof for a remote verification that blocked **only** on retained references.
 *
 * A `version_outdated` reference means the requested version exists exactly and is simply not the
 * newest published one. For a metadata repair over a draft, retaining such a reference unchanged is
 * not an integrity failure, so this module separates the integrity proof from the freshness finding
 * instead of letting the freshness finding veto the whole readback.
 *
 * This module is pure: it reads its inputs, never writes to them, spawns nothing and performs no
 * I/O. It does not rewrite the CLI report, does not change the CLI's status, and does not adjust
 * `counts` -- the raw status and every counter are reported back verbatim so a reader can see that
 * nothing was laundered into a generic quality pass. `publication_ready` is always `false`.
 *
 * Everything that is not explicitly admitted fails closed: a foreign status, a non-outdated
 * blocker, a reference whose exact version is not the requested one, an `ok` bucket that disagrees
 * with the records, duplicate or extra records, a re-declared expectation set, and any root
 * evidence that does not satisfy the unchanged strict exact-payload/owner/state rule.
 */

export const FOUNDRY_REPAIR_REFERENCE_PROOF_SCHEMA =
  "tiangong-foundry.repair-reference-proof.v1" as const;

/** The only status this proof admits: remote verification ran and blocked on retained references. */
const RETAINED_REFERENCE_STATUS = "blocked_remote_verification";
const RETAINED_REFERENCE_ROOT_POLICY = "existing";
const RETAINED_OUTDATED_STATUS = "version_outdated";
const RETAINED_OK_STATUS = "ok";
const REFERENCE_ROLE = "reference";
const ROOT_ROLE = "root";
const READBACK_SUFFIX = "#readback";

const CHECK_STATUSES = Object.freeze([
  "ok",
  "lookup_failed",
  "missing_dataset",
  "missing_version",
  "owner_mismatch",
  "payload_mismatch",
  "remote_payload_missing",
  "state_code_mismatch",
  "unsupported_type",
  "version_missing",
  "version_outdated",
] as const);

/** A reference check and a root resolvability check share one shape; the readback adds five fields. */
const PROBE_KEYS = Object.freeze([
  "row_index",
  "role",
  "table",
  "type",
  "id",
  "version",
  "path",
  "short_description",
  "status",
  "exact_version",
  "latest_version",
  "exact_source_url",
  "latest_source_url",
  "message",
] as const);
const READBACK_KEYS = Object.freeze([
  ...PROBE_KEYS,
  "local_payload_sha256",
  "remote_payload_sha256",
  "remote_user_id",
  "remote_state_code",
  "remote_modified_at",
] as const);
const BLOCKER_KEYS = Object.freeze([
  "code",
  "severity",
  "message",
  "row_index",
  "role",
  "table",
  "id",
  "version",
  "latest_version",
  "path",
] as const);

const VERSION_PATTERN = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/u;

export interface FoundryRepairExpectedReference {
  readonly row_index: number;
  readonly path: string;
  readonly table: string;
  readonly id: string;
  readonly version: string;
}

export interface FoundryRepairExpectedRoot extends FoundryRepairExpectedReference {
  readonly payload_sha256: string;
}

export interface FoundryRepairRetainedReferenceRequest {
  readonly report: unknown;
  readonly checks: readonly unknown[];
  /** Exact roots: the declared payload hash is enforced by the unchanged root-proof rule. */
  readonly roots: readonly FoundryRepairExpectedRoot[];
  /** Every reference the caller asserts is unchanged between the before and candidate payloads. */
  readonly references: readonly FoundryRepairExpectedReference[];
  readonly target_user_id: string;
  readonly expected_state_code: number;
}

export interface FoundryRepairOutdatedReference {
  readonly row_index: number;
  readonly table: string;
  readonly id: string;
  readonly version: string;
  readonly latest_version: string;
  readonly path: string;
}

export interface FoundryRepairReferenceProof {
  readonly schema: typeof FOUNDRY_REPAIR_REFERENCE_PROOF_SCHEMA;
  /** The CLI's own status, reported unchanged. Never `passed_remote_verification`. */
  readonly raw_status: string;
  readonly raw_blocker_count: number;
  /** The CLI's own counters, reported unchanged. */
  readonly counts: JsonRecord;
  readonly root_readbacks: number;
  readonly references_verified: number;
  readonly ok_checks: number;
  readonly outdated: readonly FoundryRepairOutdatedReference[];
  readonly publication_ready: false;
}

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) fail("repair_reference_proof_invalid", `${label} must be an object.`);
  return value;
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("repair_reference_proof_invalid", `${label} has missing or unsupported fields.`);
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail("repair_reference_proof_invalid", `${label} count must be a nonnegative integer.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    fail("repair_reference_proof_invalid", `${label} must be a non-empty string.`);
  return value.trim();
}

type Triplet = readonly [number, number, number];

function versionTriplet(value: unknown, label: string): Triplet {
  const match = typeof value === "string" ? VERSION_PATTERN.exec(value.trim()) : null;
  if (!match)
    fail(
      "repair_reference_proof_invalid",
      `${label} version must be an explicit three-part version.`,
    );
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: Triplet, right: Triplet): number {
  for (let index = 0; index < 3; index += 1) {
    const delta = left[index] - right[index];
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

/** Identity of one reference occurrence: the same target on another path is another occurrence. */
function referenceKey(value: {
  row_index: number;
  path: string;
  table: string;
  id: string;
  version: string;
}): string {
  return JSON.stringify([value.row_index, value.path, value.table, value.id, value.version]);
}

function expectedReferences(
  references: readonly FoundryRepairExpectedReference[],
  label: string,
): Map<string, FoundryRepairExpectedReference> {
  const map = new Map<string, FoundryRepairExpectedReference>();
  for (const [index, reference] of references.entries()) {
    const item = record(reference, `${label} ${index + 1}`);
    const key = referenceKey({
      row_index: count(item.row_index, `${label} row index`),
      path: text(item.path, `${label} path`),
      table: text(item.table, `${label} table`),
      id: text(item.id, `${label} id`),
      version: text(item.version, `${label} version`),
    });
    if (map.has(key))
      fail("repair_reference_proof_invalid", `${label} contains a duplicate occurrence.`);
    map.set(key, {
      row_index: count(item.row_index, `${label} row index`),
      path: text(item.path, `${label} path`),
      table: text(item.table, `${label} table`),
      id: text(item.id, `${label} id`),
      version: text(item.version, `${label} version`),
    });
  }
  return map;
}

export function proveRetainedRepairReferences(
  input: FoundryRepairRetainedReferenceRequest,
): FoundryRepairReferenceProof {
  const report = record(input.report, "Remote verification report");
  const status = text(report.status, "Remote verification status");
  if (status !== RETAINED_REFERENCE_STATUS)
    fail(
      "repair_reference_proof_invalid",
      "A retained-reference proof requires a blocked remote verification status.",
    );
  if (
    text(report.root_policy, "Remote verification root policy") !== RETAINED_REFERENCE_ROOT_POLICY
  )
    fail(
      "repair_reference_proof_invalid",
      "A retained-reference proof requires the existing root policy.",
    );

  const counts = record(report.counts, "Remote verification counts");
  const rows = count(counts.rows, "Reported rows");
  const references = count(counts.references, "Reported references");
  const checked = count(counts.checked, "Reported checked");
  const rawBlockers = count(counts.blockers, "Reported blockers");
  const rootReadbackChecks = count(counts.root_readback_checks, "Reported root readback checks");
  const rootPayloadMismatches = count(counts.root_payload_mismatches, "Reported root payload");

  const expectedRoots = expectedReferences(input.roots, "Expected root");
  const expectedRefs = expectedReferences(input.references, "Expected reference");
  if (rootPayloadMismatches !== 0)
    fail(
      "repair_reference_proof_invalid",
      "A retained-reference proof requires zero root payload mismatches.",
    );
  // The CLI counts one root row, one root readback per root, and every remaining record -- the root
  // resolvability record included -- as a reference. Declared expectations must account for every
  // record, so a caller can neither widen nor narrow the retained set.
  if (rows !== input.roots.length || rootReadbackChecks !== input.roots.length)
    fail(
      "repair_reference_proof_invalid",
      "Report counts must match the declared roots and references exactly; a caller cannot widen or narrow the retained set.",
    );
  if (references !== input.roots.length + input.references.length)
    fail(
      "repair_reference_proof_invalid",
      "Report counts must match the declared roots and references exactly; a caller cannot widen or narrow the retained set.",
    );
  if (checked !== rows + references)
    fail(
      "repair_reference_proof_invalid",
      "Report counts must match the declared roots, references and checks exactly.",
    );
  if (!Array.isArray(input.checks) || input.checks.length !== checked || !input.checks.length)
    fail(
      "repair_reference_proof_invalid",
      "The check records must be present and match the reported check count exactly.",
    );

  const byStatus = record(counts.by_status, "Remote verification status buckets");
  for (const [bucket, value] of Object.entries(byStatus)) {
    if (!(CHECK_STATUSES as readonly string[]).includes(bucket))
      fail(
        "repair_reference_proof_invalid",
        `Report status bucket ${bucket} is not a known status.`,
      );
    count(value, `Report status bucket ${bucket}`);
  }

  const blockers: unknown[] = Array.isArray(report.blockers) ? report.blockers : [];
  if (blockers.length !== rawBlockers)
    fail(
      "repair_reference_proof_invalid",
      "The blocker records must match the reported blocker count.",
    );

  const readbackChecks: RootReadbackCheck[] = [];
  const probeChecks: JsonRecord[] = [];
  for (const [index, value] of input.checks.entries()) {
    const check = record(value, `Check ${index + 1}`);
    const role = text(check.role, `Check ${index + 1} role`);
    const isReadback = role === ROOT_ROLE && String(check.path ?? "").endsWith(READBACK_SUFFIX);
    exactKeys(check, isReadback ? READBACK_KEYS : PROBE_KEYS, `Check ${index + 1}`);
    if (role !== ROOT_ROLE && role !== REFERENCE_ROLE)
      fail("repair_reference_proof_invalid", `Check ${index + 1} role is unsupported.`);
    if (isReadback) readbackChecks.push(check);
    else probeChecks.push(check);
  }

  // Root evidence: one resolvability record and one strict exact readback per declared root.
  const rootResolve = probeChecks.filter((check) => check.role === ROOT_ROLE);
  const referenceProbes = probeChecks.filter((check) => check.role === REFERENCE_ROLE);
  if (rootResolve.length !== input.roots.length || readbackChecks.length !== rootReadbackChecks)
    fail(
      "repair_reference_proof_invalid",
      "Root evidence must carry exactly one resolvability record and one readback per declared root.",
    );
  const seenRoots = new Set<string>();
  for (const check of rootResolve) {
    const key = referenceKey({
      row_index: count(check.row_index, "Root row index"),
      path: text(check.path, "Root path"),
      table: text(check.table, "Root table"),
      id: text(check.id, "Root id"),
      version: text(check.version, "Root version"),
    });
    const declared = expectedRoots.get(key);
    if (!declared || seenRoots.has(key))
      fail(
        "repair_reference_proof_invalid",
        "Root evidence names an undeclared or duplicate root.",
      );
    seenRoots.add(key);
    if (check.status !== RETAINED_OK_STATUS)
      fail("repair_reference_proof_invalid", "Root resolution evidence must be ok.");
    if (check.exact_version !== check.version)
      fail(
        "repair_reference_proof_invalid",
        "Root resolution must bind the exact requested version.",
      );
  }
  if (seenRoots.size !== input.roots.length)
    fail(
      "repair_reference_proof_invalid",
      "Every declared root requires its own resolution evidence.",
    );

  const proof = validateUniqueRootReadbacks({
    intended: input.roots.map((root, index) => ({
      rowIndex: index,
      table: root.table,
      id: root.id,
      version: root.version,
      payloadSha256: root.payload_sha256,
    })),
    checks: readbackChecks,
    targetUserId: input.target_user_id,
    expectedStateCode: input.expected_state_code,
    // A repair never accepts a normalized reconstruction of the remote root payload.
    allowTraceHashOnlyNormalization: false,
  });
  if (proof.blockers.length || proof.uniqueReadbackCount !== input.roots.length)
    fail(
      "repair_reference_proof_invalid",
      "Root readback proof rejected: the strict exact payload, owner and state rule must hold.",
    );

  // References: exactly one record per declared occurrence, in either the ok or the outdated state.
  const seenReferences = new Set<string>();
  const outdated: FoundryRepairOutdatedReference[] = [];
  let okChecks = rootResolve.length + readbackChecks.length;
  for (const check of referenceProbes) {
    const rowIndex = count(check.row_index, "Reference row index");
    const key = referenceKey({
      row_index: rowIndex,
      path: text(check.path, "Reference path"),
      table: text(check.table, "Reference table"),
      id: text(check.id, "Reference id"),
      version: text(check.version, "Reference version"),
    });
    if (!expectedRefs.has(key))
      fail("repair_reference_proof_invalid", "Reference evidence names an undeclared occurrence.");
    if (seenReferences.has(key))
      fail(
        "repair_reference_proof_invalid",
        "Reference evidence repeats an occurrence exactly once each.",
      );
    seenReferences.add(key);
    const version = text(check.version, "Reference version");
    if (check.exact_version !== version)
      fail(
        "repair_reference_proof_invalid",
        "Every retained reference must resolve at its exact requested version.",
      );
    if (check.status === RETAINED_OK_STATUS) {
      okChecks += 1;
      continue;
    }
    if (check.status !== RETAINED_OUTDATED_STATUS)
      fail(
        "repair_reference_outdated_invalid",
        "A retained reference may only be ok or a version_outdated freshness finding.",
      );
    const latest = versionTriplet(check.latest_version, "Outdated reference");
    if (compareVersions(latest, versionTriplet(version, "Outdated reference")) <= 0)
      fail(
        "repair_reference_outdated_invalid",
        "An outdated reference must name a strictly greater published version than the requested one.",
      );
    outdated.push({
      row_index: rowIndex,
      table: String(check.table),
      id: String(check.id),
      version,
      latest_version: String(check.latest_version),
      path: String(check.path),
    });
  }
  if (outdated.length === 0)
    fail(
      "repair_reference_proof_invalid",
      "A blocked freshness report must contain an actual outdated reference finding.",
    );
  if (seenReferences.size !== input.references.length)
    fail("repair_reference_proof_invalid", "Every declared reference requires its own evidence.");
  if (okChecks !== byStatus[RETAINED_OK_STATUS])
    fail(
      "repair_reference_proof_invalid",
      "Report status buckets must agree with the check records they summarise.",
    );
  if (byStatus[RETAINED_OUTDATED_STATUS] !== outdated.length)
    fail(
      "repair_reference_proof_invalid",
      "Report status buckets must agree with the check records they summarise.",
    );
  for (const [bucket, value] of Object.entries(byStatus)) {
    if (bucket === RETAINED_OK_STATUS || bucket === RETAINED_OUTDATED_STATUS) continue;
    if (value !== 0)
      fail(
        "repair_reference_proof_invalid",
        `Report status bucket ${bucket} must be zero for a retained-reference proof.`,
      );
  }

  // Blockers: a strict bijection with the outdated findings, and nothing else.
  const claimed = new Map<string, number>();
  for (const [index, value] of blockers.entries()) {
    const blocker = record(value, `Blocker ${index + 1}`);
    exactKeys(blocker, BLOCKER_KEYS, `Blocker ${index + 1}`);
    if (blocker.code !== RETAINED_OUTDATED_STATUS || blocker.severity !== "error")
      fail(
        "repair_reference_proof_invalid",
        "A retained-reference proof admits only version_outdated blockers at error severity.",
      );
    if (blocker.role !== REFERENCE_ROLE)
      fail(
        "repair_reference_proof_invalid",
        "A version_outdated blocker must be on a reference role.",
      );
    const key = referenceKey({
      row_index: count(blocker.row_index, "Blocker row index"),
      path: text(blocker.path, "Blocker path"),
      table: text(blocker.table, "Blocker table"),
      id: text(blocker.id, "Blocker id"),
      version: text(blocker.version, "Blocker version"),
    });
    claimed.set(key, (claimed.get(key) ?? 0) + 1);
    const matches = outdated.filter((item) => referenceKey(item) === key);
    if (matches.length !== 1 || claimed.get(key) !== 1)
      fail(
        "repair_reference_proof_invalid",
        "Every blocker must correspond to exactly one outdated reference check.",
      );
    if (matches[0].latest_version !== String(blocker.latest_version))
      fail(
        "repair_reference_proof_invalid",
        "Every blocker must correspond to exactly one outdated reference check.",
      );
  }
  if (claimed.size !== outdated.length)
    fail(
      "repair_reference_proof_invalid",
      "Every blocker must correspond to exactly one outdated reference check.",
    );

  return Object.freeze({
    schema: FOUNDRY_REPAIR_REFERENCE_PROOF_SCHEMA,
    raw_status: status,
    raw_blocker_count: rawBlockers,
    counts: Object.freeze({ ...counts }),
    root_readbacks: proof.uniqueReadbackCount,
    references_verified: seenReferences.size,
    ok_checks: okChecks,
    outdated: Object.freeze(outdated.map((item) => Object.freeze({ ...item }))),
    publication_ready: false as const,
  });
}
