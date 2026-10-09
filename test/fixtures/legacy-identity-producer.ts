import fs from "node:fs";
import path from "node:path";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
type FoundryRuntimeSelection = Parameters<typeof qualifyFoundryRuntime>[1];
import {
  readVerifiedTaskSnapshot,
  runFoundryTaskOperation,
} from "../../scripts/lib/foundry-task-store.ts";
import { currentWorkflowState, workflowObject } from "../../scripts/lib/foundry-workflow-state.ts";
import { createFoundryIdentityOwners } from "../../scripts/lib/foundry-identity-owners.ts";
import { verifyFoundryRuntimeIdentity } from "../../scripts/lib/foundry-runtime-identity.ts";
import { createFoundryAuthenticationEnvironment } from "../../scripts/lib/foundry-authentication-environment.ts";
import { registerWorkflowStageFiles } from "../../scripts/lib/foundry-workflow-io.ts";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";

/** Synthetic old producer: publish the original exit-1 rejection once, before any native registration.
 * This fixture never rewrites a registered attempt, receipt, ledger or report. */
export async function publishLegacyIdentityFailure(input: {
  workspace: string;
  root: string;
  taskId: string;
  actorId: string;
  seed: string;
  runtimeSelection: FoundryRuntimeSelection;
  account: { project_ref: string; user_id: string };
  unprovenArgv?: boolean;
  incompleteAttempt?:
    "empty-results" | "missing-results" | "missing-decision" | "misleading-failure";
  retainedNodeFailure?: "node" | "node-missing";
  retainAuthReceipt?: boolean;
}) {
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: input.workspace,
    cacheBase: path.join(input.root, "cache"),
    taskId: input.taskId,
    actorId: input.actorId,
    inputs: [captureFoundryInput(input.seed)],
    accountIntent: { projectRef: input.account.project_ref, userId: input.account.user_id },
  };
  const base = createFoundryRuntimeContext(options);
  const snapshot = readVerifiedTaskSnapshot(base);
  const context = createFoundryRuntimeContext({
    ...options,
    inputs: [
      ...snapshot.task.sources,
      ...snapshot.index.map((entry) =>
        captureFoundryInput(path.resolve(base.taskRoot!, entry.path)),
      ),
    ],
  });
  const qualified = qualifyFoundryRuntime(context, input.runtimeSelection);
  const state = currentWorkflowState(context, snapshot.index);
  const rows = state.rows!;
  const identity = verifyFoundryRuntimeIdentity(context, { mode: "oauth" }, process.env, qualified);
  const environment = createFoundryAuthenticationEnvironment(
    { mode: "oauth" },
    context.accountIntent!.sessionReference,
    process.env,
  );
  environment.FOUNDRY_VERIFIED_PROJECT_REF = context.accountIntent!.projectRef;
  environment.FOUNDRY_VERIFIED_USER_ID = context.accountIntent!.userId;
  const output = path.join(context.taskRoot!, "outputs", "identity", "legacy-producer");
  fs.mkdirSync(output, { recursive: true });
  const temporary = path.join(input.root, "legacy-auth");
  fs.mkdirSync(temporary);
  const authFile = input.retainAuthReceipt
    ? path.join(output, "original-auth-receipt.json")
    : path.join(temporary, "receipt.json");
  fs.writeFileSync(authFile, JSON.stringify(identity.receipt));
  const sets: Record<string, unknown>[] = [];
  try {
    for (const set of rows.value.sets) {
      if (set.type !== "flow" && set.type !== "process") continue;
      const outDir = path.join(output, set.type);
      fs.mkdirSync(outDir, { recursive: true });
      const owner = createFoundryIdentityOwners(context, qualified, set.type, {
        environment,
        cwd: temporary,
      });
      const sourceIndex = path.join(outDir, "source-context.jsonl");
      fs.writeFileSync(
        sourceIndex,
        readRows(set.file)
          .map((row) => {
            const selected = datasetIdentity(row, 0, set.type);
            return JSON.stringify({
              dataset_type: set.type,
              dataset_id: selected.id,
              dataset_version: selected.version,
              source_file: set.file,
            });
          })
          .join("\n") + "\n",
      );
      const prepared = workflowObject(
        owner.invoke(() =>
          owner.preflight.runDatasetIdentityPreflightRequestsBuild({
            type: set.type,
            rowsFile: set.file,
            sourceIndex,
            outDir,
          }),
        ),
      );
      const index = path.resolve(
        context.assetRoot,
        String(workflowObject(prepared.files).identity_preflight_requests),
      );
      owner.invoke(() =>
        owner.preflight.runDatasetIdentityPreflightQueryAudit({
          index,
          outDir: path.join(outDir, "query-audit"),
        }),
      );
      const run = workflowObject(
        owner.invoke(() =>
          owner.preflight.runDatasetIdentityPreflightRun({
            index,
            outDir: path.join(outDir, "run"),
            authReceipt: authFile,
            expectedProjectRef: context.accountIntent!.projectRef,
            expectedUserId: context.accountIntent!.userId,
            maxAttempts: 1,
            timeoutMs: 60_000,
          }),
        ),
      );
      const results: Record<string, unknown>[] = (run.results as Record<string, unknown>[]).map(
        (row) => ({
          ...row,
          status: "failed",
          failure_code: "identity_preflight_cli_exit_nonzero",
        }),
      );
      if (input.unprovenArgv)
        for (const row of results)
          row.cli_args = [...(row.cli_args as string[]), "--unexpected-original-argv"];
      if (input.incompleteAttempt === "missing-decision")
        for (const row of results) delete row.decision;
      if (input.incompleteAttempt === "misleading-failure")
        for (const row of results) {
          row.report_status = "failed";
          row.decision = null;
        }
      if (input.retainedNodeFailure) {
        const nodeFile = path.join(fs.realpathSync(input.root), "retained-original-node");
        if (input.retainedNodeFailure === "node")
          fs.writeFileSync(nodeFile, "controlled changed original executable\n");
        workflowObject(workflowObject(run.runtime_options).cli).executable = nodeFile;
        for (const row of results) row.executable = nodeFile;
      }
      // Retain request, actual CLI stdout/disk, argv and auth facts; model only the old transport classification.
      run.status = "failed";
      run.results = results;
      if (input.incompleteAttempt === "empty-results") run.results = [];
      if (input.incompleteAttempt === "missing-results") delete run.results;
      const files = workflowObject(run.files);
      fs.writeFileSync(
        path.resolve(context.assetRoot, String(files.results)),
        results.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
      fs.writeFileSync(
        path.resolve(context.assetRoot, String(files.report)),
        JSON.stringify(run) + "\n",
      );
      for (const row of results)
        fs.rmSync(path.resolve(context.assetRoot, String(row.execution_manifest_file)), {
          force: true,
        });
      sets.push({ type: set.type, rows: set.file, index, status: "failed", report: files.report });
    }
    await runFoundryTaskOperation(
      context,
      { command: "dataset-workflow-identity", options: { fixture_producer: "legacy-exit-1" } },
      (operation) => {
        registerWorkflowStageFiles(context, operation, output);
        const report = {
          schema: "tiangong-foundry.identity-stage.v1",
          status: "blocked",
          rows_report: rows.file,
          account: {
            project_ref: context.accountIntent!.projectRef,
            user_id: context.accountIntent!.userId,
          },
          checked_at_utc: new Date().toISOString(),
          index: sets[0].index,
          sets,
          blockers: [{ code: "identity_preflight_failed" }],
        };
        operation.writeJson(path.join(output, "foundry-identity.json"), report);
        return report;
      },
    );
    return { context, snapshot: readVerifiedTaskSnapshot(context) };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
