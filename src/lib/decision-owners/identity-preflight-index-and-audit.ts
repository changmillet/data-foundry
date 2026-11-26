import path from "node:path";
import type {
  AuditResultRow,
  IdentityPreflightOptions,
  IdentityPreflightRow,
  IdentityPreflightRunDependencies,
  JsonRecord,
  SearchBody,
  SearchRequest,
} from "./identity-preflight-helpers.ts";

const IDENTITY_PREFLIGHT_QUERY_NOISE_PATTERNS = [
  {
    code: "not_specified_source_phrase",
    pattern: /\bNot specified by the .* source\.?\b/iu,
  },
  {
    code: "ilcd_format_noise",
    pattern: /\bILCD format\b/iu,
  },
  {
    code: "generic_not_specified",
    pattern: /(?:^|[:;\n]\s*)Not specified(?:[.;\n]|$)/iu,
  },
  {
    code: "ecospold_location_in_name",
    pattern: /\{[A-Z][A-Z0-9_-]{1,12}\}/u,
  },
  {
    code: "leading_xx_name_placeholder",
    pattern: /(?:^|\n)(?:process|flow) name:\s*x{2,}\b/iu,
  },
];

export function createIdentityPreflightIndexAndAuditCommands(
  deps: IdentityPreflightRunDependencies,
) {
  const {
    asText,
    buildIdentityPreflightArtifacts,
    datasetIdentity,
    fileExists,
    identityPreflightSourceIndexPaths,
    jsonSha256,
    loadIdentityPreflightSourceFileMap,
    normalizedList,
    nowIso,
    readJson,
    readJsonLines,
    readRowsFile,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    resolveTiangongLcaCliBin,
    resolveTiangongLcaCliCommandPrefix,
    sha256Text,
    writeJson,
    writeJsonLines,
  } = deps;

  function identityPreflightIndexMergeKey(row: IdentityPreflightRow): string | null {
    const datasetType = asText(row?.dataset_type || row?.type);
    const datasetId = asText(row?.dataset_id || row?.entity_id || row?.id);
    const datasetVersion = asText(row?.dataset_version || row?.version) || "00.00.001";
    if (!datasetType || !datasetId || !datasetVersion) return null;
    return `${datasetType}::${datasetId}::${datasetVersion}`;
  }

  function runDatasetIdentityPreflightIndexMerge(options: IdentityPreflightOptions) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-index-merge",
        purpose:
          "Merge refreshed current-scope identity-preflight request rows into an existing index while preserving dependency preflight evidence. This command is local-only and never writes the database.",
        usage: [
          "node src/dev-cli.ts dataset-identity-preflight-index-merge --base-index <old identity-preflight-requests.jsonl> --update-index <fresh current identity-preflight-requests.jsonl> --out-dir <merge-dir>",
          "node src/dev-cli.ts dataset-identity-preflight-index-merge --base-index ./identity-preflight-requests.jsonl --update-index ./fresh/identity-preflight-requests.jsonl",
        ],
        remote_write_mode: "read-only",
      };
    }
    const baseIndex = resolveRepoPath(options.baseIndex || options.base || options.index);
    if (!baseIndex || !fileExists(baseIndex)) {
      throw new Error(
        "--base-index is required and must point to identity-preflight-requests.jsonl.",
      );
    }
    const updateIndexes = normalizedList(
      options.updateIndex ||
        options.updateIndexes ||
        options.refreshIndex ||
        options.refreshIndexes,
    ).map((file) => resolveRepoPath(file)!);
    if (updateIndexes.length === 0 || updateIndexes.some((file) => !fileExists(file))) {
      throw new Error("--update-index is required and every update index must be readable.");
    }
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(path.dirname(baseIndex)), "identity-preflight-index-merge"),
    )!;
    const outPath = resolveRepoPath(
      options.out || options.output || path.join(outDir, "identity-preflight-requests.jsonl"),
    )!;
    const reportPath = path.join(outDir, "dataset-identity-preflight-index-merge-report.json");
    const blockers: JsonRecord[] = [];
    const mergedRows: IdentityPreflightRow[] = [];
    const rowIndexByKey = new Map<string, number>();
    const stats = {
      base_rows: 0,
      update_indexes: updateIndexes.length,
      update_rows: 0,
      replaced_rows: 0,
      added_rows: 0,
      duplicate_update_rows: 0,
    };

    const addRow = (
      row: IdentityPreflightRow,
      sourceFile: string,
      sourceIndex: number,
      mode: "base" | "update",
    ): void => {
      const key = identityPreflightIndexMergeKey(row);
      if (!key) {
        blockers.push({
          code: "identity_preflight_index_row_key_missing",
          message:
            "Identity preflight index rows must include dataset_type, dataset_id, and dataset_version.",
          source_file: repoRelativeMaybe(sourceFile),
          source_index: sourceIndex,
          mode,
        });
        return;
      }
      const nextRow = {
        ...row,
        merge_source: mode,
        merge_source_file: repoRelativeMaybe(sourceFile),
      };
      if (!rowIndexByKey.has(key)) {
        rowIndexByKey.set(key, mergedRows.length);
        mergedRows.push(nextRow);
        if (mode === "update") stats.added_rows += 1;
        return;
      }
      const existingIndex = rowIndexByKey.get(key)!;
      if (mode === "base") {
        blockers.push({
          code: "identity_preflight_index_base_duplicate_key",
          message: "Base identity preflight index contains duplicate dataset identity rows.",
          key,
          source_file: repoRelativeMaybe(sourceFile),
          source_index: sourceIndex,
        });
        return;
      }
      if (mergedRows[existingIndex]?.merge_source === "update") {
        stats.duplicate_update_rows += 1;
      } else {
        stats.replaced_rows += 1;
      }
      mergedRows[existingIndex] = nextRow;
    };

    const baseRows = readJsonLines(baseIndex);
    stats.base_rows = baseRows.length;
    baseRows.forEach((row, index) => addRow(row, baseIndex, index, "base"));
    for (const updateIndex of updateIndexes) {
      const updateRows = readJsonLines(updateIndex);
      stats.update_rows += updateRows.length;
      updateRows.forEach((row, index) => addRow(row, updateIndex, index, "update"));
    }

    if (blockers.length === 0) writeJsonLines(outPath, mergedRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length === 0 ? "ready" : "blocked",
      command: "dataset-identity-preflight-index-merge",
      remote_write_mode: "read-only",
      policy: {
        exact_rows_scope:
          "Updated rows replace base rows by dataset_type + dataset_id + dataset_version, preserving dependency preflight rows that were not refreshed.",
        post_patch_usage:
          "Use this after field patch apply plus current-scope identity-preflight refresh, then pass the merged index to dataset-curation-gate.",
      },
      inputs: {
        base_index: repoRelativePath(baseIndex),
        update_indexes: updateIndexes.map(repoRelativePath),
      },
      counts: {
        ...stats,
        output_rows: blockers.length === 0 ? mergedRows.length : 0,
        blockers: blockers.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        merged_index: blockers.length === 0 ? repoRelativePath(outPath) : null,
      },
      blockers,
    };
    writeJson(reportPath, report);
    return report;
  }

  function runDatasetIdentityPreflightRequestsBuild(options: IdentityPreflightOptions) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-requests-build",
        usage: [
          "node src/dev-cli.ts dataset-identity-preflight-requests-build --type process --rows-file ./rows/processes.jsonl --out-dir ./.foundry/workspaces/task/identity-preflight-refresh",
          "node src/dev-cli.ts dataset-identity-preflight-requests-build --type flow --rows-file ./rows/flows.jsonl --out-dir ./.foundry/workspaces/task/identity-preflight-refresh",
          "node src/dev-cli.ts dataset-identity-preflight-requests-build --type process --rows-file ./rows/patched-processes.jsonl --source-index ./identity-preflight-requests/identity-preflight-requests.jsonl --out-dir ./identity-preflight-refresh",
        ],
        purpose:
          "Build a fresh CLI identity-preflight request index from the exact current process or flow rows file.",
        remote_write_mode: "read-only",
      };
    }

    const datasetType = asText(options.type || options.datasetType).toLowerCase();
    if (!["flow", "process"].includes(datasetType)) {
      throw new Error("--type must be flow or process.");
    }
    const rowsFile = resolveRepoPath(options.rowsFile || options.input || options.inputRows);
    if (!rowsFile || !fileExists(rowsFile)) {
      throw new Error("--rows-file must point to a readable process/flow rows file.");
    }
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(path.dirname(rowsFile)), "identity-preflight-refresh"),
    )!;
    const cliBin = resolveTiangongLcaCliCommandPrefix
      ? resolveTiangongLcaCliCommandPrefix()
      : [resolveTiangongLcaCliBin()];
    const rows = readRowsFile(rowsFile);
    const sourceIndexPaths = identityPreflightSourceIndexPaths(options);
    const sourceContext = loadIdentityPreflightSourceFileMap(sourceIndexPaths);
    const rowsByType: Record<string, Map<string, JsonRecord>> = {
      flow: new Map(),
      process: new Map(),
    };
    const sourceByType: Record<string, Map<string, string>> = {
      flow: new Map(),
      process: new Map(),
    };
    const blockers: JsonRecord[] = [];
    blockers.push(...sourceContext.blockers);
    let sourceContextMatches = 0;
    let sourceContextMissingMatches = 0;
    rows.forEach((row, index) => {
      const identity = datasetIdentity(row, datasetType);
      if (!identity.id || !identity.version) {
        blockers.push({
          code: "identity_preflight_request_identity_missing",
          row_index: index,
          dataset_type: datasetType,
          message:
            "Rows used to build identity-preflight requests must include common:UUID and common:dataSetVersion.",
        });
        return;
      }
      const key = `${identity.id}::${identity.version}`;
      const sourceIndexKey = `${datasetType}:${identity.id}:${identity.version}`;
      const inheritedSourceFile = sourceContext.sourceFilesByIdentity.get(sourceIndexKey) ?? null;
      if (sourceIndexPaths.length > 0) {
        if (inheritedSourceFile) {
          sourceByType[datasetType].set(key, inheritedSourceFile);
          sourceContextMatches += 1;
        } else {
          sourceContextMissingMatches += 1;
          blockers.push({
            code: "identity_preflight_source_context_match_missing",
            row_index: index,
            dataset_type: datasetType,
            dataset_id: identity.id,
            dataset_version: identity.version,
            message:
              "The supplied --source-index does not contain source_file context for this current row.",
          });
        }
      }
      const existing = rowsByType[datasetType].get(key);
      if (existing && jsonSha256(existing) !== jsonSha256(row)) {
        blockers.push({
          code: "identity_preflight_request_duplicate_payload_conflict",
          row_index: index,
          dataset_type: datasetType,
          dataset_id: identity.id,
          dataset_version: identity.version,
          message: "The rows file contains duplicate identity keys with different payloads.",
        });
        return;
      }
      rowsByType[datasetType].set(key, row);
    });

    const artifacts = buildIdentityPreflightArtifacts({
      rowsByType,
      sourceByType,
      outDir,
      cliBin,
    });
    const reportPath = path.join(outDir, "dataset-identity-preflight-requests-build-report.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "ready",
      command: "dataset-identity-preflight-requests-build",
      dataset_type: datasetType,
      rows_file: repoRelativePath(rowsFile),
      remote_write_mode: "read-only",
      policy: {
        exact_rows_scope:
          "Each request target is the exact row payload from rows_file, and each index row records target_sha256 so curation can reject stale preflight evidence.",
        edge_search_payload:
          "The generated request carries a compact fielded query plus supported filter/data_source/match parameters for flow_hybrid_search or process_hybrid_search.",
        source_context_refresh:
          "When --source-index is supplied, refreshed requests inherit the original source_file trace context for the same dataset identity so post-patch search queries do not lose source-package evidence.",
      },
      counts: {
        input_rows: rows.length,
        request_rows: artifacts.rows.length,
        source_index_files: sourceIndexPaths.length,
        source_index_rows: sourceContext.rowCount,
        source_context_matches: sourceContextMatches,
        source_context_missing_matches: sourceContextMissingMatches,
        blockers: blockers.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        identity_preflight_requests: repoRelativePath(artifacts.indexPath),
        requests_root: repoRelativePath(artifacts.root),
        source_indexes: sourceIndexPaths.map(repoRelativePath),
      },
      blockers,
    };
    writeJson(reportPath, report);
    return report;
  }

  function identityPreflightQueryForAudit(row: IdentityPreflightRow): string {
    return (
      asText(row?.remote_search?.edge_request?.body?.query) ||
      asText(row?.remote_search?.query) ||
      asText(row?.remote_candidate_search?.query) ||
      asText(row?.request?.remote_candidate_search?.query)
    );
  }

  function identityPreflightEdgeBodyForAudit(row: IdentityPreflightRow): SearchBody {
    const body = row?.remote_search?.edge_request?.body;
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
    const request = row?.remote_candidate_search ?? row?.request?.remote_candidate_search;
    if (request && typeof request === "object" && !Array.isArray(request)) {
      return {
        query: request.query,
        ...(request.filter ? { filter: request.filter } : {}),
        ...(request.limit ? { match_count: request.limit, page_size: request.limit } : {}),
        ...(request.data_source ? { data_source: request.data_source } : {}),
        ...(request.match_threshold ? { match_threshold: request.match_threshold } : {}),
        ...(request.lexical_weight ? { lexical_weight: request.lexical_weight } : {}),
        ...(request.semantic_weight ? { semantic_weight: request.semantic_weight } : {}),
        ...(request.rrf_k ? { rrf_k: request.rrf_k } : {}),
      };
    }
    return {};
  }

  function identityPreflightRequestForAudit(
    indexPath: string,
    row: IdentityPreflightRow,
  ): JsonRecord | null {
    const requestFile = resolveRepoPath(row?.request_file);
    if (!requestFile || !fileExists(requestFile)) return null;
    try {
      return readJson(requestFile);
    } catch (error) {
      throw new Error(
        `Could not read identity-preflight request file from ${repoRelativePath(indexPath)}: ${repoRelativePath(requestFile)}: ${error}`,
      );
    }
  }

  function hasQueryLabel(query: string, label: string): boolean {
    return new RegExp(`(?:^|\\n)${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:`, "iu").test(
      query,
    );
  }

  function flowTypeFromQuery(query: string): string {
    const match = query.match(/(?:^|\n)flow type:\s*([^\n;]+)/iu);
    return asText(match?.[1]);
  }

  function identityPreflightRequiredQueryLabels(
    row: IdentityPreflightRow,
    query: string,
  ): string[] {
    const datasetType = asText(row?.dataset_type ?? row?.datasetType).toLowerCase();
    if (datasetType === "process") {
      return [
        "process name",
        "reference flow",
        "geography",
        "classification or sector",
        "exchange flow refs",
      ];
    }
    if (datasetType === "flow") {
      const labels = ["flow name", "flow type", "reference property", "category or compartment"];
      if (/^elementary flow$/iu.test(flowTypeFromQuery(query))) {
        labels.push("compartment aliases");
        if (row?.source_file) labels.push("source classification or compartment");
      } else {
        labels.push("geography or market");
      }
      return labels;
    }
    return ["query"];
  }

  function identityPreflightSearchEndpointForType(datasetType: string): string | null {
    if (datasetType === "process") return "process_hybrid_search";
    if (datasetType === "flow") return "flow_hybrid_search";
    return null;
  }

  function auditIdentityPreflightQueryRow({
    row,
    index,
    indexPath,
  }: {
    row: IdentityPreflightRow;
    index: number;
    indexPath: string;
  }): AuditResultRow {
    const blockers: JsonRecord[] = [];
    const warnings: JsonRecord[] = [];
    const datasetType = asText(row?.dataset_type ?? row?.datasetType).toLowerCase();
    const datasetId = asText(row?.dataset_id ?? row?.datasetId ?? row?.id);
    const datasetVersion = asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version);
    const request = identityPreflightRequestForAudit(indexPath, row);
    const requestEnvelope = request as { remote_candidate_search?: SearchRequest } | null;
    const mergedRow: IdentityPreflightRow = requestEnvelope
      ? {
          ...row,
          request: requestEnvelope,
          remote_candidate_search:
            row?.remote_candidate_search ?? requestEnvelope.remote_candidate_search,
        }
      : row;
    const query = identityPreflightQueryForAudit(mergedRow);
    const edgeBody = identityPreflightEdgeBodyForAudit(mergedRow);
    const expectedEndpoint = identityPreflightSearchEndpointForType(datasetType);
    const actualEndpoint = asText(row?.remote_search?.edge_request?.endpoint);

    const base = {
      row_index: index,
      dataset_type: datasetType || null,
      dataset_id: datasetId || null,
      dataset_version: datasetVersion || null,
      request_file: row?.request_file ?? null,
    };
    if (!["flow", "process"].includes(datasetType)) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_dataset_type_invalid",
        message: "Identity-preflight query audit only supports process and flow rows.",
      });
    }
    if (!query) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_missing",
        message: "Identity-preflight row must send a non-empty query to hybrid search.",
      });
    }
    if (query.length > 1800) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_too_long",
        query_length: query.length,
        message: "Hybrid search query must stay within the Foundry compact query limit.",
      });
    }
    if (expectedEndpoint && actualEndpoint && actualEndpoint !== expectedEndpoint) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_endpoint_mismatch",
        expected_endpoint: expectedEndpoint,
        actual_endpoint: actualEndpoint,
        message: "Identity-preflight edge request endpoint does not match the dataset type.",
      });
    }
    for (const label of identityPreflightRequiredQueryLabels(row, query)) {
      if (label === "query") continue;
      if (!hasQueryLabel(query, label)) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_required_label_missing",
          label,
          message: `Hybrid search query is missing required fielded label: ${label}.`,
        });
      }
    }
    for (const { code, pattern } of IDENTITY_PREFLIGHT_QUERY_NOISE_PATTERNS) {
      const match = query.match(pattern);
      if (match) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_noise",
          noise_code: code,
          matched_text: match[0],
          message:
            "Hybrid search query contains placeholder or converted-format noise that should be repaired before remote candidate search.",
        });
      }
    }
    const edgeQuery = asText(edgeBody.query);
    if (query && edgeQuery && edgeQuery !== query) {
      blockers.push({
        ...base,
        code: "identity_preflight_query_edge_body_mismatch",
        message:
          "Index remote_search.query and edge_request.body.query differ; audit cannot prove what Edge receives.",
      });
    }
    if (datasetType === "flow") {
      const flowType = flowTypeFromQuery(query);
      const filterFlowType = asText(edgeBody?.filter?.flowType);
      if (flowType && !filterFlowType) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_flow_type_filter_missing",
          flow_type: flowType,
          message:
            "Flow hybrid search should include a flowType filter matching the query flow type.",
        });
      } else if (flowType && filterFlowType && filterFlowType !== flowType) {
        blockers.push({
          ...base,
          code: "identity_preflight_query_flow_type_filter_mismatch",
          flow_type: flowType,
          filter_flow_type: filterFlowType,
          message: "Flow hybrid search flowType filter does not match the query flow type.",
        });
      }
    }
    if (!edgeBody.data_source) {
      warnings.push({
        ...base,
        code: "identity_preflight_query_data_source_missing",
        message: "Hybrid search data_source is not explicit; Edge will use its default.",
      });
    }
    if (!edgeBody.match_count || !edgeBody.page_size) {
      warnings.push({
        ...base,
        code: "identity_preflight_query_result_limit_missing",
        message: "Hybrid search match_count/page_size is not explicit; Edge will use its default.",
      });
    }
    return {
      ...base,
      status: blockers.length > 0 ? "blocked" : "passed",
      query_sha256: query ? sha256Text(query) : null,
      query_length: query.length,
      labels: query
        .split(/\n/u)
        .map((line) => line.match(/^([^:]+):/u)?.[1])
        .filter(Boolean),
      edge_request: {
        endpoint: actualEndpoint || expectedEndpoint,
        data_source: edgeBody.data_source ?? null,
        match_count: edgeBody.match_count ?? null,
        page_size: edgeBody.page_size ?? null,
        filter: edgeBody.filter ?? null,
      },
      blockers,
      warnings,
    };
  }

  function runDatasetIdentityPreflightQueryAudit(options: IdentityPreflightOptions) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-identity-preflight-query-audit",
        usage: [
          "node src/dev-cli.ts dataset-identity-preflight-query-audit --index ./identity-preflight-requests/identity-preflight-requests.jsonl --out-dir ./identity-preflight-query-audit",
        ],
        purpose:
          "Audit generated process/flow identity-preflight hybrid-search queries before remote candidate search.",
        remote_write_mode: "read-only",
      };
    }
    const indexPath = resolveRepoPath(
      options.index ||
        options.identityPreflightIndex ||
        options.identityPreflightRequests ||
        options.identityPreflightRequestsIndex,
    );
    if (!indexPath || !fileExists(indexPath)) {
      throw new Error("--index must point to a readable identity-preflight index.");
    }
    const outDir = resolveRepoPath(
      options.outDir ||
        path.join(path.dirname(path.dirname(indexPath)), "identity-preflight-query-audit"),
    )!;
    const rows = readJsonLines(indexPath);
    const auditedRows = rows.map((row, index) =>
      auditIdentityPreflightQueryRow({ row, index, indexPath }),
    );
    const blockers = auditedRows.flatMap((row) => row.blockers);
    const warnings = auditedRows.flatMap((row) => row.warnings);
    const reportPath = path.join(outDir, "dataset-identity-preflight-query-audit-report.json");
    const rowsPath = path.join(outDir, "identity-preflight-query-audit.jsonl");
    writeJsonLines(rowsPath, auditedRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "passed",
      command: "dataset-identity-preflight-query-audit",
      index_file: repoRelativePath(indexPath),
      remote_write_mode: "read-only",
      policy: {
        edge_body_contract:
          "flow_hybrid_search/process_hybrid_search only parse query, filter/filter_condition, match options, and data_source; complete identity and source evidence must be present in query.",
        profile_hints_contract:
          "remote_candidate_search.profile_hints are retained for local CLI/AI identity decisions but are not sent in the Edge request body.",
        noise_policy:
          "Queries must not carry converted placeholder/source-format strings such as ILCD format, Not specified by the source, EcoSpold-style {GLO} name suffixes, or leading xx placeholders.",
      },
      counts: {
        rows: rows.length,
        passed_rows: auditedRows.filter((row) => row.status === "passed").length,
        blocked_rows: auditedRows.filter((row) => row.status === "blocked").length,
        process_rows: rows.filter(
          (row) => asText(row?.dataset_type ?? row?.datasetType).toLowerCase() === "process",
        ).length,
        flow_rows: rows.filter(
          (row) => asText(row?.dataset_type ?? row?.datasetType).toLowerCase() === "flow",
        ).length,
        blockers: blockers.length,
        warnings: warnings.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        rows: repoRelativePath(rowsPath),
      },
      blockers,
      warnings,
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetIdentityPreflightIndexMerge,
    runDatasetIdentityPreflightQueryAudit,
    runDatasetIdentityPreflightRequestsBuild,
  };
}
