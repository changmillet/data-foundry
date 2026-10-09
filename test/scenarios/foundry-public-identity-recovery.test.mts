import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public same-task recovery retains the failed original query and creates bound semantic work", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    false,
    "normal",
    false,
    false,
    "insert",
    false,
    false,
    true,
  ));
