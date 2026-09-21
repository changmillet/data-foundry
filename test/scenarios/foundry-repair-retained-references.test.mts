import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { repairWorkflowFixture, repairDataCalls } from "../fixtures/foundry-repair-workflow.ts";
import { retainContactReference } from "../fixtures/foundry-retained-reference-workflow.ts";

type Json = Record<string, unknown>;
for (const noChange of [true, false])
  test(`repair retains exact old references without changing generic quality status: noChange=${noChange}`, async (t) => {
    const f = repairWorkflowFixture(t, noChange ? { candidateText: "Original source" } : {});
    retainContactReference(t);
    const start = await f.facade.start({ specFile: f.specFile });
    const invoke = { taskId: String(start.task_id), actorId: "identity-actor" };
    const result = await f.facade.resume(invoke);
    assert.equal(
      result.status,
      noChange ? "completed" : "needs_input",
      JSON.stringify(result.blockers),
    );
    const artifacts = result.artifacts as { path: string }[];
    const preparation = artifacts.find((item) =>
      item.path.endsWith("foundry-repair-preflight.json"),
    );
    assert.ok(preparation);
    const report = JSON.parse(fs.readFileSync(preparation.path, "utf8"));
    assert.equal(report.status, noChange ? "no_change_verified" : "prepared");
    assert.equal(report.publication_ready, false);
    const raw = artifacts.filter(
      (item) => item.path.includes("verify-remote") && item.path.endsWith("owner-report.json"),
    );
    assert.ok(raw.length);
    for (const file of raw) {
      const value = JSON.parse(fs.readFileSync(file.path, "utf8"));
      assert.equal(value.status, "blocked_remote_verification");
      assert.equal(value.counts.blockers, 1);
    }
    const calls = repairDataCalls(f).length;
    assert.equal((await f.facade.status(invoke)).status, result.status);
    assert.equal((await f.facade.resume(invoke)).status, result.status);
    assert.equal(repairDataCalls(f).length, calls);
    assert.equal(
      repairDataCalls(f).some((call) => call.argv.includes("--commit")),
      false,
    );
  });
test("an outdated label without exact referenced-version evidence remains blocked", async (t) => {
  const f = repairWorkflowFixture(t, { candidateText: "Original source" });
  retainContactReference(t, { missingExact: true });
  const start = await f.facade.start({ specFile: f.specFile });
  const result = await f.facade.resume({
    taskId: String(start.task_id),
    actorId: "identity-actor",
  });
  assert.equal(result.status, "needs_input");
  assert.ok((result.blockers as Json[]).some((item) => item.code === "repair_preflight_blocked"));
  assert.equal(
    repairDataCalls(f).some((call) => call.argv.includes("--commit")),
    false,
  );
});

test("a plausible retained-reference report from a different declared input is refused", async (t) => {
  const f = repairWorkflowFixture(t, { candidateText: "Original source" });
  retainContactReference(t, { reportInputPath: "/different/candidate.json" });
  const start = await f.facade.start({ specFile: f.specFile });
  const result = await f.facade.resume({
    taskId: String(start.task_id),
    actorId: "identity-actor",
  });
  assert.equal(result.status, "needs_input");
  assert.equal(
    repairDataCalls(f).some((call) => call.argv.includes("--commit")),
    false,
  );
  const artifacts = result.artifacts as { path: string }[];
  const entry = artifacts.find((item) => item.path.endsWith("foundry-repair-preflight.json"));
  assert.ok(entry);
  const report = JSON.parse(fs.readFileSync(entry.path, "utf8"));
  assert.equal(report.status, "blocked");
  assert.match(JSON.stringify(report.blockers), /input/i);
});
