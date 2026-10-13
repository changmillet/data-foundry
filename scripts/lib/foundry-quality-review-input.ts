import fs from "node:fs";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { assertNotFoundrySessionFile, migrationCredentialPath } from "./foundry-private-path.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import type { TaskAuthorizationBinding } from "./task-authorization.ts";

export const FOUNDRY_QUALITY_REVIEW_INPUT_SCHEMA =
  "tiangong-foundry.quality-review-input.v1" as const;
export const FOUNDRY_QUALITY_REVIEW_DRAFT_SCHEMA =
  "tiangong-foundry.quality-review-draft.v1" as const;
export interface FoundryQualityReview {
  readonly row_index: number;
  readonly id: string;
  readonly version: string;
  readonly payload_sha256: string;
  readonly finding_sha256: string;
  readonly code: "process_material_balance_deviation";
  readonly evidence_ids: readonly string[];
  readonly rationale: string;
}
export interface FoundryQualityReviewEvidence {
  readonly id: string;
  readonly kind: "user-decision" | "source-model";
  /** v1 evidence is selected as strict UTF-8 text, including source-model JSON. */
  readonly file: string;
  readonly sha256: string;
}
export interface FoundryQualityReviewInput {
  readonly schema: typeof FOUNDRY_QUALITY_REVIEW_INPUT_SCHEMA;
  readonly binding: Readonly<TaskAuthorizationBinding>;
  readonly runtime_qualification_sha256: string;
  readonly rows_manifest_sha256: string;
  readonly assessment_sha256: string;
  readonly context_sha256: string;
  readonly reference_inputs_sha256: string | null;
  readonly interaction_context_sha256: string | null;
  readonly qa_report_sha256: string;
  readonly qa_findings_sha256: string;
  readonly expected_previous_sha256: string | null;
  readonly issued_at_utc: string;
  readonly expires_at_utc: string;
  readonly reviews: readonly FoundryQualityReview[];
  readonly evidence: readonly FoundryQualityReviewEvidence[];
}
export interface SelectedFoundryQualityReviewInput {
  readonly spec: FoundryQualityReviewInput;
  readonly descriptor: FoundryInputFact;
  readonly evidence: readonly FoundryInputFact[];
}
const selections = new WeakSet<object>();
const sha = /^[0-9a-f]{64}$/u;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const bindingKeys = [
  "workspace_id",
  "task_id",
  "actor_id",
  "project_ref",
  "user_id",
  "profile_id",
  "profile_sha256",
  "input_scope_sha256",
] as const;
const hashKeys = [
  "runtime_qualification_sha256",
  "rows_manifest_sha256",
  "assessment_sha256",
  "context_sha256",
  "qa_report_sha256",
  "qa_findings_sha256",
] as const;
function invalid(message: string): never {
  throw new FoundryContextError("quality_review_input_invalid", message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Quality review input requires complete objects.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Quality review input has missing or unsupported fields.");
}
function validTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function validPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= 4096 &&
    !/[\0\r\n]/u.test(value)
  );
}
export function parseFoundryQualityReviewInput(value: unknown): FoundryQualityReviewInput {
  const data = record(value);
  exact(data, [
    "schema",
    "binding",
    ...hashKeys,
    "reference_inputs_sha256",
    "interaction_context_sha256",
    "expected_previous_sha256",
    "issued_at_utc",
    "expires_at_utc",
    "reviews",
    "evidence",
  ]);
  const binding = record(data.binding);
  exact(binding, bindingKeys);
  if (
    data.schema !== FOUNDRY_QUALITY_REVIEW_INPUT_SCHEMA ||
    bindingKeys.some(
      (key) =>
        typeof binding[key] !== "string" ||
        !(key.endsWith("_sha256") ? sha : identifier).test(binding[key]),
    ) ||
    !/^task-[0-9a-f]{64}-r[0-9]{4}$/u.test(String(binding.task_id)) ||
    hashKeys.some((key) => typeof data[key] !== "string" || !sha.test(data[key])) ||
    [
      data.reference_inputs_sha256,
      data.interaction_context_sha256,
      data.expected_previous_sha256,
    ].some((hash) => hash !== null && (typeof hash !== "string" || !sha.test(hash))) ||
    !validTime(data.issued_at_utc) ||
    !validTime(data.expires_at_utc) ||
    !Array.isArray(data.reviews) ||
    !data.reviews.length ||
    data.reviews.length > 128 ||
    !Array.isArray(data.evidence) ||
    !data.evidence.length ||
    data.evidence.length > 100
  )
    invalid("Quality review scope, hashes, timestamps or bounded lists are invalid.");
  const lifetime = Date.parse(data.expires_at_utc) - Date.parse(data.issued_at_utc);
  if (lifetime <= 0 || lifetime > 24 * 60 * 60 * 1000)
    invalid("Quality review validity must be a positive interval of at most 24 hours.");
  const evidence = data.evidence.map((raw): FoundryQualityReviewEvidence => {
    const item = record(raw);
    exact(item, ["id", "kind", "file", "sha256"]);
    if (
      typeof item.id !== "string" ||
      !identifier.test(item.id) ||
      (item.kind !== "user-decision" && item.kind !== "source-model") ||
      !validPath(item.file) ||
      typeof item.sha256 !== "string" ||
      !sha.test(item.sha256)
    )
      invalid("Quality review evidence selection is invalid.");
    return Object.freeze({ id: item.id, kind: item.kind, file: item.file, sha256: item.sha256 });
  });
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  if (evidenceById.size !== evidence.length) invalid("Quality review evidence ids must be unique.");
  const used = new Set<string>();
  const reviews = data.reviews.map((raw): FoundryQualityReview => {
    const item = record(raw);
    exact(item, [
      "row_index",
      "id",
      "version",
      "payload_sha256",
      "finding_sha256",
      "code",
      "evidence_ids",
      "rationale",
    ]);
    if (
      typeof item.row_index !== "number" ||
      !Number.isSafeInteger(item.row_index) ||
      item.row_index < 0 ||
      typeof item.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(item.id) ||
      typeof item.version !== "string" ||
      !/^[0-9]{2}\.[0-9]{2}\.[0-9]{3}$/u.test(item.version) ||
      typeof item.payload_sha256 !== "string" ||
      !sha.test(item.payload_sha256) ||
      typeof item.finding_sha256 !== "string" ||
      !sha.test(item.finding_sha256) ||
      item.code !== "process_material_balance_deviation" ||
      !Array.isArray(item.evidence_ids) ||
      !item.evidence_ids.length ||
      item.evidence_ids.length > 100 ||
      item.evidence_ids.some((id) => typeof id !== "string" || !identifier.test(id)) ||
      new Set(item.evidence_ids).size !== item.evidence_ids.length ||
      typeof item.rationale !== "string" ||
      !item.rationale.trim() ||
      item.rationale.length > 8192
    )
      invalid("Quality review row, finding or rationale is invalid.");
    const ids = item.evidence_ids as string[];
    const kinds = new Set(
      ids.map((id) => {
        const selected = evidenceById.get(id);
        if (!selected) invalid("Every quality review evidence id must resolve.");
        used.add(id);
        return selected.kind;
      }),
    );
    if (!kinds.has("user-decision") || !kinds.has("source-model"))
      invalid("Every quality review requires user-decision and source-model evidence.");
    return Object.freeze({
      row_index: item.row_index,
      id: item.id,
      version: item.version,
      payload_sha256: item.payload_sha256,
      finding_sha256: item.finding_sha256,
      code: item.code,
      evidence_ids: Object.freeze([...ids]),
      rationale: item.rationale,
    });
  });
  if (
    used.size !== evidence.length ||
    new Set(reviews.map((item) => item.row_index)).size !== reviews.length ||
    new Set(reviews.map((item) => `${item.id}/${item.version}`)).size !== reviews.length ||
    new Set(reviews.map((item) => item.finding_sha256)).size !== reviews.length
  )
    invalid(
      "Quality reviews cannot duplicate rows, identities or findings, or select unused evidence.",
    );
  return Object.freeze({
    schema: FOUNDRY_QUALITY_REVIEW_INPUT_SCHEMA,
    binding: Object.freeze({ ...binding }) as Readonly<TaskAuthorizationBinding>,
    runtime_qualification_sha256: data.runtime_qualification_sha256 as string,
    rows_manifest_sha256: data.rows_manifest_sha256 as string,
    assessment_sha256: data.assessment_sha256 as string,
    context_sha256: data.context_sha256 as string,
    reference_inputs_sha256: data.reference_inputs_sha256 as string | null,
    interaction_context_sha256: data.interaction_context_sha256 as string | null,
    qa_report_sha256: data.qa_report_sha256 as string,
    qa_findings_sha256: data.qa_findings_sha256 as string,
    expected_previous_sha256: data.expected_previous_sha256 as string | null,
    issued_at_utc: data.issued_at_utc,
    expires_at_utc: data.expires_at_utc,
    reviews: Object.freeze(reviews),
    evidence: Object.freeze(evidence),
  });
}
function strictText(fact: FoundryInputFact): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readSelectedSemanticBytes(fact));
  } catch {
    return invalid("Quality review input must retain exact strict UTF-8 bytes.");
  }
}

/** Expand only explicit completed decisions; file facts are captured by the owning caller. */
export function materializeFoundryQualityReviewInput(
  value: unknown,
  captureEvidence: (file: string) => FoundryInputFact,
): FoundryQualityReviewInput {
  const data = record(value);
  if (data.schema !== FOUNDRY_QUALITY_REVIEW_DRAFT_SCHEMA)
    return parseFoundryQualityReviewInput(data);
  if (
    !Array.isArray(data.reviews) ||
    !data.reviews.length ||
    data.reviews.length > 128 ||
    !Array.isArray(data.evidence) ||
    !data.evidence.length ||
    data.evidence.length > 100
  )
    invalid("Complete the selected review decisions and evidence before submission.");
  const reviews = data.reviews.map((raw) => {
    const review = record(raw);
    if (review.disposition !== "accept-interpretation")
      invalid("Each selected review requires an explicit accept-interpretation decision.");
    const { disposition: _disposition, ...decision } = review;
    return decision;
  });
  const evidence = data.evidence.map((raw) => {
    const entry = record(raw);
    exact(entry, ["id", "kind", "file"]);
    if (!validPath(entry.file)) invalid("Select the actual quality review evidence file.");
    return { ...entry, sha256: captureEvidence(entry.file).sha256 };
  });
  return parseFoundryQualityReviewInput({
    ...data,
    schema: FOUNDRY_QUALITY_REVIEW_INPUT_SCHEMA,
    reviews,
    evidence,
  });
}
export function selectFoundryQualityReviewInput(
  context: FoundryRuntimeContext,
  descriptorFile: string,
): SelectedFoundryQualityReviewInput {
  let total = 0;
  const captured = new Map<string, FoundryInputFact>();
  const capture = (name: string) => {
    if (!validPath(name)) invalid("Quality review input path is invalid.");
    const target = path.resolve(context.workspaceRoot, name);
    if (migrationCredentialPath(path.relative(context.workspaceRoot, target)))
      invalid("Credential paths cannot be quality review inputs.");
    assertNotFoundrySessionFile(target, context.accountIntent?.sessionReference);
    const previous = captured.get(target);
    if (previous) {
      readSelectedSemanticBytes(previous);
      return previous;
    }
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      invalid("Quality review inputs must be bounded regular files.");
    total += stat.size;
    if (total > 64 * 1024 * 1024) invalid("Quality review inputs exceed the 64 MiB batch limit.");
    const fact = Object.freeze(captureFoundryInput(target));
    captured.set(target, fact);
    return fact;
  };
  const descriptor = capture(descriptorFile);
  let spec: FoundryQualityReviewInput;
  try {
    spec = materializeFoundryQualityReviewInput(JSON.parse(strictText(descriptor)), capture);
  } catch {
    invalid("Select a complete supported quality review input descriptor.");
  }
  if (
    spec.binding.workspace_id !== context.workspaceId ||
    spec.binding.task_id !== context.taskId ||
    spec.binding.actor_id !== context.actorId ||
    !context.accountIntent ||
    spec.binding.project_ref !== context.accountIntent.projectRef ||
    spec.binding.user_id !== context.accountIntent.userId
  )
    invalid("Quality review selection belongs to another workspace, task, actor or account.");
  const evidence = spec.evidence.map((entry) => {
    const fact = capture(entry.file);
    if (fact.sha256 !== entry.sha256)
      invalid("Quality review evidence differs from the selected digest.");
    if (!strictText(fact).trim())
      invalid("Quality review evidence must contain the actual decision or source-model evidence.");
    return fact;
  });
  if (new Set([descriptor.path, ...evidence.map((fact) => fact.path)]).size !== evidence.length + 1)
    invalid("Select each quality review file only once.");
  const result = Object.freeze({ spec, descriptor, evidence: Object.freeze(evidence) });
  selections.add(result);
  return result;
}
export function assertSelectedFoundryQualityReviewInput(
  value: SelectedFoundryQualityReviewInput,
): void {
  if (!selections.has(value)) invalid("Quality review input must be selected by the current host.");
  for (const fact of [value.descriptor, ...value.evidence]) readSelectedSemanticBytes(fact);
}
