import { FoundryContextError } from "./foundry-runtime-context.ts";
import type { FoundrySemanticInput } from "./foundry-semantic-input.ts";
import type { FoundryInteractionState } from "./foundry-interaction-input.ts";
import {
  currentFoundryDecisionsForType,
  currentFoundryDecisionsForObject,
  currentFoundryDecisions,
  currentFoundryQuestions,
  currentFoundryQuestionsForObject,
  currentFoundryInvestigations,
  currentFoundryInvestigationsForObject,
  currentFoundryAssumptions,
  foundryInteractionScopeApplies,
} from "./foundry-interaction-projection.ts";

export interface SemanticObjectIdentity {
  readonly dataset_type: string;
  readonly entity_id: string;
  readonly version: string;
}

export interface SemanticInteractionScope {
  readonly work_item_sha256: string;
  readonly dataset_type: string;
  readonly decision_ids: readonly string[];
  readonly object_scope?: Readonly<{ entity_id: string; version: string }>;
}

function fail(message: string): never {
  throw new FoundryContextError("semantic_interaction_invalid", message);
}

function hasCurrentNarrowInteraction(state: FoundryInteractionState, type: string): boolean {
  const questions = new Map(
    state.events.filter((item) => item.kind === "question").map((item) => [String(item.id), item]),
  );
  return [
    ...currentFoundryQuestions(state),
    ...currentFoundryInvestigations(state),
    ...currentFoundryAssumptions(state),
    ...currentFoundryDecisions(state).map((item) => questions.get(String(item.question_id))),
  ].some((item) => item?.dataset_type === type && Object.hasOwn(item, "object_scope"));
}

/** Bind a semantic proposal to the latest applicable user choices without treating them as data proof. */
export function verifyFoundrySemanticInteraction(
  input: FoundrySemanticInput,
  interaction: { readonly sha256: string; readonly state: FoundryInteractionState } | null,
  selectedScopes: ReadonlyMap<string, string | SemanticObjectIdentity>,
): readonly SemanticInteractionScope[] {
  if ((input.interaction_sha256 ?? null) !== (interaction?.sha256 ?? null))
    fail("Semantic input must name the current registered interaction state.");
  const result: SemanticInteractionScope[] = [];
  for (const part of input.submissions) {
    const selected = selectedScopes.get(part.authoring_task_sha256);
    if (!selected) fail("Semantic work is not in the current assessed scope.");
    const type = typeof selected === "string" ? selected : selected.dataset_type;
    const object = typeof selected === "string" ? null : selected;
    if (object && (!object.entity_id || !object.version))
      fail("Semantic work has no verified current object identity.");
    const expected = interaction
      ? (object
          ? currentFoundryDecisionsForObject(
              interaction.state,
              type,
              object.entity_id,
              object.version,
            )
          : currentFoundryDecisionsForType(interaction.state, type)
        ).map((decision) => String(decision.decision_id))
      : [];
    const actual = part.decision_ids ?? [];
    if (
      expected.length !== actual.length ||
      expected.some((id) => !actual.includes(id)) ||
      actual.some((id) => !expected.includes(id))
    )
      fail("Semantic work must name exactly the current applicable user decision ids.");
    if (interaction) {
      const unresolved = object
        ? [
            ...currentFoundryQuestionsForObject(
              interaction.state,
              type,
              object.entity_id,
              object.version,
            ),
            ...currentFoundryInvestigationsForObject(
              interaction.state,
              type,
              object.entity_id,
              object.version,
            ),
          ]
        : [
            ...currentFoundryQuestions(interaction.state),
            ...currentFoundryInvestigations(interaction.state),
          ].filter((item) => foundryInteractionScopeApplies(item.dataset_type, type));
      if (unresolved.length)
        fail(
          "Resolve or investigate the current decision gap before applying dependent semantic work.",
        );
      if (!object && hasCurrentNarrowInteraction(interaction.state, type))
        fail("A multi-object semantic owner cannot prove the applicable object decision scope.");
    }
    result.push(
      Object.freeze({
        work_item_sha256: part.authoring_task_sha256,
        dataset_type: type,
        decision_ids: Object.freeze([...expected]),
        ...(object
          ? {
              object_scope: Object.freeze({ entity_id: object.entity_id, version: object.version }),
            }
          : {}),
      }),
    );
  }
  return Object.freeze(result);
}
