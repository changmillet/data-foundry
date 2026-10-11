import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import {
  adoptManagedFixture,
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  managedExplicitStage,
  managedFileFact,
  managedFixtureToken,
  seedManagedIdentityHistory,
} from "../helpers/managed-adoption-fixture.mts";

after(cleanManagedAdoptionPackage);

test("real manager + synthetic owned auth/search transport performs exact Flow3/Process1 readonly stage and preserves Source2", async (t) => {
  const f = await managedAdoptionFixture(t, true);
  const history = await seedManagedIdentityHistory(f);
  await adoptManagedFixture(f);
  const ordinary = (await f.run(f.launch, f.taskArgs("resume"), "foundry", f.authEnvironment))
    .operation;
  assert.equal(ordinary.status, "needs_input", JSON.stringify(ordinary));
  assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 0);
  const explicitArgs = f.taskArgs("resume", ["--identity-stage-input", history.descriptor]);
  // The task lock serializes both managed calls; allow their combined two-command budget.
  const results = await Promise.all(
    [1, 2].map(() => f.run(f.launch, explicitArgs, "foundry", f.authEnvironment, 2)),
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
