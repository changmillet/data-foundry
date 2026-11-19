import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createFoundryEdgeActor } from "./foundry-edge-session.ts";
import type { FoundryAuthentication } from "./foundry-runtime-identity.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { FoundryContextError, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { workflowObject } from "./foundry-workflow-state.ts";

const tables = {
  process: "processes",
  flow: "flows",
  flowproperty: "flowproperties",
  unitgroup: "unitgroups",
  source: "sources",
  contact: "contacts",
  lciamethod: "lciamethods",
  model: "lifecyclemodels",
} as const;
type DatasetType = keyof typeof tables;
export interface FoundryRepairCensusQuery {
  table: (typeof tables)[DatasetType];
  state?: 0 | 100;
  owner?: string;
  id?: string;
  version?: string;
  ids?: readonly string[];
  projection?: "dependencies";
  offset: number;
  limit: number;
}
export interface FoundryRepairCensusPage {
  raw: string;
  contentRange: string | null;
  status: number;
  identityReceipt?: unknown;
  requestedAtUtc?: string;
}
type Reader = (query: FoundryRepairCensusQuery) => Promise<FoundryRepairCensusPage>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const version = /^[0-9]{2}\.[0-9]{2}\.[0-9]{3}$/u;
const maximumRows = 100_000;
const maximumBytes = 64 * 1024 * 1024;
const maximumTransferBytes = 1024 * 1024 * 1024;
type Row = Record<string, unknown>;
type Directory = { process: Map<string, Row>; model: Map<string, Row>; flow: Map<string, Row> };
interface CensusObservation {
  query: FoundryRepairCensusQuery;
  page: FoundryRepairCensusPage;
  response_sha256: string;
}

function reject(message: string): never {
  throw new FoundryContextError("repair_census_unproven", message);
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > maximumRows)
    reject("Repair census input needs a bounded full inventory.");
  return value;
}
function identity(id: unknown, revision: unknown): string {
  if (
    typeof id !== "string" ||
    !uuid.test(id) ||
    typeof revision !== "string" ||
    !version.test(revision)
  )
    reject("Repair census identities require explicit UUIDs and exact versions.");
  return `${id.toLowerCase()}@${revision}`;
}
function visible(row: Record<string, unknown>, actor: string): boolean {
  return row.state_code === 100 || (row.state_code === 0 && row.user_id === actor);
}
function records(page: FoundryRepairCensusPage, query: FoundryRepairCensusQuery) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(page.raw);
  } catch {
    reject("Repair census returned malformed JSON.");
  }
  const rows = array(parsed).map(workflowObject);
  const range = page.contentRange?.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/u);
  if (![200, 206].includes(page.status) || !range || rows.length > query.limit)
    reject("Repair census requires successful bounded pages with an exact Content-Range total.");
  const total = Number(range[3]);
  if (!Number.isSafeInteger(total) || total > maximumRows || total < 0)
    reject("Repair census exceeds the supported 100000-row scope or has an invalid exact count.");
  if (
    rows.length
      ? Number(range[1]) !== query.offset ||
        Number(range[2]) !== query.offset + rows.length - 1 ||
        query.offset + rows.length > total
      : total !== 0 || query.offset !== 0 || range[1] !== undefined
  )
    reject("Repair census page range, offset and row count do not agree.");
  return { rows, total };
}

function reference(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject("A directory reference is malformed; family separation is uncertain.");
  const item = value as Row;
  if (typeof item["@refObjectId"] !== "string" || !uuid.test(item["@refObjectId"]))
    reject("A directory reference has no provable UUID; family separation is uncertain.");
  const revision = item["@version"];
  return {
    id: item["@refObjectId"].toLowerCase(),
    version: revision === undefined || revision === null || revision === "" ? null : revision,
  };
}
function nestedReferences(value: unknown): Row[] {
  const found: Row[] = [];
  const visit = (current: unknown, depth: number) => {
    if (depth > 64 || found.length > maximumRows)
      reject("Directory reference nesting exceeds its bound.");
    if (Array.isArray(current)) {
      for (const child of current) visit(child, depth + 1);
    } else if (current && typeof current === "object") {
      const item = current as Row;
      if (Object.hasOwn(item, "@refObjectId")) found.push(reference(item));
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (!found.length)
    reject("A directory reference has no provable UUID; family separation is uncertain.");
  return found;
}
function occurrences(value: unknown): Row[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maximumRows) reject("Directory reference occurrence limit exceeded.");
  return values.map(workflowObject);
}
function field(row: Row, alias: string, path: readonly string[]): unknown {
  if (Object.hasOwn(row, alias)) return row[alias];
  if (!Object.hasOwn(row, "json")) reject("Directory response omitted a required projection.");
  let value: unknown = row.json;
  for (const key of path) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object" || Array.isArray(value))
      reject("Directory JSON path is malformed.");
    value = (value as Row)[key];
  }
  return value ?? null;
}
function directoryRow(type: "process" | "model" | "flow", row: Row): Row {
  for (const key of ["id", "version", "user_id", "state_code"])
    if (!Object.hasOwn(row, key)) reject("Directory response omitted identity or eligibility.");
  identity(row.id, row.version);
  const common: Row = {
    id: String(row.id).toLowerCase(),
    version: row.version,
    user_id: row.user_id,
    state_code: row.state_code,
  };
  if (type === "process") {
    for (const key of ["model_id", "model_version", "team_id", "review_id"])
      if (!Object.hasOwn(row, key)) reject("Directory Process lineage metadata is incomplete.");
    const exchanges = field(row, "exchanges", ["processDataSet", "exchanges", "exchange"]);
    const references = occurrences(exchanges).flatMap((exchange) =>
      nestedReferences(exchange.referenceToFlowDataSet),
    );
    return {
      ...common,
      model_id: row.model_id,
      model_version: row.model_version,
      team_id: row.team_id,
      review_id: row.review_id,
      flow_references: references,
    };
  }
  if (type === "model") {
    const result = field(row, "result_process", [
      "lifeCycleModelDataSet",
      "lifeCycleModelInformation",
      "dataSetInformation",
      "referenceToResultingProcess",
    ]);
    const components = field(row, "process_instances", [
      "lifeCycleModelDataSet",
      "lifeCycleModelInformation",
      "technology",
      "processes",
      "processInstance",
    ]);
    return {
      ...common,
      process_references: [
        ...occurrences(result).flatMap(nestedReferences),
        ...occurrences(components).flatMap((item) => nestedReferences(item.referenceToProcess)),
      ],
    };
  }
  const declared = field(row, "declared_type", [
    "flowDataSet",
    "modellingAndValidation",
    "LCIMethod",
    "typeOfDataSet",
  ]);
  return { ...common, declared_type: typeof declared === "string" ? declared.trim() : null };
}
function digest(rows: Map<string, Row>): string {
  const hash = createHash("sha256");
  for (const key of [...rows.keys()].sort()) hash.update(`${key}\0${sha256Json(rows.get(key))}\n`);
  return hash.digest("hex");
}
function directoryDigest(directory: Directory): string {
  return sha256Json({
    process: digest(directory.process),
    model: digest(directory.model),
    flow: digest(directory.flow),
  });
}
function flowHeads(flows: Map<string, Row>): Map<string, string> {
  const heads = new Map<string, string>();
  for (const row of flows.values()) {
    const id = String(row.id),
      revision = String(row.version);
    if (!heads.has(id) || heads.get(id)! < revision) heads.set(id, revision);
  }
  return heads;
}

/** A conservative identity component, without provider signs, weights or numerical selection. */
function boundedFamily(
  directory: Directory,
  expected: Map<DatasetType, Map<string, Row>>,
  workerInput: Row,
) {
  const adjacency = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  };
  const heads = flowHeads(directory.flow);
  const connectProcess = (row: Row) => {
    const node = `process:${String(row.id).toLowerCase()}`;
    if (!adjacency.has(node)) adjacency.set(node, new Set());
    for (const value of array(row.flow_references)) {
      const ref = workflowObject(value);
      const revision = ref.version ?? heads.get(String(ref.id));
      const flow =
        typeof revision === "string" && version.test(revision)
          ? directory.flow.get(identity(ref.id, revision))
          : undefined;
      // Only an explicitly declared, exact visible Elementary revision is safely excluded.
      if (flow?.declared_type === "Elementary flow") continue;
      connect(node, `flow:${ref.id}`);
    }
    if (row.model_id !== null && row.model_id !== undefined) {
      if (typeof row.model_id !== "string" || !uuid.test(row.model_id))
        reject("Directory Process model identity is uncertain.");
      connect(node, `model:${row.model_id.toLowerCase()}`);
    }
  };
  for (const row of directory.process.values()) connectProcess(row);
  for (const row of directory.model.values()) {
    const node = `model:${row.id}`;
    if (!adjacency.has(node)) adjacency.set(node, new Set());
    for (const value of array(row.process_references))
      connect(node, `process:${workflowObject(value).id}`);
  }
  // The approved after-body may introduce references absent from the live before directory.
  for (const value of array(workerInput.overlays ?? [])) {
    const overlay = workflowObject(value),
      selected = workflowObject(overlay.identity);
    if (selected.dataset_type === "process") {
      const source = expected.get("process")?.get(identity(selected.id, selected.version));
      if (!source) reject("Candidate Process is absent from the frozen family.");
      const metadata = directory.process.get(identity(selected.id, selected.version));
      if (!metadata) reject("Candidate Process is absent from the authenticated directory.");
      connectProcess(
        directoryRow("process", {
          ...metadata,
          id: selected.id,
          version: selected.version,
          json: overlay.document,
        }),
      );
    }
  }
  const pending = [
    ...[...(expected.get("process")?.values() ?? [])].map(
      (item) => `process:${workflowObject(item.identity).id}`,
    ),
    ...[...(expected.get("model")?.values() ?? [])].map((item) => `model:${item.id}`),
    ...array(workerInput.overlays ?? []).flatMap((value) => {
      const selected = workflowObject(workflowObject(value).identity);
      return selected.dataset_type === "flow" ? [`flow:${selected.id}`] : [];
    }),
  ].map((node) => node.toLowerCase());
  const nodes = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (nodes.has(node)) continue;
    nodes.add(node);
    for (const neighbor of adjacency.get(node) ?? [])
      if (!nodes.has(neighbor)) pending.push(neighbor);
  }
  const select = (type: "process" | "model") => {
    const rows = new Map([...directory[type]].filter(([, row]) => nodes.has(`${type}:${row.id}`)));
    const selected = expected.get(type) ?? new Map();
    if (rows.size !== selected.size || [...rows.keys()].some((key) => !selected.has(key)))
      reject(
        `Repair frozen ${type} inventory omits a connected family member or visible historical revision.`,
      );
    for (const row of rows.values()) {
      const references =
        type === "model" ? array(row.process_references) : array(row.flow_references);
      if (
        references.some((value) => {
          const ref = workflowObject(value);
          return (
            (type === "model" || ref.version !== null) &&
            (typeof ref.version !== "string" || !version.test(ref.version))
          );
        })
      )
        reject("A connected family reference has an unresolved exact revision.");
    }
    return [...new Set([...rows.values()].map((row) => String(row.id)))].sort();
  };
  return { process: select("process"), model: select("model"), nodes: nodes.size, heads };
}

/** Two complete compact directory scans prove a bounded family's separation from all visible peers. */
export async function readFoundryRepairCensus(
  workerInput: Row,
  actor: string,
  read: Reader,
  phase: "before" | "after" = "before",
  observe?: (observation: CensusObservation) => void,
) {
  if (!uuid.test(actor)) reject("Repair census requires an explicit actor UUID.");
  const baseline = workflowObject(workerInput.baseline);
  const documents = array(baseline.documents)
    .map(workflowObject)
    .map((item) => ({ ...item }));
  if (phase !== "before" && phase !== "after")
    reject("Repair census observation phase is invalid.");
  if (phase === "after") {
    const changed = new Set<string>();
    for (const raw of array(workerInput.overlays)) {
      const overlay = workflowObject(raw),
        selected = workflowObject(overlay.identity);
      const key = `${String(selected.dataset_type)}:${identity(selected.id, selected.version)}`;
      if (changed.has(key)) reject("Repair census overlays contain duplicate identities.");
      changed.add(key);
      const matches = documents.filter((item) => {
        const current = workflowObject(item.identity);
        return (
          current.dataset_type === selected.dataset_type &&
          identity(current.id, current.version) === identity(selected.id, selected.version)
        );
      });
      if (matches.length !== 1) reject("Repair census overlay must select one frozen document.");
      matches[0].document = overlay.document;
      matches[0].document_sha256 = overlay.candidate_sha256;
    }
  }
  const expected = new Map<DatasetType, Map<string, Row>>();
  for (const item of documents) {
    const selected = workflowObject(item.identity),
      type = selected.dataset_type;
    if (typeof type !== "string" || !Object.hasOwn(tables, type) || type === "model")
      reject("Repair census document type is unsupported.");
    const key = identity(selected.id, selected.version),
      group = expected.get(type as DatasetType) ?? new Map<string, Row>();
    if (group.has(key)) reject("Repair census frozen inventory contains duplicate identities.");
    group.set(key, item);
    expected.set(type as DatasetType, group);
  }
  const models = new Map<string, Row>();
  for (const item of array(baseline.models).map(workflowObject)) {
    const key = identity(item.id, item.version);
    if (models.has(key)) reject("Repair census frozen models contain duplicate identities.");
    models.set(key, item);
  }
  expected.set("model", models);
  let transferredBytes = 0,
    projectionBytes = 0,
    exactBytes = 0,
    readPages = 0;
  const observations: CensusObservation[] = [];
  const query = async (input: FoundryRepairCensusQuery) => {
    const page = await read(input);
    transferredBytes += Buffer.byteLength(page.raw);
    if (transferredBytes > maximumTransferBytes)
      reject("Repair census transfer exceeds its 1 GiB scan bound.");
    const parsed = records(page, input);
    const type = Object.entries(tables).find(
      ([, table]) => table === input.table,
    )![0] as DatasetType;
    const rows = input.projection
      ? parsed.rows.map((row) => directoryRow(type as "process" | "model" | "flow", row))
      : parsed.rows;
    const retained = input.projection ? JSON.stringify(rows) : page.raw;
    if (input.projection) projectionBytes += Buffer.byteLength(retained);
    else exactBytes += Buffer.byteLength(retained);
    if (projectionBytes > maximumBytes || exactBytes > maximumBytes)
      reject(
        "Repair census compact projections or selected family evidence exceed their 64 MiB bound.",
      );
    const observation = {
      query: input,
      page: { ...page, raw: retained },
      response_sha256: createHash("sha256").update(page.raw).digest("hex"),
    };
    readPages++;
    if (observe) observe(observation);
    else observations.push(observation);
    return { rows, total: parsed.total };
  };
  const scan = async (
    type: "process" | "model" | "flow",
    projection: boolean,
    ids?: readonly string[],
  ) => {
    const found = new Map<string, Row>();
    const groups = ids
      ? Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
          ids.slice(index * 100, (index + 1) * 100),
        )
      : [undefined];
    for (const group of groups)
      for (const state of [100, 0] as const) {
        let offset = 0,
          total: number | undefined,
          prior = "";
        do {
          const page = await query({
            table: tables[type],
            ...(group ? { ids: group } : {}),
            ...(projection ? { projection: "dependencies" as const } : {}),
            state,
            ...(state === 0 ? { owner: actor } : {}),
            offset,
            limit: 100,
          });
          if (total !== undefined && page.total !== total)
            reject("Repair census membership count changed during pagination.");
          total = page.total;
          for (const row of page.rows) {
            const key = identity(row.id, row.version);
            if (
              (group && !group.includes(String(row.id).toLowerCase())) ||
              key <= prior ||
              found.has(key) ||
              row.state_code !== state ||
              !visible(row, actor)
            )
              reject("Repair census contains unordered, duplicate or out-of-scope rows.");
            prior = key;
            found.set(key, row);
            if (found.size > maximumRows)
              reject("Repair census combined visibility scope exceeds 100000 rows.");
          }
          offset += page.rows.length;
          if (!page.rows.length && offset < total)
            reject("Repair census stopped before its exact total.");
        } while (offset < total);
      }
    return found;
  };
  const directory = async (): Promise<Directory> => ({
    process: await scan("process", true),
    model: await scan("model", true),
    flow: await scan("flow", true),
  });
  const match = (type: DatasetType, actual: Map<string, Row>) => {
    const selected = expected.get(type) ?? new Map();
    if (actual.size !== selected.size)
      reject(`Repair census ${type} membership differs from the frozen family.`);
    for (const [key, item] of selected) {
      const row = actual.get(key);
      if (
        row &&
        [
          "id",
          "version",
          "user_id",
          "state_code",
          "json",
          ...(type === "process" ? ["model_id", "model_version", "team_id", "review_id"] : []),
        ].some((field) => !Object.hasOwn(row, field))
      )
        reject(
          "Repair census response omitted required content, ownership, state or lineage fields.",
        );
      if (
        !row ||
        !visible(row, actor) ||
        (row.user_id ?? null) !== (item.user_id ?? null) ||
        row.state_code !== item.state_code ||
        sha256Json(row.json) !== sha256Json(item.document)
      )
        reject(`Repair census ${type} content, owner or state changed.`);
      if (
        type === "process" &&
        ["model_id", "model_version", "team_id", "review_id"].some(
          (field) => (row[field] ?? null) !== (item[field] ?? null),
        )
      )
        reject("Repair census Process model lineage or collaboration metadata changed.");
    }
  };
  const supports = async (heads: Map<string, string>) => {
    const result = new Map<string, Row>();
    for (const [type, items] of expected) {
      if (type === "process" || type === "model") continue;
      for (const [key, item] of items) {
        const selected = workflowObject(item.identity);
        const page = await query({
          table: tables[type],
          id: String(selected.id),
          version: String(selected.version),
          offset: 0,
          limit: 1,
        });
        if (
          page.total !== 1 ||
          page.rows.length !== 1 ||
          identity(page.rows[0].id, page.rows[0].version) !== key
        )
          reject("Repair census exact dependency is missing or ambiguous.");
        const row = page.rows[0];
        if (
          ["id", "version", "user_id", "state_code", "json"].some(
            (field) => !Object.hasOwn(row, field),
          )
        )
          reject("Repair census dependency response omitted required fields.");
        const eligible = visible(row, actor) || (type !== "flow" && row.state_code === 200);
        if (
          !eligible ||
          (row.user_id ?? null) !== (item.user_id ?? null) ||
          row.state_code !== item.state_code ||
          sha256Json(row.json) !== sha256Json(item.document)
        )
          reject("Repair census exact dependency content or eligibility changed.");
        result.set(`${type}:${key}`, row);
      }
    }
    for (const flow of array(baseline.omitted_flow_resolutions ?? []).map(workflowObject)) {
      const key = identity(flow.id, flow.version);
      if (
        !expected.get("flow")?.has(key) ||
        heads.get(String(flow.id).toLowerCase()) !== flow.version
      )
        reject("Versionless references must select the latest visible Flow version.");
    }
    return result;
  };
  const firstDirectory = await directory();
  const family = boundedFamily(firstDirectory, expected, workerInput);
  const exact = async () => {
    const result = {
      process: await scan("process", false, family.process),
      model: await scan("model", false, family.model),
    };
    match("process", result.process);
    match("model", result.model);
    return result;
  };
  const first = await exact(),
    firstSupport = await supports(family.heads);
  const secondDirectory = await directory();
  if (directoryDigest(firstDirectory) !== directoryDigest(secondDirectory))
    reject("Repair census changed between its complete directory passes.");
  boundedFamily(secondDirectory, expected, workerInput);
  const second = await exact(),
    secondSupport = await supports(flowHeads(secondDirectory.flow));
  if (
    digest(first.process) !== digest(second.process) ||
    digest(first.model) !== digest(second.model) ||
    digest(firstSupport) !== digest(secondSupport)
  )
    reject("Repair census changed between its complete exact family passes.");
  return {
    proof: {
      schema: "tiangong-foundry.repair-census.v1",
      status: "verified",
      observation_phase: phase,
      input_object_sha256: sha256Json(workerInput),
      scope: "public-state100-plus-current-owner-state0",
      actor_user_id: actor,
      transaction_snapshot: false,
      double_scan: true,
      body_scope: "closed_conservative_family",
      directory_complete: true,
      directory_body_content_observed: false,
      directory_projection_version: "dependency-identities-v1",
      excluded_process_rows: firstDirectory.process.size - first.process.size,
      excluded_model_rows: firstDirectory.model.size - first.model.size,
      family_separation: "all-visible-revisions-shared-technosphere-uuid-and-model-lineage",
      directory_process_rows: firstDirectory.process.size,
      directory_model_rows: firstDirectory.model.size,
      directory_flow_rows: firstDirectory.flow.size,
      directory_sha256: directoryDigest(firstDirectory),
      family_nodes: family.nodes,
      process_rows: first.process.size,
      model_rows: first.model.size,
      exact_support_rows: firstSupport.size,
      process_census_sha256: digest(first.process),
      model_census_sha256: digest(first.model),
      support_census_sha256: digest(firstSupport),
      baseline_sha256: sha256Json(baseline),
      read_pages: readPages,
      transferred_bytes: transferredBytes,
      retained_projection_bytes: projectionBytes,
      exact_family_bytes: exactBytes,
      completed_at_utc: new Date().toISOString(),
    },
    observations,
  };
}

export async function verifyFoundryRepairCensus(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  workerInput: Record<string, unknown>,
  directory: string,
  phase: "before" | "after" = "before",
): Promise<{ proof: Record<string, unknown>; files: string[] }> {
  if (!context.accountIntent) reject("Repair census requires explicit account intent.");
  const actor = await createFoundryEdgeActor(context, qualified, authentication);
  const root = directory;
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  const files: string[] = [];
  const receipt = path.join(root, "identity-receipt.json");
  fs.writeFileSync(receipt, JSON.stringify(actor.receipt, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  files.push(receipt);
  const observed = await readFoundryRepairCensus(
    workerInput,
    context.accountIntent.userId,
    (query) => actor.readDataPage(query),
    phase,
    (observation) => {
      const file = path.join(root, `page-${String(files.length).padStart(6, "0")}.json`);
      fs.writeFileSync(file, JSON.stringify(observation, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      files.push(file);
    },
  );
  const proofValue = { ...observed.proof, project_ref: context.accountIntent.projectRef };
  const proof = path.join(root, "proof.json");
  fs.writeFileSync(proof, JSON.stringify(proofValue, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  files.push(proof);
  return { proof: proofValue, files };
}
