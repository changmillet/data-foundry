import test from "node:test";
import { verifyDraftCreation } from "../fixtures/foundry-flow-model-draft-candidate.ts";

for (const difference of ["trace", "other-content"] as const)
  test(`CLI 0.4 keeps an approved current Flow attempt consumed while ${difference} differs`, (t) =>
    verifyDraftCreation(t, "flow", "current-rows", difference));
