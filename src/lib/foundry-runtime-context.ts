import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { describeFoundryRuntime } from "./foundry-runtime-paths.ts";
export { FoundryContextError } from "./foundry-runtime-error.ts";
import {
  FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
  FOUNDRY_MIGRATED_WORKSPACE_FEATURES,
  readFoundryMigrationAuthority,
} from "./foundry-migration-authority.ts";
import { transferRead, transferHash } from "./foundry-migration-transfer-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { assertNotFoundrySessionFile } from "./foundry-private-path.ts";
import { readFoundryRuntimeSelection } from "./foundry-runtime-selection-record.ts";
import {
  canonicalFoundryCachePath,
  assertFoundryCacheRootSeparated,
} from "./foundry-runtime-cache.ts";
import {
  canonicalFuturePath,
  confined,
  defaultCacheBase,
  discoverWorkspace,
  fail,
  hashPattern,
  idPattern,
  inside,
  migratedMarker,
  readWorkspaceId,
  regularFile,
  supportedPlatform,
  uuidPattern,
  verifyWorkspaceAccess,
  workspaceSchema,
} from "./foundry-runtime-context-fs.ts";
export { captureFoundryInput } from "./foundry-runtime-context-fs.ts";

import type {
  FoundryWorkspaceAccess,
  FoundryRuntimeContext,
  FoundryRuntimeContextOptions,
} from "./foundry-runtime-context-types.ts";
export type {
  FoundryInputFact,
  FoundryAccountIntent,
  FoundryWorkspaceAccess,
  FoundryRuntimeContext,
  FoundryRuntimeContextOptions,
} from "./foundry-runtime-context-types.ts";

const contexts = new WeakSet<object>();
const workspaceSelections = new WeakMap<object, FoundryWorkspaceAccess>();
const managedCacheRoots = new WeakMap<object, string>();
const migratedMarkerHashes = new WeakMap<object, string>();
interface PendingAdoptionScope {
  workspaceRoot: string;
  workspaceId: string;
  planSha256: string;
  markerSha256: string;
  adoptionFileSha256: string;
  tasks: readonly {
    task_id: string;
    request_id: string;
    actor_id: string;
    spec_fingerprint_sha256: string;
  }[];
  active: boolean;
}
const adoptionScopes = new AsyncLocalStorage<PendingAdoptionScope>();
const pendingContexts = new WeakMap<object, PendingAdoptionScope>();

export function assertFoundryRuntimeHost(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor !== 24 || nodeMinor < 19)
    fail(
      "node_runtime_unsupported",
      "Foundry requires Node 24.19 or later in the Node 24 release line.",
    );
  return supportedPlatform(platform, arch);
}

export function createFoundryRuntimeContext(
  options: FoundryRuntimeContextOptions,
): FoundryRuntimeContext {
  const platform = options.platform ?? process.platform;
  const platformKey = assertFoundryRuntimeHost(platform, options.arch ?? process.arch);
  const runtime = describeFoundryRuntime(options.moduleUrl);
  const cwd = options.cwd ?? process.cwd();
  const workspaceRoot = options.workspace
    ? canonicalFuturePath(path.resolve(cwd, options.workspace))
    : discoverWorkspace(cwd, runtime.runtimeRoot, options.accountIntent?.sessionReference);
  const slashRoot = workspaceRoot.split(path.sep).join("/");
  if (
    workspaceRoot === path.parse(workspaceRoot).root ||
    inside(runtime.runtimeRoot, workspaceRoot) ||
    /\/(?:\.agents|\.codex)\/skills(?:\/|$)/u.test(slashRoot) ||
    /\/_npx(?:\/|$)/u.test(slashRoot)
  ) {
    fail(
      "workspace_root_forbidden",
      "An installation, skill directory or filesystem root cannot be used as the project workspace.",
    );
  }
  if (fs.existsSync(workspaceRoot) && !fs.statSync(workspaceRoot).isDirectory())
    fail("root_not_directory", "Workspace root must be a directory.");
  const managedCacheRoot =
    options.managedCacheRoot === undefined
      ? null
      : canonicalFoundryCachePath(options.managedCacheRoot);
  if (managedCacheRoot) assertFoundryCacheRootSeparated(managedCacheRoot, workspaceRoot);
  let workspaceId = readWorkspaceId(workspaceRoot, options.accountIntent?.sessionReference);
  const activeAdoption = adoptionScopes.getStore();
  const pending =
    !workspaceId && activeAdoption?.active && activeAdoption.workspaceRoot === workspaceRoot
      ? activeAdoption
      : undefined;
  if (pending) workspaceId = pending.workspaceId;
  const markerBytes = workspaceId
    ? transferRead(
        confined(workspaceRoot, path.join(workspaceRoot, ".foundry/workspace.json")),
        64 * 1024,
      )
    : null;
  const marker = markerBytes
    ? (JSON.parse(markerBytes.toString("utf8")) as Record<string, unknown>)
    : null;
  const migrated =
    marker?.schema === FOUNDRY_MIGRATED_WORKSPACE_SCHEMA ? migratedMarker(marker) : null;
  const selectedSchema = migrated || pending ? FOUNDRY_MIGRATED_WORKSPACE_SCHEMA : workspaceSchema;
  const selectedFeatures =
    migrated?.features ??
    (pending ? FOUNDRY_MIGRATED_WORKSPACE_FEATURES : Object.freeze(["registered-tasks-v2"]));
  const selection = options.workspaceAccess;
  if ((migrated || pending) && !selection)
    fail(
      "workspace_runtime_selection_required",
      "Migrated workspaces require an independently trusted read/write runtime selection.",
    );
  if (selection)
    verifyWorkspaceAccess(selection, runtime.packageVersion, selectedSchema, selectedFeatures);
  if (migrated)
    readFoundryMigrationAuthority(
      path.join(workspaceRoot, ".foundry"),
      workspaceId!,
      migrated.migration,
      false,
      options.accountIntent?.sessionReference,
    );
  const taskId = options.taskId ?? null;
  const actorId = options.actorId ?? null;
  if (
    taskId !== null &&
    (typeof taskId !== "string" || !idPattern.test(taskId) || taskId === "." || taskId === "..")
  )
    fail("task_id_invalid", "Task id must be a single safe path segment.");
  if (
    taskId &&
    (typeof actorId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(actorId))
  )
    fail("actor_required", "Task execution requires explicit actor intent.");
  if (taskId && !workspaceId)
    fail("workspace_not_initialized", "Initialize the workspace before opening a task context.");
  const controlRoot = confined(workspaceRoot, path.join(workspaceRoot, ".foundry"));
  const stateRoot = confined(workspaceRoot, path.join(controlRoot, "state"));
  const taskRoot = taskId
    ? confined(workspaceRoot, path.join(controlRoot, "workspaces", taskId))
    : null;
  const requestedAccount = options.accountIntent;
  if (
    requestedAccount &&
    (typeof requestedAccount.projectRef !== "string" ||
      !/^[a-z0-9]{20}$/u.test(requestedAccount.projectRef) ||
      typeof requestedAccount.userId !== "string" ||
      !uuidPattern.test(requestedAccount.userId) ||
      (requestedAccount.accountMode !== undefined &&
        requestedAccount.accountMode !== "ordinary" &&
        requestedAccount.accountMode !== "production-test") ||
      (requestedAccount.sessionReference !== undefined &&
        (typeof requestedAccount.sessionReference !== "string" ||
          !path.isAbsolute(requestedAccount.sessionReference))))
  ) {
    fail(
      "account_intent_invalid",
      "Account intent requires an exact project/user and an optional absolute CLI session reference.",
    );
  }
  const accountIntent = requestedAccount ? Object.freeze({ ...requestedAccount }) : null;
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        runtime.packageManifestSha256,
        runtime.entrySha256,
        workspaceId ?? workspaceRoot,
        accountIntent?.projectRef ?? null,
        accountIntent?.userId ?? null,
      ]),
    )
    .digest("hex");
  const cacheBase = canonicalFuturePath(
    path.resolve(
      cwd,
      options.cacheBase ?? defaultCacheBase(platform, options.environment ?? process.env),
    ),
  );
  const cacheRoot = path.join(
    cacheBase,
    "tiangong-lca",
    "foundry-content",
    runtime.packageVersion,
    platformKey,
    scope,
  );
  if (
    inside(runtime.runtimeRoot, cacheRoot) ||
    inside(cacheRoot, runtime.runtimeRoot) ||
    inside(cacheRoot, workspaceRoot)
  )
    fail(
      "cache_root_forbidden",
      "Content cache must be separate from the runtime and workspace roots.",
    );
  const inputs = (options.inputs ?? []).map((input) => {
    if (
      !path.isAbsolute(input.path) ||
      !hashPattern.test(input.sha256) ||
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 0
    )
      fail("input_fact_invalid", "Input facts require an absolute file, size and SHA-256.");
    if (
      /^\.env(?:\.|$)/iu.test(path.basename(input.path)) ||
      input.path === accountIntent?.sessionReference
    )
      fail("credential_input_forbidden", "Credential storage is not a dataset input.");
    return Object.freeze({ ...input });
  });
  if (new Set(inputs.map((input) => input.path)).size !== inputs.length)
    fail("input_fact_duplicate", "Input facts must be unique.");
  const context: FoundryRuntimeContext = Object.freeze({
    runtime,
    runtimeRoot: runtime.runtimeRoot,
    assetRoot: runtime.assetRoot,
    workspaceRoot,
    workspaceId,
    workspaceAccess: selection?.access ?? "write",
    workspaceManifestSha256: selection?.manifest.sha256 ?? null,
    workspaceSchema: selectedSchema,
    workspaceFeatures: selectedFeatures,
    migration: migrated?.migration ?? null,
    pendingMigration: pending?.planSha256 ?? null,
    controlRoot,
    stateRoot,
    taskRoot,
    taskId,
    actorId,
    tempRoot: path.join(taskRoot ?? controlRoot, "tmp"),
    cacheRoot,
    cacheBase,
    platform: platformKey,
    accountIntent,
    inputs: Object.freeze(inputs),
  });
  contexts.add(context);
  if (managedCacheRoot) managedCacheRoots.set(context, managedCacheRoot);
  if (selection) workspaceSelections.set(context, Object.freeze({ ...selection }));
  if (migrated && markerBytes) migratedMarkerHashes.set(context, transferHash(markerBytes));
  if (pending) pendingContexts.set(context, pending);
  return context;
}

export function assertFoundryRuntimeContext(context: FoundryRuntimeContext): void {
  if (!contexts.has(context))
    fail(
      "runtime_context_unverified",
      "Use the runtime context constructor; serialized context is not authority.",
    );
  const managedCacheRoot = managedCacheRoots.get(context);
  if (managedCacheRoot) assertFoundryCacheRootSeparated(managedCacheRoot, context.workspaceRoot);
  const pending = pendingContexts.get(context);
  if (pending) {
    if (
      !pending.active ||
      adoptionScopes.getStore() !== pending ||
      transferHash(
        transferRead(
          confined(context.workspaceRoot, path.join(context.controlRoot, "workspace.json")),
          64 * 1024,
        ),
      ) !== pending.markerSha256 ||
      transferHash(
        transferRead(
          confined(
            context.workspaceRoot,
            path.join(context.controlRoot, "migrations", pending.planSha256, "adoption.json"),
          ),
        ),
      ) !== pending.adoptionFileSha256
    )
      fail(
        "migration_session_closed",
        "Pending adoption context is stale or outside its scoped local operation.",
      );
  } else if (
    context.workspaceId &&
    readWorkspaceId(context.workspaceRoot, context.accountIntent?.sessionReference) !==
      context.workspaceId
  )
    fail("workspace_changed", "Workspace identity changed after context construction.");
  const selection = workspaceSelections.get(context);
  if (selection)
    verifyWorkspaceAccess(
      selection,
      context.runtime.packageVersion,
      context.workspaceSchema,
      context.workspaceFeatures,
    );
  const markerHash = migratedMarkerHashes.get(context);
  if (
    markerHash &&
    transferHash(
      transferRead(
        confined(context.workspaceRoot, path.join(context.controlRoot, "workspace.json")),
        64 * 1024,
      ),
    ) !== markerHash
  )
    fail("workspace_changed", "Migrated workspace marker changed after runtime selection.");
  if (context.migration)
    readFoundryMigrationAuthority(
      context.controlRoot,
      context.workspaceId!,
      context.migration,
      false,
      context.accountIntent?.sessionReference,
    );
}

/** Current host authority, never the persisted workspace pointer or a rollback target. */
export function currentFoundryRuntimeManifest(
  context: FoundryRuntimeContext,
): TrustedRuntimeManifest | null {
  assertFoundryRuntimeContext(context);
  return workspaceSelections.get(context)?.manifest ?? null;
}

export function assertFoundryWorkspaceWrite(context: FoundryRuntimeContext): void {
  assertFoundryRuntimeContext(context);
  if (context.workspaceAccess !== "write")
    fail(
      "workspace_read_only",
      "The selected runtime has read-only workspace access; use a write-qualified runtime before changing task state.",
    );
  const selected = context.workspaceId
    ? readFoundryRuntimeSelection(
        context.controlRoot,
        context.workspaceId,
        context.accountIntent?.sessionReference,
      )
    : null;
  if (
    selected &&
    (selected.value.access !== "write" ||
      selected.value.selected_manifest_sha256 !== context.workspaceManifestSha256)
  )
    fail(
      "workspace_runtime_selection_mismatch",
      "The project is pinned to another runtime or read-only mode; explicitly select a qualified writer before changing task state.",
    );
  const pending = pendingContexts.get(context);
  if (
    pending &&
    context.taskId &&
    !pending.tasks.some(
      (task) => task.task_id === context.taskId && task.actor_id === context.actorId,
    )
  )
    fail(
      "migration_task_adoption_required",
      "Pending preparation is limited to the independently reviewed task mapping.",
    );
}

/** Control-plane selection can restore a qualified writer without granting task mutation. */
export function assertFoundryRuntimeSelector(context: FoundryRuntimeContext): void {
  assertFoundryRuntimeContext(context);
  if (
    !context.workspaceId ||
    context.pendingMigration ||
    context.workspaceAccess !== "write" ||
    !context.workspaceManifestSha256
  )
    fail(
      "workspace_runtime_selection_required",
      "Runtime selection requires an active workspace and an independently qualified current writer.",
    );
}

export function assertFoundryWorkspaceActive(context: FoundryRuntimeContext): void {
  assertFoundryWorkspaceWrite(context);
  if (context.pendingMigration)
    fail(
      "workspace_migration_pending",
      "Pending adoption cannot create business authorization or execution admission.",
    );
}

export function assertPendingFoundryTaskIntent(
  context: FoundryRuntimeContext,
  id: string,
  request: string,
  actor: string,
  fingerprint?: string,
): void {
  assertFoundryRuntimeContext(context);
  const pending = pendingContexts.get(context);
  if (
    pending &&
    !pending.tasks.some(
      (task) =>
        task.task_id === id &&
        task.request_id === request &&
        task.actor_id === actor &&
        (fingerprint === undefined || task.spec_fingerprint_sha256 === fingerprint),
    )
  )
    fail(
      "migration_task_adoption_required",
      "Pending task intent differs from the reviewed migration mapping.",
    );
}

/** Internal migration owner scope. Never exported by the package's public API. */
export async function withFoundryPendingAdoption<T>(
  context: FoundryRuntimeContext,
  callback: () => Promise<T>,
): Promise<T> {
  assertFoundryWorkspaceWrite(context);
  const plan = pendingFoundryMigration(context);
  const selection = workspaceSelections.get(context);
  if (!plan || !selection)
    fail(
      "migration_adoption_required",
      "Pending adoption requires a staged plan and trusted writer selection.",
    );
  verifyWorkspaceAccess(
    selection,
    context.runtime.packageVersion,
    FOUNDRY_MIGRATED_WORKSPACE_SCHEMA,
    FOUNDRY_MIGRATED_WORKSPACE_FEATURES,
  );
  const markerBytes = transferRead(
    confined(context.workspaceRoot, path.join(context.controlRoot, "workspace.json")),
    64 * 1024,
  );
  const claim = JSON.parse(
    transferRead(
      confined(context.workspaceRoot, path.join(context.controlRoot, "migration-claim.json")),
    ).toString("utf8"),
  ) as Record<string, unknown>;
  const adoptionBytes = transferRead(
    confined(
      context.workspaceRoot,
      path.join(context.controlRoot, "migrations", plan, "adoption.json"),
    ),
  );
  const adoption = JSON.parse(adoptionBytes.toString("utf8")) as Record<string, unknown>;
  const { adoption_sha256: digest, ...unsigned } = adoption;
  if (
    adoption.schema !== "tiangong-foundry.migration-adoption-plan.v1" ||
    adoption.plan_sha256 !== plan ||
    typeof adoption.workspace_id !== "string" ||
    !uuidPattern.test(adoption.workspace_id) ||
    adoption.workspace_id !== claim.workspace_id ||
    claim.plan_sha256 !== plan ||
    adoption.actor_id !== claim.actor_id ||
    adoption.runtime_manifest_sha256 !== selection.manifest.sha256 ||
    digest !== sha256Json(unsigned) ||
    !Array.isArray(adoption.tasks)
  )
    fail(
      "migration_adoption_invalid",
      "Pending adoption differs from its source transfer, actor or trusted runtime.",
    );
  const tasks: PendingAdoptionScope["tasks"][number][] = [];
  for (const row of adoption.tasks as Record<string, unknown>[]) {
    const task = row.authority as Record<string, unknown>;
    if (task.disposition !== "local-unattempted") continue;
    if (
      typeof task.task_id !== "string" ||
      !/^task-[0-9a-f]{64}-r0001$/u.test(task.task_id) ||
      typeof task.request_id !== "string" ||
      typeof task.actor_id !== "string" ||
      typeof task.spec_fingerprint_sha256 !== "string" ||
      !hashPattern.test(task.spec_fingerprint_sha256)
    )
      fail("migration_adoption_invalid", "Pending preparation task identity is invalid.");
    tasks.push({
      task_id: task.task_id,
      request_id: task.request_id,
      actor_id: task.actor_id,
      spec_fingerprint_sha256: task.spec_fingerprint_sha256,
    });
  }
  const scope: PendingAdoptionScope = {
    workspaceRoot: context.workspaceRoot,
    workspaceId: adoption.workspace_id,
    planSha256: plan,
    markerSha256: transferHash(markerBytes),
    adoptionFileSha256: transferHash(adoptionBytes),
    tasks: Object.freeze(tasks),
    active: true,
  };
  try {
    return await adoptionScopes.run(scope, callback);
  } finally {
    scope.active = false;
  }
}

export function pendingFoundryMigration(context: FoundryRuntimeContext): string | null {
  assertFoundryRuntimeContext(context);
  const marker = confined(context.workspaceRoot, path.join(context.controlRoot, "workspace.json"));
  if (!fs.existsSync(marker)) return null;
  assertNotFoundrySessionFile(marker, context.accountIntent?.sessionReference);
  if (regularFile(marker).size > 64 * 1024)
    fail("workspace_invalid", "Workspace marker exceeds its limit.");
  const value: unknown = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      record.schema === "tiangong-foundry.workspace-migration-pending.v1" &&
      typeof record.plan_sha256 === "string" &&
      hashPattern.test(record.plan_sha256) &&
      Object.keys(record).length === 2
    )
      return record.plan_sha256;
  }
  return null;
}

export function resolveFoundryOutput(
  context: FoundryRuntimeContext,
  value: string,
  area: "task" | "state" | "cache" = "task",
): string {
  assertFoundryRuntimeContext(context);
  const root =
    area === "cache" ? context.cacheRoot : area === "state" ? context.stateRoot : context.taskRoot;
  if (!root)
    fail("task_context_required", "Task output requires an explicit initialized task context.");
  const target = confined(root, path.resolve(root, value));
  confined(area === "cache" ? context.cacheBase : context.workspaceRoot, target);
  const physical = canonicalFuturePath(target);
  if (inside(context.runtimeRoot, physical) || !inside(root, physical))
    fail(
      "runtime_is_read_only",
      "Runtime code/assets are read-only and output must remain in its declared root.",
    );
  return target;
}

export function resolveFoundryAsset(context: FoundryRuntimeContext, relative: string): string {
  assertFoundryRuntimeContext(context);
  if (
    relative.split(/[\\/]/u).some((part) => part === ".." || part === ".") ||
    !/^(?:specs\/|docs\/|README(?:\.md)?$|LICENSE(?:\.[A-Za-z]+)?$|NOTICE(?:\.[A-Za-z]+)?$)/u.test(
      relative,
    )
  ) {
    fail(
      "asset_not_registered",
      "Only reviewed runtime resource families can be read as package assets.",
    );
  }
  const target = confined(context.assetRoot, path.resolve(context.assetRoot, relative));
  regularFile(target);
  if (!inside(context.assetRoot, fs.realpathSync(target)))
    fail("asset_outside_runtime", "Package asset escapes the runtime root.");
  return target;
}

export function resolveFoundryInputPath(context: FoundryRuntimeContext, filePath: string): string {
  assertFoundryRuntimeContext(context);
  const absolute = path.resolve(context.workspaceRoot, filePath);
  if (!fs.existsSync(absolute))
    fail("input_not_selected", "The requested file is missing or not selected for this task.");
  regularFile(absolute);
  const canonical = fs.realpathSync(absolute);
  const fact = context.inputs.find((input) => input.path === canonical);
  if (!fact)
    fail("input_not_selected", "The requested file is not bound to this task's selected inputs.");
  return fact.path;
}

export function readFoundryInput(
  context: FoundryRuntimeContext,
  filePath: string,
  maxBytes = 64 * 1024 * 1024,
): Buffer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    fail("input_limit_invalid", "Input memory limit must be a nonnegative safe integer.");
  const absolute = resolveFoundryInputPath(context, filePath);
  const fact = context.inputs.find((input) => input.path === absolute)!;
  if (fact.bytes > maxBytes)
    fail("input_too_large", "Input exceeds the operation's declared memory limit.");
  const before = regularFile(absolute);
  if (fs.realpathSync(absolute) !== fact.path || before.size !== fact.bytes)
    fail("input_changed", "Selected input identity or size changed.");
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile())
      fail("input_changed", "Selected input changed while it was opened.");
    const bytes = fs.readFileSync(fd);
    if (
      bytes.length !== fact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== fact.sha256
    )
      fail("input_changed", "Selected input bytes no longer match the task scope.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function writeFoundryArtifact(
  context: FoundryRuntimeContext,
  filePath: string,
  content: string | Buffer,
): void {
  assertFoundryWorkspaceWrite(context);
  const target = resolveFoundryOutput(context, filePath);
  if (target === context.taskRoot)
    fail("output_file_required", "An artifact must be a file below the task root.");
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  resolveFoundryOutput(context, target);
  if (fs.existsSync(target)) {
    regularFile(target);
    if (fs.readFileSync(target).equals(bytes)) return;
    fail("artifact_exists", "Existing task artifacts are immutable; select a new output revision.");
  }
  const temp = path.join(path.dirname(target), `.artifact-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
    try {
      fs.linkSync(temp, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      resolveFoundryOutput(context, target);
      regularFile(target);
      if (!fs.readFileSync(target).equals(bytes))
        fail("artifact_exists", "A concurrent writer installed different artifact bytes.");
    }
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function initializeFoundryWorkspace(context: FoundryRuntimeContext): {
  workspace_id: string;
  status: "created" | "existing";
} {
  assertFoundryWorkspaceWrite(context);
  if (pendingFoundryMigration(context))
    fail(
      "workspace_migration_pending",
      "Migration is staged and must pass task adoption and activation audit before workspace use.",
    );
  if (canonicalFuturePath(context.workspaceRoot) !== context.workspaceRoot)
    fail("workspace_changed", "Workspace root changed after context construction.");
  let existing = readWorkspaceId(context.workspaceRoot, context.accountIntent?.sessionReference);
  if (!existing && fs.existsSync(context.controlRoot)) {
    const names = fs
      .readdirSync(context.controlRoot)
      .filter((name) => !/^\.workspace-[0-9a-f-]+\.tmp$/u.test(name));
    existing = readWorkspaceId(context.workspaceRoot, context.accountIntent?.sessionReference);
    if (names.length && !existing)
      fail(
        "legacy_workspace_requires_migration",
        "Existing unversioned Foundry state must be inventoried and migrated explicitly.",
      );
  }
  fs.mkdirSync(context.controlRoot, { recursive: true, mode: 0o700 });
  confined(context.workspaceRoot, context.controlRoot);
  const marker = path.join(context.controlRoot, "workspace.json");
  let created = false;
  if (!existing) {
    const temp = path.join(context.controlRoot, `.workspace-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(
        temp,
        JSON.stringify({
          schema: workspaceSchema,
          layout_version: 1,
          workspace_id: randomUUID(),
          created_at_utc: new Date().toISOString(),
        }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      try {
        fs.linkSync(temp, marker);
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  const workspaceId = readWorkspaceId(
    context.workspaceRoot,
    context.accountIntent?.sessionReference,
  )!;
  for (const relative of ["state", "tasks/inbox", "tasks/active", "tasks/done", "workspaces"]) {
    const target = confined(context.workspaceRoot, path.join(context.controlRoot, relative));
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    confined(context.workspaceRoot, target);
  }
  return { workspace_id: workspaceId, status: created ? "created" : "existing" };
}
