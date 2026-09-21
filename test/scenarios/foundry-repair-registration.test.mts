import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const ownerId = "11111111-1111-4111-8111-111111111111";
const projectRef = "abcdefghijklmnopqrst";
const processId = "22222222-2222-4222-8222-222222222222";
const version = "01.00.000";

type Json = Record<string, unknown>;

function nodes(values: readonly [string, string][]): Json[] {
  return values.map(([lang, text]) => ({ "@xml:lang": lang, "#text": text }));
}

function payload(text: string): Json {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: { baseName: nodes([["en", "Steel"]]) },
        },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          annualSupplyOrProductionVolume: [],
          referenceToDataSource: [
            { "@dataSetInternalID": "1", "common:shortDescription": nodes([["en", text]]) },
          ],
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": version,
          "common:referenceToOwnershipOfDataSet": [
            { "@dataSetInternalID": "2", "common:shortDescription": nodes([["en", "Owner A"]]) },
          ],
        },
      },
      exchanges: { exchange: [{ "@dataSetInternalID": "3", meanAmount: "1.5" }] },
    },
  };
}

/**
 * One offline repair registration fixture per case. Registration never runs an owner CLI: it captures
 * the three host-selected inputs, validates the repair scope locally and records `repair-scope.json`
 * only. `mutate` rewrites the selected files before capture so a malformed case is genuinely selected
 * as malformed; every fixture owns its root, task id and workspace, so no case can observe another's
 * registration.
 */
let fixtureSequence = 0;
function repairFixture(
  t: { after: (fn: () => void) => void },
  candidateText: string,
  mutate?: (files: { contractFile: string; candidateFile: string; beforeFile: string }) => void,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-repair-registration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = payload("Original source");
  const candidate = payload(candidateText);
  const contract: Json = {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: "repair-exec-1",
    project_ref: projectRef,
    target_mode: "owner_draft",
    owner: { user_id: ownerId, email: "owner@example.com", state_code: 0 },
    actions: [
      {
        action_id: "repair-1",
        desired_sha256: sha256Json(candidate),
        expected_operation: "save_draft",
        table: "processes",
        id: processId,
        version,
        before_sha256: sha256Json(before),
        dependency_action_ids: [],
      },
    ],
  };
  const contractFile = path.join(root, "contract.json");
  const beforeFile = path.join(root, "before.jsonl");
  const candidateFile = path.join(root, "candidate.jsonl");
  fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  fs.writeFileSync(beforeFile, `${JSON.stringify(before)}\n`);
  fs.writeFileSync(candidateFile, `${JSON.stringify(candidate)}\n`);
  mutate?.({ contractFile, beforeFile, candidateFile });
  const inputs = [contractFile, beforeFile, candidateFile].map((file) => captureFoundryInput(file));
  const options = {
    moduleUrl,
    workspace: path.join(root, "project"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(options));
  fixtureSequence += 1;
  const context = createFoundryRuntimeContext({
    ...options,
    taskId: `repair-task-${fixtureSequence}`,
    actorId: "agent/repair",
    accountIntent: { projectRef, userId: ownerId },
    inputs,
  });
  return {
    root,
    contractFile,
    beforeFile,
    candidateFile,
    context,
    runtime: createFoundryRuntime(context),
    selection: {
      kind: "existing-owner-draft-metadata",
      contract: inputs[0].path,
      before: inputs[1].path,
      candidate: inputs[2].path,
      predecessor: null,
    },
  };
}

const hasCode = (code: string) => (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === code,
  );

test("RED/GREEN: task start is offline — no owner CLI, no auth, no environment", async (t) => {
  const fixture = repairFixture(t, "Renamed source");
  // Any owner-CLI execution at start would have to run this binary; it does not exist.

  const task = fixture.runtime.startTask({
    lane: "existing-owner-draft-repair",
    requestId: "repair-request-offline",
    targetEntities: ["process"],
    repair: fixture.selection,
  });
  assert.equal(task.job.repair?.kind, "existing-owner-draft-metadata");
  // Offline registration records the validated scope only: no remote preflight artifact, no completion.
  const scopeDoc = JSON.parse(
    fs.readFileSync(path.join(fixture.context.taskRoot!, "repair-scope.json"), "utf8"),
  );
  assert.equal(scopeDoc.status, "dispatchable");
  assert.equal(
    fs.existsSync(path.join(fixture.context.taskRoot!, "repair-preflight.json")),
    false,
    "task start must not record a remote preflight result",
  );
  assert.equal(fs.existsSync(path.join(fixture.context.taskRoot!, "attempts")), false);
  assert.equal(
    fs.existsSync(path.join(fixture.context.taskRoot!, "outputs/execution-requests")),
    false,
  );
});

test("a stale or mismatched repair selection blocks registration with zero writes", async (t) => {
  const stale = repairFixture(t, "Renamed source", ({ contractFile }) => {
    const contract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
    contract.actions[0].before_sha256 = "f".repeat(64);
    fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  });
  assert.throws(
    () =>
      stale.runtime.startTask({
        lane: "existing-owner-draft-repair",
        requestId: "repair-request-stale",
        targetEntities: ["process"],
        repair: stale.selection,
      }),
    hasCode("repair_before_content_mismatch"),
  );
  assert.equal(fs.existsSync(path.join(stale.context.taskRoot!, "attempts")), false);

  const invalid = repairFixture(t, "Renamed source", ({ candidateFile, contractFile }) => {
    const scientific = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
    scientific.processDataSet.exchanges.exchange[0].meanAmount = "9.9";
    fs.writeFileSync(candidateFile, `${JSON.stringify(scientific)}\n`);
    const contract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
    contract.actions[0].desired_sha256 = sha256Json(scientific);
    fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  });
  assert.throws(
    () =>
      invalid.runtime.startTask({
        lane: "existing-owner-draft-repair",
        requestId: "repair-request-science",
        targetEntities: ["process"],
        repair: invalid.selection,
      }),
    hasCode("repair_provider_impact_diagnostics_missing"),
  );
  assert.equal(fs.existsSync(path.join(invalid.context.taskRoot!, "attempts")), false);
});
