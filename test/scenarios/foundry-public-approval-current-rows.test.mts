import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 current-rows approval remains bound to the original attempt", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-approval-current-rows.test.mts"]));
