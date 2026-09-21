import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  currentFoundryRuntimeManifest,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { readTaskBytes, readTaskJson } from "./foundry-task-io.ts";
import { readVerifiedTaskSnapshot } from "./foundry-task-store.ts";
import { readWorkflowArtifact, workflowObject } from "./foundry-workflow-state.ts";
import { readNativeDraftHandoff } from "./finalize-owners/native-draft-handoff.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import {
  FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
  FOUNDRY_REPAIR_REPORT_NAME,
} from "./foundry-workflow-repair.ts";
import { FOUNDRY_REPAIR_PREPARATION_SCHEMA } from "./foundry-repair-preflight.ts";
import type { FoundryTaskStartSpec } from "./foundry-task-start-spec.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

type JsonRecord = Record<string, unknown>;

/** The producer commands whose registered artifacts carry the terminal no-dispatch evidence. */
const AUTHORIZATION_COMMAND = "dataset-workflow-authorization";
const PREPARE_COMMAND = "dataset-workflow-execution-prepare";
const CONSUME_COMMAND = "dataset-workflow-execution-consume";
const OBSERVATION_COMMAND = "dataset-workflow-execution-observation";
const RESULT_COMMAND = "dataset-workflow-execution-result";
/**
 * Every artifact the verdict reads is verified as a produced task input, so its operation receipt
 * must itself list these exact bytes and bind the same command, plan and input scope. A forged index
 * entry that borrows another operation's receipt therefore fails even with a recomputed hash chain.
 */
const evidenceCommands = Object.freeze([
  FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
  AUTHORIZATION_COMMAND,
  PREPARE_COMMAND,
  CONSUME_COMMAND,
  OBSERVATION_COMMAND,
  RESULT_COMMAND,
]);
const OBSERVATION_NAME = "dispatch-observation.json";
const RESULT_NAME = "owner-execution-result.json";
const RESULT_SCHEMA = "tiangong-foundry.owner-execution-result.v1";
const OBSERVATION_SCHEMA = "tiangong-foundry.dispatch-observation.v1";
const READBACK_SCHEMA = "tiangong-foundry.owner-readback.v1";
const CONSUMED_SCHEMA = "tiangong-foundry.owner-attempt-consumed.v1";
/** The CLI's definite terminal row statuses; `prepared`, `executed` and `unknown` never qualify. */
const definiteFailures = new Set(["failed", "blocked"]);
/**
 * Attempt events that would prove the owner CLI actually completed a dispatch. Lifecycle events such
 * as `item_completed`/`batch_completed` are emitted for failed items too and prove nothing either way.
 */
const succeededEvents = new Set(["attempt_succeeded", "recovery_succeeded"]);
const shaPattern = /^[0-9a-f]{64}$/u;
const maxArtifactBytes = 8 * 1024 * 1024;

export interface FoundrySuccessorLink {
  readonly task_id: string;
  readonly spec: FoundryTaskStartSpec;
  readonly inputs: readonly FoundryInputFact[];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

/**
 * Refuse one successor link. Every predicate failure uses the established refusal code, so a caller
 * can never misread the bounded exception as an unchecked state.
 */
function refuse(taskId: string, why: string): never {
  throw new FoundryContextError(
    "facade_predecessor_readback_required",
    `Retained predecessor ${taskId} does not prove a no-dispatch failure (${why}); use its original owner for status/readback before any revision can continue.`,
  );
}

/** The mutable predecessor-state fingerprint re-checked around every read of that state. */
function stability(context: FoundryRuntimeContext): string {
  const digest = (file: string) => {
    const bytes = readTaskBytes(context, file);
    return createHash("sha256").update(bytes).digest("hex");
  };
  return [
    digest("foundry-job.json"),
    digest("artifact-index.jsonl"),
    digest("account-intent.json"),
  ].join(":");
}

function latestEntry(
  entries: readonly ArtifactEntry[],
  command: string,
  basename: string,
): ArtifactEntry | null {
  return (
    entries
      .filter((entry) => entry.command === command && path.basename(entry.path) === basename)
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1) ?? null
  );
}

/**
 * The strict reader of one failed native commit report. It never trusts Foundry's own counters: the
 * CLI's machine report must prove that nothing was executed and no CLI attempt was consumed, that
 * every row is a definite failure, and that input, contract and every action are bound to the exact
 * admitted scope. Returns the refusal reason, or null when the report qualifies.
 */
export function noDispatchCommitReportProblem(
  value: unknown,
  expected: {
    readonly candidate_path: string;
    readonly contract_sha256: string;
    readonly execution_id: string;
    readonly actions: readonly {
      readonly action_id: string;
      readonly table: string;
      readonly id: string;
      readonly version: string;
      readonly desired_sha256: string;
    }[];
  },
): string | null {
  const report = record(value);
  const contract = record(report.execution_contract);
  const counts = record(report.counts);
  const rows = Array.isArray(report.rows) ? report.rows : null;
  if (
    report.schema_version !== 2 ||
    report.mode !== "commit" ||
    report.commit !== true ||
    report.requested_type !== "process" ||
    report.status !== "completed_with_failures" ||
    typeof report.input_path !== "string" ||
    path.resolve(report.input_path) !== path.resolve(expected.candidate_path) ||
    contract.sha256 !== expected.contract_sha256 ||
    contract.execution_id !== expected.execution_id ||
    contract.target_mode !== "owner_draft" ||
    typeof contract.path !== "string" ||
    !contract.path
  )
    return "the terminal report must remain a bound native commit attempt of this exact candidate and contract";
  if (
    rows === null ||
    rows.length !== expected.actions.length ||
    counts.selected !== expected.actions.length ||
    counts.prepared !== 0 ||
    counts.executed !== 0 ||
    counts.unknown !== 0 ||
    counts.attempts_consumed !== 0 ||
    !Number.isSafeInteger(counts.failed) ||
    !Number.isSafeInteger(counts.blocked) ||
    (counts.failed as number) < 0 ||
    (counts.blocked as number) < 0 ||
    counts.failed !== rows.filter((row) => record(row).status === "failed").length ||
    counts.blocked !== rows.filter((row) => record(row).status === "blocked").length
  )
    return "the terminal report must prove zero executed actions, zero consumed attempts, no unknown outcome and a row-consistent failed/blocked distribution";
  for (const [index, raw] of rows.entries()) {
    const row = record(raw);
    if (
      row.index !== index ||
      row.type !== "process" ||
      typeof row.status !== "string" ||
      !definiteFailures.has(row.status) ||
      row.attempt_consumed !== false ||
      row.replayed !== false ||
      row.readback === "desired_exact"
    )
      return `row ${index + 1} must be one definite failed or blocked row that consumed no attempt and claims no readback`;
    const action = expected.actions[index];
    if (
      row.table !== action.table ||
      row.id !== action.id ||
      row.version !== action.version ||
      row.action_id !== action.action_id ||
      row.desired_sha256 !== action.desired_sha256
    )
      return `row ${index + 1} does not bind the admitted action, entity identity or desired payload`;
  }
  return null;
}

/**
 * Admit one successor revision over a predecessor whose only terminal evidence is a CLI failure that
 * provably dispatched nothing. Every fact is re-derived from the predecessor's own hash-chained index
 * on every call; nothing is cached, and the successor may never name one of the predecessor's files.
 */
export function assertFoundryNoDispatchSuccessor(input: {
  context: FoundryRuntimeContext;
  predecessorTaskId: string;
  predecessorInputs: readonly FoundryInputFact[];
  successor: FoundrySuccessorLink;
}): void {
  const { context, predecessorTaskId, successor } = input;
  const spec = successor.spec;
  const repair = spec.repair ?? null;
  const declared = repair?.predecessor ?? null;
  if (
    spec.lane !== "existing-owner-draft-repair" ||
    !repair ||
    spec.profile_id !== "generic" ||
    !declared ||
    declared.task_id !== predecessorTaskId ||
    !shaPattern.test(declared.receipt_sha256)
  )
    refuse(
      predecessorTaskId,
      "only an explicit existing-owner-draft-repair successor naming this predecessor and its terminal report digest may continue",
    );
  const intent = spec.account_intent;
  if (!intent) refuse(predecessorTaskId, "a successor requires its explicit owner account intent");
  const manifest = currentFoundryRuntimeManifest(context);
  const predecessorContext = createFoundryRuntimeContext({
    moduleUrl: pathToFileURL(context.runtime.entryPath).href,
    workspace: context.workspaceRoot,
    cacheBase: context.cacheBase,
    // The predecessor is opened read-only under the same trusted host selection, so a migrated
    // workspace keeps its runtime authority without gaining any write path here.
    ...(manifest ? { workspaceAccess: { manifest, access: "read" as const } } : {}),
    taskId: predecessorTaskId,
    actorId: spec.actor_id,
    inputs: input.predecessorInputs,
  });
  const taskRoot = predecessorContext.taskRoot;
  if (
    predecessorContext.controlRoot !== context.controlRoot ||
    predecessorContext.workspaceRoot !== context.workspaceRoot ||
    !taskRoot ||
    path.relative(context.controlRoot, taskRoot).startsWith("..")
  )
    refuse(predecessorTaskId, "the predecessor must live inside this exact workspace");
  let snapshotBefore: string;
  try {
    snapshotBefore = stability(predecessorContext);
  } catch {
    refuse(
      predecessorTaskId,
      "the predecessor must retain its job, index and account registration",
    );
  }
  const snapshot = readVerifiedTaskSnapshot(predecessorContext, {
    verifyCommands: [...evidenceCommands],
  });
  const job = snapshot.task.job;
  if (
    job.lane !== spec.lane ||
    job.request_id !== spec.request_id ||
    job.actor_id !== spec.actor_id ||
    job.workspace_id !== context.workspaceId ||
    job.target_profile !== spec.profile_id ||
    !job.repair
  )
    refuse(
      predecessorTaskId,
      "the predecessor must share this request, actor, lane and locked generic profile",
    );
  const account = readTaskJson(predecessorContext, "account-intent.json");
  if (
    account.schema !== "tiangong-foundry.account-intent.v1" ||
    account.workspace_id !== context.workspaceId ||
    account.task_id !== predecessorTaskId ||
    account.project_ref !== intent.project_ref ||
    account.user_id !== intent.user_id ||
    (account.account_mode ?? "ordinary") !== (intent.account_mode ?? "ordinary")
  )
    refuse(predecessorTaskId, "the predecessor must be bound to this exact owner account");
  const preparationEntry = latestEntry(
    snapshot.index,
    FOUNDRY_REPAIR_PREFLIGHT_COMMAND,
    FOUNDRY_REPAIR_REPORT_NAME,
  );
  if (!preparationEntry)
    refuse(predecessorTaskId, "the predecessor retains no registered repair preparation");
  const preparation = readWorkflowArtifact(predecessorContext, preparationEntry).value;
  const preparationScope = record(preparation.scope);
  const preparationContract = record(preparation.contract);
  const preparationInputs = record(preparation.inputs);
  const preparationAccount = record(preparation.account);
  const actions = Array.isArray(preparationScope.actions)
    ? preparationScope.actions.map((action) => record(action))
    : null;
  const candidateFact = record(preparationInputs.candidate);
  const contractFact = record(preparationInputs.contract);
  const beforeFact = record(preparationInputs.before);
  if (
    preparation.schema !== FOUNDRY_REPAIR_PREPARATION_SCHEMA ||
    preparation.status !== "prepared" ||
    preparation.publication_ready !== false ||
    preparation.remote_writes !== 0 ||
    preparationScope.status !== "dispatchable" ||
    !actions?.length ||
    typeof candidateFact.path !== "string" ||
    typeof candidateFact.sha256 !== "string" ||
    typeof contractFact.path !== "string" ||
    typeof beforeFact.sha256 !== "string" ||
    typeof preparationContract.canonical_sha256 !== "string" ||
    typeof preparationContract.execution_id !== "string" ||
    preparationAccount.user_id !== intent.user_id ||
    preparationAccount.project_ref !== intent.project_ref ||
    preparationAccount.state_code !== "0"
  )
    refuse(
      predecessorTaskId,
      "the predecessor must retain one prepared dispatchable repair scope bound to this owner",
    );
  const resultEntry = latestEntry(snapshot.index, RESULT_COMMAND, RESULT_NAME);
  if (!resultEntry)
    refuse(predecessorTaskId, "the predecessor has no registered terminal owner execution result");
  const result = readWorkflowArtifact(predecessorContext, resultEntry).value;
  const observation = record(result.observation);
  const boundReport = record(observation.report);
  const readback = result.readback;
  if (
    result.schema !== RESULT_SCHEMA ||
    result.status !== "unresolved" ||
    result.scope_id !== sha256Json({ task: predecessorTaskId, type: "process" }) ||
    result.attempt_consumed !== true ||
    (readback !== null && record(readback).schema !== READBACK_SCHEMA) ||
    (readback !== null && record(readback).status !== "unresolved") ||
    observation.schema !== OBSERVATION_SCHEMA ||
    observation.disposition !== "failed" ||
    typeof boundReport.path !== "string" ||
    boundReport.sha256 !== declared.receipt_sha256
  )
    refuse(
      predecessorTaskId,
      "the terminal result must be an unresolved definite dispatch failure bound to the declared report digest",
    );
  const boundReportPath = path.resolve(String(boundReport.path));
  const requestEntry = snapshot.index.find(
    (entry) =>
      entry.command === PREPARE_COMMAND &&
      entry.sha256 === result.request_sha256 &&
      path.basename(entry.path) === "owner-execution-request.json",
  );
  if (!requestEntry)
    refuse(
      predecessorTaskId,
      "the consumed attempt must name a registered owner execution request of this task",
    );
  const reportEntry = snapshot.index.find(
    (entry) =>
      entry.command === OBSERVATION_COMMAND &&
      entry.sha256 === boundReport.sha256 &&
      entry.bytes === boundReport.bytes &&
      path.resolve(taskRoot, entry.path) === boundReportPath,
  );
  if (!reportEntry)
    refuse(
      predecessorTaskId,
      "the terminal CLI report must be registered by its own producer with these exact bytes",
    );
  const observationEntry = latestEntry(snapshot.index, OBSERVATION_COMMAND, OBSERVATION_NAME);
  if (
    !observationEntry ||
    sha256Json(readWorkflowArtifact(predecessorContext, observationEntry).value) !==
      sha256Json(observation)
  )
    refuse(
      predecessorTaskId,
      "the registered dispatch observation must equal the result's binding",
    );
  const terminalReport = readWorkflowArtifact(predecessorContext, reportEntry).value;
  const problem = noDispatchCommitReportProblem(terminalReport, {
    candidate_path: path.resolve(context.workspaceRoot, String(candidateFact.path)),
    contract_sha256: String(preparationContract.canonical_sha256),
    execution_id: String(preparationContract.execution_id),
    actions: actions.map((action) => ({
      action_id: String(action.action_id),
      table: String(action.table),
      id: String(action.id),
      version: String(action.version),
      desired_sha256: String(action.desired_sha256),
    })),
  });
  if (problem) refuse(predecessorTaskId, problem);
  // The report names the contract it was given; that file, wherever the admission staged it, must
  // re-derive to the exact canonical contract this scope was prepared and authorized under.
  const reportContract = path.resolve(String(record(terminalReport.execution_contract).path));
  let reportContractSha: string;
  try {
    reportContractSha = readNativeDraftHandoff({
      contractFile: reportContract,
      rowsFile: path.resolve(context.workspaceRoot, String(candidateFact.path)),
      datasetType: "process",
      targetUserId: intent.user_id,
      verifiedProjectRef: intent.project_ref,
      stateCode: "0",
      relativePath: (file) => path.relative(context.workspaceRoot, file),
    }).canonical_sha256;
  } catch {
    refuse(predecessorTaskId, "the terminal report must name a readable exact native contract");
  }
  if (reportContractSha !== String(preparationContract.canonical_sha256))
    refuse(
      predecessorTaskId,
      "the terminal report's contract must equal the prepared scope contract",
    );
  // One registered scope only: the exception may not hide a second consumed scope, and no unknown
  // file may sit beside the attempt evidence.
  const scopeId = String(result.scope_id);
  try {
    const attemptsRoot = path.join(taskRoot, "attempts");
    const ownerRoot = path.join(attemptsRoot, "owner-v1");
    if (
      fs.readdirSync(attemptsRoot).sort().join(",") !== "owner-v1" ||
      fs.readdirSync(ownerRoot).sort().join(",") !== scopeId
    )
      refuse(predecessorTaskId, "attempt evidence must hold exactly the one consumed scope");
    for (const name of fs.readdirSync(path.join(ownerRoot, scopeId)).sort()) {
      const file = path.join(ownerRoot, scopeId, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxArtifactBytes)
        refuse(predecessorTaskId, "attempt evidence must remain bounded regular files");
      if (name === "consumed.json") {
        const consumedEntry = snapshot.index.find(
          (entry) =>
            entry.command === CONSUME_COMMAND &&
            path.resolve(taskRoot, entry.path) === file &&
            entry.sha256 === captureFoundryInput(file).sha256,
        );
        if (!consumedEntry)
          refuse(
            predecessorTaskId,
            "the consumed marker must be registered by its own consume operation",
          );
        const consumed = readWorkflowArtifact(predecessorContext, consumedEntry).value;
        if (
          consumed.schema !== CONSUMED_SCHEMA ||
          consumed.scope_id !== scopeId ||
          record(consumed.request).sha256 !== result.request_sha256
        )
          refuse(predecessorTaskId, "the consumed marker must bind this exact owner request");
        continue;
      }
      if (!/^events-[0-9a-f-]+\.jsonl$/u.test(name))
        refuse(predecessorTaskId, "unknown attempt evidence cannot be treated as no-dispatch");
      const text = fs.readFileSync(file, "utf8");
      if (text && !text.endsWith("\n"))
        refuse(predecessorTaskId, "incomplete attempt history cannot prove a terminal failure");
      for (const line of text.split("\n").filter(Boolean)) {
        const event = workflowObject(JSON.parse(line));
        // Retry, resume, resource and recovery-failure events are all compatible with a dispatch
        // that never reached the owner CLI; a success event is not.
        if (event.schema_version !== 1 || succeededEvents.has(String(event.type)))
          refuse(
            predecessorTaskId,
            "a successful owner attempt cannot prove that nothing was dispatched",
          );
      }
    }
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    refuse(predecessorTaskId, "attempt evidence must stay complete and parseable");
  }
  // The successor must be a genuine, identity-stable change of the same owner draft.
  const successorFiles = (["contract", "before", "candidate"] as const).map((key) => {
    const declaredPath = repair[key];
    const index = spec.sources.findIndex((source) => source.path === declaredPath);
    const fact = successor.inputs[index];
    if (!fact) refuse(predecessorTaskId, "successor inputs must be its own selected sources");
    let current: ReturnType<typeof captureFoundryInput>;
    try {
      current = captureFoundryInput(path.resolve(context.workspaceRoot, declaredPath));
    } catch {
      refuse(predecessorTaskId, "successor selections must remain readable frozen files");
    }
    if (current.sha256 !== fact.sha256 || current.bytes !== fact.bytes)
      refuse(predecessorTaskId, "successor selections must remain their exact frozen bytes");
    return current.path;
  });
  const native = readNativeDraftHandoff({
    contractFile: successorFiles[0],
    rowsFile: successorFiles[2],
    datasetType: "process",
    targetUserId: intent.user_id,
    verifiedProjectRef: intent.project_ref,
    stateCode: "0",
    relativePath: (file) => path.relative(context.workspaceRoot, file),
  });
  const successorCandidate = captureFoundryInput(successorFiles[2]);
  if (successorCandidate.sha256 === String(candidateFact.sha256))
    refuse(predecessorTaskId, "a successor must submit different candidate bytes");
  const prior = new Map(
    actions.map((action) => [
      `${String(action.id)}@${String(action.version)}`,
      {
        table: String(action.table),
        before: String(action.before_sha256),
        desired: String(action.desired_sha256),
      },
    ]),
  );
  const successorActions = native.contract.actions;
  let changed = false;
  for (const action of successorActions) {
    const bound = prior.get(`${action.id}@${action.version}`);
    // A fresh before is allowed: the successor's own scope, fresh preflight and new grant prove the
    // current stored state, while the old before proof is never inherited.
    if (!bound || bound.table !== action.table)
      refuse(
        predecessorTaskId,
        "every successor action must keep the same table and stable entity identity and version",
      );
    if (bound.desired !== action.desired_sha256) changed = true;
  }
  if (successorActions.length !== actions.length || !changed)
    refuse(
      predecessorTaskId,
      "a successor must change at least one real desired payload, never only its execution id or file path",
    );
  if (stability(predecessorContext) !== snapshotBefore)
    refuse(predecessorTaskId, "predecessor evidence changed while its verdict was computed");
}
