import path from "node:path";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryInputPath,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { EdgeDraftType, EdgeSupportTarget } from "./foundry-edge-support-plan.ts";
import { bundleRowTypes } from "./bundle-row-types.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { collectDatasetReferences } from "./import-curation/internal/workflow-reference-closure.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const version = /^\d{2}\.\d{2}\.\d{3}$/u;
const digest = /^[0-9a-f]{64}$/u;
const maximumFileBytes = 8 * 1024 * 1024;
export type EdgeReferenceSnapshot = {
  table: string;
  id: string;
  version: string;
  payload_sha256: string;
  user_id: string;
  state_code: 0 | 100;
};
export function edgeReferenceKey(reference: { table: string; id: string; version: string }) {
  return `${reference.table}:${reference.id}@${reference.version}`;
}

function requireIntent(value: unknown, message: string): asserts value {
  if (!value) throw new FoundryContextError("edge_reference_intent_invalid", message);
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  requireIntent(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "Reference intent or review contains missing or unsupported fields.",
  );
  return value as Record<string, unknown>;
}

export function readEdgeReferenceSnapshot(value: unknown, actor: string): EdgeReferenceSnapshot {
  const snapshot = record(value, [
    "table",
    "id",
    "version",
    "payload_sha256",
    "user_id",
    "state_code",
  ]);
  requireIntent(
    typeof snapshot.table === "string" &&
      typeof snapshot.id === "string" &&
      uuid.test(snapshot.id) &&
      typeof snapshot.version === "string" &&
      version.test(snapshot.version) &&
      typeof snapshot.payload_sha256 === "string" &&
      digest.test(snapshot.payload_sha256) &&
      typeof snapshot.user_id === "string" &&
      uuid.test(snapshot.user_id) &&
      (snapshot.state_code === 100 ||
        (snapshot.state_code === 0 && snapshot.user_id.toLowerCase() === actor)),
    "A reviewed reference must select exact content of a public version or own draft.",
  );
  return {
    table: snapshot.table,
    id: snapshot.id.toLowerCase(),
    version: snapshot.version,
    payload_sha256: snapshot.payload_sha256,
    user_id: snapshot.user_id.toLowerCase(),
    state_code: snapshot.state_code,
  };
}

export function readEdgeReferenceIntent(
  context: FoundryRuntimeContext,
  input: string,
  type: EdgeDraftType,
  target: EdgeSupportTarget,
  rows: unknown[],
) {
  const read = (inputPath: string) => {
    const selected = resolveFoundryInputPath(context, inputPath);
    const bytes = readFoundryInput(context, selected, maximumFileBytes);
    const fact = context.inputs.find((item) => item.path === selected)!;
    const file = { path: fact.path, sha256: fact.sha256, bytes: fact.bytes };
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return { file, value };
    } catch {
      throw new FoundryContextError(
        "edge_reference_intent_invalid",
        "Reference evidence must be UTF-8 JSON.",
      );
    }
  };
  const { file, value } = read(input);
  const intent = record(value, [
    "schema_version",
    "project_ref",
    "actor_user_id",
    "consumers",
    "references",
  ]);
  const identities = rows.map((row, index) => datasetIdentity(row, index, type));
  const consumers = identities.map(({ id, version, payload }, row_index) => ({
    row_index,
    table: bundleRowTypes[type].plural,
    id,
    version,
    payload_sha256: sha256Json(payload),
  }));
  requireIntent(
    intent.schema_version === "dataset-exact-reference-intent.v1" &&
      /^[a-z0-9]{20}$/u.test(target.project_ref) &&
      intent.project_ref === target.project_ref &&
      typeof intent.actor_user_id === "string" &&
      intent.actor_user_id.toLowerCase() === target.user_id &&
      consumers.length > 0 &&
      Array.isArray(intent.consumers) &&
      sha256Json(
        intent.consumers.map((raw) => {
          const row = record(raw, ["row_index", "table", "id", "version", "payload_sha256"]);
          requireIntent(
            typeof row.id === "string" && uuid.test(row.id),
            "Reference consumer UUID is invalid.",
          );
          return { ...row, id: row.id.toLowerCase() };
        }),
      ) === sha256Json(consumers) &&
      Array.isArray(intent.references) &&
      intent.references.length > 0 &&
      intent.references.length <= 10000,
    "Reference intent must bind the verified actor and every exact final consumer in order.",
  );
  const occurrences = identities.map(({ payload }) => collectDatasetReferences(payload));
  const selectedOccurrences = new Set<string>();
  const reviewFiles = new Map<string, { file: FoundryInputFact; value: unknown }>();
  const reviewed = new Map<
    string,
    { selected: EdgeReferenceSnapshot; latest: EdgeReferenceSnapshot }
  >();
  let bytes = file.bytes;
  const references = intent.references.map((raw) => {
    const entry = record(raw, ["row_index", "path", "selected", "review"]);
    const selected = readEdgeReferenceSnapshot(entry.selected, target.user_id);
    const row_index = Number(entry.row_index);
    const pointer = entry.path;
    const occurrence = `${row_index}:${String(pointer)}`;
    requireIntent(
      typeof entry.row_index === "number" &&
        Number.isInteger(row_index) &&
        typeof pointer === "string" &&
        pointer.startsWith("/") &&
        pointer.trim() === pointer &&
        !selectedOccurrences.has(occurrence) &&
        occurrences[row_index]?.filter(
          (ref) =>
            ref.path === pointer &&
            ref.table === selected.table &&
            ref.id === selected.id &&
            ref.version === selected.version,
        ).length === 1,
      "Review must identify one unchanged exact occurrence in the selected consumer.",
    );
    selectedOccurrences.add(occurrence);
    const locator = record(entry.review, ["file", "sha256"]);
    requireIntent(
      typeof locator.file === "string" &&
        locator.file.length > 0 &&
        locator.file.trim() === locator.file &&
        !/[\0\r\n]/u.test(locator.file),
      "Review locator must preserve its exact file spelling.",
    );
    const reviewPath = resolveFoundryInputPath(
      context,
      path.resolve(path.dirname(file.path), locator.file),
    );
    let review = reviewFiles.get(reviewPath);
    if (!review) {
      review = read(reviewPath);
      bytes += review.file.bytes;
      requireIntent(bytes <= 64 * 1024 * 1024, "Reference evidence exceeds its content budget.");
      reviewFiles.set(reviewPath, review);
    }
    const declared = record(review.value, [
      "schema_version",
      "decision",
      "reason",
      "selected",
      "latest",
    ]);
    const latest = readEdgeReferenceSnapshot(declared.latest, target.user_id);
    const key = edgeReferenceKey(selected);
    const snapshots = { selected, latest };
    requireIntent(
      locator.sha256 === review.file.sha256 &&
        declared.schema_version === "dataset-exact-reference-review.v1" &&
        declared.decision === "use_selected_exact" &&
        typeof declared.reason === "string" &&
        declared.reason.trim() &&
        declared.reason.length <= 8192 &&
        sha256Json(readEdgeReferenceSnapshot(declared.selected, target.user_id)) ===
          sha256Json(selected) &&
        latest.table === selected.table &&
        latest.id === selected.id &&
        latest.version >= selected.version &&
        (latest.version !== selected.version || sha256Json(latest) === sha256Json(selected)) &&
        (!reviewed.has(key) || sha256Json(reviewed.get(key)) === sha256Json(snapshots)),
      "Review must bind unchanged selected bytes and a consistent reviewed latest version.",
    );
    reviewed.set(key, snapshots);
    return { row_index, path: pointer, selected, review: { file: review.file, latest } };
  });
  // One remote observation covers identical exact dependencies. Every outdated occurrence still
  // requires its own explicit review before that observation can authorize the older version.
  occurrences.forEach((list, index) => {
    for (const ref of list) {
      if (!ref.table) continue;
      const review = reviewed.get(edgeReferenceKey({ ...ref, table: ref.table }));
      requireIntent(
        !review ||
          review.selected.version === review.latest.version ||
          selectedOccurrences.has(`${index}:${ref.path}`),
        "Every occurrence of an outdated exact dependency requires its own explicit review.",
      );
    }
  });
  return {
    binding: {
      file,
      project_ref: target.project_ref,
      actor_user_id: target.user_id,
      consumers,
      references,
      review_files: [...reviewFiles.values()].map((item) => item.file),
    },
    reviewed,
  };
}
