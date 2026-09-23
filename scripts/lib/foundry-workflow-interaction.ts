import path from "node:path";
import {
  FoundryContextError,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import {
  advanceFoundryInteractionState,
  assertSelectedFoundryInteractionInput,
  currentFoundryInteractionState,
  FOUNDRY_INTERACTION_COMMAND,
  FOUNDRY_INTERACTION_REPORT,
  readSelectedFoundryInteractionBytes,
  type SelectedFoundryInteractionInput,
} from "./foundry-interaction-input.ts";
import { readWorkflowArtifact } from "./foundry-workflow-state.ts";
import { createWorkflowStageDirectory } from "./foundry-workflow-io.ts";

const resultName = "interaction-result.json";

function priorSubmission(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  sha256: string,
): Record<string, unknown> | null {
  for (const entry of [...entries].reverse()) {
    if (entry.command !== FOUNDRY_INTERACTION_COMMAND || path.basename(entry.path) !== resultName)
      continue;
    const report = readWorkflowArtifact(context, entry).value;
    if (
      report.schema === "tiangong-foundry.interaction-result.v1" &&
      report.descriptor_sha256 === sha256
    )
      return report;
  }
  return null;
}

export async function recordFoundryInteractionInput(
  context: FoundryRuntimeContext,
  entries: readonly ArtifactEntry[],
  selected: SelectedFoundryInteractionInput,
  targetEntities: readonly string[],
): Promise<Record<string, unknown>> {
  assertSelectedFoundryInteractionInput(selected);
  const prior = priorSubmission(context, entries, selected.descriptor.sha256);
  if (prior) return prior;
  const current = currentFoundryInteractionState(context, entries);
  const currentSha = current?.entry.sha256 ?? null;
  const known = new Set([
    ...context.inputs.map((fact) => fact.sha256),
    ...entries.map((entry) => entry.sha256),
  ]);
  const accepted = advanceFoundryInteractionState(
    current?.state ?? null,
    selected.spec,
    currentSha,
    known,
    new Set(targetEntities),
  );
  return runFoundryTaskOperation(
    context,
    {
      command: FOUNDRY_INTERACTION_COMMAND,
      options: {
        descriptor: selected.descriptor,
        expected_state_sha256: currentSha,
      },
      validateCurrent(index) {
        if (
          index.some((entry) =>
            ["dataset-workflow-execution-prepare", "dataset-workflow-execution-consume"].includes(
              entry.command,
            ),
          )
        )
          throw new FoundryContextError(
            "interaction_after_approval",
            "Preserve the approved or attempted scope; a changed decision needs a separately reviewed task revision.",
          );
        const present = currentFoundryInteractionState(context, index);
        if ((present?.entry.sha256 ?? null) !== currentSha)
          throw new FoundryContextError(
            "interaction_state_changed",
            "Interaction state changed before this input acquired the task lock.",
          );
      },
    },
    (operation) => {
      assertSelectedFoundryInteractionInput(selected);
      for (const input of context.inputs) readFoundryInput(context, input.path);
      const freshBytes = readSelectedFoundryInteractionBytes(selected.descriptor);
      const output = createWorkflowStageDirectory(context, operation, "interaction");
      operation.writeText(path.join(output, "interaction-input.json"), freshBytes);
      operation.writeJson(path.join(output, FOUNDRY_INTERACTION_REPORT), accepted);
      const result = {
        schema: "tiangong-foundry.interaction-result.v1",
        status: "completed",
        task_id: selected.spec.task_id,
        descriptor_sha256: selected.descriptor.sha256,
        previous_state_sha256: currentSha,
        event_count: accepted.events.length,
      };
      operation.writeJson(path.join(output, resultName), result);
      return result;
    },
  );
}
