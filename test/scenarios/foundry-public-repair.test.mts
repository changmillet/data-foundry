import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  registerBlockedPreparation,
  repairDataCalls,
  repairTarget,
  repairTaskRoot,
  repairWorkflowFixture,
  type RepairWorkflowFixture,
} from "../fixtures/foundry-repair-workflow.ts";
import { validateNativeDraftCloseout } from "../../scripts/lib/finalize-owners/native-draft-closeout.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { repoRelativePath } from "../../scripts/lib/import-curation/internal/runtime-io.ts";

type Json = Record<string, unknown>;

/** Narrow one parsed index value for the receipt assertions. */
function asJson(value: unknown): Json {
  return value as Json;
}

const actorId = "identity-actor";
const reportName = "foundry-repair-preflight.json";

function blockersOf(result: Json): string[] {
  const blockers = Array.isArray(result.blockers) ? result.blockers : [];
  return blockers.map((item) =>
    typeof item === "string" ? item : String((item as Json).code ?? (item as Json).blocker ?? ""),
  );
}

function reportArtifact(result: Json): { path: string; bytes: number; sha256: string } {
  const artifacts = Array.isArray(result.artifacts) ? (result.artifacts as Json[]) : [];
  const found = artifacts.find(
    (artifact) => typeof artifact.path === "string" && artifact.path.endsWith(reportName),
  );
  assert.ok(
    found,
    `the operation result must expose the registered preparation report: ${JSON.stringify(artifacts)}`,
  );
  return found as { path: string; bytes: number; sha256: string };
}

/** Verify the report is indexed by the repair producer with its exact bytes and a receipt. */
function assertIndexedRepairReport(
  fixture: RepairWorkflowFixture,
  taskId: string,
  artifact: { path: string; bytes: number; sha256: string },
): string {
  const taskRoot = repairTaskRoot(fixture, taskId);
  const indexFile = path.join(taskRoot, "artifact-index.jsonl");
  assert.equal(fs.existsSync(indexFile), true, "a registered task owns its artifact index");
  const entries = fs
    .readFileSync(indexFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
  const entry = entries.find(
    (candidate) =>
      candidate.command === "dataset-workflow-repair-preflight" &&
      typeof candidate.path === "string" &&
      candidate.path.endsWith(reportName),
  );
  assert.ok(
    entry,
    `the preparation report must be registered by the repair producer: ${JSON.stringify(
      entries.map((item) => item.command),
    )}`,
  );
  assert.equal(
    entry.bytes,
    artifact.bytes,
    "the indexed report bytes must match the artifact fact",
  );
  assert.equal(
    entry.sha256,
    artifact.sha256,
    "the indexed report hash must match the artifact fact",
  );
  const receipt = asJson(entry.receipt);
  assert.equal(typeof receipt?.path, "string", "an indexed producer entry carries a receipt file");
  assert.match(String(receipt?.sha256 ?? ""), /^[0-9a-f]{64}$/u);
  const reportFile = path.join(taskRoot, String(entry.path));
  assert.equal(fs.existsSync(reportFile), true);
  return reportFile;
}

test("task start and status stay offline for a repair task", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  assert.ok(started.task_id, `start must register the repair task: ${JSON.stringify(started)}`);
  assert.equal(
    repairDataCalls(fixture).length,
    0,
    "task start must not invoke the owner data CLI (no authentication or remote read at start)",
  );
  const status = await fixture.facade.status({ taskId: String(started.task_id), actorId });
  assert.equal(
    repairDataCalls(fixture).length,
    0,
    "status for a repair task is a local preflight projection and must stay offline",
  );
  assert.equal(status.status, "ready", JSON.stringify(status));
});

test("a changed metadata repair stops at explicit authorization after a read-only preflight", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const resumed = await fixture.facade.resume({ taskId, actorId });
  assert.equal(
    resumed.status,
    "needs_input",
    `a changed repair must stop at authorization: ${JSON.stringify(resumed)}`,
  );
  assert.ok(
    blockersOf(resumed).includes("repair_authorization_required"),
    `resume must report the repair authorization blocker: ${JSON.stringify(resumed.blockers)}`,
  );
  const permissions = (resumed.permissions ?? {}) as Json;
  assert.equal(
    permissions.state,
    "required",
    "the repair must require explicit state authorization before any write",
  );
  const artifact = reportArtifact(resumed);
  assertIndexedRepairReport(fixture, taskId, artifact);
  const data = repairDataCalls(fixture);
  assert.equal(
    data.some((call) => call.argv.includes("--commit")),
    false,
    "a repair preflight never dispatches a committing owner command",
  );
  assert.equal(
    data.filter((call) => call.verb === "save-draft").length,
    1,
    "the changed scope runs exactly one read-only dry run",
  );
  assert.equal(
    data.filter((call) => call.verb === "verify-remote").length >= 1,
    true,
    "the changed preflight also reads back the stored root for reference closure",
  );
});

test("a blocked owner preflight is reported as a blocked input requirement", async (t) => {
  const fixture = repairWorkflowFixture(t);
  fixture.blockedDryRun = true;
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const resumed = await fixture.facade.resume({ taskId: String(started.task_id), actorId });
  assert.equal(
    resumed.status,
    "needs_input",
    `a retained or blocked preflight must not advance the task: ${JSON.stringify(resumed)}`,
  );
  assert.ok(
    blockersOf(resumed).includes("repair_preflight_blocked"),
    `resume must surface the blocked preflight: ${JSON.stringify(resumed.blockers)}`,
  );
  assert.equal(
    repairDataCalls(fixture).some((call) => call.argv.includes("--commit")),
    false,
    "no write may follow a blocked preflight",
  );
});

test("a no-op repair completes only after a fully passed remote readback", async (t) => {
  const fixture = repairWorkflowFixture(t, { candidateText: "Original source" });
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const resumed = await fixture.facade.resume({ taskId, actorId });
  assert.equal(resumed.status, "completed", JSON.stringify(resumed));
  assert.deepEqual(blockersOf(resumed), [], JSON.stringify(resumed.blockers));
  const verbs = repairDataCalls(fixture).map((call) => call.verb);
  assert.ok(
    verbs.includes("validate"),
    `the no-change proof must validate the content layers: ${JSON.stringify(verbs)}`,
  );
  assert.equal(
    verbs.filter((verb) => verb === "verify-remote").length,
    2,
    "the no-change proof must read back both the before and the candidate content",
  );
  assert.equal(
    repairDataCalls(fixture).some((call) => call.argv.includes("--commit")),
    false,
    "a no-change proof performs no write",
  );
  const artifact = reportArtifact(resumed);
  assertIndexedRepairReport(fixture, taskId, artifact);
});

test("a drifted remote root never completes a no-op repair", async (t) => {
  const fixture = repairWorkflowFixture(t, { candidateText: "Original source" });
  fixture.remoteMismatch = true;
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const resumed = await fixture.facade.resume({ taskId: String(started.task_id), actorId });
  assert.notEqual(
    resumed.status,
    "completed",
    `a mismatching remote readback must not be reported as completed: ${JSON.stringify(resumed)}`,
  );
  assert.ok(
    ["needs_input", "blocked", "failed"].includes(String(resumed.status)),
    `unexpected status ${String(resumed.status)}`,
  );
  assert.equal(
    repairDataCalls(fixture).some((call) => call.argv.includes("--commit")),
    false,
    "no write may follow a failed no-change proof",
  );
});

test("a repeated resume and status reuse the indexed proof without new owner calls", async (t) => {
  const fixture = repairWorkflowFixture(t, { candidateText: "Original source" });
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const first = await fixture.facade.resume({ taskId, actorId });
  assert.equal(first.status, "completed", JSON.stringify(first));
  const callsAfterFirst = repairDataCalls(fixture).length;
  const second = await fixture.facade.resume({ taskId, actorId });
  assert.equal(second.status, "completed", JSON.stringify(second));
  await fixture.facade.status({ taskId, actorId });
  assert.equal(
    repairDataCalls(fixture).length,
    callsAfterFirst,
    "a repeated resume or status must reuse the registered proof instead of re-reading the owner CLI",
  );
});

test("a tampered registered report blocks the repair instead of completing it", async (t) => {
  const fixture = repairWorkflowFixture(t, { candidateText: "Original source" });
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const first = await fixture.facade.resume({ taskId, actorId });
  const artifact = reportArtifact(first);
  const reportFile = assertIndexedRepairReport(fixture, taskId, artifact);
  const original = fs.readFileSync(reportFile, "utf8");
  const tampered = JSON.parse(original) as Json;
  tampered.status = "no_change_verified";
  (tampered.scope as Json).contract_sha256 = "f".repeat(64);
  fs.writeFileSync(reportFile, `${JSON.stringify(tampered, null, 2)}\n`);
  try {
    const again = await fixture.facade.resume({ taskId, actorId });
    assert.notEqual(
      again.status,
      "completed",
      `a tampered preparation report must fail closed: ${JSON.stringify(again)}`,
    );
  } finally {
    fs.writeFileSync(reportFile, original);
  }
});

function blockerCodes(result: Json): string[] {
  return blockersOf(result);
}

/** The permission projection of one public operation result. */
function permissionsOf(result: Json): Json {
  const value = result.permissions;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** The registered authorization report of one task, read back from the public artifact index. */
function authorizationReport(
  fixture: RepairWorkflowFixture,
  taskId: string,
): { report: Json; entrySha256: string } {
  const taskRoot = repairTaskRoot(fixture, taskId);
  const entries = fs
    .readFileSync(path.join(taskRoot, "artifact-index.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
  const entry = entries.findLast(
    (candidate) =>
      candidate.command === "dataset-workflow-authorization" &&
      typeof candidate.path === "string" &&
      candidate.path.endsWith("foundry-authorization.json"),
  );
  assert.ok(entry, "the approval must register its authorization report");
  const reportFile = path.join(taskRoot, String(entry.path));
  assert.equal(fs.existsSync(reportFile), true);
  return {
    report: JSON.parse(fs.readFileSync(reportFile, "utf8")) as Json,
    entrySha256: String(entry.sha256),
  };
}

/** The sealed owner execution request registered for one approval, read back from the index. */
function ownerExecutionRequest(
  fixture: RepairWorkflowFixture,
  taskId: string,
  approvalSha256: string,
): Json {
  const taskRoot = repairTaskRoot(fixture, taskId);
  const entries = fs
    .readFileSync(path.join(taskRoot, "artifact-index.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
  for (const entry of entries) {
    if (
      entry.command !== "dataset-workflow-execution-prepare" ||
      typeof entry.path !== "string" ||
      !entry.path.endsWith("owner-execution-request.json")
    )
      continue;
    const file = path.join(taskRoot, entry.path);
    assert.equal(fs.existsSync(file), true, "the registered request must exist on disk");
    const request = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
    if ((request.content as Json).authorization === approvalSha256) return request;
  }
  return assert.fail(
    `the sealed scope must register exactly one owner execution request: ${JSON.stringify(
      entries.map((entry) => entry.command),
    )}`,
  );
}

test("an approved metadata repair seals its exact owner-draft scope and prepares one owner request", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const preflight = await fixture.facade.resume({ taskId, actorId });
  assert.equal(preflight.status, "needs_input", JSON.stringify(preflight));
  const approval = fixture.approval(taskId);
  const dataCallsBefore = repairDataCalls(fixture).length;
  const approved = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.equal(
    permissionsOf(approved).state,
    "granted",
    `an explicit approval of the registered preparation must grant the exact scope: ${JSON.stringify(approved.blockers)}`,
  );
  assert.ok(
    blockerCodes(approved).includes("authorized_execution_pending"),
    `the sealed scope must report pending owner execution: ${JSON.stringify(approved.blockers)}`,
  );
  const { report, entrySha256 } = authorizationReport(fixture, taskId);
  assert.equal(report.status, "sealed", JSON.stringify(Object.keys(report)));
  assert.equal(report.input_kind, "repair_rows");
  assert.equal(report.finalization_sha256, approval.descriptor.finalization_sha256);
  const capsule = (report.capsule as Json).capsule as Json;
  assert.equal(
    (capsule.approved_input as Json).sha256,
    approval.descriptor.input_sha256,
    "the capsule must bind the approved candidate bytes",
  );
  assert.equal(
    (capsule.final_rows as Json).sha256,
    approval.descriptor.input_sha256,
    "the sealed scope executes exactly the approved candidate rows",
  );
  assert.equal(
    (report.handoff as Json).repair_scope,
    true,
    "a repair authorization carries the repair write plan, not a finalization handoff",
  );
  assert.equal(
    repairDataCalls(fixture)
      .slice(dataCallsBefore)
      .some((call) => call.argv.includes("--commit")),
    false,
    "authorization must never dispatch a committing owner command",
  );
  // The next resume prepares exactly one sealed owner execution request and dispatches nothing.
  const prepared = await fixture.facade.resume({ taskId, actorId });
  assert.equal(permissionsOf(prepared).state, "granted", JSON.stringify(prepared.blockers));
  const callsAfterPrepare = repairDataCalls(fixture).length;
  const request = ownerExecutionRequest(fixture, taskId, entrySha256);
  assert.equal(
    (request.content as Json).authorization,
    entrySha256,
    "the owner request must bind the exact sealed authorization report",
  );
  assert.equal((request.policy as Json).dataset_type, "process");
  assert.deepEqual(
    (request.policy as Json).state_code,
    0,
    "the owner request stays a draft-only request",
  );
  await fixture.facade.status({ taskId, actorId });
  assert.equal(
    repairDataCalls(fixture).length,
    callsAfterPrepare,
    "projecting the prepared request must not call the owner CLI again",
  );
});

test("a repair approval that names another preparation is refused", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  await fixture.facade.resume({ taskId, actorId });
  const approval = fixture.approval(taskId);
  // A byte-identical copy with one field changed: a real report file the registry never signed.
  const altered = JSON.parse(fs.readFileSync(approval.reportFile, "utf8")) as Json;
  altered.status = "no_change_verified";
  const alteredFile = path.join(fixture.root, "altered-preparation.json");
  fs.writeFileSync(alteredFile, `${JSON.stringify(altered, null, 2)}\n`);
  const digest = createHash("sha256").update(fs.readFileSync(alteredFile)).digest("hex");
  const substituted: Json = structuredClone(approval.descriptor);
  const substitutedPreparation = substituted.repair_preparation as Json;
  substituted.finalization_sha256 = digest;
  substitutedPreparation.sha256 = digest;
  substitutedPreparation.file = alteredFile;
  const substitutedFile = path.join(fixture.root, "substituted-approval.json");
  fs.writeFileSync(substitutedFile, `${JSON.stringify(substituted, null, 2)}\n`);
  const refused = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: substitutedFile,
  });
  assert.notEqual(permissionsOf(refused).state, "granted", JSON.stringify(refused));
  assert.ok(
    blockerCodes(refused).includes("authorization_repair_preparation_mismatch"),
    `an unsigned preparation copy can never become the scope authority: ${JSON.stringify(refused.blockers)}`,
  );
  assert.equal(
    repairDataCalls(fixture).some((call) => call.argv.includes("--commit")),
    false,
  );
});

test("a repair approval without the native contract is refused", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  await fixture.facade.resume({ taskId, actorId });
  const approval = fixture.approval(taskId, { omitContract: true });
  const refused = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.notEqual(permissionsOf(refused).state, "granted", JSON.stringify(refused));
  assert.ok(
    blockerCodes(refused).includes("task_authorization_input_invalid"),
    `a repair scope always carries its native execution contract: ${JSON.stringify(refused.blockers)}`,
  );
});

test("an expired repair grant cannot seal the scope", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  await fixture.facade.resume({ taskId, actorId });
  const approval = fixture.approval(taskId, { expiresInMs: -3_600_000 });
  const refused = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.notEqual(permissionsOf(refused).state, "granted", JSON.stringify(refused));
  assert.ok(
    blockerCodes(refused).some((code) => code.startsWith("task_authorization_")),
    `an expired grant cannot authorize a write: ${JSON.stringify(refused.blockers)}`,
  );
  assert.equal(
    repairDataCalls(fixture).some((call) => call.argv.includes("--commit")),
    false,
  );
});

test("a blocked repair preflight can never be authorized", async (t) => {
  const fixture = repairWorkflowFixture(t);
  fixture.blockedDryRun = true;
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  const blocked = await fixture.facade.resume({ taskId, actorId });
  assert.ok(blockerCodes(blocked).includes("repair_preflight_blocked"), JSON.stringify(blocked));
  const approval = fixture.approval(taskId);
  const refused = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.notEqual(permissionsOf(refused).state, "granted", JSON.stringify(refused));
  assert.ok(
    blockerCodes(refused).includes("authorization_repair_not_prepared"),
    `only a prepared dispatchable scope may be authorized: ${JSON.stringify(refused.blockers)}`,
  );
});

test("a repair task outside the locked generic profile is refused", async (t) => {
  const fixture = repairWorkflowFixture(t, { profileId: "bafu" });
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  await fixture.facade.resume({ taskId, actorId });
  const approval = fixture.approval(taskId);
  const refused = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.notEqual(permissionsOf(refused).state, "granted", JSON.stringify(refused));
  assert.ok(
    blockerCodes(refused).includes("authorization_repair_profile_unsupported"),
    `the repair lane admits only the generic profile: ${JSON.stringify(refused.blockers)}`,
  );
});

/** The registered repair handoff plan of one task, read back from the public artifact index. */
function repairHandoffPlan(fixture: RepairWorkflowFixture, taskId: string): Json {
  const taskRoot = repairTaskRoot(fixture, taskId);
  const entries = fs
    .readFileSync(path.join(taskRoot, "artifact-index.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
  const entry = entries.findLast(
    (candidate) =>
      candidate.command === "dataset-workflow-authorization" &&
      typeof candidate.path === "string" &&
      candidate.path.endsWith("dataset-commit-handoff-plan.json"),
  );
  assert.ok(entry, "the sealed stage must register its repair handoff plan");
  return JSON.parse(fs.readFileSync(path.join(taskRoot, String(entry.path)), "utf8")) as Json;
}

test("the sealed repair handoff is consumable by the native draft closeout owner", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const assetRoot = path.resolve(import.meta.dirname, "..", "..");
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  await fixture.facade.resume({ taskId, actorId });
  const approval = fixture.approval(taskId);
  const approved = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.equal(permissionsOf(approved).state, "granted", JSON.stringify(approved.blockers));
  const plan = repairHandoffPlan(fixture, taskId);
  const contract = plan.execution_contract as Json;
  const binding = contract.artifact as Json;
  const contractFile = path.resolve(assetRoot, String(binding.path));
  assert.equal(
    contract.canonical_sha256,
    fixture.canonicalContractSha256,
    "the plan carries the admitted native contract metadata, not a flat artifact",
  );
  assert.equal(contract.operation, "save_draft");
  assert.equal(contract.execution_id, "repair-public-1");
  assert.equal(contract.project_ref, fixture.account.project_ref);
  const resolveFile = (value: unknown) =>
    typeof value === "string" ? path.resolve(assetRoot, value) : null;
  const report = (counts: Json) => ({
    schema_version: 2,
    mode: "commit",
    commit: true,
    status: "completed",
    requested_type: "process",
    input_path: plan.final_rows_file,
    execution_contract: {
      path: contractFile,
      sha256: contract.canonical_sha256,
      execution_id: contract.execution_id,
      target_mode: "owner_draft",
    },
    counts: {
      selected: 1,
      executed: 1,
      attempts_consumed: 1,
      failed: 0,
      unknown: 0,
      blocked: 0,
      ...counts,
    },
    rows: [
      {
        index: 0,
        type: "process",
        table: repairTarget.table,
        id: repairTarget.id,
        version: repairTarget.version,
        action_id: repairTarget.action_id,
        desired_sha256: sha256Json(fixture.candidatePayload),
        status: "executed",
        operation: "save_draft",
        attempt_consumed: true,
        replayed: false,
        readback: "desired_exact",
      },
    ],
  });
  const closeout = (value: Json) =>
    validateNativeDraftCloseout({
      handoff: plan,
      report: value,
      rowsFile: String(plan.final_rows_file),
      datasetType: "process",
      targetUserId: fixture.account.user_id,
      stateCode: "0",
      expectedRows: 1,
      resolveFile,
      relativePath: (file) => repoRelativePath(assetRoot, file),
    });
  assert.equal(
    closeout(report({})),
    true,
    "the existing native closeout owner must accept the handoff this stage sealed",
  );
  assert.throws(
    () => closeout(report({ executed: 0 })),
    /missing or inconsistent/u,
    "a commit report that does not prove the executed action cannot close the scope",
  );
});

test("a superseding blocked preparation stops projecting the sealed repair approval", async (t) => {
  const fixture = repairWorkflowFixture(t);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const taskId = String(started.task_id);
  await fixture.facade.resume({ taskId, actorId });
  const approval = fixture.approval(taskId);
  const approved = await fixture.facade.resume({
    taskId,
    actorId,
    authorizationInputFile: approval.file,
  });
  assert.equal(permissionsOf(approved).state, "granted", JSON.stringify(approved.blockers));
  const callsBefore = repairDataCalls(fixture).length;
  registerBlockedPreparation(fixture, taskId);
  const after = await fixture.facade.status({ taskId, actorId });
  assert.notEqual(
    permissionsOf(after).state,
    "granted",
    `a superseded blocked preparation must never keep projecting authority: ${JSON.stringify(after)}`,
  );
  assert.ok(
    blockerCodes(after).includes("repair_preflight_blocked"),
    `the current preparation is blocked and must be reported as such: ${JSON.stringify(after.blockers)}`,
  );
  assert.equal(
    repairDataCalls(fixture).length,
    callsBefore,
    "losing the projection is a local re-derivation and never calls the owner CLI",
  );
});

/** A no-op whose remote proof is defective must never be reported as completed. */
async function assertNoOpNotCompleted(
  t: Parameters<typeof repairWorkflowFixture>[0],
  configure: (fixture: ReturnType<typeof repairWorkflowFixture>) => void,
  label: string,
): Promise<void> {
  const fixture = repairWorkflowFixture(t, { candidateText: "Original source" });
  configure(fixture);
  const started = await fixture.facade.start({ specFile: fixture.specFile });
  const resumed = await fixture.facade.resume({ taskId: String(started.task_id), actorId });
  assert.notEqual(
    resumed.status,
    "completed",
    `${label} must not be reported as completed: ${JSON.stringify(resumed)}`,
  );
  assert.ok(
    ["needs_input", "blocked", "failed"].includes(String(resumed.status)),
    `${label}: unexpected status ${String(resumed.status)}`,
  );
  assert.equal(
    repairDataCalls(fixture).some((call) => call.argv.includes("--commit")),
    false,
    `${label}: no write may follow a defective no-change proof`,
  );
}

test("a no-op with a wrong remote owner never completes", async (t) => {
  await assertNoOpNotCompleted(
    t,
    (fixture) => {
      fixture.rootReadback.remoteUserId = "99999999-9999-4999-8999-999999999999";
    },
    "a wrong remote owner",
  );
});

test("a no-op with a wrong remote state never completes", async (t) => {
  await assertNoOpNotCompleted(
    t,
    (fixture) => {
      fixture.rootReadback.remoteStateCode = 100;
    },
    "a wrong remote state",
  );
});

test("a no-op without the root readback row never completes", async (t) => {
  await assertNoOpNotCompleted(
    t,
    (fixture) => {
      fixture.rootReadback.omitRow = true;
    },
    "a missing root readback row",
  );
});

test("a no-op without the checks JSONL never completes", async (t) => {
  await assertNoOpNotCompleted(
    t,
    (fixture) => {
      fixture.rootReadback.omitChecksFile = true;
    },
    "a missing checks JSONL",
  );
});

test("a no-op with a duplicated root readback never completes", async (t) => {
  await assertNoOpNotCompleted(
    t,
    (fixture) => {
      fixture.rootReadback.duplicateRow = true;
    },
    "a duplicated root readback",
  );
});

test("a no-op with a wrong remote payload hash never completes", async (t) => {
  await assertNoOpNotCompleted(
    t,
    (fixture) => {
      fixture.rootReadback.payloadSha256 = "f".repeat(64);
    },
    "a wrong remote payload hash",
  );
});
