import path from "node:path";
import { readOnlyStageContract } from "../stage-contract.ts";

export type JsonRecord = Record<string, unknown>;

export interface SearchBody extends JsonRecord {
  query?: string;
  filter?: JsonRecord;
  filter_condition?: JsonRecord;
  data_source?: string;
  match_count?: number;
  page_size?: number;
  match_threshold?: number;
  lexical_weight?: number;
  semantic_weight?: number;
  rrf_k?: number;
}

export interface SearchRequest extends SearchBody {
  limit?: number;
}

export interface IdentityPreflightRow extends JsonRecord {
  dataset_type?: string;
  datasetType?: string;
  type?: string;
  dataset_id?: string;
  datasetId?: string;
  entity_id?: string;
  id?: string;
  dataset_version?: string;
  datasetVersion?: string;
  version?: string;
  request_file?: string;
  requestFile?: string;
  input?: string;
  output_dir?: string;
  outputDir?: string;
  expected_report_file?: string;
  identity_decision_file?: string;
  identityDecisionFile?: string;
  report_file?: string;
  reportFile?: string;
  request_bytes_sha256?: string;
  request_json_sha256?: string;
  target_sha256?: string;
  source_file?: string;
  sourceFile?: string;
  relevant_input_hashes?: Record<string, string>;
  remote_search?: {
    query?: string;
    edge_request?: { endpoint?: string; body?: SearchBody };
  };
  remote_candidate_search?: SearchRequest;
  request?: { remote_candidate_search?: SearchRequest };
  merge_source?: string;
  merge_source_file?: string | null;
}

export interface IdentityPreflightReport extends JsonRecord {
  status?: string;
  decision?: string;
  confidence?: number;
  next_action?: string;
  ok?: boolean;
  candidates?: JsonRecord[];
  candidate_sources?: JsonRecord[];
  blockers?: JsonRecord[];
}

export interface RunResultRow extends JsonRecord {
  status: string;
  failure_code?: string | null;
  report_status?: string | null;
  attempts?: number;
  attempt?: number;
  cli_exit_code?: number | null;
  dataset_type?: string;
  dataset_id?: string;
  dataset_version?: string;
  request_file?: string | null;
  report_file?: string | null;
  stdout_log?: string;
  stderr_log?: string;
  binding_sha256?: string;
}

export interface AuditResultRow extends JsonRecord {
  status: string;
  blockers: JsonRecord[];
  warnings: JsonRecord[];
}

export interface CliCommand {
  command: string;
  args: string[];
  display: string;
  package: string | null;
  package_version?: string | null;
  bin_path?: string;
  source?: string;
}

export interface IdentityPreflightOptions extends JsonRecord {
  help?: boolean;
}

export interface IdentityPreflightRunDependencies {
  executionEnvironment?: NodeJS.ProcessEnv;
  executionCwd?: string;
  asText: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  buildIdentityPreflightArtifacts: (input: {
    rowsByType: Record<string, Map<string, JsonRecord>>;
    sourceByType: Record<string, Map<string, string>>;
    outDir: string;
    cliBin: string[];
  }) => { rows: IdentityPreflightRow[]; indexPath: string; root: string };
  datasetIdentity: (row: JsonRecord, type: string) => { id: string | null; version: string | null };
  ensureArray: (value: unknown) => JsonRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  identityPreflightSourceIndexPaths: (options: IdentityPreflightOptions) => string[];
  integerOption: (value: unknown, fallback: number | null) => number | null;
  jsonSha256: (value: unknown) => string;
  loadIdentityPreflightSourceFileMap: (paths: string[]) => {
    blockers: JsonRecord[];
    sourceFilesByIdentity: Map<string, string>;
    rowCount: number;
  };
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  positiveIntegerOption: (value: unknown, fallback: number | null) => number | null;
  readJson: (filePath: string) => JsonRecord;
  readJsonLines: (filePath: string) => IdentityPreflightRow[];
  readRowsFile: (filePath: string) => JsonRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (filePath: unknown) => string | null;
  resolveTiangongLcaCliCommand?: () => CliCommand;
  resolveTiangongLcaCliCommandPrefix?: () => string[];
  resolveTiangongLcaCliBin: () => string;
  safeFileToken: (value: unknown, fallback: string) => string;
  sha256Text: (text: string) => string;
  shellQuote: (value: string) => string;
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  writeText: (filePath: string, text: string) => void;
}

// Run-level identity-preflight RESULT cache (env-gated; off unless
// BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE points at a directory). Entries are keyed by
// the complete execution binding hash, including target, request, CLI, account, and
// input evidence. Only positive canonical-reuse results may be published or restored;
// negative/create-new searches must be repeated. After an identity is minted or
// committed, the batch runner scans the bound manifests and removes every positive
// cache entry for that dataset identity before another scope can reuse stale evidence.
export function identityPreflightResultCacheDir(
  resolveRepoPath: IdentityPreflightRunDependencies["resolveRepoPath"],
  environment: NodeJS.ProcessEnv,
): string | null {
  const raw = environment.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE;
  return raw ? resolveRepoPath(raw) : null;
}

export function identityPreflightResultCacheEntryDir(
  cacheDir: string | null,
  bindingSha256: string,
): string | null {
  if (!cacheDir || !bindingSha256) return null;
  return path.join(cacheDir, bindingSha256);
}

export const identityPreflightRunStageContract = readOnlyStageContract([
  {
    stage: "load_index",
    phase: "prepare",
    purpose: "Read and select rows from a Foundry identity-preflight request index.",
    inputs: ["identity-preflight-requests.jsonl", "dataset type/id/offset/limit options"],
    outputs: ["selected request rows"],
    side_effects: [],
  },
  {
    stage: "normalize_requests",
    phase: "rewrite_cleanup",
    purpose:
      "Resolve request files, output directories, row keys, retry settings, and timeout settings before invoking the published CLI.",
    inputs: ["selected request rows", "runner options"],
    outputs: ["normalized executable request descriptors"],
    side_effects: [],
  },
  {
    stage: "execute_cli_preflight",
    phase: "gate_validate",
    purpose:
      "Execute the published tiangong-lca flow/process identity-preflight command for each selected request.",
    inputs: ["selected request rows", "request JSON files"],
    outputs: ["identity-decision.json", "identity candidate artifacts", "stdout/stderr logs"],
    side_effects: ["runs published CLI read-only search", "writes local .foundry artifacts"],
  },
  {
    stage: "collect_evidence",
    phase: "report",
    purpose:
      "Normalize CLI results so blocked/needs-review identity findings remain evidence rather than runner failures.",
    inputs: ["CLI stdout", "identity-decision report files"],
    outputs: ["identity-preflight-run-results.jsonl"],
    side_effects: ["writes local .foundry artifacts"],
  },
  {
    stage: "report",
    phase: "report",
    purpose: "Emit selected counts, failures, identity findings, and artifact paths.",
    inputs: ["normalized run results"],
    outputs: ["dataset-identity-preflight-run-report.json"],
    side_effects: ["writes local .foundry artifacts"],
  },
]);

export function identityPreflightRunHelpPayload() {
  return {
    schema_version: 1,
    status: "help",
    command: "dataset-identity-preflight-run",
    purpose:
      "Execute Foundry-generated process/flow identity-preflight request indexes through the CLI without writing the database.",
    usage: [
      "node src/dev-cli.ts dataset-identity-preflight-run --index <identity-preflight-requests.jsonl> --out-dir <run-dir> --timeout-ms 60000",
      "node src/dev-cli.ts dataset-identity-preflight-run --index ./identity-preflight-requests/identity-preflight-requests.jsonl --only-pending --timeout-ms 60000",
      "node src/dev-cli.ts dataset-identity-preflight-run --index ./identity-preflight-requests/identity-preflight-requests.jsonl --retry-failed ./identity-preflight-run/dataset-identity-preflight-run-report.json --max-attempts 3",
    ],
    ...identityPreflightRunStageContract,
  };
}

export function buildIdentityPreflightRunCounts({
  rows,
  initiallySelectedRows,
  retryFailedKeys,
  selectedRows,
  resultRows,
  failedRows,
  blockers,
}: {
  rows: IdentityPreflightRow[];
  initiallySelectedRows: IdentityPreflightRow[];
  retryFailedKeys: Set<string> | null;
  selectedRows: IdentityPreflightRow[];
  resultRows: RunResultRow[];
  failedRows: RunResultRow[];
  blockers: JsonRecord[];
}) {
  return {
    index_rows: rows.length,
    initially_selected_rows: initiallySelectedRows.length,
    retry_failed_input_rows: retryFailedKeys ? retryFailedKeys.size : 0,
    selected_rows: selectedRows.length,
    attempts: resultRows.reduce((total, row) => total + Number(row.attempts ?? 0), 0),
    planned: resultRows.filter((row) => row.status === "planned").length,
    completed: resultRows.filter((row) => row.status === "completed").length,
    restored_from_bound_cache: resultRows.filter(
      (row) => row.status === "restored_from_bound_cache",
    ).length,
    skipped_bound_execution: resultRows.filter((row) => row.status === "skipped_bound_execution")
      .length,
    skipped_existing_report: resultRows.filter((row) => row.status === "skipped_existing_report")
      .length,
    failed: failedRows.length,
    identity_blocked: resultRows.filter((row) => row.report_status === "blocked").length,
    identity_needs_review: resultRows.filter((row) => row.report_status === "needs_review").length,
    cli_exit_nonzero: resultRows.filter(
      (row) => Number.isInteger(row.cli_exit_code) && row.cli_exit_code !== 0,
    ).length,
    blockers: blockers.length,
  };
}

export function createIdentityPreflightRunHelpers(deps: IdentityPreflightRunDependencies) {
  const {
    asText,
    ensureArray,
    fileExists,
    integerOption,
    normalizedList,
    positiveIntegerOption,
    readJson,
    readJsonLines,
    resolveRepoPath,
  } = deps;

  function identityPreflightRunIndexPath(options: IdentityPreflightOptions): string | null {
    return resolveRepoPath(
      options.index ||
        options.input ||
        options.identityPreflightIndex ||
        options.identityPreflightRequests,
    );
  }

  function identityPreflightSpawnTimeoutMs(timeoutMs: number): number {
    const graceMs = Math.min(5_000, Math.max(250, Math.ceil(timeoutMs * 0.1)));
    return timeoutMs + graceMs;
  }

  function identityPreflightRunPath(value: unknown): string | null {
    const resolved = resolveRepoPath(value);
    return resolved ? path.resolve(resolved) : null;
  }

  function identityPreflightRunReportFile(row: IdentityPreflightRow): string | null {
    const explicit =
      row.expected_report_file ||
      row.identity_decision_file ||
      row.identityDecisionFile ||
      row.report_file ||
      row.reportFile;
    if (explicit) return identityPreflightRunPath(explicit);
    const outputDir = row.output_dir || row.outputDir;
    return outputDir
      ? path.join(identityPreflightRunPath(outputDir)!, "outputs", "identity-decision.json")
      : null;
  }

  function identityPreflightRunOutputDir(row: IdentityPreflightRow): string | null {
    const outputDir = row.output_dir || row.outputDir;
    if (outputDir) return identityPreflightRunPath(outputDir);
    const reportFile = identityPreflightRunReportFile(row);
    return reportFile ? path.dirname(path.dirname(reportFile)) : null;
  }

  function identityPreflightRunRequestFile(row: IdentityPreflightRow): string | null {
    return identityPreflightRunPath(row.request_file || row.requestFile || row.input);
  }

  function identityPreflightRunRowKey(row: IdentityPreflightRow, index: number): string {
    return [
      row.dataset_type || row.type || "dataset",
      row.dataset_id || row.entity_id || row.id || `row-${index}`,
      row.dataset_version || row.version || "00.00.001",
    ].join(":");
  }

  function selectIdentityPreflightRunRows(
    rows: IdentityPreflightRow[],
    options: IdentityPreflightOptions,
  ): IdentityPreflightRow[] {
    const datasetTypes = new Set(
      normalizedList(options.datasetType || options.datasetTypes || options.type),
    );
    const ids = new Set(normalizedList(options.id || options.ids || options.datasetId));
    const offset = Math.max(0, integerOption(options.offset, 0) ?? 0);
    const limit = positiveIntegerOption(options.limit || options.count, null);
    const filtered = rows.filter((row) => {
      const datasetType = asText(row.dataset_type || row.type);
      const id = asText(row.dataset_id || row.entity_id || row.id);
      if (datasetTypes.size > 0 && !datasetTypes.has(datasetType)) return false;
      if (ids.size > 0 && !ids.has(id)) return false;
      return true;
    });
    return filtered.slice(offset, limit ? offset + limit : undefined);
  }

  function identityPreflightRunIdentityKey(row: IdentityPreflightRow): string {
    return [
      asText(row?.dataset_type || row?.type),
      asText(row?.dataset_id || row?.entity_id || row?.id),
      asText(row?.dataset_version || row?.version) || "00.00.001",
    ].join(":");
  }

  function parseJsonMaybe(text: unknown): IdentityPreflightReport | null {
    try {
      return text ? (JSON.parse(String(text)) as IdentityPreflightReport) : null;
    } catch {
      return null;
    }
  }

  function retryFailedRowsFromArtifact(value: unknown): IdentityPreflightRow[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(retryFailedRowsFromArtifact);
    if (typeof value !== "object" || value === null) return [];
    const artifact = value as IdentityPreflightRow;
    const directStatus = asText(artifact.status);
    const hasFailure =
      directStatus === "failed" || Boolean(artifact.failure_code) || artifact.failed === true;
    const nested = [
      artifact.results,
      artifact.rows,
      artifact.items,
      artifact.blockers,
      artifact.failures,
    ].flatMap(retryFailedRowsFromArtifact);
    return hasFailure ? [artifact, ...nested] : nested;
  }

  function retryFailedKeysFromArtifact(retryFailedPath: string): Set<string> {
    if (!retryFailedPath || !fileExists(retryFailedPath)) return new Set();
    const value = retryFailedPath.toLowerCase().endsWith(".jsonl")
      ? readJsonLines(retryFailedPath)
      : readJson(retryFailedPath);
    const keys = retryFailedRowsFromArtifact(value)
      .map(identityPreflightRunIdentityKey)
      .filter((key) => !key.startsWith(":"));
    return new Set(keys);
  }

  function retriableIdentityPreflightFailure(row: RunResultRow): boolean {
    return ["identity_preflight_timeout", "identity_preflight_report_missing_or_non_json"].includes(
      row.failure_code ?? "",
    );
  }

  function reusablePositiveIdentityReport(report: IdentityPreflightReport): boolean {
    const decision = asText(report?.decision).toLowerCase();
    return (
      ["reuse", "reuse_existing", "reuse_existing_reference", "block_duplicate"].includes(
        decision,
      ) && ensureArray(report?.candidates).length > 0
    );
  }

  return {
    identityPreflightRunIndexPath,
    identityPreflightSpawnTimeoutMs,
    identityPreflightRunReportFile,
    identityPreflightRunOutputDir,
    identityPreflightRunRequestFile,
    identityPreflightRunRowKey,
    selectIdentityPreflightRunRows,
    identityPreflightRunIdentityKey,
    parseJsonMaybe,
    retryFailedKeysFromArtifact,
    retriableIdentityPreflightFailure,
    reusablePositiveIdentityReport,
  };
}
