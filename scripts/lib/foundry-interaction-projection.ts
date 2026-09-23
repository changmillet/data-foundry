import { sha256Json } from "./identity-preflight-proof.ts";
import type { FoundryInteractionState } from "./foundry-interaction-types.ts";

type Item = Readonly<Record<string, unknown>>;
const supportTypes = new Set(["contact", "source", "unitgroup", "flowproperty"]);

export function foundryInteractionScopeApplies(scope: unknown, type: string): boolean {
  return scope === null || scope === type || (scope === "support" && supportTypes.has(type));
}

function current(state: FoundryInteractionState) {
  const questions = new Map<string, Item>();
  const answers = new Map<string, Item>();
  const assumptions = new Map<string, Item>();
  const supersededQuestions = new Set<string>();
  const supersededAssumptions = new Set<string>();
  for (const item of state.events) {
    if (item.kind === "question") {
      questions.set(String(item.id), item);
      if (item.supersedes) supersededQuestions.add(String(item.supersedes));
    } else if (item.kind === "answer") {
      answers.set(String(item.question_id), item);
    } else if (item.kind === "assumption") {
      assumptions.set(String(item.id), item);
      if (item.supersedes) supersededAssumptions.add(String(item.supersedes));
    }
  }
  return { questions, answers, assumptions, supersededQuestions, supersededAssumptions };
}

export function currentFoundryQuestions(state: FoundryInteractionState): Item[] {
  const { questions, answers, supersededQuestions } = current(state);
  return [...questions.values()].filter(
    (question) =>
      !supersededQuestions.has(String(question.id)) && !answers.has(String(question.id)),
  );
}

export function currentFoundryInvestigations(state: FoundryInteractionState): Item[] {
  const { questions, answers, supersededQuestions } = current(state);
  return [...questions.values()].filter(
    (question) =>
      !supersededQuestions.has(String(question.id)) &&
      answers.get(String(question.id))?.disposition === "investigate",
  );
}

export function currentFoundryDecisions(state: FoundryInteractionState): Item[] {
  const { answers, supersededQuestions } = current(state);
  return [...answers.values()].filter(
    (answer) =>
      answer.disposition === "decided" && !supersededQuestions.has(String(answer.question_id)),
  );
}

export function currentFoundryDecisionsForType(
  state: FoundryInteractionState,
  type: string,
): Item[] {
  const { questions } = current(state);
  return currentFoundryDecisions(state).filter((answer) => {
    const scope = questions.get(String(answer.question_id))?.dataset_type;
    return foundryInteractionScopeApplies(scope, type);
  });
}

export function currentFoundryAssumptions(state: FoundryInteractionState): Item[] {
  const { assumptions, supersededAssumptions } = current(state);
  return [...assumptions.values()].filter(
    (assumption) => !supersededAssumptions.has(String(assumption.id)),
  );
}

export function currentFoundryAssumptionsForType(
  state: FoundryInteractionState,
  type: string,
): Item[] {
  return currentFoundryAssumptions(state).filter((assumption) =>
    foundryInteractionScopeApplies(assumption.dataset_type, type),
  );
}

export function applicableFoundryInteractionProjection(
  state: FoundryInteractionState,
  type: string,
) {
  const { questions } = current(state);
  const applies = (item: Item) => foundryInteractionScopeApplies(item.dataset_type, type);
  return {
    schema: "tiangong-foundry.interaction-context.v1",
    dataset_type: type,
    pending_questions: currentFoundryQuestions(state).filter(applies),
    investigations: currentFoundryInvestigations(state).filter(applies),
    decisions: currentFoundryDecisionsForType(state, type).map((answer) => ({
      question: questions.get(String(answer.question_id)),
      answer,
    })),
    ai_assumptions: currentFoundryAssumptionsForType(state, type),
  };
}

export function applicableFoundryInteractionDigest(
  state: FoundryInteractionState | null,
  type: string,
): string | null {
  if (!state) return null;
  const projected = applicableFoundryInteractionProjection(state, type);
  if (
    !projected.pending_questions.length &&
    !projected.investigations.length &&
    !projected.decisions.length &&
    !projected.ai_assumptions.length
  )
    return null;
  return sha256Json(projected);
}
