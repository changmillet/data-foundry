import type { FoundryRepairExpectation } from "./foundry-repair-preflight.ts";
import path from "node:path";
import { commandSpecOptionValue } from "@tiangong-lca/cli/command-spec";
import {
  captureFoundryInput,
  FoundryContextError,
  resolveFoundryInputPath,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import { readTaskJson } from "./foundry-task-io.ts";
import { readFoundryRepairPreparation, foundryRepairSelection } from "./foundry-workflow-repair.ts";
import { readWorkflowArtifact, workflowObject } from "./foundry-workflow-state.ts";
import type { OwnerExecutionRequest } from "./foundry-owner-execution-store.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

/** Re-admit the immutable repair scope at execution and readback; never infer it from a handoff flag. */
export function assertFoundryRepairExecution(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  request: OwnerExecutionRequest,
) {
  const job = readTaskJson(context, "foundry-job.json");
  if (job.lane !== "existing-owner-draft-repair") return null;
  const fail = (): never => {
    throw new FoundryContextError(
      "repair_execution_mismatch",
      "Repair execution must retain its exact prepared scope, owner contract and authorized candidate.",
    );
  };
  const preparation = readFoundryRepairPreparation(context, entries);
  const approvalEntry = entries.find(
    (entry) =>
      entry.command === "dataset-workflow-authorization" &&
      entry.sha256 === request.content.authorization &&
      path.basename(entry.path) === "foundry-authorization.json",
  );
  if (!preparation || !approvalEntry) return fail();
  const handoffEntry = entries.find(
    (entry) =>
      path.resolve(context.taskRoot!, entry.path) === request.handoff_file &&
      entry.operation_id === approvalEntry.operation_id &&
      entry.command === approvalEntry.command &&
      entry.receipt.sha256 === approvalEntry.receipt.sha256,
  );
  if (!handoffEntry) return fail();
  const handoff = readWorkflowArtifact(context, handoffEntry).value;
  const approval = readWorkflowArtifact(context, approvalEntry).value;
  const selection = foundryRepairSelection(context);
  const candidate = captureFoundryInput(resolveFoundryInputPath(context, selection.candidate));
  const contractFile = commandSpecOptionValue(request.content.commit, "--execution-contract");
  if (!contractFile) return fail();
  const contract = captureFoundryInput(contractFile);
  const expectedContract = workflowObject(workflowObject(preparation.value.inputs).contract);
  if (
    job.target_profile !== "generic" ||
    handoff.repair_scope !== true ||
    preparation.value.status !== "prepared" ||
    preparation.value.publication_ready !== false ||
    approval.input_kind !== "repair_rows" ||
    approval.finalization_sha256 !== preparation.entry.sha256 ||
    approval.status !== "sealed" ||
    candidate.path !== request.content.input.path ||
    candidate.bytes !== request.content.input.bytes ||
    candidate.sha256 !== request.content.input.sha256 ||
    contract.bytes !== expectedContract.bytes ||
    contract.sha256 !== expectedContract.sha256 ||
    request.policy.dataset_type !== "process" ||
    request.policy.state_code !== 0 ||
    request.policy.user_id !== context.accountIntent?.userId ||
    request.policy.project_ref !== context.accountIntent.projectRef
  )
    return fail();
  const scope = workflowObject(preparation.value.scope);
  const contractProof = workflowObject(preparation.value.contract);
  const expectation: FoundryRepairExpectation = {
    dataset_type: "process",
    contract_sha256: String(scope.contract_sha256),
    execution_id: String(contractProof.execution_id),
    owner_user_id: context.accountIntent.userId,
    project_ref: context.accountIntent.projectRef,
    state_code: "0",
    actions: scope.actions as FoundryRepairExpectation["actions"],
  };
  return {
    preparation,
    handoff,
    expectation,
    beforeFile: resolveFoundryInputPath(context, selection.before),
  };
}
