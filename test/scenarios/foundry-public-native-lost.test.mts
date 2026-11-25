import test from "node:test";
import { resolveInstalledTiangongLcaCliPackage } from "../../src/lib/foundry-runtime-utils.ts";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert resumes with the original runtime and consumed request after reconnecting", (t) => {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion === "0.1.28")
    return verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true, "lost");
  return runRetainedFoundryTests(t, ["test/scenarios/foundry-public-native-lost.test.mts"]);
});
