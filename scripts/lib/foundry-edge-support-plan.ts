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

export type EdgeDraftType = "unitgroup" | "flowproperty" | "process";
export const isFoundryEdgeDraftType = (value: unknown): value is EdgeDraftType =>
  value === "unitgroup" || value === "flowproperty" || value === "process";
export type EdgeSupportTarget = { project_ref: string; user_id: string };
type ExactKey = { table: string; id: string; version: string };
export type EdgeSupportRoot = ExactKey & {
  payload_sha256: string;
  references: Array<
    ExactKey & {
      payload_sha256?: string;
      expected_state_code?: number;
      expected_owner?: string | null;
    }
  >;
};

export type EdgeSupportPlan = {
  schema: typeof schema;
  dataset_type: EdgeDraftType;
  input: FoundryInputFact;
  project_ref: string;
  user_id: string;
  state_code: 0;
  roots: EdgeSupportRoot[];
  reference_evidence?: FoundryInputFact;
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
  const payload: Omit<EdgeSupportPlan, "sha256"> = {
    schema,
    dataset_type: type,
    input,
    project_ref: target.project_ref,
    user_id: target.user_id,
    state_code: 0 as const,
    roots: rootsFor(type, rows).map(({ root }) => root),
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
    for (const root of payload.roots) {
      root.references = root.references.map((reference) => {
        const selected = checks.filter(
          (check) =>
            check.table === reference.table &&
            check.id === reference.id &&
            check.version === reference.version,
        );
        const check = selected[0];
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
        return {
          ...reference,
          payload_sha256: check.remote_payload_sha256,
          expected_state_code: Number(check.remote_state_code),
          expected_owner: typeof check.remote_user_id === "string" ? check.remote_user_id : null,
        };
      });
    }
    payload.reference_evidence = evidence.fact;
  }
  return { ...payload, sha256: sha256Json(payload) };
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
) {
  if (!evidence || !plan.reference_evidence)
    return invalid("Edge draft execution requires sealed exact dependency evidence.");
  if (!isFoundryEdgeDraftType(plan.dataset_type))
    return invalid("Edge creation requires a supported dataset scope.");
  const current = buildEdgeSupportPlan(plan.dataset_type, approved, target, rows, evidence);
  if (sha256Json(current) !== sha256Json(plan))
    return invalid("The sealed Edge draft plan disagrees with the task approval or final rows.");
  return rootsFor(plan.dataset_type, rows);
}
