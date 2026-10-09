import path from "node:path";
import { FoundryContextError, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import { readWorkflowArtifact } from "./foundry-workflow-state.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";

/** Native indexed admissions remain visible even when result capture was interrupted. */
export function pendingFoundryIdentityStage(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  for (const entry of [...entries].reverse()) {
    if (
      entry.command !== "dataset-workflow-identity-stage-prepare" ||
      path.basename(entry.path) !== "identity-stage-preparation.json"
    )
      continue;
    const prepared = readWorkflowArtifact(context, entry);
    const stageId = prepared.value.stage_id;
    if (
      prepared.value.schema !== "tiangong-foundry.identity-stage-preparation.v1" ||
      typeof stageId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(stageId) ||
      prepared.value.task_id !== context.taskId ||
      prepared.value.actor_id !== context.actorId
    )
      throw new FoundryContextError(
        "identity_stage_unproven",
        "Indexed read-only stage admission is invalid; preserve its evidence without replay.",
      );
    const resultEntry = entries.findLast((candidate) => {
      if (
        candidate.command !== "dataset-workflow-identity" ||
        path.basename(candidate.path) !== "foundry-identity.json" ||
        candidate.sequence <= entry.sequence
      )
        return false;
      return readWorkflowArtifact(context, candidate).value.stage_id === stageId;
    });
    const result = resultEntry ? readWorkflowArtifact(context, resultEntry).value : null;
    if (
      result?.schema === "tiangong-foundry.identity-stage.v1" &&
      result.explicit_new_stage === true &&
      result.status === "completed"
    )
      continue;
    const claims = entries.filter(
      (candidate) =>
        candidate.command === "dataset-workflow-identity-stage-dispatch" &&
        candidate.sequence > entry.sequence &&
        candidate.path.startsWith(path.dirname(path.dirname(entry.path)) + "/"),
    );
    return Object.freeze({
      stage_id: stageId,
      intent_id: prepared.value.intent_id,
      preparation: { path: prepared.file, bytes: entry.bytes, sha256: entry.sha256 },
      indexed_dispatch_artifacts: claims.length,
      disposition: claims.length ? "CLAIMED_OUTCOME_UNPROVEN" : "PREPARED_OUTCOME_UNPROVEN",
      new_cli_execution: null,
      result_registered: result !== null,
    });
  }
  return null;
}

export function assertNoPendingFoundryIdentityStage(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
) {
  if (pendingFoundryIdentityStage(context, entries))
    throw new FoundryContextError(
      "identity_stage_unproven",
      "The indexed explicit read-only stage has no proven completed result. Inspect its admission and retained claims; ordinary resume cannot dispatch another query.",
    );
}
