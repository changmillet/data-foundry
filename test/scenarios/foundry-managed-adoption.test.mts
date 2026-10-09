import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import {
  adoptManagedFixture,
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  managedExplicitStage,
  managedFileFact,
  managedFixtureToken,
  managedInventory,
  recordManagedReturnedAction,
  seedManagedIdentityHistory,
  type ManagedFixtureMutation,
} from "../helpers/managed-adoption-fixture.mts";

after(cleanManagedAdoptionPackage);

test("actual unmodified CLI manager directly enters the package and brands carrier qualification for plan/apply/audit", async (t) => {
  const f = await managedAdoptionFixture(t);
  const before = managedFileFact(f.managerBin);
  const adopted = await adoptManagedFixture(f);
  assert.equal(adopted.planned.permissions.state, "not_required");
  assert.deepEqual(managedFileFact(f.managerBin), before);
  const doctor = (await f.run(f.launch, ["doctor", "--workspace", f.workspace, "--json"]))
    .operation;
  assert.equal(doctor.status, "ready");
  const status = (await f.run(f.launch, f.taskArgs("status"))).operation;
  const action = status.next_actions.find((item) => item.kind === "command");
  assert.ok(action?.kind === "command", JSON.stringify(status));
  assert.equal(action.argv[action.argv.indexOf("--manifest-sha256") + 1], f.launch.trusted.sha256);
  assert.notEqual(f.launch.trusted.sha256, f.successor.trusted.sha256);
  assert.equal(action.argv[action.argv.indexOf("--entry") + 1], "foundry");
  const actionStartedAt = Date.now();
  const child = spawnSync(action.executable, [...action.argv], {
    cwd: action.cwd,
    env: f.environment,
    encoding: "utf8",
    shell: false,
    timeout: 300_000,
  });
  const actionRecord = recordManagedReturnedAction(f, action, child, actionStartedAt);
  t.diagnostic(
    JSON.stringify({
      returned_action_elapsed_ms: actionRecord.elapsed_ms,
      status: actionRecord.status,
      error: actionRecord.error,
      native_context_time_evidence: actionRecord.native_context_time_evidence,
    }),
  );
  const reentryDiagnostics = JSON.stringify({
    executable: action.executable,
    argv: action.argv,
    cwd: action.cwd,
    elapsed_ms: Date.now() - actionStartedAt,
    error: child.error
      ? {
          name: child.error.name,
          message: child.error.message,
          code: "code" in child.error ? child.error.code : null,
        }
      : null,
    status: child.status,
    signal: child.signal,
    stdout_bytes: Buffer.byteLength(child.stdout ?? ""),
    stderr_bytes: Buffer.byteLength(child.stderr ?? ""),
    stdout: child.stdout,
    stderr: child.stderr,
    carrier_manifest_sha256: f.launch.trusted.sha256,
    successor_manifest_sha256: f.successor.trusted.sha256,
  });
  assert.equal(child.error, undefined, reentryDiagnostics);
  assert.equal(child.signal, null, reentryDiagnostics);
  assert.equal(child.stderr, "", reentryDiagnostics);
  assert.equal(child.status, 0, reentryDiagnostics);
  assert.equal(JSON.parse(child.stdout).task_id, f.taskId);
  f.assertPreserved();
  t.diagnostic(
    "Actual CLI subprocess/one-use IPC/direct package entry; component metadata, task and compatibility evidence are synthetic; no auth or business write.",
  );
  f.markPassed();
});

test("ordinary argv/task self-authority cannot qualify managed adoption and read launch cannot write", async (t) => {
  const f = await managedAdoptionFixture(t);
  const before = managedInventory(f.workspace);
  const untrusted = (
    await f.run(
      f.successor,
      f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
    )
  ).operation;
  assert.equal(untrusted.blockers[0].code, "runtime_adoption_qualification_untrusted");
  const nullPolicy = await f.carrier(undefined, false);
  assert.equal(
    (
      await f.run(
        nullPolicy,
        f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
      )
    ).operation.blockers[0].code,
    "runtime_adoption_qualification_untrusted",
  );
  const readonly = (
    await f.run(
      f.launch,
      f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
      "foundry-read",
    )
  ).operation;
  assert.equal(readonly.status, "ready", "A read-only dry-run remains observational.");
  const planArtifact = readonly.artifacts.find((item) => item.role === "runtime_adoption_plan");
  assert.ok(planArtifact?.kind === "inline");
  const readonlyPlan = path.join(f.root, "read-only-adoption-plan.json");
  f.json(readonlyPlan, planArtifact.value);
  const denied = (
    await f.run(
      f.launch,
      f.taskArgs("adopt-runtime", ["--apply", "--plan", readonlyPlan]),
      "foundry-read",
    )
  ).operation;
  assert.ok(
    denied.blockers.some((item) => item.code === "workspace_read_only"),
    JSON.stringify(denied),
  );
  assert.deepEqual(managedInventory(f.workspace), before);
  f.markPassed();
});

test("actual CLI managed host refuses changed carrier, qualification, execution and component expectations", async (t) => {
  const f = await managedAdoptionFixture(t);
  const before = managedInventory(f.workspace);
  for (const mutation of [
    "control-mode",
    "control-protocol",
    "successor-product",
    "successor-launch",
    "qualification-manifest",
    "qualification-files",
    "cli-expectation",
    "node-expectation",
    "tidas-expectation",
    "entry-argv",
  ] satisfies ManagedFixtureMutation[]) {
    const bad = await f.carrier(mutation);
    const result = (
      await f.run(bad, f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]))
    ).operation;
    assert.notEqual(result.status, "ready", mutation);
    assert.ok(result.blockers.length, mutation);
    assert.deepEqual(managedInventory(f.workspace), before, mutation);
  }
  f.markPassed();
});

test("real manager + synthetic owned auth/search transport performs exact Flow3/Process1 readonly stage and preserves Source2", async (t) => {
  const f = await managedAdoptionFixture(t, true);
  const history = await seedManagedIdentityHistory(f);
  await adoptManagedFixture(f);
  const ordinary = (await f.run(f.launch, f.taskArgs("resume"), "foundry", f.authEnvironment))
    .operation;
  assert.equal(ordinary.status, "needs_input", JSON.stringify(ordinary));
  assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 0);
  const explicitArgs = f.taskArgs("resume", ["--identity-stage-input", history.descriptor]);
  const results = await Promise.all(
    [1, 2].map(() => f.run(f.launch, explicitArgs, "foundry", f.authEnvironment)),
  );
  for (const result of results)
    assert.equal(
      managedExplicitStage(result.operation).status,
      "completed",
      JSON.stringify(result.operation),
    );
  assert.deepEqual(
    results
      .map(
        (result) =>
          (managedExplicitStage(result.operation).this_invocation as { cli_invocations: number })
            .cli_invocations,
      )
      .sort(),
    [0, 4],
  );
  const stage = managedExplicitStage(results[0].operation);
  assert.deepEqual(stage.counts, {
    admitted_targets: 4,
    accepted_targets: 4,
    cli_invocations: 4,
    underlying_retrievals: null,
  });
  const duplicate = (await f.run(f.launch, explicitArgs, "foundry", f.authEnvironment)).operation;
  assert.deepEqual(managedExplicitStage(duplicate).this_invocation, {
    cli_invocations: 0,
    underlying_retrievals: null,
  });
  assert.equal(f.counts().filter((item) => item.kind === "flow").length, 3);
  assert.equal(f.counts().filter((item) => item.kind === "process").length, 1);
  assert.equal(f.counts().filter((item) => item.kind === "forbidden-write").length, 0);
  for (const call of f.counts()) {
    assert.equal(call.token_present, true);
    assert.equal(call.cache_disabled, true);
    assert.equal(call.ambient_secret_present, false);
    assert.equal(call.node_options_present, false);
  }
  assert.deepEqual(managedFileFact(history.source), history.sourceBefore);
  assert.deepEqual(managedFileFact(history.predecessor), history.predecessorBefore);
  const inspect = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (entry.isFile())
        assert.equal(fs.readFileSync(file, "utf8").includes(managedFixtureToken), false, file);
    }
  };
  inspect(f.workspace);
  inspect(path.join(f.root, "home"));
  f.assertPreserved();
  t.diagnostic(
    "Only auth/search transport is synthetic; parent CLI manager, Foundry emitted code, IPC and direct package entry are real. Credentials are process-only fake values.",
  );
  f.markPassed();
});

test("real managed subprocess preserves UNKNOWN after interrupted synthetic readonly query and never requeries", async (t) => {
  const f = await managedAdoptionFixture(t, true);
  const history = await seedManagedIdentityHistory(f);
  await adoptManagedFixture(f);
  f.setControl({ query: "interrupted" });
  const args = f.taskArgs("resume", ["--identity-stage-input", history.descriptor]);
  const first = (await f.run(f.launch, args, "foundry", f.authEnvironment)).operation;
  assert.equal(first.status, "needs_input", JSON.stringify(first));
  assert.equal(managedExplicitStage(first).new_cli_execution, null);
  f.setControl({ query: "manual" });
  const repeated = (await f.run(f.launch, args, "foundry", f.authEnvironment)).operation;
  assert.equal(repeated.status, "needs_input");
  await f.run(f.launch, f.taskArgs("status"), "foundry", f.authEnvironment);
  await f.run(f.launch, f.taskArgs("resume"), "foundry", f.authEnvironment);
  assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 1);
  assert.deepEqual(managedFileFact(history.source), history.sourceBefore);
  assert.deepEqual(managedFileFact(history.predecessor), history.predecessorBefore);
  f.assertPreserved();
  f.markPassed();
});

test("managed cli-auth admits neither wrong account, stale receipt, auth error nor incomplete process credentials", async (t) => {
  const f = await managedAdoptionFixture(t, true);
  const history = await seedManagedIdentityHistory(f);
  await adoptManagedFixture(f);
  for (const auth of ["wrong-account", "stale", "error"]) {
    f.setControl({ auth });
    const result = (
      await f.run(
        f.launch,
        f.taskArgs("resume", ["--identity-stage-input", history.descriptor]),
        "foundry",
        f.authEnvironment,
      )
    ).operation;
    assert.equal(result.status, "needs_auth", JSON.stringify(result));
    assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 0);
  }
  const result = (
    await f.run(
      f.launch,
      f.taskArgs("resume", ["--identity-stage-input", history.descriptor]),
      "foundry",
      { ...f.authEnvironment, TIANGONG_LCA_ACCESS_TOKEN: "" },
    )
  ).operation;
  assert.ok(
    result.blockers.some((item) => item.code === "managed_authentication_invalid"),
    JSON.stringify(result),
  );
  assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 0);
  f.assertPreserved();
  f.markPassed();
});
