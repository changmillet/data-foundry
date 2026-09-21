import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  resolveFoundryInputPath,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { verifyFoundryRuntimeIdentity } from "./foundry-runtime-identity.ts";
import {
  createFoundryAuthenticationEnvironment,
  type FoundryAuthentication,
} from "./foundry-authentication-environment.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { runFoundryTaskOperation, withFoundryTaskMetadata } from "./foundry-task-store.ts";
import { createWorkflowDirectory, createWorkflowStageDirectory } from "./foundry-workflow-io.ts";
import { readWorkflowArtifact } from "./foundry-workflow-state.ts";
import { readFoundryRepairScope, type FoundryRepairScope } from "./foundry-repair-scope.ts";
import {
  FOUNDRY_REPAIR_PREPARATION_SCHEMA,
  assertFoundryRepairRootProof,
  parseFoundryRepairDryRunReport,
  parseFoundryRepairRemoteReport,
  parseFoundryRepairValidateReport,
  type FoundryRepairExpectation,
} from "./foundry-repair-preflight.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readTaskJson, relative as taskRelative } from "./foundry-task-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

type JsonRecord = Record<string, unknown>;

/** The task-store command this owner registers under; the facade owns invoking it. */
export const FOUNDRY_REPAIR_PREFLIGHT_COMMAND = "dataset-workflow-repair-preflight" as const;
export const FOUNDRY_REPAIR_REPORT_NAME = "foundry-repair-preflight.json";
export const FOUNDRY_REPAIR_JOB_SCHEMA = "tiangong-foundry.repair-preparation.v1";
const CLI_TIMEOUT_MS = 120_000;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

export interface FoundryRepairSelectionFacts {
  readonly kind: string;
  readonly contract: string;
  readonly before: string;
  readonly candidate: string;
}

export interface FoundryRepairPreparationRead {
  readonly entry: ArtifactEntry;
  readonly file: string;
  readonly value: JsonRecord;
}

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, code: string, label: string): JsonRecord {
  if (!isRecord(value)) fail(code, `${label} must be an object.`);
  return value;
}

function readRemoteChecks(file: string): unknown[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES)
      fail("repair_remote_invalid", "Remote checks must be a bounded regular file.");
    return fs
      .readFileSync(fd, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return fail("repair_remote_invalid", "Remote check records are missing or invalid.");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sameFact(left: unknown, right: unknown, code: string, label: string): boolean {
  const item = record(left, code, label);
  const other = record(right, code, label);
  if (
    typeof item.path !== "string" ||
    !Number.isSafeInteger(item.bytes) ||
    typeof item.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(item.sha256)
  )
    fail(code, `${label} is not an exact file fact.`);
  return item.path === other.path && item.bytes === other.bytes && item.sha256 === other.sha256;
}

/** The immutable repair selection of the current task job. */
export function foundryRepairSelection(
  context: FoundryRuntimeContext,
): FoundryRepairSelectionFacts {
  if (!context.taskRoot)
    fail("repair_task_required", "Repair preparation requires the current task.");
  const raw = readTaskJson(context, "foundry-job.json");
  if (
    raw.lane !== "existing-owner-draft-repair" ||
    raw.task_id !== context.taskId ||
    raw.workspace_id !== context.workspaceId ||
    raw.actor_id !== context.actorId
  )
    fail("repair_task_required", "Repair selection must belong to this registered task and actor.");
  const repair = raw.repair;
  if (!isRecord(repair))
    fail("repair_task_required", "Only an existing-owner-draft-repair task can be prepared.");
  for (const key of ["contract", "before", "candidate"] as const)
    if (typeof repair[key] !== "string" || !repair[key])
      fail("repair_task_required", "The repair selection is incomplete.");
  return Object.freeze({
    kind: String(repair.kind ?? ""),
    contract: repair.contract as string,
    before: repair.before as string,
    candidate: repair.candidate as string,
  });
}

interface RepairScopeSeed {
  readonly scope: FoundryRepairScope;
  readonly contractFile: string;
  readonly beforeFile: string;
  readonly candidateFile: string;
}

/**
 * Strictly offline re-check of one repair scope: the three selected inputs are re-read against the
 * captured task scope, then the scope rules are re-applied. No remote work happens here.
 */
function resolveRepairScope(context: FoundryRuntimeContext): RepairScopeSeed {
  const selection = foundryRepairSelection(context);
  const account = context.accountIntent;
  if (!account)
    fail("repair_account_required", "Repair preparation requires the owner account intent.");
  const contractFile = resolveFoundryInputPath(context, selection.contract);
  const beforeFile = resolveFoundryInputPath(context, selection.before);
  const candidateFile = resolveFoundryInputPath(context, selection.candidate);
  for (const file of [contractFile, beforeFile, candidateFile])
    readFoundryInput(context, file, MAX_REPORT_BYTES);
  const scope = readFoundryRepairScope({
    contractFile,
    beforeFile,
    candidateFile,
    datasetType: "process",
    targetUserId: account.userId,
    verifiedProjectRef: account.projectRef,
    stateCode: "0",
    relativePath: (file) => path.relative(context.workspaceRoot, file),
  });
  return { scope, contractFile, beforeFile, candidateFile };
}

function expectationOf(
  context: FoundryRuntimeContext,
  scope: FoundryRepairScope,
  contractFile: string,
): FoundryRepairExpectation {
  const raw = JSON.parse(fs.readFileSync(contractFile, "utf8")) as JsonRecord;
  const account = context.accountIntent!;
  return Object.freeze({
    dataset_type: "process",
    contract_sha256: scope.contract_sha256,
    execution_id: String(raw.execution_id ?? "").trim(),
    owner_user_id: account.userId,
    project_ref: account.projectRef,
    state_code: "0",
    actions: Object.freeze(
      scope.actions.map((action) => ({
        action_id: action.action_id,
        table: action.table,
        id: action.id,
        version: action.version,
        before_sha256: action.before_sha256,
        desired_sha256: action.desired_sha256,
      })),
    ),
  });
}

interface OwnerCliRun {
  readonly exit: number | null;
  readonly report: JsonRecord;
}

/**
 * The single trusted owner-CLI boundary: the qualified installed package, an isolated child
 * environment derived from the explicit account intent, a clean temporary working directory, no
 * shell and a bounded timeout. The ambient `TIANGONG_LCA_CLI_BIN` override is never consulted.
 */
function runOwnerCli(input: {
  context: FoundryRuntimeContext;
  qualified: QualifiedFoundryRuntime;
  authentication: FoundryAuthentication;
  temporary: string;
  argv: readonly string[];
}): OwnerCliRun {
  assertQualifiedFoundryRuntime(input.context, input.qualified);
  const cli = resolveInstalledTiangongLcaCliPackage();
  // Use the same allowlisted auth/state environment as the commit owner. An ephemeral HOME or
  // XDG_STATE_HOME would hide retained CLI attempts from the read-only preflight.
  const environment = createFoundryAuthenticationEnvironment(
    input.authentication,
    input.context.accountIntent?.sessionReference,
    process.env,
  );
  environment.TMPDIR = input.temporary;
  environment.TEMP = input.temporary;
  environment.TMP = input.temporary;
  const completed = childProcess.spawnSync(process.execPath, [cli.binPath, ...input.argv], {
    cwd: input.temporary,
    env: environment,
    shell: false,
    timeout: CLI_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: MAX_REPORT_BYTES,
  });
  delete environment.TIANGONG_LCA_ACCESS_TOKEN;
  assertQualifiedFoundryRuntime(input.context, input.qualified);
  if (completed.error || completed.signal || ![0, 1, 2].includes(completed.status ?? -1))
    fail(
      "repair_cli_unavailable",
      "The qualified owner CLI could not complete its read-only operation.",
    );
  const stdout = typeof completed.stdout === "string" ? completed.stdout.trim() : "";
  if (!stdout)
    fail("repair_cli_report_missing", "The owner CLI returned no machine-readable report.");
  let report: JsonRecord;
  try {
    report = JSON.parse(stdout) as JsonRecord;
  } catch {
    fail("repair_cli_report_invalid", "The owner CLI report is not one JSON object.");
  }
  const out = input.argv[input.argv.indexOf("--out-dir") + 1];
  if (!out || input.argv.indexOf("--out-dir") < 0)
    fail("repair_cli_report_invalid", "A repair read must bind its evidence output directory.");
  fs.writeFileSync(path.join(out, "owner-report.json"), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return { exit: completed.status, report };
}

/**
 * Read the already-registered preparation report for the current task scope. The report and every
 * CLI evidence file it references must exist in the same producer index with exact bytes and hash; a
 * report that names this scope but fails verification is rejected rather than ignored.
 */
export function readFoundryRepairPreparation(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
): FoundryRepairPreparationRead | null {
  const selection = foundryRepairSelection(context);
  const currentScope = resolveRepairScope(context);
  for (const file of [selection.contract, selection.before, selection.candidate])
    readFoundryInput(context, resolveFoundryInputPath(context, file), MAX_REPORT_BYTES);
  const selected = [selection.contract, selection.before, selection.candidate].map(
    (file) => captureFoundryInput(resolveFoundryInputPath(context, file)) as unknown as JsonRecord,
  );
  const candidates = entries
    .filter(
      (entry) =>
        entry.command === FOUNDRY_REPAIR_PREFLIGHT_COMMAND &&
        path.basename(entry.path) === FOUNDRY_REPAIR_REPORT_NAME,
    )
    .sort((left, right) => left.sequence - right.sequence)
    .reverse();
  for (const entry of candidates) {
    const artifact = readWorkflowArtifact(context, entry);
    const value = artifact.value as JsonRecord;
    if (value.schema !== FOUNDRY_REPAIR_PREPARATION_SCHEMA)
      fail("repair_report_invalid", "An indexed repair preparation report has an unknown schema.");
    const inputs = record(value.inputs, "repair_report_invalid", "Report inputs");
    if (
      !sameFact(inputs.contract, selected[0], "repair_report_invalid", "Report contract") ||
      !sameFact(inputs.before, selected[1], "repair_report_invalid", "Report before rows") ||
      !sameFact(inputs.candidate, selected[2], "repair_report_invalid", "Report candidate rows")
    )
      fail(
        "repair_report_invalid",
        "Indexed repair evidence differs from the immutable task scope.",
      );
    if (
      !["prepared", "no_change_verified", "blocked"].includes(String(value.status)) ||
      value.remote_writes !== 0 ||
      value.publication_ready !== false ||
      !Array.isArray(value.blockers) ||
      (value.status === "blocked" ? value.blockers.length === 0 : value.blockers.length !== 0)
    )
      fail(
        "repair_report_invalid",
        "Repair evidence carries inconsistent readiness or effect claims.",
      );
    if (
      sha256Json(value.scope) !== sha256Json(currentScope.scope) ||
      sha256Json(value.account) !==
        sha256Json({
          project_ref: context.accountIntent!.projectRef,
          user_id: context.accountIntent!.userId,
          state_code: "0",
          account_mode: context.accountIntent!.accountMode ?? "ordinary",
        })
    )
      fail(
        "repair_report_invalid",
        "Repair evidence must bind the current exact scope and account.",
      );
    const evidence = record(value.evidence, "repair_report_invalid", "Report evidence");
    if (!Array.isArray(evidence.files) || (value.status !== "blocked" && !evidence.files.length))
      fail(
        "repair_report_invalid",
        "A repair preparation report must bind its CLI evidence files.",
      );
    const verified = new Map<string, ArtifactEntry>();
    for (const item of evidence.files) {
      const bound = record(item, "repair_report_invalid", "Evidence file");
      const match = entries.find(
        (candidate) =>
          candidate.path === bound.path &&
          candidate.operation_id === entry.operation_id &&
          candidate.command === FOUNDRY_REPAIR_PREFLIGHT_COMMAND &&
          candidate.receipt.path === entry.receipt.path &&
          candidate.receipt.sha256 === entry.receipt.sha256 &&
          candidate.bytes === bound.bytes &&
          candidate.sha256 === bound.sha256,
      );
      if (!match)
        fail(
          "repair_report_invalid",
          "Every CLI evidence file must be registered by the same producer with exact bytes and hash.",
        );
      const observed = captureFoundryInput(resolveFoundryOutput(context, match.path));
      if (observed.bytes !== match.bytes || observed.sha256 !== match.sha256)
        fail("repair_report_invalid", "Registered CLI evidence bytes changed.");
      if (typeof bound.role !== "string" || verified.has(bound.role))
        fail("repair_report_invalid", "CLI evidence roles must be explicit and unique.");
      verified.set(bound.role, match);
    }
    const ownerReport = (role: string, input: string) => {
      const file = verified.get(`${role}:out/owner-report.json`);
      if (!file) fail("repair_report_invalid", "Repair evidence is missing an owner report.");
      const report = readWorkflowArtifact(context, file).value;
      if (report.input_path !== input)
        fail("repair_report_invalid", "An owner report names another input selection.");
      return report;
    };
    const expected = expectationOf(context, currentScope.scope, currentScope.contractFile);
    const verifyRoots = (role: "before" | "candidate") => {
      const report = ownerReport(
        `verify-remote-${role}`,
        role === "before" ? currentScope.beforeFile : currentScope.candidateFile,
      );
      const checks = verified.get(`verify-remote-${role}:out/outputs/remote-verification.jsonl`);
      if (!checks)
        fail("repair_report_invalid", "Repair evidence is missing its root check records.");
      assertFoundryRepairRootProof(
        report,
        readRemoteChecks(resolveFoundryOutput(context, checks.path)),
        expected,
        role,
      );
    };
    if (value.status === "prepared") {
      if (currentScope.scope.status !== "dispatchable")
        fail("repair_report_invalid", "A no-op is not a write preparation.");
      parseFoundryRepairDryRunReport(ownerReport("dry-run", currentScope.candidateFile), expected);
      verifyRoots("before");
    } else if (value.status === "no_change_verified") {
      if (
        currentScope.scope.status !== "satisfied" ||
        currentScope.scope.actions.some((action) => action.before_sha256 !== action.desired_sha256)
      )
        fail(
          "repair_report_invalid",
          "No-change completion requires identical complete before and desired content.",
        );
      parseFoundryRepairValidateReport(
        ownerReport("validate", currentScope.candidateFile),
        expected,
      );
      verifyRoots("before");
      verifyRoots("candidate");
    }
    return Object.freeze({ entry, file: artifact.file, value });
  }
  return null;
}

/**
 * Prepare one repair through the qualified owner CLI and register the result as trusted producer
 * evidence. Remote reads run outside the task metadata lock; registration happens inside the store's
 * operation (which re-verifies inputs and producers), and a repeated preparation returns the
 * already-registered report without issuing another remote call.
 */
export async function prepareFoundryRepair(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  _entries: readonly ArtifactEntry[],
  authentication: FoundryAuthentication,
): Promise<JsonRecord> {
  const currentEntries = await withFoundryTaskMetadata(context, (_, index) => [...index], {
    verifyCommands: [FOUNDRY_REPAIR_PREFLIGHT_COMMAND],
  });
  const existing = readFoundryRepairPreparation(context, currentEntries);
  if (existing && existing.value.status !== "blocked") return existing.value;
  assertQualifiedFoundryRuntime(context, qualified);
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  const { scope, contractFile, beforeFile, candidateFile } = resolveRepairScope(context);
  const expectation = expectationOf(context, scope, contractFile);
  const temporary = createWorkflowDirectory(context, "tmp/repair-");
  const blockers: Array<{ code: string; message: string }> = [];
  const evidenceDetails: JsonRecord[] = [];
  const stagedTrees: Array<{ name: string; directory: string }> = [];
  let status: "prepared" | "no_change_verified" | "blocked" = "blocked";
  try {
    // The remote phase runs outside the task metadata lock; the pre-check re-verifies the selected
    // inputs and the producers of any earlier repair preflight before the owner CLI is invoked.
    await withFoundryTaskMetadata(context, () => undefined, {
      verifyCommands: [FOUNDRY_REPAIR_PREFLIGHT_COMMAND],
    });
    try {
      if (scope.status === "dispatchable") {
        const outDir = path.join(temporary, "dry-run", "out");
        fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
        stagedTrees.push({ name: "dry-run", directory: path.join(temporary, "dry-run") });
        const run = runOwnerCli({
          context,
          qualified,
          authentication,
          temporary,
          argv: [
            "dataset",
            "save-draft",
            "--type",
            "process",
            "--input",
            candidateFile,
            "--out-dir",
            outDir,
            "--execution-contract",
            contractFile,
            "--dry-run",
            "--json",
          ],
        });
        const dryRun = parseFoundryRepairDryRunReport(run.report, expectation);
        if (run.exit !== 0)
          fail("repair_cli_failed", "Prepared CLI rows require a successful preflight exit.");
        evidenceDetails.push({
          role: "dry_run",
          exit: run.exit,
          report: JSON.parse(JSON.stringify(dryRun)) as JsonRecord,
        });
        const verifyDir = path.join(temporary, "verify-remote-before", "out");
        fs.mkdirSync(verifyDir, { recursive: true, mode: 0o700 });
        stagedTrees.push({
          name: "verify-remote-before",
          directory: path.join(temporary, "verify-remote-before"),
        });
        const verified = runOwnerCli({
          context,
          qualified,
          authentication,
          temporary,
          argv: [
            "dataset",
            "verify-remote",
            "--input",
            beforeFile,
            "--out-dir",
            verifyDir,
            "--root-policy",
            "existing",
            "--compare-root-payload",
            "--target-user-id",
            expectation.owner_user_id,
            "--state-code",
            "0",
            "--json",
          ],
        });
        const referenceProof = parseFoundryRepairRemoteReport(verified.report, expectation);
        assertFoundryRepairRootProof(
          verified.report,
          readRemoteChecks(path.join(verifyDir, "outputs", "remote-verification.jsonl")),
          expectation,
          "before",
        );
        if (verified.exit !== 0)
          fail("repair_cli_failed", "Existing reference closure requires a successful owner read.");
        evidenceDetails.push({
          role: "reference_verification",
          exit: verified.exit,
          counts: { ...referenceProof },
        });
        status = "prepared";
      } else {
        // No-change scope: the CLI metadata dry run legitimately rejects a candidate that changes
        // nothing, so the no-op proof is a local three-layer validation plus a fresh exact remote
        // readback of the stored before and candidate content. Only a fully passed readback may set
        // the status, and the result is never publication ready.
        const validateDir = path.join(temporary, "validate", "out");
        fs.mkdirSync(validateDir, { recursive: true, mode: 0o700 });
        stagedTrees.push({ name: "validate", directory: path.join(temporary, "validate") });
        const validationRun = runOwnerCli({
          context,
          qualified,
          authentication,
          temporary,
          argv: [
            "dataset",
            "validate",
            "--type",
            "process",
            "--input",
            candidateFile,
            "--out-dir",
            validateDir,
            "--json",
          ],
        });
        const validated = parseFoundryRepairValidateReport(validationRun.report, expectation);
        // CLI validation uses exit 1 for the retained unknown-annual evidence gap; the parser
        // separately requires schema/content/multilingual success. Exit 2 is not validation proof.
        if (validationRun.exit !== 0 && validationRun.exit !== 1)
          fail(
            "repair_cli_failed",
            "No-change validation requires a completed owner validation run.",
          );
        evidenceDetails.push({
          role: "validate",
          exit: validationRun.exit,
          report: JSON.parse(JSON.stringify(validated)) as JsonRecord,
        });
        const remote: JsonRecord[] = [];
        for (const [role, file] of [
          ["before", beforeFile],
          ["candidate", candidateFile],
        ] as const) {
          const remoteDir = path.join(temporary, `verify-remote-${role}`, "out");
          fs.mkdirSync(remoteDir, { recursive: true, mode: 0o700 });
          stagedTrees.push({
            name: `verify-remote-${role}`,
            directory: path.join(temporary, `verify-remote-${role}`),
          });
          const remoteRun = runOwnerCli({
            context,
            qualified,
            authentication,
            temporary,
            argv: [
              "dataset",
              "verify-remote",
              "--input",
              file,
              "--out-dir",
              remoteDir,
              "--root-policy",
              "existing",
              "--compare-root-payload",
              "--target-user-id",
              context.accountIntent!.userId,
              "--state-code",
              "0",
              "--json",
            ],
          });
          const counts = parseFoundryRepairRemoteReport(remoteRun.report, expectation);
          assertFoundryRepairRootProof(
            remoteRun.report,
            readRemoteChecks(path.join(remoteDir, "outputs", "remote-verification.jsonl")),
            expectation,
            role,
          );
          if (remoteRun.exit !== 0)
            fail(
              "repair_cli_failed",
              "Exact remote verification requires a successful owner exit.",
            );
          remote.push({ role, exit: remoteRun.exit, counts: { ...counts } });
        }
        evidenceDetails.push({ role: "remote_readback", proofs: remote });
        status = "no_change_verified";
      }
    } catch (error) {
      if (!(error instanceof FoundryContextError)) throw error;
      blockers.push({ code: error.code, message: error.message });
      status = "blocked";
      evidenceDetails.push({ role: "blocked", code: error.code });
    }
    return await runFoundryTaskOperation(
      context,
      {
        command: FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
        options: {
          task: context.taskId,
          scope: scope.contract_sha256,
          status,
          nonce: randomUUID(),
        },
        validateCurrent: () => {
          for (const file of [contractFile, beforeFile, candidateFile])
            readFoundryInput(context, file, MAX_REPORT_BYTES);
          resolveRepairScope(context);
        },
      },
      (operation) => {
        const stage = createWorkflowStageDirectory(context, operation, "repair");
        const files: JsonRecord[] = [];
        for (const tree of stagedTrees) {
          const visit = (directory: string): void => {
            for (const name of fs.readdirSync(directory).sort()) {
              const absolute = path.join(directory, name);
              const stat = fs.lstatSync(absolute);
              if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
                fail(
                  "repair_output_invalid",
                  "Repair evidence must remain regular files and directories.",
                );
              if (stat.isDirectory()) {
                visit(absolute);
                continue;
              }
              const file = path.relative(tree.directory, absolute);
              const relative = path.join("cli", tree.name, file);
              operation.writeText(path.join(stage, relative), fs.readFileSync(absolute));
              files.push({
                role: `${tree.name}:${file.split(path.sep).join("/")}`,
                path: taskRelative(context, path.join(stage, relative)),
                bytes: fs.statSync(path.join(stage, relative)).size,
                sha256: captureFoundryInput(path.join(stage, relative)).sha256,
              });
            }
          };
          visit(tree.directory);
        }
        const report: JsonRecord = {
          schema: FOUNDRY_REPAIR_PREPARATION_SCHEMA,
          status,
          scope: {
            kind: scope.kind,
            status: scope.status,
            contract_sha256: scope.contract_sha256,
            rows_sha256: scope.rows_sha256,
            changed_paths: [...scope.changed_paths],
            actions: scope.actions.map((action) => ({ ...action })),
          },
          contract: {
            role: "execution_contract",
            ...(captureFoundryInput(contractFile) as unknown as JsonRecord),
            canonical_sha256: scope.contract_sha256,
            execution_id: expectation.execution_id,
            operation: "save_draft",
          },
          inputs: {
            contract: captureFoundryInput(contractFile) as unknown as JsonRecord,
            before: captureFoundryInput(beforeFile) as unknown as JsonRecord,
            candidate: captureFoundryInput(candidateFile) as unknown as JsonRecord,
          },
          account: {
            project_ref: context.accountIntent!.projectRef,
            user_id: context.accountIntent!.userId,
            state_code: "0",
            account_mode: context.accountIntent!.accountMode ?? "ordinary",
          },
          runtime: {
            cli_source: "installed_package",
            qualification_sha256: identity.runtimeQualificationSha256,
            authentication_mode: identity.mode,
          },
          evidence: { files, detail: evidenceDetails },
          remote_writes: 0,
          publication_ready: false,
          blockers,
        };
        operation.writeJson(path.join(stage, FOUNDRY_REPAIR_REPORT_NAME), report);
        return report;
      },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
