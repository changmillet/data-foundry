import { collectDatasetReferences } from "../../scripts/lib/import-curation/internal/workflow-reference-closure.ts";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { testAuthIdentityReceipt } from "./auth-identity-receipt.ts";
import { workflowFixture } from "./foundry-public-workflow.ts";

type Json = Record<string, unknown>;

const processId = "11111111-1111-4111-8111-111111111111";
const version = "01.00.000";
const ownerId = "42200000-0000-4000-8000-000000000001";
const projectRef = "abcdefghijklmnopqrst";

export interface RepairCliCall {
  readonly argv: readonly string[];
  readonly verb: string;
  readonly input: string | null;
  readonly outDir: string | null;
  readonly env: NodeJS.ProcessEnv;
}

export interface RepairApproval {
  readonly file: string;
  readonly descriptor: Json;
  readonly grant: Json;
  readonly reportFile: string;
}

export interface RepairApprovalOptions {
  /** Grant lifetime from now; pass a negative value for an expired approval. */
  readonly expiresInMs?: number;
  /** A digest the approval names instead of the registered preparation report. */
  readonly preparationSha256?: string;
  /** Drop the mandatory native execution contract reference. */
  readonly inputSha256?: string;
  readonly omitContract?: boolean;
}

export interface RepairWorkflowFixture {
  readonly root: string;
  readonly workspace: string;
  readonly account: { project_ref: string; user_id: string };
  readonly profileId: string;
  readonly facade: {
    start: (input: { specFile: string }) => Promise<Json>;
    status: (input: { taskId: string; actorId: string }) => Promise<Json>;
    resume: (input: {
      taskId: string;
      actorId: string;
      authorizationInputFile?: string;
    }) => Promise<Json>;
  };
  /** Write host approval material for the registered preparation of one task. */
  readonly approval: (taskId: string, options?: RepairApprovalOptions) => RepairApproval;
  readonly specFile: string;
  readonly contractFile: string;
  readonly beforeFile: string;
  readonly candidateFile: string;
  readonly beforePayload: Json;
  readonly candidatePayload: Json;
  readonly canonicalContractSha256: string;
  readonly calls: RepairCliCall[];
  /** The CLI's own aggregate rejection: a drifted remote root. */
  remoteMismatch: boolean;
  /** A dry run the owner CLI reports as retained or blocked. */
  blockedDryRun: boolean;
  /**
   * Root-proof knobs. They corrupt the checks records only: the summary keeps claiming a passed
   * verification with its declared counts, so a rejection proves the per-record proof.
   */
  rootReadback: {
    remoteUserId: string | null;
    remoteStateCode: number | null;
    payloadSha256: string | null;
    omitRow: boolean;
    duplicateRow: boolean;
    omitChecksFile: boolean;
  };
}

function payloadWith(text: string): Json {
  const payload = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "repair-process.json"), "utf8"),
  ) as Json;
  const dataSources = ((payload.processDataSet as Json).modellingAndValidation as Json)
    .dataSourcesTreatmentAndRepresentativeness as Json;
  const reference = (dataSources.referenceToDataSource as Json)["common:shortDescription"] as Json;
  assert.equal(reference["@xml:lang"], "en", "the fixture must carry one English source node");
  reference["#text"] = text;
  const ownership = ((payload.processDataSet as Json).administrativeInformation as Json)
    .publicationAndOwnership as Json;
  const owner = (ownership["common:referenceToOwnershipOfDataSet"] as Json)[
    "common:shortDescription"
  ] as Json;
  assert.equal(owner["@xml:lang"], "en", "the fixture must carry one English ownership node");
  owner["#text"] = "Owner A";
  return payload;
}

function writeJsonl(file: string, rows: readonly Json[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

/** The CLI writes every artifact under `<out-dir>/outputs/**`, so the directory must exist first. */
function writeReport(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Assert one intercepted CLI argument is present, narrowing it without a cast. */
function required(value: string | null): string {
  assert.ok(
    typeof value === "string" && value.length > 0,
    "the owner CLI argument must be present",
  );
  return value;
}

/**
 * One repair workflow fixture on top of the existing public workflow harness: the same public API
 * facade, qualified owner CLI/Tidas selection, trusted identity mock and workspace, plus the three
 * host-selected inputs of an existing-owner-draft metadata repair. Selections are declared relative
 * to the workspace root, exactly like the existing task-start examples.
 */
export function repairWorkflowFixture(
  t: TestContext,
  options: { beforeText?: string; candidateText?: string; profileId?: string } = {},
): RepairWorkflowFixture {
  const base = workflowFixture(t) as unknown as {
    root: string;
    workspace: string;
    facade: RepairWorkflowFixture["facade"];
  };
  const before = payloadWith(options.beforeText ?? "Original source");
  const candidate = payloadWith(options.candidateText ?? "Renamed source");
  const beforeSha = sha256Json(before);
  const desiredSha = sha256Json(candidate);
  const actions = [
    {
      action_id: "repair-1",
      desired_sha256: desiredSha,
      expected_operation: "save_draft",
      table: "processes",
      id: processId,
      version,
      before_sha256: beforeSha,
      dependency_action_ids: [],
    },
  ];
  const contract: Json = {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: "repair-public-1",
    project_ref: projectRef,
    target_mode: "owner_draft",
    owner: { user_id: ownerId, email: "owner@example.com", state_code: 0 },
    actions,
  };
  const inputsDirectory = path.join(base.workspace, "repair-inputs");
  fs.mkdirSync(inputsDirectory, { recursive: true });
  const contractFile = path.join(inputsDirectory, "repair-contract.json");
  const beforeFile = path.join(inputsDirectory, "repair-before.jsonl");
  const candidateFile = path.join(inputsDirectory, "repair-candidate.jsonl");
  fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  writeJsonl(beforeFile, [before]);
  writeJsonl(candidateFile, [candidate]);
  const relative = (file: string) => path.relative(base.workspace, file);
  const specFile = path.join(base.workspace, "repair-task-start.json");
  fs.writeFileSync(
    specFile,
    `${JSON.stringify(
      {
        schema: "tiangong-foundry.task-start.v1",
        request_id: "repair-public-request",
        actor_id: "identity-actor",
        lane: "existing-owner-draft-repair",
        profile_id: options.profileId ?? "generic",
        target_entities: ["process"],
        sources: [
          { path: relative(contractFile) },
          { path: relative(beforeFile) },
          { path: relative(candidateFile) },
        ],
        seed: null,
        account_intent: {
          project_ref: projectRef,
          user_id: ownerId,
          session_reference: null,
        },
        preparation: null,
        repair: {
          kind: "existing-owner-draft-metadata",
          contract: relative(contractFile),
          before: relative(beforeFile),
          candidate: relative(candidateFile),
          predecessor: null,
        },
      },
      null,
      2,
    )}\n`,
  );

  const fixture: RepairWorkflowFixture = {
    root: base.root,
    workspace: base.workspace,
    account: { project_ref: projectRef, user_id: ownerId },
    profileId: options.profileId ?? "generic",
    facade: base.facade,
    approval: (taskId, approvalOptions) => repairApproval(fixture, taskId, approvalOptions),
    specFile,
    contractFile,
    beforeFile,
    candidateFile,
    beforePayload: before,
    candidatePayload: candidate,
    canonicalContractSha256: sha256Json({
      schema_version: contract.schema_version,
      execution_id: contract.execution_id,
      project_ref: contract.project_ref,
      target_mode: contract.target_mode,
      owner: { user_id: ownerId, email: "owner@example.com", state_code: 0 },
      actions,
    }),
    calls: [],
    remoteMismatch: false,
    blockedDryRun: false,
    rootReadback: {
      remoteUserId: null,
      remoteStateCode: null,
      payloadSha256: null,
      omitRow: false,
      duplicateRow: false,
      omitChecksFile: false,
    },
  };
  installOwnerCliMock(t, fixture);
  return fixture;
}

/** The public task root of one facade task. */
export function repairTaskRoot(fixture: RepairWorkflowFixture, taskId: string): string {
  return path.join(fixture.workspace, ".foundry/workspaces", taskId);
}

/** The exact dataset identity one repair scope acts on. */
export const repairTarget = Object.freeze({
  id: processId,
  version,
  table: "processes",
  action_id: "repair-1",
});

/** Only the owner-CLI data invocations, excluding the identity receipt exchange. */
export function repairDataCalls(fixture: RepairWorkflowFixture): RepairCliCall[] {
  return fixture.calls.filter((call) => call.verb !== "identity-receipt");
}

/**
 * Register one newer preparation report of the same scope that is blocked. This is the state a
 * repeated read-only preflight produces after its scope stops being dispatchable: the report is a
 * real file produced under the repair producer's registration, chained onto the current index, so a
 * previously sealed approval must stop being projected from it.
 */
export function registerBlockedPreparation(
  fixture: RepairWorkflowFixture,
  taskId: string,
): { readonly path: string; readonly sha256: string } {
  const taskRoot = repairTaskRoot(fixture, taskId);
  const index = taskIndex(fixture, taskId);
  const previous = index.at(-1);
  const prepared = [...index]
    .reverse()
    .find(
      (entry) =>
        entry.command === "dataset-workflow-repair-preflight" &&
        typeof entry.path === "string" &&
        entry.path.endsWith("foundry-repair-preflight.json"),
    );
  assert.ok(previous, "the index must already carry the prepared registration");
  assert.ok(prepared, "the prepared registration must exist before it can be superseded");
  const report = JSON.parse(
    fs.readFileSync(path.join(taskRoot, String(prepared.path)), "utf8"),
  ) as Json;
  report.status = "blocked";
  report.blockers = [
    {
      code: "repair_cli_failed",
      message: "The owner CLI refused the repeated read-only preflight.",
    },
  ];
  const relative = path.join(
    "outputs",
    "repair",
    `repeat-${randomUUID()}`,
    "foundry-repair-preflight.json",
  );
  const file = path.join(taskRoot, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  const fact = fileFact(file);
  const unsigned: Json = {
    schema: "tiangong-foundry.artifact-index.v2",
    sequence: Number(previous.sequence) + 1,
    previous_sha256: String(previous.record_sha256),
    operation_id: String(prepared.operation_id),
    command: "dataset-workflow-repair-preflight",
    input_scope_sha256: String(prepared.input_scope_sha256),
    receipt: prepared.receipt,
    path: relative.split(path.sep).join("/"),
    bytes: fact.bytes,
    sha256: fact.sha256,
  };
  const entry = { ...unsigned, record_sha256: sha256Json(unsigned) };
  fs.appendFileSync(path.join(taskRoot, "artifact-index.jsonl"), `${JSON.stringify(entry)}\n`);
  return { path: file, sha256: fact.sha256 };
}

function fileFact(file: string): { bytes: number; sha256: string } {
  const content = fs.readFileSync(file);
  return {
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function taskIndex(fixture: RepairWorkflowFixture, taskId: string): Json[] {
  const file = path.join(repairTaskRoot(fixture, taskId), "artifact-index.jsonl");
  assert.equal(fs.existsSync(file), true, "a registered task owns its artifact index");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
}

/**
 * Write the host approval material of one repair: an explicit user decision, a task grant bound to
 * the exact candidate bytes and the locked profile, and an authorization descriptor whose authority
 * is the registered preparation report - never a finalization report.
 */
function repairApproval(
  fixture: RepairWorkflowFixture,
  taskId: string,
  options: RepairApprovalOptions = {},
): RepairApproval {
  const taskRoot = repairTaskRoot(fixture, taskId);
  const report = taskIndex(fixture, taskId).find(
    (entry) =>
      entry.command === "dataset-workflow-repair-preflight" &&
      typeof entry.path === "string" &&
      entry.path.endsWith("foundry-repair-preflight.json"),
  );
  assert.ok(report, "the preparation report must be registered before it can be approved");
  const reportFile = path.join(taskRoot, String(report.path));
  const candidate = fileFact(fixture.candidateFile);
  const contract = fileFact(fixture.contractFile);
  const marker = JSON.parse(
    fs.readFileSync(path.join(fixture.workspace, ".foundry", "workspace.json"), "utf8"),
  ) as Json;
  const lock = JSON.parse(
    fs.readFileSync(path.join(taskRoot, "profile-lock.json"), "utf8"),
  ) as Json;
  const nonce = randomUUID();
  const evidenceFile = path.join(fixture.root, `repair-approval-${nonce}.txt`);
  fs.writeFileSync(
    evidenceFile,
    "Controlled approval of the exact owner-draft metadata repair scope. No real remote writes.\n",
  );
  const issued = Date.now();
  const expiresInMs = options.expiresInMs ?? 3_600_000;
  const grant: Json = {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: {
      workspace_id: String(marker.workspace_id),
      task_id: taskId,
      actor_id: "identity-actor",
      project_ref: fixture.account.project_ref,
      user_id: fixture.account.user_id,
      profile_id: fixture.profileId,
      profile_sha256: String(lock.profile_sha256),
      input_scope_sha256: candidate.sha256,
    },
    issued_at_utc: new Date(
      expiresInMs < 0 ? issued + expiresInMs - 3_600_000 : issued - 1_000,
    ).toISOString(),
    expires_at_utc: new Date(issued + expiresInMs).toISOString(),
    remote_state_code: 0,
    allowed_actions: [],
    qa_waivers: [],
    evidence: [
      {
        id: "approval",
        kind: "user-decision",
        reference: fs.realpathSync(evidenceFile),
        sha256: fileFact(evidenceFile).sha256,
      },
    ],
  };
  const grantFile = path.join(fixture.root, `repair-grant-${nonce}.json`);
  fs.writeFileSync(grantFile, `${JSON.stringify(grant, null, 2)}\n`);
  const boundPreparation = options.preparationSha256 ?? String(report.sha256);
  const descriptor: Json = {
    schema: "tiangong-foundry.authorization-input.v1",
    task_id: taskId,
    actor_id: "identity-actor",
    finalization_sha256: boundPreparation,
    dataset_type: "process",
    input_kind: "repair_rows",
    input_sha256: options.inputSha256 ?? candidate.sha256,
    expected_previous_sha256: null,
    ...(options.omitContract
      ? {}
      : {
          execution_contract: { file: fixture.contractFile, sha256: contract.sha256 },
        }),
    repair_preparation: { file: reportFile, sha256: boundPreparation },
    grant: { file: grantFile, sha256: fileFact(grantFile).sha256 },
    evidence: [
      {
        id: "approval",
        kind: "user-decision",
        file: evidenceFile,
        sha256: fileFact(evidenceFile).sha256,
      },
    ],
  };
  const file = path.join(fixture.root, `repair-approval-input-${nonce}.json`);
  fs.writeFileSync(file, `${JSON.stringify(descriptor, null, 2)}\n`);
  return { file, descriptor, grant, reportFile };
}

/**
 * Serve the owner CLI exactly as the trusted boundary allows: the installed package under
 * `process.execPath`, no shell, and an environment carrying no ambient token or CLI override. The
 * identity receipt exchange is answered with the trusted test receipt; the repair data commands are
 * answered with fixtures. Every other spawn is delegated unchanged.
 */
function installOwnerCliMock(t: TestContext, fixture: RepairWorkflowFixture): void {
  const original = childProcess.spawnSync.bind(childProcess);
  const installed = resolveInstalledTiangongLcaCliPackage();
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const [command, argv, options] = args as [string, readonly string[], Json | undefined];
    if (!Array.isArray(argv) || argv.length < 2) return original(...args);
    const isIdentity = argv[1] === "auth";
    const verb = String(argv[2]);
    if (!isIdentity && argv[1] !== "dataset") return original(...args);
    if (!isIdentity && !["save-draft", "validate", "verify-remote"].includes(verb))
      return original(...args);
    // The trusted boundary, asserted on every intercepted call.
    assert.equal(command, process.execPath);
    assert.equal(argv[0], installed.binPath, "only the installed owner CLI may run");
    assert.equal(options?.shell, false);
    const env = (options?.env ?? {}) as NodeJS.ProcessEnv;
    assert.equal(env.TIANGONG_LCA_CLI_BIN, undefined, "no ambient CLI override");
    assert.equal(env.TIANGONG_LCA_ACCESS_TOKEN, undefined, "no ambient access token");
    const inputIndex = argv.indexOf("--input");
    const input = inputIndex >= 0 ? String(argv[inputIndex + 1]) : null;
    const outIndex = argv.indexOf("--out-dir");
    const outDir = outIndex >= 0 ? String(argv[outIndex + 1]) : null;
    fixture.calls.push({ argv: [...argv], verb, input, outDir, env });
    let report: unknown;
    let status = 0;
    if (isIdentity) {
      report = testAuthIdentityReceipt({
        projectRef: fixture.account.project_ref,
        userId: fixture.account.user_id,
        capturedAtUtc: new Date(Date.now()).toISOString(),
      });
    } else if (verb === "save-draft") {
      report = serveDryRun(fixture, required(input), required(outDir));
    } else if (verb === "validate") {
      const served = serveValidate(fixture, required(input), required(outDir));
      report = served.report;
      status = served.status;
    } else {
      report = serveVerifyRemote(fixture, required(input), required(outDir));
    }
    const stdout = JSON.stringify(report);
    const result: childProcess.SpawnSyncReturns<string> = {
      status,
      signal: null,
      stdout,
      stderr: "",
      pid: 1,
      output: [null, stdout, ""],
    };
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());
}

function validationLayers(): Json {
  const layer = (status: string, issues: Json[] = []) => ({
    status,
    issue_count: issues.length,
    issues,
  });
  const gap = {
    code: "annual_supply_or_production_volume_missing",
    message: "Process payload must include annualSupplyOrProductionVolume evidence.",
    path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume",
  };
  return {
    schema: layer("passed"),
    authoring_evidence: layer("failed", [gap]),
    content: layer("passed"),
    multilingual: layer("passed"),
  };
}

function serveDryRun(fixture: RepairWorkflowFixture, input: string, outDir: string): Json {
  const desiredSha = sha256Json(fixture.candidatePayload);
  const beforeSha = sha256Json(fixture.beforePayload);
  const blocked = fixture.blockedDryRun;
  const files = {
    selected_rows: path.join(outDir, "outputs", "selected-rows.jsonl"),
    progress_jsonl: path.join(outDir, "outputs", "progress.jsonl"),
    failures_jsonl: path.join(outDir, "outputs", "failures.jsonl"),
    summary_json: path.join(outDir, "outputs", "summary.json"),
  };
  writeJsonl(files.selected_rows, [fixture.candidatePayload]);
  writeJsonl(files.progress_jsonl, [
    {
      index: 0,
      id: processId,
      version,
      table: "processes",
      status: blocked ? "blocked" : "prepared",
      operation: blocked ? "retained_attempt" : "would_sync",
      readback: "not_performed",
      visible_row: { user_id: ownerId, state_code: 0, id: processId, version },
    },
  ]);
  writeJsonl(files.failures_jsonl, []);
  const report: Json = {
    schema_version: 2,
    generated_at_utc: "2026-09-21T00:00:00.000Z",
    input_path: input,
    requested_type: "process",
    out_dir: outDir,
    commit: false,
    mode: "dry_run",
    status: blocked ? "completed_with_failures" : "completed",
    counts: {
      selected: 1,
      prepared: blocked ? 0 : 1,
      executed: 0,
      failed: 0,
      unknown: 0,
      blocked: blocked ? 1 : 0,
      attempts_consumed: 0,
      by_table: { processes: 1 },
      operations: blocked ? { retained_attempt: 1 } : { would_sync: 1 },
    },
    files,
    execution_contract: {
      path: fixture.contractFile,
      sha256: fixture.canonicalContractSha256,
      execution_id: "repair-public-1",
      target_mode: "owner_draft",
      max_parallel: 1,
      serial_prefix_actions: 0,
      parallel_suffix_actions: 1,
    },
    rows: [
      {
        index: 0,
        id: processId,
        version,
        type: "process",
        table: "processes",
        status: blocked ? "blocked" : "prepared",
        operation: blocked ? "retained_attempt" : "would_sync",
        readback: "not_performed",
        visible_row: { user_id: ownerId, state_code: 0, id: processId, version },
        validation: {
          ok: false,
          validator: "@tiangong-lca/tidas-sdk/ProcessSchema+tiangong/process-authoring",
          issue_count: 1,
          issues: [
            {
              code: "annual_supply_or_production_volume_missing",
              message: "Process payload must include annualSupplyOrProductionVolume evidence.",
              path: "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume",
            },
          ],
          payload_sha256: desiredSha,
          validation_layers: validationLayers(),
        },
        action_id: "repair-1",
        desired_sha256: desiredSha,
        attempt_consumed: false,
        replayed: false,
        draft_repair_admission: {
          schema: "dataset-draft-repair-admission.v1",
          status: "admitted",
          policy: "process-metadata-unknown-annual.v1",
          before_sha256: beforeSha,
          desired_sha256: desiredSha,
          changed_paths: [
            "processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.referenceToDataSource.common:shortDescription.#text",
          ],
          publication_ready: false,
        },
      },
    ],
  };
  writeReport(files.summary_json, report);
  return report;
}

function serveValidate(
  fixture: RepairWorkflowFixture,
  input: string,
  outDir: string,
): { report: Json; status: number } {
  const payloadSha = sha256Json(fixture.candidatePayload);
  fs.mkdirSync(outDir, { recursive: true });
  const report: Json = {
    schema_version: 2,
    status: "completed_with_failures",
    input_path: input,
    out_dir: outDir,
    counts: { rows: 1, valid: 0, invalid: 1 },
    files: {
      report: path.join(outDir, "outputs", "validation-report.json"),
      valid_rows: path.join(outDir, "outputs", "valid-rows.jsonl"),
      invalid_rows: path.join(outDir, "outputs", "invalid-rows.jsonl"),
    },
    rows: [
      {
        index: 0,
        id: processId,
        version,
        status: "invalid",
        payload_sha256: payloadSha,
        issue_count: 1,
        validation_layers: validationLayers(),
      },
    ],
  };
  writeReport(path.join(outDir, "outputs", "validation-report.json"), report);
  writeJsonl(path.join(outDir, "outputs", "invalid-rows.jsonl"), [fixture.candidatePayload]);
  writeJsonl(path.join(outDir, "outputs", "valid-rows.jsonl"), []);
  return { report, status: 1 };
}

function serveVerifyRemote(fixture: RepairWorkflowFixture, input: string, outDir: string): Json {
  const expected = input.includes("candidate") ? fixture.candidatePayload : fixture.beforePayload;
  const localSha = sha256Json(expected);
  const knobs = fixture.rootReadback;
  fs.mkdirSync(outDir, { recursive: true });
  // The real wire: one existence row per root and reference, each carrying its own status, plus
  // exactly one root readback row per intended root (`path` ending in `#readback`, with the remote
  // owner/state and both payload hashes). checked === references + root_readback_checks.
  const existence = [
    {
      row_index: -1,
      role: "root",
      table: "processes",
      type: "process",
      id: processId,
      version,
      path: "/processDataSet",
      status: "ok",
    },
    ...collectDatasetReferences(expected).map((reference) => ({
      ...reference,
      row_index: 0,
      role: "reference",
      status: "ok",
    })),
  ];
  const readback = {
    row_index: 0,
    role: "root",
    table: "processes",
    type: "process",
    id: processId,
    version,
    path: "/processDataSet#readback",
    status: "ok",
    remote_user_id: knobs.remoteUserId ?? ownerId,
    remote_state_code: knobs.remoteStateCode ?? 0,
    local_payload_sha256: localSha,
    remote_payload_sha256: knobs.payloadSha256 ?? localSha,
  };
  const checks = [
    ...existence,
    ...(knobs.omitRow ? [] : [readback]),
    ...(knobs.duplicateRow ? [readback] : []),
  ];
  // Only `remoteMismatch` reproduces the CLI's own aggregate rejection. The root-proof knobs corrupt
  // the checks records alone, so the summary still claims a passed verification with its declared
  // counts and a negative outcome proves the per-record proof instead of the aggregate gate.
  const references = existence.length;
  const declaredChecked = references + 1;
  if (!knobs.omitChecksFile)
    writeJsonl(path.join(outDir, "outputs", "remote-verification.jsonl"), checks);
  writeJsonl(
    path.join(outDir, "outputs", "blockers.jsonl"),
    fixture.remoteMismatch
      ? [{ row_index: 0, code: "payload_mismatch", table: "processes", id: processId }]
      : [],
  );
  const report: Json = {
    schema_version: 1,
    generated_at_utc: "2026-09-21T00:00:00.000Z",
    status: fixture.remoteMismatch ? "blocked_remote_verification" : "passed_remote_verification",
    files: {
      report: path.join(outDir, "outputs", "remote-verification-report.json"),
      checks: path.join(outDir, "outputs", "remote-verification.jsonl"),
      blockers: path.join(outDir, "outputs", "blockers.jsonl"),
    },
    root_policy: "existing",
    input_path: input,
    out_dir: outDir,
    counts: {
      rows: 1,
      references,
      checked: declaredChecked,
      blockers: fixture.remoteMismatch ? 1 : 0,
      root_readback_checks: 1,
      root_payload_mismatches: fixture.remoteMismatch ? 1 : 0,
      by_status: fixture.remoteMismatch
        ? { ok: declaredChecked - 1, payload_mismatch: 1 }
        : { ok: declaredChecked },
      by_table: { processes: 1 },
    },
    blockers: fixture.remoteMismatch ? [{ row_index: 0, code: "payload_mismatch" }] : [],
  };
  writeReport(path.join(outDir, "outputs", "remote-verification-report.json"), report);
  return report;
}
