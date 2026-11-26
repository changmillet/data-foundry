import { actionId, addProcessLanguage, conversionActionId } from "./admission-and-audit.ts";
import {
  candidateExchanges,
  collectSupportReferences,
  decimalEqual,
  exchangeFlowIdentity,
  leafClassificationCode,
  occurrenceKeyedExchanges,
  overlayChineseDescription,
  referenceIdentity,
  setFlowClassification,
} from "./exchange-and-overlay.ts";
import {
  ABSENCE_DOMAIN,
  SHA256_PATTERN,
  asToken,
  assertPayloadIdentity,
  clone,
  compareText,
  entityKey,
  jsonLines,
  loadCandidate,
  loadSnapshotPayload,
  sha256Json,
  type ActionRow,
  type CandidateRow,
  type ClassificationRow,
  type ConversionEventWriter,
  type FlowMapping,
  type GermanSynonym,
  type JsonObject,
  type JsonlWriter,
  type SnapshotIndex,
  type TopologyRequest,
  type VerifiedArtifact,
} from "./types-and-io.ts";

export interface TopologyWriters {
  events: ConversionEventWriter;
  flowCreate: JsonlWriter;
  flowNoWrite: JsonlWriter;
  processInput: JsonlWriter;
  processNoWrite: JsonlWriter;
  deleteCandidates: JsonlWriter;
  protectedNoWrite: JsonlWriter;
  holds: JsonlWriter;
  ambiguity: JsonlWriter;
}

/** Reconciles candidate flow creations, reuse, support closure, and zero-inbound delete candidates. */
export function reconcileFlowsAndDeleteCandidates({
  request,
  candidateFlows,
  classifications,
  ownerFlows,
  publicFlows,
  foreignFlows,
  writers,
  flowActions,
  targetFlowKeys,
  findings,
  counts,
}: {
  request: TopologyRequest;
  candidateFlows: CandidateRow[];
  classifications: Map<string, ClassificationRow>;
  ownerFlows: SnapshotIndex;
  publicFlows: SnapshotIndex;
  foreignFlows: SnapshotIndex;
  writers: TopologyWriters;
  flowActions: ActionRow[];
  targetFlowKeys: Set<string>;
  findings: JsonObject[];
  counts: Record<string, number>;
}): void {
  const supportSeen: Record<string, Set<string>> = {
    flowproperties: new Set<string>(),
    unitgroups: new Set<string>(),
  };
  if (classifications.size !== candidateFlows.length) {
    findings.push({ severity: "P0", code: "TARGET_CLASSIFICATION_CLOSURE_MISMATCH" });
  }
  if (
    candidateFlows.filter((row) => row.entity.id === request.classification_policy.conflict_flow_id)
      .length !== 1
  ) {
    findings.push({ severity: "P0", code: "CLASSIFICATION_CONFLICT_TARGET_MISMATCH" });
  }
  for (const row of candidateFlows) {
    const payload = loadCandidate(row);
    assertPayloadIdentity(payload, row.entity);
    const key = entityKey(row.entity);
    const classification = classifications.get(key);
    if (!classification) {
      counts.flow_hold += 1;
      writers.holds.write({
        schema_version: "foundry-topology-hold.v1",
        entity: row.entity,
        reason: "MISSING_AUDITED_CLASSIFICATION",
      });
      continue;
    }
    const selectedLeaf = leafClassificationCode(classification.classification);
    if (classification.selected_code != null && classification.selected_code !== selectedLeaf) {
      findings.push({
        severity: "P0",
        code: "CLASSIFICATION_SELECTED_CODE_MISMATCH",
        entity: row.entity,
      });
    }
    if (
      row.entity.id === request.classification_policy.conflict_flow_id &&
      (classification.selected_code !== request.classification_policy.selected_code ||
        selectedLeaf !== request.classification_policy.selected_code)
    ) {
      findings.push({
        severity: "P0",
        code: "CLASSIFICATION_CONFLICT_OVERRIDE_MISMATCH",
        entity: row.entity,
      });
    }
    const desired = clone(payload);
    setFlowClassification(desired, classification.classification);
    const refsSeen = collectSupportReferences(desired);
    for (const identity of refsSeen.flowproperties) supportSeen.flowproperties.add(identity);
    for (const identity of refsSeen.unitgroups) supportSeen.unitgroups.add(identity);
    const desiredSha = sha256Json(desired);
    const action = actionId(row.entity, desiredSha);
    const ownerRows = ownerFlows.byKey.get(key) ?? [];
    const publicRows = publicFlows.byKey.get(key) ?? [];
    const foreignRows = foreignFlows?.byKey.get(key) ?? [];
    let mappingKind: string;
    let reason: string;
    let beforeSha: string | null = null;
    if (ownerRows.length > 1 || publicRows.length > 1) {
      mappingKind = "HOLD";
      reason = "NON_UNIQUE_VISIBLE_TARGET";
    } else if (ownerRows.length === 1) {
      beforeSha = ownerRows[0].payload_sha256;
      mappingKind = beforeSha === desiredSha ? "OWNER_DESIRED_EXACT_NO_WRITE" : "HOLD";
      reason =
        beforeSha === desiredSha ? "OWNER_TARGET_ALREADY_EXACT" : "OWNER_TARGET_CONTENT_CONFLICT";
    } else if (publicRows.length === 1) {
      beforeSha = publicRows[0].payload_sha256;
      mappingKind = beforeSha === desiredSha ? "PUBLIC_EXACT_REUSE" : "HOLD";
      reason =
        beforeSha === desiredSha ? "PUBLIC_TARGET_ALREADY_EXACT" : "PUBLIC_TARGET_CONTENT_CONFLICT";
    } else if (foreignRows.length) {
      mappingKind = "HOLD";
      reason = "FOREIGN_ONLY_TARGET";
    } else {
      mappingKind = "CREATE";
      reason = "TARGET_GLOBALLY_ABSENT";
    }
    if (mappingKind === "CREATE") {
      writers.flowCreate.write(desired);
      flowActions.push({
        action_id: action,
        desired_sha256: desiredSha,
        expected_operation: "insert",
        table: "flows",
        id: row.entity.id,
        version: row.entity.version,
        before_sha256: null,
        dependency_action_ids: [],
      });
      counts.flow_create += 1;
    } else if (
      mappingKind === "OWNER_DESIRED_EXACT_NO_WRITE" ||
      mappingKind === "PUBLIC_EXACT_REUSE"
    ) {
      writers.flowNoWrite.write({
        schema_version: "foundry-topology-flow-no-write.v1",
        action_id: action,
        entity: row.entity,
        disposition: mappingKind,
        before_sha256: beforeSha,
        desired_sha256: desiredSha,
      });
      counts[mappingKind === "PUBLIC_EXACT_REUSE" ? "flow_public_reuse" : "flow_owner_no_write"] +=
        1;
    } else {
      writers.holds.write({
        schema_version: "foundry-topology-hold.v1",
        entity: row.entity,
        reason,
        before_sha256: beforeSha,
        desired_sha256: desiredSha,
      });
      findings.push({ severity: "P0", code: reason, entity: row.entity });
      counts.flow_hold += 1;
    }
    writers.events.event({
      action_id: action,
      entity: row.entity,
      exchange_key: null,
      mapping_kind: mappingKind,
      reason,
      before_sha: beforeSha,
      desired_sha: desiredSha,
      evidence_sha256: classification.evidence_sha256,
    });
  }

  const allowedSupport = {
    flowproperties: new Set(request.canonical_support.flowproperties),
    unitgroups: new Set(request.canonical_support.unitgroups),
  };
  for (const type of ["flowproperties", "unitgroups"] as const) {
    for (const identity of supportSeen[type]) {
      if (!allowedSupport[type].has(identity)) {
        findings.push({
          severity: "P0",
          code: "NON_CANONICAL_SUPPORT_REFERENCE",
          type,
          identity,
        });
      }
    }
  }

  for (const entry of ownerFlows.entries.sort((left, right) =>
    compareText(entityKey(left.entity), entityKey(right.entity)),
  )) {
    if (targetFlowKeys.has(entityKey(entry.entity))) continue;
    const desiredSha = sha256Json({
      schema_version: ABSENCE_DOMAIN,
      entity: entry.entity,
      absent: true,
    });
    const action = conversionActionId(entry.entity, "delete", null, desiredSha);
    writers.deleteCandidates.write({
      schema_version: "foundry-topology-flow-delete-candidate.v1",
      action_id: action,
      entity: entry.entity,
      before_sha256: entry.payload_sha256,
      desired_sha256: desiredSha,
      required_inbound_ref_count: 0,
      authorized_visibility: "owner_draft",
      authorized_state_code: 0,
    });
    writers.events.event({
      action_id: action,
      entity: entry.entity,
      exchange_key: null,
      mapping_kind: "DELETE_CANDIDATE",
      reason: "OWNER_FLOW_OUTSIDE_CANDIDATE_CLOSURE_PENDING_ZERO_INBOUND",
      before_sha: entry.payload_sha256,
      desired_sha: desiredSha,
    });
    counts.obsolete_flow_delete_candidates += 1;
  }
}

/** Reconciles occurrence-keyed process exchanges, protected sources, and topology algebra checks. */
export function reconcileProcessesAndAlgebra({
  request,
  candidateProcesses,
  ownerProcesses,
  german,
  mappings,
  protectedNoWriteRef,
  targetFlowKeys,
  targetFlowIds,
  writers,
  processActions,
  findings,
  counts,
}: {
  request: TopologyRequest;
  candidateProcesses: CandidateRow[];
  ownerProcesses: SnapshotIndex;
  german: Map<string, GermanSynonym>;
  mappings: { rows: FlowMapping[]; byPair: Map<string, FlowMapping> };
  protectedNoWriteRef: VerifiedArtifact;
  targetFlowKeys: Set<string>;
  targetFlowIds: Set<string>;
  writers: TopologyWriters;
  processActions: ActionRow[];
  findings: JsonObject[];
  counts: Record<string, number>;
}): { processFlowEdges: JsonObject[]; exactChecks: Record<string, boolean> } {
  const processFlowEdges: JsonObject[] = [];
  const candidateProcessIds = new Set(candidateProcesses.map((row) => row.entity.id));
  for (const processRow of candidateProcesses) {
    const candidate = loadCandidate(processRow);
    assertPayloadIdentity(candidate, processRow.entity);
    const processKey = entityKey(processRow.entity);
    const currentRows = ownerProcesses.byKey.get(processKey) ?? [];
    if (currentRows.length > 1) {
      writers.holds.write({
        schema_version: "foundry-topology-hold.v1",
        entity: processRow.entity,
        reason: "NON_UNIQUE_OWNER_PROCESS_TARGET",
      });
      findings.push({
        severity: "P0",
        code: "NON_UNIQUE_OWNER_PROCESS_TARGET",
        entity: processRow.entity,
      });
      counts.process_hold += 1;
      continue;
    }
    const current = currentRows.length ? loadSnapshotPayload(ownerProcesses, currentRows[0]) : null;
    const candidateOrdered = occurrenceKeyedExchanges(
      candidateExchanges(candidate),
      processRow.entity.id,
    );
    const currentOrdered = current
      ? occurrenceKeyedExchanges(candidateExchanges(current), processRow.entity.id)
      : [];
    const currentByKey = new Map(currentOrdered.map((entry) => [entry.token, entry]));
    const candidateByKey = new Map(candidateOrdered.map((entry) => [entry.token, entry]));
    const desired = current ? clone(current) : clone(candidate);
    const desiredExchanges: JsonObject[] = [];
    const entity = processRow.entity;
    const parentBeforeSha = currentRows[0]?.payload_sha256 ?? null;

    for (const candidateEntry of candidateOrdered) {
      const beforeEntry = currentByKey.get(candidateEntry.token);
      let next: JsonObject;
      if (!beforeEntry) {
        next = clone(candidateEntry.exchange);
        if (current) {
          counts.exchange_add += 1;
          const desiredSha = sha256Json(next);
          writers.events.event({
            action_id: conversionActionId(entity, "exchange-add", candidateEntry, desiredSha),
            entity,
            exchange_key: {
              number: candidateEntry.number,
              occurrence: candidateEntry.occurrence,
            },
            mapping_kind: "EXCHANGE_ADD",
            reason: "CANDIDATE_OCCURRENCE_ADDED",
            before_sha: null,
            desired_sha: desiredSha,
          });
        }
      } else {
        const before = beforeEntry.exchange;
        next = clone(before);
        next["@dataSetInternalID"] = candidateEntry.exchange["@dataSetInternalID"];
        const beforeRef = before.referenceToFlowDataSet ?? {};
        const candidateRef = candidateEntry.exchange.referenceToFlowDataSet ?? {};
        const overlaid = overlayChineseDescription(candidateRef, before);
        next.referenceToFlowDataSet = overlaid.reference;
        for (const chinese of overlaid.chinese) {
          counts.chinese_descriptions += 1;
          writers.events.event({
            action_id: conversionActionId(
              entity,
              "zh-preserve",
              candidateEntry,
              sha256Json(chinese),
            ),
            entity,
            exchange_key: {
              number: candidateEntry.number,
              occurrence: candidateEntry.occurrence,
            },
            mapping_kind: "CHINESE_DESCRIPTION_PRESERVE",
            reason: "OWNER_AUTHORED_ZH_OVERLAY_BY_OCCURRENCE",
            before_sha: sha256Json(chinese),
            desired_sha: sha256Json(chinese),
          });
        }
        if (referenceIdentity(beforeRef) !== referenceIdentity(candidateRef)) {
          const oldFlowId = asToken(beforeRef?.["@refObjectId"]);
          const newFlowId = asToken(candidateRef?.["@refObjectId"]);
          const mapping = mappings.byPair.get(`${oldFlowId}\u0000${newFlowId}`);
          if (!mapping) {
            findings.push({
              severity: "P0",
              code: "MISSING_OCCURRENCE_FLOW_MAPPING",
              entity,
              exchange_key: candidateEntry.token,
              old_flow_id: oldFlowId,
              new_flow_id: newFlowId,
            });
          }
          counts.flow_reference_changes += 1;
          writers.events.event({
            action_id: conversionActionId(
              entity,
              "flow-ref",
              candidateEntry,
              sha256Json(candidateRef),
            ),
            entity,
            exchange_key: {
              number: candidateEntry.number,
              occurrence: candidateEntry.occurrence,
            },
            mapping_kind: "FLOW_REFERENCE_CHANGE",
            reason: mapping
              ? `CANDIDATE_OCCURRENCE_TARGET_IDENTITY:${mapping.mapping_kind}`
              : "CANDIDATE_OCCURRENCE_TARGET_IDENTITY:MAPPING_MISSING",
            before_sha: sha256Json(beforeRef),
            desired_sha: sha256Json(candidateRef),
            flow_mapping_kind: mapping?.mapping_kind ?? null,
            evidence_sha256: mapping?.evidence_sha256 ?? null,
          });
        }
        if (before.exchangeDirection !== candidateEntry.exchange.exchangeDirection) {
          next.exchangeDirection = candidateEntry.exchange.exchangeDirection;
          counts.direction_changes += 1;
          writers.events.event({
            action_id: conversionActionId(
              entity,
              "direction",
              candidateEntry,
              sha256Json(candidateEntry.exchange.exchangeDirection),
            ),
            entity,
            exchange_key: {
              number: candidateEntry.number,
              occurrence: candidateEntry.occurrence,
            },
            mapping_kind: "DIRECTION_CHANGE",
            reason: "AUTHORIZED_CANDIDATE_DIRECTION",
            before_sha: sha256Json(before.exchangeDirection),
            desired_sha: sha256Json(candidateEntry.exchange.exchangeDirection),
          });
        }
        const amountChanged =
          !decimalEqual(before.meanAmount, candidateEntry.exchange.meanAmount) ||
          !decimalEqual(before.resultingAmount, candidateEntry.exchange.resultingAmount);
        if (amountChanged) {
          next.meanAmount = candidateEntry.exchange.meanAmount;
          next.resultingAmount = candidateEntry.exchange.resultingAmount;
          counts.amount_changes += 1;
          const beforeAmount = {
            meanAmount: before.meanAmount,
            resultingAmount: before.resultingAmount,
          };
          const desiredAmount = {
            meanAmount: candidateEntry.exchange.meanAmount,
            resultingAmount: candidateEntry.exchange.resultingAmount,
          };
          writers.events.event({
            action_id: conversionActionId(
              entity,
              "amount",
              candidateEntry,
              sha256Json(desiredAmount),
            ),
            entity,
            exchange_key: {
              number: candidateEntry.number,
              occurrence: candidateEntry.occurrence,
            },
            mapping_kind: "AMOUNT_CHANGE",
            reason: "AUTHORIZED_CANDIDATE_AMOUNT",
            before_sha: sha256Json(beforeAmount),
            desired_sha: sha256Json(desiredAmount),
          });
        }
      }
      const flowIdentity = exchangeFlowIdentity(next);
      if (!targetFlowKeys.has(`flows/${flowIdentity}`)) {
        findings.push({
          severity: "P0",
          code: "PROCESS_REFERENCE_OUTSIDE_CANDIDATE_CLOSURE",
          entity,
          exchange_key: candidateEntry.token,
          flow_identity: flowIdentity,
        });
      }
      processFlowEdges.push({ process: processKey, flow: `flows/${flowIdentity}` });
      desiredExchanges.push(next);
    }
    if (current) {
      for (const currentEntry of currentOrdered) {
        if (candidateByKey.has(currentEntry.token)) continue;
        counts.exchange_delete += 1;
        writers.events.event({
          action_id: conversionActionId(entity, "exchange-delete", currentEntry, null),
          entity,
          exchange_key: { number: currentEntry.number, occurrence: currentEntry.occurrence },
          mapping_kind: "EXCHANGE_DELETE",
          reason: "CURRENT_OCCURRENCE_ABSENT_FROM_CANDIDATE",
          before_sha: sha256Json(currentEntry.exchange),
          desired_sha: null,
        });
      }
    }
    desired.processDataSet!.exchanges = {
      ...desired.processDataSet!.exchanges,
      exchange: desiredExchanges,
    };
    const germanRow = german.get(processRow.entity.id);
    addProcessLanguage(desired, germanRow);
    counts.exchanges += desiredExchanges.length;
    const desiredSha = sha256Json(desired);
    const processActionId = actionId(entity, desiredSha);
    const disposition = current
      ? parentBeforeSha === desiredSha
        ? "NO_WRITE"
        : "UPDATE"
      : "INSERT";
    if (disposition === "NO_WRITE") {
      counts.process_no_write += 1;
      writers.processNoWrite.write({
        schema_version: "foundry-topology-process-no-write.v1",
        action_id: processActionId,
        entity,
        before_sha256: parentBeforeSha,
        desired_sha256: desiredSha,
      });
    } else {
      counts[disposition === "INSERT" ? "process_insert" : "process_update"] += 1;
      writers.processInput.write(desired);
      processActions.push({
        action_id: processActionId,
        desired_sha256: desiredSha,
        expected_operation: disposition === "INSERT" ? "insert" : "save_draft",
        table: "processes",
        id: entity.id,
        version: entity.version,
        before_sha256: parentBeforeSha,
        dependency_action_ids: [],
      });
    }
    writers.events.event({
      action_id: processActionId,
      entity,
      exchange_key: null,
      mapping_kind: disposition,
      reason: current
        ? "CANDIDATE_ORDERED_TOPOLOGY_RECONCILIATION"
        : "MISSING_CANDIDATE_PROCESS_INSERT",
      before_sha: parentBeforeSha,
      desired_sha: desiredSha,
      german_evidence_sha256: germanRow?.evidence_sha256 ?? null,
    });
  }

  for (const processId of german.keys()) {
    if (!candidateProcessIds.has(processId)) {
      findings.push({
        severity: "P0",
        code: "GERMAN_OVERLAY_OUTSIDE_PROCESS_SCOPE",
        process_id: processId,
      });
    }
  }

  for (const { value, line } of jsonLines(protectedNoWriteRef.filePath)) {
    const entity = value.entity as { table: string; id: string; version: string };
    const beforeSha = asToken(value.before_sha256 ?? value.before_sha);
    const reason = asToken(value.reason);
    const evidenceSha = asToken(value.evidence_sha256);
    if (
      entity?.table !== "sources" ||
      !asToken(entity.id) ||
      !asToken(entity.version) ||
      !SHA256_PATTERN.test(beforeSha) ||
      !reason ||
      !SHA256_PATTERN.test(evidenceSha)
    )
      throw new Error(`Protected no-write line ${line} is malformed.`);
    const action = conversionActionId(entity, "protected-no-write", null, beforeSha);
    writers.protectedNoWrite.write({
      schema_version: "foundry-topology-protected-no-write.v1",
      action_id: action,
      entity,
      before_sha256: beforeSha,
      desired_sha256: beforeSha,
      reason,
      evidence_sha256: evidenceSha,
    });
    writers.events.event({
      action_id: action,
      entity,
      exchange_key: null,
      mapping_kind: "PROTECTED_NO_WRITE",
      reason,
      before_sha: beforeSha,
      desired_sha: beforeSha,
    });
    counts.protected_no_write += 1;
  }

  for (const id of new Set(mappings.rows.map((row) => row.new_flow_id))) {
    if (!targetFlowIds.has(id)) {
      findings.push({
        severity: "P0",
        code: "FLOW_MAPPING_OUTSIDE_CANDIDATE_SCOPE",
        flow_id: id,
      });
    }
  }

  counts.conversion_events = writers.events.rows;
  const expected = request.expected;
  const exactChecks = {
    candidate_flows: counts.candidate_flows === expected.candidate_flows,
    processes: counts.processes === expected.processes,
    exchanges: counts.exchanges === expected.exchanges,
    flow_reference_changes: counts.flow_reference_changes === expected.flow_reference_changes,
    exchange_add: counts.exchange_add === expected.exchange_add,
    exchange_delete: counts.exchange_delete === expected.exchange_delete,
    direction_changes: counts.direction_changes === expected.direction_changes,
    amount_changes: counts.amount_changes === expected.amount_changes,
    german_synonyms: counts.german_synonyms === expected.german_synonyms,
    chinese_descriptions: counts.chinese_descriptions === expected.chinese_descriptions,
    protected_no_write: counts.protected_no_write === expected.protected_no_write,
    process_update: counts.process_update === expected.process_update,
    process_insert: counts.process_insert === expected.process_insert,
    process_no_write: counts.process_no_write === expected.process_no_write,
    process_partition:
      counts.process_update +
        counts.process_insert +
        counts.process_no_write +
        counts.process_hold ===
      counts.processes,
    flow_partition:
      counts.flow_create +
        counts.flow_owner_no_write +
        counts.flow_public_reuse +
        counts.flow_hold ===
      counts.candidate_flows,
    delete_ceiling: counts.obsolete_flow_delete_candidates <= expected.obsolete_flow_delete_ceiling,
    target_reference_closure:
      new Set(processFlowEdges.map((edge) => edge.flow)).size === expected.candidate_flows,
    machine_translation_zero: counts.machine_translation === 0,
    public_foreign_mutations_zero: counts.public_foreign_mutations === 0,
  };
  return { processFlowEdges, exactChecks };
}
