import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { collectDatasetReferences } from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { bundleRowTypes } from "../../scripts/lib/bundle-row-types.ts";
import { digestFile, workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import {
  finalizationProcessAccount,
  typedFinalizationProcessFixture,
} from "../fixtures/finalization-process.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;

async function verifyGuardedUpdate(
  t: TestContext,
  annualVolumeKnown: boolean,
  mode: "update" | "no-change" | "preflight-refusals" | "approval-refusals" = "update",
) {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion !== "0.4.0")
    return t.skip("requires the exact published CLI 0.4 candidate");
  const { root, workspace, facadeOptions } = workflowFixture(t);
  const account = finalizationProcessAccount;
  const origin = `https://${account.project_ref}.supabase.co`;
  const facade = createFoundryFacade({
    ...facadeOptions,
    authentication: {
      mode: "headless",
      apiBaseUrl: origin,
      accessToken: "repair-test-token",
      publishableKey: "repair-test-key",
    },
  });
  const fixture = typedFinalizationProcessFixture();
  const before = fixture.process;
  if (!annualVolumeKnown) {
    const modelling = object(object(before.processDataSet).modellingAndValidation);
    object(modelling.dataSourcesTreatmentAndRepresentativeness).annualSupplyOrProductionVolume = [
      { "#text": "9999 missing-data-sentinel/year", "@xml:lang": "en" },
    ];
  }
  const desired = structuredClone(before);
  const ownership = (content: Json) =>
    object(
      object(object(content.processDataSet).administrativeInformation).publicationAndOwnership,
    );
  object(
    object(ownership(before)["common:referenceToOwnershipOfDataSet"])["common:shortDescription"],
  )["#text"] = "Original owner name";
  object(
    object(ownership(desired)["common:referenceToOwnershipOfDataSet"])["common:shortDescription"],
  )["#text"] = mode === "no-change" ? "Original owner name" : "Corrected owner name";
  const { id, version } = datasetIdentity(desired, 0, "process");
  const dependencies = new Map<string, unknown>();
  let staleDependency = false;
  const key = (table: unknown, id: unknown, version: unknown) => `${table}/${id}/${version}`;
  for (const reference of collectDatasetReferences(desired)) {
    assert.ok(reference.table && reference.version);
    dependencies.set(
      key(reference.table, reference.id, reference.version),
      reference.table === "flows" ? fixture.flow : { fixture_dependency: reference.id },
    );
  }
  const originalSpawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (!Array.isArray(argv)) return Reflect.apply(originalSpawn, childProcess, args);
    assert.ok(
      !argv.includes("save-draft") && !argv.includes("verify-remote"),
      "Legacy remote CLI commands are outside the candidate path",
    );
    let report;
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
      const type = argv[2] as keyof typeof bundleRowTypes;
      const depId = argv[argv.indexOf("--id") + 1];
      const depVersion = argv[argv.indexOf("--version") + 1];
      const content = dependencies.get(key(bundleRowTypes[type].plural, depId, depVersion));
      assert.ok(content);
      report = {
        schemaVersion: 1,
        operation: `dataset ${type} get`,
        status: "completed",
        outcome: "dataset_read",
        error: null,
        context: { environment: origin, effectiveInput: { id: depId, version: depVersion } },
        data: {
          subject: { type, id: depId, version: depVersion, owner: account.user_id, stateCode: 100 },
          content,
        },
      };
    } else return Reflect.apply(originalSpawn, childProcess, args);
    return {
      stdout: JSON.stringify(report),
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

  let remote = before;
  let offline = true;
  let writes = 0;
  let faultyRoot: "owner" | "state" | "version" | "hash" | "missing" | "duplicate" | null = null;
  const endpoints: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, request: RequestInit) => {
    assert.equal(url.origin, origin);
    const endpoint = url.pathname.split("/").at(-1)!;
    const body = object(JSON.parse(String(request.body)));
    endpoints.push(endpoint);
    if (endpoint === "app_dataset_save_draft") {
      assert.equal(++writes, 1);
      assert.equal(body.table, "processes");
      assert.equal(body.id, id);
      assert.equal(body.version, version);
      assert.equal(body.ruleVerification, annualVolumeKnown);
      assert.deepEqual(body.expectedJsonOrdered, before);
      assert.deepEqual(
        body.expectedJsonOrdered,
        remote,
        "the server compares the selected before document",
      );
      assert.deepEqual(body.jsonOrdered, desired);
      remote = object(body.jsonOrdered);
      throw new Error("response lost after guarded update");
    }
    assert.equal(endpoint, "app_dataset_verify_remote");
    assert.equal(body.rootPolicy, "existing");
    if (writes && offline) throw new Error("read connection still unavailable");
    const checks = (body.references as Json[]).flatMap((reference, index) => {
      const root = reference.role === "root";
      const retained = !root && reference.table === "contacts";
      const payload = root
        ? remote
        : dependencies.get(key(reference.table, reference.id, reference.version));
      assert.ok(payload);
      const hash = sha256Json(payload);
      if (root && faultyRoot === "missing") return [];
      const row = {
        index,
        table: reference.table,
        id: reference.id,
        version: reference.version,
        role: reference.role,
        status: retained
          ? "version_outdated"
          : hash === reference.expectedJsonSha256
            ? "ok"
            : "payload_hash_mismatch",
        exact_version: root && faultyRoot === "version" ? "25.00.001" : reference.version,
        latest_version: retained ? "99.00.001" : reference.version,
        payload_present: true,
        actual_json_sha256: root && faultyRoot === "hash" ? "0".repeat(64) : hash,
        user_id: root && faultyRoot === "owner" ? "different-draft-owner" : account.user_id,
        state_code: root
          ? faultyRoot === "state"
            ? 100
            : 0
          : retained && staleDependency
            ? 0
            : 100,
      };
      return root && faultyRoot === "duplicate" ? [row, row] : [row];
    });
    return Response.json({
      command: "dataset_verify_remote",
      data: { root_policy: body.rootPolicy, checks },
    });
  });
  const write = (name: string, value: unknown) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const beforeFile = write("before.json", [before]);
  const candidate = write("candidate.json", [desired]);
  const contract = write("contract.json", {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: "guarded-edge-repair",
    project_ref: account.project_ref,
    target_mode: "owner_draft",
    owner: { user_id: account.user_id, email: "fixture@example.invalid", state_code: 0 },
    actions: [
      {
        action_id: "metadata",
        expected_operation: "save_draft",
        table: "processes",
        id,
        version,
        before_sha256: sha256Json(before),
        desired_sha256: sha256Json(desired),
        dependency_action_ids: [],
      },
    ],
  });
  const actorId = "edge-repair-author";
  const started = await facade.start({
    specFile: write("repair-task.json", {
      schema: "tiangong-foundry.task-start.v1",
      request_id: "guarded-edge-repair",
      actor_id: actorId,
      lane: "existing-owner-draft-repair",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [beforeFile, candidate, contract].map((file) => ({ path: file })),
      seed: null,
      account_intent: account,
      preparation: null,
      repair: {
        kind: "existing-owner-draft-metadata",
        before: beforeFile,
        candidate,
        contract,
        predecessor: null,
      },
    }),
  });
  assert.ok(started.task_id, JSON.stringify(started.blockers));
  const invocation = { taskId: started.task_id, actorId };
  assert.equal(endpoints.length, 0, "registration stays offline");
  assert.equal((await facade.status(invocation)).status, "ready");
  assert.equal(endpoints.length, 0, "status before preparation stays offline");
  if (mode === "preflight-refusals") {
    for (const fault of ["owner", "state", "version", "hash", "missing", "duplicate"] as const) {
      faultyRoot = fault;
      const rejected = await facade.resume(invocation);
      assert.notEqual(rejected.status, "completed", fault);
      assert.equal(
        rejected.blockers[0]?.code,
        "repair_preflight_blocked",
        JSON.stringify(rejected.blockers),
      );
      assert.equal(writes, 0);
      assert.ok(!rejected.artifacts.some((item) => item.role === "owner-execution-request.json"));
    }
    return;
  }
  let current = await facade.resume(invocation);
  const find = (role: string) => {
    const artifact = current.artifacts.findLast((item) => item.role === role);
    assert.ok(
      artifact?.kind === "file",
      JSON.stringify({ role, status: current.status, blockers: current.blockers }),
    );
    return artifact;
  };
  const preparation = find("foundry-repair-preflight.json");
  const prepared = object(JSON.parse(fs.readFileSync(preparation.path, "utf8")));
  if (mode === "no-change") {
    assert.equal(prepared.status, "no_change_verified", JSON.stringify(prepared.blockers));
    assert.equal(current.status, "completed", JSON.stringify(current.blockers));
    assert.equal(current.permissions.state, "not_required");
    assert.equal(writes, 0);
    const reads = endpoints.length;
    assert.ok(reads > 0);
    assert.equal((await facade.resume(invocation)).status, "completed");
    assert.equal(endpoints.length, reads, "repeat resume reuses the exact proof");
    fs.appendFileSync(preparation.path, "\n");
    const tampered = await facade.status(invocation);
    assert.equal(tampered.status, "blocked", JSON.stringify(tampered.blockers));
    assert.equal(endpoints.length, reads);
    return;
  }
  assert.equal(prepared.status, "prepared", JSON.stringify(prepared.blockers));
  assert.equal(writes, 0);
  const evidence = path.join(root, "approval.txt");
  fs.writeFileSync(evidence, "Approve the reviewed metadata-only update to this exact draft.");
  const read = (file: string) => object(JSON.parse(fs.readFileSync(file, "utf8")));
  const marker = read(path.join(workspace, ".foundry", "workspace.json"));
  const lock = read(
    path.join(workspace, ".foundry", "workspaces", invocation.taskId, "profile-lock.json"),
  );
  const grant = write("grant.json", {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: {
      workspace_id: marker.workspace_id,
      task_id: invocation.taskId,
      actor_id: actorId,
      project_ref: account.project_ref,
      user_id: account.user_id,
      profile_id: "generic",
      profile_sha256: lock.profile_sha256,
      input_scope_sha256: digestFile(candidate),
    },
    issued_at_utc: new Date(Date.now() - 1_000).toISOString(),
    expires_at_utc: new Date(Date.now() + 3600_000).toISOString(),
    remote_state_code: 0,
    allowed_actions: [],
    qa_waivers: [],
    evidence: [
      {
        id: "approval",
        kind: "user-decision",
        reference: fs.realpathSync(evidence),
        sha256: digestFile(evidence),
      },
    ],
  });
  const approvalInput = {
    schema: "tiangong-foundry.authorization-input.v1",
    task_id: invocation.taskId,
    actor_id: actorId,
    dataset_type: "process",
    input_kind: "repair_rows",
    input_sha256: digestFile(candidate),
    finalization_sha256: preparation.sha256,
    repair_preparation: { file: preparation.path, sha256: preparation.sha256 },
    execution_contract: { file: contract, sha256: digestFile(contract) },
    expected_previous_sha256: null,
    grant: { file: grant, sha256: digestFile(grant) },
    evidence: [
      { id: "approval", kind: "user-decision", file: evidence, sha256: digestFile(evidence) },
    ],
  };
  if (mode === "approval-refusals") {
    const expired = write("expired-grant.json", {
      ...read(grant),
      issued_at_utc: new Date(Date.now() - 60_000).toISOString(),
      expires_at_utc: new Date(Date.now() - 30_000).toISOString(),
    });
    for (const [name, selected] of [
      ["wrong-candidate", { ...approvalInput, input_sha256: "0".repeat(64) }],
      ["wrong-preparation", { ...approvalInput, finalization_sha256: "0".repeat(64) }],
      ["missing-contract", { ...approvalInput, execution_contract: undefined }],
      ["expired", { ...approvalInput, grant: { file: expired, sha256: digestFile(expired) } }],
    ] as const) {
      const rejected = await facade.resume({
        ...invocation,
        authorizationInputFile: write(`${name}.json`, selected),
      });
      assert.notEqual(
        rejected.permissions.state,
        "granted",
        `${name}: ${JSON.stringify(rejected.blockers)}`,
      );
      assert.ok(rejected.blockers.length, name);
      assert.equal(writes, 0);
    }
    return;
  }
  const approval = write("approval.json", approvalInput);
  current = await facade.resume({ ...invocation, authorizationInputFile: approval });
  assert.equal(current.permissions.state, "granted", JSON.stringify(current.blockers));
  for (let step = 0; step < 6; step++) {
    if (writes) break;
    current = await facade.resume(invocation);
  }
  assert.equal(writes, 1, JSON.stringify(current.blockers));
  assert.notEqual(current.status, "completed");
  const original = find("owner-execution-request.json");
  const count = endpoints.length;
  offline = false;
  remote = before;
  const unresolved = await facade.resume(invocation);
  assert.notEqual(unresolved.status, "completed", "before content cannot close a lost update");
  assert.equal(writes, 1);
  remote = desired;
  staleDependency = true;
  const changedDependency = await facade.resume(invocation);
  assert.notEqual(
    changedDependency.status,
    "completed",
    "an outdated reference must retain its reviewed state",
  );
  assert.equal(writes, 1);
  staleDependency = false;
  for (let step = 0; step < 5 && current.status !== "completed"; step++)
    current = await facade.resume(invocation);
  assert.equal(current.status, "completed", JSON.stringify(current.blockers));
  assert.equal(writes, 1);
  assert.deepEqual(remote, desired);
  assert.deepEqual(new Set(endpoints.slice(count)), new Set(["app_dataset_verify_remote"]));
  assert.equal(find("owner-execution-request.json").sha256, original.sha256);
  const proof = object(JSON.parse(fs.readFileSync(find("owner-readback.json").path, "utf8")));
  assert.equal(proof.status, "verified");
  assert.equal(object(proof.repair_preparation).sha256, preparation.sha256);
}

test("CLI 0.4 guarded Process update recovers the original attempt without resending", (t) =>
  verifyGuardedUpdate(t, true));

test("CLI 0.4 guarded Process update retains the admitted unknown annual-volume gap", (t) =>
  verifyGuardedUpdate(t, false));

test("CLI 0.4 no-op repair closes only on exact readback and reuses the existing proof", (t) =>
  verifyGuardedUpdate(t, true, "no-change"));

test("CLI 0.4 metadata repair refuses invalid before readback", (t) =>
  verifyGuardedUpdate(t, true, "preflight-refusals"));

test("CLI 0.4 metadata repair refuses authorization outside the sealed scope", (t) =>
  verifyGuardedUpdate(t, true, "approval-refusals"));
