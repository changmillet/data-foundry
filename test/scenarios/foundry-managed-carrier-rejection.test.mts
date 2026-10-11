import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  managedInventory,
  type ManagedFixtureMutation,
} from "../helpers/managed-adoption-fixture.mts";

after(cleanManagedAdoptionPackage);

test("actual CLI managed host refuses changed carrier, qualification, execution and component expectations", async (t) => {
  const f = await managedAdoptionFixture(t);
  const before = managedInventory(f.workspace);
  for (const mutation of [
    "control-mode",
    "control-protocol",
    "successor-product",
    "successor-launch",
    "qualification-manifest",
    "qualification-files",
    "cli-expectation",
    "node-expectation",
    "tidas-expectation",
    "entry-argv",
  ] satisfies ManagedFixtureMutation[]) {
    const bad = await f.carrier(mutation);
    const result = (
      await f.run(bad, f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]))
    ).operation;
    assert.notEqual(result.status, "ready", mutation);
    assert.ok(result.blockers.length, mutation);
    assert.deepEqual(managedInventory(f.workspace), before, mutation);
  }
  f.markPassed();
});
