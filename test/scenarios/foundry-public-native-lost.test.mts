import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert resumes with the original runtime and consumed request after reconnecting", (t) =>
  verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true, "lost"));
