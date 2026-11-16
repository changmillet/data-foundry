import test from "node:test";
import { verifyDraftCreation } from "../fixtures/foundry-flow-model-draft-candidate.ts";

test("CLI 0.4 reuses an independently verified Flow reference without requesting write authority", (t) =>
  verifyDraftCreation(t, "flow", "reuse"));

test("CLI 0.4 verifies reused references in a mixed scope and only dispatches its approved draft", (t) =>
  verifyDraftCreation(t, "flow", "mixed"));
