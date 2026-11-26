import fs from "node:fs";
import path from "node:path";
import { readEdgeRepairValidation } from "./foundry-edge-repair-preparation.ts";
import {
  FOUNDRY_REPAIR_PREPARATION_SCHEMA,
  parseFoundryRepairDryRunReport,
  parseFoundryRepairValidateReport,
  type FoundryRepairExpectation,
} from "./foundry-repair-preflight.ts";
import { proveFoundryRepairRemoteIntegrity } from "./foundry-repair-reference-binding.ts";
import { readFoundryRepairScope, type FoundryRepairScope } from "./foundry-repair-scope.ts";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  resolveFoundryInputPath,
  resolveFoundryOutput,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertScientificRepairDiagnosticReport } from "./foundry-scientific-repair.ts";
import { readTaskJson } from "./foundry-task-io.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readWorkflowArtifact, workflowObject } from "./foundry-workflow-state.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";

export type RepairJsonRecord = Record<string, unknown>;

/** The task-store command this owner registers under; the facade owns invoking it. */
export const FOUNDRY_REPAIR_PREFLIGHT_COMMAND = "dataset-workflow-repair-preflight" as const;
export const FOUNDRY_REPAIR_REPORT_NAME = "foundry-repair-preflight.json";
export const FOUNDRY_REPAIR_JOB_SCHEMA = "tiangong-foundry.repair-preparation.v1";
export const MAX_REPAIR_REPORT_BYTES = 64 * 1024 * 1024;

export interface FoundryRepairSelectionFacts {
  readonly kind: string;
  readonly contract: string;
  readonly before: string;
  readonly candidate: string;
  readonly scientific?: string;
}

export interface FoundryRepairPreparationRead {
  readonly entry: ArtifactEntry;
  readonly file: string;
  readonly value: RepairJsonRecord;
}

export interface RepairScopeSeed {
  readonly scope: FoundryRepairScope;
  readonly contractFile: string;
  readonly beforeFile: string;
  readonly candidateFile: string;
}

export function failRepair(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

export function isRepairRecord(value: unknown): value is RepairJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function requireRepairRecord(value: unknown, code: string, label: string): RepairJsonRecord {
  if (!isRepairRecord(value)) failRepair(code, `${label} must be an object.`);
  return value;
}

export function inputFactRecord(fact: FoundryInputFact): RepairJsonRecord {
  return { ...fact };
}

export function readRepairRemoteChecks(file: string): unknown[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPAIR_REPORT_BYTES)
      failRepair("repair_remote_invalid", "Remote checks must be a bounded regular file.");
    return fs
      .readFileSync(fd, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return failRepair("repair_remote_invalid", "Remote check records are missing or invalid.");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sameFact(left: unknown, right: unknown, code: string, label: string): boolean {
  const item = requireRepairRecord(left, code, label);
  const other = requireRepairRecord(right, code, label);
  if (
    typeof item.path !== "string" ||
    !Number.isSafeInteger(item.bytes) ||
    typeof item.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(item.sha256)
  )
    failRepair(code, `${label} is not an exact file fact.`);
  return item.path === other.path && item.bytes === other.bytes && item.sha256 === other.sha256;
}

/** The immutable repair selection of the current task job. */
export function foundryRepairSelection(
  context: FoundryRuntimeContext,
): FoundryRepairSelectionFacts {
  if (!context.taskRoot)
    failRepair("repair_task_required", "Repair preparation requires the current task.");
  const raw = readTaskJson(context, "foundry-job.json");
  if (
    raw.lane !== "existing-owner-draft-repair" ||
    raw.task_id !== context.taskId ||
    raw.workspace_id !== context.workspaceId ||
    raw.actor_id !== context.actorId
  )
    failRepair(
      "repair_task_required",
      "Repair selection must belong to this registered task and actor.",
    );
  const repair = raw.repair;
  if (!isRepairRecord(repair))
    failRepair("repair_task_required", "Only an existing-owner-draft-repair task can be prepared.");
  for (const key of ["contract", "before", "candidate"] as const)
    if (typeof repair[key] !== "string" || !repair[key])
      failRepair("repair_task_required", "The repair selection is incomplete.");
  return Object.freeze({
    kind: String(repair.kind ?? ""),
    contract: repair.contract as string,
    before: repair.before as string,
    candidate: repair.candidate as string,
    ...(typeof repair.scientific === "string" ? { scientific: repair.scientific } : {}),
  });
}

/**
 * Strictly offline re-check of one repair scope: the three selected inputs are re-read against the
 * captured task scope, then the scope rules are re-applied. No remote work happens here.
 */
export function resolveRepairScope(context: FoundryRuntimeContext): RepairScopeSeed {
  const selection = foundryRepairSelection(context);
  const account = context.accountIntent;
  if (!account)
    failRepair("repair_account_required", "Repair preparation requires the owner account intent.");
  const contractFile = resolveFoundryInputPath(context, selection.contract);
  const beforeFile = resolveFoundryInputPath(context, selection.before);
  const candidateFile = resolveFoundryInputPath(context, selection.candidate);
  for (const file of [contractFile, beforeFile, candidateFile])
    readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES);
  const scope = readFoundryRepairScope({
    contractFile,
    beforeFile,
    candidateFile,
    datasetType: "process",
    targetUserId: account.userId,
    verifiedProjectRef: account.projectRef,
    stateCode: "0",
    relativePath: (file) => path.relative(context.workspaceRoot, file),
    ...(selection.scientific
      ? {
          scientific: {
            descriptorFile: resolveFoundryInputPath(context, selection.scientific),
            actorId: context.actorId!,
            selectedFiles: context.inputs.map((input) => input.path),
            excludedRuntimeRoots: [
              context.workspaceRoot,
              context.cacheRoot,
              ...context.inputs.map((input) => input.path),
            ],
            read: (file: string) => readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES),
          },
        }
      : {}),
  });
  if (
    scope.scientific &&
    sha256Json(readTaskJson(context, "repair-scope.json").scientific) !==
      sha256Json(scope.scientific)
  )
    failRepair(
      "repair_scientific_runtime_changed",
      "Scientific repair must retain its originally registered source evidence and trusted provider-impact runtime.",
    );
  return { scope, contractFile, beforeFile, candidateFile };
}

export function repairExpectationOf(
  context: FoundryRuntimeContext,
  scope: FoundryRepairScope,
  contractFile: string,
): FoundryRepairExpectation {
  const raw = JSON.parse(fs.readFileSync(contractFile, "utf8")) as RepairJsonRecord;
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
    readFoundryInput(context, resolveFoundryInputPath(context, file), MAX_REPAIR_REPORT_BYTES);
  const selected = [selection.contract, selection.before, selection.candidate].map((file) =>
    inputFactRecord(captureFoundryInput(resolveFoundryInputPath(context, file))),
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
    const value = artifact.value as RepairJsonRecord;
    if (value.schema !== FOUNDRY_REPAIR_PREPARATION_SCHEMA)
      failRepair(
        "repair_report_invalid",
        "An indexed repair preparation report has an unknown schema.",
      );
    const inputs = requireRepairRecord(value.inputs, "repair_report_invalid", "Report inputs");
    if (
      !sameFact(inputs.contract, selected[0], "repair_report_invalid", "Report contract") ||
      !sameFact(inputs.before, selected[1], "repair_report_invalid", "Report before rows") ||
      !sameFact(inputs.candidate, selected[2], "repair_report_invalid", "Report candidate rows")
    )
      failRepair(
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
      failRepair(
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
      failRepair(
        "repair_report_invalid",
        "Repair evidence must bind the current exact scope and account.",
      );
    const evidence = requireRepairRecord(
      value.evidence,
      "repair_report_invalid",
      "Report evidence",
    );
    if (!Array.isArray(evidence.files) || (value.status !== "blocked" && !evidence.files.length))
      failRepair(
        "repair_report_invalid",
        "A repair preparation report must bind its CLI evidence files.",
      );
    const verified = new Map<string, ArtifactEntry>();
    for (const item of evidence.files) {
      const bound = requireRepairRecord(item, "repair_report_invalid", "Evidence file");
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
        failRepair(
          "repair_report_invalid",
          "Every CLI evidence file must be registered by the same producer with exact bytes and hash.",
        );
      const observed = captureFoundryInput(resolveFoundryOutput(context, match.path));
      if (observed.bytes !== match.bytes || observed.sha256 !== match.sha256)
        failRepair("repair_report_invalid", "Registered CLI evidence bytes changed.");
      if (typeof bound.role !== "string" || verified.has(bound.role))
        failRepair("repair_report_invalid", "CLI evidence roles must be explicit and unique.");
      verified.set(bound.role, match);
    }
    const ownerReport = (role: string, input: string) => {
      const file = verified.get(`${role}:out/owner-report.json`);
      if (!file) failRepair("repair_report_invalid", "Repair evidence is missing an owner report.");
      const report = readWorkflowArtifact(context, file).value;
      if (report.input_path !== input)
        failRepair("repair_report_invalid", "An owner report names another input selection.");
      return report;
    };
    const expected = repairExpectationOf(context, currentScope.scope, currentScope.contractFile);
    const verifyRoots = (role: "before" | "candidate") => {
      const report = ownerReport(
        `verify-remote-${role}`,
        role === "before" ? currentScope.beforeFile : currentScope.candidateFile,
      );
      const checks = verified.get(`verify-remote-${role}:out/outputs/remote-verification.jsonl`);
      if (!checks)
        failRepair("repair_report_invalid", "Repair evidence is missing its root check records.");
      return proveFoundryRepairRemoteIntegrity({
        report,
        checks: readRepairRemoteChecks(resolveFoundryOutput(context, checks.path)),
        expectation: expected,
        beforeRows: readRows(currentScope.beforeFile, (file) =>
          readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES).toString("utf8"),
        ),
        candidateRows: readRows(currentScope.candidateFile, (file) =>
          readFoundryInput(context, file, MAX_REPAIR_REPORT_BYTES).toString("utf8"),
        ),
        content: role,
      });
    };
    if (value.status !== "blocked" && verified.has("edge-repair:out/owner-report.json")) {
      const report = ownerReport("edge-repair", currentScope.candidateFile);
      const artifact = (role: string) => {
        const entry = verified.get(`edge-repair:out/${role}`);
        if (!entry)
          failRepair(
            "repair_report_invalid",
            "Guarded Edge repair requires complete indexed evidence.",
          );
        return JSON.parse(fs.readFileSync(resolveFoundryOutput(context, entry.path), "utf8"));
      };
      const typed = artifact("validation/outputs/validation-report.json");
      const reference = artifact("references/edge-support-precommit.json");
      const before = artifact("edge-before.json");
      const rules = readEdgeRepairValidation(typed, expected);
      if (currentScope.scope.scientific) {
        const native = verified.get("science:provider-impact-report.json");
        const census = verified.get("science:census/proof.json");
        if (
          !native ||
          !census ||
          native.sha256 !== currentScope.scope.scientific.worker_report.sha256 ||
          Object.values(rules).some((ruleValue) => !ruleValue)
        )
          failRepair(
            "repair_report_invalid",
            "Scientific repair requires indexed exact native provider-impact, complete census and fully passed validation evidence.",
          );
        const proof = readWorkflowArtifact(context, census).value;
        assertScientificRepairDiagnosticReport(
          readWorkflowArtifact(context, native).value,
          currentScope.scope.scientific,
        );
        const gates = workflowObject(report.scientific_gates);
        const workerInput = JSON.parse(
          readFoundryInput(
            context,
            currentScope.scope.scientific.worker_input.path,
            MAX_REPAIR_REPORT_BYTES,
          ).toString("utf8"),
        );
        if (
          proof.schema !== "tiangong-foundry.repair-census.v1" ||
          proof.status !== "verified" ||
          proof.actor_user_id !== context.accountIntent!.userId ||
          proof.project_ref !== context.accountIntent!.projectRef ||
          proof.input_object_sha256 !== sha256Json(workerInput) ||
          proof.observation_phase !== "before" ||
          proof.double_scan !== true ||
          proof.transaction_snapshot !== false
        )
          failRepair(
            "repair_report_invalid",
            "Scientific repair census must bind the exact registered Worker input, account and complete observed scope.",
          );
        for (const [kind, role] of [
          ["schema", "schema/outputs/validation-report.json"],
          ["cleanup", "cleanup/dataset-curation-cleanup-report.json"],
          ["curation", "curation/dataset-curation-gate-report.json"],
        ] as const) {
          const gateEntry = verified.get(`edge-repair:out/${role}`);
          const fact = workflowObject(gates[kind]);
          if (!gateEntry || fact.sha256 !== gateEntry.sha256 || fact.bytes !== gateEntry.bytes)
            failRepair(
              "repair_report_invalid",
              "Scientific repair requires complete indexed native schema, cleanup and curation producer evidence.",
            );
          const checked = readWorkflowArtifact(context, gateEntry).value;
          if (
            (kind === "cleanup" && checked.status !== "completed") ||
            (kind === "curation" && checked.status !== "ready")
          )
            failRepair(
              "repair_report_invalid",
              "Scientific repair cannot adopt failed cleanup or curation evidence.",
            );
        }
        const projection = verified.get("edge-repair:out/schema-validation-rows.jsonl");
        const projectionFact = workflowObject(gates.schema_projection);
        if (
          !projection ||
          projection.sha256 !== projectionFact.sha256 ||
          projection.bytes !== projectionFact.bytes
        )
          failRepair(
            "repair_report_invalid",
            "Scientific native validation requires its indexed exact-payload Flow-context projection.",
          );
        const candidateRows = readRows(currentScope.candidateFile);
        const projectedRows = readRows(resolveFoundryOutput(context, projection.path));
        if (
          candidateRows.length !== projectedRows.length ||
          candidateRows.some(
            (row, index) =>
              sha256Json(datasetIdentity(row, index, "process").payload) !==
              sha256Json(datasetIdentity(projectedRows[index], index, "process").payload),
          )
        )
          failRepair(
            "repair_report_invalid",
            "Scientific native validation projection changed a reviewed write payload.",
          );
      }
      const beforeValidation = Object.values(rules).includes(false)
        ? artifact("before-validation/outputs/validation-report.json")
        : null;
      const detail = Array.isArray(evidence.detail)
        ? evidence.detail.map(workflowObject).find((item) => item.role === "edge_preflight")
        : null;
      const referenceEntry = verified.get(
        "edge-repair:out/references/edge-support-precommit.json",
      )!;
      const referenceFact = requireRepairRecord(
        report.reference_evidence,
        "repair_report_invalid",
        "Dependency report fact",
      );
      if (
        report.schema !== "tiangong-foundry.edge-repair-preflight.v1" ||
        report.contract_sha256 !== expected.contract_sha256 ||
        !sameFact(report.before, inputs.before, "repair_report_invalid", "Edge before rows") ||
        report.validation_sha256 !== sha256Json(typed) ||
        report.before_validation_sha256 !==
          (beforeValidation ? sha256Json(beforeValidation) : null) ||
        sha256Json(report.rule_verification) !== sha256Json(rules) ||
        !detail ||
        sha256Json(detail.report) !== sha256Json(report) ||
        report.remote_before_sha256 !== sha256Json(before) ||
        referenceFact.sha256 !== referenceEntry.sha256 ||
        referenceFact.bytes !== referenceEntry.bytes ||
        reference.status !== "passed_remote_verification" ||
        (value.status === "prepared") !== (currentScope.scope.status === "dispatchable")
      )
        failRepair(
          "repair_report_invalid",
          "Guarded Edge repair proof differs from the registered scope.",
        );
      return Object.freeze({ entry, file: resolveFoundryOutput(context, entry.path), value });
    }
    if (value.status === "prepared") {
      if (currentScope.scope.status !== "dispatchable")
        failRepair("repair_report_invalid", "A no-op is not a write preparation.");
      parseFoundryRepairDryRunReport(ownerReport("dry-run", currentScope.candidateFile), expected);
      verifyRoots("before");
    } else if (value.status === "no_change_verified") {
      if (
        currentScope.scope.status !== "satisfied" ||
        currentScope.scope.actions.some((action) => action.before_sha256 !== action.desired_sha256)
      )
        failRepair(
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
