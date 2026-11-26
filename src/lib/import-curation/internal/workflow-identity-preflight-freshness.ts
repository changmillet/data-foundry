import { identityFreshnessIdentityKey } from "./dataset-payload.ts";
import { sha256Json } from "./hash-utils.ts";
import { asText, ensureArray, repoRelativePath } from "./runtime-io.ts";
import {
  type DecisionApplyContextLike,
  type ProfileLike,
  type RowsTransformContextLike,
  type UnresolvedExchangeExternalizationContextLike,
} from "./workflow-context-types.ts";
import { deterministicRowsFileTransformEntries } from "./workflow-row-transform-context.ts";

export interface IdentityPreflightJsonRecord {
  [key: string]: unknown;
}

export interface DatasetIdentity extends IdentityPreflightJsonRecord {
  id?: unknown;
  version?: unknown;
  payload?: unknown;
}

export interface IdentityPreflightFreshness extends IdentityPreflightJsonRecord {
  current_payload_sha256: string | null;
  request_target_sha256: string | null;
  current_payload_matches_request: unknown;
  current_payload_scope_accepted?: unknown;
}

export interface IdentityPreflightResult extends IdentityPreflightJsonRecord {
  status?: unknown;
  decision?: unknown;
  confidence?: unknown;
  next_action?: unknown;
  target?: unknown;
  candidates?: unknown;
  candidate_sources?: unknown;
  findings?: unknown;
  blockers?: unknown;
  files?: unknown;
  out_dir?: unknown;
}

export interface IdentityPreflightRow extends IdentityPreflightJsonRecord {
  dataset_type: string;
  dataset_id: string;
  dataset_version: string;
  source_file?: unknown;
  request_file?: string | null;
  output_dir?: string | null;
  remote_search?: unknown;
  request?: IdentityPreflightJsonRecord | null;
  result?: IdentityPreflightResult | null;
  status: string;
  freshness?: IdentityPreflightFreshness;
}

export interface IdentityPreflightContext {
  indexPath: string;
  rows: IdentityPreflightRow[];
  rowsByIdentity: Map<string, IdentityPreflightRow>;
  completed: number;
  pending: number;
}

type TransformContextLike = RowsTransformContextLike;
type DecisionApplyContext = DecisionApplyContextLike;
type ExternalizationContext = UnresolvedExchangeExternalizationContextLike;

export interface TransformOptions {
  patchApplyContext?: TransformContextLike | null;
  classificationDecisionApplyContext?: DecisionApplyContext | null;
  locationDecisionApplyContext?: TransformContextLike | null;
  identityDecisionApplyContext?: TransformContextLike | null;
  identityReferenceRewriteContext?: TransformContextLike | null;
  unresolvedExchangeExternalizationContext?: ExternalizationContext | null;
  sourceContactRewriteContext?: TransformContextLike | null;
  canonicalSupportRewriteContext?: TransformContextLike | null;
  cleanupContext?: TransformContextLike | null;
}

interface ClassificationFreshnessOptions {
  repoRoot: string;
  freshness: IdentityPreflightFreshness;
  datasetType: string;
  identity: DatasetIdentity;
  classificationDecisionApplyContext?: DecisionApplyContext | null;
}

interface DeterministicFreshnessOptions extends TransformOptions {
  repoRoot: string;
  freshness: IdentityPreflightFreshness;
  datasetType: string;
  identity: DatasetIdentity;
}

interface ExternalizationFreshnessOptions {
  freshness: IdentityPreflightFreshness;
  datasetType: string;
  identity: DatasetIdentity;
  unresolvedExchangeExternalizationContext?: ExternalizationContext | null;
}

export interface AttachFreshnessOptions extends TransformOptions {
  repoRoot?: string;
  datasetType?: string;
  identity?: DatasetIdentity;
}

export interface SourceContextOptions {
  profile?: ProfileLike | null;
  datasetType: string;
  curationQueueContext?: IdentityPreflightJsonRecord | null;
  context?: { rows?: unknown } | null;
}

export interface IdentityLookupContext {
  rowsByIdentity: ReadonlyMap<string, unknown>;
}

export interface DependencyPreflightRow extends IdentityPreflightJsonRecord {
  relation: string;
  ref: unknown;
  ref_path: unknown;
  identity_preflight: IdentityPreflightRow | null;
}

export interface BuildAuthoringContextOptions extends TransformOptions {
  context?: IdentityPreflightContext | null;
  datasetType: string;
  identity: DatasetIdentity;
  curationQueueContext?: IdentityPreflightJsonRecord | null;
  repoRoot: string;
}

export interface IdentityPreflightAuthoringContext extends IdentityPreflightJsonRecord {
  current: IdentityPreflightRow | null;
  dependencies: DependencyPreflightRow[];
}

export function isRecord(value: unknown): value is IdentityPreflightJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): IdentityPreflightJsonRecord {
  return isRecord(value) ? value : {};
}

export function identityPreflightRowForIdentity(
  context: IdentityLookupContext | null | undefined,
  datasetType: string,
  identity: DatasetIdentity | null | undefined,
): IdentityPreflightRow | null {
  if (!context || !identity?.id) return null;
  return (context.rowsByIdentity.get(
    `${datasetType}:${identity.id}@@${identity.version || "00.00.001"}`,
  ) ??
    context.rowsByIdentity.get(`${datasetType}:${identity.id}`) ??
    null) as IdentityPreflightRow | null;
}

export function identityPreflightFreshness(
  row: unknown,
  payload: unknown,
): IdentityPreflightFreshness {
  const request = asRecord(asRecord(row).request);
  const currentPayloadSha256 = payload ? sha256Json(payload) : null;
  const requestTargetSha256 = asText(request.target_sha256) || null;
  return {
    current_payload_sha256: currentPayloadSha256,
    request_target_sha256: requestTargetSha256,
    current_payload_matches_request: Boolean(
      currentPayloadSha256 && requestTargetSha256 && currentPayloadSha256 === requestTargetSha256,
    ),
  };
}

export function classificationFreshnessAllowance({
  repoRoot,
  freshness,
  datasetType,
  identity,
  classificationDecisionApplyContext,
}: ClassificationFreshnessOptions): IdentityPreflightJsonRecord | null {
  if (
    freshness?.current_payload_matches_request === true ||
    classificationDecisionApplyContext?.status !== "completed"
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key) return null;
  const classificationInputPayloadSha256 =
    classificationDecisionApplyContext.inputPayloadSha256ByIdentity?.get(key) ?? null;
  const classificationOutputPayloadSha256 =
    classificationDecisionApplyContext.outputPayloadSha256ByIdentity?.get(key) ?? null;
  const requestMatchesClassificationInput = Boolean(
    freshness?.request_target_sha256 &&
    classificationInputPayloadSha256 &&
    freshness.request_target_sha256 === classificationInputPayloadSha256,
  );
  const currentMatchesClassificationOutput = Boolean(
    freshness?.current_payload_sha256 &&
    classificationOutputPayloadSha256 &&
    freshness.current_payload_sha256 === classificationOutputPayloadSha256,
  );
  if (!requestMatchesClassificationInput || !currentMatchesClassificationOutput) {
    return null;
  }
  const reportPath = asText(classificationDecisionApplyContext.reportPath);
  return {
    reason: "classification_decision_apply",
    report: reportPath ? repoRelativePath(repoRoot, reportPath) : null,
    input_rows_files: (classificationDecisionApplyContext.inputRows ?? []).map((file) =>
      repoRelativePath(repoRoot, file),
    ),
    output_rows_files: (classificationDecisionApplyContext.outputRows ?? []).map((file) =>
      repoRelativePath(repoRoot, file),
    ),
    request_payload_matches_classification_input: requestMatchesClassificationInput,
    current_payload_matches_classification_output: currentMatchesClassificationOutput,
    classification_input_payload_sha256: classificationInputPayloadSha256,
    classification_output_payload_sha256: classificationOutputPayloadSha256,
  };
}

export function deterministicTransformFreshnessAllowance({
  repoRoot,
  freshness,
  datasetType,
  identity,
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: DeterministicFreshnessOptions): IdentityPreflightJsonRecord | null {
  if (
    freshness?.current_payload_matches_request === true ||
    !freshness?.request_target_sha256 ||
    !freshness?.current_payload_sha256
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key) return null;
  const transforms = deterministicRowsFileTransformEntries({
    patchApplyContext,
    classificationDecisionApplyContext,
    locationDecisionApplyContext,
    identityDecisionApplyContext,
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    sourceContactRewriteContext,
    canonicalSupportRewriteContext,
    cleanupContext,
  });
  const reachable = new Set([freshness.request_target_sha256]);
  const applied: IdentityPreflightJsonRecord[] = [];
  for (let pass = 0; pass <= transforms.length; pass += 1) {
    let changed = false;
    for (const transform of transforms) {
      const inputPayloadSha256 = transform.inputPayloadSha256ByIdentity?.get(key) ?? null;
      const outputPayloadSha256 = transform.outputPayloadSha256ByIdentity?.get(key) ?? null;
      if (!inputPayloadSha256 || !outputPayloadSha256 || !reachable.has(inputPayloadSha256)) {
        continue;
      }
      if (!reachable.has(outputPayloadSha256)) {
        reachable.add(outputPayloadSha256);
        applied.push({
          kind: transform.kind,
          input_payload_sha256: inputPayloadSha256,
          output_payload_sha256: outputPayloadSha256,
          input_rows_file: transform.inputRowsFile
            ? repoRelativePath(repoRoot, transform.inputRowsFile)
            : null,
          output_rows_file: transform.outputRowsFile
            ? repoRelativePath(repoRoot, transform.outputRowsFile)
            : null,
        });
        changed = true;
      }
      if (reachable.has(freshness.current_payload_sha256)) {
        return {
          reason: "deterministic_rows_file_transform_chain",
          request_payload_sha256: freshness.request_target_sha256,
          current_payload_sha256: freshness.current_payload_sha256,
          accepted_payload_sha256: freshness.current_payload_sha256,
          transforms: applied,
        };
      }
    }
    if (reachable.has(freshness.current_payload_sha256)) {
      return {
        reason: "deterministic_rows_file_transform_chain",
        request_payload_sha256: freshness.request_target_sha256,
        current_payload_sha256: freshness.current_payload_sha256,
        accepted_payload_sha256: freshness.current_payload_sha256,
        transforms: applied,
      };
    }
    if (!changed) break;
  }
  return null;
}

export function externalizationFreshnessAllowance({
  freshness,
  datasetType,
  identity,
  unresolvedExchangeExternalizationContext,
}: ExternalizationFreshnessOptions): IdentityPreflightJsonRecord | null {
  if (
    datasetType !== "process" ||
    freshness?.current_payload_matches_request === true ||
    unresolvedExchangeExternalizationContext?.status !== "completed"
  ) {
    return null;
  }
  const key = identityFreshnessIdentityKey({ datasetType, identity });
  if (!key || !unresolvedExchangeExternalizationContext.affectedKeys.has(key)) {
    return null;
  }
  const externalizedPayloadSha256 =
    unresolvedExchangeExternalizationContext.outputPayloadSha256ByIdentity.get(key) ?? null;
  return {
    reason: "unresolved_exchange_externalization",
    report: unresolvedExchangeExternalizationContext.reportPathRelative,
    input_rows_file: unresolvedExchangeExternalizationContext.inputRowsFileRelative,
    output_rows_file: unresolvedExchangeExternalizationContext.outputRowsFileRelative,
    traces_file: unresolvedExchangeExternalizationContext.tracesFileRelative,
    externalized_exchange_count:
      unresolvedExchangeExternalizationContext.externalizedExchangeCountByIdentity.get(key) ?? 0,
    current_payload_matches_externalized_output: Boolean(
      freshness?.current_payload_sha256 &&
      externalizedPayloadSha256 &&
      freshness.current_payload_sha256 === externalizedPayloadSha256,
    ),
    externalized_payload_sha256: externalizedPayloadSha256,
  };
}

export function attachIdentityPreflightFreshness(
  row: IdentityPreflightRow | null | undefined,
  payload: unknown,
  options: AttachFreshnessOptions = {},
): IdentityPreflightRow | null {
  if (!row) return null;
  const freshness = identityPreflightFreshness(row, payload);
  const deterministicAllowances = [
    classificationFreshnessAllowance({
      repoRoot: options.repoRoot!,
      freshness,
      datasetType: options.datasetType!,
      identity: options.identity!,
      classificationDecisionApplyContext: options.classificationDecisionApplyContext,
    }),
    externalizationFreshnessAllowance({
      freshness,
      datasetType: options.datasetType!,
      identity: options.identity!,
      unresolvedExchangeExternalizationContext: options.unresolvedExchangeExternalizationContext,
    }),
    deterministicTransformFreshnessAllowance({
      repoRoot: options.repoRoot!,
      freshness,
      datasetType: options.datasetType!,
      identity: options.identity!,
      patchApplyContext: options.patchApplyContext,
      classificationDecisionApplyContext: options.classificationDecisionApplyContext,
      locationDecisionApplyContext: options.locationDecisionApplyContext,
      identityDecisionApplyContext: options.identityDecisionApplyContext,
      identityReferenceRewriteContext: options.identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext: options.unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext: options.sourceContactRewriteContext,
      canonicalSupportRewriteContext: options.canonicalSupportRewriteContext,
      cleanupContext: options.cleanupContext,
    }),
  ].filter(Boolean);
  return {
    ...row,
    freshness: {
      ...freshness,
      deterministic_transform_allowance: deterministicAllowances[0] ?? null,
      deterministic_transform_allowances: deterministicAllowances,
      current_payload_scope_accepted: Boolean(
        freshness.current_payload_matches_request || deterministicAllowances.length > 0,
      ),
    },
  };
}

export function identityPreflightFreshnessAccepted(freshness: unknown): boolean {
  const typedFreshness = asRecord(freshness);
  return Boolean(
    typedFreshness.current_payload_matches_request === true ||
    typedFreshness.current_payload_scope_accepted === true,
  );
}

export function identityPreflightSourceContextRequired({
  profile,
  datasetType,
  curationQueueContext,
  context,
}: SourceContextOptions): boolean {
  return Boolean(
    asText(profile?.id).toLowerCase() === "bafu" &&
    ["flow", "process"].includes(datasetType) &&
    curationQueueContext?.status === "attached" &&
    ensureArray(context?.rows).some((row) => asText(asRecord(row).source_file)),
  );
}

export function identityPreflightHasSourceContext(row: unknown): boolean {
  return Boolean(asText(asRecord(row).source_file));
}

export function dependencyPayloadForFreshness(dependency: unknown): unknown {
  const typedDependency = asRecord(dependency);
  const rows = ensureArray(
    typedDependency.input_rows ??
      typedDependency.rows ??
      typedDependency.payload_rows ??
      typedDependency.payloadRows,
  ).filter(Boolean);
  return rows[0] ?? typedDependency.payload ?? null;
}

export function dependencyIdentityPreflightRows(
  context: IdentityPreflightContext | null | undefined,
  curationQueueContext: IdentityPreflightJsonRecord | null | undefined,
  options: AttachFreshnessOptions = {},
): DependencyPreflightRow[] {
  if (!context || !curationQueueContext) return [];
  const rows: DependencyPreflightRow[] = [];
  const seen = new Set<string>();
  for (const dependency of ensureArray(curationQueueContext.dependency_rows)) {
    const typedDependency = asRecord(dependency);
    const task = asRecord(typedDependency.task);
    const datasetType = asText(task.entity_type);
    const identity = {
      id: asText(task.entity_id),
      version: asText(task.version) || "00.00.001",
    };
    const row = identityPreflightRowForIdentity(context, datasetType, identity);
    if (!row) continue;
    const key = `${row.dataset_type}:${row.dataset_id}@@${row.dataset_version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      relation: "dependency",
      ref: typedDependency.ref ?? null,
      ref_path: typedDependency.ref_path ?? null,
      identity_preflight: attachIdentityPreflightFreshness(
        row,
        dependencyPayloadForFreshness(dependency),
        {
          datasetType,
          identity,
          repoRoot: options.repoRoot,
          classificationDecisionApplyContext: options.classificationDecisionApplyContext,
          locationDecisionApplyContext: options.locationDecisionApplyContext,
          identityDecisionApplyContext: options.identityDecisionApplyContext,
          identityReferenceRewriteContext: options.identityReferenceRewriteContext,
          unresolvedExchangeExternalizationContext:
            options.unresolvedExchangeExternalizationContext,
          sourceContactRewriteContext: options.sourceContactRewriteContext,
          canonicalSupportRewriteContext: options.canonicalSupportRewriteContext,
          cleanupContext: options.cleanupContext,
        },
      ),
    });
  }
  return rows;
}

export function buildIdentityPreflightAuthoringContext({
  context,
  datasetType,
  identity,
  curationQueueContext,
  repoRoot,
  unresolvedExchangeExternalizationContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  sourceContactRewriteContext,
  canonicalSupportRewriteContext,
  cleanupContext,
}: BuildAuthoringContextOptions): IdentityPreflightAuthoringContext | null {
  if (!context) return null;
  const current = attachIdentityPreflightFreshness(
    identityPreflightRowForIdentity(context, datasetType, identity),
    identity.payload,
    {
      datasetType,
      identity,
      repoRoot,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    },
  );
  const dependencies = dependencyIdentityPreflightRows(context, curationQueueContext, {
    repoRoot,
    classificationDecisionApplyContext,
    locationDecisionApplyContext,
    identityDecisionApplyContext,
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    sourceContactRewriteContext,
    canonicalSupportRewriteContext,
    cleanupContext,
  });
  return {
    index_file: repoRelativePath(repoRoot, context.indexPath),
    status:
      current?.status === "completed" &&
      dependencies.every((row) => row.identity_preflight?.status === "completed")
        ? "completed"
        : "pending_or_partial",
    current,
    dependencies,
    counts: {
      index_rows: context.rows.length,
      completed: context.completed,
      pending: context.pending,
      dependency_rows: dependencies.length,
    },
    policy:
      "Identity preflight is a read-only database candidate recall and deterministic identity decision artifact. AI may use it as evidence, but database writes still require Foundry finalize and CLI commit handoff gates.",
  };
}
