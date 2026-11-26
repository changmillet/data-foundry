import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createFoundryAuthenticationEnvironment,
  type FoundryAuthentication,
} from "./foundry-authentication-environment.ts";
import { prepareEdgeProcessRepair } from "./foundry-edge-repair-preparation.ts";
import { verifyFoundryRepairCensus } from "./foundry-repair-census.ts";
import {
  FOUNDRY_REPAIR_PREPARATION_SCHEMA,
  parseFoundryRepairDryRunReport,
  parseFoundryRepairValidateReport,
} from "./foundry-repair-preflight.ts";
import { proveFoundryRepairRemoteIntegrity } from "./foundry-repair-reference-binding.ts";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { verifyFoundryRuntimeIdentity } from "./foundry-runtime-identity.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import {
  applyScientificRepairProposals,
  runScientificRepairDiagnostic,
} from "./foundry-scientific-repair.ts";
import { relative as taskRelative } from "./foundry-task-io.ts";
import { runFoundryTaskOperation, withFoundryTaskMetadata } from "./foundry-task-store.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { createWorkflowDirectory, createWorkflowStageDirectory } from "./foundry-workflow-io.ts";
import {
  FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
  FOUNDRY_REPAIR_REPORT_NAME,
  MAX_REPAIR_REPORT_BYTES,
  failRepair,
  inputFactRecord,
  readFoundryRepairPreparation,
  readRepairRemoteChecks,
  repairExpectationOf,
  resolveRepairScope,
  type RepairJsonRecord,
} from "./foundry-workflow-repair-preparation-read.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";

export {
  FOUNDRY_REPAIR_JOB_SCHEMA,
  FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
  FOUNDRY_REPAIR_REPORT_NAME,
  foundryRepairSelection,
  readFoundryRepairPreparation,
  type FoundryRepairPreparationRead,
  type FoundryRepairSelectionFacts,
} from "./foundry-workflow-repair-preparation-read.ts";

type JsonRecord = RepairJsonRecord;
const CLI_TIMEOUT_MS = 120_000;

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
    maxBuffer: MAX_REPAIR_REPORT_BYTES,
  });
  delete environment.TIANGONG_LCA_ACCESS_TOKEN;
  assertQualifiedFoundryRuntime(input.context, input.qualified);
  if (completed.error || completed.signal || ![0, 1, 2].includes(completed.status ?? -1))
    failRepair(
      "repair_cli_unavailable",
      "The qualified owner CLI could not complete its read-only operation.",
    );
  const stdout = typeof completed.stdout === "string" ? completed.stdout.trim() : "";
  if (!stdout)
    failRepair("repair_cli_report_missing", "The owner CLI returned no machine-readable report.");
  let report: JsonRecord;
  try {
    report = JSON.parse(stdout) as JsonRecord;
  } catch {
    failRepair("repair_cli_report_invalid", "The owner CLI report is not one JSON object.");
  }
  const selectedInput = input.argv[input.argv.indexOf("--input") + 1];
  if (
    input.argv.indexOf("--input") < 0 ||
    typeof report.input_path !== "string" ||
    path.resolve(report.input_path) !== path.resolve(selectedInput)
  )
    failRepair(
      "repair_cli_report_invalid",
      "Repair owner report must name the exact selected input.",
    );
  const out = input.argv[input.argv.indexOf("--out-dir") + 1];
  if (!out || input.argv.indexOf("--out-dir") < 0)
    failRepair(
      "repair_cli_report_invalid",
      "A repair read must bind its evidence output directory.",
    );
  fs.writeFileSync(path.join(out, "owner-report.json"), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return { exit: completed.status, report };
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
  const expectation = repairExpectationOf(context, scope, contractFile);
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
      if (scope.scientific) {
        if (qualified.cli.expectation.package_version !== "0.4.0")
          failRepair(
            "repair_scientific_runtime_unsupported",
            "Scientific repair requires the qualified typed Process runtime.",
          );
        const directory = path.join(temporary, "science");
        fs.mkdirSync(directory, { mode: 0o700 });
        stagedTrees.push({ name: "science", directory });
        const workerInput = JSON.parse(
          readFoundryInput(
            context,
            scope.scientific.worker_input.path,
            MAX_REPAIR_REPORT_BYTES,
          ).toString("utf8"),
        );
        const census = await verifyFoundryRepairCensus(
          context,
          qualified,
          authentication,
          workerInput,
          path.join(directory, "census"),
        );
        const diagnostic = runScientificRepairDiagnostic(scope.scientific, directory);
        applyScientificRepairProposals(
          context,
          qualified,
          temporary,
          scope.scientific,
          beforeFile,
          candidateFile,
          path.join(directory, "patch"),
        );
        evidenceDetails.push({
          role: "scientific_preflight",
          census: census.proof,
          diagnostic_sha256: scope.scientific.worker_report.sha256,
          affected_processes: diagnostic.affected_processes,
        });
      }
      if (qualified.cli.expectation.package_version === "0.4.0") {
        const root = path.join(temporary, "edge-repair");
        fs.mkdirSync(root, { mode: 0o700 });
        stagedTrees.push({ name: "edge-repair", directory: root });
        const report = await prepareEdgeProcessRepair(
          context,
          qualified,
          authentication,
          expectation,
          {
            before: beforeFile,
            candidate: candidateFile,
            temporary,
            directory: path.join(root, "out"),
            scientific: scope.scientific,
          },
        );
        evidenceDetails.push({ role: "edge_preflight", report });
        status = scope.status === "dispatchable" ? "prepared" : "no_change_verified";
      } else if (scope.status === "dispatchable") {
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
          failRepair("repair_cli_failed", "Prepared CLI rows require a successful preflight exit.");
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
        const referenceProof = proveFoundryRepairRemoteIntegrity({
          report: verified.report,
          checks: readRepairRemoteChecks(
            path.join(verifyDir, "outputs", "remote-verification.jsonl"),
          ),
          expectation,
          beforeRows: readRows(beforeFile, (file) =>
            readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES).toString("utf8"),
          ),
          candidateRows: readRows(candidateFile, (file) =>
            readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES).toString("utf8"),
          ),
          content: "before",
        });
        if (verified.exit !== (referenceProof.retained_references ? 1 : 0))
          failRepair(
            "repair_cli_failed",
            "Existing reference closure requires a successful owner read.",
          );
        evidenceDetails.push({
          role: "reference_verification",
          exit: verified.exit,
          counts: { ...referenceProof.counts },
          retained_references: referenceProof.retained_references,
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
          failRepair(
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
          const integrity = proveFoundryRepairRemoteIntegrity({
            report: remoteRun.report,
            checks: readRepairRemoteChecks(
              path.join(remoteDir, "outputs", "remote-verification.jsonl"),
            ),
            expectation,
            beforeRows: readRows(beforeFile, (file) =>
              readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES).toString("utf8"),
            ),
            candidateRows: readRows(candidateFile, (file) =>
              readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES).toString("utf8"),
            ),
            content: role,
          });
          if (remoteRun.exit !== (integrity.retained_references ? 1 : 0))
            failRepair(
              "repair_cli_failed",
              "Exact remote verification requires a successful owner exit.",
            );
          remote.push({
            role,
            exit: remoteRun.exit,
            counts: { ...integrity.counts },
            retained_references: integrity.retained_references,
          });
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
            readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES);
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
                failRepair(
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
            ...(scope.scientific ? { scientific: scope.scientific } : {}),
          },
          contract: {
            role: "execution_contract",
            ...inputFactRecord(captureFoundryInput(contractFile)),
            canonical_sha256: scope.contract_sha256,
            execution_id: expectation.execution_id,
            operation: "save_draft",
          },
          inputs: {
            contract: inputFactRecord(captureFoundryInput(contractFile)),
            before: inputFactRecord(captureFoundryInput(beforeFile)),
            candidate: inputFactRecord(captureFoundryInput(candidateFile)),
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

/** Fresh observation belongs before the first consumed attempt. Recovery keeps the original write. */
export async function verifyScientificRepairBeforeDispatch(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  requestSha256: string,
): Promise<void> {
  const { scope } = resolveRepairScope(context);
  if (!scope.scientific) return;
  const evidence = scope.scientific;
  const temporary = createWorkflowDirectory(context, "tmp/scientific-repair-precommit-");
  try {
    const input = JSON.parse(
      readFoundryInput(context, evidence.worker_input.path, MAX_REPAIR_REPORT_BYTES).toString(
        "utf8",
      ),
    );
    const census = await verifyFoundryRepairCensus(
      context,
      qualified,
      authentication,
      input,
      path.join(temporary, "census"),
    );
    await runFoundryTaskOperation(
      context,
      {
        command: FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
        options: {
          task: context.taskId,
          stage: "scientific_precommit",
          request_sha256: requestSha256,
          nonce: randomUUID(),
        },
        validateCurrent: () => {
          resolveRepairScope(context);
        },
      },
      (operation) => {
        const stage = createWorkflowStageDirectory(context, operation, "scientific-precommit");
        for (const file of census.files) {
          const relative = path.relative(temporary, file);
          if (relative.startsWith("..") || path.isAbsolute(relative))
            failRepair(
              "repair_census_unproven",
              "Scientific precommit evidence must remain inside its producer directory.",
            );
          operation.writeText(path.join(stage, relative), fs.readFileSync(file));
        }
        const report = {
          schema: "tiangong-foundry.scientific-repair-precommit.v1",
          request_sha256: requestSha256,
          worker_input: evidence.worker_input,
          observed_census: census.proof,
          remote_writes: 0,
        };
        operation.writeJson(path.join(stage, "scientific-precommit.json"), report);
        return report;
      },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Observe the written overlay and all peers again. This cannot close the interval between reads. */
export async function verifyScientificRepairAfterReadback(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  directory: string,
): Promise<JsonRecord | null> {
  const { scope } = resolveRepairScope(context);
  if (!scope.scientific) return null;
  const input = JSON.parse(
    readFoundryInput(context, scope.scientific.worker_input.path, MAX_REPAIR_REPORT_BYTES).toString(
      "utf8",
    ),
  );
  const census = await verifyFoundryRepairCensus(
    context,
    qualified,
    authentication,
    input,
    directory,
    "after",
  );
  return {
    original_worker_input: scope.scientific.worker_input,
    observed_census: census.proof,
    concurrent_interval_atomicity: "unproven",
    publication_ready: false,
  };
}
