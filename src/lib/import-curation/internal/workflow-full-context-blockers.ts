import { fullContextAiCompletionRequirement } from "./context-inputs.ts";
import {
  authoringPackageProofsFromCurationGate,
  authoringPackageProofsFromPatchCollect,
  curationGateContextHasKind,
  curationGateContextHasPattern,
  evidenceResolutionContextKinds,
  evidenceResolutionMode,
  fullContextPackageProofBlockers,
} from "./full-context-proof.ts";
import { asText, ensureArray, repoRelativePath } from "./runtime-io.ts";
import {
  type ArtifactEnvelopeLike,
  type DecisionApplyContextLike,
  type IdentityReferenceRewriteContextLike,
  type JsonRecord,
  type PatchApplyContextLike,
  type RowsTransformContextLike,
} from "./workflow-context-types.ts";
import {
  buildClassificationDecisionFullContextBlockers,
  buildIdentityDecisionFullContextBlockers,
  buildLocationDecisionFullContextBlockers,
  decisionApplyContextRelevantToRowsFile,
} from "./workflow-decision-full-context.ts";
import {
  deterministicRowsFileTransformEntries,
  rowsFileReachableThroughTransformChain,
} from "./workflow-row-transform-context.ts";
import { allowedPatchResolutionModes } from "./workflow-semantic-actions.ts";

export interface SourceContactSemanticEvidenceOptions {
  repoRoot: string;
  datasetType: unknown;
  rowsFile: string | null;
  sourceContactRewriteContext?: RowsTransformContextLike | null;
  canonicalSupportRewriteContext?: RowsTransformContextLike | null;
  cleanupContext?: RowsTransformContextLike | null;
}

export interface FullContextBlockerOptions {
  repoRoot: string;
  profile: unknown;
  datasetType: string;
  curationGateArtifact?: ArtifactEnvelopeLike | null;
  rowsFile: string;
  patchApplyArtifact?: ArtifactEnvelopeLike | null;
  patchApplyContext?: PatchApplyContextLike | null;
  patchCollectArtifact?: ArtifactEnvelopeLike | null;
  cleanupArtifact?: ArtifactEnvelopeLike | null;
  classificationDecisionApplyArtifact?: ArtifactEnvelopeLike | null;
  classificationDecisionApplyContext?: DecisionApplyContextLike | null;
  locationDecisionApplyArtifact?: ArtifactEnvelopeLike | null;
  locationDecisionApplyContext?: DecisionApplyContextLike | null;
  identityDecisionApplyArtifact?: ArtifactEnvelopeLike | null;
  identityDecisionApplyContext?: DecisionApplyContextLike | null;
  identityReferenceRewriteContext?: IdentityReferenceRewriteContextLike | null;
  unresolvedExchangeExternalizationContext?: RowsTransformContextLike | null;
  sourceContactRewriteContext?: RowsTransformContextLike | null;
  canonicalSupportRewriteContext?: RowsTransformContextLike | null;
  cleanupContext?: RowsTransformContextLike | null;
}

export function sourceContactRewriteSemanticEvidenceCount({
  repoRoot,
  datasetType,
  rowsFile,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: SourceContactSemanticEvidenceOptions): number {
  if (!["support", "source", "contact"].includes(asText(datasetType).toLowerCase())) return 0;
  if (sourceContactRewriteContext?.status !== "completed") return 0;
  if (!sourceContactRewriteContext?.inputRowsFile || !sourceContactRewriteContext?.outputRowsFile) {
    return 0;
  }
  const reachesFinalRows = rowsFileReachableThroughTransformChain({
    repoRoot,
    startFiles: [sourceContactRewriteContext.outputRowsFile],
    expectedRowsFile: rowsFile,
    transforms: deterministicRowsFileTransformEntries({
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  });
  if (!reachesFinalRows) return 0;
  const counts = sourceContactRewriteContext.counts ?? {};
  return Math.max(
    Number(counts.output_rows ?? 0) || 0,
    Number(counts.contact_reference_rewrites ?? 0) || 0,
    Number(counts.source_reference_rewrites ?? 0) || 0,
    1,
  );
}

export function buildFullContextAiCompletionBlockers({
  repoRoot,
  profile,
  datasetType,
  curationGateArtifact,
  rowsFile,
  patchApplyArtifact,
  patchApplyContext,
  patchCollectArtifact,
  cleanupArtifact,
  classificationDecisionApplyArtifact,
  classificationDecisionApplyContext,
  locationDecisionApplyArtifact,
  locationDecisionApplyContext,
  identityDecisionApplyArtifact,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: FullContextBlockerOptions): JsonRecord[] {
  const requirement = fullContextAiCompletionRequirement(profile, datasetType, repoRoot);
  if (!requirement) return [];
  const blockers: JsonRecord[] = [];
  const curationPackageProofs = curationGateArtifact
    ? authoringPackageProofsFromCurationGate(repoRoot, curationGateArtifact)
    : [];
  const patchTaskPackageProofs = patchCollectArtifact
    ? authoringPackageProofsFromPatchCollect(repoRoot, patchCollectArtifact)
    : [];
  if (!curationGateArtifact) {
    blockers.push({
      code: "full_context_curation_gate_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires a post-authoring curation gate built with full schema/YAML/context before remote write planning.",
    });
  } else {
    for (const kind of requirement.requiredContextKinds) {
      if (!curationGateContextHasKind(curationGateArtifact, kind)) {
        blockers.push({
          code: "full_context_curation_gate_context_kind_missing",
          stage: "full_context_ai_completion",
          message: `Curation gate report does not prove full-context authoring kind '${kind}'.`,
          required_kind: kind,
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
        });
      }
    }
    for (const pattern of requirement.requiredContextFilePatterns) {
      if (!curationGateContextHasPattern(curationGateArtifact, pattern)) {
        blockers.push({
          code: "full_context_curation_gate_context_file_missing",
          stage: "full_context_ai_completion",
          message: `Curation gate report does not reference required context file '${pattern}'.`,
          required_file_pattern: pattern,
          artifact: repoRelativePath(repoRoot, curationGateArtifact.path),
        });
      }
    }
  }

  for (const proof of [...curationPackageProofs, ...patchTaskPackageProofs]) {
    blockers.push(...fullContextPackageProofBlockers({ requirement, proof }));
  }

  const hasClassificationDecisionProof =
    classificationDecisionApplyArtifact &&
    classificationDecisionApplyContext?.status === "completed" &&
    (classificationDecisionApplyContext.decisions?.length ?? 0) > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      context: classificationDecisionApplyContext,
    });
  const hasLocationDecisionProof =
    locationDecisionApplyArtifact &&
    locationDecisionApplyContext?.status === "completed" &&
    (locationDecisionApplyContext.decisions?.length ?? 0) > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      context: locationDecisionApplyContext,
    });
  const hasIdentityDecisionProof =
    identityDecisionApplyArtifact &&
    identityDecisionApplyContext?.status === "completed" &&
    (identityDecisionApplyContext.decisions?.length ?? 0) > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      context: identityDecisionApplyContext,
    });
  const hasDecisionProof =
    hasClassificationDecisionProof || hasLocationDecisionProof || hasIdentityDecisionProof;
  const hasSourceContactRewriteProof =
    sourceContactRewriteSemanticEvidenceCount({
      repoRoot,
      datasetType,
      rowsFile,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }) > 0;

  blockers.push(
    ...buildClassificationDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );
  blockers.push(
    ...buildLocationDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      locationDecisionApplyArtifact,
      locationDecisionApplyContext,
      patchApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );
  blockers.push(
    ...buildIdentityDecisionFullContextBlockers({
      repoRoot,
      rowsFile,
      cleanupArtifact,
      requirement,
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );

  if (!patchCollectArtifact && !hasDecisionProof && !hasSourceContactRewriteProof) {
    blockers.push({
      code: "full_context_ai_completion_output_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires AI authoring output evidence from dataset-identity-decisions-apply, dataset-classification-decisions-apply, dataset-location-decisions-apply, or dataset-authoring-patch-collect before remote write planning.",
      proof: requirement.proof,
    });
  } else if (
    patchCollectArtifact &&
    patchCollectArtifact.value?.status !== "ready_for_patch_apply"
  ) {
    blockers.push({
      code: "full_context_ai_patch_collect_not_ready",
      stage: "full_context_ai_completion",
      message: `dataset-authoring-patch-collect status is ${patchCollectArtifact.value?.status ?? "missing"}.`,
      artifact: repoRelativePath(repoRoot, patchCollectArtifact.path),
    });
  }

  if (!patchApplyArtifact && !hasDecisionProof && !hasSourceContactRewriteProof) {
    blockers.push({
      code: "full_context_ai_deterministic_apply_required",
      stage: "full_context_ai_completion",
      message:
        "This profile requires full-context AI semantic outputs to be deterministically applied through identity/classification/location decision apply or patch apply before remote write planning.",
      proof: requirement.proof,
    });
  } else if (patchApplyArtifact && patchApplyArtifact.value?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_patch_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-patch-apply status is ${patchApplyArtifact.value?.status ?? "missing"}.`,
      artifact: repoRelativePath(repoRoot, patchApplyArtifact.path),
    });
  }

  const evidenceRows = ensureArray(patchApplyContext?.evidenceRows) as JsonRecord[];
  if (patchApplyArtifact && evidenceRows.length === 0) {
    blockers.push({
      code: "full_context_ai_patch_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "AI patch apply completed without patch evidence rows; semantic completion must be traceable to authoring packages.",
      artifact: repoRelativePath(repoRoot, patchApplyArtifact.path),
    });
  }
  const missingPackageHash = evidenceRows.filter(
    (entry) => !asText(entry?.authoring_package_sha256),
  );
  if (missingPackageHash.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_package_hash_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must include authoring_package_sha256 to prove it used the full authoring package context.",
      count: missingPackageHash.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const knownPackageHashes = new Set(
    [...curationPackageProofs, ...patchTaskPackageProofs]
      .map((proof) => asText(proof?.sha256))
      .filter(Boolean),
  );
  const unknownPackageHash = evidenceRows.filter((entry) => {
    const hash = asText(entry?.authoring_package_sha256);
    return hash && !knownPackageHashes.has(hash);
  });
  if (unknownPackageHash.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_package_hash_unknown",
      stage: "full_context_ai_completion",
      message:
        "AI patch evidence authoring_package_sha256 must match a readable full-context authoring package from the patch task manifest or curation gate.",
      count: unknownPackageHash.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const missingClosures = evidenceRows.filter(
    (entry) => ensureArray(entry?.closes_action_items).length === 0,
  );
  if (missingClosures.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_action_closure_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must close at least one authoring action item for this profile.",
      count: missingClosures.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const missingResolution = evidenceRows.filter((entry) => !evidenceResolutionMode(entry));
  if (missingResolution.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_missing",
      stage: "full_context_ai_completion",
      message:
        "Every AI patch evidence row must include resolution.mode to explain how the action item was completed or deferred.",
      count: missingResolution.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const invalidResolutionMode = evidenceRows.filter((entry) => {
    const mode = evidenceResolutionMode(entry);
    return mode && !allowedPatchResolutionModes.has(mode);
  });
  if (invalidResolutionMode.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_mode_invalid",
      stage: "full_context_ai_completion",
      message: "AI patch evidence contains unsupported resolution.mode values.",
      count: invalidResolutionMode.length,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  const missingResolutionContext = [];
  for (const entry of evidenceRows) {
    const usedKinds = new Set(evidenceResolutionContextKinds(entry));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingResolutionContext.push({ entry, requiredKind });
      }
    }
  }
  if (missingResolutionContext.length > 0) {
    blockers.push({
      code: "full_context_ai_patch_resolution_context_missing",
      stage: "full_context_ai_completion",
      message:
        "AI patch evidence resolution.used_context_kinds must include every required full-context kind for this profile.",
      count: missingResolutionContext.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: patchApplyArtifact ? repoRelativePath(repoRoot, patchApplyArtifact.path) : null,
    });
  }
  return blockers;
}
