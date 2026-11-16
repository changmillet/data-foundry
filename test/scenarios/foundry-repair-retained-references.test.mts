import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 original native repair retains exact reference proof", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-repair-retained-references.test.mts"]));
