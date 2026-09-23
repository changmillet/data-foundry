import { FoundryContextError } from "./foundry-runtime-context.ts";
import type { FoundrySemanticInput } from "./foundry-semantic-input.ts";
import type { FoundryInteractionState } from "./foundry-interaction-input.ts";
import {
  currentFoundryDecisionsForType,
  currentFoundryQuestions,
  currentFoundryInvestigations,
  foundryInteractionScopeApplies,
} from "./foundry-interaction-projection.ts";

export interface SemanticInteractionScope {
  readonly work_item_sha256: string;
  readonly dataset_type: string;
  readonly decision_ids: readonly string[];
}

function fail(message: string): never {
  throw new FoundryContextError("semantic_interaction_invalid", message);
}

/** Bind a semantic proposal to the latest applicable user choices without treating them as data proof. */
export function verifyFoundrySemanticInteraction(
  input: FoundrySemanticInput,
  interaction: { readonly sha256: string; readonly state: FoundryInteractionState } | null,
  selectedScopes: ReadonlyMap<string, string>,
): readonly SemanticInteractionScope[] {
  if ((input.interaction_sha256 ?? null) !== (interaction?.sha256 ?? null))
    fail("Semantic input must name the current registered interaction state.");
  const result: SemanticInteractionScope[] = [];
  for (const part of input.submissions) {
    const type = selectedScopes.get(part.authoring_task_sha256);
    if (!type) fail("Semantic work is not in the current assessed scope.");
    const expected = interaction
      ? currentFoundryDecisionsForType(interaction.state, type).map((decision) =>
          String(decision.decision_id),
        )
      : [];
    const actual = part.decision_ids ?? [];
    if (
      expected.length !== actual.length ||
      expected.some((id) => !actual.includes(id)) ||
      actual.some((id) => !expected.includes(id))
    )
      fail("Semantic work must name exactly the current applicable user decision ids.");
    if (interaction) {
      const unresolved = [
        ...currentFoundryQuestions(interaction.state),
        ...currentFoundryInvestigations(interaction.state),
      ];
      if (unresolved.some((item) => foundryInteractionScopeApplies(item.dataset_type, type)))
        fail(
          "Resolve or investigate the current decision gap before applying dependent semantic work.",
        );
    }
    result.push(
      Object.freeze({
        work_item_sha256: part.authoring_task_sha256,
        dataset_type: type,
        decision_ids: Object.freeze([...expected]),
      }),
    );
  }
  return Object.freeze(result);
}
