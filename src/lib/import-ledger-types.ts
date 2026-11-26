import { bundleRowTypes } from "./bundle-row-types.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonRecord | JsonValue[];
export interface JsonRecord {
  [key: string]: JsonValue | undefined;
}

export type LedgerDatasetType = keyof typeof bundleRowTypes | "support" | "unknown";
export type BlockerBucket =
  | "elementary-flow"
  | "canonical-support"
  | "classification"
  | "content-saturation"
  | "reference-closure"
  | "identity"
  | "remote-write"
  | "other";

export interface DatasetIdentity {
  id?: string | null;
  version?: string | null;
}

export interface BlockingDependency extends JsonRecord {
  dataset_type?: string | null;
  id?: string | null;
  version?: string | null;
  path?: string | null;
}

export interface ImportLedgerBlocker extends JsonRecord {
  code?: string | null;
  stage?: string | null;
  message?: string | null;
  dataset_type?: string | null;
  blocking_dependency?: BlockingDependency;
  reference_type?: string | null;
  table?: string | null;
  reference_id?: string | null;
  entity_id?: string | null;
  id?: string | null;
  reference_version?: string | null;
  version?: string | null;
  path?: string | null;
}

export interface ImportLedgerDependencies {
  asText: (value: unknown) => string;
  datasetIdentity: (payload: JsonValue, datasetType: string) => DatasetIdentity;
  fileExists: (filePath: string) => boolean;
  nowIso: () => string;
  readJson: (filePath: string) => JsonValue;
  readJsonLines: (filePath: string) => JsonValue[];
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  writeJson: (filePath: string, value: JsonValue) => void;
}

export interface ImportLedgerManifest extends JsonRecord {
  schema_version: 1;
  created_at_utc: string;
  updated_at_utc: string;
  ledger_dir: string;
  event_kinds: string[];
  latest_report: string | null;
  files: Record<string, string>;
  contract: {
    ok_prefix: "ok.*.verified.jsonl";
    blocked_prefix: "blocked.*.jsonl";
    retry_prefix: "retry.*.jsonl";
    resume_prefix: "resume.*.jsonl";
    append_only: true;
    dedup_key: "ledger_key";
  };
}

interface ImportLedgerRowBase extends JsonRecord {
  schema_version: 1;
  ledger_kind: "ok" | "blocked" | "resume";
  status: string;
  ledger_key?: string;
}

export interface VerifiedImportLedgerRow extends ImportLedgerRowBase {
  ledger_kind: "ok";
  status: "verified";
  verified_at_utc: string;
  row_index: number;
  row_dataset_type: string;
  dataset_id: string | null;
  version: string | null;
  payload_hash: string;
  dataset_key: string;
  scope_key: string;
  ledger_key: string;
  scope_dataset_type?: string | null;
  profile?: string | null;
  target_user_id?: string | null;
  expected_state_code?: number | null;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
  commit_report?: string | null;
  post_write_verify_report?: string | null;
  closeout_report?: string | null;
  root_payload_mismatches?: number;
}

export interface BlockedScopeImportLedgerRow extends ImportLedgerRowBase {
  ledger_kind: "blocked";
  status: "blocked_human_review";
  blocked_at_utc: string;
  scope_dataset_type: string | null;
  scope_ids: string[];
  scope_versions: string[];
  scope_key: string;
  blocker_codes: string[];
  blocker_count: number;
  required_human_action: string;
  ledger_key: string;
  profile?: string | null;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
  closeout_report?: string | null;
  curation_gate_report?: string | null;
  commit_handoff_plan?: string | null;
  rerun_command?: string | null;
}

export interface BlockedDependencyImportLedgerRow extends ImportLedgerRowBase {
  ledger_kind: "blocked";
  status: "blocked_human_review";
  blocked_at_utc: string;
  blocker_bucket: BlockerBucket;
  reason_code: string;
  message?: string | null;
  blocking_stage?: string | null;
  scope_dataset_type: string | null;
  scope_ids: string[];
  scope_key: string;
  blocking_dependency: BlockingDependency;
  required_human_action: string;
  ledger_key: string;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
  closeout_report?: string | null;
  raw_blocker?: JsonValue;
}

export interface RetryImportLedgerRow extends BlockedDependencyImportLedgerRow {}

export interface ResumePendingImportLedgerRow extends JsonRecord {
  schema_version: 1;
  ledger_kind: "resume";
  status: "pending_human_review";
  source_ledger_key: string | null;
  scope_key: string | null;
  scope_dataset_type: string | null;
  scope_ids: string[];
  blocker_codes: string[];
  blocker_count?: number | null;
  required_human_action?: string | null;
  final_rows_file?: string | null;
  finalize_report?: string | null;
  rerun_command?: string | null;
}

export interface ResumeSkippedImportLedgerRow extends JsonRecord {
  schema_version: 1;
  ledger_kind: "resume";
  status: "skipped_verified";
  source_ledger_key: string | null;
  dataset_key: string | null;
  row_dataset_type: string | null;
  dataset_id: string | null;
  version: string | null;
  verified_at_utc?: string | null;
  closeout_report?: string | null;
}

export type ImportLedgerRow =
  | VerifiedImportLedgerRow
  | BlockedScopeImportLedgerRow
  | BlockedDependencyImportLedgerRow
  | RetryImportLedgerRow
  | ResumePendingImportLedgerRow
  | ResumeSkippedImportLedgerRow;

interface ReportArtifactFields extends JsonRecord {
  dataset_type?: string | null;
  profile?: string | null;
  final_rows_file?: string | null;
  rows_file?: string | null;
  finalize_report?: string | null;
  mutation_manifest?: string | null;
}

export interface CompletedCloseoutReport extends ReportArtifactFields {
  status: "completed";
  target_user_id?: string | null;
  expected_state_code?: number | null;
  commit_report?: string | null;
  post_write_verify_report?: string | null;
  counts?: { root_payload_mismatches?: number };
}

export interface BlockedCloseoutReport extends ReportArtifactFields {
  status: "blocked" | "failed";
  blockers?: ImportLedgerBlocker[];
}

export type CloseoutReport = CompletedCloseoutReport | BlockedCloseoutReport;

export interface FinalizeArtifactFiles extends JsonRecord {
  curation_gate_report?: string | null;
  mutation_manifest?: string | null;
  commit_handoff_plan?: string | null;
}

export interface ReadyFinalizeReport extends ReportArtifactFields {
  status: "ready_for_remote_write" | "ready_reference_only";
}

export interface BlockedFinalizeReport extends ReportArtifactFields {
  status: "blocked" | "failed";
  blockers?: ImportLedgerBlocker[];
  files?: FinalizeArtifactFiles;
}

export type FinalizeReport = ReadyFinalizeReport | BlockedFinalizeReport;

export interface CloseoutLedgerWriteOptions {
  report: CloseoutReport | Record<string, unknown> | null;
  reportPath: string;
  ledgerDir: string | null;
}

export interface FinalizeLedgerWriteOptions {
  report: FinalizeReport | Record<string, unknown> | null;
  reportPath: string;
  ledgerDir: string | null;
}

export interface LedgerWriteCounts extends JsonRecord {
  entries_written: number;
  entries_skipped_existing?: number;
  blockers?: number;
  blocked_scopes?: number;
  rows?: number;
}

export interface SkippedImportLedgerWriteResult extends Record<string, unknown> {
  status: "skipped";
  reason:
    | "ledger_dir_missing"
    | "report_missing"
    | "closeout_not_completed_without_blockers"
    | "finalize_ready"
    | "no_blockers";
  files: Record<string, never>;
  counts: { entries_written: 0 };
}

export interface CompletedImportLedgerWriteResult extends Record<string, unknown> {
  status: "completed";
  files: Record<string, string>;
  counts: LedgerWriteCounts;
}

export type ImportLedgerWriteResult =
  SkippedImportLedgerWriteResult | CompletedImportLedgerWriteResult;

export interface DatasetImportLedgerReportOptions {
  help?: boolean;
  ledgerDir?: string;
  importLedgerDir?: string;
  outDir?: string;
}

export interface DatasetImportLedgerHelpReport {
  schema_version: 1;
  status: "help";
  command: "dataset-import-ledger-report";
  usage: string[];
  purpose: string;
  remote_write_mode: "read-only";
}

export interface DatasetImportLedgerReport extends JsonRecord {
  schema_version: 1;
  generated_at_utc: string;
  status: "completed" | "completed_with_blocked_scopes";
  ledger_dir: string;
  remote_write_mode: "read-only";
  policy: { resume_boundary: string };
  counts: {
    ok_rows: number;
    blocked_rows: number;
    retry_rows: number;
    resume_rows: number;
    skipped_verified_rows: number;
  };
  files: {
    report: string;
    resume_plan: string;
    resume_skipped_verified: string;
  };
}

export interface ImportLedgerUtils {
  runDatasetImportLedgerReport: (
    options: DatasetImportLedgerReportOptions,
  ) => DatasetImportLedgerHelpReport | DatasetImportLedgerReport;
  writeCloseoutImportLedger: (options: CloseoutLedgerWriteOptions) => ImportLedgerWriteResult;
  writeFinalizeImportLedger: (options: FinalizeLedgerWriteOptions) => ImportLedgerWriteResult;
}

export interface RowIdentity {
  payload: JsonValue;
  dataset_type: string;
  dataset_id: string | null;
  version: string | null;
  payload_hash: string;
}

export interface AppendJsonLinesResult {
  file: string;
  appended: number;
  skipped_existing: number;
}

export interface ManifestUpdateOptions {
  ledgerDir: string;
  eventKind: string;
  files?: Record<string, string | null | undefined>;
  reportPath?: string | null;
}

export interface NormalizedBlockerInput {
  raw: JsonValue;
  blocker: ImportLedgerBlocker;
}

export const LEDGER_FILES = {
  manifest: "run-manifest.json",
  okScopes: "ok.scopes.verified.jsonl",
  blockedScopes: "blocked.scopes.human-review.jsonl",
  resumePlan: "resume.plan.jsonl",
  resumeSkipped: "resume.skipped-verified.jsonl",
  report: "dataset-import-ledger-report.json",
};

export const BLOCKER_BUCKETS = [
  "elementary-flow",
  "canonical-support",
  "classification",
  "content-saturation",
  "reference-closure",
  "identity",
  "remote-write",
  "other",
];
