import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 native insert preserves approval admission during the original identity refresh", (t) =>
  runRetainedFoundryTests(t, [
    "test/scenarios/foundry-public-authorization-metadata-freshness.test.mts",
  ]));
