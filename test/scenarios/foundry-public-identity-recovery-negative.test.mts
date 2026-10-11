import test from "node:test";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public unproven original recovery needs input and preserves UNKNOWN without a new query", (t) =>
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
    "unproven",
  ));

test("public real current identity failure still needs authentication without a new query", (t) =>
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
    "auth",
  ));

for (const failure of [
  "empty-results",
  "missing-results",
  "missing-decision",
  "misleading-failure",
  "node",
  "node-missing",
  "missing-auth",
] as const)
  test(`public ${failure} retains UNKNOWN original recovery without a new query`, (t) =>
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
      failure,
    ));
