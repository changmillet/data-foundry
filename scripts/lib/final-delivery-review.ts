import { type JsonRecord, isPlainObject, isSha256 } from "./final-delivery-manifest.ts";

export type ReviewerDeclaration = JsonRecord & {
  reviewer_id?: string;
  artifact_id?: string;
  required_artifact_ids?: unknown;
};

export type ReviewerReport = JsonRecord & {
  reviewer_id?: string;
  status?: string;
  reviewed_artifacts?: unknown;
  findings?: { p0?: number; p1?: number };
};

export type ReviewedArtifactBinding = {
  artifact_id: string;
  sha256: string;
  bytes: number;
};

export function reviewerDeclarations(manifest: JsonRecord): ReviewerDeclaration[] {
  const reviewers = manifest.reviewers;
  if (!Array.isArray(reviewers)) return [];
  return reviewers.filter(isPlainObject);
}

// The reviewer identity must be present, independent of the producer, and used at most once.
export function reviewerIdentityValid(
  reviewer: ReviewerDeclaration,
  producerId: unknown,
  seenReviewerIds: ReadonlySet<string>,
  seenArtifactIds: ReadonlySet<string>,
): boolean {
  const reviewerId = reviewer?.reviewer_id;
  const artifactId = reviewer?.artifact_id;
  return Boolean(
    reviewerId &&
    reviewerId !== producerId &&
    !seenReviewerIds.has(reviewerId) &&
    artifactId &&
    !seenArtifactIds.has(artifactId),
  );
}

// A PASS disposition is only meaningful when the report names the same reviewer and declares
// zero P0 and P1 findings, so a producer cannot close its own evidence gap.
export function reviewerPassValid(report: unknown, reviewerId: unknown): boolean {
  if (!isPlainObject(report)) return false;
  const typed = report as ReviewerReport;
  return (
    typed.reviewer_id === reviewerId &&
    typed.status === "PASS" &&
    typed.findings?.p0 === 0 &&
    typed.findings?.p1 === 0
  );
}

function reviewedBinding(value: unknown): ReviewedArtifactBinding | null {
  if (!isPlainObject(value)) return null;
  const artifactId = value.artifact_id;
  const sha256 = value.sha256;
  const bytes = value.bytes;
  if (typeof artifactId !== "string" || artifactId.length === 0) return null;
  if (!isSha256(sha256)) return null;
  if (!Number.isInteger(bytes) || (bytes as number) < 0) return null;
  return { artifact_id: artifactId, sha256: sha256 as string, bytes: bytes as number };
}

export type ReviewScope = {
  bindings: ReviewedArtifactBinding[];
  duplicateIds: string[];
  malformedCount: number;
};

export function reviewScope(report: unknown): ReviewScope | null {
  if (!isPlainObject(report)) return null;
  const reviewed = (report as ReviewerReport).reviewed_artifacts;
  if (!Array.isArray(reviewed) || reviewed.length === 0) return null;
  const bindings: ReviewedArtifactBinding[] = [];
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  let malformedCount = 0;
  for (const entry of reviewed) {
    const binding = reviewedBinding(entry);
    if (!binding) {
      malformedCount += 1;
      continue;
    }
    if (seen.has(binding.artifact_id)) duplicateIds.push(binding.artifact_id);
    seen.add(binding.artifact_id);
    bindings.push(binding);
  }
  return { bindings, duplicateIds, malformedCount };
}

// Review coverage is content-bound. Each manifest-required artifact must be individually bound to
// the exact SHA-256 and byte count the reviewer saw, and those values must still match the bytes
// the manifest currently binds. The reviewer's own report artifact is excluded so the binding
// cannot be made circular by hashing the report that carries the hash.
export function reviewerCoverageValid(
  report: unknown,
  required: readonly unknown[],
  currentBindings: ReadonlyMap<string, { sha256: string; bytes: number }>,
  reviewerArtifactId: unknown,
): boolean {
  const scope = reviewScope(report);
  if (!scope) return false;
  if (scope.malformedCount > 0 || scope.duplicateIds.length > 0) return false;
  const boundIds = new Set(scope.bindings.map((binding) => binding.artifact_id));
  if (typeof reviewerArtifactId === "string" && boundIds.has(reviewerArtifactId)) return false;
  // A binding for an artifact that is not in the manifest is an unknown identity, not coverage.
  for (const id of boundIds) {
    if (!currentBindings.has(id)) return false;
  }
  if (required.length === 0 || new Set(required).size !== required.length) return false;
  return required.every((id) => typeof id === "string" && boundIds.has(id));
}

export function reviewerContentBindingValid(
  report: unknown,
  required: readonly unknown[],
  currentBindings: ReadonlyMap<string, { sha256: string; bytes: number }>,
): boolean {
  const scope = reviewScope(report);
  if (!scope) return false;
  if (scope.malformedCount > 0 || scope.duplicateIds.length > 0) return false;
  // Every binding the report declares must match the current bytes, not only the required ones: a
  // stale or wrong digest on a voluntarily-included artifact is still a false claim.
  for (const binding of scope.bindings) {
    const current = currentBindings.get(binding.artifact_id);
    if (!current) return false;
    if (binding.sha256 !== current.sha256 || binding.bytes !== current.bytes) return false;
  }
  // `required_artifact_ids` sets the minimum coverage, not the set to verify.
  const boundIds = new Set(scope.bindings.map((binding) => binding.artifact_id));
  return (
    required.length > 0 &&
    new Set(required).size === required.length &&
    required.every((id) => typeof id === "string" && boundIds.has(id))
  );
}
