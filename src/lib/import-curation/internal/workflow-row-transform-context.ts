import { sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  normalizedArtifactPath,
  readText,
  sameArtifactPath,
} from "./runtime-io.ts";
import {
  type CanonicalSupportRewriteContext,
  cleanupInputRowsFile,
  decisionApplyExpectedRowsFile,
  readCanonicalSupportRewriteContext,
  readCleanupTransformContext,
  readRowsFileTransformContext,
  readSourceContactRewriteContext,
  readUnresolvedExchangeExternalizationContext,
  rowsFileChainsThroughUnresolvedExchangeExternalization,
  type RowsFileTransformContext,
  type RowsFileTransformEntry,
  type TransformContextLike,
  type UnresolvedExchangeExternalizationContext,
  unresolvedExchangeExternalizationRowsForIdentity,
} from "./workflow-row-transform-readers.ts";

export {
  type CanonicalSupportRewriteContext,
  cleanupInputRowsFile,
  decisionApplyExpectedRowsFile,
  readCanonicalSupportRewriteContext,
  readCleanupTransformContext,
  readRowsFileTransformContext,
  readSourceContactRewriteContext,
  readUnresolvedExchangeExternalizationContext,
  rowsFileChainsThroughUnresolvedExchangeExternalization,
  type RowsFileTransformContext,
  type RowsFileTransformEntry,
  type UnresolvedExchangeExternalizationContext,
  unresolvedExchangeExternalizationRowsForIdentity,
};

interface DeterministicTransformContexts {
  patchApplyContext?: TransformContextLike | null;
  classificationDecisionApplyContext?: TransformContextLike | null;
  locationDecisionApplyContext?: TransformContextLike | null;
  identityDecisionApplyContext?: TransformContextLike | null;
  identityReferenceRewriteContext?: TransformContextLike | null;
  unresolvedExchangeExternalizationContext?: TransformContextLike | null;
  sourceContactRewriteContext?: TransformContextLike | null;
  canonicalSupportRewriteContext?: TransformContextLike | null;
  cleanupContext?: TransformContextLike | null;
}

interface TransformReachabilityOptions {
  repoRoot: string;
  startFiles: unknown;
  expectedRowsFile: unknown;
  transforms: RowsFileTransformEntry[];
}

interface DecisionTransformReachabilityOptions extends DeterministicTransformContexts {
  repoRoot: string;
  context: TransformContextLike | null | undefined;
  expectedRowsFile: unknown;
}

interface IdentityChainOptions {
  repoRoot: string;
  patchOut: unknown;
  cleanupInput: unknown;
  identityReferenceRewriteContext?: TransformContextLike | null;
}

interface UnresolvedPatchChainOptions {
  repoRoot: string;
  patchOut: unknown;
  cleanupInput: unknown;
  unresolvedExchangeExternalizationContext?: TransformContextLike | null;
}

interface CombinedPatchChainOptions extends IdentityChainOptions {
  unresolvedExchangeExternalizationContext?: TransformContextLike | null;
}

export function decisionApplyOutputRowsMatch(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    context?.outputRows?.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

export function decisionApplyInputRowsMatch(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    context?.inputRows?.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

export function rowsFileTransformEntriesFromDecisionApply(
  context: TransformContextLike | null | undefined,
  kind: unknown,
): RowsFileTransformEntry[] {
  const entries: RowsFileTransformEntry[] = [];
  if (!context?.inputRows?.length || !context?.outputRows?.length) return entries;
  if (context.status && context.status !== "completed") return entries;
  for (const inputRowsFile of context.inputRows) {
    for (const outputRowsFile of context.outputRows) {
      entries.push({
        kind,
        inputRowsFile,
        outputRowsFile,
        inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
        outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
      });
    }
  }
  return entries;
}

export function rowsFileTransformEntriesFromPatchApply(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRows?.length) return [];
  return context.outputRows.map((outputRowsFile) => ({
    kind: "patch_apply",
    inputRowsFile: context.inputRowsFile!,
    outputRowsFile,
    inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
    outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
  }));
}

export function rowsFileTransformEntryFromIdentityReferenceRewrite(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  return [
    {
      kind: "identity_reference_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function rowsFileTransformEntryFromUnresolvedExchangeExternalization(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (context?.status !== "completed" || !context.inputRowsFile || !context.outputRowsFile) {
    return [];
  }
  return [
    {
      kind: "unresolved_exchange_externalization",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function rowsFileTransformEntryFromCanonicalSupportRewrite(
  context: TransformContextLike | null | undefined,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  const status = asText(context.status);
  if (
    status &&
    !["completed", "completed_no_rewrites", "completed_with_deferred_rows", "blocked"].includes(
      status,
    )
  ) {
    return [];
  }
  return [
    {
      kind: "canonical_support_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function rowsFileTransformEntryFromRowsFileContext(
  context: TransformContextLike | null | undefined,
  kind: unknown,
): RowsFileTransformEntry[] {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  const status = asText(context.status);
  if (
    status &&
    ![
      "completed",
      "completed_no_rewrites",
      "completed_with_deferred_rows",
      "ready",
      "ready_with_profile_waivers",
    ].includes(status)
  ) {
    return [];
  }
  return [
    {
      kind: kind || context.kind || "rows_file_transform",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
      inputPayloadSha256ByIdentity: context.inputPayloadSha256ByIdentity,
      outputPayloadSha256ByIdentity: context.outputPayloadSha256ByIdentity,
    },
  ];
}

export function deterministicRowsFileTransformEntries({
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: DeterministicTransformContexts): RowsFileTransformEntry[] {
  return [
    ...rowsFileTransformEntriesFromPatchApply(patchApplyContext),
    ...rowsFileTransformEntriesFromDecisionApply(
      classificationDecisionApplyContext,
      "classification_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      locationDecisionApplyContext,
      "location_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      identityDecisionApplyContext,
      "identity_decision_apply",
    ),
    ...rowsFileTransformEntryFromIdentityReferenceRewrite(identityReferenceRewriteContext),
    ...rowsFileTransformEntryFromUnresolvedExchangeExternalization(
      unresolvedExchangeExternalizationContext,
    ),
    ...rowsFileTransformEntryFromRowsFileContext(
      sourceContactRewriteContext,
      "source_contact_rewrite",
    ),
    ...rowsFileTransformEntryFromCanonicalSupportRewrite(canonicalSupportRewriteContext),
    ...rowsFileTransformEntryFromRowsFileContext(cleanupContext, "curation_cleanup"),
  ].filter((entry) => entry.inputRowsFile && entry.outputRowsFile);
}

export function sameRowsArtifact(repoRoot: string, left: unknown, right: unknown): boolean {
  if (sameArtifactPath(repoRoot, left, right)) return true;
  const resolvedLeft = normalizedArtifactPath(repoRoot, left);
  const resolvedRight = normalizedArtifactPath(repoRoot, right);
  if (!resolvedLeft || !resolvedRight || !fileExists(resolvedLeft) || !fileExists(resolvedRight)) {
    return false;
  }
  try {
    return sha256Text(readText(resolvedLeft)) === sha256Text(readText(resolvedRight));
  } catch {
    return false;
  }
}

export function rowsFileReachableThroughTransformChain({
  repoRoot,
  startFiles,
  expectedRowsFile,
  transforms,
}: TransformReachabilityOptions): boolean {
  if (!expectedRowsFile) return false;
  const reachable: unknown[] = [];
  const addReachable = (filePath: unknown): boolean => {
    if (!filePath) return false;
    if (reachable.some((existing) => sameRowsArtifact(repoRoot, existing, filePath))) {
      return false;
    }
    reachable.push(filePath);
    return true;
  };
  for (const filePath of ensureArray(startFiles)) addReachable(filePath);
  if (reachable.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile))) {
    return true;
  }
  for (let pass = 0; pass <= transforms.length; pass += 1) {
    let changed = false;
    for (const transform of transforms) {
      const inputReachable = reachable.some((filePath) =>
        sameRowsArtifact(repoRoot, filePath, transform.inputRowsFile),
      );
      if (inputReachable) {
        changed = addReachable(transform.outputRowsFile) || changed;
      }
    }
    if (reachable.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile))) {
      return true;
    }
    if (!changed) break;
  }
  return false;
}

export function decisionApplyOutputRowsReachableThroughDeterministicTransforms({
  repoRoot,
  context,
  expectedRowsFile,
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: DecisionTransformReachabilityOptions): boolean {
  return rowsFileReachableThroughTransformChain({
    repoRoot,
    startFiles: context?.outputRows ?? [],
    expectedRowsFile,
    transforms: deterministicRowsFileTransformEntries({
      patchApplyContext,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  });
}

export function decisionApplyOutputRowsChainThroughPatch(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  patchApplyContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, expectedRowsFile),
    ),
  );
}

export function patchApplyOutputChainsThroughIdentityRewrite({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
}: IdentityChainOptions): boolean {
  return Boolean(
    patchOut &&
    cleanupInput &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    sameArtifactPath(repoRoot, patchOut, identityReferenceRewriteContext.inputRowsFile) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, cleanupInput),
  );
}

export function patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  unresolvedExchangeExternalizationContext,
}: UnresolvedPatchChainOptions): boolean {
  return rowsFileChainsThroughUnresolvedExchangeExternalization({
    repoRoot,
    upstreamFile: patchOut,
    finalFile: cleanupInput,
    unresolvedExchangeExternalizationContext,
  });
}

export function patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
}: CombinedPatchChainOptions): boolean {
  return Boolean(
    patchApplyOutputChainsThroughIdentityRewrite({
      repoRoot,
      patchOut,
      cleanupInput: unresolvedExchangeExternalizationContext?.inputRowsFile,
      identityReferenceRewriteContext,
    }) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: identityReferenceRewriteContext?.outputRowsFile,
      finalFile: cleanupInput,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

export function decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  patchApplyContext: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewrite(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    decisionApplyOutputRowsMatch(
      repoRoot,
      context,
      identityReferenceRewriteContext.inputRowsFile,
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(
      repoRoot,
      context,
      identityReferenceRewriteContext.inputRowsFile,
    ) &&
    sameArtifactPath(
      repoRoot,
      identityReferenceRewriteContext.outputRowsFile,
      unresolvedExchangeExternalizationContext.inputRowsFile,
    ) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
      finalFile: expectedRowsFile,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

export function decisionApplyOutputRowsChainThroughClassification(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  classificationDecisionApplyContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    classificationDecisionApplyContext?.inputRows?.some((filePath) =>
      decisionApplyOutputRowsMatch(repoRoot, context, filePath),
    ) &&
    decisionApplyOutputRowsMatch(repoRoot, classificationDecisionApplyContext, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  classificationDecisionApplyContext: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    classificationDecisionApplyContext?.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
    ) &&
    decisionApplyOutputRowsChainThroughClassification(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext.inputRowsFile,
    ) &&
    sameArtifactPath(repoRoot, identityReferenceRewriteContext.outputRowsFile, expectedRowsFile),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot: string,
  context: TransformContextLike | null | undefined,
  classificationDecisionApplyContext: TransformContextLike | null | undefined,
  identityReferenceRewriteContext: TransformContextLike | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContextLike | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
      repoRoot,
      context,
      classificationDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext.inputRowsFile,
    ) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
      finalFile: expectedRowsFile,
      unresolvedExchangeExternalizationContext,
    }),
  );
}
