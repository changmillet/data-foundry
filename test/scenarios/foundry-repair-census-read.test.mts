import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import {
  testAuthIdentityReceipt,
  testAuthIdentityReceiptOutput,
} from "../fixtures/auth-identity-receipt.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../src/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../src/lib/foundry-runtime-qualification.ts";
import { verifyFoundryRepairCensus } from "../../src/lib/foundry-repair-census.ts";
import { createFoundryEdgeActor } from "../../src/lib/foundry-edge-session.ts";

const actor = "22222222-2222-4222-8222-222222222222";
const id = "11111111-1111-4111-8111-111111111111";
const project = "qgzvkongdjqiiamzbbts";
test("repair census uses the qualified authenticated read interface and retains exact page evidence", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { root, workspace, facade, facadeOptions } = workflowFixture(t);
  const document = { processDataSet: { fixture: "exact" } };
  const row = {
    id,
    version: "00.00.001",
    user_id: actor,
    state_code: 0,
    json: document,
    model_id: null,
    model_version: null,
    team_id: null,
    review_id: null,
  };
  const input = {
    baseline: {
      documents: [
        {
          identity: { dataset_type: "process", id, version: row.version },
          user_id: actor,
          state_code: 0,
          document,
          document_sha256: "native-owned-hash",
          model_id: null,
          model_version: null,
          team_id: null,
          review_id: null,
        },
      ],
      models: [],
    },
  };
  const source = path.join(root, "source.json");
  fs.writeFileSync(source, JSON.stringify(input));
  const specFile = path.join(root, "task.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "census",
      actor_id: "census-agent",
      lane: "external-dataset-curated-import",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: source }],
      seed: null,
      account_intent: { project_ref: project, user_id: actor, session_reference: null },
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id, JSON.stringify(started));
  const context = createFoundryRuntimeContext({
    moduleUrl: new URL("../../src/dev-cli.ts", import.meta.url).href,
    workspace,
    taskId: started.task_id,
    actorId: "census-agent",
    accountIntent: { projectRef: project, userId: actor },
    inputs: [captureFoundryInput(source)],
  });
  const qualified = qualifyFoundryRuntime(context, facadeOptions.runtimeSelection);
  let identityReceipts = 0;
  const spawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    if (!Array.isArray(args[1]) || !args[1].includes("identity-receipt"))
      return Reflect.apply(spawn, childProcess, args);
    identityReceipts++;
    return {
      stdout: testAuthIdentityReceiptOutput(
        testAuthIdentityReceipt({
          projectRef: project,
          userId: actor,
          scopeOverrides: {
            session: {
              source: "access_token",
              cache_mode: "disabled",
              force_reauth: false,
              expires_at_utc: null,
            },
          },
        }),
      ),
      stderr: "",
      status: 0,
      signal: null,
      pid: 1,
      output: [],
    };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url: URL, request: RequestInit) => {
    reads++;
    if (reads === 8) t.mock.timers.tick(61_000);
    assert.equal(url.origin, `https://${project}.supabase.co`);
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    const headers = new Headers(request.headers);
    assert.equal(headers.get("accept-profile"), "public");
    assert.equal(headers.get("prefer"), "count=exact");
    assert.equal(headers.get("authorization"), "Bearer census-test-token");
    assert.equal(headers.get("range"), "0-99");
    assert.equal(url.searchParams.get("order"), "id.asc,version.asc");
    const found =
      url.pathname.endsWith("/processes") && url.searchParams.get("state_code") === "eq.0";
    if (found) {
      assert.equal(url.searchParams.get("user_id"), `eq.${actor}`);
      assert.match(url.searchParams.get("select")!, /model_id,model_version,team_id,review_id/u);
    }
    const select = url.searchParams.get("select")!;
    const projected = !select.split(",").includes("json");
    let selected: Record<string, unknown> = row;
    if (projected && url.pathname.endsWith("/processes")) {
      assert.ok(select.includes("exchanges:json->processDataSet->exchanges->exchange"));
      const { json: _json, ...metadata } = row;
      selected = { ...metadata, exchanges: null };
    }
    if (projected && url.pathname.endsWith("/lifecyclemodels"))
      assert.ok(
        select.includes(
          "result_process:json->lifeCycleModelDataSet->lifeCycleModelInformation->dataSetInformation->referenceToResultingProcess",
        ),
      );
    if (projected && url.pathname.endsWith("/flows"))
      assert.ok(
        select.includes(
          "declared_type:json->flowDataSet->modellingAndValidation->LCIMethod->typeOfDataSet",
        ),
      );
    if (!projected) assert.equal(url.searchParams.get("id"), `in.(${id})`);
    return new Response(JSON.stringify(found ? [selected] : []), {
      status: 200,
      headers: { "content-range": found ? "0-0/1" : "*/0" },
    });
  });
  const authentication = {
    mode: "headless" as const,
    apiBaseUrl: `https://${project}.supabase.co`,
    accessToken: "census-test-token",
    publishableKey: "census-test-key",
  };
  const directory = path.join(root, "census-proof");
  const verified = await verifyFoundryRepairCensus(
    context,
    qualified,
    authentication,
    input,
    directory,
  );
  assert.equal(verified.proof.status, "verified");
  assert.equal(verified.proof.project_ref, project);
  assert.equal(reads, 16);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, "proof.json"), "utf8")).read_pages,
    16,
  );
  assert.equal(verified.files.length, 18);
  assert.ok(identityReceipts >= 2, "a long census renews a fresh same-context CLI identity");
  const pages = verified.files.filter((file) => path.basename(file).startsWith("page-"));
  const firstReceipt = JSON.parse(fs.readFileSync(pages[0], "utf8")).page.identityReceipt;
  const lastReceipt = JSON.parse(fs.readFileSync(pages.at(-1)!, "utf8")).page.identityReceipt;
  assert.ok(
    Date.parse(lastReceipt.captured_at_utc) - Date.parse(firstReceipt.captured_at_utc) >= 60_000,
  );
  assert.equal(lastReceipt.identity.user_id, actor);
  for (const file of pages) {
    const page = JSON.parse(fs.readFileSync(file, "utf8")).page;
    const age = Date.parse(page.requestedAtUtc) - Date.parse(page.identityReceipt.captured_at_utc);
    assert.ok(age >= 0 && age <= 60_000, "each request binds its original fresh identity window");
  }
  const reader = await createFoundryEdgeActor(context, qualified, authentication);
  await assert.rejects(
    reader.readDataPage({ table: "processes", state: 0, owner: id, offset: 0, limit: 100 }),
    { code: "repair_census_query_invalid" },
  );
  assert.equal(reads, 16);
});
