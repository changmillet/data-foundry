import type { BundleRowType } from "../bundle-row-types.ts";
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
  id: string;
  version: string;
}

export interface LocationCandidate {
  code: string;
  [key: string]: unknown;
}

export interface ProcessFlowEvidence {
  flow_id: string;
  flow_version: string;
  process_id: string;
  process_version: string;
  process_source_file: string | null;
  process_location: string | null;
  exchange_location: string | null;
}

export interface SemanticSummary {
  dataset_id: string;
  kind: string;
  materialized_as_source_row?: boolean;
  [key: string]: unknown;
}

export interface SourceReferenceRow {
  relation: string;
  referenced_source_kind: string;
  ref_object_id: string;
  short_description: unknown;
  [key: string]: unknown;
}

export interface IdentityPreflightArtifacts {
  rows: unknown[];
  indexPath: string;
  [key: string]: unknown;
}

export interface CanonicalSupportCache {
  cachePath: string | null;
  [key: string]: unknown;
}

export interface SelectedBundle {
  process_id: string;
  bundle_dir: string | null;
  manifest: string | null;
}

export interface BundleSampleDependencies {
  addDedupedBundleRow: (options: Record<string, unknown>) => void;
  asText: (value: unknown) => string;
  attachIdentityPreflightRows: (
    rows: LooseRecord[],
    artifacts: IdentityPreflightArtifacts,
  ) => unknown;
  booleanOption: (value: unknown) => boolean;
  profileFor: (repoRoot: string, profile: string, options: LooseRecord) => LooseRecord;
  repoRoot: string;
  buildBafuFallbackSourcePayload: (options: Record<string, unknown>) => LooseRecord;
  buildDatabaseFallbackSourcePayload: (options: Record<string, unknown>) => LooseRecord;
  buildBafuProcessContextSourcePayload: (options: Record<string, unknown>) => LooseRecord | null;
  buildIdentityPreflightArtifacts: (options: Record<string, unknown>) => IdentityPreflightArtifacts;
  buildLibraryContactPayload: (
    options: LooseRecord,
    template: unknown,
    context: Record<string, unknown>,
  ) => LooseRecord;
  classificationAuthoringCommands: (options: Record<string, unknown>) => LooseRecord;
  cloneJson: (value: LooseRecord) => LooseRecord;
  collectBundleQualityFindings: (options: Record<string, unknown>) => void;
  collectElementaryFlowReuseFindings: (options: Record<string, unknown>) => void;
  collectLocationQualityFindings: (options: Record<string, unknown>) => void;
  collectSourceTracePayloads: (payload: LooseRecord) => LooseRecord[];
  contactGlobalReference: (options: Record<string, unknown>) => LooseRecord;
  datasetIdentity: (payload: LooseRecord, type: string) => DatasetIdentity;
  ensureArray: (value: unknown) => LooseRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  findFirstBundleContactTemplate: (bundleDirs: string[]) => unknown;
  listProcessBundleDirs: (bundlesDir: unknown) => string[];
  loadCanonicalSupportCache: (options: LooseRecord) => CanonicalSupportCache;
  loadTidasLocationCodeMap: () => Map<string, unknown>;
  locationAuthoringCommands: (options: Record<string, unknown>) => LooseRecord;
  nowIso: () => string;
  processOriginalSourceMetadata: (payload: LooseRecord) => LooseRecord | null;
  processSourceReferenceRows: (
    payload: LooseRecord,
    sourceLookup: Map<string, SemanticSummary>,
    sourceFile: unknown,
  ) => SourceReferenceRow[];
  readJson: (filePath: string) => LooseRecord;
  repairTrueSourceClassification: (payload: LooseRecord, options: Record<string, unknown>) => void;
  repairTrueSourceDescription: (payload: LooseRecord, options: Record<string, unknown>) => void;
  repairTrueSourceIdentity: (payload: LooseRecord, options: Record<string, unknown>) => void;
  repoRelativeMaybe: (filePath: unknown) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string;
  resolveTiangongLcaCliCommandPrefix?: () => string[];
  resolveTiangongLcaCliBin: () => string;
  rewriteCanonicalFlowPropertyReferences: (
    payload: LooseRecord,
    options: Record<string, unknown>,
  ) => void;
  rewriteCanonicalSourceReferences: (
    payload: LooseRecord,
    options: Record<string, unknown>,
  ) => void;
  rewriteProcessDataSourceReferences: (
    payload: LooseRecord,
    options: Record<string, unknown>,
  ) => void;
  rewriteContactReferences: (
    payload: LooseRecord,
    reference: LooseRecord,
    stats: Record<string, unknown>,
  ) => void;
  rewriteTrueSourceReferenceDescriptions: (options: Record<string, unknown>) => void;
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
    metadata: LooseRecord,
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
