import test from "node:test";
import {
  publicIdentityCases,
  publicIdentityTitle,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

const scenario = publicIdentityCases[1];
test(publicIdentityTitle(scenario), (t) => verifyPublicIdentityWorkflow(t, scenario));

test("verified reference reuse completes the human decision recap across fresh processes", (t) =>
  verifyPublicIdentityWorkflow(t, scenario, false, "normal", false, false, "insert", false, true));
