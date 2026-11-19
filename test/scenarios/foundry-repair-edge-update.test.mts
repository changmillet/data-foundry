import test from "node:test";
import { verifyGuardedUpdate } from "../fixtures/guarded-process-repair.ts";

test("CLI 0.4 guarded Process update recovers the original attempt without resending", (t) =>
  verifyGuardedUpdate(t, true));

test("CLI 0.4 guarded Process update retains the admitted unknown annual-volume gap", (t) =>
  verifyGuardedUpdate(t, false));

test("CLI 0.4 no-op repair closes only on exact readback and reuses the existing proof", (t) =>
  verifyGuardedUpdate(t, true, "no-change"));

test("CLI 0.4 metadata repair refuses invalid before readback", (t) =>
  verifyGuardedUpdate(t, true, "preflight-refusals"));

test("CLI 0.4 metadata repair refuses authorization outside the sealed scope", (t) =>
  verifyGuardedUpdate(t, true, "approval-refusals"));
