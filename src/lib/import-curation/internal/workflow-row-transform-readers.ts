import { readJsonLinesIfExists } from "./artifact-inputs.ts";
import { datasetIdentity, identityFreshnessIdentityKey } from "./dataset-payload.ts";
import { payloadSha256ByIdentityForRows } from "./full-context-proof.ts";
import { sha256Json } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
  sameArtifactPath,
} from "./runtime-io.ts";
import { readRowsIfExists } from "./workflow-patch-collect.ts";

export interface TransformJsonRecord {
  [key: string]: unknown;
}

export interface TransformArtifactEnvelope {
  path?: unknown;
  value?: unknown;
}

interface ReportFiles extends TransformJsonRecord {
  input_rows?: unknown;
  inputRows?: unknown;
  input?: unknown;
  output_rows?: unknown;
  outputRows?: unknown;
  output?: unknown;
  cleaned_rows?: unknown;
  cleanedRows?: unknown;
  traces?: unknown;
  unresolved_exchanges?: unknown;
  canonical_support_blockers?: unknown;
  blockers?: unknown;
  deferred_rows?: unknown;
  deferredRows?: unknown;
  canonical_support_rewrites?: unknown;
  rewrites?: unknown;
}

interface TransformReport extends TransformJsonRecord {
  status?: unknown;
  counts?: unknown;
  files?: unknown;
  proofs?: unknown;
  input_rows_file?: unknown;
  inputRowsFile?: unknown;
  output_rows_file?: unknown;
  outputRowsFile?: unknown;
  traces_file?: unknown;
  tracesFile?: unknown;
  rows_file?: unknown;
  rowsFile?: unknown;
  input_path?: unknown;
  inputPath?: unknown;
  out_path?: unknown;
  outPath?: unknown;
  blockers_file?: unknown;
  deferred_rows_file?: unknown;
  deferredRowsFile?: unknown;
  rewrites_file?: unknown;
  blockers?: unknown;
  deferred_blockers?: unknown;
  source_exchange_completeness_proofs?: unknown;
}

interface TransformTrace extends TransformJsonRecord {
  dataset_id?: unknown;
  entity_id?: unknown;
  dataset_version?: unknown;
  version?: unknown;
}

export interface TransformContextLike {
  kind?: unknown;
  status?: unknown;
  inputRowsFile?: string | null;
  outputRowsFile?: string | null;
  inputRows?: string[];
  outputRows?: string[];
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
}

export interface RowsFileTransformContext extends TransformContextLike {
  kind: unknown;
  artifact: TransformArtifactEnvelope;
  status: string;
  counts: TransformJsonRecord;
  sourceExchangeCompletenessProofs: unknown[];
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  reportPathRelative: string;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
}

export interface UnresolvedExchangeExternalizationContext extends TransformContextLike {
  artifact: TransformArtifactEnvelope;
  status: string;
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  tracesFile: string | null;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  tracesFileRelative: string | null;
  reportPathRelative: string;
  externalizedExchanges: number;
  affectedRows: number;
  traces: unknown[];
  affectedKeys: Set<string>;
  externalizedExchangeCountByIdentity: Map<string, number>;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
}

export interface CanonicalSupportRewriteContext extends TransformContextLike {
  artifact: TransformArtifactEnvelope;
  status: string;
  counts: TransformJsonRecord;
  inputRowsFile: string | null;
  outputRowsFile: string | null;
  deferredRowsFile: string | null;
  inputPayloadSha256ByIdentity: Map<string, string>;
  outputPayloadSha256ByIdentity: Map<string, string>;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  deferredRowsFileRelative: string | null;
  reportPathRelative: string;
  blockersFileRelative: string | null;
  rewritesFileRelative: string | null;
  blockerRows: unknown[];
  blockers: unknown[];
  deferredBlockers: unknown[];
  rewrites: unknown[];
}

export interface RowsFileTransformEntry extends TransformJsonRecord {
  kind?: unknown;
  inputRowsFile: string;
  outputRowsFile: string;
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
}

interface UnresolvedChainOptions {
  repoRoot: string;
  upstreamFile: unknown;
  finalFile: unknown;
  unresolvedExchangeExternalizationContext: TransformContextLike | null | undefined;
}

interface ExpectedRowsOptions {
  repoRoot: string;
  rowsFile: unknown;
  cleanupArtifact: TransformArtifactEnvelope | null | undefined;
}

export function readUnresolvedExchangeExternalizationContext(
  repoRoot: string,
  artifact: TransformArtifactEnvelope | null | undefined,
): UnresolvedExchangeExternalizationContext | null {
  if (!artifact) return null;
  const report = (artifact.value ?? {}) as TransformReport;
  const files = report.files as ReportFiles | null | undefined;
  const counts = report.counts as TransformJsonRecord | null | undefined;
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report.input_rows_file ?? report.inputRowsFile ?? files?.input_rows ?? files?.inputRows) as
      string | null | undefined,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    (report.output_rows_file ??
      report.outputRowsFile ??
      files?.output_rows ??
      files?.outputRows) as string | null | undefined,
  );
  const tracesFile = resolveRepoPath(
    repoRoot,
    (report.traces_file ?? report.tracesFile ?? files?.traces ?? files?.unresolved_exchanges) as
      string | null | undefined,
  );
  const traces = readJsonLinesIfExists(tracesFile);
  const affectedKeys = new Set<string>();
  const externalizedExchangeCountByIdentity = new Map<string, number>();
  for (const trace of traces) {
    const traceRecord = trace as TransformTrace | null | undefined;
    const id = asText(traceRecord?.dataset_id ?? traceRecord?.entity_id);
    const version = asText(traceRecord?.dataset_version ?? traceRecord?.version) || "00.00.001";
    if (!id) continue;
    const key = `process:${id}@@${version}`;
    affectedKeys.add(key);
    externalizedExchangeCountByIdentity.set(
      key,
      (externalizedExchangeCountByIdentity.get(key) ?? 0) + 1,
    );
  }
  const outputPayloadSha256ByIdentity = new Map<string, string>();
  if (outputRowsFile && fileExists(outputRowsFile)) {
    readRowsIfExists(outputRowsFile).forEach((row, index) => {
      const identity = datasetIdentity(row, index, "process");
      const key = identityFreshnessIdentityKey({
        datasetType: "process",
        identity,
      });
      if (key) {
        outputPayloadSha256ByIdentity.set(key, sha256Json(identity.payload));
      }
    });
  }
  return {
    artifact,
    status: asText(report.status),
    inputRowsFile,
    outputRowsFile,
    tracesFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    tracesFileRelative: repoRelativeArtifactPath(repoRoot, tracesFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path as string),
    externalizedExchanges: Number(counts?.externalized_exchanges ?? 0) || 0,
    affectedRows: Number(counts?.affected_rows ?? 0) || 0,
    traces,
    affectedKeys,
    externalizedExchangeCountByIdentity,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
      "process",
    ),
    outputPayloadSha256ByIdentity,
  };
}

export function readCanonicalSupportRewriteContext(
  repoRoot: string,
  artifact: TransformArtifactEnvelope | null | undefined,
): CanonicalSupportRewriteContext | null {
  if (!artifact) return null;
  const report = (artifact.value ?? {}) as TransformReport;
  const files = report.files as ReportFiles | null | undefined;
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      files?.input_rows ??
      files?.inputRows) as string | null | undefined,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    (report.output_rows_file ??
      report.outputRowsFile ??
      files?.output_rows ??
      files?.outputRows) as string | null | undefined,
  );
  const blockersFile = resolveRepoPath(
    repoRoot,
    (files?.canonical_support_blockers ?? files?.blockers ?? report.blockers_file) as
      string | null | undefined,
  );
  const deferredRowsFile = resolveRepoPath(
    repoRoot,
    (files?.deferred_rows ??
      files?.deferredRows ??
      report.deferred_rows_file ??
      report.deferredRowsFile) as string | null | undefined,
  );
  const rewritesFile = resolveRepoPath(
    repoRoot,
    (files?.canonical_support_rewrites ?? files?.rewrites ?? report.rewrites_file) as
      string | null | undefined,
  );
  const blockerRows = readJsonLinesIfExists(blockersFile);
  const hardBlockers = Array.isArray(report.blockers)
    ? report.blockers
    : String(report.status) === "blocked"
      ? blockerRows
      : [];
  const deferredBlockers = Array.isArray(report.deferred_blockers)
    ? report.deferred_blockers
    : String(report.status) === "completed_with_deferred_rows"
      ? blockerRows
      : [];
  return {
    artifact,
    status: asText(report.status),
    counts:
      report.counts && typeof report.counts === "object"
        ? (report.counts as TransformJsonRecord)
        : {},
    inputRowsFile,
    outputRowsFile,
    deferredRowsFile,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRowsFile ? [outputRowsFile] : [],
    ),
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    deferredRowsFileRelative: repoRelativeArtifactPath(repoRoot, deferredRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path as string),
    blockersFileRelative: repoRelativeArtifactPath(repoRoot, blockersFile),
    rewritesFileRelative: repoRelativeArtifactPath(repoRoot, rewritesFile),
    blockerRows,
    blockers: hardBlockers,
    deferredBlockers,
    rewrites: readJsonLinesIfExists(rewritesFile),
  };
}

export function readRowsFileTransformContext(
  repoRoot: string,
  artifact: TransformArtifactEnvelope | null | undefined,
  kind: unknown,
): RowsFileTransformContext | null {
  if (!artifact) return null;
  const report = (artifact.value ?? {}) as TransformReport;
  const files = report.files as ReportFiles | null | undefined;
  const proofs = report.proofs as TransformJsonRecord | null | undefined;
  const inputRowsFile = resolveRepoPath(
    repoRoot,
    (report.rows_file ??
      report.rowsFile ??
      report.input_rows_file ??
      report.inputRowsFile ??
      report.input_path ??
      report.inputPath ??
      files?.input_rows ??
      files?.inputRows ??
      files?.input) as string | null | undefined,
  );
  const outputRowsFile = resolveRepoPath(
    repoRoot,
    (report.output_rows_file ??
      report.outputRowsFile ??
      report.out_path ??
      report.outPath ??
      files?.output_rows ??
      files?.outputRows ??
      files?.cleaned_rows ??
      files?.cleanedRows ??
      files?.output) as string | null | undefined,
  );
  return {
    kind,
    artifact,
    status: asText(report.status),
    counts:
      report.counts && typeof report.counts === "object"
        ? (report.counts as TransformJsonRecord)
        : {},
    sourceExchangeCompletenessProofs: ensureArray(
      report.source_exchange_completeness_proofs ?? proofs?.source_exchange_completeness,
    ),
    inputRowsFile,
    outputRowsFile,
    inputRowsFileRelative: repoRelativeArtifactPath(repoRoot, inputRowsFile),
    outputRowsFileRelative: repoRelativeArtifactPath(repoRoot, outputRowsFile),
    reportPathRelative: repoRelativePath(repoRoot, artifact.path as string),
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRowsFile ? [inputRowsFile] : [],
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRowsFile ? [outputRowsFile] : [],
    ),
  };
}

export function readSourceContactRewriteContext(
  repoRoot: string,
  artifact: TransformArtifactEnvelope | null | undefined,
): RowsFileTransformContext | null {
  return readRowsFileTransformContext(repoRoot, artifact, "source_contact_rewrite");
}

export function readCleanupTransformContext(
  repoRoot: string,
  artifact: TransformArtifactEnvelope | null | undefined,
): RowsFileTransformContext | null {
  return readRowsFileTransformContext(repoRoot, artifact, "curation_cleanup");
}

export function unresolvedExchangeExternalizationRowsForIdentity(
  context: UnresolvedExchangeExternalizationContext | null | undefined,
  identity: { id?: unknown; version?: unknown } | null | undefined,
): unknown[] {
  if (!context || !identity?.id) return [];
  const key = `process:${identity.id}@@${identity.version || "00.00.001"}`;
  return context.traces.filter((trace) => {
    const traceRecord = trace as TransformTrace | null | undefined;
    const id = asText(traceRecord?.dataset_id ?? traceRecord?.entity_id);
    const version = asText(traceRecord?.dataset_version ?? traceRecord?.version) || "00.00.001";
    return key === `process:${id}@@${version}`;
  });
}

export function rowsFileChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  upstreamFile,
  finalFile,
  unresolvedExchangeExternalizationContext,
}: UnresolvedChainOptions): boolean {
  return Boolean(
    upstreamFile &&
    finalFile &&
    unresolvedExchangeExternalizationContext?.status === "completed" &&
    unresolvedExchangeExternalizationContext.inputRowsFile &&
    unresolvedExchangeExternalizationContext.outputRowsFile &&
    sameArtifactPath(
      repoRoot,
      upstreamFile,
      unresolvedExchangeExternalizationContext.inputRowsFile,
    ) &&
    sameArtifactPath(repoRoot, unresolvedExchangeExternalizationContext.outputRowsFile, finalFile),
  );
}

export function cleanupInputRowsFile(
  repoRoot: string,
  cleanupArtifact: TransformArtifactEnvelope | null | undefined,
): string | null {
  const value = cleanupArtifact?.value as TransformReport | null | undefined;
  const inputRows = value?.rows_file ?? value?.rowsFile ?? value?.input_path ?? value?.inputPath;
  return inputRows ? resolveRepoPath(repoRoot, inputRows as string | null | undefined) : null;
}

export function decisionApplyExpectedRowsFile({
  repoRoot,
  rowsFile,
  cleanupArtifact,
}: ExpectedRowsOptions): unknown {
  return cleanupArtifact ? cleanupInputRowsFile(repoRoot, cleanupArtifact) : rowsFile;
}
