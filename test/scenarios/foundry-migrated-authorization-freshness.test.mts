import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { batchRunLockPath } from "@tiangong-lca/cli/batch";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  assertVerifiedFoundryIdentity,
  verifyFoundryRuntimeIdentity,
} from "../../scripts/lib/foundry-runtime-identity.ts";
import {
  registerFoundryTaskAuthorization,
  loadFoundryTaskAuthorization,
} from "../../scripts/lib/foundry-task-authorization.ts";
import { taskAuthorizationAllows } from "../../scripts/lib/task-authorization.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";

const accountIntent = {
  projectRef: "aaaaaaaaaaaaaaaaaaaa",
  userId: "11111111-1111-4111-8111-111111111111",
};
const hasCode = (code: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === code);
const json = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value) + "\n");
};

async function migratedFixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-migrated-auth-freshness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    destination = path.join(root, "destination"),
    input = path.join(root, "rows.jsonl"),
    originalTask = path.join(source, ".foundry/workspaces/original"),
    specFile = path.join(root, "adopt.json");
  json(input, { flowDataSet: {} });
  const inputFact = captureFoundryInput(input);
  json(path.join(originalTask, "foundry-job.json"), {
    schema_version: 1,
    task_id: "original",
    workspace_dir: ".foundry/workspaces/original",
    lane: "external-dataset-curated-import",
    target_profile: "generic",
    target_entities: ["flow"],
    write_policy: { mode: "dry-run" },
  });
  json(path.join(originalTask, "source-manifest.json"), {
    schema_version: 1,
    source_kind: "selected-local-files",
    source_paths: [{ path: inputFact.path, sha256: inputFact.sha256, access: "local-private" }],
  });
  json(path.join(originalTask, "profile-lock.json"), {
    schema_version: 1,
    profile_id: "generic",
  });
  // Public migration retains and re-verifies these ordinary local historical bytes. Their
  // presence models populated migrated metadata without borrowing any original task artifacts.
  const outputHashes: Record<string, string> = {};
  for (let index = 0; index < 64; index++) {
    const relative = `outputs/historical/${index}.json`;
    const file = path.join(originalTask, relative);
    json(file, {
      source: index,
      observation: "synthetic historical evidence ".repeat(128),
    });
    outputHashes[relative] = captureFoundryInput(file).sha256;
  }
  json(path.join(originalTask, "checkpoints/historical.json"), {
    schema_version: 1,
    stage_id: "dataset-curation-cleanup",
    status: "passed",
    output_hashes: outputHashes,
  });
  json(specFile, {
    schema: "tiangong-foundry.task-start.v1",
    request_id: "adopt-freshness",
    actor_id: "actor",
    lane: "external-dataset-curated-import",
    profile_id: "generic",
    target_entities: ["flow"],
    sources: [{ path: inputFact.path }],
    seed: null,
    account_intent: {
      project_ref: accountIntent.projectRef,
      user_id: accountIntent.userId,
      session_reference: null,
    },
    preparation: {
      operation: "dataset-curation-cleanup",
      type: "flow",
      input: inputFact.path,
      source_input: null,
      output_directory: "outputs/cleanup",
    },
  });
  const workspaceAccess = {
    manifest: workspaceManifestFixture({
      schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
      write: ["migration-adoption-v1", "registered-tasks-v2"],
    }),
    access: "write" as const,
  };
  const options = { cacheBase: path.join(root, "cache"), accountIntent, workspaceAccess };
  const facade = createFoundryFacade({ ...options, workspace: source });
  const migration = {
    destination,
    actorId: "actor",
    requestId: "migration",
    externalInputs: [input],
  };
  const planned = facade.migrationDryRun(migration);
  assert.equal(planned.status, "ready", JSON.stringify(planned.blockers));
  const plan = planned.artifacts.find((artifact) => artifact.kind === "inline");
  assert.ok(plan?.kind === "inline");
  const staged = await facade.migrationTransfer({ ...migration, plan: plan.value });
  assert.equal(staged.status, "ready", JSON.stringify(staged.blockers));
  const adoption = {
    ...migration,
    plan: plan.value,
    tasks: [{ sourceTask: "workspaces/original", specFile }],
  };
  const preview = await facade.migrationAdoption(adoption);
  assert.equal(preview.status, "ready", JSON.stringify(preview.blockers));
  const selected = preview.artifacts.find((artifact) => artifact.kind === "inline");
  assert.ok(selected?.kind === "inline");
  const adoptionPlan = selected.value as {
    tasks: Array<{
      authority: { task_id: string };
      target_spec: { sources: Array<{ path: string }> };
    }>;
  };
  const applied = await facade.migrationAdoption({ ...adoption, adoptionPlan, apply: true });
  assert.equal(applied.status, "ready", JSON.stringify(applied.blockers));
  const row = adoptionPlan.tasks[0];
  const inputFile = row.target_spec.sources[0].path;
  const context = createFoundryRuntimeContext({
    ...options,
    moduleUrl: new URL("../../scripts/public-api.ts", import.meta.url).href,
    workspace: destination,
    taskId: row.authority.task_id,
    actorId: "actor",
    inputs: [captureFoundryInput(inputFile)],
  });
  const evidenceFile = path.join(root, "approval.txt");
  fs.writeFileSync(evidenceFile, "Synthetic approval of exact migrated fixture input.\n");
  const evidence = captureFoundryInput(evidenceFile);
  const profile = JSON.parse(
    fs.readFileSync(path.join(context.taskRoot!, "profile-lock.json"), "utf8"),
  ) as { profile_sha256: string };
  const now = Date.now();
  const grant = {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: {
      workspace_id: context.workspaceId,
      task_id: context.taskId,
      actor_id: context.actorId,
      project_ref: accountIntent.projectRef,
      user_id: accountIntent.userId,
      profile_id: "generic",
      profile_sha256: profile.profile_sha256,
      input_scope_sha256: context.inputs[0].sha256,
    },
    issued_at_utc: new Date(now - 1000).toISOString(),
    expires_at_utc: new Date(now + 3600000).toISOString(),
    remote_state_code: 0,
    allowed_actions: ["unitgroup_write"],
    qa_waivers: [],
    evidence: [
      { id: "approval", kind: "user-decision", reference: evidence.path, sha256: evidence.sha256 },
    ],
  };
  t.mock.method(childProcess, "spawnSync", (_executable: unknown, argv: string[]) => {
    assert.ok(argv.includes("identity-receipt"), "only the read-only identity owner is simulated");
    return {
      status: 0,
      signal: null,
      stderr: "",
      stdout: JSON.stringify(
        testAuthIdentityReceipt({
          ...accountIntent,
          capturedAtUtc: new Date(Date.now()).toISOString(),
        }),
      ),
    };
  });
  const lock = batchRunLockPath(
    path.join(context.stateRoot, "task-locks", `${context.taskId}.json`),
  );
  return { root, context, inputFile, evidence, grant, lock };
}

function metadataClock(t: TestContext, f: Awaited<ReturnType<typeof migratedFixture>>) {
  const originalOpen = fs.openSync;
  const originalNow = Date.now;
  let offset = 0;
  let crossings = 0;
  let armed = false;
  t.mock.method(Date, "now", () => originalNow() + offset);
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const result = Reflect.apply(originalOpen, fs, args);
    if (armed && path.basename(String(args[0])) === "activation.json" && fs.existsSync(f.lock)) {
      offset += 61_000;
      crossings++;
      armed = false;
    }
    return result;
  });
  return {
    arm() {
      armed = true;
    },
    advance(milliseconds: number) {
      offset += milliseconds;
    },
    crossings() {
      return crossings;
    },
  };
}

test("migrated authorization refreshes after locked retained-history verification and preserves the grant", async (t) => {
  const f = await migratedFixture(t);
  const clock = metadataClock(t, f);
  let identity = verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {});
  const refreshIdentity = () => {
    assert.ok(fs.existsSync(f.lock), "identity refresh remains under the task metadata lock");
    identity = verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {});
    return identity;
  };
  clock.arm();
  const registered = await registerFoundryTaskAuthorization(f.context, identity, {
    inputFile: f.inputFile,
    grant: f.grant,
    evidence: [{ id: "approval", kind: "user-decision", file: f.evidence }],
    refreshIdentity,
  });
  assert.equal(clock.crossings(), 1);
  assertVerifiedFoundryIdentity(f.context, identity);
  clock.arm();
  const loaded = await loadFoundryTaskAuthorization(
    f.context,
    identity,
    f.inputFile,
    undefined,
    refreshIdentity,
  );
  assert.equal(clock.crossings(), 2);
  assert.equal(loaded.authorization_sha256, registered.authorization_sha256);
  assert.equal(loaded.expires_at_utc, f.grant.expires_at_utc);
  assert.equal(taskAuthorizationAllows(loaded, "unitgroup_write"), true);
});

for (const [scenario, code] of [
  ["expired grant", "task_authorization_expired"],
  ["different input binding", "task_authorization_binding_mismatch"],
  ["changed approval evidence", "authorization_evidence_changed"],
  ["wrong previous pointer", "authorization_update_conflict"],
] as const) {
  test(`migrated identity refresh rejects ${scenario} without activating approval`, async (t) => {
    const f = await migratedFixture(t);
    const clock = metadataClock(t, f);
    const identity = verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {});
    if (scenario === "expired grant")
      f.grant.expires_at_utc = new Date(Date.now() + 60_000).toISOString();
    if (scenario === "different input binding") f.grant.binding.input_scope_sha256 = "0".repeat(64);
    const refreshIdentity = () => {
      assert.ok(fs.existsSync(f.lock));
      const fresh = verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {});
      if (scenario === "changed approval evidence")
        fs.writeFileSync(f.evidence.path, "changed selection");
      return fresh;
    };
    clock.arm();
    await assert.rejects(
      () =>
        registerFoundryTaskAuthorization(f.context, identity, {
          inputFile: f.inputFile,
          grant: f.grant,
          evidence: [{ id: "approval", kind: "user-decision", file: f.evidence }],
          ...(scenario === "wrong previous pointer"
            ? { expectedPreviousSha256: "0".repeat(64) }
            : {}),
          refreshIdentity,
        }),
      hasCode(code),
    );
    assert.equal(clock.crossings(), 1);
    assert.equal(fs.existsSync(path.join(f.context.taskRoot!, "authorization.json")), false);
  });
}

test("migrated approval rechecks expiry after the final locked current-state verification", async (t) => {
  const f = await migratedFixture(t);
  const clock = metadataClock(t, f);
  const identity = verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {});
  let checks = 0;
  await assert.rejects(
    () =>
      registerFoundryTaskAuthorization(f.context, identity, {
        inputFile: f.inputFile,
        grant: f.grant,
        evidence: [{ id: "approval", kind: "user-decision", file: f.evidence }],
        validateCurrent() {
          if (++checks === 2) clock.advance(3_600_001);
        },
        refreshIdentity: () => verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {}),
      }),
    hasCode("task_authorization_invalid"),
  );
  assert.equal(fs.existsSync(path.join(f.context.taskRoot!, "authorization.json")), false);
});

test("an identity from a different account intent cannot enter migrated authorization refresh", async (t) => {
  const f = await migratedFixture(t);
  const identity = verifyFoundryRuntimeIdentity(f.context, { mode: "oauth" }, {});
  const differentAccount = createFoundryRuntimeContext({
    moduleUrl: new URL("../../scripts/public-api.ts", import.meta.url).href,
    workspace: f.context.workspaceRoot,
    cacheBase: f.context.cacheBase,
    workspaceAccess: {
      manifest: workspaceManifestFixture({
        schemas: ["tiangong-foundry.workspace.v1", "tiangong-foundry.workspace.v2"],
        write: ["migration-adoption-v1", "registered-tasks-v2"],
      }),
      access: "write",
    },
    taskId: f.context.taskId!,
    actorId: f.context.actorId!,
    inputs: [...f.context.inputs],
    accountIntent: { ...accountIntent, userId: "22222222-2222-4222-8222-222222222222" },
  });
  await assert.rejects(
    () =>
      registerFoundryTaskAuthorization(differentAccount, identity, {
        inputFile: f.inputFile,
        grant: f.grant,
        evidence: [{ id: "approval", kind: "user-decision", file: f.evidence }],
        refreshIdentity: () => {
          throw new Error("Account mismatch must never refresh identity.");
        },
      }),
    hasCode("identity_context_mismatch"),
  );
});
