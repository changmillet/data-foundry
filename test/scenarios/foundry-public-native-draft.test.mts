import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 original native save-draft binds its attempt and recovers only by readback", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-native-draft.test.mts"]));
