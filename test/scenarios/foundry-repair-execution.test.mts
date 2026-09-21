import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { repairWorkflowFixture, repairDataCalls } from "../fixtures/foundry-repair-workflow.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

for (const scenario of ["success", "wrong-owner-readback", "missing-receipt"] as const)
  test(`repair execution ${scenario}: native receipt, exact readback and no replay`, async (t) => {
    const f = repairWorkflowFixture(t);
    const delegated = childProcess.spawnSync;
    let commits = 0;
    t.mock.method(
      childProcess,
      "spawnSync",
      (...args: Parameters<typeof childProcess.spawnSync>) => {
        const argv = Array.isArray(args[1]) ? args[1] : [];
        if (!argv.includes("--commit")) return delegated(...args);
        assert.equal(argv[1], "dataset");
        assert.equal(argv[2], "save-draft");
        commits++;
        const option = (name: string) => String(argv[argv.indexOf(name) + 1]);
        const contractFile = option("--execution-contract");
        const contract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
        const action = contract.actions[0];
        const output = path.join(
          option("--out-dir"),
          "outputs",
          "dataset-save-draft",
          "summary.json",
        );
        const report = {
          schema_version: 2,
          status: "completed",
          mode: "commit",
          commit: true,
          requested_type: "process",
          input_path: option("--input"),
          counts: {
            selected: 1,
            prepared: 0,
            executed: 1,
            failed: 0,
            blocked: 0,
            unknown: 0,
            attempts_consumed: 1,
          },
          execution_contract: {
            path: contractFile,
            sha256: sha256Json(contract),
            execution_id: contract.execution_id,
            target_mode: "owner_draft",
          },
          files: { summary_json: output },
          rows: [
            {
              index: 0,
              type: "process",
              table: action.table,
              id: action.id,
              version: action.version,
              action_id: action.action_id,
              desired_sha256: action.desired_sha256,
              status: "executed",
              operation: "save_draft",
              attempt_consumed: true,
              replayed: false,
              readback: "desired_exact",
            },
          ],
        };
        fs.mkdirSync(path.dirname(output), { recursive: true });
        if (scenario !== "missing-receipt") fs.writeFileSync(output, JSON.stringify(report));
        const stdout = JSON.stringify(report);
        const result: childProcess.SpawnSyncReturns<string> = {
          status: 0,
          signal: null,
          stdout,
          stderr: "",
          pid: 1,
          output: [null, stdout, ""],
        };
        return result;
      },
    );
    syncBuiltinESMExports();
    t.after(() => syncBuiltinESMExports());
    const started = await f.facade.start({ specFile: f.specFile });
    const invocation = { taskId: String(started.task_id), actorId: "identity-actor" };
    await f.facade.resume(invocation);
    const approval = f.approval(invocation.taskId);
    const approved = await f.facade.resume({
      ...invocation,
      authorizationInputFile: approval.file,
    });
    assert.equal(
      (approved.permissions as Record<string, unknown>).state,
      "granted",
      JSON.stringify(approved.blockers),
    );
    await f.facade.resume(invocation);
    if (scenario === "wrong-owner-readback") f.rootReadback.remoteUserId = "foreign-owner";
    let completed = await f.facade.resume(invocation);
    if (scenario !== "success") {
      assert.equal(completed.status, "needs_input");
      assert.equal(commits, 1);
      const unresolved = await f.facade.resume(invocation);
      assert.equal(unresolved.status, "needs_input");
      assert.equal(commits, 1, "unresolved readback may never replay the mutation");
      if (scenario === "missing-receipt") return;
      f.rootReadback.remoteUserId = null;
      completed = await f.facade.resume(invocation);
    }
    assert.equal(commits, 1, JSON.stringify(completed.blockers));
    const reports = (completed.artifacts as { path: string }[])
      .filter((item) => item.path.endsWith("owner-execution-result.json"))
      .map((item) => JSON.parse(fs.readFileSync(item.path, "utf8")));
    assert.equal(
      completed.status,
      "completed",
      JSON.stringify({ blockers: completed.blockers, reports }),
    );
    const calls = repairDataCalls(f).length;
    assert.equal((await f.facade.status(invocation)).status, "completed");
    assert.equal((await f.facade.resume(invocation)).status, "completed");
    assert.equal(commits, 1);
    assert.equal(repairDataCalls(f).length, calls);
  });

test("a no-change repair rejects an abnormal validator exit despite a plausible report", async (t) => {
  const f = repairWorkflowFixture(t, { candidateText: "Original source" });
  const delegated = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const result = delegated(...args);
    const argv = Array.isArray(args[1]) ? args[1] : [];
    return argv[1] === "dataset" && argv[2] === "validate" ? { ...result, status: 2 } : result;
  });
  syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());
  const started = await f.facade.start({ specFile: f.specFile });
  const resumed = await f.facade.resume({
    taskId: String(started.task_id),
    actorId: "identity-actor",
  });
  assert.equal(resumed.status, "needs_input");
  assert.equal(
    repairDataCalls(f).some(
      (call) => call.argv.includes("--commit") || call.verb === "verify-remote",
    ),
    false,
  );
  const artifact = (resumed.artifacts as { path: string }[]).find((item) =>
    item.path.endsWith("foundry-repair-preflight.json"),
  );
  assert.ok(artifact);
  const report = JSON.parse(fs.readFileSync(artifact.path, "utf8"));
  assert.equal(report.blockers[0].code, "repair_cli_failed");
});
