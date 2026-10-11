import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { runFoundryTaskOperation } from "../../scripts/lib/foundry-task-store.ts";
import { registerWorkflowStageFiles } from "../../scripts/lib/foundry-workflow-io.ts";
import type { FoundryTaskOperation, JsonRecord } from "../../scripts/lib/foundry-task-types.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const hasCode = (expected: string) => (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === expected);

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-artifact-capture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.json");
  fs.writeFileSync(source, '{"source":"synthetic"}\n');
  const options = {
    moduleUrl,
    workspace: path.join(root, "项目 workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: "artifact-capture-task",
    actorId: "synthetic-actor",
    inputs: [captureFoundryInput(source)],
  });
  const bootstrap = { stage: "bootstrap" };
  await runFoundryTaskOperation(
    context,
    { command: "dataset-workflow-assessment", options: { fixture: "bootstrap" } },
    (operation) => {
      operation.writeJson("outputs/bootstrap.json", bootstrap);
      return bootstrap;
    },
  );
  const write = (relative: string, content: string | Buffer) => {
    const file = path.join(context.taskRoot!, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, content);
    return file;
  };
  const indexFile = path.join(context.taskRoot!, "artifact-index.jsonl");
  return { root, source, options, context, write, indexFile };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function run(
  f: Fixture,
  name: string,
  operation: (transaction: FoundryTaskOperation) => JsonRecord,
) {
  return runFoundryTaskOperation(
    f.context,
    { command: "dataset-workflow-assessment", options: { fixture: name } },
    operation,
  );
}

function recordedOutputs(f: Fixture, operationId: string) {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.context.taskRoot!, `checkpoints/${operationId}.json`), "utf8"),
  );
  return receipt.outputs as { path: string; bytes: number; sha256: string }[];
}

function afterFirstCapture(t: TestContext, file: string, mutate: () => void, ordinal = 1) {
  const open = fs.openSync;
  const close = fs.closeSync;
  let descriptor: number | null = null;
  let captures = 0;
  let changed = false;
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const opened = open(...args);
    if (!changed && typeof args[0] === "string" && path.resolve(args[0]) === file)
      descriptor = opened;
    return opened;
  });
  t.mock.method(fs, "closeSync", (fd: number) => {
    close(fd);
    if (!changed && fd === descriptor) {
      descriptor = null;
      captures++;
      if (captures === ordinal) {
        changed = true;
        mutate();
      }
    }
  });
  return () => assert.equal(changed, true, "The owned file capture reached the mutation hook.");
}

async function refusesWithoutPublication(
  f: Fixture,
  name: string,
  expectedCode: string,
  body: (operation: FoundryTaskOperation) => JsonRecord,
) {
  const before = fs.readFileSync(f.indexFile);
  let operationId: string | undefined;
  await assert.rejects(
    () =>
      run(f, name, (operation) => {
        operationId = operation.operationId;
        return body(operation);
      }),
    hasCode(expectedCode),
  );
  assert.ok(operationId, "Failure must occur inside the admitted transaction.");
  assert.deepEqual(fs.readFileSync(f.indexFile), before);
  assert.equal(
    fs.existsSync(path.join(f.context.taskRoot!, `checkpoints/${operationId}.json`)),
    false,
  );
}

test("existing binary and empty artifacts retain bytes, facts and first-registration order", async (t) => {
  const f = await fixture(t);
  const binaryBytes = Buffer.from([0, 255, 128, 13, 10, 0]);
  const binary = f.write("outputs/stage/binary.bin", binaryBytes);
  const empty = f.write("evidence/stage/empty.bin", Buffer.alloc(0));
  const facts = [captureFoundryInput(binary), captureFoundryInput(empty)];
  const prefix = fs.readFileSync(f.indexFile);
  let operationId = "";
  const report = { stage: "stable" };
  await run(f, "stable", (operation) => {
    operationId = operation.operationId;
    operation.registerExistingFiles([binary, empty]);
    operation.registerExistingFiles([binary]);
    operation.writeJson("outputs/stable-report.json", report);
    return report;
  });
  assert.deepEqual(fs.readFileSync(binary), binaryBytes);
  assert.deepEqual(fs.readFileSync(empty), Buffer.alloc(0));
  const outputs = recordedOutputs(f, operationId);
  assert.deepEqual(
    outputs.map((output) => output.path),
    ["outputs/stage/binary.bin", "evidence/stage/empty.bin", "outputs/stable-report.json"],
  );
  for (const [position, fact] of facts.entries()) {
    assert.equal(outputs[position].bytes, fact.bytes);
    assert.equal(outputs[position].sha256, fact.sha256);
  }
  const index = fs.readFileSync(f.indexFile);
  assert.deepEqual(index.subarray(0, prefix.length), prefix);
  const appended = index.subarray(prefix.length).toString().trim().split("\n");
  assert.deepEqual(
    appended.map((line) => JSON.parse(line).path),
    outputs.map((output) => output.path),
  );
});

test("stage walking preserves sorted-child depth-first roster and receipt order", async (t) => {
  const f = await fixture(t);
  const nested = f.write("outputs/walk/a/z.bin", Buffer.from([255, 0]));
  const sibling = f.write("outputs/walk/a.txt", "sibling\n");
  const last = f.write("outputs/walk/z.txt", "last\n");
  const report = { stage: "walk" };
  let operationId = "";
  let roster: string[] = [];
  await run(f, "walk", (operation) => {
    operationId = operation.operationId;
    roster = registerWorkflowStageFiles(f.context, operation, path.dirname(sibling));
    operation.writeJson("outputs/walk-report.json", report);
    return report;
  });
  assert.deepEqual(roster, [nested, sibling, last]);
  assert.deepEqual(
    recordedOutputs(f, operationId).map((output) => output.path),
    [
      "outputs/walk/a/z.bin",
      "outputs/walk/a.txt",
      "outputs/walk/z.txt",
      "outputs/walk-report.json",
    ],
  );
  assert.deepEqual(fs.readFileSync(nested), Buffer.from([255, 0]));
});

test("multiple accepted-output directories retain one complete capture roster and receipt order", async (t) => {
  const f = await fixture(t);
  const nested = f.write("outputs/first/a/z.bin", Buffer.from([0, 255]));
  const sibling = f.write("outputs/first/a.txt", "sibling\n");
  const last = f.write("outputs/first/z.txt", "last\n");
  const empty = f.write("evidence/second/empty.bin", Buffer.alloc(0));
  const firstRoot = path.dirname(sibling);
  const secondRoot = path.dirname(empty);
  const prefix = fs.readFileSync(f.indexFile);
  let captures = 0;
  let operationId = "";
  let roster: string[] = [];
  const report = { stage: "selected-roots" };
  await run(f, "selected-roots", (operation) => {
    operationId = operation.operationId;
    roster = registerWorkflowStageFiles(
      f.context,
      {
        ...operation,
        registerExistingFiles(files) {
          captures++;
          operation.registerExistingFiles(files);
        },
      },
      [firstRoot, secondRoot, firstRoot],
    );
    operation.writeJson("outputs/selected-roots-report.json", report);
    return report;
  });
  assert.equal(captures, 1);
  assert.deepEqual(roster, [nested, sibling, last, empty, nested, sibling, last]);
  assert.deepEqual(
    recordedOutputs(f, operationId).map((output) => output.path),
    [
      "outputs/first/a/z.bin",
      "outputs/first/a.txt",
      "outputs/first/z.txt",
      "evidence/second/empty.bin",
      "outputs/selected-roots-report.json",
    ],
  );
  assert.deepEqual(fs.readFileSync(nested), Buffer.from([0, 255]));
  assert.deepEqual(fs.readFileSync(empty), Buffer.alloc(0));
  assert.deepEqual(fs.readFileSync(f.indexFile).subarray(0, prefix.length), prefix);
});

test("a later control-record directory refuses the complete selected-root capture without publication", async (t) => {
  const f = await fixture(t);
  const selected = f.write("outputs/selected/artifact.bin", "unchanged\n");
  await refusesWithoutPublication(
    f,
    "selected-control",
    "task_output_role_invalid",
    (operation) => {
      registerWorkflowStageFiles(f.context, operation, [
        path.dirname(selected),
        path.join(f.context.taskRoot!, "checkpoints"),
      ]);
      const report = { stage: "selected-control" };
      operation.writeJson("outputs/selected-control-report.json", report);
      return report;
    },
  );
  assert.equal(fs.readFileSync(selected, "utf8"), "unchanged\n");
});

test("an early-root file changed during whole-roster capture refuses every selected root", async (t) => {
  const f = await fixture(t);
  const first = f.write("outputs/early/artifact.bin", "original\n");
  const last = f.write("evidence/late/artifact.bin", "stable\n");
  const reached = afterFirstCapture(t, first, () => fs.writeFileSync(first, "changed\n"));
  await refusesWithoutPublication(f, "selected-change", "task_artifact_changed", (operation) => {
    registerWorkflowStageFiles(f.context, operation, [path.dirname(first), path.dirname(last)]);
    const report = { stage: "selected-change" };
    operation.writeJson("outputs/selected-change-report.json", report);
    return report;
  });
  reached();
  assert.equal(fs.readFileSync(last, "utf8"), "stable\n");
});

test("existing-file registration cannot escape its closed task transaction", async (t) => {
  const f = await fixture(t);
  const existing = f.write("outputs/closed.bin", "retained\n");
  const report = { stage: "closed" };
  let retained: FoundryTaskOperation | undefined;
  await run(f, "closed", (operation) => {
    retained = operation;
    operation.writeJson("outputs/closed-report.json", report);
    return report;
  });
  const before = fs.readFileSync(f.indexFile);
  assert.throws(
    () => retained!.registerExistingFiles([existing]),
    hasCode("task_operation_closed"),
  );
  assert.throws(() => retained!.registerExistingFiles([]), hasCode("task_operation_closed"));
  assert.deepEqual(fs.readFileSync(f.indexFile), before);
  assert.equal(fs.readFileSync(existing, "utf8"), "retained\n");
});

for (const [name, file, expected] of [
  ["source-control", "source-manifest.json", "task_output_role_invalid"],
  ["checkpoint-control", "checkpoints/foreign.json", "task_output_role_invalid"],
  [
    "consumed-control",
    `attempts/owner-v1/${"a".repeat(64)}/consumed.json`,
    "task_output_role_invalid",
  ],
  ["contained-traversal", "outputs/../source-manifest.json", "task_output_role_invalid"],
  ["missing-output", "outputs/missing.bin", "ENOENT"],
] as const) {
  test(`existing-file registration rejects ${name}`, async (t) => {
    const f = await fixture(t);
    if (name === "checkpoint-control" || name === "consumed-control") f.write(file, "control\n");
    await refusesWithoutPublication(f, name, expected, (operation) => {
      operation.registerExistingFiles([file]);
      const report = { stage: name };
      operation.writeJson(`outputs/${name}-report.json`, report);
      return report;
    });
  });
}

test("existing-file registration has no consumed-marker exception even for the consume owner", async (t) => {
  const f = await fixture(t);
  const marker = f.write(`attempts/owner-v1/${"b".repeat(64)}/consumed.json`, "control\n");
  const before = fs.readFileSync(f.indexFile);
  await assert.rejects(
    () =>
      runFoundryTaskOperation(
        f.context,
        { command: "dataset-workflow-execution-consume", options: { fixture: "consumed" } },
        (operation) => {
          operation.registerExistingFiles([marker]);
          const report = { stage: "consumed" };
          operation.writeJson("outputs/consumed-report.json", report);
          return report;
        },
      ),
    hasCode("task_output_role_invalid"),
  );
  assert.deepEqual(fs.readFileSync(f.indexFile), before);
  assert.equal(fs.readFileSync(marker, "utf8"), "control\n");
});

for (const name of ["workspace-file", "other-task-file", "escaping-traversal"] as const) {
  test(`existing-file registration rejects ${name}`, async (t) => {
    const f = await fixture(t);
    const file =
      name === "other-task-file"
        ? path.join(f.context.controlRoot, "workspaces", "other-task", "outputs", "file.bin")
        : path.join(f.root, "outside.bin");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "outside\n");
    const selected =
      name === "escaping-traversal" ? path.relative(f.context.taskRoot!, file) : file;
    await refusesWithoutPublication(f, name, "path_outside_root", (operation) => {
      operation.registerExistingFiles([selected]);
      const report = { stage: name };
      operation.writeJson(`outputs/${name}-report.json`, report);
      return report;
    });
    assert.equal(fs.readFileSync(file, "utf8"), "outside\n");
  });
}

test("existing-file registration rejects a directory as a regular artifact", async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.context.taskRoot!, "outputs", "not-a-file");
  fs.mkdirSync(directory);
  await refusesWithoutPublication(f, "nonregular", "regular_file_required", (operation) => {
    operation.registerExistingFiles([directory]);
    const report = { stage: "nonregular" };
    operation.writeJson("outputs/nonregular-report.json", report);
    return report;
  });
});

test("existing-file registration rejects a symlink or junction ancestor", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside-directory");
  fs.mkdirSync(outside);
  const bytes = Buffer.from([0, 128, 255]);
  fs.writeFileSync(path.join(outside, "artifact.bin"), bytes);
  const alias = path.join(f.context.taskRoot!, "outputs", "alias");
  try {
    fs.symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && hasCode("EPERM")(error)) {
      t.skip("This Windows host does not permit a directory junction.");
      return;
    }
    throw error;
  }
  await refusesWithoutPublication(f, "symlink", "symlink_not_allowed", (operation) => {
    operation.registerExistingFiles([path.join(alias, "artifact.bin")]);
    const report = { stage: "symlink" };
    operation.writeJson("outputs/symlink-report.json", report);
    return report;
  });
  assert.deepEqual(fs.readFileSync(path.join(outside, "artifact.bin")), bytes);
});

test("output drift between fresh captures refuses completion and preserves the changed file", async (t) => {
  const f = await fixture(t);
  const artifact = f.write("outputs/drifting.bin", Buffer.from([0, 255, 1]));
  const changedBytes = Buffer.from([0, 255, 2]);
  const observed = afterFirstCapture(t, artifact, () => fs.writeFileSync(artifact, changedBytes));
  await refusesWithoutPublication(f, "output-drift", "task_artifact_changed", (operation) => {
    operation.registerExistingFiles([artifact]);
    const report = { stage: "output-drift" };
    operation.writeJson("outputs/output-drift-report.json", report);
    return report;
  });
  observed();
  assert.deepEqual(fs.readFileSync(artifact), changedBytes);
});

test("a refused late output capture cannot publish earlier batch facts when the caller records refusal", async (t) => {
  const f = await fixture(t);
  const first = f.write("outputs/late/first.bin", "first\n");
  const last = f.write("outputs/late/last.bin", "last\n");
  const reached = afterFirstCapture(t, last, () => fs.appendFileSync(last, "changed\n"));
  let operationId = "";
  await run(f, "late-refusal", (operation) => {
    operationId = operation.operationId;
    assert.throws(
      () => operation.registerExistingFiles([first, last]),
      hasCode("task_artifact_changed"),
    );
    const report = { stage: "refused" };
    operation.writeJson("outputs/late-refusal-report.json", report);
    return report;
  });
  reached();
  assert.deepEqual(
    recordedOutputs(f, operationId).map((fact) => fact.path),
    ["outputs/late-refusal-report.json"],
  );
  assert.equal(fs.readFileSync(first, "utf8"), "first\n");
  assert.equal(fs.readFileSync(last, "utf8"), "last\nchanged\n");
});

test("mutating the caller roster cannot remove an originally selected file from revalidation", async (t) => {
  const f = await fixture(t);
  const first = f.write("outputs/roster/first.bin", "first\n");
  const last = f.write("outputs/roster/last.bin", "last\n");
  const roster = [first, last];
  const reached = afterFirstCapture(t, last, () => {
    roster.pop();
    fs.appendFileSync(last, "changed\n");
  });
  await refusesWithoutPublication(f, "roster-drift", "task_artifact_changed", (operation) => {
    operation.registerExistingFiles(roster);
    const report = { stage: "unexpected" };
    operation.writeJson("outputs/roster-drift-report.json", report);
    return report;
  });
  reached();
  assert.deepEqual(roster, [first]);
});

for (const [name, code] of [
  ["source", "task_source_changed"],
  ["job", "task_snapshot_changed"],
  ["actor", "task_actor_mismatch"],
  ["profile-lock", "task_snapshot_changed"],
  ["workspace-writer", "workspace_runtime_selection_mismatch"],
] as const) {
  test(`${name} drift during existing-output capture refuses completed publication`, async (t) => {
    const f = await fixture(t);
    const artifact = f.write(`outputs/${name}-stage.bin`, "owner output\n");
    const observed = afterFirstCapture(t, artifact, () => {
      if (name === "source") fs.appendFileSync(f.source, " ");
      else if (name === "profile-lock")
        fs.appendFileSync(path.join(f.context.taskRoot!, "profile-lock.json"), " ");
      else if (name === "workspace-writer") {
        const record = {
          schema: "tiangong-foundry.workspace-runtime-selection.v1",
          workspace_id: f.context.workspaceId,
          request_id: "synthetic-writer-change",
          actor_id: "synthetic-actor",
          previous_manifest_sha256: "a".repeat(64),
          selected_manifest_sha256: "b".repeat(64),
          access: "read",
          lease_ids: ["synthetic-old", "synthetic-new"],
        };
        fs.writeFileSync(
          path.join(f.context.stateRoot, "runtime-selection.json"),
          JSON.stringify({ ...record, record_sha256: sha256Json(record) }),
        );
      } else {
        const jobFile = path.join(f.context.taskRoot!, "foundry-job.json");
        const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
        if (name === "actor") job.actor_id = "different-actor";
        else job.created_at_utc = "2020-01-01T00:00:00.000Z";
        fs.writeFileSync(jobFile, JSON.stringify(job));
      }
    });
    await refusesWithoutPublication(f, `${name}-drift`, code, (operation) => {
      operation.registerExistingFiles([artifact]);
      const report = { stage: `${name}-drift` };
      operation.writeJson(`outputs/${name}-drift-report.json`, report);
      return report;
    });
    observed();
    assert.equal(fs.readFileSync(artifact, "utf8"), "owner output\n");
  });
}

test("selected derived-input drift during capture cannot publish a successor receipt", async (t) => {
  const f = await fixture(t);
  const selected = path.join(f.context.taskRoot!, "outputs/bootstrap.json");
  f.context = createFoundryRuntimeContext({
    ...f.options,
    taskId: f.context.taskId!,
    actorId: f.context.actorId!,
    inputs: [captureFoundryInput(selected)],
  });
  const artifact = f.write("outputs/derived-input-stage.bin", "owner output\n");
  const observed = afterFirstCapture(t, artifact, () => fs.appendFileSync(selected, " "));
  await refusesWithoutPublication(f, "derived-input-drift", "input_changed", (operation) => {
    operation.registerExistingFiles([artifact]);
    const report = { stage: "derived-input-drift" };
    operation.writeJson("outputs/derived-input-drift-report.json", report);
    return report;
  });
  observed();
  assert.equal(fs.readFileSync(artifact, "utf8"), "owner output\n");
});

test("capturing an existing JSON file does not replace exact returned-report recording", async (t) => {
  const f = await fixture(t);
  const report = { stage: "capture-is-not-write-json" };
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const reportFile = f.write("outputs/captured-report.json", bytes);
  await refusesWithoutPublication(
    f,
    "unrecorded-result",
    "task_result_not_recorded",
    (operation) => {
      operation.registerExistingFiles([reportFile]);
      return report;
    },
  );
  assert.deepEqual(fs.readFileSync(reportFile), bytes);
});

for (const caught of [false, true]) {
  test(`final capture job drift refuses publication when its failure is ${caught ? "caught" : "propagated"}`, async (t) => {
    const f = await fixture(t);
    const artifact = f.write("outputs/final-capture.bin", "retained\n");
    const reached = afterFirstCapture(
      t,
      artifact,
      () => {
        const jobFile = path.join(f.context.taskRoot!, "foundry-job.json");
        const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
        job.created_at_utc = "2020-01-01T00:00:00.000Z";
        fs.writeFileSync(jobFile, JSON.stringify(job));
      },
      2,
    );
    await refusesWithoutPublication(
      f,
      `final-job-drift-${caught}`,
      "task_snapshot_changed",
      (operation) => {
        const report = { stage: "reported-before-capture" };
        operation.writeJson("outputs/final-capture-report.json", report);
        if (caught)
          assert.throws(
            () => operation.registerExistingFiles([artifact]),
            hasCode("task_snapshot_changed"),
          );
        else operation.registerExistingFiles([artifact]);
        return report;
      },
    );
    reached();
    assert.equal(fs.readFileSync(artifact, "utf8"), "retained\n");
  });
}

test("completed receipt replay revalidates captured outputs without rerunning the callback", async (t) => {
  const f = await fixture(t);
  const artifact = f.write("outputs/replay-stage.bin", "retained\n");
  const report = { stage: "replay" };
  await run(f, "replay", (operation) => {
    operation.registerExistingFiles([artifact]);
    operation.writeJson("outputs/replay-report.json", report);
    return report;
  });
  const before = fs.readFileSync(f.indexFile);
  const replay = () =>
    run(f, "replay", () => {
      assert.fail("A completed receipt must not execute or capture a new stage.");
    });
  assert.deepEqual(await replay(), report);
  assert.deepEqual(fs.readFileSync(f.indexFile), before);
  fs.appendFileSync(artifact, "changed\n");
  await assert.rejects(replay, hasCode("task_artifact_changed"));
  assert.deepEqual(fs.readFileSync(f.indexFile), before);
});

test("artifact-index CAS retains a competing index instead of publishing captured outputs", async (t) => {
  const f = await fixture(t);
  const artifact = f.write("outputs/cas-stage.bin", "owner output\n");
  const before = fs.readFileSync(f.indexFile);
  const competing = Buffer.concat([before, Buffer.from("competing-index-writer\n")]);
  const observed = afterFirstCapture(t, artifact, () => fs.writeFileSync(f.indexFile, competing));
  const report = { stage: "cas" };
  await assert.rejects(
    () =>
      run(f, "cas", (operation) => {
        operation.registerExistingFiles([artifact]);
        operation.writeJson("outputs/cas-report.json", report);
        return report;
      }),
    hasCode("task_index_conflict"),
  );
  observed();
  assert.deepEqual(fs.readFileSync(f.indexFile), competing);
  assert.deepEqual(fs.readFileSync(f.indexFile).subarray(0, before.length), before);
  assert.equal(fs.readFileSync(artifact, "utf8"), "owner output\n");
});
