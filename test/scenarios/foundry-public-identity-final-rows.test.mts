import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 final-rows approval remains bound to the original evidence format", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-identity-final-rows.test.mts"]));
