import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  appendForgedArtifact,
  repairDataCalls,
  repairTaskRoot,
  repairWorkflowFixture,
  type RepairDispatchFailure,
  type RepairWorkflowFixture,
} from "../fixtures/foundry-repair-workflow.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

type Json = Record<string, unknown>;
const actorId = "identity-actor";
const refusal = "facade_predecessor_readback_required";

function blockersOf(result: Json): string[] {
  const blockers = Array.isArray(result.blockers) ? result.blockers : [];
  return blockers.map((item) =>
    typeof item === "string" ? item : String((item as Json).code ?? ""),
  );
}

function permissionsOf(result: Json): Json {
  const value = result.permissions;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** Drive one repair task to its terminal no-dispatch failure (or the requested anomaly). */
async function dispatchFailure(
  fixture: RepairWorkflowFixture,
  knobs: RepairDispatchFailure = {},
): Promise<string> {
  fixture.dispatch = knobs;
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const invocation = { taskId, actorId };
  await fixture.facade.resume(invocation);
  const approval = fixture.approval(taskId);
  const approved = await fixture.facade.resume({
    ...invocation,
    authorizationInputFile: approval.file,
  });
  assert.equal(
    permissionsOf(approved).state,
    "granted",
    `the predecessor must be authorized before its dispatch: ${JSON.stringify(approved.blockers)}`,
  );
  await fixture.facade.resume(invocation);
  const failed = await fixture.facade.resume(invocation);
  assert.equal(
    failed.status,
    "needs_input",
    `a failed dispatch stays unresolved: ${JSON.stringify(failed.blockers)}`,
  );
  return taskId;
}

/** Serve one successful native commit so a successor can complete after its own authorization. */
function installSuccessfulCommitMock(t: TestContext): { commits: () => number } {
  const delegated = childProcess.spawnSync;
  let commits = 0;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = Array.isArray(args[1]) ? args[1] : [];
    if (!argv.includes("--commit")) return delegated(...args);
    assert.equal(argv[1], "dataset");
    assert.equal(argv[2], "save-draft");
    commits += 1;
    const option = (name: string) => String(argv[argv.indexOf(name) + 1]);
    const contractFile = option("--execution-contract");
    const contract = JSON.parse(fs.readFileSync(contractFile, "utf8")) as Json;
    const action = (contract.actions as Json[])[0];
    const output = path.join(option("--out-dir"), "outputs", "dataset-save-draft", "summary.json");
    const report: Json = {
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
        by_table: { processes: 1 },
      },
      files: { summary_json: output },
      execution_contract: {
        path: contractFile,
        sha256: sha256Json(contract),
        execution_id: contract.execution_id,
        target_mode: "owner_draft",
      },
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
    fs.writeFileSync(output, JSON.stringify(report));
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
  });
  syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());
  return { commits: () => commits };
}

test("a no-dispatch failure admits one real successor that continues to a single verified closeout", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  await t.test("the successor is admitted and re-verified on status and resume", async () => {
    const successor = fixture.successor(predecessor, receipt, {
      candidateText: "Renamed source two",
    });
    const started = await fixture.facade.start({ specFile: successor.specFile });
    assert.equal(
      started.status,
      "ready",
      `the successor must be admitted: ${JSON.stringify(started.blockers)}`,
    );
    assert.notEqual(String(started.task_id), predecessor);
    assert.equal(
      blockersOf(started).includes(refusal),
      false,
      "an admissible successor never reports the refusal",
    );
    const successorId = String(started.task_id);
    // The successor's own first resume runs its read-only preflight exactly once.
    const first = await fixture.facade.resume({ taskId: successorId, actorId });
    assert.notEqual(first.status, "blocked", JSON.stringify(first.blockers));
    const calls = repairDataCalls(fixture).length;
    const status = await fixture.facade.status({ taskId: successorId, actorId });
    assert.equal(status.status, first.status, JSON.stringify(status.blockers));
    const resumed = await fixture.facade.resume({ taskId: successorId, actorId });
    assert.equal(resumed.status, first.status, JSON.stringify(resumed.blockers));
    assert.equal(
      repairDataCalls(fixture).length,
      calls,
      "re-projecting the descendant must not call the owner CLI again",
    );
  });
  await t.test("the successor authorizes independently and closes out once", async () => {
    const successor = fixture.successor(predecessor, receipt, {
      candidateText: "Renamed source two",
    });
    const started = await fixture.facade.start({ specFile: successor.specFile });
    const successorId = String(started.task_id);
    fixture.dispatch = null;
    const commits = installSuccessfulCommitMock(t);
    const invocation = { taskId: successorId, actorId };
    await fixture.facade.resume(invocation);
    const approval = fixture.approval(successorId);
    const approved = await fixture.facade.resume({
      ...invocation,
      authorizationInputFile: approval.file,
    });
    assert.equal(
      permissionsOf(approved).state,
      "granted",
      `a new revision never inherits the predecessor grant: ${JSON.stringify(approved.blockers)}`,
    );
    await fixture.facade.resume(invocation);
    const completed = await fixture.facade.resume(invocation);
    assert.equal(completed.status, "completed", JSON.stringify(completed.blockers));
    assert.equal(commits.commits(), 1, "a successor dispatches exactly once");
    const terminal = (completed.artifacts as { path: string }[]).find((item) =>
      item.path.endsWith("owner-execution-result.json"),
    );
    assert.ok(terminal, "the successor must register its terminal execution result");
    assert.equal((JSON.parse(fs.readFileSync(terminal.path, "utf8")) as Json).status, "verified");
    assert.equal(
      fs.existsSync(path.join(repairTaskRoot(fixture, predecessor), "attempts", "owner-v1")),
      true,
      "the predecessor's attempt evidence is preserved",
    );
  });
});

test("a successor never inherits an existing grant and is refused without its own authorization", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    candidateText: "Renamed source two",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  const successorId = String(started.task_id);
  const resumed = await fixture.facade.resume({ taskId: successorId, actorId });
  assert.equal(resumed.status, "needs_input", JSON.stringify(resumed.blockers));
  assert.equal(
    permissionsOf(resumed).state,
    "required",
    "the successor must still request explicit authorization",
  );
});

for (const [label, knobs] of [
  ["a consumed CLI attempt", { attemptsConsumed: 1 }],
  ["an executed action", { executed: 1 }],
  ["an unknown outcome", { unknown: 1 }],
  ["a non-terminal prepared row", { rowStatus: "prepared" }],
] as const)
  test(`a predecessor whose report shows ${label} admits no successor`, async (t) => {
    const fixture = repairWorkflowFixture(t);
    const predecessor = await dispatchFailure(fixture, knobs);
    const receipt = fixture.terminalReportSha256(predecessor);
    const successor = fixture.successor(predecessor, receipt);
    const started = await fixture.facade.start({ specFile: successor.specFile });
    assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
    assert.ok(
      blockersOf(started).includes(refusal),
      `${label} must be refused: ${JSON.stringify(started.blockers)}`,
    );
  });

test("a successor naming an unregistered terminal report digest is refused", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const successor = fixture.successor(predecessor, "f".repeat(64));
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
  assert.ok(blockersOf(started).includes(refusal), JSON.stringify(started.blockers));
});

for (const [label, options] of [
  ["another request", { requestId: "repair-other-request" }],
  ["another actor", { actorId: "another-actor" }],
  [
    "another account",
    {
      account: {
        project_ref: "zyxwvutsrqponmlkjihg",
        user_id: "99999999-9999-4999-8999-999999999999",
      },
    },
  ],
] as const)
  test(`a successor from ${label} is refused`, async (t) => {
    const fixture = repairWorkflowFixture(t);
    const predecessor = await dispatchFailure(fixture);
    const receipt = fixture.terminalReportSha256(predecessor);
    const successor = fixture.successor(predecessor, receipt, options);
    const calls = repairDataCalls(fixture).length;
    const started = await fixture.facade.start({ specFile: successor.specFile });
    assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
    // The refusals use the established predecessor code, or an equal-or-earlier existing guard
    // (a foreign actor is already stopped by the task actor binding).
    assert.ok(
      blockersOf(started).includes(refusal) || blockersOf(started).includes("task_actor_mismatch"),
      `${label} must be refused: ${JSON.stringify(started.blockers)}`,
    );
    assert.equal(repairDataCalls(fixture).length, calls, `${label}: nothing may be dispatched`);
  });

test("an unchanged candidate is never re-dispatched under a new execution id", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, { onlyExecutionId: true });
  const calls = repairDataCalls(fixture).length;
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
  assert.ok(blockersOf(started).includes(refusal), JSON.stringify(started.blockers));
  assert.equal(repairDataCalls(fixture).length, calls, "a refused successor dispatches nothing");
});

test("a successor that mints a new version is refused", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    candidateText: "Renamed source two",
    version: "02.00.000",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
  assert.ok(blockersOf(started).includes(refusal), JSON.stringify(started.blockers));
});

test("a predecessor with a second consumed scope is refused", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const ownerRoot = path.join(repairTaskRoot(fixture, predecessor), "attempts", "owner-v1");
  fs.mkdirSync(path.join(ownerRoot, sha256Json({ task: predecessor, type: "flow" })), {
    recursive: true,
  });
  const successor = fixture.successor(predecessor, receipt, {
    candidateText: "Renamed source two",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
  assert.ok(blockersOf(started).includes(refusal), JSON.stringify(started.blockers));
});

test("a verified predecessor still requires its original owner", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const predecessor = String(started.task_id);
  const invocation = { taskId: predecessor, actorId };
  await fixture.facade.resume(invocation);
  const approval = fixture.approval(predecessor);
  await fixture.facade.resume({ ...invocation, authorizationInputFile: approval.file });
  await fixture.facade.resume(invocation);
  const commits = installSuccessfulCommitMock(t);
  const completed = await fixture.facade.resume(invocation);
  assert.equal(completed.status, "completed", JSON.stringify(completed.blockers));
  assert.equal(commits.commits(), 1);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    candidateText: "Renamed source two",
  });
  const refused = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(refused.status, "ready", JSON.stringify(refused.blockers));
  assert.ok(blockersOf(refused).includes(refusal), JSON.stringify(refused.blockers));
});

test("a deleted or replaced predecessor terminal evidence stops projecting the descendant", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    candidateText: "Renamed source two",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  const successorId = String(started.task_id);
  assert.equal(started.status, "ready", JSON.stringify(started.blockers));
  const taskRoot = repairTaskRoot(fixture, predecessor);
  const index = fs.readFileSync(path.join(taskRoot, "artifact-index.jsonl"), "utf8");
  const resultEntry = index
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json)
    .findLast(
      (entry) =>
        entry.command === "dataset-workflow-execution-result" &&
        typeof entry.path === "string" &&
        entry.path.endsWith("owner-execution-result.json"),
    );
  assert.ok(resultEntry, "the predecessor registers one terminal result");
  const resultFile = path.join(taskRoot, String(resultEntry.path));
  const original = fs.readFileSync(resultFile);
  fs.rmSync(resultFile);
  try {
    const status = await fixture.facade.status({ taskId: successorId, actorId });
    assert.notEqual(status.status, "ready", JSON.stringify(status.blockers));
    const resumed = await fixture.facade.resume({ taskId: successorId, actorId });
    assert.notEqual(resumed.status, "ready", JSON.stringify(resumed.blockers));
  } finally {
    fs.writeFileSync(resultFile, original);
  }
  assert.equal(
    (await fixture.facade.status({ taskId: successorId, actorId })).status,
    "ready",
    "restoring the exact predecessor evidence restores the same verdict",
  );
});

test("a fresh before over the same identities admits a successor that then closes out once", async (t) => {
  const fixture = repairWorkflowFixture(t);
  // The stored draft drifted, so the predecessor's own dispatch failed before consuming an attempt.
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    beforeText: "Drifted stored source",
    candidateText: "Renamed from the drifted source",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.equal(
    started.status,
    "ready",
    `a fresh before over the same identities must be admitted: ${JSON.stringify(started.blockers)}`,
  );
  const successorId = String(started.task_id);
  fixture.dispatch = null;
  const commits = installSuccessfulCommitMock(t);
  const invocation = { taskId: successorId, actorId };
  await fixture.facade.resume(invocation);
  const approval = fixture.approval(successorId);
  const approved = await fixture.facade.resume({
    ...invocation,
    authorizationInputFile: approval.file,
  });
  assert.equal(
    permissionsOf(approved).state,
    "granted",
    `the fresh-before successor still authorizes explicitly: ${JSON.stringify(approved.blockers)}`,
  );
  await fixture.facade.resume(invocation);
  const completed = await fixture.facade.resume(invocation);
  assert.equal(completed.status, "completed", JSON.stringify(completed.blockers));
  assert.equal(commits.commits(), 1, "one successor, one dispatch");
});

test("a successor whose candidate changes shared-science content is blocked by its own preflight", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    beforeText: "Drifted stored source",
  });
  // A scientific delta relative to the successor's own before rows, not a metadata-only edit.
  const candidate = JSON.parse(fs.readFileSync(successor.candidateFile, "utf8")) as Json;
  const exchange = (candidate.processDataSet as Json).exchanges as Json;
  (exchange.exchange as Json[])[0]["meanAmount"] = "2.5";
  fs.writeFileSync(successor.candidateFile, `${JSON.stringify(candidate)}\n`);
  const contract = JSON.parse(fs.readFileSync(successor.contractFile, "utf8")) as Json;
  (contract.actions as Json[])[0]["desired_sha256"] = sha256Json(candidate);
  fs.writeFileSync(successor.contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  // The successor's own repair scope rules refuse the scientific delta before any CLI work.
  const calls = repairDataCalls(fixture).length;
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
  assert.ok(
    blockersOf(started).includes("repair_provider_impact_diagnostics_missing"),
    `the successor's own scope rules must refuse a science delta: ${JSON.stringify(started.blockers)}`,
  );
  assert.equal(
    repairDataCalls(fixture).length,
    calls,
    "a refused successor scope never dispatches or reads the owner CLI",
  );
});

test("overwriting a predecessor source byte refuses the successor", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const predecessor = await dispatchFailure(fixture);
  const receipt = fixture.terminalReportSha256(predecessor);
  const beforeFile = path.join(
    repairTaskRoot(fixture, predecessor),
    "..",
    "..",
    "..",
    "repair-inputs",
  );
  void beforeFile;
  const source = fixture.beforeFile;
  const original = fs.readFileSync(source);
  fs.writeFileSync(source, `${original.toString("utf8").trim()}\n `);
  try {
    const successor = fixture.successor(predecessor, receipt, {
      candidateText: "Renamed source two",
    });
    const started = await fixture.facade.start({ specFile: successor.specFile });
    assert.notEqual(started.status, "ready", JSON.stringify(started.blockers));
  } finally {
    fs.writeFileSync(source, original);
  }
});

/** The raw index entries of one task, for tests that must inspect the chained ledger itself. */
function taskIndexEntries(fixture: RepairWorkflowFixture, taskId: string): Json[] {
  return fs
    .readFileSync(path.join(repairTaskRoot(fixture, taskId), "artifact-index.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
}

test("a forged index entry that borrows another operation receipt cannot fake the verdict", async (t) => {
  const fixture = repairWorkflowFixture(t);
  // Start from an inadmissible predecessor: its own report consumed a CLI attempt.
  const predecessor = await dispatchFailure(fixture, { attemptsConsumed: 1 });
  const receipt = fixture.terminalReportSha256(predecessor);
  const taskRoot = repairTaskRoot(fixture, predecessor);
  // Forge a consistent admissible-looking observation, report and result, chained onto the index
  // with recomputed hashes but only a borrowed receipt.
  const realResult = JSON.parse(
    fs.readFileSync(
      path.join(
        taskRoot,
        String(
          (
            taskIndexEntries(fixture, predecessor).findLast(
              (entry) =>
                entry.command === "dataset-workflow-execution-result" &&
                typeof entry.path === "string" &&
                entry.path.endsWith("owner-execution-result.json"),
            ) as Json
          ).path,
        ),
      ),
      "utf8",
    ),
  ) as Json;
  const report = {
    schema_version: 2,
    status: "completed_with_failures",
    mode: "commit",
    commit: true,
    requested_type: "process",
    input_path: path.resolve(fixture.workspace, "repair-inputs/repair-candidate.jsonl"),
    counts: {
      selected: 1,
      prepared: 0,
      executed: 0,
      failed: 1,
      blocked: 0,
      unknown: 0,
      attempts_consumed: 0,
      by_table: { processes: 1 },
    },
    execution_contract: {
      path: path.resolve(fixture.workspace, "repair-inputs/repair-contract.json"),
      sha256: fixture.canonicalContractSha256,
      execution_id: "repair-public-1",
      target_mode: "owner_draft",
    },
    rows: [
      {
        index: 0,
        type: "process",
        table: "processes",
        id: "11111111-1111-4111-8111-111111111111",
        version: "01.00.000",
        action_id: "repair-1",
        desired_sha256: sha256Json(fixture.candidatePayload),
        status: "failed",
        operation: "save_draft",
        attempt_consumed: false,
        replayed: false,
        readback: "not_performed",
      },
    ],
  };
  const reportEntry = appendForgedArtifact(fixture, predecessor, {
    relativePath: "outputs/forged/dispatch-observation-report.json",
    command: "dataset-workflow-execution-observation",
    content: `${JSON.stringify(report, null, 2)}\n`,
  });
  const observation = {
    schema: "tiangong-foundry.dispatch-observation.v1",
    request_sha256: String(realResult.request_sha256),
    disposition: "failed",
    exit_code: 1,
    signal: null,
    report: {
      path: reportEntry.path,
      bytes: reportEntry.bytes,
      sha256: reportEntry.sha256,
    },
    blockers: [],
  };
  appendForgedArtifact(fixture, predecessor, {
    relativePath: "outputs/forged/dispatch-observation.json",
    command: "dataset-workflow-execution-observation",
    content: `${JSON.stringify(observation, null, 2)}\n`,
  });
  const result = {
    schema: "tiangong-foundry.owner-execution-result.v1",
    status: "unresolved",
    request_sha256: String(realResult.request_sha256),
    scope_id: sha256Json({ task: predecessor, type: "process" }),
    dataset_type: "process",
    input: { path: "unused", bytes: 0, sha256: "0".repeat(64) },
    attempt_consumed: true,
    observation,
    readback: null,
    batch_item_status: "failed",
    failure_code: "owner_execution_unresolved",
    batch_status: "completed",
  };
  appendForgedArtifact(fixture, predecessor, {
    relativePath: "outputs/forged/owner-execution-result.json",
    command: "dataset-workflow-execution-result",
    content: `${JSON.stringify(result, null, 2)}\n`,
  });
  // The successor names the forged report's digest, so every content check passes on the forged
  // world; only the producer-receipt walk can tell that no operation ever produced these bytes.
  void receipt;
  const successor = fixture.successor(predecessor, String(reportEntry.sha256), {
    candidateText: "Renamed source two",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(
    started.status,
    "ready",
    `a borrowed receipt must never authorize a successor: ${JSON.stringify(started.blockers)}`,
  );
  assert.equal(taskRoot.endsWith(predecessor), true);
});

test("a predecessor report whose counts contradict its rows is refused", async (t) => {
  const fixture = repairWorkflowFixture(t);
  // The row is blocked while the summary claims one failed action: internally inconsistent evidence.
  const predecessor = await dispatchFailure(fixture, { rowStatus: "blocked", countsFailed: 1 });
  const receipt = fixture.terminalReportSha256(predecessor);
  const successor = fixture.successor(predecessor, receipt, {
    candidateText: "Renamed source two",
  });
  const started = await fixture.facade.start({ specFile: successor.specFile });
  assert.notEqual(
    started.status,
    "ready",
    `counts that disagree with the row distribution must be refused: ${JSON.stringify(started.blockers)}`,
  );
  assert.ok(blockersOf(started).includes(refusal), JSON.stringify(started.blockers));
});
