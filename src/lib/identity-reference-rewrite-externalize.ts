import fs from "node:fs";
import path from "node:path";
import type {
  FlowReference,
  IdentityReferenceMappingLoaders,
  IdentityReferenceRewriteDependencies,
  IdentityRewriteOptions,
  UnknownRecord,
} from "./identity-reference-rewrite-mappings.ts";

export function createUnresolvedProcessFlowExternalizer(
  deps: IdentityReferenceRewriteDependencies,
  loaders: IdentityReferenceMappingLoaders,
) {
  const {
    asText,
    cloneJson,
    countRowsFile,
    datasetIdentity,
    ensureArray,
    foundryTraceNamespace,
    nowIso,
    readRowsFile,
    repoRelativePath,
    writeJson,
    writeJsonLines,
  } = deps;
  const {
    blockedFlowReferenceBlockerFiles,
    blockedFlowReferenceBlockersById,
    ensureCommonOther,
    referenceShortDescription,
    unresolvedFlowTraceReferenceId,
  } = loaders;

  return function externalizeUnresolvedProcessFlowExchanges({
    datasetType,
    rowsFile,
    outFile,
    outDir,
    options = {},
  }: {
    datasetType: string;
    rowsFile: string;
    outFile: string;
    outDir: string;
    options?: IdentityRewriteOptions;
  }) {
    const reportFile = path.join(outDir, "unresolved-exchange-externalization-report.json");
    const tracesFile = path.join(outDir, "unresolved-exchanges.jsonl");
    if (datasetType !== "process") {
      const report = {
        schema_version: 1,
        generated_at_utc: nowIso(),
        stage: "unresolved_exchange_externalization",
        status: "not_required",
        input_rows_file: repoRelativePath(rowsFile),
        output_rows_file: repoRelativePath(rowsFile),
        counts: {
          rows: countRowsFile(rowsFile),
          affected_rows: 0,
          externalized_exchanges: 0,
        },
        files: {
          report: repoRelativePath(reportFile),
          output_rows: repoRelativePath(rowsFile),
          traces: null,
        },
      };
      writeJson(reportFile, report);
      return report;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const rows = readRowsFile(rowsFile);
    const externalized: UnknownRecord[] = [];
    const blockedFlowReferencesById = blockedFlowReferenceBlockersById(options);
    let affectedRows = 0;
    let elementaryFlowExternalized = 0;
    let blockedDependencyExternalized = 0;

    rows.forEach((row, rowIndex) => {
      const jsonOrdered = row.json_ordered as UnknownRecord | undefined;
      const processDataSet = (row.processDataSet ?? jsonOrdered?.processDataSet) as
        UnknownRecord | undefined;
      const processInformation = processDataSet?.processInformation as UnknownRecord | undefined;
      const dataSetInformation = processInformation?.dataSetInformation ?? null;
      const commonOther = ensureCommonOther(dataSetInformation);
      const commonOtherRecord = commonOther as UnknownRecord;
      const unresolvedTraces = ensureArray(commonOther?.["tiangongfoundry:unresolvedTrace"]);
      const unresolvedById = new Map<string, UnknownRecord>();
      for (const traceValue of unresolvedTraces) {
        const trace = traceValue as UnknownRecord;
        if (trace.action_item_code !== "elementary_flow_identity_manual_review") {
          continue;
        }
        const referenceId = unresolvedFlowTraceReferenceId(trace);
        if (referenceId) {
          unresolvedById.set(referenceId, trace);
        }
      }
      if (unresolvedById.size === 0 && blockedFlowReferencesById.size === 0) {
        return;
      }

      const exchangesRecord = processDataSet?.exchanges as UnknownRecord | undefined;
      const exchanges = ensureArray(exchangesRecord?.exchange);
      if (exchanges.length === 0) return;
      const kept: unknown[] = [];
      let rowExternalized = 0;
      for (const [exchangeIndex, exchangeValue] of exchanges.entries()) {
        const exchange = exchangeValue as UnknownRecord;
        const reference = exchange?.referenceToFlowDataSet as FlowReference | undefined;
        const referenceId = asText(reference?.["@refObjectId"] ?? reference?.refObjectId);
        const unresolvedTrace = referenceId ? unresolvedById.get(referenceId) : null;
        const blockedFlowReferenceBlockers = referenceId
          ? (blockedFlowReferencesById.get(referenceId) ?? [])
          : [];
        if (!referenceId || (!unresolvedTrace && blockedFlowReferenceBlockers.length === 0)) {
          kept.push(exchange);
          continue;
        }

        commonOtherRecord["@xmlns:tiangongfoundry"] =
          commonOtherRecord["@xmlns:tiangongfoundry"] ?? foundryTraceNamespace;
        const actionItemCode = unresolvedTrace
          ? "elementary_flow_exchange_externalized"
          : "blocked_flow_dependency_exchange_externalized";
        const externalizedTrace = {
          status: "externalized_before_remote_write",
          action_item_code: actionItemCode,
          blocked_path: `processDataSet.exchanges.exchange.${exchangeIndex}.referenceToFlowDataSet`,
          reference_id: referenceId,
          reference_version: asText(reference?.["@version"] ?? reference?.version) || null,
          reason: unresolvedTrace
            ? "Formal exchange references an unresolved elementary flow identity. Foundry moved the full exchange into common:other trace before remote write planning so the process can remain schema-valid while preserving source evidence for later repair."
            : "Formal exchange references a flow row that cannot be written because its required Flow Property or Unit Group is not backed by a canonical public database support row. Foundry moved the full exchange into common:other trace before remote write planning to avoid a dangling flow reference.",
          unresolved_trace: unresolvedTrace ? cloneJson(unresolvedTrace) : null,
          upstream_flow_blockers:
            blockedFlowReferenceBlockers.length > 0 ? cloneJson(blockedFlowReferenceBlockers) : [],
          original_exchange: cloneJson(exchange),
          next_action: unresolvedTrace
            ? "Resolve this elementary flow against an approved public TianGong flow, then restore a formal process exchange in a later curated repair."
            : "Add the missing public canonical Flow Property or Unit Group support row, rerun flow finalization, then restore this process exchange in a later curated repair.",
        };
        const traceKey = "tiangongfoundry:unresolvedExchangeTrace";
        const current = commonOtherRecord[traceKey];
        if (current === undefined) {
          commonOtherRecord[traceKey] = [externalizedTrace];
        } else if (Array.isArray(current)) {
          current.push(externalizedTrace);
        } else {
          commonOtherRecord[traceKey] = [current, externalizedTrace];
        }
        externalized.push({
          relation: unresolvedTrace
            ? "process_exchange_to_unresolved_elementary_flow_trace"
            : "process_exchange_to_blocked_flow_dependency_trace",
          action: "externalize_exchange_before_remote_write",
          dataset_type: "process",
          dataset_id: datasetIdentity(row, "process").id || null,
          dataset_version: datasetIdentity(row, "process").version || null,
          row_index: rowIndex,
          exchange_index: exchangeIndex,
          path: externalizedTrace.blocked_path,
          original: {
            table: "flows",
            ref_object_id: referenceId,
            version: externalizedTrace.reference_version,
            short_description: referenceShortDescription(reference) || null,
          },
          trace: externalizedTrace,
        });
        if (unresolvedTrace) {
          elementaryFlowExternalized += 1;
        } else {
          blockedDependencyExternalized += 1;
        }
        rowExternalized += 1;
      }
      if (rowExternalized > 0) {
        affectedRows += 1;
        const processDataSetRecord = processDataSet as UnknownRecord;
        const nextExchanges = (processDataSetRecord.exchanges ??= {}) as UnknownRecord;
        nextExchanges.exchange = kept;
      }
    });

    writeJsonLines(outFile, rows);
    writeJsonLines(tracesFile, externalized);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      stage: "unresolved_exchange_externalization",
      status: "completed",
      input_rows_file: repoRelativePath(rowsFile),
      output_rows_file: repoRelativePath(outFile),
      counts: {
        rows: rows.length,
        affected_rows: affectedRows,
        externalized_exchanges: externalized.length,
        elementary_flow_externalized: elementaryFlowExternalized,
        blocked_flow_dependency_externalized: blockedDependencyExternalized,
        upstream_blocked_flow_references: blockedFlowReferencesById.size,
      },
      files: {
        report: repoRelativePath(reportFile),
        output_rows: repoRelativePath(outFile),
        traces: repoRelativePath(tracesFile),
        blocked_flow_reference_blockers:
          blockedFlowReferenceBlockerFiles(options).map(repoRelativePath),
      },
    };
    writeJson(reportFile, report);
    return report;
  };
}
