import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import * as failures from "../../scripts/lib/foundry-workflow-child-failure.ts";
import { bytes, digest } from "../../scripts/lib/foundry-task-io.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
  type FoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import {
  runFoundryTaskOperation,
  readVerifiedTaskSnapshot,
  verifyFoundryTaskArtifactLineage,
} from "../../scripts/lib/foundry-task-store.ts";
import { registerWorkflowStageFiles } from "../../scripts/lib/foundry-workflow-io.ts";
const cli = fileURLToPath(new URL("../../scripts/runtime-entry.ts", import.meta.url));
const qualification = { qualification_sha256: "f".repeat(64) } as QualifiedFoundryRuntime;
function failure(
  argv: readonly string[],
  stdout: string,
  stderr = "",
  context: FoundryRuntimeContext = { workspaceRoot: import.meta.dirname } as FoundryRuntimeContext,
) {
  return failures.workflowChildFailure(
    failures.bindWorkflowChildExecution(context, qualification, cli, argv),
    { pid: 17, output: [], status: 0, signal: null, stdout, stderr },
    "malformed_json",
  );
}
function report(evidence: unknown) {
  return {
    schema: "tiangong-foundry.workflow-operation-failure.v1",
    status: "failed",
    task_id: `task-${"a".repeat(64)}-r0001`,
    operation_id: "b".repeat(64),
    command: "dataset-workflow-assessment",
    input_scope_sha256: "c".repeat(64),
    failure: evidence,
  };
}
function longArgv() {
  const argv = [
    "qa",
    "process",
    "--rows-file",
    "/probe/process.rows.json",
    "--out-dir",
    "/probe/output",
    "--json",
  ];
  for (let i = 0; i < 128; i++)
    argv.push(
      "--reference-rows-file",
      `/probe/${"p".repeat(331)}/${String(i).padStart(3, "0")}.json`,
    );
  return argv;
}
test("the independent 128-reference/CJK probe stays within the reader's total receipt budget", () => {
  const argv = longArgv();
  const error = failure(argv, "malformed " + "界".repeat(4096), "界".repeat(4096));
  assert.ok(bytes(report(error.evidence)).length <= 64 * 1024);
  const invocation = error.evidence.invocation as Record<string, unknown>;
  assert.equal(invocation.argv_sha256, sha256Json(argv));
  assert.equal(invocation.argv_count, argv.length);
  assert.equal(invocation.argv_truncated, true);
});
test("Unicode and escaped preview boundaries preserve full stream facts and sanitize controls first", () => {
  for (const text of [
    "界".repeat(4096),
    '"\\\n\r\t\ud800'.repeat(4096),
    "Bea\0rer SECRET\naccess_tok\0en=SECRET",
    "https://user:" + "PRIVATE".repeat(4096) + "@host/",
  ]) {
    const error = failure(["qa", "flow", text], text, text);
    const diagnostic = error.evidence.stdout as Record<string, unknown>;
    assert.ok(Buffer.byteLength(String(diagnostic.preview)) <= 4096);
    assert.equal(diagnostic.bytes, Buffer.byteLength(text));
    assert.equal(diagnostic.sha256, digest(Buffer.from(text)));
    assert.equal(String(diagnostic.preview).includes("SECRET"), false);
    assert.equal(String(diagnostic.preview).includes("PRIVATE"), false);
    assert.ok(bytes(report(error.evidence)).length <= 64 * 1024);
  }
});
test("ordinary short invocation facts and actual read-only cwd remain complete", () => {
  const argv = ["qa", "flow", "--json"];
  const context = { workspaceRoot: import.meta.dirname } as FoundryRuntimeContext;
  const error = failure(argv, "short diagnostic", "", context);
  const invocation = error.evidence.invocation as Record<string, unknown>;
  assert.deepEqual(invocation.argv, argv);
  assert.equal(invocation.argv_count, argv.length);
  assert.equal(invocation.argv_truncated, false);
  assert.equal(invocation.cwd, context.workspaceRoot);
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.cli_path, cli);
});

test("the actual metadata writer's capped record is readable without child calls or replay", async (t) => {
  let childCalls = 0;
  t.mock.method(childProcess, "spawnSync", () => {
    childCalls++;
    throw new Error("metadata validation must not spawn a child");
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-failure-bounds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.json");
  fs.writeFileSync(source, "{}");
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: "bounded-task",
    actorId: "bounds-actor",
    inputs: [captureFoundryInput(source)],
  });
  const argv = longArgv();
  let calls = 0;
  const optionsForOperation = {
    command: "dataset-workflow-assessment" as const,
    options: { fixture: "bounded-failure" },
  };
  await assert.rejects(
    () =>
      runFoundryTaskOperation(context, optionsForOperation, () => {
        calls++;
        throw failure(argv, "界".repeat(4096), "界".repeat(4096), context);
      }),
    { code: "workflow_child_failed" },
  );
  const snapshot = readVerifiedTaskSnapshot(context);
  const retained = failures.readWorkflowChildFailure(context, snapshot.index);
  assert.ok(retained);
  assert.throws(
    () => verifyFoundryTaskArtifactLineage(context, snapshot.task, [...snapshot.index]),
    { code: "task_lineage_invalid" },
    "diagnostic-only history is ineligible for completed-producer runtime adoption",
  );
  assert.ok(retained.entry.bytes <= failures.workflowFailureArtifactLimit);
  const invocation = retained.failure.invocation as Record<string, unknown>;
  assert.equal(invocation.argv_count, argv.length);
  assert.equal(invocation.argv_sha256, sha256Json(argv));
  assert.equal(invocation.argv_truncated, true);
  await assert.rejects(
    () =>
      runFoundryTaskOperation(context, optionsForOperation, () => {
        calls++;
        throw new Error("must not re-enter callback");
      }),
    { code: "workflow_child_failed" },
  );
  assert.equal(calls, 1);
  assert.equal(childCalls, 0);
});

test("the exact serialized wrapper budget includes JSON escaping and preserves identity on fallback", () => {
  const argv = Array.from({ length: 2000 }, () => '\\"界\t');
  const initial = failure(argv, '\\"'.repeat(10_000), '\\"'.repeat(10_000));
  const wrapped = report(initial.evidence);
  // Independent fixture overhead exercises the writer's final measured wrapper, beyond constructor reservation.
  wrapped.task_id = "bounded-fixture-" + "x".repeat(30_000);
  const serialized = failures.serializeWorkflowFailureResult(wrapped);
  assert.ok(serialized.length <= failures.workflowFailureArtifactLimit);
  const parsed = JSON.parse(serialized.toString("utf8"));
  assert.equal(parsed.failure.invocation.argv_count, argv.length);
  assert.equal(parsed.failure.invocation.argv_sha256, sha256Json(argv));
  assert.equal(parsed.failure.invocation.cwd, import.meta.dirname);
  assert.equal(parsed.failure.invocation.executable, process.execPath);
  assert.equal(parsed.failure.invocation.cli_path, cli);
  assert.equal(parsed.failure.stdout.sha256, digest(Buffer.from('\\"'.repeat(10_000))));
});

test("display regex and split work only on bounded text while the complete long stream is hashed", (t) => {
  const long = "A".repeat(16 * 1024 * 1024);
  const original: unknown = Object.getOwnPropertyDescriptor(String.prototype, "replace")?.value;
  if (typeof original !== "function") throw new Error("native String.replace must be available");
  let largest = 0;
  t.mock.method(
    String.prototype,
    "replace",
    function (this: string, ...args: Parameters<typeof String.prototype.replace>) {
      largest = Math.max(largest, this.length);
      return String(Reflect.apply(original, this, args));
    },
  );
  const error = failure(["qa", "flow"], long);
  assert.ok(largest < 64 * 1024, `preview work received ${largest} characters`);
  const detail = error.evidence.stdout as Record<string, unknown>;
  assert.equal(detail.bytes, long.length);
  assert.equal(detail.sha256, digest(Buffer.from(long)));
  assert.equal(detail.truncated, true);
  assert.ok(Buffer.byteLength(String(detail.preview)) <= failures.workflowFailurePreviewLimit);
});

test("fallback clipping keeps redaction stable and protects complete invocation path facts", () => {
  const root = "/" + "界".repeat(30_000);
  const context = { workspaceRoot: root } as FoundryRuntimeContext;
  const argv = longArgv();
  const error = failure(
    argv,
    "access_tok\0en=SECRET ".repeat(600),
    "Bea\0rer SECRET ".repeat(600),
    context,
  );
  const record = JSON.parse(
    failures.serializeWorkflowFailureResult(report(error.evidence)).toString("utf8"),
  );
  assert.ok(bytes(record).length <= failures.workflowFailureArtifactLimit);
  assert.equal(record.failure.invocation.cwd_sha256, digest(Buffer.from(root)));
  assert.equal(record.failure.invocation.cwd_relative, "");
  assert.equal(record.failure.preview_sources["invocation.cwd"].bytes, Buffer.byteLength(root));
  assert.equal(record.failure.preview_sources["invocation.cwd"].sha256, digest(Buffer.from(root)));
  assert.ok(record.failure.truncated_fields.includes("invocation.cwd"));
  assert.equal(JSON.stringify(record).includes("SECRET"), false);
  assert.equal(record.failure.invocation.argv_sha256, sha256Json(argv));
  assert.equal(record.failure.invocation.argv_count, argv.length);
});

async function captureFixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-failure-capture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.json");
  fs.writeFileSync(source, "{}\n");
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: "failure-capture-task",
    actorId: "synthetic-actor",
    inputs: [captureFoundryInput(source)],
  });
  await runFoundryTaskOperation(
    context,
    { command: "dataset-workflow-assessment", options: { fixture: "bootstrap" } },
    (operation) => {
      const result = { stage: "bootstrap" };
      operation.writeJson("outputs/bootstrap.json", result);
      return result;
    },
  );
  const write = (relative: string) => {
    const file = path.join(context.taskRoot!, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "partial owner output\n");
    return file;
  };
  return { context, source, write };
}

test("a child rejection after two-root capture indexes only its failed diagnostic", async (t) => {
  const { context, write } = await captureFixture(t);
  const first = write("outputs/original-run/partial.bin");
  const second = write("outputs/registered-output/partial.bin");
  const before = readVerifiedTaskSnapshot(context).index;
  let calls = 0;
  const input = {
    command: "dataset-workflow-assessment" as const,
    options: { fixture: "capture-then-fail" },
  };
  const body = () =>
    runFoundryTaskOperation(context, input, (operation) => {
      calls++;
      registerWorkflowStageFiles(context, operation, [path.dirname(first), path.dirname(second)]);
      operation.writeJson("outputs/partial-report.json", { stage: "partial" });
      throw failure(["qa", "process"], "invalid original result", "", context);
    });
  await assert.rejects(body, { code: "workflow_child_failed" });
  const after = readVerifiedTaskSnapshot(context).index;
  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(after.length, before.length + 1);
  assert.equal(after.at(-1)?.command, failures.workflowFailureCommand);
  const retained = failures.readWorkflowChildFailure(context, after);
  assert.ok(retained);
  for (const file of [first, second]) {
    assert.equal(fs.readFileSync(file, "utf8"), "partial owner output\n");
    assert.equal(
      after.some((entry) => entry.path === path.relative(context.taskRoot!, file)),
      false,
    );
  }
  const receipt = JSON.parse(
    fs.readFileSync(path.join(context.taskRoot!, retained.entry.receipt.path), "utf8"),
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.outputs.length, 1);
  assert.equal(receipt.outputs[0].path, retained.entry.path);
  await assert.rejects(body, { code: "workflow_child_failed" });
  assert.equal(calls, 1);
});

for (const [name, code] of [
  ["source", "task_source_changed"],
  ["job", "task_snapshot_changed"],
  ["profile-lock", "task_snapshot_changed"],
  ["workspace-writer", "workspace_runtime_selection_mismatch"],
] as const) {
  test(`a child failure cannot publish diagnostic authority after ${name} drift`, async (t) => {
    const { context, source, write } = await captureFixture(t);
    const file = write("outputs/captured/partial.bin");
    const indexFile = path.join(context.taskRoot!, "artifact-index.jsonl");
    const before = fs.readFileSync(indexFile);
    let operationId = "";
    await assert.rejects(
      () =>
        runFoundryTaskOperation(
          context,
          { command: "dataset-workflow-assessment", options: { fixture: name } },
          (operation) => {
            operationId = operation.operationId;
            operation.registerExistingFiles([file]);
            if (name === "source") fs.appendFileSync(source, " ");
            else if (name === "profile-lock")
              fs.appendFileSync(path.join(context.taskRoot!, "profile-lock.json"), " ");
            else if (name === "job") {
              const jobFile = path.join(context.taskRoot!, "foundry-job.json");
              const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
              job.created_at_utc = "2020-01-01T00:00:00.000Z";
              fs.writeFileSync(jobFile, JSON.stringify(job));
            } else {
              const record = {
                schema: "tiangong-foundry.workspace-runtime-selection.v1",
                workspace_id: context.workspaceId,
                request_id: "synthetic-writer-change",
                actor_id: "synthetic-actor",
                previous_manifest_sha256: "a".repeat(64),
                selected_manifest_sha256: "b".repeat(64),
                access: "read",
                lease_ids: ["synthetic-old", "synthetic-new"],
              };
              fs.writeFileSync(
                path.join(context.stateRoot, "runtime-selection.json"),
                JSON.stringify({ ...record, record_sha256: sha256Json(record) }),
              );
            }
            throw failure(["qa", "process"], "original failed result", "", context);
          },
        ),
      { code },
    );
    assert.ok(operationId);
    assert.deepEqual(fs.readFileSync(indexFile), before);
    assert.equal(
      fs.existsSync(path.join(context.taskRoot!, `checkpoints/${operationId}.json`)),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          context.taskRoot!,
          `evidence/failures/${operationId}/${failures.workflowFailureFile}`,
        ),
      ),
      false,
    );
  });
}
