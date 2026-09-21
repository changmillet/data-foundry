import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native draft repair accepts a bound save_draft contract without extra dispatch", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    true,
    "normal",
    false,
    false,
    "save_draft",
  ));

test("public native draft repair lost response recovers by readback without replay", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    true,
    "lost",
    false,
    false,
    "save_draft",
  ));

test("public native draft repair rejects an impossible operation/before binding before dispatch", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    true,
    "normal",
    false,
    false,
    "save_draft",
    true,
  ));
