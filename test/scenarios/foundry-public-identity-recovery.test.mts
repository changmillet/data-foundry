import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 the original failure can recover from its retained query evidence", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-identity-recovery.test.mts"]));
