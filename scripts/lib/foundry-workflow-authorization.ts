import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertSelectedAuthorizationInput,
  type SelectedAuthorizationInput,
} from "./foundry-authorization-input.ts";
import { readSelectedSemanticBytes } from "./foundry-semantic-input.ts";
import {
  FoundryContextError,
  readFoundryInput,
  captureFoundryInput,
  resolveFoundryInputPath,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
  type FoundryInputFact,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { currentWorkflowState, workflowObject } from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import {
  verifyFoundryRuntimeIdentity,
  assertVerifiedFoundryIdentity,
  type FoundryAuthentication,
  type VerifiedFoundryIdentity,
} from "./foundry-runtime-identity.ts";
import {
  registerFoundryTaskAuthorization,
  loadFoundryTaskAuthorization,
} from "./foundry-task-authorization.ts";
import { createFoundryAuthenticationEnvironment } from "./foundry-authentication-environment.ts";
import { createFoundryFinalizeOwners } from "./foundry-finalize-owners.ts";
import { createFoundryExecutionCapsule } from "./foundry-execution-admission.ts";
import { registerWorkflowStageFiles } from "./foundry-workflow-io.ts";
import { createFoundryCommandSpec, createFileArtifactFact } from "./foundry-command-spec.ts";
import { parseFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import type { ValidatedTaskAuthorization } from "./task-authorization.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { readNativeDraftHandoff } from "./finalize-owners/native-draft-handoff.ts";
import { foundryRepairSelection, readFoundryRepairPreparation } from "./foundry-workflow-repair.ts";
import { createFoundryRepairHandoffPlan } from "./foundry-repair-handoff.ts";
import { readTaskJson } from "./foundry-task-io.ts";

export async function authorizeFoundryWorkflow(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  selected: SelectedAuthorizationInput,
  authentication: FoundryAuthentication = { mode: "oauth" },
) {
  assertSelectedAuthorizationInput(selected);
  assertQualifiedFoundryRuntime(context, qualified);
  const state = currentWorkflowState(context, entries),
    spec = selected.spec;
  if (spec.input_kind === "repair_rows")
    return authorizeFoundryRepair(context, qualified, entries, selected, authentication, state);
  const finalization = state.finalization;
  if (state.authorization?.value.submission_sha256 === selected.descriptor.sha256)
    return state.authorization.value;
  if (!finalization || finalization.entry.sha256 !== spec.finalization_sha256)
    throw new FoundryContextError(
      "authorization_finalization_mismatch",
      "Approval must select the current finalization report.",
    );
  const scope = (finalization.value.sets as unknown[])
    .map(workflowObject)
    .find((item) => item.type === spec.dataset_type);
  if (!scope)
    throw new FoundryContextError(
      "authorization_scope_mismatch",
      "Approval dataset type is not in this finalization.",
    );
  const inputFile = spec.input_kind === "final_rows" ? scope.final_rows : scope.input_rows;
  if (typeof inputFile !== "string" || captureFoundryInput(inputFile).sha256 !== spec.input_sha256)
    throw new FoundryContextError(
      "authorization_input_mismatch",
      "Approval input must match the exact current scope bytes.",
    );
  readFoundryInput(context, inputFile);
  if (spec.input_kind === "final_rows" && scope.status !== "ready_for_remote_write")
    throw new FoundryContextError(
      "authorization_scope_not_ready",
      "Final-row approval requires a ready owner scope.",
    );
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  if (selected.executionContract) {
    try {
      readNativeDraftHandoff({
        contractFile: selected.executionContract.path,
        rowsFile: inputFile,
        datasetType: spec.dataset_type,
        targetUserId: context.accountIntent!.userId,
        verifiedProjectRef: context.accountIntent!.projectRef,
        stateCode: "0",
        relativePath: (file) => path.relative(context.workspaceRoot, file),
      });
    } catch {
      throw new FoundryContextError(
        "authorization_execution_contract_invalid",
        "Native draft contract must bind the current final rows, owner, project and draft state before authorization.",
      );
    }
  }
  const grant = JSON.parse(readSelectedSemanticBytes(selected.grant).toString("utf8"));
  const current = (index: readonly ArtifactEntry[]) => {
    assertSelectedAuthorizationInput(selected);
    if (
      currentWorkflowState(context, index).finalization?.entry.sha256 !== finalization.entry.sha256
    )
      throw new FoundryContextError(
        "authorization_finalization_changed",
        "Finalization changed before approval activation.",
      );
  };
  const registration = await registerFoundryTaskAuthorization(
    context,
    identity,
    {
      inputFile,
      grant,
      evidence: spec.evidence.map((item, index) => ({
        id: item.id,
        kind: item.kind,
        file: selected.evidence[index],
      })),
      expectedPreviousSha256: spec.expected_previous_sha256,
      validateCurrent: (_, index) => current(index),
    },
    qualified,
  );
  const authorization = await loadFoundryTaskAuthorization(context, identity, inputFile, qualified);
  return recordFoundryWorkflowAuthorization(
    context,
    qualified,
    identity,
    authorization,
    authentication,
    {
      inputFile,
      approvedInputFile: inputFile,
      scope,
      finalizationSha256: spec.finalization_sha256,
      datasetType: spec.dataset_type,
      inputKind: spec.input_kind,
      registration,
      submissionSha256: selected.descriptor.sha256,
      ...(selected.executionContract ? { executionContract: selected.executionContract } : {}),
      validateCurrent: current,
      operationOptions: {
        submission: selected.descriptor,
        grant: selected.grant,
        evidence: selected.evidence,
        finalization: spec.finalization_sha256,
        authorization: registration.authorization_sha256,
        ...(selected.executionContract ? { execution_contract: selected.executionContract } : {}),
      },
    },
  );
}

/**
 * The repair authority. A repair approval names the registered preparation report, never a
 * finalization: the report digest is the scope authority, the scope must be a prepared dispatchable
 * metadata repair of the locked generic profile, and the signed native contract must still bind the
 * immutable candidate rows and the exact owner account. No successor or closeout is produced here.
 */
async function authorizeFoundryRepair(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  selected: SelectedAuthorizationInput,
  authentication: FoundryAuthentication,
  state: ReturnType<typeof currentWorkflowState>,
) {
  const spec = selected.spec;
  const preparationFact = selected.repairPreparation!;
  if (state.authorization?.value.submission_sha256 === selected.descriptor.sha256)
    return state.authorization.value;
  const preparation = readFoundryRepairPreparation(context, entries);
  if (!preparation)
    throw new FoundryContextError(
      "authorization_repair_preparation_missing",
      "A repair approval requires the current registered preparation report.",
    );
  if (
    preparation.entry.sha256 !== spec.finalization_sha256 ||
    preparation.entry.sha256 !== preparationFact.sha256 ||
    preparation.entry.bytes !== preparationFact.bytes
  )
    throw new FoundryContextError(
      "authorization_repair_preparation_mismatch",
      "Approval must select the registered preparation report bytes of this scope.",
    );
  const value = preparation.value;
  if (value.status !== "prepared")
    throw new FoundryContextError(
      "authorization_repair_not_prepared",
      "Only a prepared dispatchable repair may be authorized; a no-change or blocked preparation carries no write authority.",
    );
  if (value.publication_ready !== false || value.remote_writes !== 0)
    throw new FoundryContextError(
      "authorization_repair_not_prepared",
      "Repair evidence must remain a non-publishing, zero-write preparation.",
    );
  const scope = workflowObject(value.scope);
  const reportedActions = Array.isArray(scope.actions) ? scope.actions.map(workflowObject) : [];
  if (scope.status !== "dispatchable" || !reportedActions.length)
    throw new FoundryContextError(
      "authorization_repair_scope_not_dispatchable",
      "A repair approval requires a dispatchable scope with at least one action.",
    );
  const job = readTaskJson(context, "foundry-job.json");
  if (job.target_profile !== "generic")
    throw new FoundryContextError(
      "authorization_repair_profile_unsupported",
      "The repair lane admits only the generic profile.",
    );
  const selection = foundryRepairSelection(context);
  const candidateFile = resolveFoundryInputPath(context, selection.candidate);
  const beforeFile = resolveFoundryInputPath(context, selection.before);
  const contractFile = selected.executionContract!.path;
  let native: ReturnType<typeof readNativeDraftHandoff>;
  try {
    native = readNativeDraftHandoff({
      contractFile,
      rowsFile: candidateFile,
      datasetType: spec.dataset_type,
      targetUserId: context.accountIntent!.userId,
      verifiedProjectRef: context.accountIntent!.projectRef,
      stateCode: "0",
      relativePath: (file) => path.relative(context.workspaceRoot, file),
    });
  } catch {
    throw new FoundryContextError(
      "authorization_execution_contract_invalid",
      "Native draft contract must bind the current repair candidate rows, owner, project and draft state.",
    );
  }
  const reportInputs = workflowObject(value.inputs);
  const sameFileBytes = (fact: unknown, file: string) => {
    const item = workflowObject(fact);
    const current = captureFoundryInput(file);
    return item.sha256 === current.sha256 && item.bytes === current.bytes;
  };
  if (
    workflowObject(value.contract).canonical_sha256 !== native.canonical_sha256 ||
    scope.contract_sha256 !== native.canonical_sha256 ||
    !sameFileBytes(reportInputs.contract, contractFile) ||
    !sameFileBytes(reportInputs.before, beforeFile) ||
    !sameFileBytes(reportInputs.candidate, candidateFile) ||
    workflowObject(reportInputs.candidate).sha256 !== spec.input_sha256
  )
    throw new FoundryContextError(
      "authorization_repair_scope_mismatch",
      "The registered preparation must bind the exact selected contract, before and candidate bytes.",
    );
  for (const [index, action] of native.contract.actions.entries()) {
    const reported = reportedActions[index];
    if (
      reportedActions.length !== native.contract.actions.length ||
      reported.action_id !== action.action_id ||
      reported.table !== action.table ||
      reported.id !== action.id ||
      reported.version !== action.version ||
      reported.before_sha256 !== action.before_sha256 ||
      reported.desired_sha256 !== action.desired_sha256
    )
      throw new FoundryContextError(
        "authorization_repair_action_mismatch",
        "Registered repair actions must equal the signed native contract actions.",
      );
  }
  const identity = verifyFoundryRuntimeIdentity(context, authentication, process.env, qualified);
  const grant = JSON.parse(readSelectedSemanticBytes(selected.grant).toString("utf8"));
  const current = (index: readonly ArtifactEntry[]) => {
    assertSelectedAuthorizationInput(selected);
    const again = readFoundryRepairPreparation(context, index);
    if (
      !again ||
      again.entry.sha256 !== preparation.entry.sha256 ||
      again.entry.bytes !== preparation.entry.bytes
    )
      throw new FoundryContextError(
        "authorization_repair_preparation_changed",
        "Repair evidence changed before approval activation.",
      );
  };
  const registration = await registerFoundryTaskAuthorization(
    context,
    identity,
    {
      inputFile: candidateFile,
      grant,
      evidence: spec.evidence.map((item, index) => ({
        id: item.id,
        kind: item.kind,
        file: selected.evidence[index],
      })),
      expectedPreviousSha256: spec.expected_previous_sha256,
      validateCurrent: (_, index) => current(index),
    },
    qualified,
  );
  const authorization = await loadFoundryTaskAuthorization(
    context,
    identity,
    candidateFile,
    qualified,
  );
  return recordFoundryWorkflowAuthorization(
    context,
    qualified,
    identity,
    authorization,
    authentication,
    {
      inputFile: candidateFile,
      approvedInputFile: candidateFile,
      scope: { type: spec.dataset_type, status: scope.status, actions: reportedActions },
      finalizationSha256: spec.finalization_sha256,
      datasetType: spec.dataset_type,
      inputKind: spec.input_kind,
      registration,
      submissionSha256: selected.descriptor.sha256,
      executionContract: selected.executionContract!,
      repairPreparation: preparationFact,
      validateCurrent: current,
      operationOptions: {
        submission: selected.descriptor,
        grant: selected.grant,
        evidence: selected.evidence,
        repair_preparation: selected.repairPreparation,
        finalization: spec.finalization_sha256,
        authorization: registration.authorization_sha256,
        execution_contract: selected.executionContract,
      },
    },
  );
}

/**
 * Re-bind every emitted handoff command to the host-selected execution inputs: the final-row fact is
 * re-derived from the approved file and every other bound artifact is resolved against the asset root.
 * The commands keep their exact argv, so only the artifact paths are normalized.
 */
function bindHandoffCommands(
  context: FoundryRuntimeContext,
  handoff: Record<string, unknown>,
  inputFile: string,
): Record<string, unknown> {
  const commands = workflowObject(handoff.commands);
  for (const key of ["commit", "post_write_verify"]) {
    if (!commands[key]) continue;
    const command = parseFoundryCommandSpec(commands[key]);
    commands[key] = createFoundryCommandSpec({
      executable: command.executable,
      argv: [...command.argv],
      binding: {
        artifacts: [
          createFileArtifactFact({ role: "final_rows", path: inputFile, filePath: inputFile }),
          ...command.binding.artifacts
            .filter((artifact) => artifact.role !== "final_rows")
            .map((artifact) => ({
              ...artifact,
              path: path.resolve(context.assetRoot, artifact.path),
            })),
        ],
      },
    });
  }
  return handoff;
}

export async function recordFoundryWorkflowAuthorization(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  identity: VerifiedFoundryIdentity,
  authorization: ValidatedTaskAuthorization,
  authentication: FoundryAuthentication,
  request: {
    inputFile: string;
    approvedInputFile: string;
    scope: Record<string, unknown>;
    finalizationSha256: string;
    datasetType: string;
    inputKind: "current_rows" | "final_rows" | "repair_rows";
    registration: { authorization_sha256: string; pointer_sha256: string };
    submissionSha256: string;
    executionContract?: FoundryInputFact;
    repairPreparation?: FoundryInputFact;
    operationOptions: Record<string, unknown>;
    validateCurrent: (index: readonly ArtifactEntry[]) => void;
  },
) {
  const { inputFile, scope, registration } = request;
  const nonce = randomUUID(),
    output = resolveFoundryOutput(context, `outputs/authorization/${nonce}`);
  const temporary = resolveFoundryOutput(context, `tmp/authorization-${nonce}`);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  let capsule: Awaited<ReturnType<typeof createFoundryExecutionCapsule>> | null = null;
  let handoff: Record<string, unknown> | null = null;
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent?.sessionReference,
    process.env,
  );
  environment.FOUNDRY_ACCOUNT_MODE = context.accountIntent?.accountMode ?? "ordinary";
  try {
    if (request.inputKind === "final_rows") {
      environment.FOUNDRY_VERIFIED_PROJECT_REF = context.accountIntent!.projectRef;
      environment.FOUNDRY_VERIFIED_USER_ID = context.accountIntent!.userId;
      const owners = createFoundryFinalizeOwners(context, qualified, temporary, {
        environment,
        tidasExecutable: qualified.tidas.executable_path,
      });
      handoff = workflowObject(
        owners.handoff.runDatasetCommitHandoffPlan({
          finalizeReport: scope.report,
          rowsFile: inputFile,
          mutationManifest: scope.mutation_manifest,
          outDir: path.join(output, "handoff"),
          targetUserId: context.accountIntent!.userId,
          accountMode: context.accountIntent?.accountMode ?? "ordinary",
          taskAuthorization: authorization,
          taskAuthorizationBinding: authorization.binding,
          profile: authorization.binding.profile_id,
          ...(request.executionContract
            ? { executionContractFile: request.executionContract.path }
            : {}),
        }),
      );
      handoff = bindHandoffCommands(context, handoff, inputFile);
      fs.writeFileSync(
        path.join(output, "handoff", "dataset-commit-handoff-plan.json"),
        JSON.stringify(handoff, null, 2) + "\n",
      );
      const command = workflowObject(handoff.commands).commit;
      if (command) {
        const requiredActions = authorization.allowed_actions.filter((action) =>
          request.datasetType === "flow"
            ? action === "elementary_flow_write" || action === "elementary_flow_create_new"
            : ["unitgroup", "flowproperty"].includes(request.datasetType)
              ? action === `${request.datasetType}_write` ||
                action === "canonical_support_local_mint"
              : false,
        );
        try {
          assertVerifiedFoundryIdentity(context, identity, qualified);
        } catch (error) {
          if (!(error instanceof FoundryContextError) || error.code !== "identity_receipt_stale")
            throw error;
        }
        const sealingIdentity = verifyFoundryRuntimeIdentity(
          context,
          authentication,
          process.env,
          qualified,
        );
        capsule = await createFoundryExecutionCapsule(context, qualified, sealingIdentity, {
          command: "dataset-commit-handoff-plan",
          approvedInputFile: request.approvedInputFile,
          finalRowsFile: inputFile,
          commandSpec: command,
          requiredActions,
          requiredQaWaivers: authorization.qa_waivers
            .filter((item) => item.dataset_type === request.datasetType)
            .map((item) => item.code),
        });
      }
    }
    if (request.inputKind === "repair_rows") {
      // The repair scope has no finalization: its write plan is the reviewed native save-draft
      // handoff over the immutable candidate rows and the selected execution contract. The capsule
      // seals exactly that command, and the owner execution request stays a separate later stage.
      const handoffDir = path.join(output, "handoff");
      fs.mkdirSync(handoffDir, { recursive: true, mode: 0o700 });
      handoff = bindHandoffCommands(
        context,
        createFoundryRepairHandoffPlan({
          context,
          candidateFile: inputFile,
          contractFile: request.executionContract!.path,
          outDir: handoffDir,
        }),
        inputFile,
      );
      fs.writeFileSync(
        path.join(handoffDir, "dataset-commit-handoff-plan.json"),
        JSON.stringify(handoff, null, 2) + "\n",
      );
      const command = workflowObject(handoff.commands).commit;
      if (command) {
        try {
          assertVerifiedFoundryIdentity(context, identity, qualified);
        } catch (error) {
          if (!(error instanceof FoundryContextError) || error.code !== "identity_receipt_stale")
            throw error;
        }
        const sealingIdentity = verifyFoundryRuntimeIdentity(
          context,
          authentication,
          process.env,
          qualified,
        );
        capsule = await createFoundryExecutionCapsule(context, qualified, sealingIdentity, {
          command: "dataset-commit-handoff-plan",
          approvedInputFile: request.approvedInputFile,
          finalRowsFile: inputFile,
          commandSpec: command,
          requiredActions: [],
          requiredQaWaivers: [],
        });
      }
    }
    return await runFoundryTaskOperation(
      context,
      {
        command: "dataset-workflow-authorization",
        options: request.operationOptions,
        validateCurrent: request.validateCurrent,
      },
      (operation) => {
        registerWorkflowStageFiles(context, operation, output);
        const result = {
          schema: "tiangong-foundry.authorization-stage.v1",
          status: capsule
            ? "sealed"
            : request.inputKind === "current_rows"
              ? "authorized_current_rows"
              : "handoff_blocked",
          finalization_sha256: request.finalizationSha256,
          dataset_type: request.datasetType,
          input_kind: request.inputKind,
          input: captureFoundryInput(inputFile),
          authorization_sha256: registration.authorization_sha256,
          pointer_sha256: registration.pointer_sha256,
          expires_at_utc: authorization.expires_at_utc,
          allowed_actions: [...authorization.allowed_actions],
          capsule,
          handoff,
          submission_sha256: request.submissionSha256,
          ...(request.repairPreparation
            ? { repair_preparation: { ...request.repairPreparation } }
            : {}),
        };
        operation.writeJson(path.join(output, "foundry-authorization.json"), result);
        return result;
      },
    );
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
