import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 reference-only results and human recap preserve legacy evidence across restarts", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-public-identity-reference-reuse.test.mts"]));
