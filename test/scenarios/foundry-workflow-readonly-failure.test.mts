import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

for (const failure of [true, "missing_locator"] as const)
  test(`public finalization retains its original read-only ${failure === true ? "empty_stdout" : failure} failure without respawn or mutation`, async (t) => {
    await verifyPublicIdentityWorkflow(
      t,
      publicIdentityCases[0],
      false,
      "normal",
      false,
      false,
      "insert",
      false,
      false,
      false,
      null,
      false,
      null,
      failure,
    );
  });
