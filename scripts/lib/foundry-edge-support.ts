import { FoundryContextError } from "./foundry-runtime-context.ts";
import type { createFoundryEdgeActor } from "./foundry-edge-session.ts";
import type { EdgeSupportPlan, EdgeSupportRoot } from "./foundry-edge-support-plan.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

type Actor = Awaited<ReturnType<typeof createFoundryEdgeActor>>;
type RootContent = { root: EdgeSupportRoot; content: Record<string, unknown> };

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
) {
  assertActor(actor, plan);
  const responses: unknown[] = [];
  const blockers: Array<{ table: string; id: string; version: string; role: string }> = [];
  for (const root of plan.roots) {
    const references = [
      {
        table: root.table,
        id: root.id,
        version: root.version,
        role: "root",
        expectedStateCodes: [0],
        expectedJsonSha256: root.payload_sha256,
        requirePayload: true,
      },
      ...root.references.map(({ table, id, version, payload_sha256, expected_state_code }) => ({
        table,
        id,
        version,
        role: "reference",
        requirePayload: true,
        expectedJsonSha256: payload_sha256,
        expectedStateCodes: expected_state_code === undefined ? [] : [expected_state_code],
      })),
    ];
    const payload = await actor.post("app_dataset_verify_remote", {
      rootPolicy: phase === "before" ? "candidate" : "existing",
      references,
    });
    const envelope = object(payload);
    const report = object(envelope.data);
    const checks = report.checks;
    if (
      envelope.command !== "dataset_verify_remote" ||
      report.root_policy !== (phase === "before" ? "candidate" : "existing") ||
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
      const same =
        check.index === index &&
        check.id === reference.id &&
        check.table === reference.table &&
        check.role === reference.role &&
        check.version === reference.version;
      const exact =
        check.status === "ok" &&
        check.exact_version === reference.version &&
        check.payload_present === true;
      const expected =
        reference.role === "root"
          ? phase === "before"
            ? check.status === "candidate_root" &&
              check.exact_version === null &&
              check.latest_version === null
            : exact &&
              check.state_code === 0 &&
              check.user_id === plan.user_id &&
              check.actual_json_sha256 === root.payload_sha256
          : exact &&
            check.actual_json_sha256 === reference.expectedJsonSha256 &&
            check.state_code === root.references[index - 1].expected_state_code &&
            check.user_id === root.references[index - 1].expected_owner;
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
    rows.some(({ root, content }, index) => {
      const sealed = plan.roots[index];
      return (
        root.table !== sealed.table ||
        root.id !== sealed.id ||
        root.version !== sealed.version ||
        sha256Json(content) !== sealed.payload_sha256
      );
    })
  )
    throw new FoundryContextError(
      "edge_support_input_changed",
      "The exact Edge request differs from the sealed final rows.",
    );
  const acknowledgements: unknown[] = [];
  for (const { root, content } of rows) {
    const response = await actor.post("app_dataset_create", {
      table: root.table,
      id: root.id,
      jsonOrdered: content,
    });
    const envelope = object(response);
    const row = object(envelope.data);
    if (
      envelope.command !== "dataset_create" ||
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
