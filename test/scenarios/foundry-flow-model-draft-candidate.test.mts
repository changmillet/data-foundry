import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { digestFile, workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import {
  finalizationProcessAccount as account,
  typedFinalizationProcessFixture,
} from "../fixtures/finalization-process.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;

async function verifyDraftCreation(t: TestContext, type: "flow" | "lifecyclemodel") {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion !== "0.4.0")
    return t.skip("requires the exact published CLI candidate");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { root, workspace, facadeOptions } = workflowFixture(t);
  const origin = `https://${account.project_ref}.supabase.co`;
  const facade = createFoundryFacade({
    ...facadeOptions,
    authentication: {
      mode: "headless",
      apiBaseUrl: origin,
      accessToken: "synthetic-model-test-token",
      publishableKey: "synthetic-model-test-key",
    },
  });
  const read = (file: string | URL) => object(JSON.parse(fs.readFileSync(file, "utf8")));
  const write = (name: string, value: unknown) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const existingFlow = typedFinalizationProcessFixture().flow;
  const head = datasetIdentity(existingFlow, 0, "flow");
  const nextFlow = structuredClone(existingFlow);
  const flowRoot = object(nextFlow.flowDataSet);
  const flowInfo = object(object(flowRoot.flowInformation).dataSetInformation);
  flowInfo.classificationInformation = {
    "common:classification": {
      "common:class": [
        { "@level": "0", "@classId": "0", "#text": "Agriculture, forestry and fishery products" },
      ],
    },
  };
  const flowPublication = object(
    object(flowRoot.administrativeInformation).publicationAndOwnership,
  );
  const nextVersion = "01.00.001";
  flowPublication["common:dataSetVersion"] = nextVersion;
  const document =
    type === "flow" ? nextFlow : read(new URL("../fixtures/managed-model.json", import.meta.url));
  const seed = write("source.json", { rows: [document] });
  const actorId = "draft-author";
  let stored: unknown = null;
  let writes = 0;
  let disconnected = true;
  const remote = (id: unknown, version: unknown) =>
    type === "flow" && id === head.id ? existingFlow : { fixture_dependency: id, version };

  const original = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (!Array.isArray(argv)) return Reflect.apply(original, childProcess, args);
    let report;
    let status = 0;
    if (argv.includes("identity-receipt")) {
      report = {
        schemaVersion: 1,
        operation: "auth identity-receipt",
        status: "completed",
        outcome: "identity_verified",
        error: null,
        data: {
          receipt: testAuthIdentityReceipt({
            projectRef: account.project_ref,
            userId: account.user_id,
            scopeOverrides: {
              session: {
                source: "access_token",
                cache_mode: "disabled",
                force_reauth: false,
                expires_at_utc: null,
              },
            },
          }),
        },
      };
    } else if (argv[1] === "dataset" && argv[3] === "get") {
      const id = argv[argv.indexOf("--id") + 1];
      const version = argv[argv.indexOf("--version") + 1];
      const exact = version === "latest" ? head.version : version;
      report = {
        schemaVersion: 1,
        operation: `dataset ${argv[2]} get`,
        status: "completed",
        outcome: "dataset_read",
        error: null,
        context: { environment: origin, effectiveInput: { id, version } },
        data: {
          subject: { type: argv[2], id, version: exact, owner: account.user_id, stateCode: 100 },
          content: remote(id, exact),
        },
      };
    } else if (argv.slice(1, 4).join(" ") === "dataset model create") {
      const argsOptions = object(args[2]);
      const request = object(JSON.parse(String(argsOptions.input)));
      assert.equal(++writes, 1);
      assert.equal(request.expectedActor, account.user_id);
      assert.equal(request.expectedEnvironment, origin);
      assert.match(String(request.requestId), /^[a-f0-9]{64}$/u);
      assert.deepEqual(argv.slice(4), ["--input", "-", "--json"]);
      assert.ok(object(request.content).lifeCycleModelDataSet);
      stored = request.content;
      report = { status: "unknown", outcome: "write_outcome_unknown" };
      status = 1;
    } else {
      assert.ok(
        !argv.includes("save-draft") && !argv.includes("verify-remote"),
        JSON.stringify(argv.slice(1, 4)),
      );
      return Reflect.apply(original, childProcess, args);
    }
    return { status, stdout: JSON.stringify(report), stderr: "", signal: null, pid: 1, output: [] };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(url.origin, origin);
    const request = object(JSON.parse(String(options.body)));
    if (url.pathname.endsWith("/flow_hybrid_search")) {
      assert.equal(type, "flow");
      return Response.json({ data: [] });
    }
    if (url.pathname.endsWith("/app_dataset_create")) {
      assert.equal(type, "flow");
      assert.equal(++writes, 1);
      assert.equal(request.table, "flows");
      assert.equal(request.id, head.id);
      stored = request.jsonOrdered;
      throw new Error("response lost after Flow creation");
    }
    assert.equal(url.pathname, "/functions/v1/app_dataset_verify_remote");
    reads.push(String(request.rootPolicy));
    if (writes && disconnected) throw new Error("read connection unavailable");
    const checks = (request.references as Json[]).map((reference, index) => {
      const root = reference.role === "root";
      const payload = root ? stored : remote(reference.id, reference.version);
      const hash = payload ? sha256Json(payload) : null;
      return {
        ...reference,
        index,
        status: !payload
          ? "candidate_root"
          : hash === reference.expectedJsonSha256
            ? "ok"
            : "payload_hash_mismatch",
        exact_version: payload ? reference.version : null,
        latest_version: payload ? reference.version : type === "flow" ? head.version : null,
        payload_present: Boolean(payload),
        actual_json_sha256: hash,
        user_id: payload ? account.user_id : null,
        state_code: payload ? (root ? 0 : 100) : null,
      };
    });
    return Response.json({
      command: "dataset_verify_remote",
      data: { root_policy: request.rootPolicy, checks },
    });
  });

  const started = await facade.start({
    specFile: write("task.json", {
      schema: "tiangong-foundry.task-start.v1",
      request_id: "draft-candidate",
      actor_id: actorId,
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: [type],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: account,
      preparation: null,
    }),
  });
  assert.ok(started.task_id, JSON.stringify(started.blockers));
  const invocation = { taskId: started.task_id, actorId };
  let current = started;
  const find = (role: string) => current.artifacts.findLast((item) => item.role === role);
  let decided = false;
  for (let i = 0; i < 10 && !find("foundry-finalize.json"); i++) {
    current = await facade.resume(invocation);
    if (type !== "flow" || decided) continue;
    const artifact = find("foundry-assessment.json");
    if (artifact?.kind !== "file") continue;
    const assessment = read(artifact.path);
    const set = (assessment.sets as Json[]).find((item) => item.type === type);
    const work = (set?.decisions as Json[] | undefined)?.find((item) => item.kind === "identity");
    if (!work) continue;
    const template = String(object(read(String(work.task)).files).template);
    const decisions = readRows(path.resolve(String(assessment.owner_base), template)) as Json[];
    for (const row of decisions) {
      row.identity_decision = "create_new";
      row.canonical = null;
      row.basis = "Approve the next exact Flow version with independently reviewed content.";
      row.used_context_kinds = ["schema", "methodology_yaml", "ruleset", "classification_schema"];
      row.evidence = { ...object(row.evidence), quote_or_trace: "Synthetic product Flow version." };
    }
    const file = path.join(root, "identity.jsonl");
    fs.writeFileSync(file, decisions.map((item) => JSON.stringify(item)).join("\n") + "\n");
    current = await facade.resume({
      ...invocation,
      semanticInputFile: write("semantic.json", {
        schema: "tiangong-foundry.semantic-input.v1",
        task_id: invocation.taskId,
        actor_id: actorId,
        assessment_sha256: artifact.sha256,
        submissions: [
          {
            kind: "identity",
            authoring_task_sha256: digestFile(String(work.task)),
            file,
            sha256: digestFile(file),
          },
        ],
      }),
    });
    assert.equal(current.status, "ready", JSON.stringify(current.blockers));
    decided = true;
  }
  const finalize = find("foundry-finalize.json");
  const taskRoot = path.join(workspace, ".foundry", "workspaces", invocation.taskId);
  assert.ok(
    finalize?.kind === "file",
    JSON.stringify({
      blockers: current.blockers,
      identity: finalize
        ? null
        : fs
            .readdirSync(taskRoot, { recursive: true, encoding: "utf8" })
            .filter((file) => path.basename(file) === "foundry-identity.json")
            .map((file) => read(path.join(taskRoot, file)).blockers),
      findings: current.artifacts
        .filter(
          (item) =>
            item.kind === "file" &&
            [`${type}-qa-report.json`, "foundry-assessment.json", "foundry-identity.json"].includes(
              item.role,
            ),
        )
        .map((item) =>
          item.kind === "file"
            ? (read(item.path).findings ?? read(item.path).blockers ?? read(item.path).sets)
            : null,
        ),
    }),
  );
  const scope = (read(finalize.path).sets as Json[]).find((row) => row.type === type)!;
  assert.equal(
    scope.status,
    "ready_for_remote_write",
    JSON.stringify(read(String(scope.report)).blockers),
  );
  const input = (scope.authorization_inputs as Json[]).find(
    (entry) => entry.input_kind === "final_rows",
  )!;
  const evidence = path.join(root, "operator-approval.txt");
  fs.writeFileSync(evidence, "Approve exactly this synthetic dataset draft.");
  const sha256 = digestFile(evidence);
  const grant = write("model-grant.json", {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: input.binding,
    issued_at_utc: new Date(Date.now() - 1000).toISOString(),
    expires_at_utc: new Date(Date.now() + 3_600_000).toISOString(),
    remote_state_code: 0,
    allowed_actions: [],
    qa_waivers: [],
    evidence: [
      { id: "approval", kind: "user-decision", reference: fs.realpathSync(evidence), sha256 },
    ],
  });
  const expected = unwrapDatasetPayload(readRows(String(scope.final_rows))[0], type);
  const contract =
    type === "flow"
      ? write("contract.json", {
          schema_version: "dataset-save-draft-execution-contract.v1",
          execution_id: "explicit-flow-insert",
          project_ref: account.project_ref,
          target_mode: "owner_draft",
          owner: { user_id: account.user_id, email: "fixture@example.invalid", state_code: 0 },
          actions: [
            {
              action_id: "flow-version",
              expected_operation: "insert",
              table: "flows",
              id: head.id,
              version: nextVersion,
              before_sha256: null,
              desired_sha256: sha256Json(expected),
              dependency_action_ids: [],
            },
          ],
        })
      : null;
  const approval = write("approval.json", {
    schema: "tiangong-foundry.authorization-input.v1",
    task_id: invocation.taskId,
    actor_id: actorId,
    finalization_sha256: finalize.sha256,
    dataset_type: type,
    input_kind: "final_rows",
    input_sha256: input.sha256,
    expected_previous_sha256: null,
    ...(contract ? { execution_contract: { file: contract, sha256: digestFile(contract) } } : {}),
    grant: { file: grant, sha256: digestFile(grant) },
    evidence: [{ id: "approval", kind: "user-decision", file: evidence, sha256 }],
  });
  current = await facade.resume({ ...invocation, authorizationInputFile: approval });
  assert.equal(current.permissions.state, "granted", JSON.stringify(current.blockers));
  for (let i = 0; i < 6; i++) {
    if (writes) break;
    current = await facade.resume(invocation);
  }
  assert.equal(writes, 1, JSON.stringify(current.blockers));
  assert.notEqual(current.status, "completed");
  const attempt = find("owner-execution-request.json");
  assert.ok(attempt?.kind === "file");
  assert.deepEqual(stored, expected);
  disconnected = false;
  const before = reads.length;
  for (let i = 0; i < 5 && current.status !== "completed"; i++)
    current = await facade.resume(invocation);
  assert.equal(current.status, "completed", JSON.stringify(current.blockers));
  assert.equal(writes, 1);
  assert.deepEqual(new Set(reads.slice(before)), new Set(["existing"]));
  const originalAttempt = find("owner-execution-request.json");
  assert.ok(originalAttempt?.kind === "file");
  assert.equal(originalAttempt.sha256, attempt.sha256);
}

test("CLI 0.4 managed Model keeps its original typed create attempt and reads back after disconnect", (t) =>
  verifyDraftCreation(t, "lifecyclemodel"));

test("CLI 0.4 managed Flow creates the approved next version and reads back without resending", (t) =>
  verifyDraftCreation(t, "flow"));
