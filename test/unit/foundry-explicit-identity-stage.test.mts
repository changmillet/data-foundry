import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  readFoundryTaskArtifactIndex,
  runFoundryTaskOperation,
} from "../../scripts/lib/foundry-task-store.ts";
import { runExplicitFoundryIdentityStage } from "../../scripts/lib/foundry-workflow-identity-stage.ts";
import { selectFoundryIdentityStageInput } from "../../scripts/lib/foundry-identity-stage-input.ts";
import type { FoundryAuthentication } from "../../scripts/lib/foundry-runtime-identity.ts";
import { explicitIdentityStageFixture } from "../fixtures/explicit-identity-stage.ts";

const headless: FoundryAuthentication = {
  mode: "headless",
  accessToken: "explicit-stage-fixture-process-token-not-a-credential",
  apiBaseUrl: "https://qgzvkongdjqiiamzbbts.supabase.co",
  publishableKey: "explicit-stage-fixture-public-key",
};

test("headless stage retains its explicit mode and genuine disabled-cache receipt without credentials", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const result = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    f.prefix,
    selected,
    headless,
  );
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.authentication_mode, "headless");
  assert.equal(f.counts().queries, 1);
  const index = readFoundryTaskArtifactIndex(f.context);
  const preparation = index.find((entry) => entry.path.endsWith("identity-stage-preparation.json"));
  const claim = index.find((entry) => entry.path.endsWith("dispatch.json"));
  assert.ok(preparation && claim);
  for (const entry of [preparation, claim]) {
    const value = JSON.parse(
      fs.readFileSync(path.join(f.context.taskRoot!, entry.path), "utf8"),
    ) as { authentication_mode: string };
    assert.equal(value.authentication_mode, "headless");
  }
  for (const entry of index)
    assert.equal(
      fs
        .readFileSync(path.join(f.context.taskRoot!, entry.path), "utf8")
        .includes(headless.accessToken),
      false,
    );
  const duplicate = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    index,
    selected,
    headless,
  );
  assert.equal(duplicate.status, "completed");
  assert.deepEqual(duplicate.this_invocation, { cli_invocations: 0, underlying_retrievals: null });
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      readFoundryTaskArtifactIndex(f.context),
      selected,
      { mode: "oauth" },
    ),
    /intent-authentication-mode-changed/u,
  );
  assert.equal(f.counts().queries, 1);
  f.assertPreserved();
});

test("an OAuth stage cannot change its explicit authentication mode on duplicate admission", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const result = await runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected);
  assert.equal(result.status, "completed");
  const counts = f.counts();
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      readFoundryTaskArtifactIndex(f.context),
      selected,
      headless,
    ),
    /intent-authentication-mode-changed/u,
  );
  assert.deepEqual(f.counts(), counts);
});

for (const investigate of [false, true]) {
  test(`registered ${investigate ? "investigation" : "question"} blocks explicit identity admission before authentication`, async (t) => {
    const f = await explicitIdentityStageFixture(t);
    await f.recordQuestion("flow", investigate);
    await assert.rejects(
      runExplicitFoundryIdentityStage(
        f.context,
        f.qualified,
        readFoundryTaskArtifactIndex(f.context),
        f.selection(),
      ),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code ===
          (investigate ? "interaction_investigation_pending" : "interaction_decision_pending"),
    );
    assert.deepEqual(f.counts(), { queries: 0, authCalls: 0 });
    f.assertPreserved();
  });
}

test("Source2 questions retain the existing global interaction gate while Source2 remains outside query scope", async (t) => {
  const f = await explicitIdentityStageFixture(t, true, true);
  await f.recordQuestion("source");
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      readFoundryTaskArtifactIndex(f.context),
      f.selection(),
    ),
    (error) =>
      error instanceof Error && "code" in error && error.code === "interaction_decision_pending",
  );
  assert.deepEqual(f.counts(), { queries: 0, authCalls: 0 });
  f.assertPreserved();
});

test("a genuine question registered during the query blocks adoption under the metadata lock", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  let registered: Promise<void> | undefined;
  f.beforeSearch(() => {
    registered = f.recordQuestion("flow");
  });
  await assert.rejects(
    runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected),
    (error) =>
      error instanceof Error && "code" in error && error.code === "interaction_decision_pending",
  );
  await registered;
  assert.equal(f.counts().queries, 1);
  assert.equal(
    readFoundryTaskArtifactIndex(f.context).filter(
      (entry) => entry.command === "dataset-workflow-identity",
    ).length,
    1,
  );
  f.assertPreserved();
});

test("explicit read-only stage durably binds receipt, request, roster and runtime before each search", async (t) => {
  const f = await explicitIdentityStageFixture(t, true);
  const selected = f.selection();
  f.beforeSearch(() => {
    const entries = readFoundryTaskArtifactIndex(f.context);
    assert.ok(
      entries.some(
        (entry) =>
          entry.command === "dataset-workflow-identity-stage-prepare" &&
          entry.path.endsWith("runtime-cli-inventory.json"),
      ),
    );
    assert.ok(entries.some((entry) => entry.path.endsWith("roster.json")));
    assert.ok(
      entries.some((entry) =>
        entry.path.endsWith("dataset-identity-preflight-query-audit-report.json"),
      ),
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry.command === "dataset-workflow-identity-stage-dispatch" &&
          entry.path.endsWith("identity-receipt.json"),
      ),
    );
    assert.ok(entries.some((entry) => entry.path.endsWith("dispatch.json")));
  });
  const result = await runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.explicit_new_stage, true);
  assert.equal(result.new_cli_execution, true);
  assert.deepEqual(result.counts, {
    admitted_targets: 2,
    accepted_targets: 2,
    cli_invocations: 2,
    underlying_retrievals: null,
  });
  assert.equal(f.counts().queries, 2);
  f.assertPreserved();
  const again = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.deepEqual(
    { ...again, this_invocation: undefined },
    { ...result, this_invocation: undefined },
  );
  assert.deepEqual(again.this_invocation, { cli_invocations: 0, underlying_retrievals: null });
  assert.equal(f.counts().queries, 2);
});

test("concurrent duplicate intent invokes each admitted target once", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const results = await Promise.all(
    [1, 2].map(() => runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected)),
  );
  assert.equal(results[0].status, "completed", JSON.stringify(results));
  assert.deepEqual(
    { ...results[0], this_invocation: undefined },
    { ...results[1], this_invocation: undefined },
  );
  assert.deepEqual(
    results
      .map((result) => (result.this_invocation as { cli_invocations: number }).cli_invocations)
      .sort(),
    [0, 1],
  );
  assert.equal(f.counts().queries, 1);
  f.assertPreserved();
});

test("exact Flow3/Process1 admission groups downstream sets and preserves Source2 without queries", async (t) => {
  const f = await explicitIdentityStageFixture(t, true, true);
  const sourceBefore = fs.readFileSync(f.rowFiles[2]);
  const result = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    f.prefix,
    f.selection(),
  );
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(result.counts, {
    admitted_targets: 4,
    accepted_targets: 4,
    cli_invocations: 4,
    underlying_retrievals: null,
  });
  const sets = result.sets as Array<{ type: string; index: string }>;
  assert.deepEqual(
    sets.map((set) => set.type),
    ["flow", "process"],
  );
  assert.deepEqual(
    sets.map((set) => fs.readFileSync(set.index, "utf8").trim().split("\n").length),
    [3, 1],
  );
  assert.equal(f.counts().queries, 4);
  assert.ok(fs.readFileSync(f.rowFiles[2]).equals(sourceBefore));
  f.assertPreserved();
});

test("a raw orphan claim is observed without promoting its receipt or dispatching", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const originalLink = fs.linkSync;
  let interrupt = true;
  t.mock.method(fs, "linkSync", (...args: Parameters<typeof fs.linkSync>) => {
    const source = String(args[0]),
      destination = String(args[1]);
    if (interrupt && destination.includes("/checkpoints/") && source.endsWith(".tmp")) {
      const text = fs.readFileSync(source, "utf8");
      if (text.includes('"mode": "deterministic-local"') && text.includes("/dispatch/")) {
        interrupt = false;
        throw new Error("interruption before claim receipt");
      }
    }
    return Reflect.apply(originalLink, fs, args);
  });
  await assert.rejects(
    runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected),
    /interruption before claim receipt/u,
  );
  assert.equal(f.counts().queries, 0);
  const result = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.new_cli_execution, null);
  assert.equal(f.counts().queries, 0);
  const index = readFoundryTaskArtifactIndex(f.context);
  assert.ok(index.some((entry) => entry.path.endsWith("orphaned-claim.json")));
  assert.equal(
    index.some((entry) => entry.path.endsWith("dispatch.json")),
    false,
  );
  assert.equal(
    index.some(
      (entry) =>
        entry.command === "dataset-workflow-identity-stage-dispatch" &&
        entry.path.endsWith("identity-receipt.json"),
    ),
    false,
  );
  f.assertPreserved();
});

test("interrupted claimed stage remains UNKNOWN and a different intent cannot repeat its search", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  f.outcome("throw");
  const first = await runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected);
  assert.equal(first.status, "blocked");
  assert.equal(first.new_cli_execution, null);
  assert.equal(
    (first.blockers as Array<{ disposition: string }>)[0].disposition,
    "UNKNOWN_DO_NOT_REPLAY",
  );
  f.outcome("manual");
  const again = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.deepEqual(
    { ...again, this_invocation: undefined },
    { ...first, this_invocation: undefined },
  );
  assert.deepEqual(again.this_invocation, { cli_invocations: 0, underlying_retrievals: null });
  assert.equal(f.counts().queries, 1);
  const other = f.selection({ ...f.input, intent_id: "different-intent" });
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      readFoundryTaskArtifactIndex(f.context),
      other,
    ),
    /overlapping-retained-stage/u,
  );
  assert.equal(f.counts().queries, 1);
  f.assertPreserved();
});

test("equivalent relocated/reformatted intent reuses admission and changed same-intent body is refused", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const first = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    f.prefix,
    f.selection(),
  );
  const copy = path.join(f.root, "relocated-intent.json");
  fs.writeFileSync(copy, JSON.stringify(f.input, null, 2) + "\n");
  const duplicate = selectFoundryIdentityStageInput(f.context, copy);
  const again = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    duplicate,
  );
  assert.equal(again.status, "completed");
  assert.deepEqual(again.counts, first.counts);
  assert.deepEqual(again.this_invocation, { cli_invocations: 0, underlying_retrievals: null });
  const changed = f.selection({
    ...f.input,
    targets: [{ ...f.input.targets[0], source_row_sha256: "4".repeat(64) }],
  });
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      readFoundryTaskArtifactIndex(f.context),
      changed,
    ),
    /roster|intent-already-bound/u,
  );
  assert.equal(f.counts().queries, 1);
});

test("interruption after genuine owner completion adopts retained outputs without another query", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const originalLink = fs.linkSync;
  let interrupt = true;
  t.mock.method(fs, "linkSync", (...args: Parameters<typeof fs.linkSync>) => {
    if (
      interrupt &&
      String(args[1]).includes("/results/") &&
      String(args[1]).endsWith("foundry-identity.json")
    ) {
      interrupt = false;
      throw new Error("interruption before native result receipt");
    }
    return Reflect.apply(originalLink, fs, args);
  });
  await assert.rejects(
    runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected),
    /interruption before native result/u,
  );
  assert.equal(f.counts().queries, 1);
  const recovered = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.equal(recovered.status, "completed");
  assert.deepEqual(recovered.this_invocation, { cli_invocations: 0, underlying_retrievals: null });
  assert.equal(f.counts().queries, 1);
  f.assertPreserved();
});

test("a temporarily unproven result later adopts the same genuine execution without retry", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const originalOpen = fs.openSync;
  let hideOnce = true;
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    if (
      hideOnce &&
      String(args[0]).endsWith("dataset-identity-preflight-run-report.json") &&
      typeof args[1] === "number" &&
      (args[1] & fs.constants.O_WRONLY) === 0
    ) {
      hideOnce = false;
      throw Object.assign(new Error("retained run not yet readable"), { code: "ENOENT" });
    }
    return Reflect.apply(originalOpen, fs, args);
  });
  const blocked = await runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected);
  assert.equal(hideOnce, false);
  assert.equal(blocked.status, "blocked");
  assert.equal(f.counts().queries, 1);
  const completed = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.equal(completed.status, "completed");
  assert.equal(f.counts().queries, 1);
  assert.deepEqual(completed.this_invocation, { cli_invocations: 0, underlying_retrievals: null });
  f.assertPreserved();
});

test("a claim interrupted before query stays unproven and cannot be dispatched by resume", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  const controller = new AbortController();
  const originalLink = fs.linkSync;
  t.mock.method(fs, "linkSync", (...args: Parameters<typeof fs.linkSync>) => {
    const value = Reflect.apply(originalLink, fs, args);
    if (String(args[1]).endsWith("dispatch.json")) controller.abort();
    return value;
  });
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      f.prefix,
      selected,
      { mode: "oauth" },
      { signal: controller.signal },
    ),
    /aborted/u,
  );
  assert.equal(f.counts().queries, 0);
  const result = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.new_cli_execution, null);
  assert.equal(f.counts().queries, 0);
  f.assertPreserved();
});

for (const outcome of ["wrong-target-exit0", "stderr-exit0"] as const) {
  test(`new stage rejects a fully emitted exit-zero ${outcome} result`, async (t) => {
    const f = await explicitIdentityStageFixture(t);
    f.outcome(outcome);
    const result = await runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      f.prefix,
      f.selection(),
    );
    assert.equal(result.status, "blocked");
    assert.equal(f.counts().queries, 1);
    f.assertPreserved();
  });
}

test("metadata preparation crossing 60 seconds obtains fresh permission identity before search", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const originalRead = fs.readFileSync;
  let advanced = false;
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    const value = Reflect.apply(originalRead, fs, args);
    if (!advanced && String(args[0]).endsWith("runtime-cli-inventory.json")) {
      advanced = true;
      t.mock.timers.tick(70_000);
    }
    return value;
  });
  f.beforeSearch(() => assert.ok(f.counts().authCalls >= 2));
  const result = await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    f.prefix,
    f.selection(),
  );
  assert.equal(advanced, true);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(f.counts().queries, 1);
});

test("a complete real-error owner result is rejected and never retried", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  f.outcome("error");
  const result = await runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected);
  assert.equal(result.status, "blocked");
  await runExplicitFoundryIdentityStage(
    f.context,
    f.qualified,
    readFoundryTaskArtifactIndex(f.context),
    selected,
  );
  assert.equal(f.counts().queries, 1);
  f.assertPreserved();
});

test("native finalization history refuses a new read-only stage before authentication", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  await runFoundryTaskOperation(
    f.context,
    { command: "dataset-workflow-finalize", options: {} },
    (operation) => {
      const report = { schema: "retained-finalization-fixture", status: "blocked" };
      operation.writeJson("outputs/sensitive/owner-history.json", report);
      return report;
    },
  );
  await assert.rejects(
    runExplicitFoundryIdentityStage(
      f.context,
      f.qualified,
      readFoundryTaskArtifactIndex(f.context),
      f.selection(),
    ),
    /native-owner-history/u,
  );
  assert.deepEqual(f.counts(), { queries: 0, authCalls: 0 });
});

test("source or roster drift refuses dispatch, and drift during execution retains unadopted outputs", async (t) => {
  const f = await explicitIdentityStageFixture(t);
  const selected = f.selection();
  f.beforeSearch(() => fs.appendFileSync(f.rowFiles[0], " "));
  await assert.rejects(
    runExplicitFoundryIdentityStage(f.context, f.qualified, f.prefix, selected),
    /changed/u,
  );
  assert.equal(f.counts().queries, 1);
  const entries = readFoundryTaskArtifactIndex(f.context);
  assert.ok(entries.some((entry) => entry.command === "dataset-workflow-identity-stage-dispatch"));
  assert.equal(entries.filter((entry) => entry.command === "dataset-workflow-identity").length, 1);
  const stage = path.join(f.context.taskRoot!, "outputs", "identity-stage");
  assert.ok(fs.existsSync(stage));
});
