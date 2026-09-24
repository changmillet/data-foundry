import { sha256Json } from "./identity-preflight-proof.ts";
import type { FoundryInteractionState } from "./foundry-interaction-types.ts";
import {
  foundryInteractionEventAppliesToObject,
  foundryInteractionScopeApplies,
} from "./foundry-interaction-scope.ts";
export {
  foundryInteractionEventAppliesToObject,
  foundryInteractionScopeApplies,
} from "./foundry-interaction-scope.ts";

type Item = Readonly<Record<string, unknown>>;
const broad = (item: Item) => !Object.hasOwn(item, "object_scope");

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
    const question = questions.get(String(answer.question_id));
    return (
      question && broad(question) && foundryInteractionScopeApplies(question.dataset_type, type)
    );
  });
}

export function currentFoundryQuestionsForObject(
  state: FoundryInteractionState,
  type: string,
  entityId: string,
  version: string,
): Item[] {
  return currentFoundryQuestions(state).filter((question) =>
    foundryInteractionEventAppliesToObject(question, type, entityId, version),
  );
}

export function currentFoundryInvestigationsForObject(
  state: FoundryInteractionState,
  type: string,
  entityId: string,
  version: string,
): Item[] {
  return currentFoundryInvestigations(state).filter((question) =>
    foundryInteractionEventAppliesToObject(question, type, entityId, version),
  );
}

export function currentFoundryDecisionsForObject(
  state: FoundryInteractionState,
  type: string,
  entityId: string,
  version: string,
): Item[] {
  const { questions } = current(state);
  return currentFoundryDecisions(state).filter((answer) => {
    const question = questions.get(String(answer.question_id));
    return question && foundryInteractionEventAppliesToObject(question, type, entityId, version);
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
  return currentFoundryAssumptions(state).filter(
    (assumption) =>
      broad(assumption) && foundryInteractionScopeApplies(assumption.dataset_type, type),
  );
}

export function currentFoundryAssumptionsForObject(
  state: FoundryInteractionState,
  type: string,
  entityId: string,
  version: string,
): Item[] {
  return currentFoundryAssumptions(state).filter((assumption) =>
    foundryInteractionEventAppliesToObject(assumption, type, entityId, version),
  );
}

export function applicableFoundryInteractionProjection(
  state: FoundryInteractionState,
  type: string,
) {
  const { questions } = current(state);
  const applies = (item: Item) =>
    broad(item) && foundryInteractionScopeApplies(item.dataset_type, type);
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

export function applicableFoundryInteractionProjectionForObject(
  state: FoundryInteractionState,
  type: string,
  entityId: string,
  version: string,
) {
  const { questions } = current(state);
  return {
    schema: "tiangong-foundry.interaction-context.v1",
    dataset_type: type,
    object_scope: { entity_id: entityId, version },
    pending_questions: currentFoundryQuestionsForObject(state, type, entityId, version),
    investigations: currentFoundryInvestigationsForObject(state, type, entityId, version),
    decisions: currentFoundryDecisionsForObject(state, type, entityId, version).map((answer) => ({
      question: questions.get(String(answer.question_id)),
      answer,
    })),
    ai_assumptions: currentFoundryAssumptionsForObject(state, type, entityId, version),
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

export function applicableFoundryInteractionDigestForObject(
  state: FoundryInteractionState | null,
  type: string,
  entityId: string,
  version: string,
): string | null {
  if (!state) return null;
  const projected = applicableFoundryInteractionProjectionForObject(state, type, entityId, version);
  if (
    !projected.pending_questions.length &&
    !projected.investigations.length &&
    !projected.decisions.length &&
    !projected.ai_assumptions.length
  )
    return null;
  return sha256Json(projected);
}
