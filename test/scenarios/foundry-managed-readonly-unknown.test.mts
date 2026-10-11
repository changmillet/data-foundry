import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  adoptManagedFixture,
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  managedExplicitStage,
  managedFileFact,
  seedManagedIdentityHistory,
} from "../helpers/managed-adoption-fixture.mts";

after(cleanManagedAdoptionPackage);

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
