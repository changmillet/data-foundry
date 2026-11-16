import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 ordinary recovery preserves original trace normalization evidence", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-trace-acceptance.test.mts"]));
