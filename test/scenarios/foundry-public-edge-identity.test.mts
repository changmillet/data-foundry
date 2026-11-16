import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { runFoundryWorkflowIdentity } from "../../scripts/lib/foundry-workflow-identity.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import { readIdentityPreflightContext } from "../../scripts/lib/import-curation/internal/workflow-identity-preflight.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { flowRow } from "../fixtures/row-builders.ts";

test("a CLI 0.4 task binds its existing Edge identity observations to the Foundry review stage", async (t) => {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion !== "0.4.0")
    return t.skip("requires the exact CLI 0.4.0 candidate");
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const auth = testAuthIdentityReceipt({
    scopeOverrides: {
      session: {
        source: "access_token",
        cache_mode: "disabled",
        force_reauth: false,
        expires_at_utc: null,
      },
    },
  });
  const authentication = {
    mode: "headless" as const,
    apiBaseUrl: auth.project.project_base_url,
    accessToken: "test-only-actor-token",
    publishableKey: "test-only-publishable",
  };
  const id = "77777777-7777-4777-8777-777777777777";
  const seed = path.join(root, "seed.json");
  const specFile = path.join(root, "task.json");
  const base = flowRow(id);
  const info = base.flowDataSet.flowInformation.dataSetInformation;
  const row = {
    flowDataSet: {
      ...base.flowDataSet,
      flowInformation: {
        dataSetInformation: {
          ...info,
          name: {
            ...info.name,
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "Swiss market" },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "06", "#text": "Crude petroleum and natural gas" },
              ],
            },
          },
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: [
          {
            "@dataSetInternalID": "0",
            referenceToFlowPropertyDataSet: {
              "@refObjectId": "93a60a56-a3c8-11da-a746-0800200b9a66",
              "@version": "03.00.003",
              "common:shortDescription": { "@xml:lang": "en", "#text": "Mass" },
            },
            meanValue: "1",
          },
        ],
      },
    },
  };
  fs.writeFileSync(seed, JSON.stringify({ rows: [row] }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "edge-identity",
      actor_id: "edge-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: {
        project_ref: auth.project.project_ref,
        user_id: auth.identity.user_id,
        session_reference: null,
      },
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId: started.task_id,
    actorId: "edge-actor",
  };
  const context = createFoundryRuntimeContext({ ...options, inputs: [captureFoundryInput(seed)] });
  const qualified = qualifyFoundryRuntime(context, runtimeSelection);
  const runtime = createFoundryRuntime(context, qualified);
  await runtime.prepareContext(["flow"]);
  await runtime.materializeRows([seed]);
  const qualifyCurrent = async () => {
    const { artifacts } = await runtime.inspectTask();
    const current = createFoundryRuntimeContext({
      ...options,
      accountIntent: {
        projectRef: auth.project.project_ref,
        userId: auth.identity.user_id,
      },
      inputs: [
        captureFoundryInput(seed),
        ...artifacts.map((entry) =>
          captureFoundryInput(path.resolve(context.taskRoot!, entry.path)),
        ),
      ],
    });
    return { artifacts, current, qualified: qualifyFoundryRuntime(current, runtimeSelection) };
  };
  const beforeAssessment = await qualifyCurrent();
  const artifactFile = (name: string) =>
    path.resolve(
      context.taskRoot!,
      beforeAssessment.artifacts.find((entry) => entry.path.endsWith("/" + name))!.path,
    );
  const assessment = await createFoundryRuntime(
    beforeAssessment.current,
    beforeAssessment.qualified,
  ).assessRows(artifactFile("foundry-rows.json"), [artifactFile("contract-report.json")]);
  assert.equal(assessment.status, "completed");
  const beforeIdentity = await qualifyCurrent();

  const originalSpawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    if (!Array.isArray(args[1]) || !args[1].includes("identity-receipt"))
      return Reflect.apply(originalSpawn, childProcess, args);
    assert.equal(args[2]?.env?.TIANGONG_LCA_ACCESS_TOKEN, authentication.accessToken);
    return {
      stdout: JSON.stringify({
        schemaVersion: 1,
        operation: "auth identity-receipt",
        status: "completed",
        outcome: "identity_verified",
        error: null,
        data: { receipt: auth },
      }),
      stderr: "",
      status: 0,
      signal: null,
    };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const candidateId = "88888888-8888-4888-8888-888888888888";
  const candidate = { id: candidateId, version: "00.00.001", json: flowRow(candidateId) };
  const requests: unknown[] = [];
  t.mock.method(globalThis, "fetch", (url: URL, init: RequestInit) => {
    assert.equal(url.href, auth.project.project_base_url + "/functions/v1/flow_hybrid_search");
    assert.equal(init.redirect, "error");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      `Bearer ${authentication.accessToken}`,
    );
    requests.push(JSON.parse(String(init.body)));
    return Promise.resolve(Response.json({ data: [candidate] }));
  });
  const result = await runFoundryWorkflowIdentity(
    beforeIdentity.current,
    beforeIdentity.qualified,
    beforeIdentity.artifacts,
    authentication,
  );
  assert.equal(result.status, "completed", JSON.stringify(result.blockers));
  assert.equal(requests.length, 1);
  assert.equal((requests[0] as { lexical_weight: number }).lexical_weight, 0.8);
  assert.ok(typeof result.index === "string");
  const evidence = readIdentityPreflightContext(
    context.assetRoot,
    {
      identityPreflightIndex: result.index,
    },
    null,
  );
  assert.equal((evidence?.rows[0].execution_evidence as { status?: string })?.status, "verified");
  assert.equal(evidence?.rows[0].result?.decision, "manual_review");
  const candidates = evidence?.rows[0].result?.candidates;
  assert.ok(Array.isArray(candidates));
  assert.equal(candidates.length, 1);
  assert.doesNotMatch(fs.readFileSync(result.index, "utf8"), /test-only-actor-token/);
});
