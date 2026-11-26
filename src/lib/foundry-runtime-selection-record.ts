import fs from "node:fs";
import { sha256Json } from "./identity-preflight-proof.ts";
import { transferFail, transferPath, transferRead } from "./foundry-migration-transfer-io.ts";
import { assertNotFoundrySessionFile } from "./foundry-private-path.ts";

export const FOUNDRY_RUNTIME_SELECTION_SCHEMA =
  "tiangong-foundry.workspace-runtime-selection.v1" as const;
export interface FoundryRuntimeSelectionRecord {
  readonly schema: typeof FOUNDRY_RUNTIME_SELECTION_SCHEMA;
  readonly workspace_id: string;
  readonly request_id: string;
  readonly actor_id: string;
  readonly previous_manifest_sha256: string;
  readonly selected_manifest_sha256: string;
  readonly access: "read" | "write";
  readonly lease_ids: readonly string[];
  readonly record_sha256: string;
}
export function readFoundryRuntimeSelection(
  controlRoot: string,
  workspaceId: string,
  sessionReference?: string,
): { value: FoundryRuntimeSelectionRecord; bytes: Buffer } | null {
  const file = transferPath(controlRoot, "state/runtime-selection.json");
  if (!fs.existsSync(file)) return null;
  assertNotFoundrySessionFile(file, sessionReference);
  const bytes = transferRead(file, 64 * 1024);
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    transferFail("runtime_selection_invalid", "Runtime selection must remain a complete record.");
  const item = value as Record<string, unknown>;
  const { record_sha256: digest, ...body } = item;
  const access = item.access;
  if (
    Object.keys(item).length !== 9 ||
    item.schema !== FOUNDRY_RUNTIME_SELECTION_SCHEMA ||
    item.workspace_id !== workspaceId ||
    typeof item.request_id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(item.request_id) ||
    typeof item.actor_id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(item.actor_id) ||
    typeof item.previous_manifest_sha256 !== "string" ||
    typeof item.selected_manifest_sha256 !== "string" ||
    typeof digest !== "string" ||
    ![item.previous_manifest_sha256, item.selected_manifest_sha256, digest].every((entry) =>
      /^[0-9a-f]{64}$/u.test(entry),
    ) ||
    (access !== "read" && access !== "write") ||
    !Array.isArray(item.lease_ids) ||
    item.lease_ids.length !== 2 ||
    item.lease_ids.some((id) => typeof id !== "string" || id.length > 256) ||
    digest !== sha256Json(body)
  )
    transferFail("runtime_selection_invalid", "Runtime selection identity or digest changed.");
  const leaseIds = item.lease_ids.filter((id): id is string => typeof id === "string");
  return {
    value: {
      schema: FOUNDRY_RUNTIME_SELECTION_SCHEMA,
      workspace_id: workspaceId,
      request_id: item.request_id,
      actor_id: item.actor_id,
      previous_manifest_sha256: item.previous_manifest_sha256,
      selected_manifest_sha256: item.selected_manifest_sha256,
      access,
      lease_ids: leaseIds,
      record_sha256: digest,
    },
    bytes,
  };
}
