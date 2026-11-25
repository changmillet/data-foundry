export const FOUNDRY_INTERACTION_INPUT_SCHEMA = "tiangong-foundry.interaction-input.v1" as const;
export const FOUNDRY_INTERACTION_STATE_SCHEMA = "tiangong-foundry.interaction-state.v1" as const;
export const FOUNDRY_INTERACTION_COMMAND = "dataset-workflow-interaction" as const;
export const FOUNDRY_INTERACTION_REPORT = "interaction-state.json" as const;

export interface FoundryInteractionObjectScope {
  readonly entity_id: string;
  readonly version: string;
  readonly row_sha256: string;
}

export interface FoundryInteractionInput {
  readonly schema: typeof FOUNDRY_INTERACTION_INPUT_SCHEMA;
  readonly task_id: string;
  readonly actor_id: string;
  readonly expected_state_sha256: string | null;
  readonly events: readonly Readonly<Record<string, unknown>>[];
}

export interface FoundryInteractionState {
  readonly schema: typeof FOUNDRY_INTERACTION_STATE_SCHEMA;
  readonly task_id: string;
  readonly actor_id: string;
  readonly events: readonly Readonly<Record<string, unknown>>[];
}
