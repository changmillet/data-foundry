import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 ordinary recovery rejects other differences without replaying the original attempt", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-trace-unrelated-change.test.mts"]));
