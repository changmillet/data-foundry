import { FoundryContextError } from "./foundry-runtime-error.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { datasetRoot, unwrapDatasetPayload } from "./import-curation/internal/dataset-payload.ts";

type Json = Record<string, unknown>;
function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}
function invalid(message: string): never {
  throw new FoundryContextError("workflow_validation_reference_invalid", message);
}
function flowKey(document: unknown): string | null {
  const flow = object(object(document)?.flowDataSet);
  const information = object(object(flow?.flowInformation)?.dataSetInformation);
  const publication = object(object(flow?.administrativeInformation)?.publicationAndOwnership);
  const id = information?.["common:UUID"],
    version = publication?.["common:dataSetVersion"];
  return typeof id === "string" && id && typeof version === "string" && version
    ? JSON.stringify([id, version])
    : null;
}

/** Queue interfaces from selected complete bodies; metadata is not exact-version evidence. */
export function selectedFoundryExternalFlowReferences(
  processRows: readonly unknown[],
  referenceRows: readonly unknown[],
): Array<{ id: string; version: string; source: "selected_read_only_qa_reference" }> {
  const available = new Set<string>();
  for (const row of referenceRows) {
    const key = flowKey(unwrapDatasetPayload(row, "flow"));
    if (key) available.add(key);
  }
  const byId = new Map<string, Set<string>>();
  for (const row of processRows) {
    const raw = datasetRoot(unwrapDatasetPayload(row, "process"), "process").exchanges?.exchange;
    for (const exchange of raw ? (Array.isArray(raw) ? raw : [raw]) : []) {
      const ref = object(object(exchange)?.referenceToFlowDataSet);
      const id = ref?.["@refObjectId"];
      if (typeof id !== "string" || !id) continue;
      const versions = byId.get(id) ?? new Set<string>();
      versions.add(typeof ref?.["@version"] === "string" ? ref["@version"] : "");
      byId.set(id, versions);
    }
  }
  return [...byId].flatMap(([id, versions]) =>
    [...versions].every((version) => version && available.has(JSON.stringify([id, version])))
      ? [...versions].map((version) => ({
          id,
          version,
          source: "selected_read_only_qa_reference" as const,
        }))
      : [],
  );
}

/** Pure exact-version projection for CLI validation only; no scientific payload or write row changes. */
export function projectFoundryValidationReferences(
  processRows: readonly unknown[],
  referenceRows: readonly unknown[],
): unknown[] {
  const flows = new Map<string, { document: Json; hash: string }>();
  const remember = (document: Json) => {
    const key = flowKey(document);
    if (!key) return;
    const hash = sha256Json(document),
      prior = flows.get(key);
    if (prior && prior.hash !== hash)
      invalid("Exact Flow evidence has conflicting complete bodies.");
    if (!prior) flows.set(key, { document, hash });
  };
  for (const row of referenceRows) {
    const document = object(unwrapDatasetPayload(row, "flow"));
    if (document?.flowDataSet) remember(document);
  }
  return processRows.map((original) => {
    const source = object(original);
    if (!source) invalid("Process validation row must be an object.");
    const payload = unwrapDatasetPayload(original, "process");
    const root = datasetRoot(payload, "process");
    const rawContext = source.semantic_context;
    const context = rawContext === undefined ? {} : object(rawContext);
    if (!context) invalid("Existing Process semantic context must be an object.");
    const supplied = context.flow_documents;
    if (supplied !== undefined && !Array.isArray(supplied))
      invalid("Existing Process Flow documents must be an array.");
    const documents: Json[] = [];
    const included = new Map<string, string>();
    for (const raw of supplied ?? []) {
      const document = object(raw);
      if (!document?.flowDataSet)
        invalid("Existing Process context must contain complete Flow documents.");
      const key = flowKey(document);
      if (key) {
        const prior = flows.get(key);
        if (prior && prior.hash !== sha256Json(document))
          invalid("Selected Flow evidence conflicts with original Process context.");
        const priorHash = included.get(key);
        if (priorHash && priorHash !== sha256Json(document))
          invalid("Original Process context has conflicting exact Flow bodies.");
        included.set(key, sha256Json(document));
      }
      documents.push(document);
    }
    const raw = root.exchanges?.exchange;
    for (const exchange of raw ? (Array.isArray(raw) ? raw : [raw]) : []) {
      const ref = object(object(exchange)?.referenceToFlowDataSet);
      const id = ref?.["@refObjectId"],
        version = ref?.["@version"];
      if (typeof id !== "string" || !id || typeof version !== "string" || !version) continue;
      const key = JSON.stringify([id, version]),
        selected = flows.get(key);
      if (selected && !included.has(key)) {
        documents.push(selected.document);
        included.set(key, selected.hash);
      }
    }
    const wrapper = payload === original ? { json: payload } : { ...source };
    const projected = { ...wrapper, semantic_context: { ...context, flow_documents: documents } };
    if (sha256Json(unwrapDatasetPayload(projected, "process")) !== sha256Json(payload))
      invalid("Validation projection changed the Process scientific payload.");
    return projected;
  });
}
