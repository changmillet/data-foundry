import { FoundryContextError } from "./foundry-runtime-context.ts";
import type { createFoundryEdgeActor } from "./foundry-edge-session.ts";
import type { EdgeSupportPlan, EdgeSupportRoot } from "./foundry-edge-support-plan.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

type Actor = Awaited<ReturnType<typeof createFoundryEdgeActor>>;
type RootContent = {
  root: EdgeSupportRoot;
  content: Record<string, unknown>;
  beforeContent?: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function assertActor(actor: Actor, plan: EdgeSupportPlan) {
  if (
    actor.receipt.project.project_ref !== plan.project_ref ||
    actor.receipt.identity.user_id !== plan.user_id
  )
    throw new FoundryContextError(
      "edge_support_account_mismatch",
      "The Edge actor differs from the sealed draft owner.",
    );
}

// Verify the original exact content and dependencies even when an HTTP mutation response was lost.
export async function verifyFoundryEdgeSupport(
  actor: Actor,
  plan: EdgeSupportPlan,
  phase: "before" | "after",
  retainRepairReferences = Boolean(plan.update),
) {
  assertActor(actor, plan);
  const responses: unknown[] = [];
  const blockers: Array<{ table: string; id: string; version: string; role: string }> = [];
  const candidate = phase === "before" && !plan.update;
  const rootPolicy = candidate ? "candidate" : "existing";
  for (const root of plan.roots) {
    const expectedRootSha256 =
      phase === "before" && plan.update ? root.before_sha256 : root.payload_sha256;
    const dependencies = root.references.flatMap((reference) => {
      const selected = {
        table: reference.table,
        id: reference.id,
        version: reference.version,
        role: "reference",
        requirePayload: true,
        expectedJsonSha256: reference.payload_sha256,
        expectedStateCodes:
          reference.expected_state_code === undefined ? [] : [reference.expected_state_code],
      };
      const latest = reference.reviewed_latest;
      const expected = {
        request: selected,
        owner: reference.expected_owner,
        latest: latest?.version,
      };
      return !latest || latest.version === reference.version
        ? [expected]
        : [
            expected,
            {
              request: {
                ...selected,
                version: latest.version,
                expectedJsonSha256: latest.payload_sha256,
                expectedStateCodes: [latest.state_code],
              },
              owner: latest.user_id,
              latest: latest.version,
            },
          ];
    });
    const references = [
      {
        table: root.table,
        id: root.id,
        version: root.version,
        role: "root",
        expectedStateCodes: [0],
        expectedJsonSha256: expectedRootSha256,
        requirePayload: true,
      },
      ...dependencies.map(({ request }) => request),
    ];
    const payload = await actor.post("app_dataset_verify_remote", {
      rootPolicy,
      references,
    });
    const envelope = object(payload);
    const report = object(envelope.data);
    const checks = report.checks;
    if (
      envelope.command !== "dataset_verify_remote" ||
      report.root_policy !== rootPolicy ||
      !Array.isArray(checks) ||
      checks.length !== references.length
    )
      throw new FoundryContextError(
        "edge_support_readback_invalid",
        "Exact Edge verification returned incomplete evidence.",
      );
    responses.push(payload);
    references.forEach((reference, index) => {
      const check = object(checks[index]);
      const dependency = dependencies[index - 1];
      const same =
        check.index === index &&
        check.id === reference.id &&
        check.table === reference.table &&
        check.role === reference.role &&
        check.version === reference.version;
      const expectedStatus =
        dependency?.latest && dependency.latest > reference.version ? "version_outdated" : "ok";
      const unchangedRepairReference =
        retainRepairReferences &&
        reference.role === "reference" &&
        dependency.latest === undefined &&
        check.status === "version_outdated" &&
        typeof check.latest_version === "string" &&
        /^\d{2}\.\d{2}\.\d{3}$/u.test(check.latest_version) &&
        check.latest_version > reference.version;
      const exact =
        (check.status === expectedStatus || unchangedRepairReference) &&
        check.exact_version === reference.version &&
        check.payload_present === true;
      const expected =
        reference.role === "root"
          ? candidate
            ? check.status === "candidate_root" &&
              check.exact_version === null &&
              check.latest_version === null
            : exact &&
              check.state_code === 0 &&
              check.user_id === plan.user_id &&
              check.actual_json_sha256 === expectedRootSha256
          : exact &&
            check.actual_json_sha256 === reference.expectedJsonSha256 &&
            check.state_code === reference.expectedStateCodes[0] &&
            check.user_id === dependency.owner &&
            (dependency.latest === undefined || check.latest_version === dependency.latest);
      if (!same || !expected)
        blockers.push({
          table: reference.table,
          id: reference.id,
          version: reference.version,
          role: reference.role,
        });
    });
  }
  return { responses, blockers };
}

export async function dispatchFoundryEdgeSupport(
  actor: Actor,
  plan: EdgeSupportPlan,
  rows: RootContent[],
) {
  assertActor(actor, plan);
  if (
    rows.length !== plan.roots.length ||
    rows.some(({ root, content, beforeContent }, index) => {
      const sealed = plan.roots[index];
      return (
        root.table !== sealed.table ||
        root.id !== sealed.id ||
        root.version !== sealed.version ||
        sha256Json(content) !== sealed.payload_sha256 ||
        (plan.update
          ? !beforeContent || sha256Json(beforeContent) !== sealed.before_sha256
          : beforeContent !== undefined)
      );
    })
  )
    throw new FoundryContextError(
      "edge_support_input_changed",
      "The exact Edge request differs from the sealed final rows.",
    );
  const acknowledgements: unknown[] = [];
  const operation = plan.update ? "dataset_save_draft" : "dataset_create";
  for (const { root, content, beforeContent } of rows) {
    if (beforeContent && sha256Json(beforeContent) === sha256Json(content)) continue;
    const response = await actor.post(
      plan.update ? "app_dataset_save_draft" : "app_dataset_create",
      {
        table: root.table,
        id: root.id,
        jsonOrdered: content,
        ...(plan.update
          ? {
              version: root.version,
              expectedJsonOrdered: beforeContent,
              ruleVerification: plan.update.rule_verification[root.payload_sha256],
            }
          : {}),
      },
    );
    const envelope = object(response);
    const row = object(envelope.data);
    if (
      envelope.command !== operation ||
      envelope.ok !== true ||
      row.id !== root.id ||
      row.version !== root.version ||
      row.state_code !== 0 ||
      row.user_id !== plan.user_id
    )
      throw new FoundryContextError(
        "edge_support_result_unproven",
        "The Edge draft write needs exact readback.",
      );
    acknowledgements.push(envelope);
  }
  return acknowledgements;
}
