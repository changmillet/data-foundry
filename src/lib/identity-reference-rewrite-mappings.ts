import path from "node:path";
import {
  canonicalDescriptionPair,
  cloneCanonicalDescription,
  type CanonicalDescription,
} from "./canonical-description.ts";
import { referenceDescriptionText } from "./reference-description-text.ts";

export type UnknownRecord = Record<string, unknown>;
export type PathSegment = string | number;
export type DatasetIdentity = { id: string | null; version: string | null };
export type IdentityRewriteOptions = Record<string, unknown>;

export type IdentityPreflightCommands = {
  identityPreflightRunReportFile: (row: UnknownRecord) => string | null;
};

export type IdentityReferenceRewriteDependencies = {
  asText: (value: unknown) => string;
  cloneJson: <T>(value: T) => T;
  countRowsFile: (filePath: string | null | undefined) => number;
  datasetIdentity: (payload: unknown, type: string) => DatasetIdentity;
  datasetRowsFileStem: (datasetType: unknown) => string;
  ensureArray: (value: unknown) => unknown[];
  fileExists: (filePath: string | null | undefined) => boolean;
  foundryTraceNamespace: string;
  identityPreflightCommands: IdentityPreflightCommands;
  languageForText: (text: unknown, fallback?: unknown) => string;
  multiLang: (text: unknown, language?: unknown) => UnknownRecord;
  normalizedList: (value: unknown) => string[];
  nowIso: () => string;
  pathExpression: (parts: PathSegment[]) => string;
  preferredSourceLanguageText: (values: unknown) => string;
  readJson: (filePath: string) => UnknownRecord;
  readJsonLines: (filePath: string) => UnknownRecord[];
  readRowsFile: (filePath: string | null | undefined) => UnknownRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  resolveRepoPath: (filePath: unknown) => string | null;
  supportText: (value: unknown) => string;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: unknown[]) => void;
};

export type FlowCandidate = UnknownRecord & {
  id?: unknown;
  version?: unknown;
  names?: unknown;
  name_en?: unknown;
  name?: unknown;
  match_reasons?: unknown;
  decision_hint?: unknown;
  index?: unknown;
  match_score?: unknown;
};

export type FlowReference = UnknownRecord & {
  "@type"?: unknown;
  "@refObjectId"?: unknown;
  "@version"?: unknown;
  "@uri"?: unknown;
  "common:shortDescription"?: unknown;
  shortDescription?: unknown;
  refObjectId?: unknown;
  version?: unknown;
};

export type RewriteSource = UnknownRecord & {
  file?: unknown;
  relation?: unknown;
  action?: unknown;
  reason?: unknown;
};

export type IdentityMapping = {
  source: {
    ref_object_id: string;
    version: string;
  };
  canonical: {
    table: string;
    ref_object_id: string;
    version: string;
    short_description: CanonicalDescription;
  };
  identity_preflight: unknown;
  identity_decision?: unknown;
  rewrite_source?: RewriteSource;
};

export type UnresolvedIdentityMapping = {
  source: {
    ref_object_id: string;
    version: string;
    short_description: string;
  };
  identity_decision: unknown;
  identity_evidence: UnknownRecord | null;
  unresolved_source: RewriteSource;
};

export type RewriteStats = {
  rewrites: number;
  unresolved_traces: number;
  root_unresolved: number;
};

export function createIdentityReferenceMappingLoaders(deps: IdentityReferenceRewriteDependencies) {
  const {
    asText,
    ensureArray,
    fileExists,
    foundryTraceNamespace,
    identityPreflightCommands,
    languageForText,
    multiLang,
    normalizedList,
    preferredSourceLanguageText,
    readJson,
    readJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    unique,
  } = deps;

  function identityReferenceRewriteIndexPath(
    options: IdentityRewriteOptions,
    rowsFile: string | null | undefined,
  ) {
    const explicit =
      options.identityPreflightIndex ||
      options.identityPreflightRequests ||
      options.identityPreflightRequestsIndex ||
      options.identityPreflightFile;
    if (explicit) return resolveRepoPath(explicit);
    if (!rowsFile) return null;
    const defaultPath = path.join(
      path.dirname(path.dirname(rowsFile)),
      "identity-preflight-requests",
      "identity-preflight-requests.jsonl",
    );
    return fileExists(defaultPath) ? defaultPath : null;
  }

  function firstCandidateName(candidate: FlowCandidate | null | undefined) {
    return (
      preferredSourceLanguageText(candidate?.names) ||
      asText(candidate?.name_en) ||
      asText(candidate?.name)
    );
  }

  function flowGlobalReference({
    id,
    version,
    shortDescription,
  }: {
    id: string;
    version?: string | null;
    shortDescription?: unknown;
  }) {
    const description = cloneCanonicalDescription(shortDescription) || id;
    return {
      "@type": "flow data set",
      "@refObjectId": id,
      "@version": version || "00.00.001",
      "@uri": `../flows/${id}.json`,
      "common:shortDescription":
        typeof description === "string"
          ? multiLang(description, languageForText(description))
          : description,
    };
  }

  function referenceShortDescription(reference: unknown) {
    return referenceDescriptionText(reference, asText);
  }

  function duplicateFlowCandidateFromReport(report: UnknownRecord | null | undefined) {
    if (
      asText(report?.kind) !== "flow" ||
      asText(report?.decision) !== "block_duplicate" ||
      asText(report?.confidence) !== "high"
    ) {
      return null;
    }
    return (
      (ensureArray(report?.candidates) as FlowCandidate[]).find((candidate) => {
        const reasons = ensureArray(candidate?.match_reasons).map(asText);
        return (
          asText(candidate?.decision_hint) === "block_duplicate" ||
          reasons.includes("equivalent_flow_core_fields") ||
          reasons.includes("same_identity_key")
        );
      }) ?? null
    );
  }

  function loadIdentityDuplicateFlowMappings(indexPath: string | null) {
    const mappings = new Map<string, IdentityMapping>();
    const rows = indexPath && fileExists(indexPath) ? readJsonLines(indexPath) : [];
    for (const row of rows) {
      const datasetType = asText(row.dataset_type || row.type);
      if (datasetType !== "flow") continue;
      const sourceId = asText(row.dataset_id || row.entity_id || row.id);
      const sourceVersion = asText(row.dataset_version || row.version) || "00.00.001";
      if (!sourceId) continue;
      const reportFile = identityPreflightCommands.identityPreflightRunReportFile(row);
      const report = reportFile && fileExists(reportFile) ? readJson(reportFile) : null;
      const candidate = duplicateFlowCandidateFromReport(report);
      const canonicalId = asText(candidate?.id);
      if (!canonicalId) continue;
      const confirmedIndexPath = indexPath as string;
      const confirmedReport = report as UnknownRecord;
      const confirmedCandidate = candidate as FlowCandidate;
      const mapping = {
        source: {
          ref_object_id: sourceId,
          version: sourceVersion,
        },
        canonical: {
          table: "flows",
          ref_object_id: canonicalId,
          version: asText(candidate?.version) || "00.00.001",
          short_description: firstCandidateName(candidate) || canonicalId,
        },
        identity_preflight: {
          index_file: repoRelativePath(confirmedIndexPath),
          report_file: repoRelativeMaybe(reportFile),
          decision: confirmedReport.decision,
          status: confirmedReport.status,
          confidence: confirmedReport.confidence ?? null,
          candidate_index: confirmedCandidate.index ?? null,
          candidate_match_score: confirmedCandidate.match_score ?? null,
          candidate_match_reasons: ensureArray(confirmedCandidate.match_reasons),
        },
      };
      mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
      if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
    }
    return { rows, mappings };
  }

  function jsonLineFileHasRows(filePath: string | null | undefined) {
    return Boolean(filePath && fileExists(filePath) && readJsonLines(filePath).length > 0);
  }

  function existingFilePath(filePath: string | null): filePath is string {
    return Boolean(filePath && fileExists(filePath));
  }

  function identityReferenceRewriteInputFiles(options: IdentityRewriteOptions = {}) {
    const files: string[] = [];
    const directOptions = [
      options.identityReferenceRewrites,
      options.identityReferenceRewritesFile,
      options.identityFlowReferenceRewrites,
      options.identityFlowReferenceRewritesFile,
    ];
    for (const directOption of directOptions) {
      for (const item of normalizedList(directOption)) {
        const filePath = resolveRepoPath(item);
        if (jsonLineFileHasRows(filePath)) files.push(filePath as string);
      }
    }
    const reportOptions = unique([
      ...normalizedList(options.identityDecisionApplyReport),
      ...normalizedList(options.identityDecisionsApplyReport),
      ...normalizedList(options.identityDecisionApplyReports),
      ...normalizedList(options.identityDecisionsApplyReports),
    ]);
    for (const reportOption of reportOptions) {
      const reportFile = resolveRepoPath(reportOption);
      if (!reportFile || !fileExists(reportFile)) continue;
      const report = readJson(reportFile);
      const reportFiles = report.files as UnknownRecord | undefined;
      const rewriteFile = resolveRepoPath(reportFiles?.identity_reference_rewrites);
      if (jsonLineFileHasRows(rewriteFile)) files.push(rewriteFile as string);
    }
    return unique(files);
  }

  function identityUnresolvedReferenceInputFiles(options: IdentityRewriteOptions = {}) {
    const files: string[] = [];
    const directOptions = [
      options.identityUnresolvedReferences,
      options.identityUnresolvedReferencesFile,
      options.identityUnresolvedReferenceFile,
    ];
    for (const directOption of directOptions) {
      for (const item of normalizedList(directOption)) {
        const filePath = resolveRepoPath(item);
        if (filePath && fileExists(filePath)) files.push(filePath);
      }
    }
    const reportOptions = unique([
      ...normalizedList(options.identityDecisionApplyReport),
      ...normalizedList(options.identityDecisionsApplyReport),
      ...normalizedList(options.identityDecisionApplyReports),
      ...normalizedList(options.identityDecisionsApplyReports),
    ]);
    for (const reportOption of reportOptions) {
      const reportFile = resolveRepoPath(reportOption);
      if (!reportFile || !fileExists(reportFile)) continue;
      const report = readJson(reportFile);
      const reportFiles = report.files as UnknownRecord | undefined;
      const unresolvedFile = resolveRepoPath(reportFiles?.identity_unresolved_references);
      if (unresolvedFile && fileExists(unresolvedFile)) files.push(unresolvedFile);
    }
    return unique(files);
  }

  function loadIdentityReferenceRewriteMappings(rewriteFiles: unknown) {
    const mappings = new Map<string, IdentityMapping>();
    const rows: UnknownRecord[] = [];
    for (const rewriteFileValue of ensureArray(rewriteFiles)) {
      const rewriteFile = rewriteFileValue as string;
      if (!rewriteFile || !fileExists(rewriteFile)) continue;
      for (const row of readJsonLines(rewriteFile)) {
        rows.push(row);
        const original = (row.original ?? {}) as UnknownRecord;
        const canonical = (row.canonical ?? {}) as UnknownRecord;
        const sourceId = asText(
          original.ref_object_id ?? original.refObjectId ?? original.id ?? row?.dataset_id,
        );
        const sourceVersion =
          asText(
            original.version ??
              original.ref_version ??
              original["@version"] ??
              row?.dataset_version,
          ) || "00.00.001";
        const canonicalId = asText(
          canonical.ref_object_id ?? canonical.refObjectId ?? canonical.id,
        );
        if (!sourceId || !canonicalId) continue;
        const canonicalDescription = canonicalDescriptionPair(
          canonical.short_description ?? canonical.shortDescription,
          asText,
        ).ledger;
        const mapping = {
          source: {
            ref_object_id: sourceId,
            version: sourceVersion,
          },
          canonical: {
            table: asText(canonical.table) || "flows",
            ref_object_id: canonicalId,
            version:
              asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) ||
              "00.00.001",
            short_description: canonicalDescription || canonicalId,
          },
          identity_preflight: row.identity_preflight ?? null,
          identity_decision: row.identity_decision ?? null,
          rewrite_source: {
            file: repoRelativePath(rewriteFile),
            relation: row.relation ?? null,
            action: row.action ?? null,
            reason: row.reason ?? null,
          },
        };
        mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
        if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
      }
    }
    return { rows, mappings };
  }

  function loadIdentityUnresolvedReferenceMappings(files: unknown) {
    const mappings = new Map<string, UnresolvedIdentityMapping>();
    const rows: UnknownRecord[] = [];
    for (const filePathValue of ensureArray(files)) {
      const filePath = filePathValue as string;
      if (!filePath || !fileExists(filePath)) continue;
      for (const row of readJsonLines(filePath)) {
        rows.push(row);
        const original = (row.original ?? {}) as UnknownRecord;
        const sourceId = asText(
          original.ref_object_id ?? original.refObjectId ?? original.id ?? row?.dataset_id,
        );
        const sourceVersion =
          asText(
            original.version ??
              original.ref_version ??
              original["@version"] ??
              row?.dataset_version,
          ) || "00.00.001";
        if (!sourceId) continue;
        const mapping = {
          source: {
            ref_object_id: sourceId,
            version: sourceVersion,
            short_description:
              asText(original.short_description ?? original.shortDescription) || sourceId,
          },
          identity_decision: row.identity_decision ?? null,
          identity_evidence: (row.evidence as UnknownRecord | undefined) ?? null,
          unresolved_source: {
            file: repoRelativePath(filePath),
            relation: row.relation ?? null,
            action: row.action ?? null,
            reason: row.reason ?? null,
          },
        };
        mappings.set(`${sourceId}@@${sourceVersion}`, mapping);
        if (!mappings.has(sourceId)) mappings.set(sourceId, mapping);
      }
    }
    return { rows, mappings };
  }

  function processDataSetInformation(row: unknown) {
    const rowRecord = row as UnknownRecord | null | undefined;
    const processDataSet = rowRecord?.processDataSet as UnknownRecord | undefined;
    const processInformation = processDataSet?.processInformation as UnknownRecord | undefined;
    return (processInformation?.dataSetInformation as UnknownRecord | undefined) ?? null;
  }

  function ensureCommonOther(dataSetInformation: unknown): UnknownRecord | null {
    if (!dataSetInformation || typeof dataSetInformation !== "object") return null;
    const dataSetInformationRecord = dataSetInformation as UnknownRecord;
    const current = dataSetInformationRecord["common:other"];
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return current as UnknownRecord;
    }
    dataSetInformationRecord["common:other"] = {};
    return dataSetInformationRecord["common:other"] as UnknownRecord;
  }

  function appendUnresolvedFlowReferenceTrace(row: unknown, traceEntry: UnknownRecord) {
    const commonOther = ensureCommonOther(processDataSetInformation(row));
    if (!commonOther) return false;
    commonOther["@xmlns:tiangongfoundry"] =
      commonOther["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
    const key = "tiangongfoundry:unresolvedTrace";
    const current = commonOther[key];
    if (current === undefined) {
      commonOther[key] = [traceEntry];
    } else if (Array.isArray(current)) {
      current.push(traceEntry);
    } else {
      commonOther[key] = [current, traceEntry];
    }
    return true;
  }

  function unresolvedFlowTraceReferenceId(trace: unknown) {
    const traceRecord = trace as UnknownRecord | null | undefined;
    const evidence = traceRecord?.evidence as UnknownRecord | undefined;
    const target = evidence?.target as UnknownRecord | undefined;
    const identityDecision = evidence?.identity_decision as UnknownRecord | undefined;
    const identityDecisionEvidence = identityDecision?.evidence as UnknownRecord | undefined;
    const identityDecisionTarget = identityDecisionEvidence?.target as UnknownRecord | undefined;
    return asText(
      traceRecord?.reference_id ??
        traceRecord?.referenceId ??
        target?.id ??
        target?.["@refObjectId"] ??
        identityDecisionTarget?.id ??
        identityDecisionTarget?.["@refObjectId"],
    );
  }

  function blockedFlowReferenceBlockerFiles(options: IdentityRewriteOptions = {}) {
    return normalizedList(
      options.blockedFlowReferenceBlockers ||
        options.blockedFlowReferenceBlockersFile ||
        options.upstreamFlowBlockers ||
        options.upstreamFlowBlockersFile ||
        options.canonicalSupportBlockers ||
        options.canonicalSupportBlockersFile,
    )
      .map(resolveRepoPath)
      .filter(existingFilePath);
  }

  function blockedFlowReferenceBlockersById(options: IdentityRewriteOptions = {}) {
    const byId = new Map<string, UnknownRecord[]>();
    for (const filePath of blockedFlowReferenceBlockerFiles(options)) {
      for (const blocker of readJsonLines(filePath)) {
        const datasetType = asText(blocker.dataset_type ?? blocker.datasetType ?? blocker.type);
        const code = asText(blocker.code ?? blocker.blocker_code ?? blocker.blockerCode);
        if (datasetType && datasetType !== "flow") continue;
        if (code && code !== "canonical_flow_property_reference_unresolved") {
          continue;
        }
        const id = asText(
          blocker.dataset_id ?? blocker.datasetId ?? blocker.entity_id ?? blocker.id,
        );
        if (!id) continue;
        const existing = byId.get(id) ?? [];
        existing.push({
          ...blocker,
          blocker_file: repoRelativePath(filePath),
        });
        byId.set(id, existing);
      }
    }
    return byId;
  }

  return {
    identityReferenceRewriteIndexPath,
    flowGlobalReference,
    referenceShortDescription,
    loadIdentityDuplicateFlowMappings,
    identityReferenceRewriteInputFiles,
    identityUnresolvedReferenceInputFiles,
    loadIdentityReferenceRewriteMappings,
    loadIdentityUnresolvedReferenceMappings,
    ensureCommonOther,
    appendUnresolvedFlowReferenceTrace,
    unresolvedFlowTraceReferenceId,
    blockedFlowReferenceBlockerFiles,
    blockedFlowReferenceBlockersById,
  };
}

export type IdentityReferenceMappingLoaders = ReturnType<
  typeof createIdentityReferenceMappingLoaders
>;
