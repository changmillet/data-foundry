import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 original native identity preflight preserves its diagnostic exit contract", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/identity-preflight-diagnostic-exit.test.mts"]));
