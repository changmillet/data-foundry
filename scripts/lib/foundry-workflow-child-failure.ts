import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SpawnSyncReturns } from "node:child_process";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import {
  bytes,
  digest,
  exact,
  facts,
  object,
  readTaskBytes,
  reference,
  shaPattern,
  timestamp,
} from "./foundry-task-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export const workflowFailureCommand = "dataset-workflow-failure";
export const workflowFailureFile = "workflow-child-failure.json";
const kinds = [
  "spawn_error",
  "signal",
  "exit_code",
  "empty_stdout",
  "malformed_json",
  "invalid_report",
  "stage_rejected",
];
export const workflowFailureArtifactLimit = 64 * 1024;
export const workflowFailurePreviewLimit = 4096;
const previewLimit = workflowFailurePreviewLimit;
const argvPreviewBudget = 16 * 1024;
const evidenceBudget = 48 * 1024;
const truncatableFields = [
  "invocation.argv",
  "stdout.preview",
  "stderr.preview",
  "child.error_message",
  "rejection.code",
  "rejection.message",
  "invocation.executable",
  "invocation.cli_path",
  "invocation.cwd",
];

function utf8Prefix(value: string, budget: number): string {
  let used = 0,
    end = 0;
  for (const character of value) {
    const length = Buffer.byteLength(character);
    if (used + length > budget) break;
    used += length;
    end += character.length;
  }
  return value.slice(0, end);
}
function renderPreview(value: string): { preview: string; truncated: boolean } {
  // Facts hash the complete stream, while display work never scans its unbounded tail.
  const prefix = utf8Prefix(value, previewLimit * 2);
  const clean = prefix
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (code >= 32 && code !== 127) || [9, 10, 13].includes(code);
    })
    .join("");
  const redact = (text: string) =>
    text
      .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted authorization]")
      .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*){0,2}/gu, "[redacted token]")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+(?:@|$)/giu, "$1[redacted]@")
      .replace(
        /(["']?(?:[a-z0-9_]*(?:token|secret|password|passwd|key|cookie|session|credential|auth)[a-z0-9_]*)["']?\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;}]+)/giu,
        "$1[redacted]",
      );
  const redacted = redact(clean);
  const preview = utf8Prefix(redacted, previewLimit);
  // Cropping can shorten a redaction placeholder; render that bounded suffix consistently.
  const renderedAgain = redact(preview);
  const rendered = utf8Prefix(renderedAgain, previewLimit);
  return {
    preview: rendered,
    truncated:
      prefix.length < value.length ||
      preview.length < redacted.length ||
      rendered.length < renderedAgain.length,
  };
}
function safePreview(value: string): string {
  return renderPreview(value).preview;
}
function diagnostic(value: string) {
  const raw = Buffer.from(value);
  const rendered = renderPreview(value);
  return {
    bytes: raw.length,
    sha256: digest(raw),
    preview: rendered.preview,
    truncated: raw.length > previewLimit || rendered.truncated,
  };
}
function previewArgv(argv: readonly string[]) {
  const preview: string[] = [];
  let cost = 2,
    truncated = false;
  for (const argument of argv) {
    const rendered = renderPreview(argument);
    const value = rendered.preview;
    // Include escaping, commas/newlines and more indentation than the final receipt uses.
    const nextCost = Buffer.byteLength(JSON.stringify(value)) + 16;
    if (cost + nextCost > argvPreviewBudget) {
      truncated = true;
      break;
    }
    cost += nextCost;
    preview.push(value);
    if (Buffer.byteLength(argument) > previewLimit || rendered.truncated) truncated = true;
  }
  return { argv: Object.freeze(preview), argv_count: argv.length, argv_truncated: truncated };
}
function boundFailureRecord(record: Record<string, unknown>, limit: number): Buffer {
  const failure = object(record.failure),
    invocation = object(failure.invocation);
  const truncated = new Set(
    Array.isArray(failure.truncated_fields) ? failure.truncated_fields.map(String) : [],
  );
  const sources = object(failure.preview_sources);
  let content = bytes(record);
  const mark = (field: string) => {
    truncated.add(field);
    failure.truncated_fields = [...truncated];
  };
  const argv = Array.isArray(invocation.argv) ? [...invocation.argv] : [];
  while (content.length > limit && argv.length) {
    argv.splice(Math.floor(argv.length / 2));
    invocation.argv = [...argv];
    invocation.argv_truncated = true;
    mark("invocation.argv");
    content = bytes(record);
  }
  for (const field of truncatableFields.filter((field) => field !== "invocation.argv")) {
    if (content.length <= limit) break;
    const [owner, key] = field.split(".");
    if (failure[owner] === null) continue;
    const container = object(failure[owner]),
      original = container[key];
    if (typeof original !== "string") continue;
    if (!["stdout.preview", "stderr.preview"].includes(field) && !Object.hasOwn(sources, field))
      sources[field] = {
        bytes: Buffer.byteLength(original),
        sha256: digest(Buffer.from(original)),
      };
    let budget = Math.floor(Buffer.byteLength(original) / 2);
    do {
      const cropped = utf8Prefix(original, budget);
      container[key] = owner === "invocation" ? cropped : safePreview(cropped);
      mark(field);
      if (owner === "stdout" || owner === "stderr") container.truncated = true;
      content = bytes(record);
      budget = Math.floor(budget / 2);
    } while (content.length > limit && container[key] !== "");
  }
  if (content.length > limit)
    throw new FoundryContextError(
      "workflow_failure_limit",
      "The fixed task failure identity exceeds its bounded protocol.",
    );
  return content;
}
/** Bound the complete persisted wrapper, including JSON escaping, indentation and task fields. */
export function serializeWorkflowFailureResult(result: Record<string, unknown>): Buffer {
  const record = object(JSON.parse(bytes(result).toString("utf8")));
  return boundFailureRecord(record, workflowFailureArtifactLimit);
}
export class WorkflowChildFailure extends FoundryContextError {
  readonly evidence: Record<string, unknown>;
  retainedArtifact?: Readonly<{ path: string; bytes: number; sha256: string }>;
  constructor(evidence: Record<string, unknown>) {
    super(
      "workflow_child_failed",
      "The original local CLI call failed; its task-bound diagnostic receipt is retained and requires a reviewed task revision.",
    );
    this.evidence = evidence;
  }
}
export function bindWorkflowChildExecution(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  cliPath: string,
  argv: readonly string[],
  cwd = context.workspaceRoot,
  executable = process.execPath,
) {
  return Object.freeze({
    execution_id: randomUUID(),
    started_at_utc: new Date().toISOString(),
    invocation: Object.freeze({
      executable,
      executable_sha256: createHash("sha256").update(fs.readFileSync(executable)).digest("hex"),
      cli_path: cliPath,
      cli_sha256: createHash("sha256").update(fs.readFileSync(cliPath)).digest("hex"),
      ...previewArgv(argv),
      argv_sha256: sha256Json(argv),
      cwd,
      cwd_relative: path.relative(context.workspaceRoot, cwd),
      cwd_sha256: digest(Buffer.from(cwd)),
      qualification_sha256: qualified.qualification_sha256,
    }),
  });
}
export function workflowChildFailure(
  execution: ReturnType<typeof bindWorkflowChildExecution>,
  child: SpawnSyncReturns<string>,
  kind: string,
  rejection?: unknown,
): WorkflowChildFailure {
  const error = child.error;
  const evidence = {
    schema: "tiangong-foundry.workflow-child-failure.v1",
    ...execution,
    finished_at_utc: new Date().toISOString(),
    kind,
    truncated_fields: [] as string[],
    preview_sources: {} as Record<string, unknown>,
    rejection:
      rejection instanceof Error
        ? {
            code:
              "code" in rejection && typeof rejection.code === "string"
                ? safePreview(rejection.code)
                : null,
            message: safePreview(rejection.message),
          }
        : null,
    child: {
      pid: Number.isSafeInteger(child.pid) ? child.pid : null,
      exit_code: child.status,
      signal: child.signal,
      error_name: error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name) ? error.name : null,
      error_code:
        error &&
        "code" in error &&
        typeof error.code === "string" &&
        /^[A-Z0-9_]{1,64}$/u.test(error.code)
          ? error.code
          : null,
      error_message: error ? safePreview(error.message) : null,
    },
    stdout: diagnostic(child.stdout ?? ""),
    stderr: diagnostic(child.stderr ?? ""),
  };
  const sources = evidence.preview_sources;
  const note = (field: string, value: string) => {
    if (Buffer.byteLength(value) > previewLimit || renderPreview(value).truncated) {
      evidence.truncated_fields.push(field);
      sources[field] = { bytes: Buffer.byteLength(value), sha256: digest(Buffer.from(value)) };
    }
  };
  if (execution.invocation.argv_truncated) evidence.truncated_fields.push("invocation.argv");
  if (error) note("child.error_message", error.message);
  if (rejection instanceof Error) {
    note("rejection.message", rejection.message);
    if ("code" in rejection && typeof rejection.code === "string")
      note("rejection.code", rejection.code);
  }
  // Reserve space for the actual task wrapper; the writer additionally measures that wrapper.
  const bounded = boundFailureRecord(
    object(JSON.parse(bytes({ failure: evidence }).toString("utf8"))),
    evidenceBudget,
  );
  return new WorkflowChildFailure(object(object(JSON.parse(bounded.toString("utf8"))).failure));
}

/** Read-only proof of a failed local operation. Failure artifacts never enter producer lineage. */
export function readWorkflowChildFailure(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  const entry = entries.findLast((candidate) => candidate.command === workflowFailureCommand);
  if (!entry) return null;
  const invalid = (): never => {
    throw new FoundryContextError(
      "workflow_failure_receipt_invalid",
      "The original failed operation evidence is missing, changed or inconsistent; do not rerun it.",
    );
  };
  try {
    if (
      entry.path !== `evidence/failures/${entry.operation_id}/${workflowFailureFile}` ||
      entry.receipt.path !== `checkpoints/${entry.operation_id}.json`
    )
      invalid();
    const resultBytes = readTaskBytes(context, entry.path, workflowFailureArtifactLimit);
    if (resultBytes.length !== entry.bytes || digest(resultBytes) !== entry.sha256) invalid();
    const result = object(JSON.parse(resultBytes.toString("utf8")));
    exact(result, [
      "schema",
      "status",
      "task_id",
      "operation_id",
      "command",
      "input_scope_sha256",
      "failure",
    ]);
    if (
      result.schema !== "tiangong-foundry.workflow-operation-failure.v1" ||
      result.status !== "failed" ||
      result.task_id !== context.taskId ||
      result.operation_id !== entry.operation_id ||
      result.input_scope_sha256 !== entry.input_scope_sha256 ||
      typeof result.command !== "string"
    )
      invalid();
    const receiptBytes = readTaskBytes(context, entry.receipt.path);
    if (digest(receiptBytes) !== entry.receipt.sha256) invalid();
    const receipt = object(JSON.parse(receiptBytes.toString("utf8")));
    exact(receipt, ["schema", "mode", "status", "plan", "job_sha256", "outputs", "result"]);
    const output = facts(receipt.outputs);
    if (
      receipt.schema !== "tiangong-foundry.operation-receipt.v1" ||
      receipt.mode !== "deterministic-local" ||
      receipt.status !== "failed" ||
      output.length !== 1 ||
      output[0].path !== entry.path ||
      output[0].sha256 !== entry.sha256 ||
      output[0].bytes !== entry.bytes ||
      sha256Json(receipt.result) !== sha256Json({ path: entry.path, sha256: entry.sha256 })
    )
      invalid();
    const planRef = reference(receipt.plan),
      planBytes = readTaskBytes(context, planRef.path);
    if (
      planRef.path !== `checkpoints/${entry.operation_id}.plan.json` ||
      digest(planBytes) !== planRef.sha256
    )
      invalid();
    const plan = object(JSON.parse(planBytes.toString("utf8")));
    exact(plan, [
      "schema",
      "operation_id",
      "job_sha256",
      "command",
      "options_sha256",
      "input_scope_sha256",
      "inputs",
      "created_at_utc",
    ]);
    const inputs = facts(plan.inputs);
    const job = digest(readTaskBytes(context, "foundry-job.json"));
    if (
      plan.schema !== "tiangong-foundry.operation-plan.v1" ||
      plan.operation_id !== entry.operation_id ||
      plan.command !== result.command ||
      plan.job_sha256 !== job ||
      receipt.job_sha256 !== job ||
      sha256Json(inputs) !== entry.input_scope_sha256 ||
      plan.input_scope_sha256 !== entry.input_scope_sha256 ||
      !timestamp(plan.created_at_utc) ||
      sha256Json({
        job,
        command: plan.command,
        input_scope: entry.input_scope_sha256,
        options: plan.options_sha256,
      }) !== entry.operation_id
    )
      invalid();
    const failure = object(result.failure);
    exact(failure, [
      "schema",
      "execution_id",
      "started_at_utc",
      "finished_at_utc",
      "kind",
      "truncated_fields",
      "preview_sources",
      "rejection",
      "invocation",
      "child",
      "stdout",
      "stderr",
    ]);
    if (failure.rejection !== null) {
      const rejection = object(failure.rejection);
      exact(rejection, ["code", "message"]);
      if (
        !(
          rejection.code === null ||
          (typeof rejection.code === "string" &&
            Buffer.byteLength(rejection.code) <= previewLimit &&
            safePreview(rejection.code) === rejection.code)
        ) ||
        typeof rejection.message !== "string" ||
        Buffer.byteLength(rejection.message) > previewLimit ||
        safePreview(rejection.message) !== rejection.message
      )
        invalid();
    }
    const invocation = object(failure.invocation),
      child = object(failure.child);
    exact(invocation, [
      "executable",
      "executable_sha256",
      "cli_path",
      "cli_sha256",
      "argv",
      "argv_count",
      "argv_truncated",
      "argv_sha256",
      "cwd",
      "cwd_relative",
      "cwd_sha256",
      "qualification_sha256",
    ]);
    exact(child, ["pid", "exit_code", "signal", "error_name", "error_code", "error_message"]);
    if (
      !Array.isArray(failure.truncated_fields) ||
      failure.truncated_fields.some(
        (field) => typeof field !== "string" || !truncatableFields.includes(field),
      )
    )
      invalid();
    const truncatedFields = Array.isArray(failure.truncated_fields)
      ? failure.truncated_fields
      : invalid();
    const sources = object(failure.preview_sources);
    for (const [field, value] of Object.entries(sources)) {
      if (!truncatableFields.includes(field)) invalid();
      const source = object(value);
      exact(source, ["bytes", "sha256"]);
      if (
        !Number.isSafeInteger(source.bytes) ||
        Number(source.bytes) < 0 ||
        typeof source.sha256 !== "string" ||
        !shaPattern.test(source.sha256)
      )
        invalid();
    }
    const cwdRelative =
      typeof invocation.cwd_relative === "string" ? invocation.cwd_relative : invalid();
    if (
      typeof invocation.cwd !== "string" ||
      typeof invocation.cwd_sha256 !== "string" ||
      !shaPattern.test(invocation.cwd_sha256)
    )
      invalid();
    const cwd = path.resolve(context.workspaceRoot, cwdRelative);
    if (
      digest(Buffer.from(cwd)) !== invocation.cwd_sha256 ||
      (!truncatedFields.includes("invocation.cwd") && invocation.cwd !== cwd)
    )
      invalid();
    if (cwd !== context.workspaceRoot) {
      const relative = path.relative(context.tempRoot, resolveFoundryOutput(context, cwd));
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        invalid();
    }
    if (
      failure.schema !== "tiangong-foundry.workflow-child-failure.v1" ||
      typeof failure.kind !== "string" ||
      !kinds.includes(failure.kind) ||
      typeof failure.execution_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        failure.execution_id,
      ) ||
      !timestamp(failure.started_at_utc) ||
      !timestamp(failure.finished_at_utc) ||
      !Number.isSafeInteger(invocation.argv_count) ||
      Number(invocation.argv_count) < 0 ||
      typeof invocation.argv_truncated !== "boolean" ||
      !Array.isArray(invocation.argv) ||
      Number(invocation.argv_count) < invocation.argv.length ||
      (Number(invocation.argv_count) > invocation.argv.length && !invocation.argv_truncated) ||
      invocation.argv.some(
        (arg) => typeof arg !== "string" || Buffer.byteLength(arg) > previewLimit,
      ) ||
      ![child.signal, child.error_name, child.error_code, child.error_message].every(
        (value) =>
          value === null ||
          (typeof value === "string" &&
            Buffer.byteLength(value) <= previewLimit &&
            safePreview(value) === value),
      ) ||
      (failure.kind === "signal" && child.signal === null) ||
      (failure.kind === "spawn_error" && child.error_message === null) ||
      typeof invocation.cli_path !== "string" ||
      typeof invocation.executable !== "string" ||
      ![
        invocation.argv_sha256,
        invocation.cli_sha256,
        invocation.executable_sha256,
        invocation.qualification_sha256,
      ].every((hash) => typeof hash === "string" && shaPattern.test(hash)) ||
      ![child.pid, child.exit_code].every((value) => value === null || Number.isSafeInteger(value))
    )
      invalid();
    for (const name of ["stdout", "stderr"]) {
      const detail = object(failure[name]);
      exact(detail, ["bytes", "sha256", "preview", "truncated"]);
      if (
        !Number.isSafeInteger(detail.bytes) ||
        Number(detail.bytes) < 0 ||
        typeof detail.sha256 !== "string" ||
        !shaPattern.test(detail.sha256) ||
        typeof detail.preview !== "string" ||
        Buffer.byteLength(detail.preview) > previewLimit ||
        safePreview(detail.preview) !== detail.preview ||
        typeof detail.truncated !== "boolean"
      )
        invalid();
    }
    return { entry, result, failure };
  } catch {
    return invalid();
  }
}
