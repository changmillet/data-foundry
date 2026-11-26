import {
  type AuthoringPackageProof,
  fullContextPackageProofBlockers,
} from "./full-context-proof.ts";
import { asText, ensureArray, repoRelativePath } from "./runtime-io.ts";
import {
  classificationDecisionCompletionStatus,
  classificationDecisionContextKinds,
  decisionApplyContextCoversExpectedRowsIdentity,
  decisionApplyContextRelevantToExpectedRowsFile,
  type DecisionBuilderOptions,
  type DecisionJsonRecord,
  type DecisionRecord,
  identityDecisionApplyProvesReferenceRewrite,
} from "./workflow-decision-chain-helpers.ts";
import {
  identityDecisionCanonical,
  identityDecisionClosesAction,
  identityDecisionPackageReference,
  identityDecisionPackageSha,
  identityDecisionValue,
} from "./workflow-identity-decision-context.ts";
import {
  decisionApplyExpectedRowsFile,
  decisionApplyOutputRowsChainThroughClassification,
  decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite,
  decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsChainThroughIdentityRewrite,
  decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization,
  decisionApplyOutputRowsMatch,
  decisionApplyOutputRowsReachableThroughDeterministicTransforms,
} from "./workflow-row-transform-context.ts";

export function buildIdentityDecisionFullContextBlockers({
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
}: DecisionBuilderOptions): DecisionJsonRecord[] {
  const blockers: DecisionJsonRecord[] = [];
  if (!identityDecisionApplyArtifact) return blockers;
  const context = identityDecisionApplyContext;
  if (context?.status !== "completed") {
    blockers.push({
      code: "full_context_ai_identity_apply_not_completed",
      stage: "full_context_ai_completion",
      message: `dataset-identity-decisions-apply status is ${context?.status || "missing"}.`,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const expectedRowsFile = decisionApplyExpectedRowsFile({
    repoRoot,
    rowsFile,
    cleanupArtifact,
  });
  const contextRelevantToRows = decisionApplyContextRelevantToExpectedRowsFile({
    repoRoot,
    context,
    expectedRowsFile,
  });
  if (cleanupArtifact && !expectedRowsFile) {
    blockers.push({
      code: "full_context_ai_identity_cleanup_input_missing",
      stage: "full_context_ai_completion",
      message:
        "Identity decision proof cannot be chained because the cleanup report does not record its input rows_file.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
      cleanup_report: repoRelativePath(repoRoot, cleanupArtifact.path),
    });
  } else if (
    contextRelevantToRows &&
    !decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) &&
    !decisionApplyContextCoversExpectedRowsIdentity({
      repoRoot,
      context,
      expectedRowsFile,
    }) &&
    !decisionApplyOutputRowsChainThroughIdentityRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassification(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      expectedRowsFile,
    ) &&
    !decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      expectedRowsFile,
    ) &&
    !identityDecisionApplyProvesReferenceRewrite(
      repoRoot,
      context,
      identityReferenceRewriteContext,
    ) &&
    !decisionApplyOutputRowsReachableThroughDeterministicTransforms({
      repoRoot,
      context,
      expectedRowsFile,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    })
  ) {
    blockers.push({
      code: "full_context_ai_identity_rows_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Identity decision apply report files.output_rows must match the cleanup input rows file, the exact mutation rows file, feed a completed identity reference rewrite / unresolved exchange externalization chain, or provide an identity-reference-rewrites file used by this scope.",
      rows_file: repoRelativePath(repoRoot, rowsFile),
      expected_output_rows_file: repoRelativePath(repoRoot, expectedRowsFile as string),
      identity_reference_rewrite_input_rows_file: identityReferenceRewriteContext?.inputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.inputRowsFile)
        : null,
      identity_reference_rewrite_output_rows_file: identityReferenceRewriteContext?.outputRowsFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.outputRowsFile)
        : null,
      classification_decision_apply_input_rows_files:
        classificationDecisionApplyContext?.inputRows?.map((file) =>
          repoRelativePath(repoRoot, file),
        ) ?? [],
      classification_decision_apply_output_rows_files:
        classificationDecisionApplyContext?.outputRows?.map((file) =>
          repoRelativePath(repoRoot, file),
        ) ?? [],
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
      identity_decision_reference_rewrites_file: context?.identityReferenceRewritesFile
        ? repoRelativePath(repoRoot, context.identityReferenceRewritesFile as string)
        : null,
      identity_reference_rewrites_file: identityReferenceRewriteContext?.sourceFile
        ? repoRelativePath(repoRoot, identityReferenceRewriteContext.sourceFile)
        : null,
      identity_reference_rewrite_rows: identityReferenceRewriteContext?.scopedRows?.length ?? 0,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  if (!context?.decisions?.length) {
    blockers.push({
      code: "full_context_ai_identity_decision_evidence_required",
      stage: "full_context_ai_completion",
      message:
        "Identity decision apply report must point to at least one AI-authored identity decision.",
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
    return blockers;
  }
  const packageProofs = ensureArray(context.authoringPackageProofs);
  if (packageProofs.length === 0) {
    blockers.push({
      code: "full_context_ai_identity_authoring_package_required",
      stage: "full_context_ai_completion",
      message:
        "Identity decisions must reference readable full-context authoring packages before remote write planning.",
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  } else {
    for (const proof of packageProofs) {
      blockers.push(
        ...fullContextPackageProofBlockers({
          requirement,
          proof: proof as AuthoringPackageProof,
        }),
      );
    }
  }
  const decisions = context.decisions as readonly DecisionRecord[];
  const missingPackageBinding = decisions.filter(
    (decision) =>
      !identityDecisionPackageReference(decision) || !identityDecisionPackageSha(decision),
  );
  if (missingPackageBinding.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_package_binding_missing",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision must include authoring_package and authoring_package_sha256.",
      count: missingPackageBinding.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingBasis = decisions.filter((decision) => !asText(decision?.basis ?? decision?.reason));
  if (missingBasis.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_basis_missing",
      stage: "full_context_ai_completion",
      message: "Every identity decision must include basis.",
      count: missingBasis.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingEvidence = decisions.filter(
    (decision) => !decision?.evidence || typeof decision.evidence !== "object",
  );
  if (missingEvidence.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_evidence_missing",
      stage: "full_context_ai_completion",
      message: "Every identity decision must include structured evidence.",
      count: missingEvidence.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const notCompleted = context.decisions.filter(
    (decision) => classificationDecisionCompletionStatus(decision) !== "completed",
  );
  if (notCompleted.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_decision_status_not_completed",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision used as full-context AI evidence must declare decision_status=completed.",
      count: notCompleted.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingClosures = context.decisions.filter(
    (decision) =>
      !identityDecisionClosesAction(decision, "identity_preflight_manual_review") &&
      !identityDecisionClosesAction(decision, "elementary_flow_identity_manual_review"),
  );
  if (missingClosures.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_action_closure_missing",
      stage: "full_context_ai_completion",
      message:
        "Every identity decision must close identity_preflight_manual_review or elementary_flow_identity_manual_review.",
      count: missingClosures.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  const missingCanonical = context.decisions.filter(
    (decision) =>
      identityDecisionValue(decision) === "reuse_existing_reference" &&
      !identityDecisionCanonical(decision),
  );
  if (missingCanonical.length > 0) {
    blockers.push({
      code: "full_context_ai_identity_canonical_missing",
      stage: "full_context_ai_completion",
      message:
        "reuse_existing_reference identity decisions must include canonical ref_object_id/version.",
      count: missingCanonical.length,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
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
      code: "full_context_ai_identity_context_missing",
      stage: "full_context_ai_completion",
      message:
        "Identity decision used_context_kinds must include every required full-context kind for this profile.",
      count: missingContextKinds.length,
      required_context_kinds: requirement.requiredContextKinds,
      artifact: repoRelativePath(repoRoot, identityDecisionApplyArtifact.path),
    });
  }
  return blockers;
}
