import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import { createFoundryFacade } from "../../scripts/public-api.ts";
import { flowRow, processRowWithFlowRef } from "../fixtures/row-builders.ts";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";

for (const kind of [
  "spawn_error",
  "signal",
  "empty_stdout",
  "malformed_json",
  "invalid_report",
  "stage_rejected",
  "identity_disappeared",
  "empty_qa_contract",
  "invalid_qa_locator",
  "qa_stdout_file_mismatch",
  "qa_outside_locator",
  "qa_stale_locator",
] as const) {
  test(`public task retains ${kind} child failure and never replays it`, async (t) => {
    const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
    const seed = path.join(root, "seed.json"),
      specFile = path.join(root, "request.json");
    fs.writeFileSync(
      seed,
      JSON.stringify({ rows: [flowRow("77777777-7777-4777-8777-777777777777")] }),
    );
    fs.writeFileSync(
      specFile,
      JSON.stringify({
        schema: "tiangong-foundry.task-start.v1",
        request_id: `failure-${kind}`,
        actor_id: "failure-actor",
        lane: "source-evidence-dataset-development",
        profile_id: "generic",
        target_entities: ["flow"],
        sources: [{ path: seed }],
        seed: { path: seed },
        account_intent: null,
        preparation: null,
      }),
    );
    const started = await facade.start({ specFile });
    assert.ok(started.task_id);
    const invocation = { taskId: started.task_id, actorId: "failure-actor" };
    assert.equal((await facade.resume(invocation)).status, "ready");
    assert.equal((await facade.resume(invocation)).status, "ready");
    const original = childProcess.spawnSync;
    const originalRead = fs.readFileSync;
    let vanishedCli: string | null = null;
    if (kind === "identity_disappeared")
      t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
        if (vanishedCli !== null && String(args[0]) === vanishedCli)
          throw Object.assign(new Error("CLI vanished after dispatch"), { code: "ENOENT" });
        return originalRead(...args);
      });
    let calls = 0;
    t.mock.method(
      childProcess,
      "spawnSync",
      (...args: Parameters<typeof childProcess.spawnSync>) => {
        const argv = args[1];
        if (Array.isArray(argv) && argv[1] === "qa") {
          calls++;
          if (kind === "identity_disappeared") vanishedCli = String(argv[0]);
          if (
            kind === "qa_stdout_file_mismatch" ||
            kind === "qa_outside_locator" ||
            kind === "qa_stale_locator"
          ) {
            const child = original(...args);
            const report = JSON.parse(String(child.stdout));
            if (kind === "qa_outside_locator" || kind === "qa_stale_locator") {
              const file =
                kind === "qa_outside_locator"
                  ? path.join(root, "foreign-qa-report.json")
                  : path.join(
                      fs.realpathSync(workspace),
                      ".foundry",
                      "workspaces",
                      invocation.taskId,
                      "outputs",
                      "previous-qa-call",
                      "report.json",
                    );
              report.files.report = file;
              fs.mkdirSync(path.dirname(file), { recursive: true });
              fs.writeFileSync(file, JSON.stringify(report));
            }
            return {
              ...child,
              pid: 17,
              stdout: JSON.stringify(
                kind === "qa_stdout_file_mismatch"
                  ? { ...report, status: "incorrect-returned-observation" }
                  : report,
              ),
              stderr: "useful bounded diagnostic",
            };
          }
          return {
            pid: 17,
            output: [],
            status:
              kind === "stage_rejected"
                ? 1
                : kind === "signal" || kind === "spawn_error" || kind === "identity_disappeared"
                  ? null
                  : 0,
            signal: kind === "signal" ? "SIGTERM" : null,
            error:
              kind === "spawn_error" || kind === "identity_disappeared"
                ? Object.assign(new Error("access_token=SECRET credential failure"), {
                    code: "EACCES",
                  })
                : undefined,
            stdout:
              kind === "empty_stdout"
                ? ""
                : kind === "malformed_json"
                  ? "{broken"
                  : kind === "invalid_report"
                    ? "[]"
                    : kind === "empty_qa_contract"
                      ? "{}"
                      : kind === "invalid_qa_locator"
                        ? JSON.stringify({ status: "completed_local_flow_qa", files: {} })
                        : JSON.stringify({ error: "access_token=SECRET" }),
            stderr:
              "Authorization: Bearer secret-value\naccess_token=SECRET\nuseful bounded diagnostic",
          };
        }
        return original(...args);
      },
    );
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const failed = await facade.resume(invocation);
    vanishedCli = null;
    assert.equal(failed.status, "failed");
    assert.ok(failed.artifacts.some((item) => item.role === "workflow-child-failure.json"));
    assert.equal(calls, 1);
    const fresh = createFoundryFacade({
      workspace,
      cacheBase: path.join(root, "cache"),
      runtimeSelection,
    });
    const status = await fresh.status(invocation);
    assert.equal(status.status, "blocked", JSON.stringify(status));
    assert.equal(status.blockers[0]?.code, "workflow_child_failed");
    const artifact = status.artifacts.find((item) => item.role === "workflow-child-failure.json");
    assert.ok(artifact?.kind === "file");
    const detail = JSON.parse(fs.readFileSync(artifact.path, "utf8"));
    assert.equal(
      detail.failure.kind,
      kind === "identity_disappeared"
        ? "spawn_error"
        : kind === "empty_qa_contract" ||
            kind === "invalid_qa_locator" ||
            kind === "qa_stdout_file_mismatch" ||
            kind === "qa_outside_locator" ||
            kind === "qa_stale_locator"
          ? "stage_rejected"
          : kind,
    );
    assert.equal(detail.failure.child.pid, 17);
    assert.equal(detail.failure.invocation.argv[0], "qa");
    assert.ok(detail.operation_id);
    assert.ok(detail.failure.invocation.cli_sha256);
    if (["empty_qa_contract", "qa_stdout_file_mismatch", "qa_stale_locator"].includes(kind))
      assert.equal(detail.failure.rejection.code, "workflow_report_invalid");
    if (kind === "invalid_qa_locator")
      assert.equal(detail.failure.rejection.code, "workflow_qa_failed");
    assert.equal(JSON.stringify(detail).includes("SECRET"), false);
    assert.equal(JSON.stringify(detail).includes("secret-value"), false);
    assert.match(detail.failure.stderr.preview, /useful bounded diagnostic/u);
    const index = path.join(
      workspace,
      ".foundry/workspaces",
      invocation.taskId,
      "artifact-index.jsonl",
    );
    const receiptPath = path.join(
      workspace,
      ".foundry/workspaces",
      invocation.taskId,
      "checkpoints",
      `${detail.operation_id}.json`,
    );
    assert.equal(JSON.parse(fs.readFileSync(receiptPath, "utf8")).status, "failed");
    const before = fs.readFileSync(index);
    assert.equal((await fresh.resume(invocation)).status, "blocked");
    assert.equal(calls, 1);
    assert.deepEqual(fs.readFileSync(index), before);
    fs.appendFileSync(artifact.path, " ");
    assert.equal((await fresh.status(invocation)).status, "blocked");
    assert.notEqual((await fresh.status(invocation)).blockers[0]?.code, "workflow_child_failed");
    assert.equal(calls, 1);
  });
}

test("failed context receipts cannot become cached success or completed producers", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const seed = path.join(root, "context-seed.json"),
    specFile = path.join(root, "context-request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({ rows: [flowRow("77777777-7777-4777-8777-777777777777")] }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "context-failure",
      actor_id: "failure-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "failure-actor" };
  const original = childProcess.spawnSync;
  let calls = 0;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (Array.isArray(argv) && argv[1] === "dataset" && argv[2] === "context-pack") {
      calls++;
      return {
        pid: 23,
        output: [],
        status: 70,
        signal: null,
        stdout: "{}",
        stderr: "failure detail " + "診".repeat(20_000),
      };
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const failed = await facade.resume(invocation);
  assert.equal(failed.status, "failed");
  const artifact = failed.artifacts.find((item) => item.role === "workflow-child-failure.json");
  assert.ok(artifact?.kind === "file");
  const detail = JSON.parse(fs.readFileSync(artifact.path, "utf8"));
  assert.equal(detail.failure.kind, "exit_code");
  assert.equal(detail.failure.child.exit_code, 70);
  assert.equal(detail.failure.stderr.truncated, true);
  assert.ok(Buffer.byteLength(detail.failure.stderr.preview) <= 4096);
  assert.ok(detail.failure.stderr.bytes > 40_000);
  const context = createFoundryRuntimeContext({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    ...invocation,
    inputs: [captureFoundryInput(seed)],
  });
  const runtime = createFoundryRuntime(context, qualifyFoundryRuntime(context, runtimeSelection));
  await assert.rejects(
    () => runtime.prepareContext(["flow"]),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "workflow_child_failed",
      ),
  );
  assert.equal(calls, 1);
  const derived = createFoundryRuntime(
    createFoundryRuntimeContext({
      moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
      workspace,
      cacheBase: path.join(root, "cache"),
      ...invocation,
      inputs: [captureFoundryInput(artifact.path)],
    }),
  );
  await assert.rejects(
    () => derived.cleanup({ input: artifact.path, type: "flow" }),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "task_lineage_invalid",
      ),
  );
  assert.equal((await facade.status(invocation)).status, "blocked");
  assert.equal((await facade.resume(invocation)).status, "blocked");
  assert.equal(calls, 1);
});

for (const kind of ["structured_error", "invalid_queue_contract"] as const) {
  test(`public Process queue retains ${kind} original call without replay`, async (t) => {
    const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
    const seed = path.join(root, "queue-seed.json"),
      specFile = path.join(root, "queue-request.json");
    const flowId = "77777777-7777-4777-8777-777777777777";
    fs.writeFileSync(
      seed,
      JSON.stringify({
        rows: [
          flowRow(flowId),
          processRowWithFlowRef("88888888-8888-4888-8888-888888888888", flowId),
        ],
      }),
    );
    fs.writeFileSync(
      specFile,
      JSON.stringify({
        schema: "tiangong-foundry.task-start.v1",
        request_id: `queue-${kind}`,
        actor_id: "failure-actor",
        lane: "source-evidence-dataset-development",
        profile_id: "generic",
        target_entities: ["flow", "process"],
        sources: [{ path: seed }],
        seed: { path: seed },
        account_intent: null,
        preparation: null,
      }),
    );
    const started = await facade.start({ specFile });
    assert.ok(started.task_id);
    const invocation = { taskId: started.task_id, actorId: "failure-actor" };
    await facade.resume(invocation);
    await facade.resume(invocation);
    const original = childProcess.spawnSync;
    let calls = 0;
    t.mock.method(
      childProcess,
      "spawnSync",
      (...args: Parameters<typeof childProcess.spawnSync>) => {
        const argv = args[1];
        if (
          Array.isArray(argv) &&
          argv[1] === "dataset" &&
          argv[2] === "curation-queue" &&
          argv[3] === "build"
        ) {
          calls++;
          return {
            pid: 43,
            output: [],
            status: kind === "structured_error" ? 1 : 0,
            signal: null,
            stdout: JSON.stringify(
              kind === "structured_error"
                ? { error: "controlled queue failure" }
                : { schema_version: 1, status: "ready", out_dir: "wrong-directory" },
            ),
            stderr: "original queue diagnostic",
          };
        }
        return original(...args);
      },
    );
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const first = await facade.resume(invocation);
    assert.equal(first.status, "failed", JSON.stringify(first.blockers));
    const failure = first.artifacts.find((item) => item.role === "workflow-child-failure.json");
    assert.ok(failure?.kind === "file");
    const evidence = JSON.parse(fs.readFileSync(failure.path, "utf8"));
    assert.equal(evidence.failure.kind, "stage_rejected");
    assert.equal(evidence.failure.child.pid, 43);
    assert.equal(
      evidence.failure.rejection.code,
      kind === "invalid_queue_contract" ? "workflow_queue_invalid" : "workflow_report_invalid",
    );
    assert.match(
      evidence.failure.stdout.preview,
      kind === "structured_error" ? /controlled queue failure/u : /wrong-directory/u,
    );
    assert.equal(evidence.failure.invocation.argv[1], "curation-queue");
    assert.match(evidence.failure.stderr.preview, /original queue diagnostic/u);
    const fresh = createFoundryFacade({
      workspace,
      cacheBase: path.join(root, "cache"),
      runtimeSelection,
    });
    assert.equal((await fresh.status(invocation)).status, "blocked");
    assert.equal((await fresh.resume(invocation)).status, "blocked");
    assert.equal(calls, 1);
  });
}
