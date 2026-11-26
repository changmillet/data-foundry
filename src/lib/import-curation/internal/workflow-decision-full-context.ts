import { fullContextDecisionTaskProofBlockers } from "./full-context-proof.ts";
import { asText, repoRelativePath } from "./runtime-io.ts";
import {
  classificationDecisionCompletionStatus,
  classificationDecisionContextBundleSha256,
  classificationDecisionContextKinds,
  decisionApplyContextCoversExpectedRowsIdentity,
  decisionApplyContextRelevantToExpectedRowsFile,
  decisionApplyContextRelevantToRowsFile,
  decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization,
  decisionApplyRowsEquivalentToExpected,
  type DecisionArtifactEnvelope,
  type DecisionBuilderOptions,
  type DecisionContext,
  type DecisionJsonRecord,
  type DecisionRecord,
  decisionTaskContextBundleHashesFromContext,
  decisionTaskProofListFromContext,
  identityDecisionApplyProvesReferenceRewrite,
  readLocationDecisionApplyContext,
} from "./workflow-decision-chain-helpers.ts";
import { buildIdentityDecisionFullContextBlockers } from "./workflow-identity-decision-full-context.ts";
import {
  decisionApplyExpectedRowsFile,
  decisionApplyOutputRowsChainThroughIdentityRewrite,
  decisionApplyOutputRowsChainThroughPatch,
  decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite,
  decisionApplyOutputRowsMatch,
  decisionApplyOutputRowsReachableThroughDeterministicTransforms,
} from "./workflow-row-transform-context.ts";

export {
  buildIdentityDecisionFullContextBlockers,
  classificationDecisionCompletionStatus,
  classificationDecisionContextBundleSha256,
  classificationDecisionContextKinds,
  decisionApplyContextCoversExpectedRowsIdentity,
  decisionApplyContextRelevantToExpectedRowsFile,
  decisionApplyContextRelevantToRowsFile,
  decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization,
  decisionTaskContextBundleHashesFromContext,
  decisionTaskProofListFromContext,
  identityDecisionApplyProvesReferenceRewrite,
  readLocationDecisionApplyContext,
};

interface ScopedDecisionTaskBlockerOptions extends DecisionBuilderOptions {
  label: "classification" | "location";
  title: "Classification" | "Location";
  applyCommand: string;
  applyArtifact: DecisionArtifactEnvelope | null | undefined;
  applyContext: DecisionContext | null | undefined;
  includeLocationTransform: boolean;
}

function buildScopedDecisionTaskFullContextBlockers({
  label,
  title,
  applyCommand,
  applyArtifact,
  applyContext,
  includeLocationTransform,
  repoRoot,
  rowsFile,
  cleanupArtifact,
  requirement,
  locationDecisionApplyContext,
  patchApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: ScopedDecisionTaskBlockerOptions): DecisionJsonRecord[] {
  const blockers: DecisionJsonRecord[] = [];
  if (!applyArtifact) return blockers;
  const context = applyContext;
  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  if (
    !decisionApplyContextRelevantToExpectedRowsFile({
      repoRoot,
      context,
      expectedRowsFile,
    })
  ) {
    return blockers;
  }
  if (context?.status !== "completed") {
    blockers.push({
      code: `full_context_ai_${label}_apply_not_completed`,
      stage: "full_context_ai_completion",
      message: `${applyCommand} status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
  }
  const decisionTaskProofs = decisionTaskProofListFromContext(context);
  if (decisionTaskProofs.length === 0) {
    blockers.push(
      ...fullContextDecisionTaskProofBlockers({
        requirement,
        proof: null,
        label,
      }),
    );
  } else {
    for (const proof of decisionTaskProofs) {
      blockers.push(
        ...fullContextDecisionTaskProofBlockers({
          requirement,
          proof,
          label,
        }),
      );
    }
  }
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: `full_context_ai_${label}_cleanup_input_missing`,
      stage: "full_context_ai_completion",
      message: `${title} decision proof cannot be chained because the cleanup report does not record its input rows_file.`,
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyRowsEquivalentToExpected(repoRoot, context, expectedRowsFile) &&
    !decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      context,
      expectedRowsFile,
    }) &&
    !decisionApplyOutputRowsChainThroughPatch(
      repoRoot,
      context,
      patchApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
      repoRoot,
      context,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      patchApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      patchApplyContext,
      ...(includeLocationTransform ? { locationDecisionApplyContext } : {}),
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    })
  ) {
    blockers.push({
      code: `full_context_ai_${label}_rows_mismatch`,
      stage: "full_context_ai_completion",
      message: `${title} decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, or the input rows of a completed patch apply report whose output rows then match that cleanup/mutation file.`,
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile as string),
      patch_apply_input_rows_file: patchApplyContext?.inputRowsFile
        ? repoRelativePath(repoRoot, patchApplyContext.inputRowsFile)
        : null,
      patch_apply_output_rows_files:
        patchApplyContext?.outputRows?.map((file) => repoRelativePath(repoRoot, file)) ?? [],
      identity_reference_rewrite_input_rows_file: identityReferenceRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
        : null,
      identity_reference_rewrite_output_rows_file: identityReferenceRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
        : null,
      unresolved_exchange_externalization_input_rows_file:
        unresolvedExchangeExternalizationContext?.inputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.inputRowsFile)
          : null,
      unresolved_exchange_externalization_output_rows_file:
        unresolvedExchangeExternalizationContext?.outputRowsFile
          ? repoRelativePath(repoRoot, unresolvedExchangeExternalizationContext.outputRowsFile)
          : null,
      source_contact_rewrite_input_rows_file: sourceContactRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.inputRowsFile)
        : null,
      source_contact_rewrite_output_rows_file: sourceContactRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, sourceContactRewriteContext.outputRowsFile)
        : null,
      canonical_support_rewrite_input_rows_file: canonicalSupportRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.inputRowsFile)
        : null,
      canonical_support_rewrite_output_rows_file: canonicalSupportRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, canonicalSupportRewriteContext.outputRowsFile)
        : null,
      cleanup_input_rows_file: cleanupContext?.inputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.inputRowsFile)
        : null,
      cleanup_output_rows_file: cleanupContext?.outputRowsFile
        ? repoRelativePath(repoRoot, cleanupContext.outputRowsFile)
        : null,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
  }
  if (!context?.decisions?.length) {
    blockers.push({
      code: `full_context_ai_${label}_decision_evidence_required`,
      stage: "full_context_ai_completion",
      message: `${title} decision apply report must point to at least one AI-authored ${label} decision.`,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
    return blockers;
  }
  const decisions = context.decisions as readonly DecisionRecord[];
  const missingBasis = decisions.filter((decision) => !asText(decision?.basis));
  if (missingBasis.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_basis_missing`,
      stage: "full_context_ai_completion",
      message: `Every ${label} decision must include basis.`,
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
  }
  const missingEvidence = decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_evidence_missing`,
      stage: "full_context_ai_completion",
      message: `Every ${label} decision must include structured evidence.`,
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_decision_status_not_completed`,
      stage: "full_context_ai_completion",
      message: `Every ${label} decision used as full-context AI evidence must declare decision_status=completed.`,
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
  }
  const missingContextKinds: Array<{ decision: DecisionRecord; requiredKind: string }> = [];
  for (const decision of decisions) {
    const usedKinds = new Set(classificationDecisionContextKinds(decision));
    for (const requiredKind of requirement.requiredContextKinds) {
      if (!usedKinds.has(requiredKind)) {
        missingContextKinds.push({ decision, requiredKind });
      }
    }
  }
  if (missingContextKinds.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_context_missing`,
      stage: "full_context_ai_completion",
      message: `${title} decision used_context_kinds must include every required full-context kind for this profile.`,
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, applyArtifact.path),
    });
  }
  const expectedContextBundleSha256AnyOf = decisionTaskContextBundleHashesFromContext(context);
  if (expectedContextBundleSha256AnyOf.length > 0) {
    const mismatchedContextBundle = context.decisions.filter(
      (decision) =>
        !expectedContextBundleSha256AnyOf.includes(
          classificationDecisionContextBundleSha256(decision),
        ),
    );
    if (mismatchedContextBundle.length > 0) {
      blockers.push({
        code: `full_context_ai_${label}_context_bundle_mismatch`,
        stage: "full_context_ai_completion",
        message: `Every ${label} decision must reference one of the AI decision task context_bundle_sha256 values.`,
        count: mismatchedContextBundle.length,
        expected_context_bundle_sha256:
          expectedContextBundleSha256AnyOf.length === 1
            ? expectedContextBundleSha256AnyOf[0]
            : null,
        expected_context_bundle_sha256_any_of: expectedContextBundleSha256AnyOf,
        artifact: repoRelativePath(repoRoot, applyArtifact.path),
      });
    }
  }
  return blockers;
}

export function buildClassificationDecisionFullContextBlockers(
  options: DecisionBuilderOptions,
): DecisionJsonRecord[] {
  return buildScopedDecisionTaskFullContextBlockers({
    ...options,
    label: "classification",
    title: "Classification",
    applyCommand: "dataset-classification-decisions-apply",
    applyArtifact: options.classificationDecisionApplyArtifact,
    applyContext: options.classificationDecisionApplyContext,
    includeLocationTransform: true,
  });
}

export function buildLocationDecisionFullContextBlockers(
  options: DecisionBuilderOptions,
): DecisionJsonRecord[] {
  return buildScopedDecisionTaskFullContextBlockers({
    ...options,
    label: "location",
    title: "Location",
    applyCommand: "dataset-location-decisions-apply",
    applyArtifact: options.locationDecisionApplyArtifact,
    applyContext: options.locationDecisionApplyContext,
    includeLocationTransform: false,
  });
}
