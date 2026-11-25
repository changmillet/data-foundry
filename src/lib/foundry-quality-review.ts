import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  assertSelectedFoundryQualityReviewInput,
  parseFoundryQualityReviewInput,
  materializeFoundryQualityReviewInput,
  FOUNDRY_QUALITY_REVIEW_DRAFT_SCHEMA,
  type FoundryQualityReviewInput,
  type SelectedFoundryQualityReviewInput,
} from "./foundry-quality-review-input.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import {
  currentWorkflowState,
  readWorkflowArtifact,
  workflowObject,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { readTaskBytes } from "./foundry-task-io.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { canonicalPayloadSha256 } from "./post-write-root-proof.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { readQaFindings } from "./import-curation/internal/artifact-inputs.ts";
import { unchangedQualityReviewRows } from "./foundry-quality-review-lineage.ts";
import { qualityReviewInteractionDigest } from "./foundry-quality-review-context.ts";
import { currentFoundryInteractionState } from "./foundry-interaction-input.ts";

const code = "process_material_balance_deviation";
const command = "dataset-workflow-quality-review";
const receiptName = "foundry-quality-review.json";
type JsonRecord = Record<string, unknown>;
function invalid(message: string): never {
  throw new FoundryContextError("quality_review_scope_invalid", message);
}
function fingerprint(value: unknown): string {
  return canonicalPayloadSha256(value);
}
function live(spec: FoundryQualityReviewInput) {
  const now = Date.now();
  if (Date.parse(spec.issued_at_utc) > now || Date.parse(spec.expires_at_utc) <= now)
    invalid("Quality review authority is not current.");
}

/** Full JSON rows and ordered identities stay bound; serialization whitespace is not a row change. */
function rowScope(file: string) {
  const rows = readRows(file);
  const objects = rows.map((row, row_index) => {
    const identity = datasetIdentity(row, row_index, "process");
    const payloadIdentity = datasetIdentity(
      unwrapDatasetPayload(row, "process"),
      row_index,
      "process",
    );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(identity.id) ||
      identity.id !== payloadIdentity.id ||
      identity.version !== payloadIdentity.version ||
      identity.dataset_type !== "process"
    )
      invalid("Quality review requires identified Process rows.");
    return {
      row_index,
      id: identity.id,
      version: identity.version,
      payload_sha256: fingerprint(identity.payload),
    };
  });
  // CLI finding attribution uses a process filename. An ID occurring twice cannot be reviewed
  // through the existing ID-keyed curation report, even when the versions differ.
  if (new Set(objects.map((item) => item.id)).size !== objects.length)
    invalid("Quality review cannot select ambiguous or duplicated Process identities.");
  return { rows, objects, sha256: fingerprint(rows) };
}

function reportObservation(report: JsonRecord, findings: readonly JsonRecord[]) {
  if (
    report.status !== "completed_local_process_qa" ||
    report.policy_decision_owner !== "foundry" ||
    report.qa_mode !== "deterministic_qa_report" ||
    !Array.isArray(report.mass_balance) ||
    !Array.isArray(report.reference_evidence)
  )
    invalid("Quality review requires the completed deterministic Process QA observation.");
  const value = { ...report };
  // Only named run metadata and artifact locations vary across a deterministic rerun. All
  // remaining fields, including unknown future QA fields and the complete findings, are bound.
  for (const key of [
    "generated_at_utc",
    "run_id",
    "run_root",
    "rows_file",
    "out_dir",
    "effective_processes_dir",
    "files",
  ])
    delete value[key];
  value.reference_evidence = report.reference_evidence.map((raw) => {
    const fact = workflowObject(raw);
    const { path: _location, ...content } = fact;
    return content;
  });
  return fingerprint({ report: value, findings });
}

function binding(context: FoundryRuntimeContext, rows: FoundryInputFact) {
  if (!context.accountIntent || !context.workspaceId || !context.taskId || !context.actorId)
    invalid("Select explicit current task and account intent before reviewing a QA observation.");
  const profile = workflowObject(
    JSON.parse(readTaskBytes(context, "profile-lock.json").toString("utf8")),
  );
  return {
    workspace_id: context.workspaceId,
    task_id: context.taskId,
    actor_id: context.actorId,
    project_ref: context.accountIntent.projectRef,
    user_id: context.accountIntent.userId,
    profile_id: String(profile.profile_id),
    profile_sha256: String(profile.profile_sha256),
    input_scope_sha256: rows.sha256,
  };
}

function assertUnsealed(context: FoundryRuntimeContext, entries: readonly ArtifactEntry[]) {
  if (
    fs.existsSync(path.join(context.taskRoot!, "authorization.json")) ||
    entries.some((entry) =>
      [
        "dataset-workflow-authorization",
        "dataset-workflow-native-contract",
        "dataset-workflow-execution-prepare",
        "dataset-workflow-execution-result",
        "dataset-workflow-execution-consume",
        "dataset-workflow-execution-observation",
      ].includes(entry.command),
    ) ||
    (fs.existsSync(path.join(context.taskRoot!, "attempts")) &&
      fs.readdirSync(path.join(context.taskRoot!, "attempts")).length)
  )
    throw new FoundryContextError(
      "quality_review_scope_frozen",
      "Retain authorized, prepared or consumed scope evidence; quality review cannot change its authority.",
    );
}

function registered(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  file: string,
) {
  const fact = captureFoundryInput(file);
  if (
    !entries.some(
      (entry) =>
        path.resolve(context.taskRoot!, entry.path) === fact.path &&
        entry.bytes === fact.bytes &&
        entry.sha256 === fact.sha256,
    )
  )
    invalid("Quality review requires current indexed evidence with unchanged bytes.");
  readSelectedSemanticBytes(fact);
  return fact;
}

function registeredQa(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  file: string,
) {
  const fact = registered(context, entries, file);
  const report = workflowObject(JSON.parse(readSelectedSemanticBytes(fact).toString("utf8")));
  const files = workflowObject(report.files);
  for (const key of ["rule_findings", "findings", "llm_findings"]) {
    if (files[key] === undefined) continue;
    if (typeof files[key] !== "string") invalid("Process QA finding evidence is invalid.");
    const locator = String(files[key]);
    const target = path.isAbsolute(locator) ? locator : path.resolve(path.dirname(file), locator);
    registered(context, entries, target);
  }
  if (!Array.isArray(report.reference_evidence))
    invalid("Process QA reference evidence is missing.");
  const references = report.reference_evidence.map((raw) => {
    const expected = workflowObject(raw);
    if (typeof expected.path !== "string") invalid("Process QA reference path is invalid.");
    const actual = registered(context, entries, expected.path);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      invalid("Process QA reference evidence changed after observation.");
    return actual;
  });
  return {
    fact,
    report,
    references,
    findings: readQaFindings(context.assetRoot, report, file, "process"),
  };
}

function processContext(context: FoundryRuntimeContext, entries: readonly ArtifactEntry[]) {
  const entry = entries.findLast(
    (item) =>
      item.command === "dataset-context-pack" &&
      path.basename(item.path) === "contract-report.json" &&
      readWorkflowArtifact(context, item).value.type === "process",
  );
  if (!entry) invalid("The Process context must be registered before quality review.");
  const report = readWorkflowArtifact(context, entry);
  const files = workflowObject(report.value.files);
  for (const key of ["schema", "methodology", "ruleset"]) {
    if (typeof files[key] !== "string" || !path.isAbsolute(files[key]))
      invalid("Quality review requires the complete registered Process context.");
    registered(context, entries, files[key]);
  }
  return entry;
}

/** Read-only scope projection, not a review decision or an approval template with default consent. */
export function foundryQualityReviewScope(
  context: FoundryRuntimeContext,
  qualificationSha256: string,
  entries: readonly ArtifactEntry[],
  state: ReturnType<typeof currentWorkflowState> = currentWorkflowState(context, entries),
) {
  if (state.qualityReviewSha256) verifyQualityReviewEvidence(context, qualificationSha256, entries);
  const set = state.assessment?.value.sets.find((item) => item.type === "process");
  const rows = state.rows?.value.sets.find((item) => item.type === "process");
  if (!set || !rows || !state.rows || !state.assessment || !context.accountIntent) return null;
  if (set.runtime_qualification_sha256 !== qualificationSha256) return null;
  if (typeof set.qa_report !== "string")
    invalid("The current Process assessment has no QA report.");
  const input = registered(context, entries, rows.file);
  const { fact: qa, report, findings } = registeredQa(context, entries, set.qa_report);
  const scope = rowScope(input.path);
  const contextEntry = processContext(context, entries);
  const candidates = scope.objects.flatMap((object) =>
    findings
      .filter(
        (finding) =>
          finding.code === code &&
          finding.severity === "warning" &&
          finding.process_file === `${object.id}__${object.version}.json` &&
          finding.evidence !== null &&
          typeof finding.evidence === "object" &&
          !Array.isArray(finding.evidence) &&
          (finding.evidence as JsonRecord).policy_decision_owner === "foundry",
      )
      .map((finding) => ({ ...object, code, finding_sha256: fingerprint(finding), finding })),
  );
  if (!candidates.length) return null;
  return {
    binding: binding(context, input),
    runtime_qualification_sha256: qualificationSha256,
    rows_manifest_sha256: state.rows.entry.sha256,
    assessment_sha256: state.assessment.entry.sha256,
    context_sha256: contextEntry.sha256,
    reference_inputs_sha256: state.referenceInputsSha256,
    interaction_context_sha256: qualityReviewInteractionDigest(
      currentFoundryInteractionState(context, entries)?.state ?? null,
      scope.rows,
    ),
    qa_report_sha256: qa.sha256,
    qa_findings_sha256: fingerprint(findings),
    expected_previous_sha256: state.qualityReview?.entry.sha256 ?? null,
    candidates,
    input,
    qa,
    rows_content_sha256: scope.sha256,
    qa_observation_sha256: reportObservation(report, findings),
  };
}

/** Mechanical selection material; an untouched draft is deliberately not an accepted input. */
export function createFoundryQualityReviewTemplate(
  scope: NonNullable<ReturnType<typeof foundryQualityReviewScope>>,
) {
  const issued = Date.now();
  return {
    schema: FOUNDRY_QUALITY_REVIEW_DRAFT_SCHEMA,
    binding: scope.binding,
    runtime_qualification_sha256: scope.runtime_qualification_sha256,
    rows_manifest_sha256: scope.rows_manifest_sha256,
    assessment_sha256: scope.assessment_sha256,
    context_sha256: scope.context_sha256,
    reference_inputs_sha256: scope.reference_inputs_sha256,
    interaction_context_sha256: scope.interaction_context_sha256,
    qa_report_sha256: scope.qa_report_sha256,
    qa_findings_sha256: scope.qa_findings_sha256,
    expected_previous_sha256: scope.expected_previous_sha256,
    issued_at_utc: new Date(issued).toISOString(),
    expires_at_utc: new Date(issued + 3600_000).toISOString(),
    reviews: scope.candidates.map(({ finding: _finding, ...selection }) => ({
      ...selection,
      disposition: null,
      evidence_ids: [] as string[],
      rationale: "",
    })),
    evidence: [] as { id: string; kind: "user-decision" | "source-model"; file: string }[],
  };
}

export async function recordFoundryQualityReview(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  selected: SelectedFoundryQualityReviewInput,
) {
  assertSelectedFoundryQualityReviewInput(selected);
  assertQualifiedFoundryRuntime(context, qualified);
  const spec = selected.spec;
  live(spec);
  assertUnsealed(context, entries);
  const state = currentWorkflowState(context, entries);
  if (state.qualityReview?.value.source_sha256 === selected.descriptor.sha256) {
    if (!state.qualityReviewSha256) invalid("The previously accepted review is no longer current.");
    if (
      fingerprint(parseFoundryQualityReviewInput(state.qualityReview.value.input)) !==
      fingerprint(spec)
    )
      invalid(
        "The accepted draft now selects different evidence; retain its original review and select the current scope explicitly.",
      );
    loadFoundryQualityReview(context, qualified, entries);
    return state.qualityReview.value;
  }
  const scope = foundryQualityReviewScope(context, qualified.qualification_sha256, entries);
  if (!scope)
    invalid("Assess the current Process rows and exact mass observation before reviewing it.");
  for (const key of [
    "runtime_qualification_sha256",
    "rows_manifest_sha256",
    "assessment_sha256",
    "context_sha256",
    "reference_inputs_sha256",
    "interaction_context_sha256",
    "qa_report_sha256",
    "qa_findings_sha256",
    "expected_previous_sha256",
  ] as const)
    if (spec[key] !== scope[key]) invalid(`Quality review does not match the current ${key}.`);
  if (fingerprint(spec.binding) !== fingerprint(scope.binding))
    invalid("Quality review is for another task, account, profile or current row scope.");
  for (const review of spec.reviews) {
    const candidate = scope.candidates.find(
      (item) =>
        item.row_index === review.row_index &&
        item.id === review.id &&
        item.version === review.version &&
        item.payload_sha256 === review.payload_sha256 &&
        item.finding_sha256 === review.finding_sha256,
    );
    if (!candidate) invalid("Each decision must select an exact current Process and warning.");
  }
  const output = path.join(context.taskRoot!, "outputs", "quality-review", randomUUID());
  return runFoundryTaskOperation(
    context,
    {
      command,
      options: { descriptor: selected.descriptor, scope },
      validateCurrent(index) {
        assertSelectedFoundryQualityReviewInput(selected);
        live(spec);
        assertUnsealed(context, index);
        const current = foundryQualityReviewScope(context, qualified.qualification_sha256, index);
        if (!current || fingerprint(current) !== fingerprint(scope))
          invalid("Quality review scope or predecessor changed before registration.");
      },
    },
    (operation) => {
      const snapshot = (fact: FoundryInputFact, name: string) => {
        const target = path.join(output, name);
        operation.writeText(target, readSelectedSemanticBytes(fact));
        const captured = captureFoundryInput(target);
        if (captured.sha256 !== fact.sha256 || captured.bytes !== fact.bytes)
          invalid("Quality-review snapshot differs from selected bytes.");
        return captured;
      };
      const descriptor = snapshot(selected.descriptor, "descriptor.json");
      const evidence = selected.evidence.map((fact, index) => ({
        id: spec.evidence[index].id,
        kind: spec.evidence[index].kind,
        ...snapshot(fact, `evidence-${index}.txt`),
      }));
      const result = {
        schema: "tiangong-foundry.quality-review-receipt.v1",
        status: "accepted",
        source_sha256: selected.descriptor.sha256,
        descriptor,
        input: spec,
        runtime: context.runtime,
        rows: scope.input,
        qa: scope.qa,
        rows_content_sha256: scope.rows_content_sha256,
        qa_observation_sha256: scope.qa_observation_sha256,
        evidence,
        grants_permission: false,
      };
      operation.writeText(
        path.join(output, "reviewed-findings.jsonl"),
        spec.reviews
          .map((review) =>
            JSON.stringify({
              ...review,
              finding: scope.candidates.find(
                (item) => item.finding_sha256 === review.finding_sha256,
              )!.finding,
            }),
          )
          .join("\n") + "\n",
      );
      operation.writeText(
        path.join(output, "quality-review-report.md"),
        [
          "# Preparation quality review",
          "",
          "Raw Process QA is retained. This receipt grants no write permission.",
          ``,
          `Expires: ${spec.expires_at_utc}`,
          ``,
          ...spec.reviews.map(
            (review) =>
              `- ${review.id}@${review.version}, row ${review.row_index}: ${review.rationale}`,
          ),
          "",
          "Rerun the same task. Changed rows, QA, references, context or authority require a fresh review.",
          "",
        ].join("\n"),
      );
      operation.writeJson(path.join(output, receiptName), result);
      return result;
    },
  );
}

export interface FoundryQualityReview {
  readonly receipt_sha256: string;
  readonly expires_at_utc: string;
  readonly spec: FoundryQualityReviewInput;
  readonly rows_content_sha256: string;
  readonly qa_observation_sha256: string;
  readonly qaReferenceRows: readonly string[];
  readonly validate: () => void;
  readonly rowsMatch: (rowsFile: string, cleanupReport?: unknown) => boolean;
}
const validated = new WeakSet<object>();

function verifyQualityReviewEvidence(
  context: FoundryRuntimeContext,
  qualificationSha256: string,
  entries: readonly ArtifactEntry[],
) {
  const state = currentWorkflowState(context, entries);
  const found = state.qualityReview;
  if (!found || !state.qualityReviewSha256) return null;
  const spec = parseFoundryQualityReviewInput(found.value.input);
  live(spec);
  if (spec.runtime_qualification_sha256 !== qualificationSha256)
    invalid("Quality review belongs to a different qualified runtime.");
  const rows = state.rows?.value.sets.find((set) => set.type === "process");
  if (
    !rows ||
    fingerprint(binding(context, registered(context, entries, rows.file))) !==
      fingerprint(spec.binding)
  )
    invalid("Quality review current rows, account or profile changed.");
  const descriptor = workflowObject(found.value.descriptor);
  if (
    typeof descriptor.path !== "string" ||
    registered(context, entries, descriptor.path).sha256 !== found.value.source_sha256 ||
    fingerprint(
      materializeFoundryQualityReviewInput(
        JSON.parse(
          readSelectedSemanticBytes(registered(context, entries, descriptor.path)).toString("utf8"),
        ),
        (file) => {
          const index = spec.evidence.findIndex((item) => item.file === file);
          const evidence = found.value.evidence;
          if (index < 0 || !Array.isArray(evidence))
            invalid("Generated quality review has no retained selected evidence.");
          const snapshot = workflowObject(evidence[index]);
          if (typeof snapshot.path !== "string")
            invalid("Generated quality review evidence snapshot is missing.");
          return registered(context, entries, snapshot.path);
        },
      ),
    ) !== fingerprint(spec)
  )
    invalid("Quality review descriptor is not the indexed selected input.");
  if (!Array.isArray(found.value.evidence) || found.value.evidence.length !== spec.evidence.length)
    invalid("Quality review evidence is incomplete.");
  found.value.evidence.forEach((raw, index) => {
    const fact = workflowObject(raw),
      expected = spec.evidence[index];
    if (
      fact.id !== expected.id ||
      fact.kind !== expected.kind ||
      typeof fact.path !== "string" ||
      registered(context, entries, fact.path).sha256 !== expected.sha256
    )
      invalid("Quality review authority or source-model evidence changed.");
  });
  if (processContext(context, entries).sha256 !== spec.context_sha256)
    invalid("Quality review contract context changed.");
  const originalQa = workflowObject(found.value.qa);
  if (
    typeof originalQa.path !== "string" ||
    registered(context, entries, originalQa.path).sha256 !== spec.qa_report_sha256
  )
    invalid("Quality review original QA evidence changed.");
  const originalObservation = registeredQa(context, entries, originalQa.path);
  if (
    fingerprint(originalObservation.findings) !== spec.qa_findings_sha256 ||
    reportObservation(originalObservation.report, originalObservation.findings) !==
      found.value.qa_observation_sha256
  )
    invalid("Quality review original finding evidence changed.");
  if (
    typeof found.value.rows_content_sha256 !== "string" ||
    typeof found.value.qa_observation_sha256 !== "string"
  )
    invalid("Quality review has no complete row and observation binding.");
  return { state, found, spec, references: originalObservation.references };
}

export function loadFoundryQualityReview(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
): FoundryQualityReview | null {
  assertQualifiedFoundryRuntime(context, qualified);
  const observed = verifyQualityReviewEvidence(context, qualified.qualification_sha256, entries);
  if (!observed) return null;
  const { state, found, spec, references } = observed;
  const verify = () => {
    assertQualifiedFoundryRuntime(context, qualified);
    const current = verifyQualityReviewEvidence(context, qualified.qualification_sha256, entries);
    if (current?.found.entry.sha256 !== found.entry.sha256)
      invalid("Quality review is no longer current.");
  };
  verify();
  const result: FoundryQualityReview = Object.freeze({
    receipt_sha256: found.entry.sha256,
    expires_at_utc: spec.expires_at_utc,
    spec,
    rows_content_sha256: String(found.value.rows_content_sha256),
    qa_observation_sha256: String(found.value.qa_observation_sha256),
    qaReferenceRows: Object.freeze(references.map((fact) => fact.path)),
    validate: verify,
    rowsMatch: (rowsFile: string, cleanupReport?: unknown) => {
      const original = state.rows!.value.sets.find((set) => set.type === "process")!;
      return unchangedQualityReviewRows({
        originalRows: rowScope(original.file).rows,
        finalRowsFile: rowsFile,
        taskRoot: context.taskRoot!,
        assetRoot: context.assetRoot,
        cleanupReport,
        referenceFiles: references,
      });
    },
  });
  validated.add(result);
  return result;
}

/** Called by the existing curation owner after fresh QA, including on cleaned final rows. */
export function reviewedFoundryQualityFindings(
  review: unknown,
  rowsFile: string,
  qaReport: JsonRecord,
  findings: readonly JsonRecord[],
  cleanupReport?: unknown,
) {
  if (!review || typeof review !== "object" || !validated.has(review))
    invalid("A serialized decision cannot replace indexed quality-review admission.");
  const selected = review as FoundryQualityReview;
  selected.validate();
  const scope = rowScope(rowsFile);
  if (
    !selected.rowsMatch(rowsFile, cleanupReport) ||
    fingerprint(findings) !== selected.spec.qa_findings_sha256 ||
    reportObservation(qaReport, findings) !== selected.qa_observation_sha256
  )
    invalid("Rows, references or the deterministic QA observation changed after quality review.");
  return selected.spec.reviews.map((item) => {
    const row = scope.objects[item.row_index];
    const finding = findings.find((value) => fingerprint(value) === item.finding_sha256);
    if (
      !row ||
      row.id !== item.id ||
      row.version !== item.version ||
      row.payload_sha256 !== item.payload_sha256 ||
      !finding ||
      finding.code !== code ||
      finding.process_file !== `${item.id}__${item.version}.json`
    )
      invalid("The quality review no longer matches its exact Process finding.");
    return { ...item, finding, receipt_sha256: selected.receipt_sha256 };
  });
}

/** Recheck local review evidence at write admission; this function grants no write capability. */
export function assertFoundryQualityReviewForExecution(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  finalRowsFile: string,
) {
  for (const entry of [...entries].reverse()) {
    if (
      entry.command !== "dataset-workflow-finalize" ||
      path.basename(entry.path) !== "foundry-finalize.json"
    )
      continue;
    const found = readWorkflowArtifact(context, entry);
    const sets = Array.isArray(found.value.sets) ? found.value.sets.map(workflowObject) : [];
    const scope = sets.find((set) => set.type === "process" && set.final_rows === finalRowsFile);
    if (!scope) continue;
    if (found.value.quality_review_sha256 === undefined) return;
    const review = loadFoundryQualityReview(context, qualified, entries);
    if (!review || review.receipt_sha256 !== found.value.quality_review_sha256)
      invalid(
        "Final rows require the same current preparation quality review before write admission.",
      );
    if (typeof scope.report !== "string") invalid("Final quality-review evidence is missing.");
    const owner = workflowObject(
      JSON.parse(
        readSelectedSemanticBytes(registered(context, entries, scope.report)).toString("utf8"),
      ),
    );
    const files = workflowObject(owner.files);
    if (typeof files.qa_report !== "string" || typeof files.cleanup_report !== "string")
      invalid("Final quality-review QA and cleanup evidence is missing.");
    const qa = registeredQa(context, entries, path.resolve(context.assetRoot, files.qa_report));
    const cleanup = registered(
      context,
      entries,
      path.resolve(context.assetRoot, files.cleanup_report),
    );
    reviewedFoundryQualityFindings(review, finalRowsFile, qa.report, qa.findings, cleanup.path);
    return;
  }
}
