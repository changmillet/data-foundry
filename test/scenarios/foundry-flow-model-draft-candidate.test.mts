import test from "node:test";
import { verifyDraftCreation } from "../fixtures/foundry-flow-model-draft-candidate.ts";

test("CLI 0.4 managed Model keeps its original typed create attempt and reads back after disconnect", (t) =>
  verifyDraftCreation(t, "lifecyclemodel"));

test("CLI 0.4 managed Flow creates the approved next version and reads back without resending", (t) =>
  verifyDraftCreation(t, "flow"));
