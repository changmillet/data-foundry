import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 native reference input survives source removal and binds the original execution and readback", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-reference-input.test.mts"]));
