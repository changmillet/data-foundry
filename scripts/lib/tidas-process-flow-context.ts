import { sha256Json } from "./identity-preflight-proof.ts";
type Json = Record<string, unknown>;
function record(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}
/** Preserve explicit owner-row Flow evidence in one native manifest, rejecting exact identity conflicts. */
export function augmentTidasProcessFlowContext(
  rows: Json[],
  payloadForRow: (row: Json) => Json,
  identityForPayload: (
    payload: Json,
    root: string,
    information: string,
  ) => { id: string | null; version: string | null },
) {
  const documents = [...rows];
  const supplementalOwners = new Map<number, Map<number, string>>();
  const exactFlows = new Map<string, { hash: string; ordinal: number }>();
  for (const [ordinal, row] of rows.entries()) {
    const flow = payloadForRow(row);
    if (!record(flow.flowDataSet)) continue;
    const identity = identityForPayload(flow, "flowDataSet", "flowInformation");
    if (!identity.id || !identity.version) continue;
    const key = JSON.stringify([identity.id, identity.version]);
    const hash = sha256Json(flow);
    const prior = exactFlows.get(key);
    if (prior && prior.hash !== hash) throw new Error("tidas_flow_context_identity_conflict");
    if (!prior) exactFlows.set(key, { hash, ordinal });
  }
  for (const [owner, row] of rows.entries()) {
    if (!record(payloadForRow(row).processDataSet)) continue;
    const context = record(row.semantic_context);
    const flows = context?.flow_documents;
    if (!Array.isArray(flows)) continue;
    for (const [flowIndex, raw] of flows.entries()) {
      const flow = record(raw);
      if (!flow || !record(flow.flowDataSet))
        throw new Error("tidas_flow_context_document_invalid");
      const identity = identityForPayload(flow, "flowDataSet", "flowInformation");
      const key = JSON.stringify([identity.id, identity.version]);
      const hash = sha256Json(flow);
      const existing = identity.id && identity.version ? exactFlows.get(key) : undefined;
      if (existing && existing.hash !== hash)
        throw new Error("tidas_flow_context_identity_conflict");
      const ordinal = existing?.ordinal ?? documents.length;
      if (!existing) {
        documents.push(flow);
        if (identity.id && identity.version) exactFlows.set(key, { hash, ordinal });
      }
      if (!supplementalOwners.has(ordinal))
        supplementalOwners.set(ordinal, new Map(ordinal < rows.length ? [[ordinal, ""]] : []));
      supplementalOwners.get(ordinal)!.set(owner, `/semantic_context/flow_documents/${flowIndex}`);
    }
  }
  return { documents, supplementalOwners };
}

/** Admit the native profile's transport coverage without deciding scientific validity. */
export function assertTidasProcessCoverage(
  coverage: Json | null,
  binaryVersion: string,
  processCount: number,
  invalidProcessCount: number,
) {
  const versionParts = binaryVersion.split(".").map(Number);
  const requiresCoverage =
    processCount > 0 &&
    (coverage || (versionParts[0] === 0 && versionParts[1] === 3 && versionParts[2] >= 4));
  if (
    requiresCoverage &&
    (!coverage ||
      coverage.profile !== "tidas.process-allocation-reference.v1" ||
      coverage.process_count !== processCount ||
      typeof coverage.complete !== "boolean" ||
      !record(coverage.checks))
  )
    throw new Error("tidas_process_semantic_coverage_invalid");
  if (coverage && coverage.complete === false && invalidProcessCount === 0)
    throw new Error("tidas_process_semantic_coverage_incomplete");
  if (coverage && processCount > 0) {
    const checks = record(coverage.checks)!;
    let unresolved = 0;
    let invalid = 0;
    // Native 0.3.4 contracts.rs aggregates emitted checks, not a fixed seven-key map.
    // Unconditional valid-Process checks remain mandatory; invalid schema input may omit them.
    if (
      invalidProcessCount === 0 &&
      [
        "allocation-target-type",
        "allocation-vector",
        "exchange-identity",
        "quantitative-reference",
      ].some((name) => !record(checks[name]))
    )
      throw new Error("tidas_process_semantic_coverage_invalid");
    for (const value of Object.values(checks)) {
      const check = record(value);
      if (
        !check ||
        ["passed", "invalid", "unresolved", "not_applicable"].some(
          (key) => !Number.isSafeInteger(check[key]) || Number(check[key]) < 0,
        )
      )
        throw new Error("tidas_process_semantic_coverage_invalid");
      unresolved += Number(check.unresolved);
      invalid += Number(check.invalid);
    }
    if (coverage.complete !== (unresolved === 0))
      throw new Error("tidas_process_semantic_coverage_invalid");
    if ((unresolved > 0 || invalid > 0) && invalidProcessCount === 0)
      throw new Error("tidas_process_semantic_coverage_incomplete");
  }
}
