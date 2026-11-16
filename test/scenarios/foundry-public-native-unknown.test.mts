import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("public native insert response unknown requires its own execution receipt without replay", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-native-unknown.test.mts"]));
