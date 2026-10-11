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
import { sha256Json } from "./identity-preflight-proof.ts";

export const FOUNDRY_IDENTITY_STAGE_INPUT_SCHEMA =
  "tiangong-foundry.identity-stage-input.v1" as const;
export interface FoundryIdentityStageTarget {
  readonly dataset_type: "flow" | "process";
  readonly dataset_id: string;
  readonly dataset_version: string;
  readonly source_row_sha256: string;
}
export interface FoundryIdentityStageInput {
  readonly schema: typeof FOUNDRY_IDENTITY_STAGE_INPUT_SCHEMA;
  readonly intent_id: string;
  readonly task_id: string;
  readonly actor_id: string;
  readonly rows_report_sha256: string;
  readonly predecessor_identity_sha256: string;
  readonly targets: readonly FoundryIdentityStageTarget[];
}
export interface SelectedFoundryIdentityStageInput {
  readonly descriptor: FoundryInputFact;
  readonly value: FoundryIdentityStageInput;
}
const selectedInputs = new WeakMap<object, string>();
const sha = /^[0-9a-f]{64}$/u;
const token = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
function invalid(message: string): never {
  throw new FoundryContextError("identity_stage_input_invalid", message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Explicit identity stage input must be an object.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid("Explicit identity stage has missing or unsupported fields.");
}
export function parseFoundryIdentityStageInput(value: unknown): FoundryIdentityStageInput {
  const data = record(value);
  exact(data, [
    "schema",
    "intent_id",
    "task_id",
    "actor_id",
    "rows_report_sha256",
    "predecessor_identity_sha256",
    "targets",
  ]);
  if (
    data.schema !== FOUNDRY_IDENTITY_STAGE_INPUT_SCHEMA ||
    typeof data.intent_id !== "string" ||
    !token.test(data.intent_id) ||
    typeof data.task_id !== "string" ||
    !/^task-[0-9a-f]{64}-r[0-9]{4}$/u.test(data.task_id) ||
    typeof data.actor_id !== "string" ||
    !token.test(data.actor_id) ||
    typeof data.rows_report_sha256 !== "string" ||
    !sha.test(data.rows_report_sha256) ||
    typeof data.predecessor_identity_sha256 !== "string" ||
    !sha.test(data.predecessor_identity_sha256) ||
    !Array.isArray(data.targets) ||
    !data.targets.length ||
    data.targets.length > 64
  )
    invalid(
      "Explicit identity stage needs one stable intent, original task/actor and bounded exact roster.",
    );
  const targets = data.targets.map((raw) => {
    const item = record(raw);
    exact(item, ["dataset_type", "dataset_id", "dataset_version", "source_row_sha256"]);
    if (
      (item.dataset_type !== "flow" && item.dataset_type !== "process") ||
      typeof item.dataset_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(item.dataset_id) ||
      typeof item.dataset_version !== "string" ||
      !/^[0-9]{2}\.[0-9]{2}\.[0-9]{3}$/u.test(item.dataset_version) ||
      typeof item.source_row_sha256 !== "string" ||
      !sha.test(item.source_row_sha256)
    )
      invalid(
        "Readonly identity targets must select exact Flow/Process identities and unchanged registered row hashes.",
      );
    return Object.freeze({
      dataset_type: item.dataset_type,
      dataset_id: item.dataset_id,
      dataset_version: item.dataset_version,
      source_row_sha256: item.source_row_sha256,
    });
  });
  if (
    new Set(
      targets.map((item) => `${item.dataset_type}:${item.dataset_id}:${item.dataset_version}`),
    ).size !== targets.length
  )
    invalid("Explicit identity stage target roster contains duplicates.");
  return Object.freeze({
    schema: FOUNDRY_IDENTITY_STAGE_INPUT_SCHEMA,
    intent_id: data.intent_id,
    task_id: data.task_id,
    actor_id: data.actor_id,
    rows_report_sha256: data.rows_report_sha256,
    predecessor_identity_sha256: data.predecessor_identity_sha256,
    targets: Object.freeze(targets),
  });
}
function contextBinding(context: FoundryRuntimeContext) {
  return sha256Json({
    workspace: context.workspaceId,
    task: context.taskId,
    actor: context.actorId,
    project: context.accountIntent?.projectRef ?? null,
    user: context.accountIntent?.userId ?? null,
  });
}
export function selectFoundryIdentityStageInput(
  context: FoundryRuntimeContext,
  file: string,
): SelectedFoundryIdentityStageInput {
  if (!file || file.length > 4096 || /[\0\r\n]/u.test(file))
    invalid("Explicit identity input path is invalid.");
  const target = path.resolve(context.workspaceRoot, file);
  if (migrationCredentialPath(path.relative(context.workspaceRoot, target)))
    invalid("Credential paths cannot select an identity stage.");
  assertNotFoundrySessionFile(target, context.accountIntent?.sessionReference);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    invalid("Explicit identity input must select an existing regular file.");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    invalid("Explicit identity input must be a bounded regular file.");
  const descriptor = Object.freeze(captureFoundryInput(target));
  let value: FoundryIdentityStageInput;
  try {
    value = parseFoundryIdentityStageInput(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(readSelectedSemanticBytes(descriptor)),
      ),
    );
  } catch {
    invalid("Select a complete supported explicit identity-stage input.");
  }
  if (value.task_id !== context.taskId || value.actor_id !== context.actorId)
    invalid("Explicit identity input belongs to another task or actor.");
  const selected = Object.freeze({ descriptor, value });
  selectedInputs.set(selected, contextBinding(context));
  return selected;
}
export function assertSelectedFoundryIdentityStageInput(
  context: FoundryRuntimeContext,
  selected: SelectedFoundryIdentityStageInput,
): void {
  if (!selectedInputs.has(selected) || selectedInputs.get(selected) !== contextBinding(context))
    invalid(
      "Explicit identity intent requires the independently selected current task/account context.",
    );
  readSelectedSemanticBytes(selected.descriptor);
}
