import {
  diffPointers,
  evidenceForMerge,
  extractIdentity,
  mergeThreeWay,
} from "./three-way-merge.ts";
import {
  COMPARISON_SCHEMA,
  OWNER_ROW_SCHEMA,
  SAFE_TABLES,
  asToken,
  clone,
  compareText,
  conversionHashSets,
  entityKey,
  exact,
  matchingPrefix,
  normalizedEntity,
  policyForTable,
  sha256Json,
  type ComparisonRow,
  type ConversionResult,
  type IncrementalRequest,
  type JsonValue,
  type OwnerRow,
  type PreservationPolicy,
  type TerminalSuccessBinding,
} from "./types-and-primitives.ts";

export function preliminaryResult({
  comparison,
  inputSequence,
  ownerRows,
  policy,
  request,
  policySha256,
  duplicateConversions,
  duplicateTargets,
}: {
  comparison: ComparisonRow;
  inputSequence: number;
  ownerRows: Map<string, OwnerRow[]>;
  policy: PreservationPolicy;
  request: IncrementalRequest;
  policySha256: string;
  duplicateConversions: Set<string>;
  duplicateTargets: Set<string>;
}): ConversionResult {
  const started = performance.now();
  const entity = normalizedEntity(comparison.entity);
  const key = entityKey(entity);
  const requestedConversionId =
    asToken(comparison.conversion_id) || `invalid-line-${comparison.__line}`;
  const conversionId = duplicateConversions.has(requestedConversionId)
    ? `duplicate-line-${comparison.__line}-${comparison.__raw_sha256.slice(0, 12)}`
    : requestedConversionId;
  const tablePolicy = policyForTable(policy, entity.table);
  const oldPayload = comparison.old_payload ?? null;
  const candidatePayload = comparison.new_payload;
  const visibleRows = ownerRows.get(key) ?? [];
  const currentRow = visibleRows.length === 1 ? visibleRows[0] : null;
  const currentPayload = currentRow?.json_ordered ?? null;
  const domain = asToken(policy.semantic_domain) || "foundry-incremental-change-set-semantic.v1";
  const { hashes, noise_rules: normalizationRules } = conversionHashSets({
    oldValue: oldPayload,
    candidateValue: candidatePayload,
    currentValue: currentPayload,
    tablePolicy,
    entityKey: key,
    domain,
  });
  const result: ConversionResult = {
    input_sequence: inputSequence,
    source_line: comparison.__line,
    source_raw_sha256: comparison.__raw_sha256,
    conversion_id: conversionId,
    requested_conversion_id: requestedConversionId,
    entity,
    key,
    dependencies: [...comparison.dependency_conversion_ids],
    old_payload: oldPayload,
    candidate_payload: candidatePayload,
    current_payload: currentPayload,
    desired_payload: null,
    hashes,
    merge: {
      value: currentPayload,
      conflicts: [],
      preserved_paths: [],
      applied_paths: [],
      noise_paths: normalizationRules.map((rule) => rule.pointer),
      noise_evidence_sha256: normalizationRules.map((rule) => rule.evidence_sha256),
      preserve_owner_evidence_sha256: [],
      take_candidate_evidence_sha256: [],
      stable_array_evidence_sha256: [],
    },
    evidence: {
      policy_sha256: policySha256,
      noise_evidence_sha256: normalizationRules.map((rule) => rule.evidence_sha256),
      preserve_owner_evidence_sha256: [],
      take_candidate_evidence_sha256: [],
      stable_array_evidence_sha256: [],
    },
    terminal_success: null,
    disposition: "HOLD",
    reason_codes: [],
    expected_operation: null,
    before_sha256: null,
    desired_sha256: null,
    action_id: null,
    dependency_action_ids: [],
    dependency_dispositions: [],
    duration_ms: 0,
  };
  const hold = (reason: string): ConversionResult => {
    result.reason_codes.push(reason);
    result.duration_ms = Math.max(0, performance.now() - started);
    return result;
  };

  if (comparison.schema_version !== COMPARISON_SCHEMA) return hold("HOLD_SCHEMA_MISMATCH");
  if (!SAFE_TABLES.has(entity.table)) return hold("HOLD_UNKNOWN_TABLE");
  if (!request.scope.allowed_tables.includes(entity.table)) return hold("HOLD_SCOPE_WIDENING");
  if (!request.scope.allowed_target_keys.includes(key)) return hold("HOLD_SCOPE_WIDENING");
  if (!entity.id || !entity.version) return hold("HOLD_IDENTITY_MISMATCH");
  if (duplicateConversions.has(result.requested_conversion_id)) {
    return hold("HOLD_DUPLICATE_CONVERSION_ID");
  }
  if (duplicateTargets.has(key)) return hold("HOLD_DUPLICATE_TARGET");
  for (const [label, payload] of [
    ["old", oldPayload],
    ["candidate", candidatePayload],
  ] as const) {
    const expectedHash = comparison[`${label}_payload_sha256`];
    if (expectedHash !== hashes[label].payload_sha256) {
      return hold("HOLD_PAYLOAD_HASH_MISMATCH");
    }
    if (payload == null) continue;
    const identity = extractIdentity(payload, entity.table);
    if (identity.id !== entity.id || identity.version !== entity.version) {
      return hold("HOLD_IDENTITY_MISMATCH");
    }
  }
  if (visibleRows.length > 1) return hold("HOLD_MULTIPLE_VISIBLE_ROWS");
  if (currentRow) {
    if (currentRow.schema_version !== OWNER_ROW_SCHEMA || currentRow.role !== "writable_target") {
      return hold("HOLD_FOREIGN_OWNER");
    }
    if (
      currentRow.project_ref !== request.project_ref ||
      currentRow.owner?.user_id !== request.owner.user_id ||
      String(currentRow.owner?.email ?? "").toLowerCase() !== request.owner.email.toLowerCase()
    ) {
      return hold("HOLD_FOREIGN_OWNER");
    }
    if (currentRow.state_code !== 0) return hold("HOLD_PUBLIC_OR_FOREIGN_STATE");
    if (
      currentRow.payload_sha256 != null &&
      currentRow.payload_sha256 !== hashes.current.payload_sha256
    ) {
      return hold("HOLD_PAYLOAD_HASH_MISMATCH");
    }
    const identity = extractIdentity(currentPayload, entity.table);
    if (identity.id !== entity.id || identity.version !== entity.version) {
      return hold("HOLD_IDENTITY_MISMATCH");
    }
  }

  if (candidatePayload == null) {
    if (currentPayload == null) {
      result.disposition = "NOOP";
      result.reason_codes = ["NOOP_ALREADY_ABSENT"];
    } else {
      return hold("HOLD_DELETE_FORBIDDEN");
    }
  } else if (oldPayload == null && currentPayload == null) {
    if (!tablePolicy.allow_insert) return hold("HOLD_INSERT_NOT_ALLOWED");
    result.desired_payload = clone(candidatePayload);
    result.disposition = "INSERT";
    result.reason_codes = ["INSERT_NEW_ENTITY"];
    result.expected_operation = "insert";
  } else if (oldPayload != null && currentPayload == null) {
    return hold("HOLD_HISTORICAL_OWNER_GAP");
  } else if (oldPayload == null && currentPayload != null) {
    if (exact(candidatePayload, currentPayload)) {
      result.desired_payload = clone(currentPayload);
      result.disposition = "NOOP";
      result.reason_codes = ["NOOP_EXACT_DESIRED"];
    } else {
      return hold("HOLD_IDENTITY_COLLISION");
    }
  } else {
    const merged = mergeThreeWay({
      oldValue: oldPayload,
      candidateValue: candidatePayload,
      currentValue: currentPayload,
      tablePolicy,
      entityKey: key,
    });
    result.merge = merged;
    result.evidence = evidenceForMerge(policySha256, merged);
    if (merged.conflicts.length) {
      result.reason_codes = [
        ...new Set(
          merged.conflicts.map((conflict) =>
            conflict.reason === "unattributed_current_drift"
              ? "HOLD_UNATTRIBUTED_CURRENT_DRIFT"
              : conflict.reason === "array_identity_unstable"
                ? "HOLD_ARRAY_IDENTITY_UNSTABLE"
                : "HOLD_THREE_WAY_CONFLICT",
          ),
        ),
      ];
      result.duration_ms = Math.max(0, performance.now() - started);
      return result;
    }
    result.desired_payload = merged.value as JsonValue;
    if (exact(result.desired_payload, currentPayload)) {
      result.disposition = "NOOP";
      result.reason_codes = [
        merged.preserved_paths.length ? "NOOP_PRESERVED_OWNER" : "NOOP_EXACT_DESIRED",
      ];
    } else {
      const changedPointers = diffPointers(currentPayload, result.desired_payload);
      const allowedPrefixes = request.scope.allowed_update_pointer_prefixes[entity.table] ?? [];
      const forbidden = changedPointers.filter(
        (pointer) => matchingPrefix(allowedPrefixes, pointer) == null,
      );
      if (!tablePolicy.allow_update || forbidden.length) {
        result.reason_codes = ["HOLD_UPDATE_SCOPE_FORBIDDEN"];
        result.merge.forbidden_paths = forbidden;
        result.duration_ms = Math.max(0, performance.now() - started);
        return result;
      }
      result.disposition = "UPDATE";
      result.reason_codes = ["UPDATE_THREE_WAY_MERGE"];
      result.expected_operation = "save_draft";
    }
  }

  if (result.disposition === "INSERT" || result.disposition === "UPDATE") {
    if (
      ["unitgroups", "flowproperties"].includes(entity.table) &&
      request.scope.allow_account_local_support !== true
    ) {
      result.disposition = "HOLD";
      result.reason_codes = ["HOLD_SUPPORT_ACTION_NOT_AUTHORIZED"];
      result.expected_operation = null;
      result.desired_payload = null;
      result.duration_ms = Math.max(0, performance.now() - started);
      return result;
    }
    const desiredIdentity = extractIdentity(result.desired_payload, entity.table);
    if (desiredIdentity.id !== entity.id || desiredIdentity.version !== entity.version) {
      result.disposition = "HOLD";
      result.reason_codes = ["HOLD_DESIRED_IDENTITY_MISMATCH"];
      result.expected_operation = null;
      result.desired_payload = null;
      result.duration_ms = Math.max(0, performance.now() - started);
      return result;
    }
    result.before_sha256 = result.disposition === "UPDATE" ? hashes.current.payload_sha256 : null;
    result.desired_sha256 = sha256Json(result.desired_payload);
    result.action_id = `${result.conversion_id}@${result.desired_sha256}`;
  } else if (result.disposition === "NOOP" && result.desired_payload != null) {
    result.desired_sha256 = sha256Json(result.desired_payload);
  }
  result.duration_ms = Math.max(0, performance.now() - started);
  return result;
}

export function duplicateValues(values: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function actionComparator(policy: PreservationPolicy) {
  const ranks = new Map<string, number>(
    (policy.type_rank ?? []).map((table, index) => [table, index]),
  );
  return (left: ConversionResult, right: ConversionResult): number =>
    (ranks.get(left.entity.table) ?? Number.MAX_SAFE_INTEGER) -
      (ranks.get(right.entity.table) ?? Number.MAX_SAFE_INTEGER) ||
    compareText(left.key, right.key) ||
    compareText(left.conversion_id, right.conversion_id);
}

export function terminalPairKey(actionId: string, desiredSha256: string): string {
  return `${actionId}\0${desiredSha256}`;
}

function noopSatisfiesDependency(result: ConversionResult | undefined): boolean {
  return (
    result?.disposition === "NOOP" &&
    (result.terminal_success != null ||
      (result.current_payload != null &&
        result.desired_payload != null &&
        exact(result.current_payload, result.desired_payload)))
  );
}

export function consumeTerminalExclusions(
  results: ConversionResult[],
  exclusions: TerminalSuccessBinding[],
): Set<string> {
  const consumedConversions = new Set<string>();
  for (const exclusion of exclusions) {
    const matches = results.filter((result) => {
      const candidatePair =
        ["INSERT", "UPDATE"].includes(result.disposition) &&
        result.action_id === exclusion.action_id &&
        result.desired_sha256 === exclusion.desired_sha256;
      const exactCurrentRecovery =
        noopSatisfiesDependency(result) &&
        result.terminal_success == null &&
        result.desired_sha256 === exclusion.desired_sha256 &&
        `${result.conversion_id}@${result.desired_sha256}` === exclusion.action_id;
      return candidatePair || exactCurrentRecovery;
    });
    if (matches.length !== 1) {
      throw new Error(
        `Terminal exclusion ${exclusion.action_id} must consume exactly one candidate action or exact-current recovery NOOP.`,
      );
    }
    const result = matches[0];
    if (consumedConversions.has(result.conversion_id)) {
      throw new Error(`Terminal exclusion duplicates conversion ${result.conversion_id}.`);
    }
    consumedConversions.add(result.conversion_id);
    const wasAction = ["INSERT", "UPDATE"].includes(result.disposition);
    result.disposition = "NOOP";
    result.reason_codes = [wasAction ? "NOOP_TERMINAL_SUCCESS" : "NOOP_TERMINAL_SUCCESS_RECOVERED"];
    result.expected_operation = null;
    result.action_id = null;
    result.dependency_action_ids = [];
    result.terminal_success = exclusion;
  }
  return consumedConversions;
}

export function assignDependencyDispositions(results: ConversionResult[]): void {
  const byId = new Map<string, ConversionResult>(
    results.map((result) => [result.conversion_id, result]),
  );
  const isAction = (result: ConversionResult | undefined) =>
    result?.disposition === "INSERT" || result?.disposition === "UPDATE";
  for (const result of results) {
    result.dependency_dispositions = result.dependencies.map((dependencyId) => {
      const dependency = byId.get(dependencyId);
      let disposition = "held_missing";
      if (dependency?.disposition === "HOLD") disposition = "held_dependency";
      else if (isAction(dependency)) disposition = "satisfied_by_action";
      else if (dependency?.terminal_success != null) disposition = "satisfied_terminal_success";
      else if (noopSatisfiesDependency(dependency)) disposition = "satisfied_current_exact";
      return { dependency_conversion_id: dependencyId, disposition };
    });
  }
}

export function orderAndCloseDependencies(
  results: ConversionResult[],
  policy: PreservationPolicy,
): ConversionResult[] {
  const byId = new Map<string, ConversionResult>(
    results.map((result) => [result.conversion_id, result]),
  );
  const isAction = (result: ConversionResult) =>
    result.disposition === "INSERT" || result.disposition === "UPDATE";

  let changed = true;
  while (changed) {
    changed = false;
    for (const result of results) {
      if (!isAction(result)) continue;
      const missing = result.dependencies.filter((dependencyId) => !byId.has(dependencyId));
      const held = result.dependencies.filter(
        (dependencyId) => byId.get(dependencyId)?.disposition === "HOLD",
      );
      const absent = result.dependencies.filter((dependencyId) => {
        const dependency = byId.get(dependencyId);
        return dependency?.disposition === "NOOP" && !noopSatisfiesDependency(dependency);
      });
      if (missing.length || held.length || absent.length) {
        result.disposition = "HOLD";
        result.reason_codes = [
          missing.length
            ? "HOLD_MISSING_DEPENDENCY"
            : absent.length
              ? "HOLD_DEPENDENCY_ABSENT"
              : "HOLD_DEPENDENCY",
        ];
        result.expected_operation = null;
        result.action_id = null;
        changed = true;
      }
    }
  }

  const comparator = actionComparator(policy);
  function topological(): { actions: ConversionResult[]; ordered: ConversionResult[] } {
    const actions = results.filter(isAction);
    const actionIds = new Set<string>(actions.map((result) => result.conversion_id));
    const indegree = new Map<string, number>(actions.map((result) => [result.conversion_id, 0]));
    const dependants = new Map<string, string[]>(
      actions.map((result) => [result.conversion_id, []]),
    );
    for (const result of actions) {
      for (const dependencyId of result.dependencies.filter((id) => actionIds.has(id))) {
        indegree.set(result.conversion_id, (indegree.get(result.conversion_id) ?? 0) + 1);
        dependants.get(dependencyId)!.push(result.conversion_id);
      }
    }
    const ready = actions
      .filter((result) => indegree.get(result.conversion_id) === 0)
      .sort(comparator);
    const ordered: ConversionResult[] = [];
    while (ready.length) {
      const next = ready.shift();
      ordered.push(next!);
      for (const dependantId of dependants.get(next!.conversion_id) ?? []) {
        indegree.set(dependantId, (indegree.get(dependantId) ?? 0) - 1);
        if (indegree.get(dependantId) === 0) {
          ready.push(byId.get(dependantId)!);
          ready.sort(comparator);
        }
      }
    }
    return { actions, ordered };
  }

  let topology = topological();
  if (topology.ordered.length !== topology.actions.length) {
    const orderedIds = new Set(topology.ordered.map((result) => result.conversion_id));
    for (const result of topology.actions.filter((value) => !orderedIds.has(value.conversion_id))) {
      result.disposition = "HOLD";
      result.reason_codes = ["HOLD_DEPENDENCY_CYCLE"];
      result.expected_operation = null;
      result.action_id = null;
    }
    changed = true;
    while (changed) {
      changed = false;
      for (const result of results) {
        if (!isAction(result)) continue;
        if (result.dependencies.some((id) => byId.get(id)?.disposition === "HOLD")) {
          result.disposition = "HOLD";
          result.reason_codes = ["HOLD_DEPENDENCY"];
          result.expected_operation = null;
          result.action_id = null;
          changed = true;
        }
      }
    }
    topology = topological();
  }

  const orderedIds = new Set<string>();
  for (const result of topology.ordered) {
    result.dependency_action_ids = result.dependencies
      .map((dependencyId) => byId.get(dependencyId))
      .filter((dependency): dependency is ConversionResult =>
        Boolean(dependency && isAction(dependency)),
      )
      .map((dependency) => dependency.action_id!);
    if (result.dependency_action_ids.some((id) => !orderedIds.has(id))) {
      throw new Error(`Internal dependency order failure for ${result.conversion_id}.`);
    }
    orderedIds.add(result.action_id!);
  }

  assignDependencyDispositions(results);
  return topology.ordered;
}
