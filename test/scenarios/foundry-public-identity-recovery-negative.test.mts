import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 missing or inconsistent original query evidence cannot replay a query", (t) =>
  runRetainedFoundryTests(t, [
    "test/scenarios/foundry-public-identity-recovery-negative.test.mts",
  ]));
