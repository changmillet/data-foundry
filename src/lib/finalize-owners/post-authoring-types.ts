import fs from "node:fs";
import path from "node:path";
import type { ProcessSourceReferenceRow } from "../source-semantics.ts";
import { readOnlyStageContract } from "../stage-contract.ts";

export type JsonRecord = Record<string, unknown>;

export interface DatasetReference extends JsonRecord {
  "@refObjectId"?: string;
  refObjectId?: string;
  ref_object_id?: string;
  "@version"?: string;
}

export interface VersionedAdministration extends JsonRecord {
  publicationAndOwnership?: JsonRecord;
}

export interface FlowPropertyDataSet extends JsonRecord {
  flowPropertiesInformation?: {
    quantitativeReference?: { referenceToReferenceUnitGroup?: DatasetReference };
  };
  administrativeInformation?: VersionedAdministration;
}

export interface ContactDataSet extends JsonRecord {
  contactInformation: {
    dataSetInformation: { "common:name"?: { "#text"?: string } };
  };
}

export interface DatasetRow extends JsonRecord {
  processDataSet?: JsonRecord;
  flowDataSet?: JsonRecord;
  lifeCycleModelDataSet?: JsonRecord;
  contactDataSet?: ContactDataSet;
  sourceDataSet?: JsonRecord;
  flowPropertyDataSet?: FlowPropertyDataSet;
  unitGroupDataSet?: { administrativeInformation?: VersionedAdministration } & JsonRecord;
}

export interface CountMap extends JsonRecord {
  blockers?: number;
  write_candidates?: number;
  flow_reference_rewrites?: number;
  reference_rows?: number;
  externalized_exchanges?: number;
  input_rows?: number;
  output_rows?: number;
  support_source_rows?: number;
  support_account_local_fp_ug_rows?: number;
  source_reference_rewrites?: number;
  contact_reference_rewrites?: number;
  support_rows?: number;
  canonical_unit_group_reference_proofs?: number;
  canonical_flow_property_reference_rewrites?: number;
  deferred_rows?: number;
  deferred_blockers?: number;
  request_rows?: number;
  replaced_rows?: number;
  selected_rows?: number;
  completed?: number;
  skipped_existing_report?: number;
  failed?: number;
  location_targets?: number;
  invalid?: number;
  ai_patch_evidence_entries?: number;
  ai_classification_decision_entries?: number;
  ai_location_decision_entries?: number;
  ai_identity_decision_entries?: number;
  source_contact_rewrite_semantic_evidence_entries?: number;
  unresolved_trace_entries?: number;
  blocked_flow_dependency_externalized?: number;
  source_exchange_completeness_entries?: number;
  identity_reference_rewrites?: number;
  tasks?: number;
  process_rows?: number;
  flow_rows?: number;
  external_flow_refs?: number;
  entries_written?: number;
}

export interface FileMap extends JsonRecord {
  report?: string | null;
  output_rows?: string | null;
  support_rows?: string | null;
  source_reference_rewrites?: string | null;
  source_support_semantics?: string | null;
  source_support_repairs?: string | null;
  cleaned_rows?: string | null;
  canonical_support_rewrites?: string | null;
  canonical_support_blockers?: string | null;
  deferred_rows?: string | null;
  final_rows?: string | null;
  commit_handoff_plan?: string | null;
  unresolved_traces?: string | null;
  source_exchange_completeness_traces?: string | null;
  identity_reference_rewrites?: string | null;
  traces?: string | null;
}

export interface FinalizeStage extends JsonRecord {
  stage?: string;
  status?: string | null;
  command?: string;
  executable?: string;
  args?: string[];
  exit_code?: number;
  stderr?: string;
  report?: FinalizeStage | null;
  report_file?: string | null;
  cli_validation?: { report: string; exit: number };
  rust_report?: unknown;
  binary_version?: unknown;
  counts?: CountMap;
  files?: FileMap;
  canonical_support?: {
    canonical_unit_group_reference_keys?: Array<{ id: string; version: string }>;
  };
  blockers?: JsonRecord[];
  output_rows_file?: string | null;
  cleaned_rows_file?: string | null;
  rewrite_file?: string | null;
  reference_rows_file?: string | null;
  index_file?: string | null;
  base_index_file?: string | null;
  refresh_required?: boolean;
  refresh_forced?: boolean;
  refresh_plan?: { reason?: string };
  refresh_force_skipped_exact?: boolean;
  refresh_report?: FinalizeStage;
  refresh_report_file?: string | null;
  merge_report?: FinalizeStage;
  merge_report_file?: string | null;
  queue_dir?: string | null;
  cli_package?: string | JsonRecord | null;
  evidence?: {
    scope_blockers?: JsonRecord[];
    patch_evidence_file?: string | null;
  };
  items?: Array<{
    dataset_type?: string;
    entity_id?: string;
    version?: string;
    blockers?: JsonRecord[];
  }>;
  profile?: string;
  commands?: { commit?: unknown; post_write_verify?: unknown };
  commit_handoff?: { status?: string | null; blockers?: JsonRecord[] };
  foundry_wrapper?: { stderr?: string };
}

export type SourceReferenceRow = ProcessSourceReferenceRow;

export interface SourceSummary extends JsonRecord {
  dataset_id: string | null;
  kind: string;
}

export interface FinalizeOptions extends JsonRecord {
  help?: boolean;
}

export type FinalizeIdentityRequest = {
  rowsFile: string;
  outDir: string;
  options: FinalizeOptions;
};

export interface FinalizeDependencies {
  appendOption: (args: string[], name: string, value: unknown) => void;
  applyCanonicalSupportRewrites: (input: {
    datasetType: string;
    rowsFile: string;
    outFile?: string | null;
    outDir?: string | null;
    options?: FinalizeOptions;
  }) => FinalizeStage;
  applyIdentityReferenceRewrites: (input: {
    datasetType: string;
    rowsFile: string;
    outFile?: string | null;
    outDir?: string | null;
    options?: FinalizeOptions;
    allowMissingIndex?: boolean;
  }) => FinalizeStage;
  asText: (value: unknown) => string;
  profileFor?: (
    repoRoot: string,
    profile: string,
    options: FinalizeOptions,
  ) => { authorization?: unknown };
  blockersFromLocationAuditStage: (stage: FinalizeStage) => JsonRecord[];
  buildLibraryContactPayload: (
    options: FinalizeOptions,
    seed: JsonRecord | null,
    context: { rewriteRows?: JsonRecord[]; stats?: Record<string, number> },
  ) => DatasetRow;
  booleanOption: (value: unknown) => boolean;
  compactStageReport: (stage: FinalizeStage) => FinalizeStage;
  cloneJson: <T>(value: T) => T;
  contactGlobalReference: (input: JsonRecord) => JsonRecord;
  datasetIdentity: (
    row: DatasetRow,
    datasetType: string,
  ) => { id: string | null; version: string | null };
  datasetRowsFileStem: (datasetType: string) => string;
  ensureArray: (value: unknown) => JsonRecord[];
  externalizeUnresolvedProcessFlowExchanges: (input: {
    datasetType: string;
    rowsFile: string;
    outFile: string;
    outDir: string;
    options?: FinalizeOptions;
  }) => FinalizeStage;
  fileExists: (filePath: string | null | undefined) => boolean;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  postAuthoringPrewriteGateBlockers: (input: {
    schemaStage: FinalizeStage;
    qaStage: FinalizeStage;
    locationAuditBlockers: JsonRecord[];
    curationGate: JsonRecord | null;
    curationGateReportFile: string | null;
    requireDeterministicQa?: boolean;
    requireCurationGate?: boolean;
  }) => JsonRecord[];
  processSourceReferenceRows: (
    row: DatasetRow,
    sourceLookup: Map<string, SourceSummary>,
    rowsFile: string,
  ) => SourceReferenceRow[];
  profileFullContextRequirement: (profile: unknown, datasetType: string) => unknown;
  repoRelativeMaybe: (filePath: unknown) => string | null;
  loadCanonicalSupportCache: (options: FinalizeOptions) => {
    index: {
      unitGroupById: Map<string, { version?: string }>;
      flowPropertyById: Map<string, unknown>;
    };
  };
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  reportFileFromCliStage: (
    stage: FinalizeStage,
    paths: string[],
    fallback: string,
  ) => string | null;
  readRowsFile: (filePath: string) => DatasetRow[];
  readReferenceBytes?: (filePath: string) => Buffer;
  repairTrueSourceClassification: (
    row: DatasetRow,
    context: { sourceFile: unknown; stats: Record<string, number>; repairRows: JsonRecord[] },
  ) => void;
  repairTrueSourceDescription: (
    row: DatasetRow,
    context: { sourceFile: unknown; stats: Record<string, number>; repairRows: JsonRecord[] },
  ) => void;
  repairTrueSourceIdentity: (
    row: DatasetRow,
    context: { sourceFile: unknown; stats: Record<string, number>; repairRows: JsonRecord[] },
  ) => void;
  resolveRepoPath: (filePath: unknown) => string | null;
  rewriteCanonicalSourceReferences: (
    row: DatasetRow,
    context: {
      datasetType: string;
      sourceFile: unknown;
      stats: Record<string, number>;
      rewriteRows: JsonRecord[];
      datasetIdentityCache?: { id: string | null; version: string | null } | null;
      sourceLookup?: Map<string, SourceSummary> | null;
    },
  ) => void;
  rewriteContactReferences: (
    row: DatasetRow,
    reference: JsonRecord,
    stats: {
      rewritten: number;
      previous_ids: Set<string>;
      previous_descriptions: Set<string>;
    },
  ) => void;
  rewriteTrueSourceReferenceDescriptions: (
    row: JsonRecord,
    context: {
      sourceLookup: Map<string, SourceSummary>;
      sourceFile: unknown;
      stats: Record<string, number>;
      rewriteRows: JsonRecord[];
      datasetIdentityCache?: { id: string | null; version: string | null } | null;
    },
  ) => void;
  runDatasetCommitHandoffPlan: (options: JsonRecord) => FinalizeStage;
  runDatasetCurationCleanup: (input: {
    repoRoot?: string;
    options?: JsonRecord;
    processValidationReferences?: {
      rows: readonly unknown[];
      files: readonly { path: string; bytes: number; sha256: string }[];
    };
  }) => FinalizeStage;
  runDatasetCurationGate: (input: {
    repoRoot?: string;
    cliValidation?: { report: string; exit: number };
    options?: JsonRecord;
  }) => FinalizeStage;
  runDatasetMutationManifest: (input: { repoRoot?: string; options?: JsonRecord }) => FinalizeStage;
  runFinalizeAutoCurationQueue: (input: {
    datasetType: string;
    rowsFile: string;
    cleanedRowsFile: string;
    outDir: string;
    options: FinalizeOptions;
    fullContextRequirement: unknown;
    identityReferenceRewriteStage: FinalizeStage | null;
  }) => FinalizeStage;
  runFinalizeIdentityPreflightStage: (input: FinalizeIdentityRequest) => FinalizeStage;
  runTidasRowsValidation: (input: JsonRecord) => JsonRecord;
  runTiangongJsonStage: (stage: string, args: string[]) => FinalizeStage;
  skippedPrewriteStage: (stage: string, reason: string) => FinalizeStage;
  sourceReferenceSemanticBlockers?: (rows: SourceReferenceRow[]) => JsonRecord[];
  sourceReferenceRewritesFileForRowsFile: (
    rowsFile: string,
    options: FinalizeOptions,
  ) => string | null;
  sourceSemanticSummary: (row: DatasetRow, sourceFile: string) => SourceSummary;
  unique: <T>(values: T[]) => T[];
  writeFinalizeImportLedger?: (input: {
    report: JsonRecord;
    reportPath: string;
    ledgerDir: string | null;
  }) => FinalizeStage;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export interface FinalizeTiming extends JsonRecord {
  stage: string;
  status: string;
  started_at_utc: string;
  finished_at_utc: string;
  duration_ms: number;
  error?: string;
}

export const postAuthoringFinalizeStageContract = readOnlyStageContract([
  {
    stage: "prepare_scope",
    phase: "prepare",
    purpose:
      "Resolve dataset type, input rows, profile requirements, output directory, and full-context identity-preflight requirement.",
    inputs: ["rows file", "profile options", "queue/context options"],
    outputs: ["finalize scope"],
    side_effects: [],
  },
  {
    stage: "rewrite_and_cleanup",
    phase: "rewrite_cleanup",
    purpose:
      "Apply identity reference rewrites, unresolved exchange externalization, BAFU source/contact rewrites, canonical support rewrites, and deterministic curation cleanup.",
    inputs: [
      "input rows",
      "selected read-only Process validation references",
      "identity/preflight indexes",
      "BAFU source/contact policy",
      "canonical support cache",
    ],
    outputs: ["rewritten rows", "cleaned rows", "rewrite reports"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "gate_and_validate",
    phase: "gate_validate",
    purpose:
      "Run curation queue preparation, native Rust tidas validation, deterministic QA, location audit, curation gate, dry-run write planning, and optional remote reference verification.",
    inputs: ["cleaned rows", "context files", "queue artifacts"],
    outputs: ["validation/QA/gate/dry-run/remote-verify reports"],
    side_effects: [
      "runs native tidas and published CLI read-only checks",
      "writes local .foundry artifact files",
    ],
  },
  {
    stage: "mutation_manifest",
    phase: "gate_validate",
    purpose:
      "Build exact-scope mutation evidence and aggregate prewrite blockers before any explicit commit handoff.",
    inputs: ["cleaned rows", "all prewrite reports"],
    outputs: ["dataset-mutation-manifest report"],
    side_effects: ["writes local .foundry artifact files"],
  },
  {
    stage: "report",
    phase: "report",
    purpose:
      "Emit the post-authoring finalize report with runtime stages, counts, files, and blockers.",
    inputs: ["runtime stage reports", "mutation manifest"],
    outputs: ["dataset-post-authoring-finalize-report.json"],
    side_effects: ["writes local .foundry artifact files"],
  },
]);

export const postCleanupArtifactDirectories = [
  "source-contact-support-finalize",
  "identity-preflight-run",
  "identity-preflight-run-parallel",
  "identity-preflight-current-scope",
  "curation-queue",
  "curation-queue-inputs",
  "schema",
  "qa",
  "location-audit",
  "curation-gate",
  "dry-run",
  "precommit-verify-remote",
  "mutation-manifest",
  "commit-handoff",
];

export const postCleanupArtifactFiles = [
  "identity-reference-rewrite-external-flow-refs.jsonl",
  "process-reference-external-flow-refs.jsonl",
];

export function verifiedReferenceLedgerFilesForDir(ledgerDir: string | null): string[] {
  if (!ledgerDir) return [];
  return [
    "ok.flows.verified.jsonl",
    "ok.processes.verified.jsonl",
    "ok.sources.verified.jsonl",
    "ok.contacts.verified.jsonl",
    "ok.unitgroups.verified.jsonl",
    "ok.flowproperties.verified.jsonl",
  ]
    .map((name) => path.join(ledgerDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

export function stageStatus(value: FinalizeStage | null | undefined): string {
  if (!value || typeof value !== "object") return "completed";
  return value.status ?? value.report?.status ?? "completed";
}

export function timedFinalizeStage<T extends FinalizeStage>(
  timings: FinalizeTiming[],
  stage: string,
  nowIso: () => string,
  fn: () => T,
): T {
  const startedAtUtc = nowIso();
  const startedAtMs = Date.now();
  try {
    const result = fn();
    timings.push({
      stage,
      status: stageStatus(result),
      started_at_utc: startedAtUtc,
      finished_at_utc: nowIso(),
      duration_ms: Date.now() - startedAtMs,
    });
    return result;
  } catch (error: unknown) {
    timings.push({
      stage,
      status: "failed",
      started_at_utc: startedAtUtc,
      finished_at_utc: nowIso(),
      duration_ms: Date.now() - startedAtMs,
      error: String(error instanceof Error ? error.message : error),
    });
    throw error;
  }
}

export function compactStageReportWithTiming(
  stageReport: FinalizeStage,
  timingsByStage: Map<string, FinalizeTiming>,
  compactStageReport: (stage: FinalizeStage) => FinalizeStage,
): FinalizeStage {
  const compacted = compactStageReport(stageReport);
  const timing = compacted.stage ? timingsByStage.get(compacted.stage) : undefined;
  if (!timing) return compacted;
  return {
    ...compacted,
    started_at_utc: timing.started_at_utc,
    finished_at_utc: timing.finished_at_utc,
    duration_ms: timing.duration_ms,
  };
}

export function rowDatasetType(payload: DatasetRow, fallbackType: string): string {
  if (payload?.processDataSet) return "process";
  if (payload?.flowDataSet) return "flow";
  if (payload?.lifeCycleModelDataSet) return "lifecyclemodel";
  if (payload?.contactDataSet) return "contact";
  if (payload?.sourceDataSet) return "source";
  if (payload?.flowPropertyDataSet) return "flowproperty";
  if (payload?.unitGroupDataSet) return "unitgroup";
  return fallbackType;
}
