import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 current-rows approval preserves trace-bearing legacy evidence", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-approval-current-trace.test.mts"]));
