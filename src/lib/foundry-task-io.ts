import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
  type FoundryInputFact,
} from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import type {
  ArtifactEntry,
  ArtifactFact,
  FileReference,
  FoundryTaskJob,
  JsonRecord,
  Lane,
  OperationPlan,
  OperationReceipt,
  SourceManifest,
  TaskRegistration,
  TaskRuntimeIdentity,
} from "./foundry-task-types.ts";
export const shaPattern = /^[0-9a-f]{64}$/u;
export const maxDocumentBytes = 8 * 1024 * 1024;
export const maxIndexBytes = 64 * 1024 * 1024;

export function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}
export function object(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("task_document_invalid", "Task document must be a JSON object.");
  return value as JsonRecord;
}
export function exact(value: JsonRecord, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("task_document_invalid", "Task document has missing or unsupported fields.");
}
export function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
export function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function taskPath(context: FoundryRuntimeContext, relative: string): string {
  return resolveFoundryOutput(context, relative);
}
export function relative(context: FoundryRuntimeContext, file: string): string {
  return path.relative(context.taskRoot!, taskPath(context, file)).split(path.sep).join("/");
}
export function readTaskBytes(
  context: FoundryRuntimeContext,
  file: string,
  limit = maxDocumentBytes,
): Buffer {
  const target = taskPath(context, file);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    fail("task_document_invalid", "Task metadata must be a bounded regular file.");
  const content = fs.readFileSync(target);
  if (content.length > limit)
    fail("task_document_invalid", "Task metadata changed beyond its limit while reading.");
  return content;
}
export function readTaskJson(context: FoundryRuntimeContext, file: string): JsonRecord {
  try {
    return object(JSON.parse(readTaskBytes(context, file).toString("utf8")));
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("task_document_invalid", "Task metadata could not be read as complete JSON.");
  }
}
export function reference(value: unknown, expectedPath?: string): FileReference {
  const ref = object(value);
  exact(ref, ["path", "sha256"]);
  if (
    typeof ref.path !== "string" ||
    !ref.path ||
    path.isAbsolute(ref.path) ||
    ref.path.split(/[\\/]/u).includes("..") ||
    typeof ref.sha256 !== "string" ||
    !shaPattern.test(ref.sha256) ||
    (expectedPath && ref.path !== expectedPath)
  )
    fail(
      "task_reference_invalid",
      "Task metadata references must be exact contained content facts.",
    );
  return { path: ref.path, sha256: ref.sha256 };
}
export function facts(value: unknown): FoundryInputFact[] {
  if (!Array.isArray(value) || value.length > 100_000)
    fail("task_inputs_invalid", "Task input facts must be a bounded array.");
  const result = value.map((item) => {
    const fact = object(item);
    exact(fact, ["path", "bytes", "sha256"]);
    if (
      typeof fact.path !== "string" ||
      !fact.path ||
      typeof fact.bytes !== "number" ||
      !Number.isSafeInteger(fact.bytes) ||
      fact.bytes < 0 ||
      typeof fact.sha256 !== "string" ||
      !shaPattern.test(fact.sha256)
    )
      fail("task_inputs_invalid", "Task file facts require path, size and SHA-256.");
    return { path: fact.path, bytes: fact.bytes, sha256: fact.sha256 };
  });
  if (new Set(result.map((fact) => fact.path)).size !== result.length)
    fail("task_inputs_invalid", "Task file facts must be unique.");
  return result;
}
export function sameFact(left: FoundryInputFact, right: FoundryInputFact): boolean {
  return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function isLane(value: unknown): value is Lane {
  return (
    value === "external-dataset-curated-import" ||
    value === "source-evidence-dataset-development" ||
    value === "existing-owner-draft-repair"
  );
}

export function parseTaskRuntimeIdentity(value: unknown): TaskRuntimeIdentity {
  const item = object(value);
  exact(item, ["package_name", "package_version", "manifest_sha256", "entry_sha256"]);
  if (
    typeof item.package_name !== "string" ||
    typeof item.package_version !== "string" ||
    typeof item.manifest_sha256 !== "string" ||
    typeof item.entry_sha256 !== "string"
  )
    fail("task_document_invalid", "Task runtime identity is malformed.");
  return {
    package_name: item.package_name,
    package_version: item.package_version,
    manifest_sha256: item.manifest_sha256,
    entry_sha256: item.entry_sha256,
  };
}

function parseTaskRepair(value: unknown): NonNullable<FoundryTaskJob["repair"]> {
  const item = object(value);
  if (
    typeof item.kind !== "string" ||
    typeof item.contract !== "string" ||
    typeof item.before !== "string" ||
    typeof item.candidate !== "string" ||
    (item.scientific !== undefined && typeof item.scientific !== "string")
  )
    fail("task_document_invalid", "Task repair metadata is malformed.");
  let predecessor: { readonly task_id: string; readonly receipt_sha256: string } | null = null;
  if (item.predecessor !== null) {
    const pred = object(item.predecessor);
    if (typeof pred.task_id !== "string" || typeof pred.receipt_sha256 !== "string")
      fail("task_document_invalid", "Task repair predecessor metadata is malformed.");
    predecessor = { task_id: pred.task_id, receipt_sha256: pred.receipt_sha256 };
  }
  return {
    kind: item.kind,
    contract: item.contract,
    before: item.before,
    candidate: item.candidate,
    ...(item.scientific !== undefined ? { scientific: item.scientific } : {}),
    predecessor,
  };
}

export function parseTaskJob(raw: JsonRecord): FoundryTaskJob {
  if (raw.schema !== "tiangong-foundry.job.v2")
    fail("legacy_task_requires_migration", "Existing task schema must be migrated explicitly.");
  if (
    typeof raw.workspace_id !== "string" ||
    typeof raw.task_id !== "string" ||
    typeof raw.actor_id !== "string" ||
    typeof raw.request_id !== "string" ||
    !raw.request_id ||
    !isLane(raw.lane) ||
    typeof raw.target_profile !== "string" ||
    !Array.isArray(raw.target_entities) ||
    !raw.target_entities.length ||
    raw.target_entities.some((kind) => typeof kind !== "string") ||
    !timestamp(raw.created_at_utc)
  )
    fail("task_document_invalid", "Task job metadata is malformed.");
  const writePolicy = object(raw.write_policy);
  if (writePolicy.mode !== "dry-run" || writePolicy.remote_state_code !== 0)
    fail("task_write_policy_invalid", "Task metadata cannot grant remote write authority.");
  return {
    schema: "tiangong-foundry.job.v2",
    workspace_id: raw.workspace_id,
    task_id: raw.task_id,
    actor_id: raw.actor_id,
    request_id: raw.request_id,
    lane: raw.lane,
    target_profile: raw.target_profile,
    target_entities: raw.target_entities.filter((kind): kind is string => typeof kind === "string"),
    source_manifest: reference(raw.source_manifest, "source-manifest.json"),
    profile_lock: reference(raw.profile_lock, "profile-lock.json"),
    seed_manifest:
      raw.seed_manifest === null ? null : reference(raw.seed_manifest, "seed-manifest.json"),
    runtime_identity: parseTaskRuntimeIdentity(raw.runtime_identity),
    write_policy: { mode: "dry-run", remote_state_code: 0 },
    created_at_utc: raw.created_at_utc,
    ...(Object.hasOwn(raw, "repair") ? { repair: parseTaskRepair(raw.repair) } : {}),
  };
}

export function parseSourceManifest(value: unknown): SourceManifest {
  const source = object(value);
  exact(source, ["schema", "workspace_id", "task_id", "source_kind", "source_paths"]);
  if (
    source.schema !== "tiangong-foundry.source-manifest.v2" ||
    typeof source.workspace_id !== "string" ||
    typeof source.task_id !== "string" ||
    source.source_kind !== "selected-local-files"
  )
    fail("task_source_invalid", "Source manifest does not match this task.");
  return {
    schema: "tiangong-foundry.source-manifest.v2",
    workspace_id: source.workspace_id,
    task_id: source.task_id,
    source_kind: "selected-local-files",
    source_paths: facts(source.source_paths),
  };
}

export function parseTaskRegistration(value: JsonRecord): TaskRegistration {
  if (
    value.schema !== "tiangong-foundry.task-registration.v1" ||
    typeof value.registration_sha256 !== "string"
  )
    fail("task_registration_invalid", "Task registration content changed.");
  return {
    schema: "tiangong-foundry.task-registration.v1",
    job: parseTaskJob(object(value.job)),
    source_manifest: parseSourceManifest(value.source_manifest),
    profile_lock: object(value.profile_lock),
    seed_manifest: value.seed_manifest === null ? null : object(value.seed_manifest),
    registration_sha256: value.registration_sha256,
  };
}

export function parseArtifactIndexEntry(
  context: FoundryRuntimeContext,
  line: string,
  sequence: number,
  previousSha256: string | null,
): ArtifactEntry {
  let entry: JsonRecord;
  try {
    entry = object(JSON.parse(line));
  } catch {
    fail("task_index_invalid", "Artifact index contains incomplete JSON.");
  }
  exact(entry, [
    "schema",
    "sequence",
    "previous_sha256",
    "operation_id",
    "command",
    "input_scope_sha256",
    "receipt",
    "path",
    "bytes",
    "sha256",
    "record_sha256",
  ]);
  const { record_sha256: recorded, ...unsigned } = entry;
  if (
    entry.schema !== "tiangong-foundry.artifact-index.v2" ||
    entry.sequence !== sequence ||
    entry.previous_sha256 !== previousSha256 ||
    typeof recorded !== "string" ||
    recorded !== sha256Json(unsigned) ||
    typeof entry.operation_id !== "string" ||
    !shaPattern.test(entry.operation_id) ||
    typeof entry.command !== "string" ||
    typeof entry.input_scope_sha256 !== "string" ||
    !shaPattern.test(entry.input_scope_sha256)
  )
    fail("task_index_invalid", "Artifact index sequence or content binding changed.");
  const fact = facts([{ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }])[0];
  if (
    path.isAbsolute(fact.path) ||
    fact.path.includes("\\") ||
    fact.path.split("/").some((part) => part === ".." || part === "." || !part)
  )
    fail("task_index_invalid", "Artifact index paths must be task-relative.");
  taskPath(context, fact.path);
  return {
    schema: "tiangong-foundry.artifact-index.v2",
    sequence,
    previous_sha256: previousSha256,
    operation_id: entry.operation_id,
    command: entry.command,
    input_scope_sha256: entry.input_scope_sha256,
    receipt: reference(entry.receipt),
    path: fact.path,
    bytes: fact.bytes,
    sha256: fact.sha256,
    record_sha256: recorded,
  };
}

export function buildOperationPlan(params: {
  operationId: string;
  jobSha256: string;
  command: string;
  optionsSha256: string;
  inputScopeSha256: string;
  inputs: FoundryInputFact[];
  createdAtUtc: string;
}): OperationPlan {
  return {
    schema: "tiangong-foundry.operation-plan.v1",
    operation_id: params.operationId,
    job_sha256: params.jobSha256,
    command: params.command,
    options_sha256: params.optionsSha256,
    input_scope_sha256: params.inputScopeSha256,
    inputs: params.inputs,
    created_at_utc: params.createdAtUtc,
  };
}

export function buildOperationReceipt(params: {
  plan: FileReference;
  jobSha256: string;
  outputs: ArtifactFact[];
  result: FileReference;
}): OperationReceipt {
  return {
    schema: "tiangong-foundry.operation-receipt.v1",
    mode: "deterministic-local",
    status: "completed",
    plan: params.plan,
    job_sha256: params.jobSha256,
    outputs: params.outputs,
    result: params.result,
  };
}
