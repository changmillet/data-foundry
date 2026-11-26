import path from "node:path";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { applyFoundryMigrationAdoption } from "../foundry-migration-adoption.ts";
import {
  planFoundryMigrationAdoption,
  type MigrationAdoptionSelection,
} from "../foundry-migration-adoption-plan.ts";
import { readFoundryMigrationAuthority } from "../foundry-migration-authority.ts";
import { inventoryFoundryWorkspace } from "../foundry-migration-inventory.ts";
import {
  planFoundryWorkspaceMigration,
  revalidateFoundryMigrationPlan,
} from "../foundry-migration-plan.ts";
import { auditFoundryMigration, stageFoundryMigration } from "../foundry-migration-transfer.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationResult,
} from "../foundry-operation-result.ts";
import { assertFoundryCacheRootSeparated } from "../foundry-runtime-cache.ts";
import {
  assertFoundryRuntimeHost,
  createFoundryRuntimeContext,
  FoundryContextError,
} from "../foundry-runtime-context.ts";
import { selectFoundryWorkspaceRuntime } from "../foundry-runtime-selection.ts";
import {
  applyFoundryTaskRuntimeAdoption,
  planFoundryTaskRuntimeAdoption,
} from "../foundry-task-runtime-adoption-write.ts";
import {
  assertRuntimeAdoptionToolkit,
  readFoundryTaskRuntimeAdoption,
  type FoundryTaskRuntimeAdoptionInput,
} from "../foundry-task-runtime-adoption.ts";
import {
  assertNotInterrupted,
  contextOptions,
  failure,
  fileArtifact,
  type FoundryFacadeOptions,
  human,
  inlineArtifact,
  loadFoundryFacadeTaskRecord,
  noPermission,
  qualification,
  runtimeIdentity,
  taskContext,
} from "./facade-support.ts";

export async function runAdoptTaskRuntime(
  options: FoundryFacadeOptions,
  base: () => ReturnType<typeof createFoundryRuntimeContext>,
  input: FoundryTaskRuntimeAdoptionInput,
): Promise<FoundryOperationResult> {
  try {
    assertNotInterrupted(options.signal);
    const current = base(),
      record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
    const context = taskContext(options, current, record);
    if (
      (input.mode === "plan" && (input.selection === undefined || input.plan !== undefined)) ||
      (input.mode === "apply" && (input.plan === undefined || input.selection !== undefined)) ||
      (input.mode === "audit" && (input.plan !== undefined || input.selection !== undefined))
    )
      throw new FoundryContextError(
        "runtime_adoption_selection_invalid",
        "Select exactly one plan, apply or audit input.",
      );
    if (input.mode !== "audit" && options.runtimeAdoptionQualification)
      assertRuntimeAdoptionToolkit(
        qualification(context, options.runtimeSelection, true),
        input.mode === "plan"
          ? input.selection
          : (input.plan as { selection?: unknown })?.selection,
      );
    const value =
      input.mode === "plan"
        ? planFoundryTaskRuntimeAdoption(
            context,
            record,
            input.selection,
            options.runtimeAdoptionQualification,
          )
        : input.mode === "apply"
          ? await applyFoundryTaskRuntimeAdoption(
              context,
              record,
              input.plan,
              options.runtimeAdoptionQualification,
            )
          : input.mode === "audit"
            ? readFoundryTaskRuntimeAdoption(context)
            : null;
    if (!value)
      throw new FoundryContextError(
        "runtime_adoption_missing",
        "No explicit task runtime adoption exists.",
      );
    return createFoundryOperationResult({
      operation: "task.adopt-runtime",
      status: input.mode === "plan" ? "ready" : "completed",
      taskId: record.task_id,
      artifacts: [
        inlineArtifact(
          input.mode === "plan" ? "runtime_adoption_plan" : "runtime_adoption_result",
          value,
        ),
      ],
      blockers: [],
      nextActions: [],
      runtimeIdentity: runtimeIdentity(context),
      permissions: noPermission(),
    });
  } catch (error) {
    return failure("task.adopt-runtime", input.taskId, error);
  }
}

export async function runRuntimeUse(
  options: FoundryFacadeOptions,
  base: () => ReturnType<typeof createFoundryRuntimeContext>,
  input: {
    manifest: TrustedRuntimeManifest;
    requestId: string;
    actorId: string;
    access: "read" | "write";
  },
): Promise<FoundryOperationResult> {
  try {
    assertNotInterrupted(options.signal);
    if (!options.workspaceAccess)
      throw new FoundryContextError(
        "workspace_runtime_selection_required",
        "Explicit runtime selection requires an independently qualified current host.",
      );
    const current = base();
    const selected = await selectFoundryWorkspaceRuntime(
      current,
      options.workspaceAccess.manifest,
      input.manifest,
      {
        requestId: input.requestId,
        actorId: input.actorId,
        access: input.access,
        manager: { ...options.runtimeManager, signal: options.signal },
      },
    );
    return createFoundryOperationResult({
      operation: "workspace.migrate",
      status: "ready",
      taskId: null,
      artifacts: [fileArtifact("workspace_runtime_selection", selected.path)],
      blockers: [],
      nextActions: [
        human(
          "launch_selected_runtime",
          "Launch through the independently trusted selected manifest. Previous and selected components remain leased; read-only selection does not permit task writes.",
        ),
      ],
      runtimeIdentity: runtimeIdentity(current),
      permissions: noPermission(),
    });
  } catch (error) {
    return failure("workspace.migrate", null, error);
  }
}

export function runMigrationDryRun(
  options: FoundryFacadeOptions,
  input?: {
    destination: string;
    actorId: string;
    requestId: string;
    stageManifests?: readonly string[];
    externalInputs?: readonly string[];
  },
): FoundryOperationResult {
  try {
    assertNotInterrupted(options.signal);
    assertFoundryRuntimeHost();
    if (options.runtimeManager?.cacheDir !== undefined)
      assertFoundryCacheRootSeparated(
        options.runtimeManager.cacheDir,
        path.resolve(options.cwd ?? process.cwd(), options.workspace),
      );
    const plan = input
      ? planFoundryWorkspaceMigration(
          createFoundryRuntimeContext({
            ...contextOptions(options),
            workspace: input.destination,
          }),
          {
            sourceWorkspace: path.resolve(options.cwd ?? process.cwd(), options.workspace),
            actorId: input.actorId,
            requestId: input.requestId,
            stageManifests: input.stageManifests,
            externalInputs: input.externalInputs,
          },
        )
      : inventoryFoundryWorkspace(options.workspace, {
          sessionReference: options.accountIntent?.sessionReference,
        });
    assertNotInterrupted(options.signal);
    return createFoundryOperationResult({
      operation: "workspace.migrate",
      status: "ready",
      taskId: null,
      artifacts: [
        inlineArtifact(
          input ? "workspace_migration_transfer_plan" : "workspace_migration_plan",
          plan,
        ),
      ],
      blockers: [],
      nextActions:
        input || ("disposition" in plan && plan.disposition === "explicit_migration_required")
          ? [
              human(
                "review_workspace_migration",
                "Review this content-bound plan before an explicit migration apply; retained stage labels grant no write or replay permission.",
              ),
            ]
          : [],
      runtimeIdentity: null,
      permissions: noPermission(),
    });
  } catch (error) {
    return failure("workspace.migrate", null, error);
  }
}

export async function runMigrationTransfer(
  options: FoundryFacadeOptions,
  input: {
    destination: string;
    actorId: string;
    requestId: string;
    stageManifests?: readonly string[];
    externalInputs?: readonly string[];
    plan: unknown;
    audit?: boolean;
  },
): Promise<FoundryOperationResult> {
  try {
    assertNotInterrupted(options.signal);
    assertFoundryRuntimeHost();
    const destination = createFoundryRuntimeContext({
      ...contextOptions(options),
      workspace: input.destination,
    });
    const planning = {
      sourceWorkspace: path.resolve(options.cwd ?? process.cwd(), options.workspace),
      actorId: input.actorId,
      requestId: input.requestId,
      stageManifests: input.stageManifests,
      externalInputs: input.externalInputs,
    };
    if (input.audit && destination.migration) {
      revalidateFoundryMigrationPlan(
        destination,
        planning,
        input.plan,
        destination.migration.plan_sha256,
      );
      const activation = readFoundryMigrationAuthority(
        destination.controlRoot,
        destination.workspaceId!,
        destination.migration,
      );
      return createFoundryOperationResult({
        operation: "workspace.migrate",
        status: "ready",
        taskId: null,
        artifacts: [
          fileArtifact(
            "migration_activation_receipt",
            path.join(
              destination.controlRoot,
              "migrations",
              activation.plan_sha256,
              "activation.json",
            ),
          ),
        ],
        blockers: [],
        nextActions: [],
        runtimeIdentity: runtimeIdentity(destination),
        permissions: noPermission(),
      });
    }
    const transfer = input.audit
      ? auditFoundryMigration(destination, planning, input.plan)
      : await stageFoundryMigration(destination, planning, input.plan, {
          signal: options.signal,
        });
    return createFoundryOperationResult({
      operation: "workspace.migrate",
      status: "ready",
      taskId: null,
      artifacts: [fileArtifact("migration_transfer_receipt", transfer.path)],
      blockers: [],
      nextActions: [
        human(
          "complete_migration_adoption",
          "The source snapshot is staged and verified. Complete task adoption and activation audit before running this workspace.",
        ),
      ],
      runtimeIdentity: null,
      permissions: noPermission(),
    });
  } catch (error) {
    return failure("workspace.migrate", null, error);
  }
}

export async function runMigrationAdoption(
  options: FoundryFacadeOptions,
  input: {
    destination: string;
    actorId: string;
    requestId: string;
    stageManifests?: readonly string[];
    externalInputs?: readonly string[];
    plan: unknown;
    tasks: readonly MigrationAdoptionSelection[];
    adoptionPlan?: unknown;
    apply?: boolean;
  },
  createTaskFacadeForWorkspace: (workspaceRoot: string) => {
    start(input: { specFile: string }): Promise<FoundryOperationResult>;
    resume(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult>;
    status(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult>;
  },
): Promise<FoundryOperationResult> {
  try {
    assertNotInterrupted(options.signal);
    if (!options.workspaceAccess)
      throw new FoundryContextError(
        "workspace_runtime_selection_required",
        "Select an independently trusted Foundry runtime before task adoption.",
      );
    const destination = createFoundryRuntimeContext({
      ...contextOptions(options),
      workspace: input.destination,
    });
    const planning = {
      sourceWorkspace: path.resolve(options.cwd ?? process.cwd(), options.workspace),
      actorId: input.actorId,
      requestId: input.requestId,
      stageManifests: input.stageManifests,
      externalInputs: input.externalInputs,
    };
    if (input.apply) {
      if (input.adoptionPlan === undefined)
        throw new FoundryContextError(
          "migration_adoption_required",
          "Explicit application requires the reviewed adoption plan.",
        );
      const applied = await applyFoundryMigrationAdoption(
        destination,
        planning,
        input.plan,
        input.tasks,
        input.adoptionPlan,
        options.workspaceAccess.manifest,
        {
          runtimeManager: options.runtimeManager,
          createTaskFacade: () => createTaskFacadeForWorkspace(destination.workspaceRoot),
        },
        { signal: options.signal },
      );
      return createFoundryOperationResult({
        operation: "workspace.migrate",
        status: "ready",
        taskId: null,
        artifacts: [fileArtifact("migration_activation_receipt", applied.path)],
        blockers: [],
        nextActions: applied.activation.tasks.some(
          (task) => task.disposition !== "local-unattempted",
        )
          ? [
              human(
                "retained_owner_recovery",
                "Retained terminal or unresolved legacy work stays under its original owner. Inspect the activation receipt before choosing status/readback recovery.",
              ),
            ]
          : [],
        runtimeIdentity: runtimeIdentity(destination),
        permissions: noPermission(),
      });
    }
    if (input.adoptionPlan !== undefined)
      throw new FoundryContextError(
        "argument_migration_plan_invalid",
        "Adoption preview reconstructs its plan from independent selections.",
      );
    const planned = await planFoundryMigrationAdoption(
      destination,
      planning,
      input.plan,
      input.tasks,
      options.workspaceAccess.manifest,
    );
    return createFoundryOperationResult({
      operation: "workspace.migrate",
      status: "ready",
      taskId: null,
      artifacts: [inlineArtifact("migration_adoption_plan", planned)],
      blockers: [],
      nextActions: [
        human(
          "review_task_adoption",
          "Review the retained history classes, exact source mapping and current preparation before explicit application.",
        ),
      ],
      runtimeIdentity: runtimeIdentity(destination),
      permissions: noPermission(),
    });
  } catch (error) {
    return failure("workspace.migrate", null, error);
  }
}
