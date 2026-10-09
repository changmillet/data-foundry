import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public same-Task answer permits retained outcome adoption after a question arrives during query", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    false,
    "normal",
    false,
    false,
    "insert",
    false,
    false,
    true,
    null,
    true,
    "question-during-query",
  ));

test("public explicit new identity stage preserves missing old proof, returns before writes and exposes normal semantic work", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    false,
    "normal",
    false,
    false,
    "insert",
    false,
    false,
    true,
    null,
    true,
  ));

test("public explicit stage cannot bypass a current identity question", (t) =>
  verifyPublicIdentityWorkflow(
    t,
    publicIdentityCases[0],
    false,
    "normal",
    false,
    false,
    "insert",
    false,
    false,
    true,
    null,
    true,
    "pending-question",
  ));

for (const legacy of [true, false])
  test(`public ordinary status/resume preserves an interrupted explicit claim with ${legacy ? "missing historical proof" : "a genuine failed predecessor"}`, (t) =>
    verifyPublicIdentityWorkflow(
      t,
      publicIdentityCases[0],
      false,
      "normal",
      false,
      false,
      "insert",
      false,
      false,
      legacy,
      null,
      true,
      legacy ? "abort-after-claim" : "failed-predecessor-abort",
    ));
