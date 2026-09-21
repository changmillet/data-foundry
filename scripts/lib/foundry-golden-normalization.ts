import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

/**
 * Reviewed golden projections.
 *
 * Each entry binds one complete projection to the exact digest of every reviewed state. A projection
 * that hashes to anything else is returned unchanged and is therefore compared verbatim by the
 * golden diff, so an unreviewed addition, removal, reordering, text edit or field change still
 * fails. Binding the whole projection — never a filtered subset — is what stops a blind filter from
 * hiding a duplicate or a drift alongside the reviewed change.
 *
 * Objects are unordered in JSON and the comparison sorts their keys, so a projection is hashed in
 * canonical form: object keys sorted, array order preserved. Array order is semantic here — both the
 * command list and the capability registry are ordered contracts.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function goldenProjectionDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

type ReviewedProjection = {
  digests: readonly string[];
  token: string;
};

function isReviewed(value: unknown, projection: ReviewedProjection): boolean {
  return projection.digests.includes(goldenProjectionDigest(value));
}

// The ordered command surface as emitted by `help`.
const REVIEWED_COMMAND_LIST: ReviewedProjection = {
  digests: [
    "cce8fa361c42a15f045d8567863596de19f2db2c66eb145df78a1a40bcb109ec",
    "00aa76ed2f681c0c0f572375d936d990cbef092b27553bccb05ec32448ea7166",
  ],
  token: "<golden-reviewed-command-surface>",
};
// The dataset-policy subset of the same surface.
const REVIEWED_DATASET_POLICY_LIST: ReviewedProjection = {
  digests: [
    "ef03f34605ebbf84b56fcac8766afccd51212ea96295ec99e2b7e58f4c186c6f",
    "50fb5c0d961b66aec598fc83f17904646d9bf9680ce3dd2ec5784a8a50ddf8fc",
  ],
  token: "<golden-reviewed-command-surface>",
};
// The complete capability registry.
const REVIEWED_CAPABILITY_REGISTRY: ReviewedProjection = {
  digests: [
    "37ae12f63b7c05782c82cebc1b3aa9b3e9fb96a15238bc3b0c62b6ea57ea5c09",
    "46cbf795b053cb23b5e38aa2ca867df06a673151f89495200adfcceb6ee376af",
  ],
  token: "<golden-reviewed-capability-registry>",
};
// The surface-audit metadata category tally.
const REVIEWED_SURFACE_AUDIT_COUNTS: ReviewedProjection = {
  digests: [
    "7041ac4422b74f34c04e988d2dbc0e69256fd53bf3caf9ba7940401facd293fa",
    "6a70527dc785b793417e17dcaf933086683baceff31618cc8a7d33f11cb72780",
  ],
  token: "<golden-reviewed-surface-audit-counts>",
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The `help` contract: an ordered command list plus its public and dataset-policy partitions.
export function normalizeGoldenCommandSurface(value: JsonRecord): JsonRecord | null {
  if (
    !Array.isArray(value.commands) ||
    !Array.isArray(value.dataset_policy_commands) ||
    !Array.isArray(value.public_commands) ||
    typeof value.ownership_note !== "string"
  ) {
    return null;
  }
  const commandState = REVIEWED_COMMAND_LIST.digests.indexOf(
    goldenProjectionDigest(value.commands),
  );
  const policyState = REVIEWED_DATASET_POLICY_LIST.digests.indexOf(
    goldenProjectionDigest(value.dataset_policy_commands),
  );
  // Both partitions must describe the same reviewed state, not a mixture of the old and new lists.
  if (commandState < 0 || commandState !== policyState) {
    return null;
  }
  return {
    ...value,
    commands: [REVIEWED_COMMAND_LIST.token],
    dataset_policy_commands: [REVIEWED_DATASET_POLICY_LIST.token],
  };
}

// The capability registry. The declared count must agree with the array it counts, so a count-only
// drift is not normalized away.
export function normalizeGoldenCapabilityRegistry(value: JsonRecord): JsonRecord | null {
  if (!Array.isArray(value.capabilities) || typeof value.capability_count !== "number") return null;
  if (value.capability_count !== value.capabilities.length) return null;
  if (!isReviewed(value.capabilities, REVIEWED_CAPABILITY_REGISTRY)) return null;
  return {
    ...value,
    capabilities: [REVIEWED_CAPABILITY_REGISTRY.token],
    capability_count: REVIEWED_CAPABILITY_REGISTRY.token,
  };
}

// The surface-audit metadata category tally.
export function normalizeGoldenSurfaceAuditCounts(value: JsonRecord): JsonRecord | null {
  const counts = value.category_counts;
  if (!isRecord(counts)) return null;
  if (typeof counts["workflow-internal"] !== "number") return null;
  if (!isReviewed(counts, REVIEWED_SURFACE_AUDIT_COUNTS)) return null;
  return { ...value, category_counts: REVIEWED_SURFACE_AUDIT_COUNTS.token };
}

// Dispatches a single object to the reviewed projection that owns it, or returns null when the
// object is not one of the reviewed shapes or does not match a reviewed digest exactly.
export function normalizeGoldenReviewedProjection(value: JsonRecord): JsonRecord | null {
  return (
    normalizeGoldenCommandSurface(value) ??
    normalizeGoldenCapabilityRegistry(value) ??
    normalizeGoldenSurfaceAuditCounts(value)
  );
}
