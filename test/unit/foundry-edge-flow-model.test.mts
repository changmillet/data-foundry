import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildEdgeSupportPlan,
  isFoundryEdgeDraftType,
  verifyEdgeSupportPlan,
} from "../../src/lib/foundry-edge-support-plan.ts";
import {
  dispatchFoundryEdgeSupport,
  verifyFoundryEdgeSupport,
} from "../../src/lib/foundry-edge-support.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const receipt = testAuthIdentityReceipt();
const account = { project_ref: receipt.project.project_ref, user_id: receipt.identity.user_id };
const id = "12345678-abcd-4321-8765-123456789abc";
const input = { path: path.resolve("rows.json"), bytes: 5, sha256: "a".repeat(64) };
const fact = { ...input, path: path.resolve("precommit.json") };
function document(information: string, root: string, version: string) {
  return {
    [root]: {
      [information]: { dataSetInformation: { "common:UUID": id } },
      administrativeInformation: { publicationAndOwnership: { "common:dataSetVersion": version } },
    },
  };
}
function seal(type: "flow" | "lifecyclemodel", rows: unknown[], flowHeads?: unknown[]) {
  const base = buildEdgeSupportPlan(type, input, account, rows);
  const evidence = {
    fact,
    report: {
      schema: "tiangong-foundry.edge-support-precommit.v1",
      status: "passed_remote_verification",
      input_path: input.path,
      edge_plan_sha256: base.sha256,
      checks: [],
      ...(flowHeads ? { flow_heads: flowHeads } : {}),
    },
  };
  const plan = buildEdgeSupportPlan(type, input, account, rows, evidence);
  return { plan, rows: verifyEdgeSupportPlan(plan, input, account, rows, evidence) };
}

test("Flow version creation is sealed to its observed predecessor and rejects a moving head", async () => {
  assert.ok(isFoundryEdgeDraftType("flow"));
  const content = document("flowInformation", "flowDataSet", "01.00.002");
  const head = {
    table: "flows",
    id,
    version: "01.00.001",
    payload_sha256: "f".repeat(64),
    user_id: account.user_id,
    state_code: 100,
  };
  const sealed = seal("flow", [content], [{ id, head }]);
  let latest = head.version;
  const actor = {
    receipt,
    async post(endpoint: string, body: Record<string, unknown>) {
      assert.equal(endpoint, "app_dataset_verify_remote");
      const references = body.references as Record<string, unknown>[];
      assert.equal(references.length, 2, "the predecessor must be independently checked");
      return {
        command: "dataset_verify_remote",
        data: {
          root_policy: "candidate",
          checks: references.map((ref, index) => ({
            ...ref,
            index,
            latest_version: latest,
            status: index === 0 ? "candidate_root" : "ok",
            exact_version: index === 0 ? null : head.version,
            payload_present: index !== 0,
            state_code: head.state_code,
            user_id: head.user_id,
            actual_json_sha256: head.payload_sha256,
          })),
        },
      };
    },
  };
  assert.deepEqual((await verifyFoundryEdgeSupport(actor, sealed.plan, "before")).blockers, []);
  latest = "01.00.003";
  assert.ok((await verifyFoundryEdgeSupport(actor, sealed.plan, "before")).blockers.length);
  await dispatchFoundryEdgeSupport(
    {
      receipt,
      async post(endpoint, body) {
        assert.equal(
          endpoint,
          "app_dataset_create",
          "the exact approved version must reach the service",
        );
        assert.deepEqual(body.jsonOrdered, content);
        return {
          command: "dataset_create",
          ok: true,
          data: { id, version: "01.00.002", user_id: account.user_id, state_code: 0 },
        };
      },
    },
    sealed.plan,
    sealed.rows,
  );
});

test("Model creation uses the typed Model transaction through the same sealed scope", async () => {
  assert.ok(isFoundryEdgeDraftType("lifecyclemodel"));
  const content = document("lifeCycleModelInformation", "lifeCycleModelDataSet", "00.00.001");
  const sealed = seal("lifecyclemodel", [content]);
  let writes = 0;
  await dispatchFoundryEdgeSupport(
    {
      receipt,
      async post() {
        throw new Error("unexpected generic Edge mutation");
      },
    },
    sealed.plan,
    sealed.rows,
    (root, body) => {
      assert.equal(root.id, id);
      assert.deepEqual(body, content);
      writes++;
      return { outcome: "dataset_written" };
    },
  );
  assert.equal(writes, 1);
});
