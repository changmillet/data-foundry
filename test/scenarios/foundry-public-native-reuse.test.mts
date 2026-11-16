import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 native insert excludes canonical reuse from the original write contract", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-native-reuse.test.mts"]));
