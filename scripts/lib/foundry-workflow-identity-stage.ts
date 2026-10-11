import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withBatchRunLock } from "@tiangong-lca/cli/batch";
import { assertCliRuntimeMatches } from "@tiangong-lca/cli/runtime";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  assertVerifiedFoundryIdentity,
  verifyFoundryRuntimeIdentity,
  type FoundryAuthentication,
  type VerifiedFoundryIdentity,
} from "./foundry-runtime-identity.ts";
import { createFoundryAuthenticationEnvironment } from "./foundry-authentication-environment.ts";
import { createFoundryIdentityOwners } from "./foundry-identity-owners.ts";
import { inspectOwnerExecutions } from "./foundry-owner-execution-store.ts";
import {
  currentFoundryInteractionState,
  currentFoundryQuestions,
  currentFoundryInvestigations,
} from "./foundry-interaction-input.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import {
  assertSelectedFoundryIdentityStageInput,
  type FoundryIdentityStageTarget,
  type SelectedFoundryIdentityStageInput,
} from "./foundry-identity-stage-input.ts";
import { runFoundryTaskOperation, withFoundryTaskMetadata } from "./foundry-task-store.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { createFileArtifactFact, createFoundryCommandSpec } from "./foundry-command-spec.ts";
import {
  createIdentityPreflightBinding,
  parseFreshIntentBoundAuthReceipt,
  sha256Json,
  sha256Text,
  stableJson,
  validateBoundExecutionManifest,
  validateIdentityPreflightExecution,
} from "./identity-preflight-proof.ts";
import type { ArtifactEntry, JsonRecord } from "./foundry-task-types.ts";

type PreparedTarget = FoundryIdentityStageTarget & {
  readonly source_file: string;
  readonly owner_source_file: string;
  readonly index: string;
  readonly row: JsonRecord;
};
const prepareCommand = "dataset-workflow-identity-stage-prepare";
const dispatchCommand = "dataset-workflow-identity-stage-dispatch";
const sensitiveCommands = new Set([
  "dataset-workflow-finalize",
  "dataset-workflow-authorization",
  "dataset-workflow-native-contract",
  "dataset-workflow-execution-prepare",
  "dataset-workflow-execution-result",
  "dataset-workflow-execution-consume",
  "dataset-workflow-execution-observation",
]);
function reject(reason: string): never {
  throw new FoundryContextError(
    "identity_stage_input_invalid",
    `Explicit read-only identity stage cannot be admitted (${reason}).`,
  );
}
function key(target: FoundryIdentityStageTarget): string {
  return JSON.stringify([target.dataset_type, target.dataset_id, target.dataset_version]);
}
function readJson(file: string): JsonRecord {
  const fact = captureFoundryInput(file);
  return workflowObject(JSON.parse(readSelectedSemanticBytes(fact).toString("utf8")));
}
function jsonLines(file: string): JsonRecord[] {
  const text = readSelectedSemanticBytes(captureFoundryInput(file)).toString("utf8");
  if (text && !text.endsWith("\n")) reject("incomplete-index");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => workflowObject(JSON.parse(line)));
}
function selectedBytes(selected: SelectedFoundryIdentityStageInput): Buffer {
  const content = readSelectedSemanticBytes(selected.descriptor);
  if (stableJson(JSON.parse(content.toString("utf8"))) !== stableJson(selected.value))
    reject("descriptor-binding");
  return content;
}
function assertNativeUnprepared(context: FoundryRuntimeContext, entries: readonly ArtifactEntry[]) {
  // The existing native owner validates all consumed, legacy and UNKNOWN attempt state first.
  const execution = inspectOwnerExecutions(context, entries);
  if (
    execution.requests.length ||
    execution.consumed.size ||
    execution.pending.length ||
    entries.some((entry) => sensitiveCommands.has(entry.command)) ||
    fs.existsSync(resolveFoundryOutput(context, "authorization.json"))
  )
    reject("native-owner-history-requires-original-recovery");
}

/** An explicit new read-only execution. Its local transactions only prepare or capture evidence. */
export async function runExplicitFoundryIdentityStage(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  selected: SelectedFoundryIdentityStageInput,
  authentication: FoundryAuthentication = { mode: "oauth" },
  options: { readonly signal?: AbortSignal } = {},
): Promise<JsonRecord> {
  options.signal?.throwIfAborted();
  assertQualifiedFoundryRuntime(context, qualified);
  assertSelectedFoundryIdentityStageInput(context, selected);
  selectedBytes(selected);
  const intent = selected.value;
  if (
    intent.task_id !== context.taskId ||
    intent.actor_id !== context.actorId ||
    !context.accountIntent
  )
    reject("task-actor-account");
  // Same lock names and sorted order as native dispatch and runtime adoption.
  const scopes = [
    ...new Set([
      ...["flow", "process"].map((type) => sha256Json({ task: context.taskId, type })),
      sha256Json({ task: context.taskId, type: "explicit-identity-stage" }),
    ]),
  ].sort();
  const locked = (at: number): Promise<JsonRecord> =>
    at === scopes.length
      ? runLocked(context, qualified, entries, selected, authentication, options.signal)
      : withBatchRunLock(
          {
            runPath: resolveFoundryOutput(
              context,
              `owner-locks/${context.taskId}-${scopes[at]}.json`,
              "state",
            ),
            identity: { task: context.taskId, scope: scopes[at] },
            reason: "Foundry explicit read-only identity stage",
          },
          () => locked(at + 1),
        );
  return locked(0);
}

async function runLocked(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  prefix: readonly ArtifactEntry[],
  selected: SelectedFoundryIdentityStageInput,
  authentication: FoundryAuthentication,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  const intent = selected.value;
  const intentSha256 = sha256Json(intent);
  const stageId = sha256Json({
    task: context.taskId,
    actor: context.actorId,
    intent_id: intent.intent_id,
  });
  const output = resolveFoundryOutput(context, `outputs/identity-stage/${stageId}`);
  const prepareFile = path.join(output, "prepared", "identity-stage-preparation.json");
  let rowsFile = "";
  let predecessorFile = "";
  let targets: Array<FoundryIdentityStageTarget & { source_file: string }> = [];
  const validateCurrent = (index: readonly ArtifactEntry[]) => {
    signal?.throwIfAborted();
    assertQualifiedFoundryRuntime(context, qualified);
    assertSelectedFoundryIdentityStageInput(context, selected);
    selectedBytes(selected);
    for (const fact of context.inputs) readFoundryInput(context, fact.path);
    if (
      index.length < prefix.length ||
      prefix.some((entry, at) => entry.record_sha256 !== index[at].record_sha256)
    )
      reject("retained-index-prefix");
    assertNativeUnprepared(context, index);
    const interaction = currentFoundryInteractionState(context, index);
    if (interaction) {
      const questions = currentFoundryQuestions(interaction.state);
      const investigations = currentFoundryInvestigations(interaction.state);
      if (questions.length || investigations.length)
        throw new FoundryContextError(
          questions.length ? "interaction_decision_pending" : "interaction_investigation_pending",
          "Resolve the current question or investigation before identity preflight.",
        );
    }
    const state = currentWorkflowState(context, index),
      rows = state.rows;
    if (
      !rows ||
      rows.entry.sha256 !== intent.rows_report_sha256 ||
      (!state.assessment && !state.retainedAssessment)
    )
      reject("current-rows-assessment");
    const predecessor = index.find(
      (entry) =>
        entry.command === "dataset-workflow-identity" &&
        path.basename(entry.path) === "foundry-identity.json" &&
        entry.sha256 === intent.predecessor_identity_sha256,
    );
    if (!predecessor) reject("indexed-predecessor");
    const old = readWorkflowArtifact(context, predecessor);
    const predecessorAccount = workflowObject(old.value.account);
    if (
      old.value.status !== "blocked" ||
      old.value.rows_report !== rows.file ||
      old.value.explicit_new_stage === true ||
      predecessorAccount.project_ref !== context.accountIntent!.projectRef ||
      predecessorAccount.user_id !== context.accountIntent!.userId
    )
      reject("blocked-original-predecessor");
    rowsFile = rows.file;
    predecessorFile = old.file;
    const roster = rows.value.sets
      .filter((set) => set.type === "flow" || set.type === "process")
      .flatMap((set) => {
        readFoundryInput(context, set.file);
        const values = readRows(set.file);
        if (values.length !== set.count) reject("registered-row-count");
        return values.map((row) => {
          const identity = datasetIdentity(row, 0, set.type);
          return {
            dataset_type: set.type as "flow" | "process",
            dataset_id: identity.id,
            dataset_version: identity.version,
            source_row_sha256: sha256Json(row),
            source_file: set.file,
          };
        });
      });
    if (
      !roster.length ||
      new Set(roster.map(key)).size !== roster.length ||
      intent.targets.length !== roster.length ||
      new Set(intent.targets.map(key)).size !== intent.targets.length ||
      intent.targets.some(
        (target) =>
          !roster.some(
            (row) => key(row) === key(target) && row.source_row_sha256 === target.source_row_sha256,
          ),
      )
    )
      reject("exact-current-flow-process-roster");
    targets = roster;
    for (const entry of index.filter(
      (item) =>
        item.command === prepareCommand &&
        path.basename(item.path) === "identity-stage-preparation.json",
    )) {
      const retained = readWorkflowArtifact(context, entry).value;
      if (retained.intent_id === intent.intent_id && retained.intent_sha256 !== intentSha256)
        reject("intent-already-bound");
      if (
        retained.stage_id === stageId &&
        retained.qualification_sha256 !== qualified.qualification_sha256
      )
        reject("intent-runtime-changed");
      if (retained.stage_id === stageId && retained.authentication_mode !== authentication.mode)
        reject("intent-authentication-mode-changed");
      if (
        retained.stage_id !== stageId &&
        retained.rows_report_sha256 === intent.rows_report_sha256 &&
        retained.predecessor_identity_sha256 === intent.predecessor_identity_sha256
      )
        reject("overlapping-retained-stage");
    }
    if (
      state.identity?.entry.sha256 !== intent.predecessor_identity_sha256 &&
      state.identity?.value.stage_id !== stageId
    )
      reject("current-predecessor-changed");
  };
  await withFoundryTaskMetadata(context, (_, index) => validateCurrent(index));
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent!.sessionReference,
    process.env,
  );
  environment.FOUNDRY_VERIFIED_PROJECT_REF = context.accountIntent!.projectRef;
  environment.FOUNDRY_VERIFIED_USER_ID = context.accountIntent!.userId;
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  try {
    const prepare = await runFoundryTaskOperation(
      context,
      {
        command: prepareCommand,
        options: {
          stage_id: stageId,
          intent_sha256: intentSha256,
          rows_report_sha256: intent.rows_report_sha256,
          predecessor_identity_sha256: intent.predecessor_identity_sha256,
        },
        validateCurrent,
      },
      (operation) => {
        const identity = verifyFoundryRuntimeIdentity(
          context,
          authentication,
          process.env,
          qualified,
        );
        const cli = assertCliRuntimeMatches(qualified.cli.expectation);
        const installed = resolveInstalledTiangongLcaCliPackage();
        const root = path.dirname(prepareFile);
        operation.writeText(path.join(root, "selected-intent.json"), selectedBytes(selected));
        operation.writeJson(path.join(root, "identity-receipt.json"), identity.receipt);
        operation.writeJson(path.join(root, "roster.json"), targets);
        operation.writeJson(path.join(root, "runtime-cli-inventory.json"), {
          qualification: qualified,
          cli: {
            root: installed.packageRoot,
            bin: captureFoundryInput(installed.binPath),
            files: cli.files,
          },
          executable: captureFoundryInput(process.execPath),
        });
        const preparedTargets: PreparedTarget[] = [];
        for (const target of targets) {
          const type = target.dataset_type;
          // The published owner names outputs by ID. A separate version-bound parent prevents collisions.
          const outDir = path.join(root, "targets", sha256Json(target));
          const sourceIndex = path.join(outDir, "source-context.jsonl");
          const rowFile = path.join(outDir, "selected-row.jsonl");
          const row = readRows(target.source_file).find(
            (value) => sha256Json(value) === target.source_row_sha256,
          );
          if (!row) reject("prepared-source-row");
          operation.writeText(rowFile, JSON.stringify(row) + "\n");
          operation.writeText(
            sourceIndex,
            JSON.stringify({ ...target, source_file: rowFile }) + "\n",
          );
          const owner = createFoundryIdentityOwners(context, qualified, type, {
            environment,
            cwd: root,
          });
          const built = workflowObject(
            owner.invoke(() =>
              owner.preflight.runDatasetIdentityPreflightRequestsBuild({
                type,
                rowsFile: rowFile,
                sourceIndex,
                outDir,
              }),
            ),
          );
          const indexFile = resolveFoundryOutput(
            context,
            path.resolve(
              context.assetRoot,
              String(workflowObject(built.files).identity_preflight_requests),
            ),
          );
          const audited = workflowObject(
            owner.invoke(() =>
              owner.preflight.runDatasetIdentityPreflightQueryAudit({
                index: indexFile,
                outDir: path.join(outDir, "query-audit"),
              }),
            ),
          );
          if (built.status !== "ready" || audited.status !== "passed")
            reject(
              `request-query-audit:${JSON.stringify({ prepare: built.blockers, audit: audited.blockers })}`,
            );
          const indexRows = jsonLines(indexFile);
          if (
            indexRows.length !== 1 ||
            key(indexRows[0] as unknown as FoundryIdentityStageTarget) !== key(target)
          )
            reject("prepared-roster-count");
          const admittedRow = {
            ...indexRows[0],
            relevant_input_hashes: {
              registered_rows: captureFoundryInput(target.source_file).sha256,
              source_row: target.source_row_sha256,
            },
          };
          const admittedIndex = path.join(outDir, "admitted-identity-preflight-requests.jsonl");
          operation.writeText(admittedIndex, JSON.stringify(admittedRow) + "\n");
          preparedTargets.push({
            ...target,
            owner_source_file: rowFile,
            index: admittedIndex,
            row: admittedRow,
          });
        }
        registerWorkflowStageFiles(context, operation, root);
        const report = {
          schema: "tiangong-foundry.identity-stage-preparation.v1",
          stage_id: stageId,
          intent_id: intent.intent_id,
          descriptor_sha256: selected.descriptor.sha256,
          intent_sha256: intentSha256,
          task_id: context.taskId,
          actor_id: context.actorId,
          rows_report: rowsFile,
          rows_report_sha256: intent.rows_report_sha256,
          predecessor_identity: {
            path: predecessorFile,
            sha256: intent.predecessor_identity_sha256,
          },
          predecessor_identity_sha256: intent.predecessor_identity_sha256,
          qualification_sha256: qualified.qualification_sha256,
          authentication_mode: identity.mode,
          targets: preparedTargets,
          account: {
            project_ref: context.accountIntent!.projectRef,
            user_id: context.accountIntent!.userId,
          },
          prepared_at_utc: operation.nowIso(),
        };
        operation.writeJson(prepareFile, report);
        return report;
      },
    );
    const preparedTargets = prepare.targets as PreparedTarget[];
    if (!Array.isArray(preparedTargets) || preparedTargets.length !== targets.length)
      reject("retained-preparation");
    const accepted: Array<{ target: PreparedTarget; run: JsonRecord; runDir: string }> = [];
    const blockers: JsonRecord[] = [];
    let invocations: number | null = 0;
    let thisInvocation: number | null = 0;
    for (const target of preparedTargets) {
      signal?.throwIfAborted();
      const targetId = sha256Json({ stage_id: stageId, target });
      const targetRoot = path.join(output, "dispatch", targetId),
        claimFile = path.join(targetRoot, "dispatch.json");
      const authFile = path.join(targetRoot, "identity-receipt.json"),
        runDir = path.join(targetRoot, "run");
      let newlyClaimed = false;
      let identity: VerifiedFoundryIdentity | null = null;
      const claim = await runFoundryTaskOperation(
        context,
        {
          command: dispatchCommand,
          options: { stage_id: stageId, target_id: targetId, intent_sha256: intentSha256 },
          validateCurrent(index) {
            validateCurrent(index);
            // Verify after expensive locked metadata; serialized receipts never extend permission.
            if (!fs.existsSync(claimFile))
              identity = verifyFoundryRuntimeIdentity(
                context,
                authentication,
                process.env,
                qualified,
              );
          },
        },
        (operation) => {
          if (fs.existsSync(claimFile)) {
            // An orphan file without its completed native receipt cannot prove dispatch admission.
            const orphaned = {
              schema: "tiangong-foundry.identity-stage-orphan-observation.v1",
              stage_id: stageId,
              target_id: targetId,
              target,
              claim: captureFoundryInput(claimFile),
              admission_status: "ORPHANED_CLAIM_UNPROVEN",
            };
            operation.writeJson(path.join(targetRoot, "orphaned-claim.json"), orphaned);
            return orphaned;
          }
          if (!identity) reject("fresh-dispatch-identity");
          assertVerifiedFoundryIdentity(context, identity, qualified);
          operation.writeJson(authFile, identity.receipt);
          const value = {
            schema: "tiangong-foundry.identity-stage-dispatch.v1",
            stage_id: stageId,
            target_id: targetId,
            intent_id: intent.intent_id,
            target,
            auth_receipt: captureFoundryInput(authFile),
            qualification_sha256: qualified.qualification_sha256,
            authentication_mode: identity.mode,
            max_attempts: 1,
            dispatch_state: "CLAIMED_OUTCOME_UNPROVEN",
            claimed_at_utc: new Date().toISOString(),
          };
          operation.writeJson(claimFile, value);
          newlyClaimed = true;
          return value;
        },
      );
      if (newlyClaimed) {
        signal?.throwIfAborted();
        if (!identity) reject("fresh-dispatch-identity");
        assertVerifiedFoundryIdentity(context, identity, qualified);
        // Keep CLI startup independent of digest paths and the workspace's .env.
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-identity-stage-"));
        try {
          fs.chmodSync(temporary, 0o700);
          const owner = createFoundryIdentityOwners(context, qualified, target.dataset_type, {
            environment,
            cwd: temporary,
          });
          try {
            if (thisInvocation !== null) thisInvocation += 1;
            owner.invoke(() =>
              owner.preflight.runDatasetIdentityPreflightRun({
                index: target.index,
                outDir: runDir,
                authReceipt: authFile,
                expectedProjectRef: context.accountIntent!.projectRef,
                expectedUserId: context.accountIntent!.userId,
                maxAttempts: 1,
                timeoutMs: 60_000,
                authReceiptMaxAgeMs: 60_000,
              }),
            );
          } catch {
            // Retained logs may prove the original result; no new invocation follows this claim.
          }
        } finally {
          fs.rmSync(temporary, { recursive: true, force: true });
        }
      }
      signal?.throwIfAborted();
      await withFoundryTaskMetadata(context, (_, index) => validateCurrent(index));
      try {
        const run = acceptRetainedTarget(
          context,
          qualified,
          target,
          claim,
          authFile,
          runDir,
          authentication.mode,
        );
        accepted.push({ target, run, runDir });
        if (invocations !== null) invocations += 1;
      } catch (error) {
        invocations = null;
        if (newlyClaimed) thisInvocation = null;
        blockers.push({
          code: "identity_stage_outcome_unproven",
          target,
          disposition: "UNKNOWN_DO_NOT_REPLAY",
          reason: error instanceof Error ? error.message : "missing-execution-evidence",
        });
        // A partial stage cannot evade this claim through another intent or launch later targets.
        break;
      }
    }
    const resultId = sha256Json({
      accepted: accepted.map(({ target, run }) => ({ target: key(target), run: sha256Json(run) })),
      blockers,
    });
    const resultRoot = path.join(output, "results", resultId);
    const report = await runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-identity",
        options: {
          stage_id: stageId,
          result_id: resultId,
          explicit_new_stage: true,
          intent_sha256: intentSha256,
        },
        validateCurrent,
      },
      (operation) => {
        // Partial raw outputs remain retained but unadopted. Only completed exact executions are indexed.
        const retainedDirectories: string[] = [];
        for (const { target, runDir } of accepted) {
          retainedDirectories.push(
            runDir,
            resolveFoundryOutput(
              context,
              path.resolve(context.assetRoot, String(target.row.output_dir)),
            ),
          );
        }
        registerWorkflowStageFiles(context, operation, retainedDirectories);
        const combined = path.join(resultRoot, "identity-preflight-requests.jsonl");
        operation.writeText(
          combined,
          accepted.map(({ target }) => JSON.stringify(target.row)).join("\n") +
            (accepted.length ? "\n" : ""),
        );
        const sets: JsonRecord[] = [];
        const grouped = new Map<string, typeof accepted>();
        for (const item of accepted) {
          const groupKey = JSON.stringify([item.target.dataset_type, item.target.source_file]);
          grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), item]);
        }
        for (const [groupKey, items] of grouped) {
          const groupRoot = path.join(resultRoot, "sets", sha256Text(groupKey));
          const index = path.join(groupRoot, "identity-preflight-requests.jsonl");
          operation.writeText(
            index,
            items.map(({ target }) => JSON.stringify(target.row)).join("\n") + "\n",
          );
          const summary = {
            schema: "tiangong-foundry.identity-stage-set.v1",
            remote_write_mode: "read-only",
            status: items.some(({ run }) => run.status === "completed_with_identity_findings")
              ? "completed_with_identity_findings"
              : "completed",
            type: items[0].target.dataset_type,
            rows: items[0].target.source_file,
            index,
            owner_runs: items.map(({ run }) =>
              path.resolve(context.assetRoot, String(workflowObject(run.files).report)),
            ),
          };
          const summaryFile = path.join(groupRoot, "identity-stage-set.json");
          operation.writeJson(summaryFile, summary);
          sets.push({
            type: summary.type,
            rows: summary.rows,
            index,
            report: summaryFile,
            status: summary.status,
          });
        }
        const report = {
          schema: "tiangong-foundry.identity-stage.v1",
          status: blockers.length ? "blocked" : "completed",
          mode: "explicit-new-read-only-stage",
          explicit_new_stage: true,
          new_cli_execution: accepted.length ? true : invocations === null ? null : false,
          stage_id: stageId,
          intent_id: intent.intent_id,
          task_id: context.taskId,
          actor_id: context.actorId,
          rows_report: rowsFile,
          owner_base: context.assetRoot,
          predecessor_identity: prepare.predecessor_identity,
          account: prepare.account,
          qualification_sha256: qualified.qualification_sha256,
          authentication_mode: authentication.mode,
          checked_at_utc: operation.nowIso(),
          index: combined,
          counts: {
            admitted_targets: preparedTargets.length,
            accepted_targets: accepted.length,
            cli_invocations: invocations,
            underlying_retrievals: null,
          },
          sets,
          blockers,
        };
        operation.writeJson(path.join(resultRoot, "foundry-identity.json"), report);
        return report;
      },
    );
    return {
      ...report,
      this_invocation: { cli_invocations: thisInvocation, underlying_retrievals: null },
    };
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
  }
}

function acceptRetainedTarget(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  target: PreparedTarget,
  claim: JsonRecord,
  authFile: string,
  runDir: string,
  authenticationMode: FoundryAuthentication["mode"],
): JsonRecord {
  assertQualifiedFoundryRuntime(context, qualified);
  if (claim.admission_status === "ORPHANED_CLAIM_UNPROVEN") reject("orphaned-claim-unproven");
  const originalMode = claim.authentication_mode;
  if (
    (originalMode !== "oauth" && originalMode !== "headless") ||
    originalMode !== authenticationMode
  )
    reject("retained-authentication-mode-changed");
  if (
    claim.qualification_sha256 !== qualified.qualification_sha256 ||
    stableJson(claim.target) !== stableJson(target) ||
    claim.max_attempts !== 1
  )
    reject("retained-claim-binding");
  const authFact = captureFoundryInput(authFile);
  if (stableJson(authFact) !== stableJson(claim.auth_receipt))
    reject("retained-authentication-receipt");
  const receipt = parseFreshIntentBoundAuthReceipt(readJson(authFile), {
    nowMs: Date.parse(String(claim.claimed_at_utc)),
    maxAgeMs: 60_000,
    expectedProjectRef: context.accountIntent!.projectRef,
    expectedUserId: context.accountIntent!.userId,
    sessionMode: originalMode,
  });
  const runFile = path.join(runDir, "dataset-identity-preflight-run-report.json"),
    run = readJson(runFile);
  const resolve = (value: unknown): string => {
    if (typeof value !== "string") reject("retained-locator");
    return resolveFoundryOutput(context, path.resolve(context.assetRoot, value));
  };
  if (resolve(workflowObject(run.files).report) !== resolve(runFile))
    reject("retained-run-report-path");
  if (
    !Array.isArray(run.results) ||
    run.results.length !== 1 ||
    !["completed", "completed_with_identity_findings"].includes(String(run.status)) ||
    run.command !== "dataset-identity-preflight-run" ||
    run.remote_write_mode !== "read-only" ||
    resolve(run.index_file) !== target.index
  )
    reject("retained-owner-result");
  const result = workflowObject(run.results[0]),
    options = workflowObject(run.runtime_options),
    cli = workflowObject(options.cli);
  const auth = workflowObject(options.auth_receipt),
    installed = resolveInstalledTiangongLcaCliPackage();
  if (
    result.status !== "completed" ||
    result.attempt !== 1 ||
    result.attempts !== 1 ||
    result.failure_code !== null ||
    options.max_attempts !== 1 ||
    options.timeout_ms !== 60_000 ||
    options.retry_failed !== null ||
    options.result_cache_dir !== null ||
    cli.executable !== process.execPath ||
    stableJson(cli.args_prefix) !== stableJson([installed.binPath]) ||
    cli.package !== `${installed.packageName}@${installed.packageVersion}` ||
    resolve(auth.file) !== authFile ||
    auth.receipt_scope_sha256 !== receipt.receipt_scope_sha256 ||
    auth.project_ref !== receipt.project.project_ref ||
    auth.user_id !== receipt.identity.user_id
  )
    reject("retained-owner-runtime-account-attempt");
  if (key(result as unknown as FoundryIdentityStageTarget) !== key(target))
    reject("retained-target-identity");
  if (stableJson(jsonLines(resolve(workflowObject(run.files).results))) !== stableJson(run.results))
    reject("retained-results-bytes");
  const requestFile = resolve(target.row.request_file),
    reportFile = resolve(target.row.expected_report_file),
    outputDir = resolve(target.row.output_dir);
  const requestText = fs.readFileSync(requestFile, "utf8"),
    request = readJson(requestFile);
  if (
    target.row.request_bytes_sha256 !== sha256Text(requestText) ||
    target.row.request_json_sha256 !== sha256Text(JSON.stringify(request)) ||
    target.row.target_sha256 !== sha256Text(JSON.stringify(request.target)) ||
    resolve(target.row.source_file) !== target.owner_source_file
  )
    reject("retained-request-bytes");
  const argv = [
    target.dataset_type,
    "identity-preflight",
    "--input",
    requestFile,
    "--out-dir",
    outputDir,
    "--json",
    "--timeout-ms",
    "60000",
  ];
  const spec = createFoundryCommandSpec({
    executable: process.execPath,
    argv: [installed.binPath, ...argv],
    binding: {
      artifacts: [
        createFileArtifactFact({
          role: "identity_preflight_request",
          path: String(target.row.request_file),
          filePath: requestFile,
        }),
      ],
    },
  });
  if (
    result.executable !== process.execPath ||
    result.cli_package !== cli.package ||
    stableJson(result.cli_args) !== stableJson(argv) ||
    stableJson(result.command_spec) !== stableJson(spec) ||
    resolve(result.request_file) !== requestFile ||
    resolve(result.report_file) !== reportFile
  )
    reject("retained-command-spec");
  const binding = createIdentityPreflightBinding({
    datasetType: target.dataset_type,
    datasetId: target.dataset_id,
    datasetVersion: target.dataset_version,
    targetSha256: String(target.row.target_sha256),
    requestText,
    semanticArgv: [target.dataset_type, "identity-preflight", "--json", "--timeout-ms", "60000"],
    cli: {
      packageName: installed.packageName,
      packageVersion: installed.packageVersion,
      packageIntegrity: `sha256-${sha256Text(fs.readFileSync(installed.binPath, "utf8"))}`,
    },
    authReceipt: receipt,
    relevantInputHashes: {
      ...(workflowObject(target.row.relevant_input_hashes ?? {}) as Record<string, string>),
      source_file: captureFoundryInput(target.owner_source_file).sha256,
    },
  });
  if (result.binding_sha256 !== binding.binding_sha256) reject("retained-execution-binding");
  const reportText = fs.readFileSync(reportFile, "utf8");
  const report = workflowObject(JSON.parse(reportText));
  if (
    report.schema_version !== 1 ||
    report.kind !== target.dataset_type ||
    workflowObject(report.target).id !== target.dataset_id ||
    workflowObject(report.target).version !== target.dataset_version ||
    report.input_path !== requestFile ||
    report.out_dir !== outputDir ||
    workflowObject(report.files).identity_decision !== reportFile ||
    Object.hasOwn(report, "error") ||
    (Object.hasOwn(report, "errors") && (!Array.isArray(report.errors) || report.errors.length)) ||
    result.report_status !== report.status ||
    result.decision !== (report.decision ?? null) ||
    result.signal != null ||
    fs.readFileSync(resolve(result.stderr_log), "utf8") !== "" ||
    typeof result.cli_exit_code !== "number" ||
    ![0, 1].includes(result.cli_exit_code)
  )
    reject("retained-report-identity-path-outcome");
  const manifest = readJson(resolve(result.execution_manifest_file));
  const completedAt = Date.parse(String(manifest.completed_at_utc));
  const generatedAt = Date.parse(String(report.generated_at_utc));
  const runCompletedAt = Date.parse(String(run.generated_at_utc));
  if (
    !Number.isFinite(completedAt) ||
    !Number.isFinite(generatedAt) ||
    !Number.isFinite(runCompletedAt) ||
    generatedAt < Date.parse(String(claim.claimed_at_utc)) ||
    generatedAt > completedAt ||
    completedAt < Date.parse(String(claim.claimed_at_utc)) ||
    completedAt > runCompletedAt
  )
    reject("retained-execution-time");
  const checked = validateIdentityPreflightExecution({
    binding,
    exitCode: Number(result.cli_exit_code),
    stdoutText: fs.readFileSync(resolve(result.stdout_log), "utf8"),
    diskReportText: reportText,
    startedAtMs: Date.parse(String(claim.claimed_at_utc)),
    diskReportMtimeMs: fs.statSync(reportFile).mtimeMs,
    completedAtUtc: String(manifest.completed_at_utc),
    requestFile,
    outputDir,
    reportFile,
    stderrText: fs.readFileSync(resolve(result.stderr_log), "utf8"),
    signal: result.signal == null ? null : String(result.signal),
  });
  if (!checked.ok) reject(checked.code);
  if (
    !validateBoundExecutionManifest(manifest, binding, reportText).ok ||
    stableJson(manifest) !== stableJson(checked.manifest)
  )
    reject("retained-execution-manifest");
  return run;
}
