import test from "node:test";
import { verifyDraftCreation } from "../fixtures/foundry-flow-model-draft-candidate.ts";

test("CLI 0.4 re-finalizes approved current Flow rows before any write", (t) =>
  verifyDraftCreation(t, "flow", "current-rows"));
