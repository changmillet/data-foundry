import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  adoptManagedFixture,
  cleanManagedAdoptionPackage,
  managedAdoptionFixture,
  seedManagedIdentityHistory,
} from "../helpers/managed-adoption-fixture.mts";

after(cleanManagedAdoptionPackage);

test("managed cli-auth admits neither wrong account, stale receipt, auth error nor incomplete process credentials", async (t) => {
  const f = await managedAdoptionFixture(t, true);
  const history = await seedManagedIdentityHistory(f);
  await adoptManagedFixture(f);
  for (const auth of ["wrong-account", "stale", "error"]) {
    f.setControl({ auth });
    const result = (
      await f.run(
        f.launch,
        f.taskArgs("resume", ["--identity-stage-input", history.descriptor]),
        "foundry",
        f.authEnvironment,
      )
    ).operation;
    assert.equal(result.status, "needs_auth", JSON.stringify(result));
    assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 0);
  }
  const result = (
    await f.run(
      f.launch,
      f.taskArgs("resume", ["--identity-stage-input", history.descriptor]),
      "foundry",
      { ...f.authEnvironment, TIANGONG_LCA_ACCESS_TOKEN: "" },
    )
  ).operation;
  assert.ok(
    result.blockers.some((item) => item.code === "managed_authentication_invalid"),
    JSON.stringify(result),
  );
  assert.equal(f.counts().filter((item) => ["flow", "process"].includes(item.kind)).length, 0);
  f.assertPreserved();
  f.markPassed();
});
