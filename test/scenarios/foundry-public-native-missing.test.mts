import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("public native insert response missing requires its own execution receipt without replay", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-native-missing.test.mts"]));
