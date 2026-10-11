import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import {
  adoptManagedFixture,
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  managedFileFact,
  recordManagedReturnedAction,
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
