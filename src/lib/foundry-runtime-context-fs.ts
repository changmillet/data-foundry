import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertWorkspaceCompatibility } from "@tiangong-lca/cli/runtime";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import {
  FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
  FOUNDRY_MIGRATED_WORKSPACE_FEATURES,
} from "./foundry-migration-authority.ts";
import { assertNotFoundrySessionFile } from "./foundry-private-path.ts";
import type { FoundryInputFact, FoundryWorkspaceAccess } from "./foundry-runtime-context-types.ts";

export const workspaceSchema = "tiangong-foundry.workspace.v1";
export const hashPattern = /^[0-9a-f]{64}$/u;
export const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

export function verifyWorkspaceAccess(
  selection: FoundryWorkspaceAccess,
  version: string,
  schema: string,
  features: readonly string[],
): void {
  if (selection.access !== "read" && selection.access !== "write")
    fail("workspace_access_invalid", "Workspace access must be read or write.");
  try {
    assertWorkspaceCompatibility(selection.manifest, { schema, features }, selection.access);
  } catch {
    fail(
      "workspace_runtime_incompatible",
      "Supply an independently trusted runtime manifest that supports the requested workspace access.",
    );
  }
  if (
    selection.manifest.manifest.product.id !== "tiangong-foundry" ||
    (selection.access === "write" && selection.manifest.manifest.product.version !== version)
  )
    fail(
      "workspace_runtime_incompatible",
      "Write compatibility must qualify the executing Foundry version.",
    );
  if (
    selection.access === "write" &&
    features.some((feature) => !FOUNDRY_MIGRATED_WORKSPACE_FEATURES.includes(feature))
  )
    fail(
      "workspace_feature_unsupported",
      "This writer cannot preserve an unknown required workspace feature.",
    );
}

export function migratedMarker(value: Record<string, unknown>): {
  features: readonly string[];
  migration: Readonly<{ plan_sha256: string; activation_sha256: string }>;
} {
  const migration = value.migration as Record<string, unknown> | null;
  const features = value.required_features;
  if (
    value.layout_version !== 2 ||
    Object.keys(value).length !== 7 ||
    typeof value.workspace_id !== "string" ||
    !uuidPattern.test(value.workspace_id) ||
    typeof value.created_at_utc !== "string" ||
    !Number.isFinite(Date.parse(value.created_at_utc)) ||
    new Date(value.created_at_utc).toISOString() !== value.created_at_utc ||
    !Array.isArray(features) ||
    features.length > 64 ||
    features.some(
      (feature) => typeof feature !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(feature),
    ) ||
    new Set(features).size !== features.length ||
    FOUNDRY_MIGRATED_WORKSPACE_FEATURES.some((feature) => !features.includes(feature)) ||
    !migration ||
    typeof migration !== "object" ||
    Array.isArray(migration) ||
    Object.keys(migration).length !== 2 ||
    typeof migration.plan_sha256 !== "string" ||
    !hashPattern.test(migration.plan_sha256) ||
    typeof migration.activation_sha256 !== "string" ||
    !hashPattern.test(migration.activation_sha256) ||
    !value.extensions ||
    typeof value.extensions !== "object" ||
    Array.isArray(value.extensions)
  )
    fail(
      "workspace_version_unsupported",
      "Migrated workspace marker is incomplete or unsupported.",
    );
  return {
    features: Object.freeze([...features] as string[]),
    migration: Object.freeze({
      plan_sha256: migration.plan_sha256,
      activation_sha256: migration.activation_sha256,
    }),
  };
}

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

export function canonicalFuturePath(value: string): string {
  const missing: string[] = [];
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current)
      fail("path_missing", "No existing parent directory for the requested root.");
    missing.unshift(path.basename(current));
    current = parent;
  }
  const real = fs.realpathSync(current);
  if (!fs.statSync(real).isDirectory() && missing.length > 0)
    fail("root_not_directory", "A runtime root parent must be a directory.");
  return path.join(real, ...missing);
}

export function regularFile(filePath: string): fs.Stats {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    fail("regular_file_required", "Runtime input must be a regular, non-symlink file.");
  return stat;
}

/** Check every existing descendant before any mutation; never follow an output symlink. */
export function confined(root: string, requested: string): string {
  const target = path.resolve(requested);
  if (!inside(root, target))
    fail("path_outside_root", "The requested path is outside its declared runtime root.");
  let current = root;
  for (const segment of ["", ...path.relative(root, target).split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink())
        fail("symlink_not_allowed", "Runtime state and output paths cannot traverse symlinks.");
      if (current !== target && !stat.isDirectory())
        fail("root_not_directory", "Runtime path parent is not a directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

export function readWorkspaceId(workspaceRoot: string, sessionReference?: string): string | null {
  const file = confined(workspaceRoot, path.join(workspaceRoot, ".foundry", "workspace.json"));
  if (!fs.existsSync(file)) return null;
  assertNotFoundrySessionFile(file, sessionReference);
  if (regularFile(file).size > 64 * 1024)
    fail("workspace_invalid", "Workspace marker exceeds its size limit.");
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("workspace_invalid", "Workspace marker is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("workspace_invalid", "Workspace marker must be an object.");
  const marker = value as Record<string, unknown>;
  if (marker.schema === FOUNDRY_MIGRATED_WORKSPACE_SCHEMA) {
    migratedMarker(marker);
    return marker.workspace_id as string;
  }
  if (
    marker.schema === "tiangong-foundry.workspace-migration-pending.v1" &&
    Object.keys(marker).length === 2 &&
    typeof marker.plan_sha256 === "string" &&
    hashPattern.test(marker.plan_sha256)
  )
    return null;
  if (
    marker.schema !== workspaceSchema ||
    marker.layout_version !== 1 ||
    typeof marker.workspace_id !== "string" ||
    !uuidPattern.test(marker.workspace_id) ||
    typeof marker.created_at_utc !== "string" ||
    !Number.isFinite(Date.parse(marker.created_at_utc)) ||
    Object.keys(marker).length !== 4
  )
    fail(
      "workspace_version_unsupported",
      "Workspace marker is unknown or invalid; migration must be explicit.",
    );
  return marker.workspace_id;
}

export function supportedPlatform(platform: NodeJS.Platform, arch: string): string {
  const key = `${platform}-${arch}`;
  if (!["darwin-arm64", "linux-x64", "linux-arm64", "win32-x64"].includes(key)) {
    fail("platform_unsupported", "Foundry supports macOS arm64, Linux x64/arm64 and Windows x64.");
  }
  return key;
}

export function defaultCacheBase(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === "win32") return env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  if (platform === "darwin") return path.join(home, "Library", "Caches");
  return env.XDG_CACHE_HOME || path.join(home, ".cache");
}

export function discoverWorkspace(
  cwd: string,
  runtimeRoot: string,
  sessionReference?: string,
): string {
  let current = canonicalFuturePath(cwd);
  while (true) {
    if (!inside(runtimeRoot, current) && readWorkspaceId(current, sessionReference)) return current;
    const parent = path.dirname(current);
    if (parent === current)
      fail(
        "workspace_required",
        "Select a workspace with --workspace or run from an initialized project.",
      );
    current = parent;
  }
}

export function captureFoundryInput(filePath: string): FoundryInputFact {
  const absolute = path.resolve(filePath);
  if (/^\.env(?:\.|$)/iu.test(path.basename(absolute)))
    fail("credential_input_forbidden", "Credential storage is not a dataset input.");
  const before = regularFile(absolute);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev)
      fail("input_changed", "Input changed while it was opened.");
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(1024 * 1024);
    let length = 0;
    while (true) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!read) break;
      hash.update(chunk.subarray(0, read));
      length += read;
    }
    const after = fs.fstatSync(fd);
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      fail("input_changed", "Input changed while its scope was captured.");
    return Object.freeze({
      path: fs.realpathSync(absolute),
      bytes: length,
      sha256: hash.digest("hex"),
    });
  } finally {
    fs.closeSync(fd);
  }
}
