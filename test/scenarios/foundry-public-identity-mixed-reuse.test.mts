import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 mixed identity evidence preserves the original reference/write partition", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-identity-mixed-reuse.test.mts"]));
