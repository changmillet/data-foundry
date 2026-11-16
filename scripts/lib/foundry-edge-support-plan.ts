import { bundleRowTypes } from "./bundle-row-types.ts";
import { isAbsolute } from "node:path";
import { FoundryContextError, type FoundryInputFact } from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  dataSetInformation,
  datasetRoot,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { collectDatasetReferences } from "./import-curation/internal/workflow-reference-closure.ts";
import {
  edgeReferenceKey,
  readEdgeReferenceSnapshot,
  type EdgeReferenceSnapshot,
} from "./foundry-edge-reference-intent.ts";

const schema = "tiangong-foundry.edge-support-create.v1";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const versionPattern = /^\d{2}\.\d{2}\.\d{3}$/u;
const hash = /^[a-f0-9]{64}$/u;
const referenceTables = [
  "contacts",
  "sources",
  "unitgroups",
  "flowproperties",
  "flows",
  "processes",
  "lifecyclemodels",
  "lciamethods",
];

const edgeDraftTypes = ["unitgroup", "flowproperty", "process", "contact", "source"] as const;
export type EdgeDraftType = (typeof edgeDraftTypes)[number];
export const isFoundryEdgeDraftType = (value: unknown): value is EdgeDraftType =>
  edgeDraftTypes.some((type) => type === value);
export type EdgeSupportTarget = { project_ref: string; user_id: string };
type ExactKey = { table: string; id: string; version: string };
export type EdgeSupportRoot = ExactKey & {
  payload_sha256: string;
  before_sha256?: string;
  references: Array<
    ExactKey & {
      payload_sha256?: string;
      expected_state_code?: number;
      expected_owner?: string | null;
      reviewed_latest?: EdgeReferenceSnapshot;
    }
  >;
};

export type EdgeUpdateBinding = {
  before: FoundryInputFact;
  contract: FoundryInputFact;
  preparation: FoundryInputFact;
  rule_verification: Record<string, boolean>;
};

type EdgeUpdateInput = { binding: EdgeUpdateBinding; rows: unknown[] };

export type EdgeSupportPlan = {
  schema: typeof schema;
  dataset_type: EdgeDraftType;
  input: FoundryInputFact;
  project_ref: string;
  user_id: string;
  state_code: 0;
  roots: EdgeSupportRoot[];
  reference_evidence?: FoundryInputFact;
  reference_intent?: FoundryInputFact[];
  update?: EdgeUpdateBinding;
  sha256: string;
};

function invalid(message: string): never {
  throw new FoundryContextError("edge_support_plan_invalid", message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid("Edge draft plan requires structured objects.");
  return value as Record<string, unknown>;
}

function exactKey(table: unknown, id: unknown, version: unknown): ExactKey {
  if (
    typeof table !== "string" ||
    !referenceTables.includes(table) ||
    typeof id !== "string" ||
    !uuid.test(id) ||
    typeof version !== "string" ||
    !versionPattern.test(version)
  )
    return invalid("Every draft and dependency must select an exact UUID and version.");
  return { table, id, version };
}

function rootsFor(type: EdgeDraftType, rows: unknown[]) {
  if (!rows.length) return invalid("Edge draft plan requires at least one approved dataset row.");
  const seen = new Set<string>();
  const table = bundleRowTypes[type].plural;
  return rows.map((row) => {
    const content = object(unwrapDatasetPayload(row, type));
    const root = datasetRoot(content, type);
    const own = object(object(root.administrativeInformation).publicationAndOwnership);
    const key = exactKey(
      table,
      dataSetInformation(root, type)["common:UUID"],
      own["common:dataSetVersion"],
    );
    const envelope = object(row);
    if (
      (envelope.id !== undefined && envelope.id !== key.id) ||
      (envelope.version !== undefined && envelope.version !== key.version) ||
      seen.has(key.id)
    )
      return invalid("The approved rows contain an ambiguous identity or multiple versions.");
    seen.add(key.id);
    const refs = collectDatasetReferences(content);
    if (type === "flowproperty") {
      const unitGroup = refs.filter((ref) =>
        ref.path.endsWith("/quantitativeReference/referenceToReferenceUnitGroup"),
      );
      if (unitGroup.length !== 1 || unitGroup[0].table !== "unitgroups")
        return invalid("FlowProperty creation requires one exact reference UnitGroup.");
    }
    const references = new Map<string, ExactKey>();
    for (const ref of refs) {
      const exact = exactKey(ref.table, ref.id, ref.version);
      references.set(`${exact.table}:${exact.id}@${exact.version}`, exact);
    }
    return {
      root: { ...key, payload_sha256: sha256Json(content), references: [...references.values()] },
      content,
    };
  });
}

type ReferenceEvidence = { fact: FoundryInputFact; report: unknown };

export function buildEdgeSupportPlan(
  type: EdgeDraftType,
  input: FoundryInputFact,
  target: EdgeSupportTarget,
  rows: unknown[],
  evidence?: ReferenceEvidence,
  update?: EdgeUpdateInput,
): EdgeSupportPlan {
  if (
    !isAbsolute(input.path) ||
    !hash.test(input.sha256) ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1
  )
    return invalid("The Edge draft plan requires exact approved input bytes.");
  if (!target.project_ref || !uuid.test(target.user_id))
    return invalid("The Edge draft plan requires an exact project and owner.");
  const documents = rootsFor(type, rows);
  const payload: Omit<EdgeSupportPlan, "sha256"> = {
    schema,
    dataset_type: type,
    input,
    project_ref: target.project_ref,
    user_id: target.user_id,
    state_code: 0 as const,
    roots: documents.map(({ root }) => root),
  };
  if (evidence) {
    const report = object(evidence.report);
    if (
      report.schema !== "tiangong-foundry.edge-support-precommit.v1" ||
      report.status !== "passed_remote_verification" ||
      report.input_path !== input.path ||
      report.edge_plan_sha256 !== sha256Json(payload) ||
      !Array.isArray(report.checks)
    )
      return invalid("Reference evidence must verify all dependencies for these final rows.");
    const checks = report.checks.map(object);
    const reviewed = new Map<
      string,
      { selected: EdgeReferenceSnapshot; latest: EdgeReferenceSnapshot }
    >();
    if (report.reference_intent) {
      const intent = object(report.reference_intent);
      if (
        !Array.isArray(intent.references) ||
        !intent.references.length ||
        !Array.isArray(intent.review_files) ||
        !intent.review_files.length
      )
        return invalid("Explicit reference intent requires the selected review artifacts.");
      for (const raw of intent.references) {
        const reference = object(raw);
        const selected = readEdgeReferenceSnapshot(reference.selected, target.user_id);
        const latest = readEdgeReferenceSnapshot(object(reference.review).latest, target.user_id);
        reviewed.set(edgeReferenceKey(selected), { selected, latest });
      }
      payload.reference_intent = [intent.file, ...intent.review_files].map((raw) => {
        const fact = object(raw);
        if (
          typeof fact.path !== "string" ||
          !isAbsolute(fact.path) ||
          typeof fact.sha256 !== "string" ||
          !hash.test(fact.sha256) ||
          typeof fact.bytes !== "number" ||
          !Number.isSafeInteger(fact.bytes) ||
          fact.bytes < 1
        )
          return invalid("Explicit reference artifacts require exact file facts.");
        return { path: fact.path, sha256: fact.sha256, bytes: fact.bytes };
      });
    }
    for (const root of payload.roots) {
      root.references = root.references.map((reference) => {
        const selected = checks.filter(
          (check) =>
            check.table === reference.table &&
            check.id === reference.id &&
            check.version === reference.version,
        );
        const check = selected[0];
        const review = reviewed.get(edgeReferenceKey(reference));
        if (
          selected.length !== 1 ||
          check.role !== "reference" ||
          check.status !== "ok" ||
          typeof check.remote_payload_sha256 !== "string" ||
          !hash.test(check.remote_payload_sha256) ||
          !(
            [100, 200].includes(Number(check.remote_state_code)) ||
            (check.remote_state_code === 0 && check.remote_user_id === target.user_id)
          )
        )
          return invalid("A sealed draft dependency lacks exact owner and content evidence.");
        if (
          review &&
          (sha256Json(check.reviewed_latest) !== sha256Json(review.latest) ||
            check.remote_payload_sha256 !== review.selected.payload_sha256 ||
            check.remote_state_code !== review.selected.state_code ||
            check.remote_user_id !== review.selected.user_id)
        )
          return invalid(
            "Reviewed dependency evidence differs from the selected and latest snapshots.",
          );
        return {
          ...reference,
          payload_sha256: check.remote_payload_sha256,
          expected_state_code: Number(check.remote_state_code),
          expected_owner: typeof check.remote_user_id === "string" ? check.remote_user_id : null,
          ...(review ? { reviewed_latest: review.latest } : {}),
        };
      });
    }
    payload.reference_evidence = evidence.fact;
  }
  if (update) {
    if (type !== "process") return invalid("Guarded Edge updates require a Process repair scope.");
    const before = beforeFor(documents, update.rows);
    payload.roots.forEach((root, index) => {
      root.before_sha256 = sha256Json(before[index].content);
      if (typeof update.binding.rule_verification[root.payload_sha256] !== "boolean")
        invalid("Every update must preserve its approved validation result.");
    });
    if (payload.roots.every((root) => root.before_sha256 === root.payload_sha256))
      return invalid("An unchanged draft does not require a guarded update.");
    payload.update = update.binding;
  }
  return { ...payload, sha256: sha256Json(payload) };
}

function beforeFor(documents: ReturnType<typeof rootsFor>, rows: unknown[]) {
  const previous = rootsFor("process", rows);
  if (previous.length !== documents.length)
    return invalid("Guarded update requires one before document for every exact target.");
  const occurrences = (content: unknown) =>
    collectDatasetReferences(content)
      .map(({ table, id, version, path }) => sha256Json({ table, id, version, path }))
      .sort();
  return documents.map(({ root, content }) => {
    const selected = previous.find(
      (item) => item.root.id === root.id && item.root.version === root.version,
    );
    if (!selected || sha256Json(occurrences(selected.content)) !== sha256Json(occurrences(content)))
      return invalid(
        "Before and desired draft references must select the same exact dependencies.",
      );
    return selected;
  });
}

export function isEdgeSupportPlan(value: unknown): value is EdgeSupportPlan {
  if (!value || typeof value !== "object" || !("schema" in value)) return false;
  return value.schema === schema;
}

export function verifyEdgeSupportPlan(
  plan: EdgeSupportPlan,
  approved: FoundryInputFact,
  target: EdgeSupportTarget,
  rows: unknown[],
  evidence?: ReferenceEvidence,
  update?: EdgeUpdateInput,
) {
  if (!evidence || !plan.reference_evidence)
    return invalid("Edge draft execution requires sealed exact dependency evidence.");
  if (!isFoundryEdgeDraftType(plan.dataset_type))
    return invalid("Edge creation requires a supported dataset scope.");
  const current = buildEdgeSupportPlan(plan.dataset_type, approved, target, rows, evidence, update);
  if (sha256Json(current) !== sha256Json(plan))
    return invalid("The sealed Edge draft plan disagrees with the task approval or final rows.");
  const documents = rootsFor(plan.dataset_type, rows);
  const before = update && beforeFor(documents, update.rows);
  return documents.map((item, index) => ({
    ...item,
    ...(before ? { beforeContent: before[index].content } : {}),
  }));
}
