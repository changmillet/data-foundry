import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import {
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  managedInventory,
} from "../helpers/managed-adoption-fixture.mts";

after(cleanManagedAdoptionPackage);

test("ordinary argv/task self-authority cannot qualify managed adoption and read launch cannot write", async (t) => {
  const f = await managedAdoptionFixture(t);
  const before = managedInventory(f.workspace);
  const untrusted = (
    await f.run(
      f.successor,
      f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
    )
  ).operation;
  assert.equal(untrusted.blockers[0].code, "runtime_adoption_qualification_untrusted");
  const nullPolicy = await f.carrier(undefined, false);
  assert.equal(
    (
      await f.run(
        nullPolicy,
        f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
      )
    ).operation.blockers[0].code,
    "runtime_adoption_qualification_untrusted",
  );
  const readonly = (
    await f.run(
      f.launch,
      f.taskArgs("adopt-runtime", ["--dry-run", "--selection", f.selectionFile]),
      "foundry-read",
    )
  ).operation;
  assert.equal(readonly.status, "ready", "A read-only dry-run remains observational.");
  const planArtifact = readonly.artifacts.find((item) => item.role === "runtime_adoption_plan");
  assert.ok(planArtifact?.kind === "inline");
  const readonlyPlan = path.join(f.root, "read-only-adoption-plan.json");
  f.json(readonlyPlan, planArtifact.value);
  const denied = (
    await f.run(
      f.launch,
      f.taskArgs("adopt-runtime", ["--apply", "--plan", readonlyPlan]),
      "foundry-read",
    )
  ).operation;
  assert.ok(
    denied.blockers.some((item) => item.code === "workspace_read_only"),
    JSON.stringify(denied),
  );
  assert.deepEqual(managedInventory(f.workspace), before);
  f.markPassed();
});
