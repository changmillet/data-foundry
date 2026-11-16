import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildEdgeSupportPlan,
  verifyEdgeSupportPlan,
} from "../../scripts/lib/foundry-edge-support-plan.ts";
import {
  dispatchFoundryEdgeSupport,
  verifyFoundryEdgeSupport,
} from "../../scripts/lib/foundry-edge-support.ts";
import { supportFlowPropertyRow } from "../fixtures/support-row-builders.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const receipt = testAuthIdentityReceipt();
const account = { project_ref: receipt.project.project_ref, user_id: receipt.identity.user_id };
const propertyId = "33333333-4444-4555-8666-777777777777";
const unitGroupId = "88888888-8888-4888-8888-888888888888";
const rows = [supportFlowPropertyRow(propertyId, unitGroupId)];
const input = { path: path.resolve("final-rows.jsonl"), bytes: 12, sha256: "0".repeat(64) };

function sealed() {
  const base = buildEdgeSupportPlan("flowproperty", input, account, rows);
  const evidence = {
    fact: { path: path.resolve("reference-evidence.json"), bytes: 56, sha256: "f".repeat(64) },
    report: {
      schema: "tiangong-foundry.edge-support-precommit.v1",
      status: "passed_remote_verification",
      input_path: input.path,
      edge_plan_sha256: base.sha256,
      checks: base.roots[0].references.map((ref) => ({
        ...ref,
        role: "reference",
        status: "ok",
        remote_payload_sha256: "b".repeat(64),
        remote_user_id: ref.table === "unitgroups" ? account.user_id : null,
        remote_state_code: ref.table === "unitgroups" ? 0 : 100,
      })),
    },
  };
  return { evidence, plan: buildEdgeSupportPlan("flowproperty", input, account, rows, evidence) };
}

test("a FlowProperty plan seals the exact dependency and rejects changed owners or final bytes", () => {
  const { evidence, plan } = sealed();
  assert.equal(verifyEdgeSupportPlan(plan, input, account, rows, evidence)[0].root.id, propertyId);
  assert.ok(
    plan.roots[0].references.some(
      (ref) =>
        ref.table === "unitgroups" &&
        ref.id === unitGroupId &&
        ref.payload_sha256 === "b".repeat(64),
    ),
  );
  assert.throws(() => verifyEdgeSupportPlan(plan, input, account, rows), /sealed exact dependency/);
  assert.throws(
    () => verifyEdgeSupportPlan(plan, { ...input, bytes: 13 }, account, rows, evidence),
    /Reference evidence/,
  );
  assert.throws(
    () =>
      verifyEdgeSupportPlan(
        plan,
        input,
        {
          ...account,
          user_id: "99999999-9999-4999-8999-999999999999",
        },
        rows,
        evidence,
      ),
    /Reference evidence/,
  );
});

test("exact Edge readback rejects substituted dependency content even if the status says ok", async () => {
  const { plan } = sealed();
  const response = await verifyFoundryEdgeSupport(
    {
      receipt,
      async post(endpoint, body) {
        assert.equal(endpoint, "app_dataset_verify_remote");
        const refs = body.references as Array<Record<string, unknown>>;
        return {
          command: "dataset_verify_remote",
          data: {
            root_policy: "existing",
            checks: refs.map((ref, index) => ({
              ...ref,
              index,
              exact_version: ref.version,
              state_code: index === 0 || ref.table === "unitgroups" ? 0 : 100,
              user_id: index === 0 || ref.table === "unitgroups" ? account.user_id : null,
              payload_present: true,
              status: "ok",
              actual_json_sha256:
                ref.table === "unitgroups" ? "c".repeat(64) : ref.expectedJsonSha256,
            })),
          },
        };
      },
    },
    plan,
    "after",
  );
  assert.equal(response.blockers.length, 1);
  assert.equal(response.blockers[0].id, unitGroupId);
});

test("Edge create rejects changed content and an unrelated authenticated actor before sending", async () => {
  const { plan, evidence } = sealed();
  const verified = verifyEdgeSupportPlan(plan, input, account, rows, evidence);
  const post = async () => assert.fail("a refused request cannot reach Edge");
  await assert.rejects(
    dispatchFoundryEdgeSupport({ receipt, post }, plan, [
      { ...verified[0], content: { changed: true } },
    ]),
    /differs from the sealed final rows/,
  );
  await assert.rejects(
    dispatchFoundryEdgeSupport(
      {
        receipt: testAuthIdentityReceipt({ userId: "99999999-9999-4999-8999-999999999999" }),
        post,
      },
      plan,
      verified,
    ),
    /differs from the sealed draft owner/,
  );
});
