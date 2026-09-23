import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  captureFoundryInput,
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readTaskBytes } from "./foundry-task-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { applicableFoundryInteractionDigest } from "./foundry-interaction-projection.ts";
import type { FoundryInteractionState } from "./foundry-interaction-types.ts";

/**
 * The repair producer's registration of the preparation report. These two values are repeated here
 * rather than imported so this projection module stays a graph leaf; the public repair suite fails
 * if the producer ever stops registering under them.
 */
const FOUNDRY_REPAIR_PREFLIGHT_COMMAND = "dataset-workflow-repair-preflight";
const FOUNDRY_REPAIR_REPORT_NAME = "foundry-repair-preflight.json";
const FOUNDRY_REPAIR_PREPARATION_SCHEMA = "tiangong-foundry.repair-preparation.v1";

export interface WorkflowRowSet {
  type: string;
  file: string;
  count: number;
}
export interface WorkflowArtifact<T> {
  entry: ArtifactEntry;
  file: string;
  value: T;
}
export interface WorkflowRows {
  schema: "tiangong-foundry.rows-stage.v1";
  status: "completed";
  sets: WorkflowRowSet[];
  identity_reports: string[];
  identity_rewrite_reports: string[];
}
export interface WorkflowAssessment {
  schema: "tiangong-foundry.assessment-stage.v1";
  status: "in_progress" | "completed";
  owner_base: string;
  rows_report?: string;
  identity_report?: string | null;
  previous_assessment?: string | null;
  previous_assessment_sha256?: string | null;
  interaction_sha256?: string;
  assessed_type?: string;
  sets: Array<Record<string, unknown>>;
}

const queueTypes = new Set(["process", "flow", "contact", "source", "unitgroup", "flowproperty"]);

export function workflowAssessmentQueueScopeSha256(sets: readonly WorkflowRowSet[]): string | null {
  if (!sets.some((set) => set.type === "process")) return null;
  return sha256Json(
    sets
      .filter((set) => queueTypes.has(set.type))
      .map((set) => {
        const fact = captureFoundryInput(set.file);
        return { type: set.type, path: set.file, bytes: fact.bytes, sha256: fact.sha256 };
      }),
  );
}

function registeredAssessmentFile(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  file: unknown,
): boolean {
  if (typeof file !== "string") return false;
  const entry = entries.find((candidate) => resolveFoundryOutput(context, candidate.path) === file);
  if (!entry) return false;
  const fact = captureFoundryInput(file);
  if (fact.bytes !== entry.bytes || fact.sha256 !== entry.sha256)
    throw new FoundryContextError(
      "workflow_assessment_changed",
      "A registered assessment input or report changed.",
    );
  return true;
}

export function workflowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FoundryContextError(
      "workflow_report_invalid",
      "Workflow metadata must be an object.",
    );
  return value as Record<string, unknown>;
}

export function readWorkflowArtifact(
  context: FoundryRuntimeContext,
  entry: ArtifactEntry,
): WorkflowArtifact<Record<string, unknown>> {
  const file = resolveFoundryOutput(context, entry.path);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.size !== entry.bytes)
      throw new FoundryContextError(
        "workflow_artifact_changed",
        "Workflow artifact size or identity changed.",
      );
    const bytes = fs.readFileSync(fd);
    if (
      bytes.length !== entry.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      throw new FoundryContextError(
        "workflow_artifact_changed",
        "Workflow artifact content changed.",
      );
    return { entry, file, value: workflowObject(JSON.parse(bytes.toString("utf8"))) };
  } finally {
    fs.closeSync(fd);
  }
}

export function currentWorkflowState(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const rowEntry = entries.findLast(
    (entry) =>
      ["dataset-workflow-rows", "dataset-semantic-apply"].includes(entry.command) &&
      path.basename(entry.path) === "foundry-rows.json",
  );
  let rows: WorkflowArtifact<WorkflowRows> | null = null;
  if (rowEntry) {
    const found = readWorkflowArtifact(context, rowEntry);
    if (
      found.value.schema !== "tiangong-foundry.rows-stage.v1" ||
      found.value.status !== "completed" ||
      !Array.isArray(found.value.sets)
    )
      throw new FoundryContextError("workflow_rows_invalid", "Registered row metadata is invalid.");
    const sets = found.value.sets.map((value) => {
      const set = workflowObject(value);
      if (
        typeof set.type !== "string" ||
        typeof set.file !== "string" ||
        !Number.isSafeInteger(set.count) ||
        Number(set.count) < 0
      )
        throw new FoundryContextError("workflow_rows_invalid", "A registered row set is invalid.");
      return { type: set.type, file: set.file, count: Number(set.count) };
    });
    const retainedReports = (key: string): string[] => {
      const value = found.value[key] ?? [];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new FoundryContextError(
          "workflow_rows_invalid",
          "Identity report references are invalid.",
        );
      return value as string[];
    };
    rows = {
      ...found,
      value: {
        schema: "tiangong-foundry.rows-stage.v1",
        status: "completed",
        sets,
        identity_reports: retainedReports("identity_reports"),
        identity_rewrite_reports: retainedReports("identity_rewrite_reports"),
      },
    };
  }
  let identity: WorkflowArtifact<Record<string, unknown>> | null = null;
  if (rows) {
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-identity" ||
        path.basename(entry.path) !== "foundry-identity.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry);
      if (
        found.value.schema !== "tiangong-foundry.identity-stage.v1" ||
        !Array.isArray(found.value.sets)
      )
        throw new FoundryContextError(
          "workflow_identity_invalid",
          "Registered identity metadata is invalid.",
        );
      if (found.value.rows_report === rows.file) {
        identity = found;
        break;
      }
    }
  }
  const interactionEntry = entries.findLast(
    (entry) =>
      entry.command === "dataset-workflow-interaction" &&
      path.basename(entry.path) === "interaction-state.json",
  );
  const interactionSha256 = interactionEntry?.sha256 ?? null;
  const interactionValue = interactionEntry
    ? readWorkflowArtifact(context, interactionEntry).value
    : null;
  if (
    interactionValue &&
    (interactionValue.schema !== "tiangong-foundry.interaction-state.v1" ||
      interactionValue.task_id !== context.taskId ||
      interactionValue.actor_id !== context.actorId ||
      !Array.isArray(interactionValue.events))
  )
    throw new FoundryContextError(
      "workflow_interaction_invalid",
      "Registered task decisions are invalid.",
    );
  const interaction = interactionValue as unknown as FoundryInteractionState | null;
  const contextShaByType = new Map<string, string>();
  for (const entry of entries) {
    if (
      entry.command !== "dataset-context-pack" ||
      path.basename(entry.path) !== "contract-report.json"
    )
      continue;
    const report = readWorkflowArtifact(context, entry).value;
    if (report.status === "completed" && typeof report.type === "string")
      contextShaByType.set(report.type, entry.sha256);
  }
  const queueScopeSha256 = rows ? workflowAssessmentQueueScopeSha256(rows.value.sets) : null;
  let assessment: WorkflowArtifact<WorkflowAssessment> | null = null;
  if (rows) {
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-assessment" ||
        path.basename(entry.path) !== "foundry-assessment.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry),
        value = found.value;
      if (
        value.schema !== "tiangong-foundry.assessment-stage.v1" ||
        value.owner_base !== context.assetRoot ||
        !["in_progress", "completed"].includes(String(value.status)) ||
        !Array.isArray(value.sets)
      )
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Registered assessment metadata is invalid.",
        );
      const sets = value.sets.map(workflowObject);
      const reportRowsEntry = entries.find(
        (candidate) =>
          ["dataset-workflow-rows", "dataset-semantic-apply"].includes(candidate.command) &&
          path.basename(candidate.path) === "foundry-rows.json" &&
          resolveFoundryOutput(context, candidate.path) === value.rows_report,
      );
      const reportRows = reportRowsEntry
        ? readWorkflowArtifact(context, reportRowsEntry).value
        : value.rows_report === undefined
          ? rows.value
          : null;
      if (!reportRows || !Array.isArray(reportRows.sets))
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Assessment row ancestry is not registered.",
        );
      // An empty reference-only row revision needs its own assessment receipt. There are
      // no per-type set facts to reuse from a predecessor with different rows.
      if (!rows.value.sets.length && value.rows_report !== rows.file) continue;
      const originalRows = reportRows.sets.map(workflowObject);
      let lastOriginal = -1;
      for (const set of sets) {
        const next = originalRows.findIndex(
          (row, index) => index > lastOriginal && row.type === set.type && row.file === set.rows,
        );
        if (next < 0)
          throw new FoundryContextError(
            "workflow_assessment_invalid",
            "Assessment contains an unbound or duplicate row set.",
          );
        lastOriginal = next;
      }
      if ((value.status === "completed") !== (sets.length === originalRows.length))
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Assessment completion must match its registered row-set coverage.",
        );
      if (value.previous_assessment !== undefined) {
        const previousPath = value.previous_assessment;
        const previousSha = value.previous_assessment_sha256;
        const previousEntry =
          typeof previousPath === "string"
            ? entries.find(
                (candidate) =>
                  candidate.command === "dataset-workflow-assessment" &&
                  candidate.sequence < entry.sequence &&
                  resolveFoundryOutput(context, candidate.path) === previousPath &&
                  candidate.sha256 === previousSha,
              )
            : undefined;
        if (
          (previousPath === null && previousSha !== null) ||
          (typeof previousPath === "string" && !previousEntry) ||
          (previousPath !== null && typeof previousPath !== "string") ||
          (previousPath === null && (sets.length !== 1 || value.assessed_type !== sets[0]?.type))
        )
          throw new FoundryContextError(
            "workflow_assessment_invalid",
            "Assessment progress has no matching registered predecessor.",
          );
        if (previousEntry) {
          const prior = readWorkflowArtifact(context, previousEntry).value;
          const priorSets = Array.isArray(prior.sets) ? prior.sets.map(workflowObject) : null;
          if (
            prior.schema !== "tiangong-foundry.assessment-stage.v1" ||
            !priorSets ||
            typeof value.assessed_type !== "string" ||
            !sets.some((set) => set.type === value.assessed_type) ||
            sets.some(
              (set) =>
                set.type !== value.assessed_type &&
                !priorSets.some((old) => sha256Json(old) === sha256Json(set)),
            )
          )
            throw new FoundryContextError(
              "workflow_assessment_invalid",
              "Assessment retained a set outside its registered predecessor.",
            );
        }
      } else if (value.status === "in_progress") {
        throw new FoundryContextError(
          "workflow_assessment_invalid",
          "Partial assessment must identify its predecessor boundary.",
        );
      }
      const identityMatches =
        (value.identity_report ?? null) ===
        (identity?.value.status === "completed" ? identity.file : null);
      const currentSets = identityMatches
        ? sets.filter((set) => {
            const row = rows.value.sets.find((candidate) => candidate.type === set.type);
            if (!row || row.file !== set.rows) return false;
            if (
              (set.interaction_digest ?? null) !==
              applicableFoundryInteractionDigest(interaction, row.type)
            )
              return false;
            const expectedContext = contextShaByType.get(row.type);
            if (
              (set.context_report_sha256 !== undefined &&
                set.context_report_sha256 !== expectedContext) ||
              (set.context_report_sha256 === undefined && value.rows_report !== rows.file)
            )
              return false;
            if (["flow", "process"].includes(row.type)) {
              if (
                (set.queue_scope_sha256 !== undefined &&
                  set.queue_scope_sha256 !== queueScopeSha256) ||
                (set.queue_scope_sha256 === undefined &&
                  queueScopeSha256 !== null &&
                  value.rows_report !== rows.file)
              )
                return false;
            }
            const files = [
              set.rows,
              set.schema_report,
              set.qa_report,
              set.curation_report,
              set.authoring_manifest,
            ];
            if (set.interaction_context !== undefined) files.push(set.interaction_context);
            if (files.some((file) => !registeredAssessmentFile(context, entries, file)))
              throw new FoundryContextError(
                "workflow_assessment_invalid",
                "A reusable assessment file is not registered.",
              );
            return true;
          })
        : [];
      const covered = new Set(currentSets.map((set) => set.type));
      assessment = {
        ...found,
        value: {
          schema: "tiangong-foundry.assessment-stage.v1",
          status: covered.size === rows.value.sets.length ? "completed" : "in_progress",
          owner_base: value.owner_base,
          rows_report: rows.file,
          identity_report: identity?.value.status === "completed" ? identity.file : null,
          ...(value.previous_assessment !== undefined
            ? {
                previous_assessment: value.previous_assessment as string | null,
                previous_assessment_sha256: value.previous_assessment_sha256 as string | null,
              }
            : {}),
          ...(typeof value.interaction_sha256 === "string"
            ? { interaction_sha256: value.interaction_sha256 }
            : {}),
          ...(typeof value.assessed_type === "string"
            ? { assessed_type: value.assessed_type }
            : {}),
          sets: currentSets,
        },
      };
      break;
    }
  }
  const assessmentComplete = assessment?.value.status === "completed";
  const coveredTypes = new Set(assessment?.value.sets.map((set) => set.type) ?? []);
  const assessmentRemainingTypes = rows
    ? rows.value.sets.filter((set) => !coveredTypes.has(set.type)).map((set) => set.type)
    : [];
  const referenceInputs = new Map<string, WorkflowArtifact<Record<string, unknown>>>();
  for (const entry of entries) {
    if (
      entry.command !== "dataset-workflow-reference-input" ||
      path.basename(entry.path) !== "foundry-reference-input.json"
    )
      continue;
    const found = readWorkflowArtifact(context, entry);
    if (
      found.value.schema !== "tiangong-foundry.reference-selection.v1" ||
      found.value.status !== "selected" ||
      typeof found.value.dataset_type !== "string"
    )
      throw new FoundryContextError(
        "reference_input_invalid",
        "Registered reference selection is invalid.",
      );
    referenceInputs.set(found.value.dataset_type, found);
  }
  const referenceInputsSha256 = referenceInputs.size
    ? createHash("sha256")
        .update(
          JSON.stringify(
            [...referenceInputs]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([type, found]) => [type, found.entry.sha256]),
          ),
        )
        .digest("hex")
    : null;
  let finalization: WorkflowArtifact<Record<string, unknown>> | null = null;
  if (rows && assessmentComplete && assessment) {
    for (const entry of [...entries].reverse()) {
      if (
        entry.command !== "dataset-workflow-finalize" ||
        path.basename(entry.path) !== "foundry-finalize.json"
      )
        continue;
      const found = readWorkflowArtifact(context, entry);
      if (
        found.value.schema !== "tiangong-foundry.finalize-stage.v1" ||
        !Array.isArray(found.value.sets) ||
        !Array.isArray(found.value.blockers)
      )
        throw new FoundryContextError(
          "workflow_finalize_invalid",
          "Registered finalization metadata is invalid.",
        );
      if (
        found.value.rows_report === rows.file &&
        found.value.assessment_report === assessment.file &&
        (found.value.reference_inputs_sha256 ?? null) === referenceInputsSha256
      ) {
        finalization = found;
        break;
      }
    }
  }
  let authorization: WorkflowArtifact<Record<string, unknown>> | null = null;
  let preparedApproval: WorkflowArtifact<Record<string, unknown>> | null = null;
  if (context.taskRoot && fs.existsSync(path.join(context.taskRoot, "authorization.json"))) {
    const pointer = createHash("sha256")
      .update(readTaskBytes(context, "authorization.json"))
      .digest("hex");
    if (finalization) {
      for (const entry of [...entries].reverse()) {
        if (
          entry.command !== "dataset-workflow-authorization" ||
          path.basename(entry.path) !== "foundry-authorization.json"
        )
          continue;
        const found = readWorkflowArtifact(context, entry);
        if (found.value.schema !== "tiangong-foundry.authorization-stage.v1")
          throw new FoundryContextError(
            "workflow_authorization_invalid",
            "Registered approval metadata is invalid.",
          );
        const prepared =
          finalization.value.approval_source_sha256 === entry.sha256 &&
          found.value.input_kind === "current_rows";
        if (prepared) preparedApproval = found;
        if (
          (found.value.finalization_sha256 === finalization.entry.sha256 || prepared) &&
          found.value.pointer_sha256 === pointer &&
          typeof found.value.expires_at_utc === "string" &&
          Date.parse(found.value.expires_at_utc) > Date.now()
        ) {
          authorization = found;
          break;
        }
      }
    }
    if (!authorization) {
      // A repair scope has no finalization: its registered authority is the latest preparation report
      // of this task, and only while that report is a prepared dispatchable write scope. An approval
      // bound to a superseded report, or to evidence that has since become no-change or blocked,
      // carries no current authority.
      const latest = entries
        .filter(
          (entry) =>
            entry.command === FOUNDRY_REPAIR_PREFLIGHT_COMMAND &&
            path.basename(entry.path) === FOUNDRY_REPAIR_REPORT_NAME,
        )
        .sort((left, right) => left.sequence - right.sequence)
        .at(-1);
      if (latest) {
        const report = readWorkflowArtifact(context, latest).value;
        const reportScope = report.scope;
        const dispatchable =
          report.schema === FOUNDRY_REPAIR_PREPARATION_SCHEMA &&
          report.status === "prepared" &&
          Boolean(reportScope) &&
          typeof reportScope === "object" &&
          !Array.isArray(reportScope) &&
          (reportScope as Record<string, unknown>).status === "dispatchable";
        if (dispatchable)
          for (const entry of [...entries].reverse()) {
            if (
              entry.command !== "dataset-workflow-authorization" ||
              path.basename(entry.path) !== "foundry-authorization.json"
            )
              continue;
            const found = readWorkflowArtifact(context, entry);
            if (found.value.schema !== "tiangong-foundry.authorization-stage.v1")
              throw new FoundryContextError(
                "workflow_authorization_invalid",
                "Registered approval metadata is invalid.",
              );
            if (
              found.value.input_kind === "repair_rows" &&
              found.value.finalization_sha256 === latest.sha256 &&
              found.value.pointer_sha256 === pointer &&
              typeof found.value.expires_at_utc === "string" &&
              Date.parse(found.value.expires_at_utc) > Date.now()
            ) {
              authorization = found;
              break;
            }
          }
      }
    }
  }
  return {
    rows,
    assessment,
    assessmentComplete,
    assessmentRemainingTypes,
    interactionSha256,
    identity,
    finalization,
    authorization,
    preparedApproval,
    referenceInputs,
    referenceInputsSha256,
  };
}
