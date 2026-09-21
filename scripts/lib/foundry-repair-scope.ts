import fs from "node:fs";
import { FoundryContextError } from "./foundry-runtime-context.ts";
import { sha256Json, sha256Text } from "./identity-preflight-proof.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { readNativeDraftHandoff } from "./finalize-owners/native-draft-handoff.ts";

type JsonRecord = Record<string, unknown>;

/** Phase 1 admits only Process, and only the two reviewed administrative display-text regions. */
export const FOUNDRY_REPAIR_SELECTION_KIND = "existing-owner-draft-metadata" as const;
export const FOUNDRY_REPAIR_ALLOWED_DATASET_TYPE = "process" as const;

export const FOUNDRY_REPAIR_EDIT_PATHS = Object.freeze([
  "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness" +
    ".referenceToDataSource.*.common:shortDescription.*.#text",
  "processDataSet.administrativeInformation.publicationAndOwnership" +
    ".common:referenceToOwnershipOfDataSet.*.common:shortDescription.*.#text",
] as const);

/**
 * A repair touching any of these surfaces can change provider selection or scientific content, so it
 * requires a content-bound provider-impact diagnostic that this repository does not produce yet.
 */
export const FOUNDRY_REPAIR_SHARED_SCIENCE_PREFIXES = Object.freeze([
  "processDataSet.exchanges",
  "processDataSet.quantitativeReference",
  "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume",
  "processDataSet.modellingAndValidation.LCIMethod",
  "processDataSet.processInformation.dataSetInformation.name",
  "processDataSet.processInformation.dataSetInformation.classificationInformation",
  "processDataSet.processInformation.dataSetInformation.common:other",
  "processDataSet.processInformation.geography",
  "processDataSet.administrativeInformation.publicationAndOwnership.common:dataSetVersion",
  "flowDataSet",
  "flowPropertyDataSet",
  "unitGroupDataSet",
] as const);

export interface FoundryRepairSelection {
  readonly kind: typeof FOUNDRY_REPAIR_SELECTION_KIND;
  readonly contract: string;
  readonly before: string;
  readonly candidate: string;
  readonly predecessor: Readonly<{ task_id: string; receipt_sha256: string }> | null;
}

export interface FoundryRepairDiffBlocker {
  readonly path: string;
  readonly reason: "provider_impact_diagnostics_missing" | "unsupported_path" | "structure_change";
}

export interface FoundryRepairScope {
  readonly kind: typeof FOUNDRY_REPAIR_SELECTION_KIND;
  readonly status: "dispatchable" | "satisfied";
  readonly contract_sha256: string;
  readonly rows_sha256: string;
  readonly changed_paths: readonly string[];
  readonly actions: readonly {
    readonly action_id: string;
    readonly table: string;
    readonly id: string;
    readonly version: string;
    readonly before_sha256: string;
    readonly desired_sha256: string;
  }[];
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const shaPattern = /^[0-9a-f]{64}$/u;
const blankTextSentinel = "FoundryRepairBlankLanguageText";
const dataSourcePath = [
  "processDataSet",
  "modellingAndValidation",
  "dataSourcesTreatmentAndRepresentativeness",
] as const;
const ownershipPath = [
  "processDataSet",
  "administrativeInformation",
  "publicationAndOwnership",
] as const;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, code: string, label: string): JsonRecord {
  if (!isRecord(value)) fail(code, `${label} must be an object.`);
  return value;
}

function exact(value: JsonRecord, keys: readonly string[], code: string, label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail(code, `${label} has missing or unsupported fields.`);
}

function nonEmptyText(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || !value.trim())
    fail(code, `${label} must be a non-empty string.`);
  return value.trim();
}

function selectionPath(value: unknown, code: string, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4_096 ||
    /[\0\r\n]/u.test(value) ||
    /^\.env(?:\.|$)/iu.test(value.split(/[\\/]/u).pop() ?? "")
  )
    fail(code, `${label} must be a bounded non-credential file path.`);
  return value;
}

/** Parse the optional repair selection of a task-start spec against the independently selected sources. */
export function parseFoundryRepairSelection(
  value: unknown,
  sources: readonly { readonly path: string }[],
  resolveSelection: (file: string) => string = (file) => file,
): Readonly<FoundryRepairSelection> {
  const item = record(value, "task_spec_repair_invalid", "Repair selection");
  exact(
    item,
    ["kind", "contract", "before", "candidate", "predecessor"],
    "task_spec_repair_invalid",
    "Repair selection",
  );
  if (item.kind !== FOUNDRY_REPAIR_SELECTION_KIND)
    fail("task_spec_repair_invalid", "Repair selection kind is unsupported.");
  const contract = resolveSelection(
    selectionPath(item.contract, "task_spec_repair_invalid", "Repair contract"),
  );
  const before = resolveSelection(
    selectionPath(item.before, "task_spec_repair_invalid", "Repair before rows"),
  );
  const candidate = resolveSelection(
    selectionPath(item.candidate, "task_spec_repair_invalid", "Repair candidate rows"),
  );
  if (new Set([contract, before, candidate]).size !== 3)
    fail("task_spec_repair_invalid", "Repair selections must name three distinct files.");
  for (const selected of [contract, before, candidate])
    if (!sources.some((source) => source.path === selected))
      fail(
        "task_spec_repair_invalid",
        "Repair contract, before rows and candidate rows must each be independently selected sources.",
      );
  let predecessor: Readonly<{ task_id: string; receipt_sha256: string }> | null = null;
  if (item.predecessor !== null) {
    const bound = record(item.predecessor, "task_spec_repair_invalid", "Repair predecessor");
    exact(bound, ["task_id", "receipt_sha256"], "task_spec_repair_invalid", "Repair predecessor");
    const taskId = nonEmptyText(bound.task_id, "task_spec_repair_invalid", "Predecessor task id");
    const receipt = nonEmptyText(
      bound.receipt_sha256,
      "task_spec_repair_invalid",
      "Predecessor receipt hash",
    );
    if (!idPattern.test(taskId) || !shaPattern.test(receipt))
      fail("task_spec_repair_invalid", "Repair predecessor binding is malformed.");
    predecessor = Object.freeze({ task_id: taskId, receipt_sha256: receipt });
  }
  return Object.freeze({
    kind: FOUNDRY_REPAIR_SELECTION_KIND,
    contract,
    before,
    candidate,
    predecessor,
  });
}

function navigate(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return current ?? null;
}

/**
 * Replace every allowlisted language-node `#text` with one sentinel in a clone of the payload, so that
 * a structure-preserving text-only edit of those nodes disappears while every other difference -
 * values, structure, node count and order, language tags, ids and URIs - survives the canonical hash.
 */
export function blankRepairEditableText(payload: JsonRecord): JsonRecord {
  const copy = structuredClone(payload);
  const description = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(description);
    return isRecord(value) && typeof value["#text"] === "string"
      ? { ...value, "#text": blankTextSentinel }
      : value;
  };
  const reference = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reference);
    return isRecord(value) && Object.hasOwn(value, "common:shortDescription")
      ? { ...value, "common:shortDescription": description(value["common:shortDescription"]) }
      : value;
  };
  for (const [regionPath, key] of [
    [dataSourcePath, "referenceToDataSource"],
    [ownershipPath, "common:referenceToOwnershipOfDataSet"],
  ] as const) {
    const holder = navigate(copy, regionPath);
    if (!isRecord(holder)) continue;
    if (Object.hasOwn(holder, key)) holder[key] = reference(holder[key]);
  }
  return copy;
}

/** Collect every leaf path where two payloads differ. Values are never included. */
export function collectRepairChangedPaths(before: unknown, after: unknown): string[] {
  const changed: string[] = [];
  const walk = (left: unknown, right: unknown, path: string[]): void => {
    if (changed.length > 2_000) return;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) {
        changed.push(path.join("."));
        return;
      }
      const leftItems = Array.isArray(left) ? left : [];
      const rightItems = Array.isArray(right) ? right : [];
      if (leftItems.length !== rightItems.length) {
        changed.push([...path, "<length>"].join("."));
        return;
      }
      leftItems.forEach((item, index) => walk(item, rightItems[index], [...path, String(index)]));
      return;
    }
    if (isRecord(left) || isRecord(right)) {
      if (!isRecord(left) || !isRecord(right)) {
        changed.push(path.join("."));
        return;
      }
      const leftRecord = isRecord(left) ? left : {};
      const rightRecord = isRecord(right) ? right : {};
      const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
      for (const key of keys)
        if (!Object.hasOwn(leftRecord, key) || !Object.hasOwn(rightRecord, key))
          changed.push([...path, key].join("."));
        else walk(leftRecord[key], rightRecord[key], [...path, key]);
      return;
    }
    if (sha256Json(left ?? null) !== sha256Json(right ?? null)) changed.push(path.join("."));
  };
  walk(before, after, []);
  return changed;
}

function isSharedSciencePath(path: string): boolean {
  return FOUNDRY_REPAIR_SHARED_SCIENCE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Decide whether a before/candidate payload pair stays inside the phase-1 metadata allowlist: only the
 * existing language nodes' `#text` inside the two reviewed regions may change. Everything else blocks,
 * and a shared-science change reports the missing provider-impact diagnostic instead.
 */
export function classifyRepairMetadataDiff(
  before: JsonRecord,
  after: JsonRecord,
): { readonly allowed: boolean; readonly blockers: readonly FoundryRepairDiffBlocker[] } {
  const changedPaths = collectRepairChangedPaths(before, after);
  if (!changedPaths.length) return { allowed: true, blockers: [] };
  const structurePreserved =
    sha256Json(blankRepairEditableText(before)) === sha256Json(blankRepairEditableText(after));
  if (structurePreserved) return { allowed: true, blockers: [] };
  const blockers = changedPaths.map((path) => ({
    path,
    reason: (isSharedSciencePath(path)
      ? "provider_impact_diagnostics_missing"
      : "unsupported_path") as FoundryRepairDiffBlocker["reason"],
  }));
  return blockers.length
    ? { allowed: false, blockers }
    : { allowed: false, blockers: [{ path: "<unclassified>", reason: "structure_change" }] };
}

/**
 * Validate one repair task: the CLI execution contract, the CLI-fresh before rows and the candidate rows
 * must agree on the exact same Process identities, every action must be a save_draft against an existing
 * row, and the whole diff must stay inside the metadata allowlist. Nothing is dispatched here.
 */
export function readFoundryRepairScope(input: {
  contractFile: string;
  beforeFile: string;
  candidateFile: string;
  datasetType: string;
  targetUserId: string;
  verifiedProjectRef: string;
  stateCode: string;
  relativePath: (file: string) => string;
}): Readonly<FoundryRepairScope> {
  if (input.datasetType !== FOUNDRY_REPAIR_ALLOWED_DATASET_TYPE)
    fail(
      "repair_scope_unsupported",
      "Phase 1 admits only Process owner-draft metadata repair; other dataset types stay blocked.",
    );
  if (input.stateCode !== "0")
    fail("repair_scope_unsupported", "Repair admits only state_code=0 owner drafts.");
  const native = readNativeDraftHandoff({
    contractFile: input.contractFile,
    rowsFile: input.candidateFile,
    datasetType: input.datasetType,
    targetUserId: input.targetUserId,
    verifiedProjectRef: input.verifiedProjectRef,
    stateCode: input.stateCode,
    relativePath: input.relativePath,
  });
  for (const action of native.contract.actions)
    if (action.expected_operation !== "save_draft" || !action.before_sha256)
      fail(
        "repair_insert_not_allowed",
        "Repair actions must be save_draft against an existing owner draft; insert is never allowed.",
      );
  const payloadsOf = (file: string, expectedBytesSha256?: string): Map<string, JsonRecord> => {
    const text = fs.readFileSync(file, "utf8");
    if (expectedBytesSha256 && sha256Text(text) !== expectedBytesSha256)
      fail(
        "repair_candidate_changed",
        "Candidate bytes changed between contract admission and metadata comparison.",
      );
    const rows = readRows(file, () => text);
    const byIdentity = new Map<string, JsonRecord>();
    rows.forEach((row, index) => {
      const identity = datasetIdentity(row, index, input.datasetType);
      const key = JSON.stringify([identity.id, identity.version]);
      if (byIdentity.has(key))
        fail("repair_scope_identity_mismatch", "Repair rows contain duplicate dataset identities.");
      byIdentity.set(key, identity.payload as JsonRecord);
    });
    return byIdentity;
  };
  const beforeByIdentity = payloadsOf(input.beforeFile);
  const candidateByIdentity = payloadsOf(input.candidateFile, native.rows_sha256);
  if (
    beforeByIdentity.size !== candidateByIdentity.size ||
    [...beforeByIdentity.keys()].some((key) => !candidateByIdentity.has(key))
  )
    fail(
      "repair_scope_identity_mismatch",
      "Repair candidate rows must cover exactly the selected before identities; versions are never minted.",
    );
  const changedPaths: string[] = [];
  const actions: FoundryRepairScope["actions"] = native.contract.actions.map((action) => {
    const key = JSON.stringify([action.id, action.version]);
    const beforePayload = beforeByIdentity.get(key);
    if (!beforePayload)
      fail(
        "repair_scope_identity_mismatch",
        "Every repair action must name an existing draft present in the selected before rows.",
      );
    if (sha256Json(beforePayload) !== action.before_sha256)
      fail(
        "repair_before_content_mismatch",
        "The contract before hash must equal the canonical hash of the selected before payload.",
      );
    const candidatePayload = candidateByIdentity.get(key)!;
    if (sha256Json(candidatePayload) === sha256Json(beforePayload))
      return {
        action_id: action.action_id,
        table: action.table,
        id: action.id,
        version: action.version,
        before_sha256: action.before_sha256,
        desired_sha256: action.desired_sha256,
      };
    const changed = collectRepairChangedPaths(beforePayload, candidatePayload);
    const verdict = classifyRepairMetadataDiff(beforePayload, candidatePayload);
    if (!verdict.allowed) {
      fail(
        verdict.blockers.some((blocker) => blocker.reason === "provider_impact_diagnostics_missing")
          ? "repair_provider_impact_diagnostics_missing"
          : "repair_metadata_scope_blocked",
        `Repair diff is outside the phase-1 metadata allowlist: ${verdict.blockers
          .slice(0, 8)
          .map((item) => item.path)
          .join(", ")}`,
      );
    }
    changedPaths.push(...changed);
    return {
      action_id: action.action_id,
      table: action.table,
      id: action.id,
      version: action.version,
      before_sha256: action.before_sha256,
      desired_sha256: action.desired_sha256,
    };
  });
  return Object.freeze({
    kind: FOUNDRY_REPAIR_SELECTION_KIND,
    status: changedPaths.length ? ("dispatchable" as const) : ("satisfied" as const),
    contract_sha256: native.canonical_sha256,
    rows_sha256: native.rows_sha256,
    changed_paths: Object.freeze(changedPaths),
    actions: Object.freeze(actions),
  });
}
