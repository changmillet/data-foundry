import test from "node:test";
import { runRetainedFoundryTests } from "../helpers/retained-foundry-runtime.mts";

test("CLI 0.1.28 native readback excludes supplemental QA references and requires exact business references", (t) =>
  runRetainedFoundryTests(t, ["test/scenarios/foundry-owner-readback-reference-context.test.mts"]));
