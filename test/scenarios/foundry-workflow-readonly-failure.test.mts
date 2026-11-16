import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 legacy finalization process failures remain indexed across restarts", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-workflow-readonly-failure.test.mts"]));
