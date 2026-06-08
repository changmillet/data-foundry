import { asText, fileExists, resolveRepoPath } from "./runtime-io.mjs";
import {
  defaultSourceReferenceRewriteFile,
  normalizeSourceReferenceRewriteRow,
  readJsonLines,
} from "./workflow-patch-collect.mjs";
import { referenceKey } from "./workflow-reference-closure.mjs";

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

const publicCanonicalSourceReferenceKeys = new Set([
  referenceKey({
    table: "sources",
    id: "a97a0155-0234-4b87-b4ce-a45da52f2a40",
    version: "03.00.003",
  }),
  referenceKey({
    table: "sources",
    id: "d92a1a12-2545-49e2-a585-55c259997756",
    version: "20.20.002",
  }),
]);

export function sourceReferenceRewriteProofKeys(context) {
  const scopedCanonicalKeys = new Set(
    (context?.scopedRows ?? [])
      .filter((row) =>
        ["dataset_format_source", "compliance_system_source"].includes(asText(row?.relation)),
      )
      .map((row) => row?.canonical)
      .filter(Boolean)
      .map((canonical) => ({
        table: "sources",
        id: asText(canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id),
        version: asText(canonical.version ?? canonical["@version"]) || "00.00.001",
      }))
      .filter((reference) => reference.id)
      .map(referenceKey),
  );
  return new Set(
    [...scopedCanonicalKeys].filter((key) => publicCanonicalSourceReferenceKeys.has(key)),
  );
}
