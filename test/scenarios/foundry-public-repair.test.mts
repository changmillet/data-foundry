import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 native repair preflight, authorization and closeout retain the original report contract", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-repair.test.mts"]));
