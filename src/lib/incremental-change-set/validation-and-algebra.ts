import { assertSchema } from "./artifacts-and-schemas.ts";
import { terminalPairKey } from "./dependencies-and-closure.ts";
import {
  CLI_CONTRACT_SCHEMA,
  OWNER_SNAPSHOT_RECEIPT_SCHEMA,
  POLICY_SCHEMA,
  REQUEST_SCHEMA,
  SAFE_TABLES,
  SHA256_PATTERN,
  asToken,
  compareText,
  exact,
  isObject,
  sha256Json,
  type ArtifactFacts,
  type ConversionEvent,
  type ConversionResult,
  type ExecutionContract,
  type IncrementalRequest,
  type JsonObject,
  type JsonValue,
  type OwnerSnapshotReceipt,
  type PreservationPolicy,
  type RequestScope,
  type SchemaRuntime,
  type TerminalSuccessBinding,
} from "./types-and-primitives.ts";

function isNonRootJsonPointer(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "/" &&
    /^(?:\/(?:[^~/]|~[01])*)+$/u.test(value)
  );
}

export function validateRequest(request: IncrementalRequest): void {
  if (
    request?.schema_version !== REQUEST_SCHEMA ||
    request?.target_mode !== "owner_draft" ||
    !Object.is(request?.production_authority, false) ||
    !asToken(request.change_set_id) ||
    !asToken(request.producer_id) ||
    !asToken(request.project_ref) ||
    !asToken(request.owner?.user_id) ||
    !asToken(request.owner?.email) ||
    request.owner?.state_code !== 0 ||
    !isObject(request.scope) ||
    !Array.isArray(request.scope.allowed_tables) ||
    !Array.isArray(request.scope.allowed_target_keys) ||
    !isObject(request.scope.allowed_update_pointer_prefixes) ||
    typeof request.scope.allow_account_local_support !== "boolean"
  ) {
    throw new Error("Incremental change-set request header is invalid.");
  }
  if (
    request.scope.allowed_tables.length === 0 ||
    request.scope.allowed_tables.some((table) => !SAFE_TABLES.has(table)) ||
    new Set(request.scope.allowed_tables).size !== request.scope.allowed_tables.length ||
    new Set(request.scope.allowed_target_keys).size !== request.scope.allowed_target_keys.length
  ) {
    throw new Error("Incremental change-set request scope is invalid.");
  }
  const allowedTableSet = new Set(request.scope.allowed_tables);
  const pointerTables = Object.keys(request.scope.allowed_update_pointer_prefixes);
  if (
    pointerTables.length !== allowedTableSet.size ||
    pointerTables.some((table) => !allowedTableSet.has(table)) ||
    request.scope.allowed_target_keys.some((key) => {
      const table = key.split("/", 1)[0];
      return !allowedTableSet.has(table) || !key.includes("@") || !key.includes("/");
    })
  ) {
    throw new Error("Incremental change-set request scope bindings are incomplete.");
  }
  for (const [table, pointers] of Object.entries(request.scope.allowed_update_pointer_prefixes)) {
    if (
      !Array.isArray(pointers) ||
      new Set(pointers).size !== pointers.length ||
      pointers.some((pointer) => !isNonRootJsonPointer(pointer))
    ) {
      throw new Error(`${table} update pointer scope must contain unique non-root JSON pointers.`);
    }
  }
  if (
    request.consumer?.schema_version !== CLI_CONTRACT_SCHEMA ||
    !asToken(request.consumer?.cli_version) ||
    !SHA256_PATTERN.test(request.consumer?.toolchain_fingerprint_sha256 ?? "")
  ) {
    throw new Error("Incremental change-set CLI consumer binding is invalid.");
  }
}

export function validatePolicy(policy: PreservationPolicy, request: IncrementalRequest): void {
  if (policy?.schema_version !== POLICY_SCHEMA || !isObject(policy.table_policies)) {
    throw new Error("Incremental change-set preservation policy is invalid.");
  }
  const policyTables = Object.keys(policy.table_policies);
  if (
    policyTables.length !== request.scope.allowed_tables.length ||
    policyTables.some((table) => !request.scope.allowed_tables.includes(table))
  ) {
    throw new Error("Preservation policy tables must exactly match request allowed tables.");
  }
  if (
    !Array.isArray(policy.type_rank) ||
    new Set(policy.type_rank).size !== policy.type_rank.length ||
    policy.type_rank.some((table) => !request.scope.allowed_tables.includes(table))
  ) {
    throw new Error("Preservation policy type_rank is invalid.");
  }
  const requestedTargets = new Set(request.scope.allowed_target_keys);
  const ruleFields = ["semantic_noise_rules", "conflict_rules", "array_merge_rules"] as const;
  for (const [table, tablePolicy] of Object.entries(policy.table_policies)) {
    if (!SAFE_TABLES.has(table) || !isObject(tablePolicy)) {
      throw new Error(`Invalid preservation policy table: ${table}`);
    }
    for (const field of ruleFields) {
      if (!Array.isArray(tablePolicy[field]))
        throw new Error(`${table}.${field} must be an array.`);
    }
    for (const field of ruleFields) {
      const identities = new Set<string>();
      for (const rule of tablePolicy[field]) {
        if (
          !requestedTargets.has(rule.entity_key) ||
          !rule.entity_key.startsWith(`${table}/`) ||
          !isNonRootJsonPointer(rule.pointer) ||
          !SHA256_PATTERN.test(rule.evidence_sha256)
        ) {
          throw new Error(`${table}.${field} contains an out-of-scope or unbound rule.`);
        }
        const identity = `${rule.entity_key}\0${rule.pointer}`;
        if (identities.has(identity)) {
          throw new Error(`${table}.${field} contains a duplicate entity/path rule.`);
        }
        identities.add(identity);
        if (field === "array_merge_rules" && !isNonRootJsonPointer(rule.element_identity_pointer)) {
          throw new Error(`${table}.array_merge_rules requires a non-root identity pointer.`);
        }
      }
    }
  }
}

function canonicalRequestScope(scope: RequestScope): JsonObject {
  return {
    allowed_tables: [...scope.allowed_tables].sort(compareText),
    allowed_target_keys: [...scope.allowed_target_keys].sort(compareText),
    allowed_update_pointer_prefixes: Object.fromEntries(
      Object.entries(scope.allowed_update_pointer_prefixes)
        .sort(([left], [right]) => compareText(left, right))
        .map(([table, pointers]) => [table, [...pointers].sort(compareText)]),
    ),
    allow_account_local_support: scope.allow_account_local_support,
  };
}

export function validateOwnerSnapshotReceipt(
  receipt: OwnerSnapshotReceipt,
  request: IncrementalRequest,
  ownerFacts: ArtifactFacts,
  ownerSnapshotLines: Map<string, Array<{ raw_sha256: string }>>,
): void {
  const canonicalTargetKeys = [...request.scope.allowed_target_keys].sort(compareText);
  const expectedLedger = canonicalTargetKeys.map((key) => {
    const lines = ownerSnapshotLines.get(key) ?? [];
    if (lines.length > 1) {
      throw new Error(`Owner snapshot has multiple rows for target ${key}.`);
    }
    return {
      entity_key: key,
      presence: lines.length === 1 ? "present" : "absent",
      snapshot_row_sha256: lines.length === 1 ? lines[0].raw_sha256 : null,
    };
  });
  if (
    receipt.schema_version !== OWNER_SNAPSHOT_RECEIPT_SCHEMA ||
    receipt.project_ref !== request.project_ref ||
    receipt.owner.user_id !== request.owner.user_id ||
    receipt.owner.email.toLowerCase() !== request.owner.email.toLowerCase() ||
    receipt.owner.state_code !== 0 ||
    receipt.snapshot.sha256 !== ownerFacts.sha256 ||
    receipt.snapshot.bytes !== ownerFacts.bytes ||
    receipt.snapshot.rows !== ownerFacts.rows ||
    !exact(receipt.scope_binding.allowed_target_keys, canonicalTargetKeys) ||
    receipt.scope_binding.allowed_target_keys_sha256 !== sha256Json(canonicalTargetKeys) ||
    receipt.scope_binding.canonical_scope_sha256 !==
      sha256Json(canonicalRequestScope(request.scope)) ||
    !exact(receipt.target_ledger, expectedLedger) ||
    !Number.isFinite(Date.parse(receipt.captured_at_utc))
  ) {
    throw new Error(
      "Owner snapshot receipt does not bind the requested owner/project/scope/target ledger.",
    );
  }
}

export function decisionForResult(result: ConversionResult): JsonObject {
  return {
    conversion_id: result.conversion_id,
    entity: result.entity,
    input_hashes: result.hashes,
    disposition: result.disposition,
    reason_codes: result.reason_codes,
    expected_operation: result.expected_operation,
    before_sha256: result.before_sha256,
    desired_sha256: result.desired_sha256,
    dependencies: result.dependencies,
    dependency_action_ids: result.dependency_action_ids,
    evidence: result.evidence,
    terminal_success: result.terminal_success,
    preserved_paths: result.merge.preserved_paths,
    applied_paths: result.merge.applied_paths,
    noise_paths: result.merge.noise_paths,
  };
}

export function validateCompositionAlgebra({
  schemaRuntime,
  results,
  orderedActions,
  noWrites,
  holds,
  delta,
  contract,
  dependencyClosure,
  events,
  terminalExclusions,
}: {
  schemaRuntime: SchemaRuntime;
  results: ConversionResult[];
  orderedActions: ConversionResult[];
  noWrites: JsonObject[];
  holds: JsonObject[];
  delta: JsonValue[];
  contract: ExecutionContract | null;
  dependencyClosure: JsonObject;
  events: ConversionEvent[];
  terminalExclusions: TerminalSuccessBinding[];
}): { terminal_replay_zero: boolean } {
  noWrites.forEach((row, index) =>
    assertSchema(schemaRuntime, "noWriteRow", row, `no-write[${index}]`),
  );
  holds.forEach((row, index) => assertSchema(schemaRuntime, "holdRow", row, `hold[${index}]`));
  assertSchema(schemaRuntime, "dependencyClosure", dependencyClosure, "dependency closure");
  if (contract) assertSchema(schemaRuntime, "cliContract", contract, "CLI execution contract");
  events.forEach((event, index) =>
    assertSchema(schemaRuntime, "conversionEvent", event, `event[${index}]`),
  );

  if (
    results.length !== noWrites.length + holds.length + orderedActions.length ||
    orderedActions.length !== delta.length ||
    events.length !== results.length ||
    new Set(results.map((result) => result.conversion_id)).size !== results.length
  ) {
    throw new Error("Incremental change-set disposition algebra failed.");
  }
  const terminalPairs = new Set<string>(
    terminalExclusions.map((entry) => terminalPairKey(entry.action_id, entry.desired_sha256)),
  );
  const consumedTerminalPairs = new Set<string>(
    results
      .filter((result) => result.terminal_success != null)
      .map((result) =>
        terminalPairKey(
          result.terminal_success!.action_id,
          result.terminal_success!.desired_sha256,
        ),
      ),
  );
  const replayedTerminalActions = orderedActions.filter((result) =>
    terminalPairs.has(terminalPairKey(result.action_id!, result.desired_sha256!)),
  );
  const terminalReplayZero =
    terminalPairs.size === terminalExclusions.length &&
    consumedTerminalPairs.size === terminalExclusions.length &&
    [...terminalPairs].every((pair) => consumedTerminalPairs.has(pair)) &&
    replayedTerminalActions.length === 0;
  if (!terminalReplayZero) {
    throw new Error("Terminal exclusion consumption/replay algebra failed.");
  }
  const earlierActionIds = new Set<string>();
  for (const [index, result] of orderedActions.entries()) {
    if (
      !["INSERT", "UPDATE"].includes(result.disposition) ||
      sha256Json(delta[index]) !== result.desired_sha256 ||
      result.action_id == null ||
      terminalPairs.has(terminalPairKey(result.action_id, result.desired_sha256)) ||
      (result.disposition === "INSERT" && result.before_sha256 !== null) ||
      (result.disposition === "UPDATE" && !SHA256_PATTERN.test(result.before_sha256 ?? "")) ||
      result.dependency_action_ids.some((actionId) => !earlierActionIds.has(actionId))
    ) {
      throw new Error(`Action algebra failed for ${result.conversion_id}.`);
    }
    earlierActionIds.add(result.action_id);
  }
  for (const result of results) {
    if (result.disposition === "NOOP") {
      const validAbsent =
        result.reason_codes.includes("NOOP_ALREADY_ABSENT") &&
        result.current_payload == null &&
        result.desired_payload == null;
      const validExact =
        result.current_payload != null &&
        result.desired_payload != null &&
        exact(result.current_payload, result.desired_payload);
      const validTerminal = result.terminal_success != null;
      if (!validAbsent && !validExact && !validTerminal) {
        throw new Error(`NOOP algebra failed for ${result.conversion_id}.`);
      }
    }
    if (
      result.disposition === "HOLD" &&
      (result.action_id !== null || result.expected_operation !== null)
    ) {
      throw new Error(`HOLD algebra failed for ${result.conversion_id}.`);
    }
  }
  let previous = null;
  for (const [index, event] of events.entries()) {
    const result = results[index];
    const { event_sha256: eventSha256, ...unsignedEvent } = event;
    if (
      event.previous_event_sha256 !== previous ||
      !exact(event.evidence, result.evidence) ||
      !exact(event.outcome.terminal_success, result.terminal_success) ||
      event.decision_binding_sha256 !== sha256Json(decisionForResult(result)) ||
      eventSha256 !== sha256Json(unsignedEvent)
    ) {
      throw new Error(`Conversion event hash chain failed at sequence ${index + 1}.`);
    }
    previous = eventSha256;
  }
  return { terminal_replay_zero: terminalReplayZero };
}
