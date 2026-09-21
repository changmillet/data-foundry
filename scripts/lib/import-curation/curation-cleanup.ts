import path from "node:path";
import { datasetTypeFromOptions, datasetTypePlural } from "./internal/dataset-types.ts";
import { datasetIdentity } from "./internal/dataset-payload.ts";
import { sha256Json } from "./internal/hash-utils.ts";
import {
  annualSupplyFieldPath,
  applyDeterministicSourceExchangeCompletenessProofs,
  buildSourceRowsByIdentity,
  ensureFoundryTraceNamespaces,
  externalizeImportTraceMetadata,
  normalizeAnnualSupplyEvidence,
  normalizeDateTimeMetadata,
  sanitizeFoundryTraceEvidenceLocators,
} from "./internal/prewrite-cleanup.ts";
import {
  fileExists,
  jsonLines,
  nowIso,
  readRows,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeText,
} from "./internal/runtime-io.ts";

interface JsonRecord {
  [key: string]: unknown;
}

interface CurationCleanupOptions extends JsonRecord {
  help?: unknown;
  type?: unknown;
  datasetType?: unknown;
  kind?: unknown;
  rowsFile?: string | null;
  input?: string | null;
  outDir?: string | null;
  out?: string | null;
  outFile?: string | null;
  sourceRowsFile?: string | null;
  sourceRows?: string | null;
  originalSourceRowsFile?: string | null;
  originalRowsFile?: string | null;
}

interface CurationCleanupArgs {
  repoRoot?: string;
  options?: CurationCleanupOptions;
  io?: {
    nowIso?: () => string;
    fileExists: typeof fileExists;
    readRows: (filePath: string) => unknown[];
    writeJson: typeof writeJson;
    writeText: typeof writeText;
  };
}

function dateTimeBlockersFromError(error: unknown): JsonRecord[] | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const record = error as JsonRecord;
  if (record.name !== "InvalidDateTimeMetadataError" || !Array.isArray(record.blockers)) {
    return null;
  }
  return record.blockers.filter(
    (blocker): blocker is JsonRecord =>
      Boolean(blocker) && typeof blocker === "object" && !Array.isArray(blocker),
  );
}

export function runDatasetCurationCleanup({
  repoRoot,
  options = {},
  io,
}: CurationCleanupArgs = {}): JsonRecord {
  const readInputRows = io?.readRows ?? readRows;
  const hasFile = io?.fileExists ?? fileExists;
  const writeReport = io?.writeJson ?? writeJson;
  const writeRows = io?.writeText ?? writeText;
  const capturedAt = io?.nowIso ?? nowIso;
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 2,
      status: "help",
      command: "dataset-curation-cleanup",
      usage: [
        "node scripts/foundry.ts dataset-curation-cleanup --type <process|flow|lifecyclemodel|support|contact|source> --rows-file <rows.jsonl> [--source-rows-file <source-rows.jsonl>] --out-dir <cleanup-dir>",
      ],
      purpose:
        "Run deterministic prewrite cleanup transforms: annual-supply evidence preservation, import trace externalization, Foundry trace namespace repair, local locator redaction, and timestamp normalization.",
      remote_write_mode: "read-only",
      blockers: [],
    };
  }
  const root = repoRoot!;
  const rowsFile = resolveRepoPath(root, options.rowsFile || options.input);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-cleanup`;
  const outDir = resolveRepoPath(root, options.outDir || defaultOut)!;
  const defaultOutFile = path.join(outDir, `${datasetTypePlural[datasetType]}.cleaned.jsonl`);
  const explicitOutFile = resolveRepoPath(root, options.out || options.outFile);
  const outFile = explicitOutFile || defaultOutFile;
  if (!rowsFile || !hasFile(rowsFile)) {
    throw new Error("--rows-file is required and must point to a JSON/JSONL dataset row file.");
  }
  const sourceRowsFile = resolveRepoPath(
    root,
    options.sourceRowsFile ||
      options.sourceRows ||
      options.originalSourceRowsFile ||
      options.originalRowsFile,
  );
  const sourceRows =
    datasetType === "process" && sourceRowsFile && hasFile(sourceRowsFile)
      ? readInputRows(sourceRowsFile)
      : [];
  const sourceRowsByKey = sourceRows.length > 0 ? buildSourceRowsByIdentity(sourceRows) : null;

  const rows = readInputRows(rowsFile);
  const cleanedRows = rows.map((row) => JSON.parse(JSON.stringify(row)));
  let normalizedDateTimeValues = 0;
  const invalidDateTimeBlockers: JsonRecord[] = [];
  cleanedRows.forEach((cleaned, rowIndex) => {
    try {
      normalizedDateTimeValues += normalizeDateTimeMetadata(cleaned);
    } catch (error) {
      const blockers = dateTimeBlockersFromError(error);
      if (!blockers) throw error;
      const identity = datasetIdentity(cleaned, rowIndex, datasetType);
      for (const blocker of blockers) {
        invalidDateTimeBlockers.push({
          code: blocker.code,
          dataset_type: datasetType,
          dataset_id: identity.id,
          version: identity.version,
          row_index: rowIndex,
          path: blocker.path,
          value: blocker.value,
          reason: blocker.reason,
          action:
            "Correct the source timestamp or provide a schema-valid exact datetime before cleanup.",
        });
      }
    }
  });

  if (invalidDateTimeBlockers.length > 0) {
    let staleDefaultOutputBlocker: JsonRecord | null = null;
    if (!explicitOutFile && outFile !== rowsFile && hasFile(outFile)) {
      staleDefaultOutputBlocker = {
        code: "stale_cleanup_artifact_not_invalidated",
        path: repoRelativePath(root, outFile),
        reason: "blocked_cleanup_preserves_existing_artifacts",
        action:
          "Preserve and inspect the stale cleaned artifact manually; use a new output path for the repaired rerun.",
      };
    }
    const blockers = staleDefaultOutputBlocker
      ? [...invalidDateTimeBlockers, staleDefaultOutputBlocker]
      : invalidDateTimeBlockers;
    const reportFileName = "dataset-curation-cleanup-report.json";
    const reportPath = path.join(outDir, reportFileName);
    const report: JsonRecord = {
      schema_version: 2,
      generated_at_utc: capturedAt(),
      command: "dataset-curation-cleanup",
      status: "blocked_invalid_datetime_metadata",
      dataset_type: datasetType,
      remote_write_mode: "read-only",
      rows_file: repoRelativePath(root, rowsFile),
      cleaned_rows_file: null,
      counts: {
        rows: rows.length,
        blockers: blockers.length,
        removed_source_trace_blocks: 0,
        externalized_source_trace_summaries: 0,
        redacted_foundry_trace_evidence_locators: 0,
        added_foundry_trace_namespaces: 0,
        normalized_datetime_values: 0,
        annual_supply_unknown_normalized: 0,
        annual_supply_evidence_gaps: 0,
        source_exchange_completeness_proofs: 0,
      },
      source_rows_file:
        sourceRowsFile && hasFile(sourceRowsFile) ? repoRelativePath(root, sourceRowsFile) : null,
      source_exchange_completeness_proofs: [],
      annual_supply_evidence_gaps: [],
      blockers,
      policy: {
        purpose:
          "Reject invalid TIDAS/ILCD datetime metadata before any cleanup transform or cleaned-row output.",
        preserves_payload_semantics: true,
        datetime_policy:
          "Datetime fields require full timezone-qualified syntax, exact Gregorian calendar validity, valid clock fields, and a previously accepted HH:MM offset before UTC normalization.",
      },
      files: {
        report: repoRelativePath(root, reportPath),
        cleaned_rows: null,
      },
    };
    writeReport(reportPath, report);
    return report;
  }

  let removedSourceTraceBlocks = 0;
  let externalizedSourceTraceSummaries = 0;
  let addedFoundryTraceNamespaces = 0;
  let redactedFoundryTraceEvidenceLocators = 0;
  let annualSupplyUnknownNormalized = 0;
  let sourceExchangeCompletenessProofs = 0;
  const sourceExchangeProofRows: JsonRecord[] = [];
  const inputPayloadSha256 = rows.map((row, rowIndex) =>
    sha256Json(datasetIdentity(row, rowIndex, datasetType).payload),
  );
  const pendingAnnualSupplyGaps: Array<{
    index: number;
    reason: string;
    reviewRequired: boolean;
  }> = [];
  cleanedRows.forEach((cleaned, rowIndex) => {
    const annualSupply = normalizeAnnualSupplyEvidence(cleaned, datasetType);
    if (annualSupply.changed) annualSupplyUnknownNormalized += 1;
    if (annualSupply.gap) {
      pendingAnnualSupplyGaps.push({
        index: rowIndex,
        reason: annualSupply.gap.reason,
        reviewRequired: annualSupply.gap.review_required,
      });
    }
    if (
      applyDeterministicSourceExchangeCompletenessProofs(cleaned, datasetType, {
        rowIndex,
        sourceRowsByKey,
        sourceRowsFile: sourceRowsFile ? repoRelativePath(root, sourceRowsFile) : null,
        rowsFile: repoRelativePath(root, rowsFile),
        proofRows: sourceExchangeProofRows,
      })
    ) {
      sourceExchangeCompletenessProofs += 1;
    }
    const traceResult = externalizeImportTraceMetadata(cleaned);
    removedSourceTraceBlocks += traceResult.removed;
    externalizedSourceTraceSummaries += traceResult.summaries;
    redactedFoundryTraceEvidenceLocators += sanitizeFoundryTraceEvidenceLocators(cleaned);
    addedFoundryTraceNamespaces += ensureFoundryTraceNamespaces(cleaned);
  });

  // Bound only after every other cleanup transform has run, so the output hash describes the
  // exact unwrapped payload the caller will write, with no row metadata mixed in.
  const annualSupplyEvidenceGaps: JsonRecord[] = pendingAnnualSupplyGaps.map((pending) => {
    const identity = datasetIdentity(rows[pending.index], pending.index, datasetType);
    const outputIdentity = datasetIdentity(cleanedRows[pending.index], pending.index, datasetType);
    return {
      row_index: pending.index,
      dataset_type: datasetType,
      dataset_id: identity.id,
      version: identity.version,
      field: annualSupplyFieldPath,
      reason: pending.reason,
      review_required: pending.reviewRequired,
      input_payload_sha256: inputPayloadSha256[pending.index] ?? null,
      output_payload_sha256: sha256Json(outputIdentity.payload),
    };
  });
  writeRows(outFile, jsonLines(cleanedRows));

  const report: JsonRecord = {
    schema_version: 2,
    generated_at_utc: capturedAt(),
    command: "dataset-curation-cleanup",
    status: "completed",
    dataset_type: datasetType,
    remote_write_mode: "read-only",
    rows_file: repoRelativePath(root, rowsFile),
    cleaned_rows_file: repoRelativePath(root, outFile),
    counts: {
      rows: cleanedRows.length,
      blockers: 0,
      removed_source_trace_blocks: removedSourceTraceBlocks,
      externalized_source_trace_summaries: externalizedSourceTraceSummaries,
      redacted_foundry_trace_evidence_locators: redactedFoundryTraceEvidenceLocators,
      added_foundry_trace_namespaces: addedFoundryTraceNamespaces,
      normalized_datetime_values: normalizedDateTimeValues,
      annual_supply_unknown_normalized: annualSupplyUnknownNormalized,
      annual_supply_evidence_gaps: annualSupplyEvidenceGaps.length,
      source_exchange_completeness_proofs: sourceExchangeCompletenessProofs,
    },
    source_rows_file:
      sourceRowsFile && hasFile(sourceRowsFile) ? repoRelativePath(root, sourceRowsFile) : null,
    source_exchange_completeness_proofs: sourceExchangeProofRows,
    annual_supply_evidence_gaps: annualSupplyEvidenceGaps,
    blockers: [],
    policy: {
      purpose:
        "Normalize write-time metadata and externalize import-only tidasimport:sourceTrace after curation context has been captured and before remote write.",
      preserves_payload_semantics: true,
      source_trace_policy:
        "Original trace remains in the AI authoring package; write payload keeps only a safe hash summary in common:other.",
      foundry_trace_namespace_policy:
        "Any common:other tiangongfoundry:* trace kept in write payload gets @xmlns:tiangongfoundry before Rust tidas validation.",
      foundry_trace_locator_policy:
        "Local machine paths from tiangongfoundry:* trace evidence are redacted from write payloads; authoring packages and patch evidence retain the full local context.",
      datetime_policy:
        "TIDAS/ILCD dateTime values with timezone offsets are normalized to UTC Z form when the UTC projection remains inside the accepted four-digit year grammar; valid year-boundary offsets retain their exact source bytes.",
      annual_supply_evidence_policy:
        "annualSupplyOrProductionVolume is schema-required. Foundry preserves real evidence — a single object or a language array — byte-semantically and in its original element order, and never rewrites a real quantity that merely collides numerically with a historical marker. A missing, empty, or explicitly-marked-absent volume is normalized to the supported empty array and reported as a row-level evidence gap in annual_supply_evidence_gaps; Foundry never fills in a synthesized quantity. Unsupported shapes are left untouched for the SDK/CLI gate to reject. Cleanup completion means the local transform finished, not that the row is authoring, write, or publication ready; downstream schema, authoring, curation, and write gates remain the blocking owners.",
      source_exchange_completeness_policy:
        "For process rows, if an explicit source rows file is supplied and the source process row is Output-only with the same non-flow-reference exchange signature as the final row, Foundry may write deterministic tiangongfoundry:sourceExchangeCompleteness proof. Otherwise source-only-output acceptance still requires AI source_trace_verified evidence or exchange repair.",
    },
  };
  const reportFileName = "dataset-curation-cleanup-report.json";
  const reportPath = path.join(outDir, reportFileName);
  report.files = {
    report: repoRelativePath(root, reportPath),
    cleaned_rows: repoRelativePath(root, outFile),
  };
  writeReport(reportPath, report);
  return {
    ...report,
  };
}
