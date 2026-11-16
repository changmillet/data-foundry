import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 native insert retains its original committed snapshot and no-replay recovery", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-native-insert.test.mts"]));
