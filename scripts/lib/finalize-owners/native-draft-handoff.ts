import fs from "node:fs";
import path from "node:path";
import { createFileArtifactFact } from "../foundry-command-spec.ts";
import { sha256Json, sha256Text } from "../identity-preflight-proof.ts";
import { datasetIdentity } from "../import-curation/internal/dataset-payload.ts";
import { readRows } from "../import-curation/internal/runtime-io.ts";

type JsonRecord = Record<string, unknown>;

export type NativeDraftOperation = "insert" | "save_draft";

export type NativeDraftContractOperation = NativeDraftOperation | "mixed";

const BEFORE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function fail(message: string): never {
  throw new Error(`--execution-contract-file: ${message}`);
}

function object(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("Expected a native contract object.");
  return value as JsonRecord;
}

function token(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    return fail("Contract identity fields must be non-empty strings.");
  return value.trim();
}

/**
 * One action binds exactly one draft operation: an absent row inserts, an existing owner draft
 * updates in place with its complete before hash. The CLI execution contract applies the same
 * rule, so a contract that contradicts itself never reaches admission.
 */
function draftOperationBinding(
  operation: unknown,
  beforeSha256: unknown,
): { expected_operation: NativeDraftOperation; before_sha256: string | null } | null {
  if (operation === "insert" && beforeSha256 === null)
    return { expected_operation: "insert", before_sha256: null };
  if (
    operation === "save_draft" &&
    typeof beforeSha256 === "string" &&
    BEFORE_SHA256_PATTERN.test(beforeSha256)
  )
    return { expected_operation: "save_draft", before_sha256: beforeSha256 };
  return null;
}

export function assertExecutionContractSelection(options: JsonRecord): void {
  if (
    Object.keys(options).some(
      (key) => key.startsWith("executionContract") && key !== "executionContractFile",
    ) ||
    (Object.hasOwn(options, "executionContractFile") &&
      (typeof options.executionContractFile !== "string" ||
        options.executionContractFile.trim().length === 0))
  )
    fail("Use one non-empty string selection; unsupported options or repeated values are invalid.");
}

/** Consumer admission only; CLI owns parsing at execution, attempts and readback. */
export function readNativeDraftHandoff(input: {
  contractFile: string;
  rowsFile: string;
  datasetType: string;
  targetUserId: string;
  verifiedProjectRef: string;
  stateCode: string;
  relativePath: (file: string) => string;
}) {
  const tables: Record<string, string> = { flow: "flows", process: "processes", source: "sources" };
  if (!Object.hasOwn(tables, input.datasetType) || input.stateCode !== "0")
    fail("Native draft handoffs support only Flow, Process and Source owner drafts.");
  if (!fs.lstatSync(input.contractFile).isFile()) fail("Select a regular contract file.");
  const bytes = fs.readFileSync(input.contractFile, "utf8");
  const raw = object(JSON.parse(bytes));
  const owner = object(raw.owner);
  if (
    raw.schema_version !== "dataset-save-draft-execution-contract.v1" ||
    raw.target_mode !== "owner_draft" ||
    owner.state_code !== 0 ||
    token(owner.user_id) !== input.targetUserId
  )
    fail("Contract protocol, owner or draft scope does not match the handoff.");
  const projectRef = token(raw.project_ref);
  if (input.verifiedProjectRef && projectRef !== input.verifiedProjectRef)
    fail("Contract project does not match the verified account context.");
  const rowsText = fs.readFileSync(input.rowsFile, "utf8");
  const rows = readRows(input.rowsFile, () => rowsText);
  if (!Array.isArray(raw.actions) || !rows.length || raw.actions.length !== rows.length)
    fail("Contract actions must match every selected final row exactly once.");
  const actionIds = new Set<string>();
  const targets = new Set<string>();
  const actions = raw.actions.map((value: unknown, index: number) => {
    const action = object(value);
    const actionId = token(action.action_id);
    const identity = datasetIdentity(rows[index], index, input.datasetType);
    const root = object(object(identity.payload)[`${input.datasetType}DataSet`]);
    const info = object(object(root[`${input.datasetType}Information`]).dataSetInformation);
    const publication = object(object(root.administrativeInformation).publicationAndOwnership);
    const id = token(info["common:UUID"]);
    const version = token(publication["common:dataSetVersion"]);
    const target = JSON.stringify([id, version]);
    const operation = draftOperationBinding(action.expected_operation, action.before_sha256);
    if (
      actionIds.has(actionId) ||
      targets.has(target) ||
      !operation ||
      action.table !== tables[input.datasetType] ||
      token(action.id) !== id ||
      token(action.version) !== version ||
      identity.id !== id ||
      identity.version !== version ||
      action.desired_sha256 !== sha256Json(identity.payload)
    )
      fail("Contract action does not bind the exact final payload, identity and draft operation.");
    if (!Array.isArray(action.dependency_action_ids)) fail("Action dependencies must be explicit.");
    const dependencies = action.dependency_action_ids.map(token);
    if (
      new Set(dependencies).size !== dependencies.length ||
      dependencies.some((id) => !actionIds.has(id))
    )
      fail("Dependencies must identify unique earlier contract actions.");
    actionIds.add(actionId);
    targets.add(target);
    // Project the native owner's normalized wire fields for its report digest. The action keeps
    // the CLI execution contract's exact eight keys so both sides hash the same object shape.
    return {
      action_id: actionId,
      desired_sha256: action.desired_sha256,
      expected_operation: operation.expected_operation,
      table: tables[input.datasetType],
      id,
      version,
      before_sha256: operation.before_sha256,
      dependency_action_ids: dependencies,
    };
  });
  // Raw file bytes are bound separately, so ignored metadata cannot drift. The operation label is
  // derived from the hashed actions only: one operation keeps its name, both become "mixed".
  const operations = [...new Set(actions.map((action) => action.expected_operation))];
  const operation: NativeDraftContractOperation = operations.length === 1 ? operations[0] : "mixed";
  const contract = {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: token(raw.execution_id),
    project_ref: projectRef,
    target_mode: "owner_draft",
    owner: {
      user_id: token(owner.user_id),
      email: token(owner.email).toLowerCase(),
      state_code: 0,
    },
    actions,
  };
  const artifact = createFileArtifactFact({
    role: "execution_contract",
    path: input.relativePath(input.contractFile),
    filePath: input.contractFile,
  });
  if (artifact.sha256 !== sha256Text(bytes)) fail("Contract bytes changed during admission.");
  return {
    artifact,
    contract,
    canonical_sha256: sha256Json(contract),
    metadata: {
      artifact,
      canonical_sha256: sha256Json(contract),
      execution_id: contract.execution_id,
      project_ref: contract.project_ref,
      operation,
    },
    rows_sha256: sha256Text(rowsText),
  };
}

export function reserveNativeHandoffDirectory(directory: string): void {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
}

export function nativeDraftCommitArguments(
  prefix: readonly string[],
  datasetType: string,
  rowsFile: string,
  outDir: string,
  contractFile: string,
): string[] {
  return [
    ...prefix,
    "dataset",
    "save-draft",
    "--type",
    datasetType,
    "--input",
    rowsFile,
    "--out-dir",
    path.join(outDir, "commit", `${datasetType}-save-draft`),
    "--execution-contract",
    contractFile,
    "--commit",
    "--json",
  ];
}
