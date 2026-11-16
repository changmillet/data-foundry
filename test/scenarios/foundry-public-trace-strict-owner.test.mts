import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 production-test recovery keeps a mismatched original attempt consumed", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-trace-strict-owner.test.mts"]));
