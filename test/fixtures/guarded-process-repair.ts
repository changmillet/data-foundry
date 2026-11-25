import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { FOUNDRY_TIDAS_EXPECTATION_SCHEMA } from "../../src/lib/foundry-runtime-qualification.ts";
import { captureFoundryInput } from "../../src/lib/foundry-runtime-context.ts";
import {
  readScientificRepairRuntime,
  scientificRepairChanges,
} from "../../src/lib/foundry-scientific-repair.ts";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import type { TestContext } from "node:test";
import { createFoundryFacade } from "../../src/public-api.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../src/lib/foundry-runtime-utils.ts";
import { sha256Json } from "../../src/lib/identity-preflight-proof.ts";
import { collectDatasetReferences } from "../../src/lib/import-curation/internal/workflow-reference-closure.ts";
import { datasetIdentity } from "../../src/lib/import-curation/internal/dataset-payload.ts";
import { bundleRowTypes } from "../../src/lib/bundle-row-types.ts";
import { digestFile, workflowFixture } from "./foundry-public-workflow.ts";
import {
  finalizationProcessAccount,
  typedFinalizationProcessFixture,
} from "./finalization-process.ts";
import { testAuthIdentityReceipt } from "./auth-identity-receipt.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;

export interface ScientificRepairQaConfiguration {
  schema: "tiangong-foundry.scientific-repair-qa.v1";
  host_config_root: string;
  tidas_executable: string;
  tidas_sha256: string;
  tidas_version: string;
  tidas_asset_fingerprint: string;
  evidence_directory: string;
}

export async function verifyGuardedUpdate(
  t: TestContext,
  annualVolumeKnown: boolean,
  mode: "update" | "no-change" | "preflight-refusals" | "approval-refusals" = "update",
  scientific?: ScientificRepairQaConfiguration,
) {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion !== "0.4.0")
    return t.skip("requires the exact published CLI 0.4 candidate");
  const { root, workspace, facadeOptions } = workflowFixture(t);
  const account = finalizationProcessAccount;
  const origin = `https://${account.project_ref}.supabase.co`;
  let workerRuntime: ReturnType<typeof readScientificRepairRuntime> | undefined;
  let nativeInput: Json | undefined;
  let reviewedNativeReport: Json | undefined;
  if (scientific) {
    assert.equal(scientific.schema, "tiangong-foundry.scientific-repair-qa.v1");
    for (const file of [
      scientific.host_config_root,
      scientific.tidas_executable,
      scientific.evidence_directory,
    ])
      assert.ok(path.isAbsolute(file));
    const previousConfigRoot = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = scientific.host_config_root;
    t.after(() => {
      if (previousConfigRoot === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfigRoot;
    });
    workerRuntime = readScientificRepairRuntime([workspace, path.join(root, "cache")]);
    const nativeFact = captureFoundryInput(scientific.tidas_executable);
    assert.equal(nativeFact.sha256, scientific.tidas_sha256);
    facadeOptions.runtimeSelection = {
      ...facadeOptions.runtimeSelection,
      tidasExecutable: scientific.tidas_executable,
      tidasExpectation: {
        schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
        platform: facadeOptions.runtimeSelection.cliExpectation.platform,
        binary_version: scientific.tidas_version,
        executable: { bytes: nativeFact.bytes, sha256: nativeFact.sha256 },
        validation: {
          schema_version: "tidas.validation-describe.v1",
          asset_fingerprint: scientific.tidas_asset_fingerprint,
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: [
            "tidas.validation-final-event.v1",
            "tidas.validation-issue-event.v1",
          ],
        },
      },
    };
    nativeInput = object(
      JSON.parse(
        fs.readFileSync(
          new URL("./scientific-repair-provider-input.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    nativeInput.expected_worker_sha256 = workerRuntime.executable.sha256;
  }
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
  const before = nativeInput
    ? object(
        (object(nativeInput.baseline).documents as Json[]).find(
          (item) => object(item.identity).dataset_type === "process",
        )!.document,
      )
    : fixture.process;
  if (!annualVolumeKnown) {
    const modelling = object(object(before.processDataSet).modellingAndValidation);
    object(modelling.dataSourcesTreatmentAndRepresentativeness).annualSupplyOrProductionVolume = [
      { "#text": "9999 missing-data-sentinel/year", "@xml:lang": "en" },
    ];
  }
  const desired = nativeInput
    ? object((nativeInput.overlays as Json[])[0].document)
    : structuredClone(before);
  const ownership = (content: Json) =>
    object(
      object(object(content.processDataSet).administrativeInformation).publicationAndOwnership,
    );
  if (!scientific) {
    object(
      object(ownership(before)["common:referenceToOwnershipOfDataSet"])["common:shortDescription"],
    )["#text"] = "Original owner name";
    object(
      object(ownership(desired)["common:referenceToOwnershipOfDataSet"])["common:shortDescription"],
    )["#text"] = mode === "no-change" ? "Original owner name" : "Corrected owner name";
  }
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
  if (nativeInput) {
    dependencies.clear();
    for (const item of object(nativeInput.baseline).documents as Json[]) {
      const identity = object(item.identity);
      const type = String(identity.dataset_type) as keyof typeof bundleRowTypes;
      dependencies.set(
        key(bundleRowTypes[type].plural, identity.id, identity.version),
        item.document,
      );
    }
  }
  const originalSpawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (!Array.isArray(argv)) return Reflect.apply(originalSpawn, childProcess, args);
    assert.ok(
      !argv.includes("save-draft") && !argv.includes("verify-remote"),
      "Legacy remote CLI commands are outside the candidate path",
    );
    assert.ok(
      !(argv[1] === "dataset" && ["create", "save", "delete", "publish"].includes(String(argv[3]))),
      "Remote dataset writes must stay inside the synthetic Edge transport",
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
  let peerDrift = false;
  let faultyRoot: "owner" | "state" | "version" | "hash" | "missing" | "duplicate" | null = null;
  const endpoints: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, request: RequestInit) => {
    assert.equal(url.origin, origin);
    const endpoint = url.pathname.split("/").at(-1)!;
    endpoints.push(endpoint);
    if (nativeInput && request.method === "GET") {
      assert.equal(new Headers(request.headers).get("accept-profile"), "public");
      assert.equal(new Headers(request.headers).get("prefer"), "count=exact");
      const rows = (object(nativeInput.baseline).documents as Json[])
        .flatMap((item) => {
          const identity = object(item.identity);
          const type = String(identity.dataset_type) as keyof typeof bundleRowTypes;
          if (bundleRowTypes[type].plural !== endpoint) return [];
          const idFilter = url.searchParams.get("id");
          if (idFilter?.startsWith("eq.") && idFilter !== `eq.${identity.id}`) return [];
          if (
            idFilter?.startsWith("in.(") &&
            !idFilter.slice(4, -1).split(",").includes(String(identity.id))
          )
            return [];
          if (
            url.searchParams.get("version") &&
            url.searchParams.get("version") !== `eq.${identity.version}`
          )
            return [];
          if (
            url.searchParams.get("state_code") &&
            url.searchParams.get("state_code") !== `eq.${item.state_code}`
          )
            return [];
          if (
            url.searchParams.get("user_id") &&
            url.searchParams.get("user_id") !== `eq.${item.user_id}`
          )
            return [];
          return [
            {
              id: identity.id,
              version: identity.version,
              user_id: item.user_id,
              state_code: item.state_code,
              json:
                identity.id === id && writes
                  ? remote
                  : peerDrift && type === "process" && identity.id !== id
                    ? { ...object(item.document), synthetic_peer_drift: true }
                    : item.document,
              ...(type === "process"
                ? {
                    model_id: item.model_id ?? null,
                    model_version: item.model_version ?? null,
                    team_id: item.team_id ?? null,
                    review_id: item.review_id ?? null,
                  }
                : {}),
            },
          ];
        })
        .sort((left, right) =>
          `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`),
        );
      const range = new Headers(request.headers).get("range")!.split("-").map(Number);
      const selected = rows.slice(range[0], range[1] + 1);
      return Response.json(selected, {
        headers: {
          "Content-Range": rows.length
            ? `${range[0]}-${range[0] + selected.length - 1}/${rows.length}`
            : "*/0",
        },
      });
    }
    const body = object(JSON.parse(String(request.body)));
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
      peerDrift = Boolean(scientific);
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
  let scientificDescriptor: string | undefined;
  let scientificSources: string[] = [];
  if (nativeInput && workerRuntime) {
    const inputFile = write("worker-input.json", nativeInput);
    const nativeReport = path.join(root, "reviewed-worker-report.json");
    const result = originalSpawn(
      workerRuntime.executable.path,
      [
        "--provider-impact-input",
        inputFile,
        "--provider-impact-input-sha256",
        digestFile(inputFile),
        "--provider-impact-out",
        nativeReport,
      ],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = object(JSON.parse(fs.readFileSync(nativeReport, "utf8")));
    reviewedNativeReport = report;
    assert.equal(
      object(report.scope).frozen_selection_contract,
      "worker.provider-impact.frozen-census.v1",
    );
    const after = object(report.after);
    assert.equal((after.effective_processes as Json[]).length, 2);
    assert.equal((after.flow_axis as Json[]).length, 2);
    assert.equal(new Set((after.reference_ports as Json[]).map((port) => port.flow_id)).size, 2);
    assert.equal((after.provider_decisions as Json[]).length, 1);
    assert.equal((after.provider_decisions as Json[])[0].candidate_provider_count, 1);
    assert.equal((after.provider_decisions as Json[])[0].decision_kind, "unique_provider");
    assert.deepEqual(object(object(report.after).readiness).blockers, []);
    assert.deepEqual(object(report.after).unresolved_balances, []);
    const source = write("measurement.json", {
      observation:
        "Synthetic laboratory measurement revises both input consumption and product output from 1 kg to 1.2 kg per functional unit. The declared product amount is 1.2 kg of synthetic product.",
    });
    const pointer = (payload: Json, ref: string) =>
      ref
        .slice(1)
        .split("/")
        .reduce<unknown>(
          (value, part) => object(value)[part.replaceAll("~1", "/").replaceAll("~0", "~")],
          payload,
        );
    const changes = write("scientific-changes.json", {
      schema: "tiangong-foundry.scientific-repair-changes.v1",
      changes: scientificRepairChanges(before, desired).map((pointerPath) => ({
        id,
        version,
        path: pointerPath,
        before_sha256: sha256Json({ present: true, value: pointer(before, pointerPath) }),
        after_sha256: sha256Json({ present: true, value: pointer(desired, pointerPath) }),
        basis:
          "Apply the exact synthetic measurement to the input, product output and declared functional unit.",
        evidence: [
          {
            source: fs.realpathSync(source),
            source_sha256: digestFile(source),
            quote:
              "both input consumption and product output from 1 kg to 1.2 kg per functional unit",
          },
        ],
      })),
    });
    const bindings = new Map([
      ["before", beforeFile],
      ["candidate", candidate],
      ["worker_input", inputFile],
      ["worker_report", nativeReport],
      ["changes", changes],
      ["source_0", source],
    ]);
    const review = write("independent-scientific-review.json", {
      reviewer_id: "reviewer/synthetic-science",
      scope: "scientific-content-and-provider-impact",
      status: "PASS",
      findings: { p0: 0, p1: 0 },
      reviewed_artifacts: [...bindings].map(([artifact_id, file]) => ({
        artifact_id,
        bytes: fs.statSync(file).size,
        sha256: digestFile(file),
      })),
    });
    const ref = (file: string) => ({ file: fs.realpathSync(file), sha256: digestFile(file) });
    scientificDescriptor = write("scientific-repair.json", {
      schema: "tiangong-foundry.scientific-repair.v1",
      author_id: actorId,
      worker_input: ref(inputFile),
      worker_report: ref(nativeReport),
      changes: ref(changes),
      sources: [ref(source)],
      review: ref(review),
    });
    scientificSources = [inputFile, nativeReport, changes, source, review, scientificDescriptor];
  }
  const started = await facade.start({
    specFile: write("repair-task.json", {
      schema: "tiangong-foundry.task-start.v1",
      request_id: "guarded-edge-repair",
      actor_id: actorId,
      lane: "existing-owner-draft-repair",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [beforeFile, candidate, contract, ...scientificSources].map((file) => ({
        path: file,
      })),
      seed: null,
      account_intent: account,
      preparation: null,
      repair: {
        kind: scientific ? "existing-owner-draft-scientific" : "existing-owner-draft-metadata",
        before: beforeFile,
        candidate,
        contract,
        predecessor: null,
        ...(scientificDescriptor ? { scientific: scientificDescriptor } : {}),
      },
    }),
  });
  assert.ok(started.task_id, JSON.stringify(started.blockers));
  const invocation = { taskId: started.task_id, actorId };
  assert.equal(endpoints.length, 0, "registration stays offline");
  const registeredStatus = await facade.status(invocation);
  assert.equal(registeredStatus.status, "ready", JSON.stringify(registeredStatus.blockers));
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
  if (scientific) {
    fs.mkdirSync(scientific.evidence_directory, { recursive: true });
    fs.cpSync(root, path.join(scientific.evidence_directory, `preflight-${path.basename(root)}`), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.writeFileSync(
      path.join(scientific.evidence_directory, `preflight-result-${path.basename(root)}.json`),
      JSON.stringify(current, null, 2) + "\n",
    );
  }
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
  fs.writeFileSync(
    evidence,
    scientific
      ? "Approve the exact synthetic scientific exchange revision for this owner draft."
      : "Approve the reviewed metadata-only update to this exact draft.",
  );
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
  if (scientific) {
    peerDrift = true;
    const peerChanged = await facade.resume(invocation);
    fs.cpSync(root, path.join(scientific.evidence_directory, `postwrite-${path.basename(root)}`), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.writeFileSync(
      path.join(scientific.evidence_directory, `postwrite-result-${path.basename(root)}.json`),
      JSON.stringify(peerChanged, null, 2) + "\n",
    );
    assert.notEqual(
      peerChanged.status,
      "completed",
      "postwrite peer drift retains the consumed original attempt as unresolved",
    );
    assert.equal(writes, 1);
    peerDrift = false;
  }
  for (let step = 0; step < 5 && current.status !== "completed"; step++)
    current = await facade.resume(invocation);
  assert.equal(current.status, "completed", JSON.stringify(current.blockers));
  assert.equal(writes, 1);
  assert.deepEqual(remote, desired);
  if (scientific) {
    assert.ok(
      endpoints
        .slice(count)
        .every(
          (endpoint) =>
            endpoint === "app_dataset_verify_remote" ||
            Object.values(bundleRowTypes).some((type) => type.plural === endpoint),
        ),
    );
  } else assert.deepEqual(new Set(endpoints.slice(count)), new Set(["app_dataset_verify_remote"]));
  assert.equal(find("owner-execution-request.json").sha256, original.sha256);
  const proof = object(JSON.parse(fs.readFileSync(find("owner-readback.json").path, "utf8")));
  assert.equal(proof.status, "verified");
  assert.equal(object(proof.repair_preparation).sha256, preparation.sha256);
  if (scientific) {
    fs.mkdirSync(scientific.evidence_directory, { recursive: true });
    const destination = path.join(scientific.evidence_directory, `verified-${path.basename(root)}`);
    fs.cpSync(workspace, destination, { recursive: true, errorOnExist: true, force: false });
    const receipt = {
      schema: "tiangong-foundry.scientific-repair-qa-receipt.v1",
      status: "passed",
      task_id: invocation.taskId,
      real_worker: workerRuntime!.executable,
      real_tidas: captureFoundryInput(scientific.tidas_executable),
      writes,
      readback_only_after_lost_response: true,
      postwrite_peer_drift_rejected: true,
      worker_scope: reviewedNativeReport!.scope,
      gate_artifacts: (object(prepared.evidence).files as Json[]).filter((file) =>
        /schema|curation-gate-report|process-qa-report/u.test(String(file.role)),
      ),
      final_status: current.status,
      preparation_sha256: preparation.sha256,
      owner_request_sha256: original.sha256,
      readback_sha256: find("owner-readback.json").sha256,
      workspace_evidence: destination,
      synthetic_authentication: true,
      synthetic_remote_transport: true,
      candidate_digest: sha256Json(desired),
      provider_input_digest: digestFile(path.join(root, "worker-input.json")),
    };
    fs.writeFileSync(
      path.join(scientific.evidence_directory, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
  }
}
