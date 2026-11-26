import type { BundleRowType } from "../bundle-row-types.ts";
import type {
  BundleSampleDependencies,
  LocationCandidate,
  LooseRecord,
  ProcessFlowEvidence,
} from "./types.ts";

/** Creates flow location evidence projection and authoring-queue collection helpers. */
export function createFlowLocationEvidenceHelpers(
  deps: Pick<
    BundleSampleDependencies,
    "asText" | "datasetIdentity" | "ensureArray" | "repoRelativeMaybe" | "textValue"
  >,
) {
  const { asText, datasetIdentity, ensureArray, repoRelativeMaybe, textValue } = deps;

  function locationCodeFromValue(value: unknown, locationCodeMap: Map<string, unknown>) {
    const code = asText(value);
    return code && locationCodeMap.has(code) ? code : null;
  }

  function processLocationCode(payload: LooseRecord, locationCodeMap: Map<string, unknown>) {
    return locationCodeFromValue(
      payload?.processDataSet?.processInformation?.geography
        ?.locationOfOperationSupplyOrProduction?.["@location"],
      locationCodeMap,
    );
  }

  function exchangeLocationCode(exchange: LooseRecord, locationCodeMap: Map<string, unknown>) {
    return locationCodeFromValue(
      exchange?.location ?? exchange?.["@location"] ?? exchange?.locationOfSupply,
      locationCodeMap,
    );
  }

  function flowLocationOfSupply(payload: LooseRecord): string {
    return asText(payload?.flowDataSet?.flowInformation?.geography?.locationOfSupply);
  }

  function flowNameMixAndLocationTypes(payload: LooseRecord): string {
    return textValue(
      payload?.flowDataSet?.flowInformation?.dataSetInformation?.name?.mixAndLocationTypes,
    );
  }

  function locationCodeCandidatesFromText(
    value: unknown,
    locationCodeMap: Map<string, unknown>,
  ): LocationCandidate[] {
    const text = asText(value);
    if (!text) return [];
    const candidates: LocationCandidate[] = [];
    const normalized = text.replace(/[{}]/gu, "").trim();
    if (locationCodeMap.has(normalized)) {
      candidates.push({
        code: normalized,
        source_kind: "exact_text",
        source_value: text,
      });
    }
    for (const match of text.matchAll(/\{([A-Z0-9][A-Z0-9+&-]*)\}/gu)) {
      const code = match[1];
      if (locationCodeMap.has(code)) {
        candidates.push({
          code,
          source_kind: "braced_code",
          source_value: text,
        });
      }
    }
    return candidates;
  }

  function uniqueLocationCandidates(candidates: LocationCandidate[]): LocationCandidate[] {
    const byKey = new Map<string, LocationCandidate>();
    for (const candidate of candidates) {
      if (!candidate?.code || byKey.has(candidate.code)) continue;
      byKey.set(candidate.code, candidate);
    }
    return [...byKey.values()];
  }

  function buildFlowLocationQueueRow({
    flowPayload,
    flowKey,
    sourceFile,
    candidates,
    locationCommands,
    reason,
  }: {
    flowPayload: LooseRecord;
    flowKey: string;
    sourceFile: string | null;
    candidates: LocationCandidate[];
    locationCommands: LooseRecord;
    reason: string;
  }) {
    const identity = datasetIdentity(flowPayload, "flow");
    const uniqueCandidates = uniqueLocationCandidates(candidates);
    return {
      dataset_type: "flow",
      dataset_id: identity.id,
      dataset_version: identity.version,
      source_file: repoRelativeMaybe(sourceFile),
      code: "flow_location_of_supply_requires_authoring",
      path: "flowDataSet.flowInformation.geography.locationOfSupply",
      current_location: null,
      suggested_location_code: uniqueCandidates.length === 1 ? uniqueCandidates[0].code : null,
      evidence: {
        source: "bafu_packaged_bundle_location_projection",
        reason,
        flow_key: flowKey,
        candidates: uniqueCandidates,
      },
      location_workflow: {
        schema_type: "location",
        commands: locationCommands,
        decision_contract: {
          required_selector: "row_index or dataset_id",
          required_location: "code from tidas_locations_category.json",
          required_target_path:
            "target_path is required when a row contains more than one location field",
          optional_fields: ["basis", "evidence"],
        },
      },
      required_resolution:
        "Use full flow/process/exchange context to fill locationOfSupply with a valid TIDAS location code, apply the location decision through the CLI, then rerun validation before remote write.",
    };
  }

  function collectFlowLocationOfSupplyAuthoringRows({
    rowsByType,
    sourceByType,
    processFlowEvidenceRows,
    locationCodeMap,
    locationQueueRows,
    locationCommands,
    blockers,
    stats,
  }: {
    rowsByType: Record<BundleRowType, Map<string, LooseRecord>>;
    sourceByType: Record<BundleRowType, Map<string, string>>;
    processFlowEvidenceRows: ProcessFlowEvidence[];
    locationCodeMap: Map<string, unknown>;
    locationQueueRows: Array<Record<string, unknown>>;
    locationCommands: LooseRecord;
    blockers: Array<Record<string, unknown>>;
    stats: Record<string, number>;
  }): void {
    const processEvidenceByFlow = new Map<string, ProcessFlowEvidence>(
      processFlowEvidenceRows.map((row) => [`${row.flow_id}::${row.flow_version}`, row]),
    );
    const queuedKeys = new Set(
      locationQueueRows.map(
        (row) => `${asText(row.dataset_id)}::${asText(row.dataset_version)}::${asText(row.path)}`,
      ),
    );
    for (const [flowKey, flowPayload] of rowsByType.flow.entries()) {
      if (flowLocationOfSupply(flowPayload)) continue;
      const flowNameCandidates = locationCodeCandidatesFromText(
        flowNameMixAndLocationTypes(flowPayload),
        locationCodeMap,
      ).map((candidate) => ({
        ...candidate,
        evidence_source: "flowDataSet.flowInformation.dataSetInformation.name.mixAndLocationTypes",
      }));
      const processEvidence = processEvidenceByFlow.get(flowKey);
      const exchangeCandidates: LocationCandidate[] = [];
      if (
        processEvidence?.exchange_location &&
        locationCodeMap.has(processEvidence.exchange_location)
      ) {
        exchangeCandidates.push({
          code: processEvidence.exchange_location,
          source_kind: "exchange_location",
          source_value: processEvidence.exchange_location,
          evidence_source: "processDataSet.exchanges.exchange.location",
          process_id: processEvidence.process_id,
          process_version: processEvidence.process_version,
        });
      }
      const processFallbackCandidates: LocationCandidate[] = [];
      if (
        processEvidence?.process_location &&
        locationCodeMap.has(processEvidence.process_location)
      ) {
        processFallbackCandidates.push({
          code: processEvidence.process_location,
          source_kind: "process_location_fallback",
          source_value: processEvidence.process_location,
          evidence_source:
            "processDataSet.processInformation.geography.locationOfOperationSupplyOrProduction.@location",
          process_id: processEvidence.process_id,
          process_version: processEvidence.process_version,
        });
      }
      const candidates =
        flowNameCandidates.length > 0 || exchangeCandidates.length > 0
          ? [...flowNameCandidates, ...exchangeCandidates]
          : processFallbackCandidates;
      const uniqueCandidates = uniqueLocationCandidates(candidates);
      if (uniqueCandidates.length === 0) continue;
      const identity = datasetIdentity(flowPayload, "flow");
      const queueKey = `${identity.id}::${identity.version}::flowDataSet.flowInformation.geography.locationOfSupply`;
      if (queuedKeys.has(queueKey)) continue;
      const reason =
        uniqueCandidates.length === 1
          ? "single_valid_location_candidate"
          : "multiple_valid_location_candidates";
      const sourceFile = sourceByType.flow.get(flowKey) ?? null;
      const queueRow = buildFlowLocationQueueRow({
        flowPayload,
        flowKey,
        sourceFile,
        candidates,
        locationCommands,
        reason,
      });
      locationQueueRows.push(queueRow);
      queuedKeys.add(queueKey);
      stats.flow_location_of_supply_missing_with_evidence += 1;
      if (uniqueCandidates.length === 1) {
        stats.flow_location_of_supply_auto_decision_candidates += 1;
      } else {
        stats.flow_location_of_supply_conflict_blockers += 1;
      }
      blockers.push({
        code: "flow_location_of_supply_requires_authoring",
        message:
          uniqueCandidates.length === 1
            ? "Flow locationOfSupply is empty but source context has a valid location code candidate that must be applied through location decisions before commit."
            : "Flow locationOfSupply is empty and source context has conflicting valid location code candidates.",
        dataset_type: "flow",
        dataset_id: identity.id,
        dataset_version: identity.version,
        source_file: repoRelativeMaybe(sourceFile),
        path: "flowDataSet.flowInformation.geography.locationOfSupply",
        suggested_location_code: queueRow.suggested_location_code,
        candidate_codes: uniqueCandidates.map((candidate) => candidate.code),
        queue: "location-authoring-queue.jsonl",
      });
    }
  }

  function flowDataSetInformation(payload: LooseRecord): LooseRecord | null {
    return payload?.flowDataSet?.flowInformation?.dataSetInformation ?? null;
  }

  function buildFlowLocationTracePayload(evidence: ProcessFlowEvidence) {
    return {
      process: {
        name: "process",
        attributes: [
          { name: "processId", value: evidence.process_id },
          { name: "processVersion", value: evidence.process_version },
        ].filter((item) => item.value),
      },
      geography: evidence.process_location
        ? {
            name: "geography",
            attributes: [
              {
                name: "locationOfOperationSupplyOrProduction",
                value: evidence.process_location,
              },
            ],
          }
        : undefined,
      exchange: {
        name: "exchange",
        attributes: [
          { name: "referenceToFlowDataSet", value: evidence.flow_id },
          { name: "referenceToFlowDataSetVersion", value: evidence.flow_version },
          evidence.exchange_location
            ? { name: "location", value: evidence.exchange_location }
            : null,
        ].filter(Boolean),
      },
    };
  }

  function appendFlowLocationSourceTrace(
    flowPayload: LooseRecord,
    evidence: ProcessFlowEvidence,
  ): boolean {
    if (!flowPayload?.flowDataSet || flowLocationOfSupply(flowPayload)) return false;
    const dataSetInformation = flowDataSetInformation(flowPayload);
    if (!dataSetInformation || typeof dataSetInformation !== "object") return false;
    if (
      dataSetInformation["common:other"] &&
      (typeof dataSetInformation["common:other"] !== "object" ||
        Array.isArray(dataSetInformation["common:other"]))
    ) {
      return false;
    }
    const commonOther = (dataSetInformation["common:other"] ??= {});
    commonOther["@xmlns:tidasimport"] = "https://tiangong.earth/tidas/import-trace/1.0";
    const locationTrace = buildFlowLocationTracePayload(evidence);
    if (commonOther["tidasimport:sourceTrace"]) {
      const existingTrace = commonOther["tidasimport:sourceTrace"];
      if (!existingTrace || typeof existingTrace !== "object" || Array.isArray(existingTrace)) {
        return false;
      }
      const payload = (existingTrace as LooseRecord).payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const payloadRecord = payload;
      if (payloadRecord.flowLocationEvidence) return false;
      payloadRecord.flowLocationEvidence = locationTrace;
      return true;
    }
    commonOther["tidasimport:sourceTrace"] = {
      "@marker": "TIDAS_IMPORT_TRACE_V1",
      payload: locationTrace,
    };
    return true;
  }

  function projectProcessFlowLocationEvidence({
    rowsByType,
    sourceByType,
    locationCodeMap,
    stats,
  }: {
    rowsByType: Record<BundleRowType, Map<string, LooseRecord>>;
    sourceByType: Record<BundleRowType, Map<string, string>>;
    locationCodeMap: Map<string, unknown>;
    stats: Record<string, number>;
  }): ProcessFlowEvidence[] {
    const evidenceByFlowKey = new Map<string, ProcessFlowEvidence>();
    for (const [processKey, processPayload] of rowsByType.process.entries()) {
      const processIdentity = datasetIdentity(processPayload, "process");
      const processLocation = processLocationCode(processPayload, locationCodeMap);
      const exchanges = ensureArray(processPayload?.processDataSet?.exchanges?.exchange).filter(
        (exchange) => exchange && typeof exchange === "object",
      );
      for (const exchange of exchanges) {
        const reference = exchange.referenceToFlowDataSet ?? {};
        const flowId = asText(reference["@refObjectId"]);
        const flowVersion = asText(reference["@version"]) || "00.00.001";
        if (!flowId) continue;
        const exchangeLocation = exchangeLocationCode(exchange, locationCodeMap);
        if (!exchangeLocation && !processLocation) continue;
        const flowKey = `${flowId}::${flowVersion}`;
        if (evidenceByFlowKey.has(flowKey)) continue;
        evidenceByFlowKey.set(flowKey, {
          flow_id: flowId,
          flow_version: flowVersion,
          process_id: processIdentity.id,
          process_version: processIdentity.version,
          process_source_file: sourceByType.process.get(processKey) ?? null,
          process_location: processLocation,
          exchange_location: exchangeLocation,
        });
      }
    }

    for (const [flowKey, evidence] of evidenceByFlowKey.entries()) {
      const flowPayload = rowsByType.flow.get(flowKey);
      if (!flowPayload) continue;
      if (appendFlowLocationSourceTrace(flowPayload, evidence)) {
        stats.flow_location_context_traces += 1;
      }
    }
    return [...evidenceByFlowKey.values()];
  }

  return {
    collectFlowLocationOfSupplyAuthoringRows,
    projectProcessFlowLocationEvidence,
  };
}
