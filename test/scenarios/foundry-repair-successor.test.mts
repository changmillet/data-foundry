import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 original repair only admits successors with exact terminal no-dispatch evidence", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-repair-successor.test.mts"]));
