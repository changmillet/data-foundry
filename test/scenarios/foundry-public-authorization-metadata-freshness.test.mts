import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { batchRunLockPath } from "@tiangong-lca/cli/batch";
import {
  publicIdentityCases,
  verifyPublicIdentityWorkflow,
} from "../fixtures/foundry-public-workflow.ts";

test("public native insert approval survives identity aging during locked populated metadata verification", async (t) => {
  const originalRead = fs.readFileSync;
  const originalRemove = fs.rmSync;
  const originalNow = Date.now;
  let offset = 0;
  let crossings = 0;
  let armed = false;
  let selectionRoot = "";
  let verifiedEntries = 0;
  t.mock.method(Date, "now", () => originalNow() + offset);
  t.mock.method(fs, "rmSync", (...args: Parameters<typeof fs.rmSync>) => {
    const result = Reflect.apply(originalRemove, fs, args);
    if (path.basename(String(args[0])).startsWith("foundry-identity-") && selectionRoot) {
      const grant = JSON.parse(originalRead(path.join(selectionRoot, "grant.json"), "utf8")) as {
        binding: { actor_id: string };
      };
      const descriptor = JSON.parse(
        originalRead(path.join(selectionRoot, "authorization-input.json"), "utf8"),
      ) as { finalization_sha256: string };
      armed =
        grant.binding.actor_id === "identity-actor" &&
        descriptor.finalization_sha256 !== "0".repeat(64);
    }
    return result;
  });
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    const result = Reflect.apply(originalRead, fs, args);
    const file = String(args[0]);
    if (path.basename(file) === "grant.json" && !file.includes(`${path.sep}.foundry${path.sep}`))
      selectionRoot = path.dirname(file);
    if (!armed || path.basename(file) !== "artifact-index.jsonl") return result;
    const taskRoot = path.dirname(file);
    if (fs.existsSync(path.join(taskRoot, "authorization.json"))) return result;
    const workspace = path.resolve(taskRoot, "../../..");
    const grantFile = path.join(path.dirname(workspace), "grant.json");
    const descriptorFile = path.join(path.dirname(workspace), "authorization-input.json");
    const lock = batchRunLockPath(
      path.join(workspace, ".foundry/state/task-locks", `${path.basename(taskRoot)}.json`),
    );
    if (!fs.existsSync(grantFile) || !fs.existsSync(descriptorFile) || !fs.existsSync(lock)) {
      return result;
    }
    const lockState = JSON.parse(originalRead(lock, "utf8")) as { reason: string };
    if (!lockState.reason.endsWith("Foundry task metadata verification")) return result;
    const grant = JSON.parse(originalRead(grantFile, "utf8")) as {
      binding: { actor_id: string };
    };
    const descriptor = JSON.parse(originalRead(descriptorFile, "utf8")) as {
      finalization_sha256: string;
    };
    if (
      grant.binding.actor_id !== "identity-actor" ||
      descriptor.finalization_sha256 === "0".repeat(64)
    ) {
      armed = false;
      return result;
    }
    verifiedEntries = String(result).trim().split("\n").length;
    assert.ok(verifiedEntries > 30, "verification reads a populated real producer index");
    // Model one slow filesystem verification at the public host boundary. No identity owner,
    // task lock, producer graph, grant or native contract is stubbed by this timing seam.
    offset += 61_000;
    crossings++;
    armed = false;
    return result;
  });
  await verifyPublicIdentityWorkflow(t, publicIdentityCases[0], true);
  assert.ok(crossings > 0, "the authorization metadata check crosses the unchanged 60s window");
  assert.ok(verifiedEntries > 30);
});
