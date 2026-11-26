import type { BundleRowType } from "../bundle-row-types.ts";
import type { CanonicalSupportCacheContext, RewriteStats } from "../canonical-support-rewrites.ts";
import type { IdentityArtifactIndex } from "../identity-preflight-artifacts.ts";
import type { ProcessSourceReferenceRow, SourceMetadata } from "../source-semantics.ts";
import { readOnlyStageContract } from "../stage-contract.ts";

export interface LooseRecord {
  [key: string]: unknown;
  processDataSet?: LooseRecord;
  processInformation?: LooseRecord;
  flowDataSet?: LooseRecord;
  flowInformation?: LooseRecord;
  contactDataSet?: LooseRecord;
  contactInformation?: LooseRecord;
  dataSetInformation?: LooseRecord;
  name?: LooseRecord;
  mixAndLocationTypes?: unknown;
  geography?: LooseRecord;
  locationOfOperationSupplyOrProduction?: LooseRecord;
  exchanges?: LooseRecord;
  referenceToFlowDataSet?: LooseRecord;
  files?: LooseRecord;
  inputs?: LooseRecord;
  commands?: LooseRecord;
  batch_patch_contract?: LooseRecord;
  payload?: LooseRecord;
  "common:name"?: LooseRecord;
  "common:other"?: LooseRecord;
}

export interface BundleSelection {
  seed: unknown;
  selected: string[];
  missing_process_ids: string[];
  [key: string]: unknown;
}

export interface DatasetIdentity {
  id: string | null;
  version: string | null;
}

export interface LocationCandidate {
  code: string;
  [key: string]: unknown;
}

export interface ProcessFlowEvidence {
  flow_id: string;
  flow_version: string;
  process_id: string | null;
  process_version: string | null;
  process_source_file: string | null;
  process_location: string | null;
  exchange_location: string | null;
}

export interface SemanticSummary {
  dataset_id: string | null;
  kind: string;
  materialized_as_source_row?: boolean;
  [key: string]: unknown;
}

export type SourceReferenceRow = ProcessSourceReferenceRow;

export interface IdentityPreflightArtifacts extends IdentityArtifactIndex {
  rows: unknown[];
  indexPath: string;
  [key: string]: unknown;
}

export type CanonicalSupportCache = CanonicalSupportCacheContext;

export interface SelectedBundle {
  process_id: string;
  bundle_dir: string | null;
  manifest: string | null;
}

export interface BundleSampleDependencies {
  addDedupedBundleRow: (options: {
    rowsByType: Record<string, Map<string, LooseRecord>>;
    sourceByType: Record<string, Map<string, string>>;
    blockers: LooseRecord[];
    type: string;
    payload: LooseRecord;
    sourceFile: string;
  }) => boolean;
  asText: (value: unknown) => string;
  attachIdentityPreflightRows: (
    rows: LooseRecord[],
    artifacts: IdentityPreflightArtifacts,
  ) => unknown;
  booleanOption: (value: unknown) => boolean;
  profileFor: (
    repoRoot: string,
    profile: string,
    options: LooseRecord,
  ) => { domainRules?: unknown; authorization?: unknown };
  repoRoot: string;
  buildBafuFallbackSourcePayload: (options?: {
    contactReference?: unknown;
    id?: unknown;
    version?: string;
    language?: unknown;
    timestamp?: unknown;
  }) => LooseRecord;
  buildDatabaseFallbackSourcePayload: (options?: {
    profile?: unknown;
    contactReference?: unknown;
    id?: unknown;
    version?: string;
    language?: unknown;
    timestamp?: unknown;
  }) => LooseRecord;
  buildBafuProcessContextSourcePayload: (options?: {
    metadata?: SourceMetadata | null;
    contactReference?: unknown;
    id?: unknown;
    version?: string;
    language?: unknown;
    timestamp?: unknown;
  }) => LooseRecord | null;
  buildIdentityPreflightArtifacts: (options: {
    rowsByType: Record<"flow" | "process", Map<string, LooseRecord>>;
    sourceByType: Record<"flow" | "process", Map<string, string | null | undefined>>;
    outDir: string;
    cliBin: string | string[];
  }) => IdentityPreflightArtifacts;
  buildLibraryContactPayload: (
    options: LooseRecord,
    template: LooseRecord | null,
    context: { rewriteRows?: LooseRecord[]; stats?: Record<string, number> },
  ) => LooseRecord;
  classificationAuthoringCommands: (options: {
    cliBin: string | string[];
    outDir: string;
    rowsDir: string;
    type: string;
    rowType?: string;
  }) => LooseRecord;
  cloneJson: (value: LooseRecord) => LooseRecord;
  collectBundleQualityFindings: (options: {
    payload: LooseRecord;
    type: string;
    sourceFile: string;
    sourceTraces: LooseRecord[];
    blockers: LooseRecord[];
    stats: Record<string, number>;
    classificationQueueRows: LooseRecord[];
    classificationCommandsByType: Record<string, unknown>;
  }) => void;
  collectElementaryFlowReuseFindings: (options: {
    payload: LooseRecord;
    type: string;
    sourceFile: string;
    sourceTraces: LooseRecord[];
    blockers: LooseRecord[];
    stats: Record<string, number>;
    elementaryFlowReuseRows: LooseRecord[];
    allowAccountLocalSupportAndElementary?: boolean;
  }) => void;
  collectLocationQualityFindings: (options: {
    payload: LooseRecord;
    type: string;
    sourceFile: string;
    blockers: LooseRecord[];
    stats: Record<string, number>;
    locationQueueRows: LooseRecord[];
    locationCodeMap: Map<string, string>;
    locationCommands: LooseRecord;
  }) => void;
  collectSourceTracePayloads: (payload: LooseRecord) => LooseRecord[];
  contactGlobalReference: (options: Record<string, unknown>) => LooseRecord;
  datasetIdentity: (payload: LooseRecord, type: string) => DatasetIdentity;
  ensureArray: (value: unknown) => LooseRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  findFirstBundleContactTemplate: (bundleDirs: string[]) => LooseRecord | null;
  listProcessBundleDirs: (bundlesDir: unknown) => string[];
  loadCanonicalSupportCache: (options: LooseRecord) => CanonicalSupportCache;
  loadTidasLocationCodeMap: () => Map<string, string>;
  locationAuthoringCommands: (options: {
    cliBin: string | string[];
    outDir: string;
    rowsDir: string;
    type: string;
  }) => LooseRecord;
  nowIso: () => string;
  processOriginalSourceMetadata: (payload: LooseRecord) => SourceMetadata | null;
  processSourceReferenceRows: (
    payload: LooseRecord,
    sourceLookup: Map<string, SemanticSummary>,
    sourceFile: unknown,
  ) => SourceReferenceRow[];
  readJson: (filePath: string) => LooseRecord;
  repairTrueSourceClassification: (
    payload: LooseRecord,
    options: { sourceFile: unknown; stats: Record<string, number>; repairRows: LooseRecord[] },
  ) => void;
  repairTrueSourceDescription: (
    payload: LooseRecord,
    options: { sourceFile: unknown; stats: Record<string, number>; repairRows: LooseRecord[] },
  ) => void;
  repairTrueSourceIdentity: (
    payload: LooseRecord,
    options: { sourceFile: unknown; stats: Record<string, number>; repairRows: LooseRecord[] },
  ) => void;
  repoRelativeMaybe: (filePath: unknown) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  resolveTiangongLcaCliCommandPrefix?: () => string[];
  resolveTiangongLcaCliBin: () => string;
  rewriteCanonicalFlowPropertyReferences: (
    payload: LooseRecord,
    options: {
      cacheContext: CanonicalSupportCache;
      datasetType: string;
      sourceFile: string;
      stats: RewriteStats;
      rewriteRows: LooseRecord[];
      blockers: LooseRecord[];
      scalingRequirements?: LooseRecord[];
      blockOnUnscaled?: boolean;
      datasetIdentityCache: DatasetIdentity;
      rowIndex?: number | null;
      language?: string;
      pathSegments?: Array<string | number>;
      allowAccountLocalSupportAndElementary?: boolean;
    },
  ) => void;
  rewriteCanonicalSourceReferences: (
    payload: LooseRecord,
    options: {
      datasetType: string;
      sourceFile: unknown;
      stats: Record<string, number>;
      rewriteRows: LooseRecord[];
      datasetIdentityCache?: DatasetIdentity | null;
      sourceLookup?: Map<string, SemanticSummary> | null;
    },
  ) => void;
  rewriteProcessDataSourceReferences: (
    payload: LooseRecord,
    options: {
      sourceLookup: Map<string, SemanticSummary>;
      replacementSource?: SemanticSummary | null;
      forceReplacementSource?: boolean;
      replacementRelation?: string | null;
      replacementReason?: string | null;
      sourceFile: unknown;
      stats: Record<string, number>;
      rewriteRows: LooseRecord[];
      datasetIdentityCache?: DatasetIdentity | null;
      language?: unknown;
    },
  ) => void;
  rewriteContactReferences: (
    payload: LooseRecord,
    reference: LooseRecord,
    stats: {
      rewritten: number;
      previous_ids: Set<string>;
      previous_descriptions: Set<string>;
    },
  ) => void;
  rewriteTrueSourceReferenceDescriptions: (
    value: unknown,
    options: {
      sourceLookup: Map<string, SemanticSummary>;
      sourceFile: unknown;
      stats: Record<string, number>;
      rewriteRows: LooseRecord[];
      datasetIdentityCache?: DatasetIdentity | null;
    },
  ) => void;
  sanitizeBundlePayload: (
    payload: LooseRecord,
    type: BundleRowType,
    sourceFile: string,
    stats: Record<string, number>,
    traceRows: LooseRecord[],
    sourceTraces: LooseRecord[],
  ) => void;
  selectProcessBundleDirs: (bundleDirs: string[], options: LooseRecord) => BundleSelection;
  shellQuote: (value: unknown) => string;
  sourceReferenceSemanticBlockers: (rows: SourceReferenceRow[]) => LooseRecord[];
  sourceSummaryMatchesOriginalMetadata: (
    summary: SemanticSummary | undefined,
    metadata: SourceMetadata,
  ) => boolean;
  sourceSemanticSummary: (payload: LooseRecord, sourceFile: unknown) => SemanticSummary;
  textValue: (value: unknown) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export const bundleSampleStageContract = readOnlyStageContract([
  {
    stage: "select_bundles",
    phase: "prepare",
    purpose: "Resolve requested process ids or deterministic sample selection.",
    inputs: ["process-bundles directory", "process id or sample options"],
    outputs: ["selected bundle manifest list"],
    side_effects: [],
  },
  {
    stage: "materialize_rows",
    phase: "rewrite_cleanup",
    purpose: "Read selected bundle dependencies and materialize source-language JSONL rows.",
    inputs: ["selected manifests", "bundle TIDAS payload files"],
    outputs: ["rows/*.jsonl", "support.jsonl"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "deterministic_rewrites",
    phase: "rewrite_cleanup",
    purpose:
      "Apply library contact, canonical source, canonical support, trace, source semantics, and placeholder repairs before write planning.",
    inputs: ["materialized row payloads", "canonical support cache"],
    outputs: [
      "source-reference-rewrites.jsonl",
      "canonical-support-rewrites.jsonl",
      "canonical-support-amount-scaling.jsonl when scale conversion is required",
      "source-semantics.jsonl",
      "flow location context traces embedded in flow rows",
    ],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "authoring_queues",
    phase: "gate_validate",
    purpose:
      "Produce classification, location, identity-preflight, and elementary-flow reuse queues for unresolved policy work.",
    inputs: ["rewritten rows", "TIDAS classification/location schemas"],
    outputs: [
      "classification-authoring-queue.jsonl",
      "location-authoring-queue.jsonl",
      "identity-preflight-requests.jsonl",
      "elementary-flow-reuse-queue.jsonl",
    ],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "report",
    phase: "report",
    purpose:
      "Emit a command report with row files, generated handoff commands, counts, and blockers.",
    inputs: ["all generated local artifacts"],
    outputs: ["dataset-bundle-sample-rows-report.json", "process-scope-ledger.jsonl"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);
