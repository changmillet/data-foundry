import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 retains accepted reference input during original identity renewal and no-replay recovery", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-reference-recovery.test.mts"]));
