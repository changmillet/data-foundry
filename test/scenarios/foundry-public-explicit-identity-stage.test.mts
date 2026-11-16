import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 retained original identity reports continue through the original public facade", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-explicit-identity-stage.test.mts"]));
