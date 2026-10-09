import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { describeCliRuntime, CLI_RUNTIME_EXPECTATION_SCHEMA } from "@tiangong-lca/cli/runtime";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  qualifyFoundryRuntime,
  FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
} from "../../scripts/lib/foundry-runtime-qualification.ts";
import {
  runFoundryTaskOperation,
  readFoundryTaskArtifactIndex,
} from "../../scripts/lib/foundry-task-store.ts";
import { sha256Json, sha256Text } from "../../scripts/lib/identity-preflight-proof.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import {
  selectFoundryIdentityStageInput,
  type FoundryIdentityStageInput,
  type SelectedFoundryIdentityStageInput,
} from "../../scripts/lib/foundry-identity-stage-input.ts";
import { testAuthIdentityReceipt } from "./auth-identity-receipt.ts";
import {
  currentFoundryInteractionState,
  selectFoundryInteractionInput,
} from "../../scripts/lib/foundry-interaction-input.ts";
import { recordFoundryInteractionInput } from "../../scripts/lib/foundry-workflow-interaction.ts";
import { flowRow, processRowWithFlowRef } from "./row-builders.ts";

export async function explicitIdentityStageFixture(
  t: TestContext,
  mixed = false,
  facilities = false,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "explicit-foundry-identity-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = "77777777-7777-4777-8777-777777777777";
  const basic = flowRow(id);
  const flow = {
    flowDataSet: {
      ...basic.flowDataSet,
      flowInformation: {
        dataSetInformation: {
          ...basic.flowDataSet.flowInformation.dataSetInformation,
          name: {
            ...basic.flowDataSet.flowInformation.dataSetInformation.name,
            mixAndLocationTypes: { "@xml:lang": "en", "#text": "Swiss market" },
          },
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "06", "#text": "Crude petroleum and natural gas" },
              ],
            },
          },
        },
      },
      modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
      flowProperties: {
        flowProperty: [
          {
            "@dataSetInternalID": "0",
            referenceToFlowPropertyDataSet: {
              "@refObjectId": "93a60a56-a3c8-11da-a746-0800200b9a66",
              "@version": "03.00.003",
              "common:shortDescription": { "@xml:lang": "en", "#text": "Mass" },
            },
            meanValue: "1",
          },
        ],
      },
    },
  };
  const processBasic = processRowWithFlowRef("88888888-8888-4888-8888-888888888888", id);
  const process = {
    processDataSet: {
      ...processBasic.processDataSet,
      processInformation: {
        ...processBasic.processDataSet.processInformation,
        dataSetInformation: {
          ...processBasic.processDataSet.processInformation.dataSetInformation,
          classificationInformation: {
            "common:classification": {
              "common:class": [
                { "@level": "0", "@classId": "35", "#text": "Electricity and heat production" },
              ],
            },
          },
        },
        quantitativeReference: { referenceToReferenceFlow: "0" },
        geography: { locationOfOperationSupplyOrProduction: { "@location": "CH" } },
      },
      exchanges: {
        exchange: [
          {
            ...processBasic.processDataSet.exchanges.exchange[0],
            "@dataSetInternalID": "0",
            exchangeDirection: "Output",
            referenceToFlowDataSet: {
              ...processBasic.processDataSet.exchanges.exchange[0].referenceToFlowDataSet,
              "common:shortDescription": { "@xml:lang": "en", "#text": "Natural gas" },
            },
            meanAmount: "1",
          },
        ],
      },
    },
  };
  const values: Array<{
    id: string;
    version: string;
    json: Record<string, unknown>;
    source_label: string;
  }> = [
    { id, version: "00.00.001", json: flow, source_label: "unchanged envelope" },
    ...(facilities
      ? ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"].map(
          (flowId) => ({
            id: flowId,
            version: "00.00.001",
            source_label: "unchanged envelope",
            json: {
              flowDataSet: {
                ...flow.flowDataSet,
                flowInformation: {
                  dataSetInformation: {
                    ...flow.flowDataSet.flowInformation.dataSetInformation,
                    "common:UUID": flowId,
                  },
                },
              },
            },
          }),
        )
      : []),
    ...(mixed
      ? [
          {
            id: "88888888-8888-4888-8888-888888888888",
            version: "00.00.001",
            json: process,
            source_label: "unchanged envelope",
          },
        ]
      : []),
    ...(facilities
      ? ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"].map(
          (sourceId) => ({
            id: sourceId,
            version: "00.00.001",
            json: { sourceDataSet: { "common:UUID": sourceId } },
            source_label: "out-of-scope source",
          }),
        )
      : []),
  ];
  const datasetType = (row: (typeof values)[number]) =>
    "flowDataSet" in row.json ? "flow" : "processDataSet" in row.json ? "process" : "source";
  const groups = (["flow", "process", "source"] as const)
    .map((type) => ({ type, rows: values.filter((row) => datasetType(row) === type) }))
    .filter((set) => set.rows.length);
  const seed = path.join(root, "seed.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: values }));
  const base = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: path.join(root, "workspace"),
    cacheBase: path.join(root, "cache"),
  };
  initializeFoundryWorkspace(createFoundryRuntimeContext(base));
  const account = {
    projectRef: "qgzvkongdjqiiamzbbts",
    userId: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
  };
  const original = createFoundryRuntimeContext({
    ...base,
    taskId: `task-${"1".repeat(64)}-r0001`,
    actorId: "original-actor",
    accountIntent: account,
    inputs: [captureFoundryInput(seed)],
  });
  createFoundryRuntime(original).startTask({
    requestId: "identity-stage-original",
    lane: "source-evidence-dataset-development",
    profileId: "generic",
    targetEntities: groups.map((group) => group.type),
    seed: { rows: values },
  });
  const rowsFile = path.join(original.taskRoot!, "outputs", "original", "foundry-rows.json");
  const rowFiles = groups.map((_, at) =>
    path.join(original.taskRoot!, "outputs", "original", `${at}.jsonl`),
  );
  await runFoundryTaskOperation(
    original,
    { command: "dataset-workflow-rows", options: {} },
    (operation) => {
      groups.forEach((group, at) =>
        operation.writeText(
          rowFiles[at],
          group.rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
        ),
      );
      const report = {
        schema: "tiangong-foundry.rows-stage.v1",
        status: "completed",
        sets: groups.map((group, at) => ({
          type: group.type,
          file: rowFiles[at],
          count: group.rows.length,
        })),
        identity_reports: [],
        identity_rewrite_reports: [],
      };
      operation.writeJson(rowsFile, report);
      return report;
    },
  );
  await runFoundryTaskOperation(
    original,
    { command: "dataset-workflow-assessment", options: {} },
    (operation) => {
      const report = {
        schema: "tiangong-foundry.assessment-stage.v1",
        status: "completed",
        owner_base: original.assetRoot,
        rows_report: rowsFile,
        identity_report: "superseded-assessment-identity",
        sets: groups.map((group, at) => ({ type: group.type, rows: rowFiles[at] })),
      };
      operation.writeJson("outputs/original/foundry-assessment.json", report);
      return report;
    },
  );
  const oldIdentity = path.join(original.taskRoot!, "outputs", "original", "foundry-identity.json");
  await runFoundryTaskOperation(
    original,
    { command: "dataset-workflow-identity", options: { historical: true } },
    (operation) => {
      const report = {
        schema: "tiangong-foundry.identity-stage.v1",
        status: "blocked",
        rows_report: rowsFile,
        owner_base: original.assetRoot,
        account: { project_ref: account.projectRef, user_id: account.userId },
        sets: [],
        blockers: [{ code: "historical-receipt-absent" }],
        index: null,
      };
      operation.writeJson(oldIdentity, report);
      return report;
    },
  );
  const context = createFoundryRuntimeContext({
    ...base,
    taskId: original.taskId!,
    actorId: original.actorId!,
    accountIntent: account,
    inputs: [seed, rowsFile, ...rowFiles, oldIdentity].map(captureFoundryInput),
  });
  const binary = path.resolve(import.meta.dirname, "fake-tidas.ts"),
    cli = describeCliRuntime();
  const qualified = qualifyFoundryRuntime(context, {
    cliExpectation: {
      schema: CLI_RUNTIME_EXPECTATION_SCHEMA,
      package_version: cli.package.version,
      platform: cli.platform,
      content_sha256: cli.content_sha256,
      node_version: cli.node.version,
      node_sha256: cli.node.sha256,
    },
    tidasExecutable: binary,
    tidasExpectation: {
      schema: FOUNDRY_TIDAS_EXPECTATION_SCHEMA,
      platform: cli.platform,
      binary_version: "0.2.7",
      executable: {
        bytes: fs.statSync(binary).size,
        sha256: sha256Text(fs.readFileSync(binary, "utf8")),
      },
      validation: {
        schema_version: "tidas.validation-describe.v1",
        asset_fingerprint: "1".repeat(64),
        protocols: ["document-validation-batch.v1"],
        event_schema_versions: [
          "tidas.validation-final-event.v1",
          "tidas.validation-issue-event.v1",
        ],
      },
    },
  });
  const input: FoundryIdentityStageInput = {
    schema: "tiangong-foundry.identity-stage-input.v1",
    intent_id: "new-read-only-intent",
    task_id: context.taskId!,
    actor_id: context.actorId!,
    rows_report_sha256: captureFoundryInput(rowsFile).sha256,
    predecessor_identity_sha256: captureFoundryInput(oldIdentity).sha256,
    targets: values
      .filter((row) => datasetType(row) !== "source")
      .map((row) => ({
        dataset_type: datasetType(row) as "flow" | "process",
        dataset_id: row.id,
        dataset_version: row.version,
        source_row_sha256: sha256Json(row),
      })),
  };
  const descriptor = path.join(root, "intent.json");
  const selection = (value = input): SelectedFoundryIdentityStageInput => {
    fs.writeFileSync(descriptor, JSON.stringify(value));
    return selectFoundryIdentityStageInput(context, descriptor);
  };
  const originalSpawn = childProcess.spawnSync;
  let queries = 0,
    authCalls = 0;
  let beforeSearch: (() => void) | null = null;
  let outcome: "manual" | "error" | "throw" | "wrong-target-exit0" | "stderr-exit0" = "manual";
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (
      !Array.isArray(argv) ||
      (!argv.includes("identity-preflight") && !argv.includes("identity-receipt"))
    )
      return Reflect.apply(originalSpawn, childProcess, args);
    if (argv.includes("identity-receipt")) {
      authCalls++;
      return {
        status: 0,
        signal: null,
        stderr: "",
        stdout: JSON.stringify(
          testAuthIdentityReceipt({
            projectRef: account.projectRef,
            userId: account.userId,
            capturedAtUtc: new Date(Date.now()).toISOString(),
            ...(args[2]?.env?.TIANGONG_LCA_AUTH_MODE === "access_token"
              ? {
                  scopeOverrides: {
                    session: {
                      source: "access_token",
                      cache_mode: "disabled",
                      force_reauth: false,
                      expires_at_utc: null,
                    },
                  },
                }
              : {}),
          }),
        ),
        pid: 1,
        output: [],
      };
    }
    queries++;
    beforeSearch?.();
    if (outcome === "throw") throw new Error("transport interrupted");
    const requestFile = argv[argv.indexOf("--input") + 1],
      outDir = argv[argv.indexOf("--out-dir") + 1];
    const request = JSON.parse(fs.readFileSync(requestFile, "utf8")) as { target: unknown };
    const type = argv[1],
      identity = datasetIdentity(request.target, 0, type);
    const exitZero = outcome.endsWith("exit0");
    const report = {
      schema_version: 1,
      generated_at_utc: new Date().toISOString(),
      kind: type,
      status: exitZero ? "passed" : outcome === "error" ? "failed" : "needs_review",
      decision: exitZero || outcome === "error" ? null : "manual_review",
      target: {
        id: outcome === "wrong-target-exit0" ? "99999999-9999-4999-8999-999999999999" : identity.id,
        version: identity.version,
      },
      input_path: requestFile,
      out_dir: outDir,
      files: { identity_decision: path.join(outDir, "outputs", "identity-decision.json") },
      candidates: [],
      candidate_sources: [],
      findings: [],
      blockers: [],
      next_action: "queue_manual_review",
      ok: outcome !== "error",
    };
    fs.mkdirSync(path.join(outDir, "outputs"), { recursive: true });
    fs.writeFileSync(report.files.identity_decision, JSON.stringify(report) + "\n");
    const fresh = new Date(Date.now() + 1);
    fs.utimesSync(report.files.identity_decision, fresh, fresh);
    return {
      status: exitZero ? 0 : 1,
      signal: null,
      stdout: JSON.stringify(report),
      stderr: outcome === "stderr-exit0" ? "unexpected diagnostic" : "",
      pid: 1,
      output: [],
    };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const prefix = readFoundryTaskArtifactIndex(context);
  const preserved = fs.readFileSync(oldIdentity);
  return {
    root,
    context,
    qualified,
    input,
    selection,
    prefix,
    rowFiles,
    oldIdentity,
    recordQuestion: async (type: "flow" | "source" = "flow", investigate = false) => {
      const index = readFoundryTaskArtifactIndex(context);
      const descriptor = path.join(root, `question-${type}.json`);
      fs.writeFileSync(
        descriptor,
        JSON.stringify({
          schema: "tiangong-foundry.interaction-input.v1",
          task_id: context.taskId,
          actor_id: context.actorId,
          expected_state_sha256:
            currentFoundryInteractionState(context, index)?.entry.sha256 ?? null,
          events: [
            {
              kind: "question",
              id: `pending-${type}-question`,
              dataset_type: type,
              missing: "Registered evidence needs a current decision.",
              impact: "The decision affects this task's scientific context.",
              recommendation: "Resolve the current evidence question.",
              ask: "Which current evidence should this task use?",
              choices: [],
              evidence_sha256: [],
              supersedes: null,
            },
            ...(investigate
              ? [
                  {
                    kind: "answer",
                    question_id: `pending-${type}-question`,
                    decision_id: `investigate-${type}`,
                    supersedes_decision_id: null,
                    raw_answer: "Investigate the registered evidence first.",
                    adopted_decision: null,
                    disposition: "investigate",
                    evidence_sha256: [],
                  },
                ]
              : []),
          ],
        }),
      );
      await recordFoundryInteractionInput(
        context,
        index,
        selectFoundryInteractionInput(context, descriptor),
        groups.map((group) => group.type),
      );
    },
    counts: () => ({ queries, authCalls }),
    beforeSearch: (inspect: () => void) => {
      beforeSearch = inspect;
    },
    outcome: (next: typeof outcome) => {
      outcome = next;
    },
    assertPreserved: () => {
      assert.ok(fs.readFileSync(oldIdentity).equals(preserved));
      const current = readFoundryTaskArtifactIndex(context);
      assert.deepEqual(current.slice(0, prefix.length), prefix);
      assert.equal(
        current.some(
          (entry) =>
            entry.command.includes("execution") ||
            entry.command.includes("authorization") ||
            entry.command.includes("finalize"),
        ),
        false,
      );
    },
  };
}
