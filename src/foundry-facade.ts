import path from "node:path";
import type { TrustedRuntimeManifest } from "@tiangong-lca/cli/runtime";
import { createFoundryRuntime } from "./foundry-runtime.ts";
import {
  loadFoundryFacadeTaskRecord,
  registerFoundryFacadeTask,
} from "./lib/foundry-facade-store.ts";
import { pendingFoundryIdentityStage } from "./lib/foundry-identity-stage-state.ts";
import {
  currentFoundryInteractionState,
  currentFoundryInvestigations,
  currentFoundryQuestions,
} from "./lib/foundry-interaction-input.ts";
import type { MigrationAdoptionSelection } from "./lib/foundry-migration-adoption-plan.ts";
import {
  createFoundryOperationResult,
  type FoundryOperationResult,
} from "./lib/foundry-operation-result.ts";
import { completedOwnerScopes } from "./lib/foundry-owner-execution-store.ts";
import {
  assertFoundryWorkspaceWrite,
  createFoundryRuntimeContext,
  FoundryContextError,
  initializeFoundryWorkspace,
  pendingFoundryMigration,
} from "./lib/foundry-runtime-context.ts";
import { prepareFoundryTaskInput } from "./lib/foundry-task-input-preparation.ts";
import type { FoundryTaskRuntimeAdoptionInput } from "./lib/foundry-task-runtime-adoption.ts";
import { sha256Json } from "./lib/identity-preflight-proof.ts";
import {
  runAdoptTaskRuntime,
  runMigrationAdoption,
  runMigrationDryRun,
  runMigrationTransfer,
  runRuntimeUse,
} from "./lib/foundry-facade/facade-migration-handlers.ts";
import {
  type FoundryResumeInput,
  handleAuthorizationInputResume,
  handleExplicitIdentityStageResume,
  handleInteractionInputResume,
  handlePendingOwnerReadbackResume,
  handleQualityReviewInputResume,
  handleReferenceInputResume,
  handleSemanticInputResume,
  validateResumeInputFlags,
} from "./lib/foundry-facade/facade-resume-inputs.ts";
import { runAutomaticResumeStage } from "./lib/foundry-facade/facade-resume-stages.ts";
import {
  accountIntent,
  accountReadiness,
  assertNotInterrupted,
  contextOptions,
  failure,
  fileArtifact,
  type FoundryFacadeOptions,
  type FoundryFacadeRuntimeSelection,
  human,
  inlineArtifact,
  noPermission,
  qualification,
  readSpec,
  runtimeIdentity,
  seed,
  selectedInputs,
  taskContext,
} from "./lib/foundry-facade/facade-support.ts";
import { taskProjection } from "./lib/foundry-facade/facade-task-projection.ts";

export type { FoundryFacadeOptions, FoundryFacadeRuntimeSelection };

export function createFoundryFacade(options: FoundryFacadeOptions) {
  const base = () => createFoundryRuntimeContext(contextOptions(options));
  return Object.freeze({
    adoptTaskRuntime(input: FoundryTaskRuntimeAdoptionInput): Promise<FoundryOperationResult> {
      return runAdoptTaskRuntime(options, base, input);
    },
    runtimeUse(input: {
      manifest: TrustedRuntimeManifest;
      requestId: string;
      actorId: string;
      access: "read" | "write";
    }): Promise<FoundryOperationResult> {
      return runRuntimeUse(options, base, input);
    },
    initialize(): FoundryOperationResult {
      try {
        assertNotInterrupted(options.signal);
        const initial = base();
        assertNotInterrupted(options.signal);
        initializeFoundryWorkspace(initial);
        assertNotInterrupted(options.signal);
        const current = base();
        const marker = path.join(current.controlRoot, "workspace.json");
        return createFoundryOperationResult({
          operation: "workspace.init",
          status: "ready",
          taskId: null,
          artifacts: [fileArtifact("workspace_marker", marker)],
          blockers: [],
          nextActions: [],
          runtimeIdentity: runtimeIdentity(current),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("workspace.init", null, error);
      }
    },
    doctor(): FoundryOperationResult {
      try {
        assertNotInterrupted(options.signal);
        const current = base();
        if (pendingFoundryMigration(current))
          throw new FoundryContextError(
            "workspace_migration_pending",
            "Migration is staged and requires task adoption and activation audit.",
          );
        const qualified = qualification(current, options.runtimeSelection);
        assertNotInterrupted(options.signal);
        const readiness = accountReadiness(current);
        const nextActions = [
          ...(current.workspaceId
            ? []
            : [human("initialize_workspace", "Initialize the selected user workspace.")]),
          ...(qualified
            ? []
            : [
                human(
                  "provide_qualified_runtime",
                  "Launch through the trusted CLI runtime manager before a child-required stage.",
                ),
              ]),
          ...(readiness.status === "needs_auth"
            ? [
                human(
                  "authenticate_cli",
                  "Complete the trusted CLI OAuth flow, then resume with the same account intent.",
                ),
              ]
            : []),
        ];
        return createFoundryOperationResult({
          operation: "doctor",
          status: readiness.status === "needs_auth" ? "needs_auth" : "ready",
          taskId: null,
          artifacts: [],
          blockers:
            readiness.status === "needs_auth"
              ? [
                  {
                    code: "needs_auth",
                    message:
                      "The selected account intent needs a CLI-owned OAuth session before restricted work.",
                    scope: null,
                  },
                ]
              : [],
          nextActions,
          runtimeIdentity: runtimeIdentity(current, qualified),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure("doctor", null, error);
      }
    },
    migrationDryRun(input?: {
      destination: string;
      actorId: string;
      requestId: string;
      stageManifests?: readonly string[];
      externalInputs?: readonly string[];
    }): FoundryOperationResult {
      return runMigrationDryRun(options, input);
    },
    migrationTransfer(input: {
      destination: string;
      actorId: string;
      requestId: string;
      stageManifests?: readonly string[];
      externalInputs?: readonly string[];
      plan: unknown;
      audit?: boolean;
    }): Promise<FoundryOperationResult> {
      return runMigrationTransfer(options, input);
    },
    migrationAdoption(input: {
      destination: string;
      actorId: string;
      requestId: string;
      stageManifests?: readonly string[];
      externalInputs?: readonly string[];
      plan: unknown;
      tasks: readonly MigrationAdoptionSelection[];
      adoptionPlan?: unknown;
      apply?: boolean;
    }): Promise<FoundryOperationResult> {
      return runMigrationAdoption(options, input, (workspaceRoot) =>
        createFoundryFacade({ ...options, workspace: workspaceRoot }),
      );
    },
    async start(input: { specFile: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      let taskId: string | null = null;
      try {
        assertNotInterrupted(options.signal);
        current = base();
        assertFoundryWorkspaceWrite(current);
        if (!current.workspaceId)
          throw new FoundryContextError(
            "workspace_not_initialized",
            "Initialize the selected workspace before starting a task.",
          );
        const selectedSpec = readSpec(path.resolve(current.workspaceRoot, input.specFile));
        const inputs = selectedInputs(current.workspaceRoot, selectedSpec.spec);
        const selectedSeed = seed(selectedSpec.spec, inputs);
        assertNotInterrupted(options.signal);
        const record = await registerFoundryFacadeTask(current, {
          specSource: selectedSpec.fact,
          spec: selectedSpec.spec,
          inputs,
          createOrLoad: (id) => {
            const context = createFoundryRuntimeContext({
              ...contextOptions(options),
              workspace: current!.workspaceRoot,
              taskId: id,
              actorId: selectedSpec.spec.actor_id,
              accountIntent: accountIntent(selectedSpec.spec, options.accountIntent),
              inputs,
            });
            const task = createFoundryRuntime(context).startTask({
              requestId: selectedSpec.spec.request_id,
              lane: selectedSpec.spec.lane,
              profileId: selectedSpec.spec.profile_id,
              targetEntities: [...selectedSpec.spec.target_entities],
              seed: selectedSeed,
              ...(selectedSpec.spec.repair ? { repair: selectedSpec.spec.repair } : {}),
            });
            return {
              created_at_utc: task.job.created_at_utc,
              inputs_sha256: sha256Json(task.sources),
            };
          },
        });
        taskId = record.task_id;
        assertNotInterrupted(options.signal);
        const context = taskContext(options, current, record);
        const inspected = await createFoundryRuntime(context).inspectTask();
        assertNotInterrupted(options.signal);
        loadFoundryFacadeTaskRecord(current, record.task_id, record.spec.actor_id);
        const result = taskProjection(
          "task.start",
          context,
          record,
          inspected,
          runtimeIdentity(context),
        );
        const requestIndex = path.join(
          current.stateRoot,
          "facade-requests",
          `${record.request_sha256}.json`,
        );
        return createFoundryOperationResult({
          ...result,
          operation: "task.start",
          taskId: record.task_id,
          artifacts: [
            fileArtifact("facade_request_index", requestIndex),
            fileArtifact("foundry_job", path.join(context.taskRoot!, "foundry-job.json")),
            ...result.artifacts,
          ],
          nextActions: result.next_actions,
          runtimeIdentity: result.runtime_identity,
          permissions: result.permissions,
        });
      } catch (error) {
        return failure("task.start", taskId, error, current ? runtimeIdentity(current) : null);
      }
    },
    async prepareInput(input: {
      taskId: string;
      actorId: string;
      kind: "interaction" | "semantic";
      draftFile: string;
    }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        assertNotInterrupted(options.signal);
        current = base();
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const runtime = createFoundryRuntime(context, qualified);
        const before = await runtime.inspectTask();
        if (input.kind !== "interaction" && input.kind !== "semantic")
          throw new FoundryContextError(
            "task_input_draft_invalid",
            "Select interaction or semantic input preparation.",
          );
        const descriptor = prepareFoundryTaskInput(
          context,
          before.artifacts,
          record.spec.target_entities,
          input.kind,
          input.draftFile,
        );
        const after = await runtime.inspectTask();
        if (sha256Json(before.artifacts) !== sha256Json(after.artifacts))
          throw new FoundryContextError(
            "task_input_state_changed",
            "Task evidence changed during input preparation. Inspect the current task and prepare again.",
          );
        assertNotInterrupted(options.signal);
        return createFoundryOperationResult({
          operation: "task.prepare-input",
          status: "ready",
          taskId: record.task_id,
          artifacts: [inlineArtifact("prepared_task_input", descriptor)],
          blockers: [],
          nextActions: [
            human(
              "save_prepared_task_input",
              `Save the prepared_task_input value as JSON and submit it through task resume --${input.kind}-input. Its SHA-256 bindings name the current indexed state and exact raw file bytes. Review the selected decisions and evidence before submission.`,
            ),
          ],
          runtimeIdentity: runtimeIdentity(context, qualified),
          permissions: noPermission(),
        });
      } catch (error) {
        return failure(
          "task.prepare-input",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
    async status(input: { taskId: string; actorId: string }): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        assertNotInterrupted(options.signal);
        current = base();
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const inspected = await createFoundryRuntime(context, qualified).inspectTask();
        assertNotInterrupted(options.signal);
        const projection = taskProjection(
          "task.status",
          context,
          record,
          inspected,
          runtimeIdentity(context, qualified),
        );
        if (context.workspaceAccess === "read")
          return createFoundryOperationResult({
            ...projection,
            operation: "task.status",
            taskId: projection.task_id,
            nextActions: [
              human(
                "workspace_read_only",
                "This runtime can inspect retained task evidence. Select a write-qualified runtime before preparation or mutation.",
              ),
            ],
            runtimeIdentity: projection.runtime_identity,
            permissions: projection.permissions,
          });
        return projection;
      } catch (error) {
        return failure(
          "task.status",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
    async resume(input: FoundryResumeInput): Promise<FoundryOperationResult> {
      let current: ReturnType<typeof createFoundryRuntimeContext> | null = null;
      try {
        assertNotInterrupted(options.signal);
        validateResumeInputFlags(input);
        current = base();
        assertFoundryWorkspaceWrite(current);
        const record = loadFoundryFacadeTaskRecord(current, input.taskId, input.actorId);
        const context = taskContext(options, current, record);
        const qualified = qualification(context, options.runtimeSelection);
        const runtime = createFoundryRuntime(context, qualified);
        const before = await runtime.inspectTask();
        if (
          record.spec.repair &&
          (input.semanticInputFile ||
            input.referenceInputFile ||
            input.interactionInputFile ||
            input.qualityReviewInputFile)
        )
          throw new FoundryContextError(
            "repair_revision_required",
            "A repair keeps its before, candidate and contract immutable; changed inputs require an explicit revision.",
          );
        assertNotInterrupted(options.signal);
        loadFoundryFacadeTaskRecord(current, record.task_id, record.spec.actor_id);
        const existing = taskProjection(
          "task.resume",
          context,
          record,
          before,
          runtimeIdentity(context, qualified),
        );
        const stageParams = {
          options,
          current,
          record,
          context,
          qualified,
          runtime,
          before,
          input,
        };
        if (input.identityStageInputFile !== undefined)
          return await handleExplicitIdentityStageResume(stageParams, input.identityStageInputFile);
        if (
          (input.referenceInputFile ||
            input.interactionInputFile ||
            input.qualityReviewInputFile) &&
          existing.status === "completed"
        )
          throw new FoundryContextError(
            "execution_scope_completed",
            "A completed task cannot replace its reference evidence.",
          );
        if (existing.status === "completed" || existing.status === "blocked") return existing;
        const execution = completedOwnerScopes(context, before.artifacts);
        if (execution.pending.length)
          return await handlePendingOwnerReadbackResume({ ...stageParams, execution });
        if (input.interactionInputFile)
          return await handleInteractionInputResume(
            { ...stageParams, execution },
            input.interactionInputFile,
          );
        if (pendingFoundryIdentityStage(context, before.artifacts)) return existing;
        const unresolvedInteraction = currentFoundryInteractionState(context, before.artifacts);
        const hasUnresolvedInteraction = Boolean(
          unresolvedInteraction &&
          (currentFoundryQuestions(unresolvedInteraction.state).length ||
            currentFoundryInvestigations(unresolvedInteraction.state).length),
        );
        if (hasUnresolvedInteraction && input.authorizationInputFile)
          throw new FoundryContextError(
            "interaction_decision_pending",
            "Resolve the current question or investigation before write approval.",
          );
        if (input.referenceInputFile)
          return await handleReferenceInputResume(
            { ...stageParams, execution },
            input.referenceInputFile,
          );
        if (input.qualityReviewInputFile)
          return await handleQualityReviewInputResume(stageParams, input.qualityReviewInputFile);
        if (input.authorizationInputFile)
          return await handleAuthorizationInputResume(
            { ...stageParams, execution },
            input.authorizationInputFile,
          );
        if (input.semanticInputFile)
          return await handleSemanticInputResume(
            { ...stageParams, execution },
            input.semanticInputFile,
          );
        return await runAutomaticResumeStage({
          ...stageParams,
          existing,
          execution,
          hasUnresolvedInteraction,
        });
      } catch (error) {
        return failure(
          "task.resume",
          input.taskId,
          error,
          current ? runtimeIdentity(current) : null,
        );
      }
    },
  });
}
