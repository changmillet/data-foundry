import { contextFileDetails } from "./context-inputs.ts";
import {
  contextFileArray,
  contextFileHasNonEmptyText,
  contextFilesHaveKind,
  contextFilesHavePattern,
  type DecisionTaskProof,
  decisionTaskProofFromApplyReport,
  decisionTaskProofsFromApplyReport,
  decisionTaskRequiredContextFilePatterns,
  fullContextDecisionTaskProofBlockers,
  type FullContextRequirement,
  normalizeClassificationDecisionRows,
  payloadSha256ByIdentityForRows,
  type ProofBlocker,
  type ProofContextFile,
  type ProofContextFileDetail,
  type ProofJsonRecord,
  readDecisionTaskProof,
  readDecisionTaskSharedContextBundleProof,
  type SharedContextBundleProof,
} from "./full-context-decision-task-proof.ts";
import { sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  readText,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";

export {
  contextFileHasNonEmptyText,
  contextFilesHaveKind,
  contextFilesHavePattern,
  type DecisionTaskProof,
  decisionTaskProofFromApplyReport,
  decisionTaskProofsFromApplyReport,
  decisionTaskRequiredContextFilePatterns,
  fullContextDecisionTaskProofBlockers,
  type FullContextRequirement,
  normalizeClassificationDecisionRows,
  payloadSha256ByIdentityForRows,
  readDecisionTaskProof,
  readDecisionTaskSharedContextBundleProof,
  type SharedContextBundleProof,
};

interface ArtifactEnvelope<TValue extends ProofJsonRecord = ProofJsonRecord> {
  path?: unknown;
  value?: TValue | null;
}

interface CurationGateContextValue extends ProofJsonRecord {
  context?: {
    contract_context_file_details?: unknown;
    contract_context_files?: unknown;
  } | null;
  entities?: unknown;
  processes?: unknown;
  flows?: unknown;
  items?: unknown;
}

interface AuthoringPackagePayload extends ProofJsonRecord {
  contract_context_files?: unknown;
  missing_context_files?: unknown;
}

interface AuthoringPackageEntity extends ProofJsonRecord {
  authoring_package?: unknown;
  authoringPackage?: unknown;
  authoring_package_sha256?: unknown;
}

interface PatchCollectTask extends ProofJsonRecord {
  files?: {
    authoring_package?: unknown;
    authoringPackage?: unknown;
  } | null;
  context?: {
    authoring_package_sha256?: unknown;
  } | null;
}

export interface AuthoringPackageProof {
  source: unknown;
  path: string | null;
  exists: boolean;
  sha256: string | null;
  expected_sha256: string | null;
  payload: AuthoringPackagePayload | null;
  contract_context_files: ProofContextFile[];
  contract_context_file_details: ProofContextFileDetail[];
  blockers: ProofBlocker[];
}

interface FullContextBlockerOptions<TProof> {
  requirement: FullContextRequirement;
  proof: TProof;
}

export function curationGateContextHasKind(
  curationGateArtifact: ArtifactEnvelope<CurationGateContextValue> | null | undefined,
  kind: unknown,
): boolean {
  const details = contextFileArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (details.some((file) => asText(file?.kind) === kind)) return true;
  const contextPaths = ensureArray(curationGateArtifact?.value?.context?.contract_context_files);
  const expectedFileByKind: Record<PropertyKey, string> = {
    schema: "schema.json",
    methodology_yaml: "methodology.yaml",
    ruleset: "runtime-ruleset.json",
  };
  const expected = expectedFileByKind[kind as PropertyKey];
  return Boolean(
    expected &&
    contextPaths.some((filePath) =>
      String(filePath ?? "")
        .toLowerCase()
        .includes(expected),
    ),
  );
}

export function curationGateContextHasPattern(
  curationGateArtifact: ArtifactEnvelope<CurationGateContextValue> | null | undefined,
  pattern: unknown,
): boolean {
  const details = contextFileArray(
    curationGateArtifact?.value?.context?.contract_context_file_details,
  );
  if (
    details.some((file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes((pattern as string).toLowerCase()),
    )
  ) {
    return true;
  }
  const contextPaths = ensureArray(curationGateArtifact?.value?.context?.contract_context_files);
  return contextPaths.some((filePath) =>
    String(filePath ?? "")
      .toLowerCase()
      .includes((pattern as string).toLowerCase()),
  );
}

export function evidenceResolution(entry: unknown): ProofJsonRecord | null {
  const typedEntry = entry as { resolution?: unknown } | null | undefined;
  return typedEntry?.resolution &&
    typeof typedEntry.resolution === "object" &&
    !Array.isArray(typedEntry.resolution)
    ? (typedEntry.resolution as ProofJsonRecord)
    : null;
}

export function evidenceResolutionMode(entry: unknown): string {
  return asText(evidenceResolution(entry)?.mode);
}

export function evidenceResolutionContextKinds(entry: unknown): string[] {
  return ensureArray(
    evidenceResolution(entry)?.used_context_kinds ?? evidenceResolution(entry)?.usedContextKinds,
  )
    .map((kind) => asText(kind))
    .filter(Boolean);
}

export function readAuthoringPackageProof(
  repoRoot: string,
  packageRef: unknown,
  expectedSha256: unknown = null,
  source: unknown = null,
): AuthoringPackageProof {
  const packagePath = resolveRepoPath(repoRoot, packageRef as string | null | undefined);
  const proof: AuthoringPackageProof = {
    source,
    path: packageRef ? repoRelativeArtifactPath(repoRoot, packageRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    payload: null,
    contract_context_files: [],
    contract_context_file_details: [],
    blockers: [],
  };
  if (!packageRef || !packagePath || !fileExists(packagePath)) {
    proof.blockers.push({
      code: "full_context_authoring_package_missing",
      stage: "full_context_ai_completion",
      message: "Full-context AI completion evidence references an unreadable authoring package.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, packagePath);
  let rawText = "";
  try {
    rawText = readText(packagePath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText) as AuthoringPackagePayload;
  } catch (error) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  if (!proof.payload || typeof proof.payload !== "object" || Array.isArray(proof.payload)) {
    proof.blockers.push({
      code: "full_context_authoring_package_invalid",
      stage: "full_context_ai_completion",
      message: "Authoring package must be a JSON object.",
      authoring_package: proof.path,
      source,
    });
    return proof;
  }
  proof.contract_context_files = contextFileArray(proof.payload.contract_context_files);
  proof.contract_context_file_details = contextFileDetails(proof.contract_context_files);
  if (proof.expected_sha256 && proof.sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "full_context_authoring_package_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded authoring_package_sha256 does not match the current authoring package content.",
      authoring_package: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  return proof;
}

export function authoringPackageProofsFromCurationGate(
  repoRoot: string,
  curationGateArtifact: ArtifactEnvelope<CurationGateContextValue> | null | undefined,
): AuthoringPackageProof[] {
  const entities = ensureArray(
    curationGateArtifact?.value?.entities ??
      curationGateArtifact?.value?.processes ??
      curationGateArtifact?.value?.flows ??
      curationGateArtifact?.value?.items,
  ) as Array<AuthoringPackageEntity | null | undefined>;
  return entities
    .map((entity) => {
      const packageRef = asText(entity?.authoring_package ?? entity?.authoringPackage);
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        entity?.authoring_package_sha256,
        "curation_gate",
      );
    })
    .filter(Boolean) as AuthoringPackageProof[];
}

export function authoringPackageProofsFromPatchCollect(
  repoRoot: string,
  patchCollectArtifact: ArtifactEnvelope | null | undefined,
): AuthoringPackageProof[] {
  const manifestRef = patchCollectArtifact?.value?.task_manifest;
  const manifestPath = resolveRepoPath(repoRoot, manifestRef as string | null | undefined);
  if (!manifestRef || !manifestPath || !fileExists(manifestPath)) return [];
  let manifest: ProofJsonRecord;
  try {
    manifest = readJson<ProofJsonRecord>(manifestPath);
  } catch {
    return [];
  }
  return (ensureArray(manifest.tasks) as Array<PatchCollectTask | null | undefined>)
    .map((task) => {
      const packageRef = asText(task?.files?.authoring_package ?? task?.files?.authoringPackage);
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        task?.context?.authoring_package_sha256,
        "patch_collect_task_manifest",
      );
    })
    .filter(Boolean) as AuthoringPackageProof[];
}

export function fullContextPackageProofBlockers({
  requirement,
  proof,
}: FullContextBlockerOptions<AuthoringPackageProof>): ProofBlocker[] {
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: "full_context_authoring_package_context_kind_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of requirement.requiredContextFilePatterns) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: "full_context_authoring_package_context_file_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  if (ensureArray(proof.payload.missing_context_files).length > 0) {
    blockers.push({
      code: "full_context_authoring_package_missing_context_files",
      stage: "full_context_ai_completion",
      message:
        "Authoring package records missing context files and cannot prove full-context AI completion.",
      authoring_package: proof.path,
      missing_context_files: ensureArray(proof.payload.missing_context_files),
      source: proof.source,
    });
  }
  return blockers;
}
