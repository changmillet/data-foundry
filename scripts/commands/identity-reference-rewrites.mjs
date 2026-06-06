import path from "node:path";

export function createIdentityReferenceRewriteCommands({
  applyIdentityReferenceRewrites,
  asText,
  datasetRowsFileStem,
  fileExists,
  nowIso,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
}) {
  function runDatasetIdentityReferenceRewritesApply(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-reference-rewrites-apply",
        usage: [
          "node scripts/foundry.mjs dataset-identity-reference-rewrites-apply --type process --rows-file <processes.jsonl> --identity-preflight-index <identity-preflight-requests.jsonl> --out <rewritten-processes.jsonl>",
        ],
        purpose:
          "Apply completed identity-preflight block_duplicate flow decisions to local process exchange references before validation and write planning.",
      };
    }
    const datasetType = asText(options.type || options.datasetType || "process").toLowerCase();
    const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.rows);
    if (!rowsFile || !fileExists(rowsFile)) {
      throw new Error("--rows-file is required and must point to process rows.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(rowsFile), "identity-reference-rewrites"),
    );
    const outFile = resolveRepoPath(
      options.out ||
        options.output ||
        options.outputRows ||
        path.join(outDir, `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`),
    );
    const result = applyIdentityReferenceRewrites({
      datasetType,
      rowsFile,
      outFile,
      outDir,
      options,
      allowMissingIndex: false,
    });
    const reportPath = path.join(outDir, "identity-reference-rewrites-apply-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: "dataset-identity-reference-rewrites-apply",
      dataset_type: datasetType,
      remote_write_mode: "read-only",
      ...result,
      files: {
        report: repoRelativePath(reportPath),
        output_rows: result.output_rows_file,
        reference_rows: result.reference_rows_file,
        identity_reference_rewrites: result.rewrite_file,
        identity_unresolved_references: result.unresolved_references_file,
      },
    };
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetIdentityReferenceRewritesApply };
}
