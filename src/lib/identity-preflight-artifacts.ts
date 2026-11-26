import fs from "node:fs";
import path from "node:path";
import { createFileArtifactFact, createFoundryCommandSpec } from "./foundry-command-spec.ts";
import type { FoundryCommandSpec } from "./foundry-command-spec.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import {
  createIdentityPreflightSearchBriefUtils,
  type DatasetPayload,
  type EdgeSearchRequest,
  type IdentityPreflightArtifactDependencies,
  isUnknownRecord,
  type SourceIndexRow,
  type UnknownRecord,
} from "./identity-preflight-search-brief.ts";

interface IdentityIndexRemoteSearch extends UnknownRecord {
  data_source: string;
  limit: number;
  filter: UnknownRecord | null;
  query: string;
  edge_request: EdgeSearchRequest;
}

export interface IdentityIndexRow extends UnknownRecord {
  request_file: string;
  command: string;
  command_spec: FoundryCommandSpec;
  remote_search: IdentityIndexRemoteSearch;
}

export interface IdentityArtifactIndex {
  byIdentity: Map<string, IdentityIndexRow>;
}

interface IdentityQueueRow extends UnknownRecord {
  dataset_type?: unknown;
  dataset_id?: unknown;
  dataset_version?: unknown;
  identity_preflight_request_file?: string;
  identity_preflight_command?: string;
  remote_search?: UnknownRecord;
}

interface SourceIndexOptions extends UnknownRecord {
  sourceIndex?: unknown;
  sourceIndexes?: unknown;
  sourceContextIndex?: unknown;
  sourceContextIndexes?: unknown;
}

export function createIdentityPreflightArtifactUtils(deps: IdentityPreflightArtifactDependencies) {
  const {
    asText,
    collectSourceTracePayloads,
    datasetIdentity,
    fileExists,
    jsonSha256,
    normalizedList,
    readJson,
    readJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    safeFileToken,
    sha256Text,
    shellQuote,
    writeJson,
    writeJsonLines,
  } = deps;
  const {
    isLikelyLocationCodeText,
    identityPreflightRemoteSearchRequest,
    edgeSearchRequestPreview,
  } = createIdentityPreflightSearchBriefUtils(deps);

  function readSourceTracesFromFile(sourceFile: string | null | undefined) {
    if (!sourceFile || !fileExists(sourceFile)) return [];
    let source: unknown;
    try {
      source = sourceFile.toLowerCase().endsWith(".jsonl")
        ? readJsonLines(sourceFile)
        : readJson(sourceFile);
    } catch (error) {
      if (isUnknownRecord(error) && typeof error.code === "string") throw error;
      throw new FoundryContextError(
        "source_trace_invalid",
        "The selected identity source trace is not valid JSON or JSONL. Check the original source evidence before continuing.",
      );
    }
    return collectSourceTracePayloads(source);
  }

  function buildIdentityPreflightArtifacts({
    rowsByType,
    sourceByType,
    outDir,
    cliBin,
  }: {
    rowsByType: Record<"flow" | "process", Map<string, DatasetPayload>>;
    sourceByType: Record<"flow" | "process", Map<string, string | null | undefined>>;
    outDir: string;
    cliBin: string | string[];
  }) {
    const cliPrefix = Array.isArray(cliBin) ? cliBin : [cliBin];
    const requestsRoot = path.join(outDir, "identity-preflight-requests");
    const indexRows: IdentityIndexRow[] = [];
    const byIdentity = new Map<string, IdentityIndexRow>();
    for (const type of ["flow", "process"] as const) {
      const plural = type === "flow" ? "flows" : "processes";
      const requestDir = path.join(requestsRoot, plural);
      for (const [key, payload] of rowsByType[type].entries()) {
        const identity = datasetIdentity(payload, type);
        if (!identity.id || !identity.version) continue;
        const sourceFile = sourceByType[type].get(key);
        const sourceTraces = readSourceTracesFromFile(sourceFile);
        const remoteSearch = identityPreflightRemoteSearchRequest(type, payload, sourceTraces);
        const request = {
          schema_version: 1,
          target: payload,
          remote_candidate_search: remoteSearch,
        };
        const requestPath = path.join(requestDir, `${safeFileToken(identity.id, "missing")}.json`);
        writeJson(requestPath, request);
        const outputDir = path.join(
          outDir,
          "identity-preflight",
          plural,
          safeFileToken(identity.id, "missing"),
        );
        const expectedReportFile = path.join(outputDir, "outputs", "identity-decision.json");
        const expectedCandidatesFile = path.join(outputDir, "outputs", "identity-candidates.jsonl");
        const expectedCandidateSourcesFile = path.join(
          outputDir,
          "outputs",
          "identity-candidate-sources.json",
        );
        const commandTokens = [
          ...cliPrefix,
          type,
          "identity-preflight",
          "--input",
          requestPath,
          "--out-dir",
          outputDir,
          "--json",
        ];
        const command = commandTokens.map(shellQuote).join(" ");
        const requestText = fs.readFileSync(requestPath, "utf8");
        const indexRow = {
          dataset_type: type,
          dataset_id: identity.id,
          dataset_version: identity.version,
          target_sha256: jsonSha256(payload),
          request_bytes_sha256: sha256Text(requestText),
          request_json_sha256: jsonSha256(request),
          source_file: repoRelativeMaybe(sourceFile),
          request_file: repoRelativePath(requestPath),
          output_dir: repoRelativePath(outputDir),
          expected_report_file: repoRelativePath(expectedReportFile),
          expected_candidates_file: repoRelativePath(expectedCandidatesFile),
          expected_candidate_sources_file: repoRelativePath(expectedCandidateSourcesFile),
          command,
          command_spec: createFoundryCommandSpec({
            executable: commandTokens[0],
            argv: commandTokens.slice(1),
            binding: {
              artifacts: [
                createFileArtifactFact({
                  role: "identity_preflight_request",
                  path: repoRelativePath(requestPath),
                  filePath: requestPath,
                }),
              ],
            },
          }),
          remote_search: {
            data_source: remoteSearch.data_source,
            limit: remoteSearch.limit,
            filter: remoteSearch.filter ?? null,
            query: remoteSearch.query,
            edge_request: edgeSearchRequestPreview(type, remoteSearch),
          },
        };
        indexRows.push(indexRow);
        byIdentity.set(`${type}:${identity.id}:${identity.version}`, indexRow);
      }
    }
    const indexPath = path.join(requestsRoot, "identity-preflight-requests.jsonl");
    writeJsonLines(indexPath, indexRows);
    return {
      root: requestsRoot,
      indexPath,
      rows: indexRows,
      byIdentity,
    };
  }

  function identityPreflightSourceIndexPaths(options: SourceIndexOptions): string[] {
    const raw =
      options.sourceIndex ||
      options.sourceIndexes ||
      options.sourceContextIndex ||
      options.sourceContextIndexes;
    return normalizedList(raw)
      .map(resolveRepoPath)
      .filter((f): f is string => Boolean(f));
  }

  function identityPreflightSourceIndexKey(row: SourceIndexRow) {
    return [
      asText(row?.dataset_type || row?.type),
      asText(row?.dataset_id || row?.entity_id || row?.id),
      asText(row?.dataset_version || row?.version) || "00.00.001",
    ].join(":");
  }

  function loadIdentityPreflightSourceFileMap(indexPaths: Array<string | null>) {
    const sourceFilesByIdentity = new Map<string, string>();
    const blockers: UnknownRecord[] = [];
    let rowCount = 0;
    for (const indexPath of indexPaths) {
      if (!indexPath || !fileExists(indexPath)) {
        blockers.push({
          code: "identity_preflight_source_index_missing",
          message: "--source-index must point to a readable identity-preflight index.",
          source_index: repoRelativeMaybe(indexPath),
        });
        continue;
      }
      for (const row of readJsonLines(indexPath)) {
        rowCount += 1;
        const key = identityPreflightSourceIndexKey(row);
        if (!key.startsWith("flow:") && !key.startsWith("process:")) continue;
        const sourceFile = asText(row.source_file || row.sourceFile);
        if (!sourceFile) continue;
        const resolvedSourceFile = resolveRepoPath(sourceFile);
        if (!fileExists(resolvedSourceFile)) {
          blockers.push({
            code: "identity_preflight_source_context_file_missing",
            message: "A matching source-index row points to a source_file that no longer exists.",
            source_index: repoRelativePath(indexPath),
            source_file: repoRelativeMaybe(resolvedSourceFile),
            dataset_key: key,
          });
          continue;
        }
        if (!sourceFilesByIdentity.has(key)) {
          sourceFilesByIdentity.set(key, resolvedSourceFile as string);
        }
      }
    }
    return {
      sourceFilesByIdentity,
      rowCount,
      blockers,
    };
  }

  function attachIdentityPreflightRows(
    queueRows: IdentityQueueRow[],
    identityArtifacts: IdentityArtifactIndex,
  ) {
    for (const row of queueRows) {
      const match = identityArtifacts.byIdentity.get(
        `${row.dataset_type}:${row.dataset_id}:${row.dataset_version}`,
      );
      if (!match) continue;
      row.identity_preflight_request_file = match.request_file;
      row.identity_preflight_command = match.command;
      row.remote_search = match.remote_search;
    }
  }

  return {
    attachIdentityPreflightRows,
    buildIdentityPreflightArtifacts,
    identityPreflightSourceIndexPaths,
    isLikelyLocationCodeText,
    loadIdentityPreflightSourceFileMap,
  };
}
