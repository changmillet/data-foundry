import {
  type DecisionTaskProof,
  type FullContextRequirement,
  payloadSha256ByIdentityForRows,
} from "./full-context-proof.ts";
import { asText, ensureArray, optionList, sameArtifactPath, unique } from "./runtime-io.ts";
import {
  type DecisionApplyContextLike,
  type IdentityReferenceRewriteContextLike,
} from "./workflow-context-types.ts";
import { readClassificationDecisionApplyContext } from "./workflow-decision-apply-context.ts";
import {
  decisionApplyExpectedRowsFile,
  decisionApplyInputRowsMatch,
  decisionApplyOutputRowsMatch,
  rowsFileChainsThroughUnresolvedExchangeExternalization,
  sameRowsArtifact,
} from "./workflow-row-transform-context.ts";

export interface DecisionJsonRecord {
  [key: string]: unknown;
}

export interface DecisionArtifactValue extends DecisionJsonRecord {
  rows_file?: unknown;
  rowsFile?: unknown;
  input_path?: unknown;
  inputPath?: unknown;
}

export interface DecisionArtifactEnvelope {
  path: string;
  value?: DecisionArtifactValue | null;
}

export interface DecisionRecord extends DecisionJsonRecord {
  dataset_type?: unknown;
  datasetType?: unknown;
  category_type?: unknown;
  categoryType?: unknown;
  dataset_id?: unknown;
  datasetId?: unknown;
  id?: unknown;
  dataset_version?: unknown;
  datasetVersion?: unknown;
  version?: unknown;
  used_context_kinds?: unknown;
  usedContextKinds?: unknown;
  resolution?: unknown;
  evidence?: unknown;
  authoring_context?: unknown;
  authoringContext?: unknown;
  authoring_context_sha256?: unknown;
  context_bundle_sha256?: unknown;
  contextBundleSha256?: unknown;
  decision_status?: unknown;
  decisionStatus?: unknown;
  status?: unknown;
  basis?: unknown;
  reason?: unknown;
}

export type DecisionContext = DecisionApplyContextLike;
export type TransformContext = IdentityReferenceRewriteContextLike;

export interface DecisionChainOptions {
  repoRoot: string;
  context: DecisionContext | null | undefined;
  expectedRowsFile: unknown;
}

export interface DecisionRowsFileOptions {
  repoRoot: string;
  rowsFile: string;
  cleanupArtifact?: DecisionArtifactEnvelope | null;
  context: DecisionContext | null | undefined;
}

export interface DecisionBuilderOptions {
  repoRoot: string;
  rowsFile: string;
  cleanupArtifact?: DecisionArtifactEnvelope | null;
  requirement: FullContextRequirement;
  classificationDecisionApplyArtifact?: DecisionArtifactEnvelope | null;
  classificationDecisionApplyContext?: DecisionContext | null;
  locationDecisionApplyArtifact?: DecisionArtifactEnvelope | null;
  locationDecisionApplyContext?: DecisionContext | null;
  identityDecisionApplyArtifact?: DecisionArtifactEnvelope | null;
  identityDecisionApplyContext?: DecisionContext | null;
  patchApplyContext?: TransformContext | null;
  identityReferenceRewriteContext?: TransformContext | null;
  unresolvedExchangeExternalizationContext?: TransformContext | null;
  sourceContactRewriteContext?: TransformContext | null;
  canonicalSupportRewriteContext?: TransformContext | null;
  cleanupContext?: TransformContext | null;
}

export function decisionApplyOutputRowsChainThroughUnresolvedExchangeExternalization(
  repoRoot: string,
  context: DecisionContext | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContext | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(
      repoRoot,
      context,
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

export function decisionApplyOutputRowsChainThroughPatchAndUnresolvedExchangeExternalization(
  repoRoot: string,
  context: DecisionContext | null | undefined,
  patchApplyContext: TransformContext | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContext | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, unresolvedExchangeExternalizationContext.inputRowsFile),
    ) &&
    rowsFileChainsThroughUnresolvedExchangeExternalization({
      repoRoot,
      upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
      finalFile: expectedRowsFile,
      unresolvedExchangeExternalizationContext,
    }),
  );
}

export function decisionApplyRowsEquivalentToExpected(
  repoRoot: string,
  context: DecisionContext | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    context?.inputRows?.some((filePath) =>
      sameRowsArtifact(repoRoot, filePath, expectedRowsFile),
    ) &&
    context?.outputRows?.some((filePath) => sameRowsArtifact(repoRoot, filePath, expectedRowsFile)),
  );
}

function decisionDatasetType(decision: unknown): string | null {
  const record = decision as DecisionRecord | null | undefined;
  const explicit = asText(record?.dataset_type ?? record?.datasetType);
  if (explicit) return explicit;
  const categoryType = asText(record?.category_type ?? record?.categoryType);
  if (categoryType === "process") return "process";
  if (categoryType.startsWith("flow")) return "flow";
  if (["source", "contact", "flowproperty", "unitgroup", "lifecyclemodel"].includes(categoryType)) {
    return categoryType;
  }
  return null;
}

function decisionTargetIdentityKeys(context: DecisionContext | null | undefined): string[] {
  return (ensureArray(context?.decisions) as DecisionRecord[])
    .map((decision) => {
      const datasetType = decisionDatasetType(decision);
      const id = asText(decision?.dataset_id ?? decision?.datasetId ?? decision?.id);
      const version =
        asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
        "00.00.001";
      return datasetType && id ? `${datasetType}:${id}@@${version}` : null;
    })
    .filter(Boolean) as string[];
}

export function decisionApplyContextRelevantToExpectedRowsFile({
  repoRoot,
  context,
  expectedRowsFile,
}: DecisionChainOptions): boolean {
  if (!context || !expectedRowsFile) return true;
  if (
    decisionApplyInputRowsMatch(repoRoot, context, expectedRowsFile) ||
    decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile)
  ) {
    return true;
  }
  const expectedKeys = new Set(payloadSha256ByIdentityForRows(repoRoot, [expectedRowsFile]).keys());
  if (expectedKeys.size === 0) return true;
  if (decisionTargetIdentityKeys(context).some((key) => expectedKeys.has(key))) return true;
  const contextKeys = [
    ...Array.from(context.inputPayloadSha256ByIdentity?.keys?.() ?? []),
    ...Array.from(context.outputPayloadSha256ByIdentity?.keys?.() ?? []),
  ];
  return contextKeys.some((key) => expectedKeys.has(key));
}

export function decisionApplyContextCoversExpectedRowsIdentity({
  repoRoot,
  context,
  expectedRowsFile,
}: DecisionChainOptions): boolean {
  if (!context || !expectedRowsFile) return false;
  const expectedKeys = new Set(payloadSha256ByIdentityForRows(repoRoot, [expectedRowsFile]).keys());
  if (expectedKeys.size === 0) return false;
  const contextKeys = new Set([
    ...decisionTargetIdentityKeys(context),
    ...Array.from(context.inputPayloadSha256ByIdentity?.keys?.() ?? []),
    ...Array.from(context.outputPayloadSha256ByIdentity?.keys?.() ?? []),
  ]);
  if (contextKeys.size === 0) return false;
  return Array.from(expectedKeys).every((key) => contextKeys.has(key));
}

export function decisionApplyContextRelevantToRowsFile({
  repoRoot,
  rowsFile,
  cleanupArtifact,
  context,
}: DecisionRowsFileOptions): boolean {
  return decisionApplyContextRelevantToExpectedRowsFile({
    repoRoot,
    context,
    expectedRowsFile: decisionApplyExpectedRowsFile({ repoRoot, rowsFile, cleanupArtifact }),
  });
}

export function decisionApplyOutputRowsChainThroughPatchIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot: string,
  context: DecisionContext | null | undefined,
  patchApplyContext: TransformContext | null | undefined,
  identityReferenceRewriteContext: TransformContext | null | undefined,
  unresolvedExchangeExternalizationContext: TransformContext | null | undefined,
  expectedRowsFile: unknown,
): boolean {
  return Boolean(
    expectedRowsFile &&
    patchApplyContext?.inputRowsFile &&
    identityReferenceRewriteContext?.inputRowsFile &&
    identityReferenceRewriteContext?.outputRowsFile &&
    unresolvedExchangeExternalizationContext?.inputRowsFile &&
    decisionApplyOutputRowsMatch(repoRoot, context, patchApplyContext.inputRowsFile) &&
    patchApplyContext.outputRows?.some((filePath) =>
      sameArtifactPath(repoRoot, filePath, identityReferenceRewriteContext.inputRowsFile),
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

export function identityDecisionApplyProvesReferenceRewrite(
  repoRoot: string,
  context: DecisionContext | null | undefined,
  identityReferenceRewriteContext: TransformContext | null | undefined,
): boolean {
  const scopedRows = identityReferenceRewriteContext?.scopedRows ?? [];
  const decisionRewriteFiles = unique(
    [
      ...ensureArray(context?.identityReferenceRewritesFiles),
      context?.identityReferenceRewritesFile,
    ].filter(Boolean),
  );
  if (decisionRewriteFiles.length === 0 || !identityReferenceRewriteContext?.sourceFile) {
    return false;
  }
  return decisionRewriteFiles.some((decisionRewriteFile) => {
    const directlyUsed = sameArtifactPath(
      repoRoot,
      decisionRewriteFile,
      identityReferenceRewriteContext.sourceFile,
    );
    const chainedThroughProcessRewrite = scopedRows.some((row) => {
      const rewriteSource = row?.rewrite_source as DecisionJsonRecord | null | undefined;
      const camelRewriteSource = row?.rewriteSource as DecisionJsonRecord | null | undefined;
      return (
        sameArtifactPath(repoRoot, rewriteSource?.file, decisionRewriteFile) ||
        sameArtifactPath(repoRoot, camelRewriteSource?.file, decisionRewriteFile)
      );
    });
    return Boolean(scopedRows.length > 0 && (directlyUsed || chainedThroughProcessRewrite));
  });
}

export function classificationDecisionContextKinds(decision: unknown): string[] {
  const record = decision as DecisionRecord | null | undefined;
  const resolution = record?.resolution as DecisionJsonRecord | null | undefined;
  const evidence = record?.evidence as DecisionJsonRecord | null | undefined;
  return [
    ...optionList(record?.used_context_kinds ?? record?.usedContextKinds),
    ...optionList(resolution?.used_context_kinds ?? resolution?.usedContextKinds),
    ...optionList(evidence?.used_context_kinds ?? evidence?.usedContextKinds),
  ];
}

export function classificationDecisionContextBundleSha256(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  const authoringContext = record?.authoring_context as DecisionJsonRecord | null | undefined;
  const camelContext = record?.authoringContext as DecisionJsonRecord | null | undefined;
  return asText(
    authoringContext?.context_bundle_sha256 ??
      camelContext?.contextBundleSha256 ??
      record?.authoring_context_sha256 ??
      record?.context_bundle_sha256 ??
      record?.contextBundleSha256,
  );
}

export function classificationDecisionCompletionStatus(decision: unknown): string {
  const record = decision as DecisionRecord | null | undefined;
  return asText(record?.decision_status ?? record?.decisionStatus ?? record?.status);
}

export function decisionTaskProofListFromContext(
  context: DecisionContext | null | undefined,
): DecisionTaskProof[] {
  const proofs = ensureArray(context?.decisionTaskProofs).filter(Boolean) as DecisionTaskProof[];
  if (proofs.length > 0) return proofs;
  return context?.decisionTaskProof ? [context.decisionTaskProof as DecisionTaskProof] : [];
}

export function decisionTaskContextBundleHashesFromContext(
  context: DecisionContext | null | undefined,
): string[] {
  return unique(
    decisionTaskProofListFromContext(context).map((proof) => proof.context_bundle_sha256),
  ) as string[];
}

export function readLocationDecisionApplyContext(
  repoRoot: string,
  locationDecisionApplyArtifact: DecisionArtifactEnvelope | null | undefined,
) {
  return readClassificationDecisionApplyContext(
    repoRoot,
    locationDecisionApplyArtifact,
    "location_decision_apply",
  );
}
