import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 original repair verifies its native write receipt and exact readback", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-repair-execution.test.mts"]));
