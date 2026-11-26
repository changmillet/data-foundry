export interface JsonRecord {
  [key: string]: unknown;
}

export interface ArtifactEnvelopeLike {
  path: string;
  value?: JsonRecord | null;
}

export interface RowsTransformContextLike {
  kind?: unknown;
  status?: unknown;
  inputRowsFile?: string | null;
  outputRowsFile?: string | null;
  inputRows?: string[];
  outputRows?: string[];
  counts?: JsonRecord;
  sourceExchangeCompletenessProofs?: unknown;
  inputPayloadSha256ByIdentity?: Map<string, string>;
  outputPayloadSha256ByIdentity?: Map<string, string>;
}

export interface IdentityReferenceRewriteContextLike extends RowsTransformContextLike {
  sourceFile?: string | null;
  scopedRows?: JsonRecord[];
}

export interface UnresolvedExchangeExternalizationContextLike extends RowsTransformContextLike {
  affectedKeys: Set<string>;
  externalizedExchangeCountByIdentity: Map<string, number>;
  outputPayloadSha256ByIdentity: Map<string, string>;
  reportPathRelative: string | null;
  inputRowsFileRelative: string | null;
  outputRowsFileRelative: string | null;
  tracesFileRelative: string | null;
}

export interface DecisionApplyContextLike extends RowsTransformContextLike {
  reportPath?: unknown;
  decisions?: readonly unknown[];
  decisionTaskProofs?: unknown;
  decisionTaskProof?: unknown;
  authoringPackageProofs?: readonly unknown[];
  identityReferenceRewritesFiles?: unknown;
  identityReferenceRewritesFile?: unknown;
}

export interface PatchApplyContextLike extends RowsTransformContextLike {
  evidenceRows?: readonly unknown[];
  globalBlockers?: readonly JsonRecord[];
  byIdentity: { get(key: string): unknown[] | undefined };
  byRowIndex: { get(key: number): unknown[] | undefined };
}

export interface ProfileLike {
  id?: unknown;
  docs?: unknown;
  fullContextAiCompletion?: unknown;
  full_context_ai_completion?: unknown;
  domainRules?: unknown;
  authorization?: unknown;
}

export interface ReferenceParts {
  table?: unknown;
  id?: unknown;
  version?: unknown;
}

export interface DatasetReference {
  table: string | null;
  id: string;
  version: string;
  path: string;
  type: string | null;
  short_description: string | null;
}

export interface RemoteVerifyArtifact {
  value?: JsonRecord;
}

export interface MapRows {
  success?: Map<string, JsonRecord>;
  prepared?: Map<string, JsonRecord>;
  failures?: Map<string, JsonRecord>;
}

export interface DryRunContexts {
  flow?: MapRows | null;
  process?: MapRows | null;
  lifecyclemodel?: MapRows | null;
  datasetSaveDraft?: MapRows | null;
}

export interface WriteIdentity extends JsonRecord {
  id: string;
  version: string;
  payload: unknown;
  dataset_type?: string | null;
  sourceRowsFile?: string | null;
}

export interface PartitionItem {
  decision: string;
  operation?: string | null;
}

export interface MutationManifestItem extends JsonRecord {
  dataset_type: string;
  entity_id: string;
  version: string;
  role: string;
  decision: string;
  operation: string | null;
  blockers: JsonRecord[];
  foundry_traces: {
    unresolved_traces: unknown[];
    unresolved_exchange_traces: unknown[];
    source_exchange_completeness: unknown[];
  };
  ai_patch_evidence_count?: number;
  identity_reference_rewrite_count: number;
}
