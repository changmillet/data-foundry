import path from "node:path";
import { datasetTypeFromOptions, datasetTypePlural } from "./internal/dataset-types.mjs";
import {
  fileExists,
  jsonLines,
  nowIso,
  readRows,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
  writeText,
} from "./internal/runtime-io.mjs";
import {
  annualSupplyMissingDataSentinelText,
  applyAnnualSupplyMissingDataSentinel,
  ensureFoundryTraceNamespaces,
  externalizeImportTraceMetadata,
  normalizeDateTimeMetadata,
  sanitizeFoundryTraceEvidenceLocators,
} from "./internal/legacy-implementation.mjs";

export function runDatasetCurationCleanup({ repoRoot, options = {} } = {}) {
  const datasetType = datasetTypeFromOptions(options);
  const rowsFile = resolveRepoPath(repoRoot, options.rowsFile || options.input);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-cleanup`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  const defaultOutFile = path.join(
    outDir,
    `${datasetTypePlural[datasetType]}.cleaned.jsonl`,
  );
  const outFile =
    resolveRepoPath(repoRoot, options.out || options.outFile) || defaultOutFile;
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error(
      "--rows-file is required and must point to a JSON/JSONL dataset row file.",
    );
  }

  const rows = readRows(rowsFile);
  let removedSourceTraceBlocks = 0;
  let externalizedSourceTraceSummaries = 0;
  let normalizedDateTimeValues = 0;
  let addedFoundryTraceNamespaces = 0;
  let redactedFoundryTraceEvidenceLocators = 0;
  let annualSupplyMissingDataSentinels = 0;
  const cleanedRows = rows.map((row, rowIndex) => {
    const cleaned = JSON.parse(JSON.stringify(row));
    if (applyAnnualSupplyMissingDataSentinel(cleaned, datasetType, rowIndex)) {
      annualSupplyMissingDataSentinels += 1;
    }
    normalizedDateTimeValues += normalizeDateTimeMetadata(cleaned);
    const traceResult = externalizeImportTraceMetadata(cleaned);
    removedSourceTraceBlocks += traceResult.removed;
    externalizedSourceTraceSummaries += traceResult.summaries;
    redactedFoundryTraceEvidenceLocators +=
      sanitizeFoundryTraceEvidenceLocators(cleaned);
    addedFoundryTraceNamespaces += ensureFoundryTraceNamespaces(cleaned);
    return cleaned;
  });
  writeText(outFile, jsonLines(cleanedRows));

  const report = {
    schema_version: 2,
    generated_at_utc: nowIso(),
    status: "completed",
    dataset_type: datasetType,
    rows_file: repoRelativePath(repoRoot, rowsFile),
    cleaned_rows_file: repoRelativePath(repoRoot, outFile),
    counts: {
      rows: cleanedRows.length,
      removed_source_trace_blocks: removedSourceTraceBlocks,
      externalized_source_trace_summaries: externalizedSourceTraceSummaries,
      redacted_foundry_trace_evidence_locators:
        redactedFoundryTraceEvidenceLocators,
      added_foundry_trace_namespaces: addedFoundryTraceNamespaces,
      normalized_datetime_values: normalizedDateTimeValues,
      annual_supply_missing_data_sentinels: annualSupplyMissingDataSentinels,
    },
    policy: {
      purpose:
        "Normalize write-time metadata and externalize import-only tidasimport:sourceTrace after curation context has been captured and before remote write.",
      preserves_payload_semantics: true,
      source_trace_policy:
        "Original trace remains in the AI authoring package; write payload keeps only a safe hash summary in common:other.",
      foundry_trace_namespace_policy:
        "Any common:other tiangongfoundry:* trace kept in write payload gets @xmlns:tiangongfoundry before SDK validation.",
      foundry_trace_locator_policy:
        "Local machine paths from tiangongfoundry:* trace evidence are redacted from write payloads; authoring packages and patch evidence retain the full local context.",
      datetime_policy:
        "TIDAS/ILCD dateTime values with timezone offsets are normalized to UTC Z form.",
      annual_supply_placeholder_policy:
        `annualSupplyOrProductionVolume is schema-required. If source evidence is missing or converted as a placeholder such as 'Not specified', Foundry writes '${annualSupplyMissingDataSentinelText}' so the row remains importable and later database-side curation can bulk-locate the intentionally non-physical sentinel.`,
    },
  };
  const reportFileName = "dataset-curation-cleanup-report.json";
  const reportPath = path.join(outDir, reportFileName);
  writeJson(reportPath, report);
  return {
    ...report,
    files: {
      report: repoRelativePath(repoRoot, reportPath),
      cleaned_rows: repoRelativePath(repoRoot, outFile),
    },
  };
}
