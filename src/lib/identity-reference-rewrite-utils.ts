import path from "node:path";
import { cloneCanonicalDescription } from "./canonical-description.ts";
import { createUnresolvedProcessFlowExternalizer } from "./identity-reference-rewrite-externalize.ts";
import {
  createIdentityReferenceMappingLoaders,
  type DatasetIdentity,
  type FlowReference,
  type IdentityMapping,
  type IdentityReferenceRewriteDependencies,
  type IdentityRewriteOptions,
  type PathSegment,
  type RewriteStats,
  type UnknownRecord,
  type UnresolvedIdentityMapping,
} from "./identity-reference-rewrite-mappings.ts";

export function createIdentityReferenceRewriteUtils(deps: IdentityReferenceRewriteDependencies) {
  const {
    asText,
    cloneJson,
    countRowsFile,
    datasetIdentity,
    datasetRowsFileStem,
    fileExists,
    pathExpression,
    readRowsFile,
    repoRelativePath,
    supportText,
    writeJsonLines,
  } = deps;
  const loaders = createIdentityReferenceMappingLoaders(deps);
  const {
    appendUnresolvedFlowReferenceTrace,
    flowGlobalReference,
    identityReferenceRewriteIndexPath,
    identityReferenceRewriteInputFiles,
    identityUnresolvedReferenceInputFiles,
    loadIdentityDuplicateFlowMappings,
    loadIdentityReferenceRewriteMappings,
    loadIdentityUnresolvedReferenceMappings,
    referenceShortDescription,
  } = loaders;
  const externalizeUnresolvedProcessFlowExchanges = createUnresolvedProcessFlowExternalizer(
    deps,
    loaders,
  );

  function rewriteIdentityDuplicateFlowReferences(
    value: unknown,
    {
      mappings,
      unresolvedMappings,
      datasetIdentityCache,
      rowRoot,
      rowIndex,
      rewriteRows,
      unresolvedRows,
      stats,
      pathSegments = [],
    }: {
      mappings: Map<string, IdentityMapping>;
      unresolvedMappings?: Map<string, UnresolvedIdentityMapping> | null;
      datasetIdentityCache: DatasetIdentity | null;
      rowRoot: UnknownRecord | null;
      rowIndex: number;
      rewriteRows: UnknownRecord[];
      unresolvedRows: UnknownRecord[];
      stats: RewriteStats;
      pathSegments?: PathSegment[];
    },
  ) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        rewriteIdentityDuplicateFlowReferences(item, {
          mappings,
          unresolvedMappings,
          datasetIdentityCache,
          rowRoot,
          rowIndex,
          rewriteRows,
          unresolvedRows,
          stats,
          pathSegments: [...pathSegments, index],
        }),
      );
      return;
    }
    const valueRecord = value as UnknownRecord;
    for (const [key, child] of Object.entries(valueRecord)) {
      const childPath = [...pathSegments, key];
      if (
        key === "referenceToFlowDataSet" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const reference = child as FlowReference;
        const originalId = asText(reference["@refObjectId"] ?? reference.refObjectId);
        const originalVersion = asText(reference["@version"] ?? reference.version) || "00.00.001";
        const mapping =
          mappings.get(`${originalId}@@${originalVersion}`) ?? mappings.get(originalId);
        if (mapping) {
          const canonicalId = mapping.canonical.ref_object_id;
          const canonicalVersion = mapping.canonical.version || "00.00.001";
          const originalShortDescription = referenceShortDescription(child);
          const preservesExistingShortDescription =
            originalShortDescription &&
            originalId === canonicalId &&
            originalVersion === canonicalVersion;
          const next = flowGlobalReference({
            id: canonicalId,
            version: canonicalVersion,
            shortDescription: preservesExistingShortDescription
              ? originalShortDescription
              : mapping.canonical.short_description,
          });
          valueRecord[key] = next;
          stats.rewrites += 1;
          rewriteRows.push({
            relation:
              mapping.rewrite_source?.relation ?? "flow_reference_to_identity_preflight_duplicate",
            action:
              mapping.rewrite_source?.action ?? "rewrite_to_identity_preflight_duplicate_reference",
            dataset_type: "process",
            dataset_id: datasetIdentityCache?.id ?? null,
            dataset_version: datasetIdentityCache?.version ?? null,
            row_index: rowIndex,
            path: pathExpression(childPath),
            original: {
              table: "flows",
              ref_object_id: originalId || null,
              version: originalVersion || null,
              short_description: referenceShortDescription(child) || null,
            },
            canonical: {
              table: "flows",
              ref_object_id: next["@refObjectId"],
              version: next["@version"],
              short_description:
                typeof mapping.canonical.short_description === "string"
                  ? referenceShortDescription(next) || null
                  : cloneCanonicalDescription(next["common:shortDescription"]),
              short_description_source: preservesExistingShortDescription
                ? "existing_reference_display_text"
                : "canonical_reference",
            },
            identity_preflight: mapping.identity_preflight,
            identity_decision: mapping.identity_decision ?? null,
            rewrite_source: mapping.rewrite_source ?? null,
            reason:
              mapping.rewrite_source?.reason ||
              "CLI identity-preflight selected an existing TianGong elementary flow duplicate; Foundry rewrote the process exchange reference before validation and write planning.",
          });
          continue;
        }
        const unresolvedMapping =
          unresolvedMappings?.get(`${originalId}@@${originalVersion}`) ??
          unresolvedMappings?.get(originalId);
        if (unresolvedMapping && rowRoot) {
          const blockedPath = pathExpression(childPath);
          const traceEntry = {
            status: "unresolved_deferred",
            action_item_code: "elementary_flow_identity_manual_review",
            blocked_path: blockedPath,
            reference_id: originalId || null,
            reference_version: originalVersion || null,
            reason:
              unresolvedMapping.unresolved_source?.reason ||
              "AI identity authoring could not select a sufficient existing TianGong elementary flow reference; Foundry preserved the original process reference with a structured unresolved trace.",
            evidence: {
              source: "dataset-identity-decisions-apply",
              identity_decision: unresolvedMapping.identity_decision,
              unresolved_reference_file: unresolvedMapping.unresolved_source?.file,
              quote_or_trace: unresolvedMapping.source?.short_description || originalId || null,
              remote_search: unresolvedMapping.identity_evidence?.remote_search ?? null,
              target: unresolvedMapping.identity_evidence?.target ?? null,
              top_candidates: unresolvedMapping.identity_evidence?.top_candidates ?? null,
            },
            next_action:
              "Resolve this elementary flow against an approved public TianGong flow before publishing an upgraded row; do not create a BAFU-owned elementary flow.",
          };
          if (appendUnresolvedFlowReferenceTrace(rowRoot, traceEntry)) {
            stats.unresolved_traces += 1;
            unresolvedRows.push({
              relation: "flow_reference_to_unresolved_elementary_identity",
              action: "preserve_reference_with_unresolved_trace",
              dataset_type: "process",
              dataset_id: datasetIdentityCache?.id ?? null,
              dataset_version: datasetIdentityCache?.version ?? null,
              row_index: rowIndex,
              path: blockedPath,
              original: {
                table: "flows",
                ref_object_id: originalId || null,
                version: originalVersion || null,
                short_description: referenceShortDescription(child) || null,
              },
              identity_decision: unresolvedMapping.identity_decision,
              unresolved_source: unresolvedMapping.unresolved_source,
              trace: traceEntry,
              reason: traceEntry.reason,
            });
          }
          continue;
        }
      }
      rewriteIdentityDuplicateFlowReferences(child, {
        mappings,
        unresolvedMappings,
        datasetIdentityCache,
        rowRoot,
        rowIndex,
        rewriteRows,
        unresolvedRows,
        stats,
        pathSegments: childPath,
      });
    }
  }

  function applyIdentityReferenceRewrites({
    datasetType,
    rowsFile,
    outFile,
    outDir,
    options = {},
    allowMissingIndex = false,
  }: {
    datasetType: string;
    rowsFile: string;
    outFile?: string | null;
    outDir?: string | null;
    options?: IdentityRewriteOptions;
    allowMissingIndex?: boolean;
  }) {
    const indexPath = identityReferenceRewriteIndexPath(options, rowsFile);
    const explicitRewriteFiles = identityReferenceRewriteInputFiles(options);
    const unresolvedReferenceFiles = identityUnresolvedReferenceInputFiles(options);
    const explicitRewriteMappings = loadIdentityReferenceRewriteMappings(explicitRewriteFiles);
    const unresolvedReferenceMappings =
      loadIdentityUnresolvedReferenceMappings(unresolvedReferenceFiles);
    const blockers: UnknownRecord[] = [];
    if (
      (!indexPath || !fileExists(indexPath)) &&
      explicitRewriteMappings.mappings.size === 0 &&
      unresolvedReferenceMappings.mappings.size === 0
    ) {
      if (!allowMissingIndex) {
        blockers.push({
          code: "identity_preflight_index_required",
          message:
            "Identity reference rewrites require a completed identity-preflight index or an identity decision rewrite file.",
        });
      }
      return {
        status: blockers.length > 0 ? "blocked" : "completed_no_index",
        rows_file: repoRelativePath(rowsFile),
        output_rows_file: repoRelativePath(rowsFile),
        identity_preflight_index: indexPath ? repoRelativePath(indexPath) : null,
        identity_reference_rewrites_input: explicitRewriteFiles.map((file) =>
          repoRelativePath(file),
        ),
        identity_unresolved_references_input: unresolvedReferenceFiles.map((file) =>
          repoRelativePath(file),
        ),
        rewrite_rows: [],
        unresolved_reference_rows: [],
        rewrite_file: null,
        unresolved_references_file: null,
        counts: {
          input_rows: countRowsFile(rowsFile),
          output_rows: countRowsFile(rowsFile),
          identity_preflight_rows: 0,
          identity_unresolved_reference_rows: 0,
          duplicate_flow_mappings: 0,
          flow_reference_rewrites: 0,
          flow_reference_unresolved_traces: 0,
        },
        blockers,
      };
    }
    const rows = readRowsFile(rowsFile);
    const { rows: indexRows, mappings } = loadIdentityDuplicateFlowMappings(indexPath);
    for (const [key, mapping] of explicitRewriteMappings.mappings) {
      mappings.set(key, mapping);
    }
    const rewriteRows: UnknownRecord[] = [];
    const unresolvedRows: UnknownRecord[] = [];
    const referenceRows: UnknownRecord[] = [];
    const stats = { rewrites: 0, unresolved_traces: 0, root_unresolved: 0 };
    const rewrittenRows: UnknownRecord[] = [];
    rows.forEach((row, rowIndex) => {
      const next = cloneJson(row);
      if (datasetType === "flow") {
        const identity = datasetIdentity(next, "flow");
        const unresolvedMapping =
          unresolvedReferenceMappings.mappings.get(
            `${identity.id}@@${identity.version || "00.00.001"}`,
          ) ?? unresolvedReferenceMappings.mappings.get(identity.id as string);
        if (unresolvedMapping) {
          stats.unresolved_traces += 1;
          stats.root_unresolved += 1;
          unresolvedRows.push({
            relation: "root_flow_identity_unresolved",
            action: "defer_flow_row_before_remote_write",
            dataset_type: "flow",
            dataset_id: identity.id ?? null,
            dataset_version: identity.version || "00.00.001",
            row_index: rowIndex,
            path: "/flowDataSet",
            original: {
              table: "flows",
              ref_object_id: identity.id ?? null,
              version: identity.version || "00.00.001",
              short_description:
                asText(
                  (
                    (
                      (
                        (
                          (next.flowDataSet as UnknownRecord | undefined)?.flowInformation as
                            UnknownRecord | undefined
                        )?.dataSetInformation as UnknownRecord | undefined
                      )?.name as UnknownRecord | undefined
                    )?.baseName as UnknownRecord | undefined
                  )?.["#text"],
                ) ||
                supportText(
                  (
                    (
                      (next.flowDataSet as UnknownRecord | undefined)?.flowInformation as
                        UnknownRecord | undefined
                    )?.dataSetInformation as UnknownRecord | undefined
                  )?.name,
                ) ||
                identity.id ||
                null,
            },
            identity_decision: unresolvedMapping.identity_decision ?? null,
            unresolved_source: unresolvedMapping.unresolved_source ?? null,
            evidence: unresolvedMapping.identity_evidence ?? null,
            reason:
              unresolvedMapping.unresolved_source?.reason ||
              "AI identity authoring could not select a sufficient existing TianGong elementary flow reference; Foundry deferred this root flow row before remote write planning.",
            next_action:
              "Resolve this elementary flow against an approved public TianGong flow before publishing an upgraded row; do not create an account-local elementary flow.",
          });
          return;
        }
        const mapping =
          mappings.get(`${identity.id}@@${identity.version || "00.00.001"}`) ??
          mappings.get(identity.id as string);
        if (mapping) {
          referenceRows.push(next);
          stats.rewrites += 1;
          rewriteRows.push({
            relation: "flow_identity_preflight_duplicate_reference",
            action: "reuse_identity_preflight_duplicate_reference",
            dataset_type: "flow",
            dataset_id: identity.id ?? null,
            dataset_version: identity.version || "00.00.001",
            row_index: rowIndex,
            path: "/flowDataSet",
            original: {
              table: "flows",
              ref_object_id: identity.id ?? null,
              version: identity.version || "00.00.001",
              short_description:
                referenceShortDescription(
                  (
                    (
                      (next.flowDataSet as UnknownRecord | undefined)?.flowInformation as
                        UnknownRecord | undefined
                    )?.dataSetInformation as UnknownRecord | undefined
                  )?.name,
                ) || null,
            },
            canonical: mapping.canonical,
            identity_preflight: mapping.identity_preflight,
            reason:
              "CLI identity-preflight selected an existing TianGong flow duplicate; Foundry moved this row to reference reuse instead of planning a BAFU-owned flow write.",
          });
          return;
        }
      }
      if (datasetType === "process") {
        rewriteIdentityDuplicateFlowReferences(next, {
          mappings,
          unresolvedMappings: unresolvedReferenceMappings.mappings,
          datasetIdentityCache: datasetIdentity(next, "process"),
          rowRoot: next,
          rowIndex,
          rewriteRows,
          unresolvedRows,
          stats,
        });
      }
      rewrittenRows.push(next);
    });
    const resolvedOutDir =
      outDir || path.join(path.dirname(rowsFile), "identity-reference-rewrites");
    const resolvedOutFile =
      outFile ||
      path.join(resolvedOutDir, `${datasetRowsFileStem(datasetType)}.identity-rewritten.jsonl`);
    const rewriteFile = path.join(resolvedOutDir, "identity-reference-rewrites.jsonl");
    const unresolvedReferencesFile = path.join(
      resolvedOutDir,
      "identity-unresolved-references.jsonl",
    );
    const referenceRowsFile = path.join(
      resolvedOutDir,
      `${datasetRowsFileStem(datasetType)}.reference-reuse.jsonl`,
    );
    writeJsonLines(resolvedOutFile, rewrittenRows);
    writeJsonLines(rewriteFile, rewriteRows);
    writeJsonLines(unresolvedReferencesFile, unresolvedRows);
    writeJsonLines(referenceRowsFile, referenceRows);
    return {
      status:
        blockers.length > 0
          ? "blocked"
          : rewriteRows.length > 0 || unresolvedRows.length > 0
            ? "completed"
            : "completed_no_rewrites",
      rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(resolvedOutFile),
      reference_rows_file: referenceRows.length > 0 ? repoRelativePath(referenceRowsFile) : null,
      identity_preflight_index: indexPath ? repoRelativePath(indexPath) : null,
      identity_reference_rewrites_input: explicitRewriteFiles[0]
        ? repoRelativePath(explicitRewriteFiles[0])
        : null,
      identity_reference_rewrites_inputs: explicitRewriteFiles.map((file) =>
        repoRelativePath(file),
      ),
      identity_unresolved_references_input: unresolvedReferenceFiles.map((file) =>
        repoRelativePath(file),
      ),
      rewrite_rows: rewriteRows,
      unresolved_reference_rows: unresolvedRows,
      rewrite_file: repoRelativePath(rewriteFile),
      unresolved_references_file: repoRelativePath(unresolvedReferencesFile),
      counts: {
        input_rows: rows.length,
        output_rows: rewrittenRows.length,
        reference_rows: referenceRows.length,
        identity_preflight_rows: indexRows.length,
        identity_reference_rewrite_rows: explicitRewriteMappings.rows.length,
        identity_unresolved_reference_rows: unresolvedReferenceMappings.rows.length,
        duplicate_flow_mappings: new Set(
          [...mappings.values()].map((mapping) => mapping.source.ref_object_id),
        ).size,
        flow_reference_rewrites: rewriteRows.length,
        flow_reference_unresolved_traces: unresolvedRows.length,
        root_flow_unresolved_rows: stats.root_unresolved,
      },
      blockers,
    };
  }

  return {
    applyIdentityReferenceRewrites,
    externalizeUnresolvedProcessFlowExchanges,
    identityReferenceRewriteIndexPath,
    referenceShortDescription,
  };
}
