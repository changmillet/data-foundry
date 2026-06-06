import { fileExists, resolveRepoPath } from "./runtime-io.mjs";
import {
  defaultSourceReferenceRewriteFile,
  normalizeSourceReferenceRewriteRow,
  readJsonLines,
} from "./workflow-patch-collect.mjs";

export function readSourceReferenceRewriteContext({ repoRoot, rowsFile, options, writeRows }) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.sourceReferenceRewrites ??
      options.sourceReferenceRewritesFile ??
      options.sourceReferenceRewriteFile ??
      options.referenceRewrites ??
      options.referenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultSourceReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const writeKeys = new Set(writeRows.keys());
  const writeIds = new Set(
    [...writeRows.values()].map(({ identity }) => identity.id).filter(Boolean),
  );
  const scopedRows = sourceRows.map(normalizeSourceReferenceRewriteRow).filter((row) => {
    if (!row.dataset_id) return false;
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    return writeKeys.has(key) || writeIds.has(row.dataset_id);
  });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
  };
}
