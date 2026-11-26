import {
  MISSING,
  TABLE_IDENTITIES,
  asToken,
  boundRule,
  childPointer,
  clone,
  compareText,
  exact,
  isObject,
  matchingNoiseRules,
  noiseRuleFor,
  pointerValue,
  presentValue,
  valueAt,
  valueSha256,
  type EvidenceRule,
  type JsonObject,
  type JsonValue,
  type MergeConflict,
  type MergeResult,
  type TablePolicy,
} from "./types-and-primitives.ts";

function stableArrayIdentity(
  rule: EvidenceRule | undefined,
  oldArray: unknown,
  candidateArray: unknown,
  currentArray: unknown,
): boolean {
  if (
    rule?.mode !== "stable_identity_by_index_v1" ||
    !Array.isArray(oldArray) ||
    !Array.isArray(candidateArray) ||
    !Array.isArray(currentArray) ||
    oldArray.length !== candidateArray.length ||
    oldArray.length !== currentArray.length
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (let index = 0; index < oldArray.length; index += 1) {
    const identities = [oldArray[index], candidateArray[index], currentArray[index]].map((entry) =>
      pointerValue(entry, rule.element_identity_pointer ?? ""),
    );
    if (
      identities.some((identity) => !presentValue(identity)) ||
      !identities.every((identity) => exact(identity, identities[0]))
    ) {
      return false;
    }
    const identitySha256 = valueSha256(identities[0]);
    if (seen.has(identitySha256)) return false;
    seen.add(identitySha256);
  }
  return true;
}

/** Performs deterministic policy-bound three-way merge with explicit conflict and noise accounting. */
export function mergeThreeWay({
  oldValue,
  candidateValue,
  currentValue,
  tablePolicy,
  entityKey: entityKeyValue = "",
}: {
  oldValue: JsonValue;
  candidateValue: JsonValue;
  currentValue: JsonValue;
  tablePolicy: TablePolicy;
  entityKey?: string;
}): MergeResult {
  const conflicts: MergeConflict[] = [];
  const preservedPaths: string[] = [];
  const appliedPaths: string[] = [];
  const normalizationRules = matchingNoiseRules(
    tablePolicy,
    entityKeyValue,
    oldValue,
    candidateValue,
    currentValue,
  );
  const noisePaths = normalizationRules.map((rule) => rule.pointer);
  const noiseEvidence = normalizationRules.map((rule) => rule.evidence_sha256);
  const preserveOwnerEvidence: string[] = [];
  const takeCandidateEvidence: string[] = [];
  const stableArrayEvidence: string[] = [];

  function merge(
    oldChild: unknown,
    candidateChild: unknown,
    currentChild: unknown,
    pointer: string,
    arrayAuthority: EvidenceRule | null = null,
  ): unknown {
    const noiseRule = noiseRuleFor(
      tablePolicy,
      entityKeyValue,
      pointer,
      oldChild,
      candidateChild,
      currentChild,
    );
    if (pointer && noiseRule) {
      return clone(currentChild === MISSING ? candidateChild : currentChild);
    }
    if (Array.isArray(oldChild) || Array.isArray(candidateChild) || Array.isArray(currentChild)) {
      if (exact(candidateChild, oldChild) && exact(currentChild, oldChild))
        return clone(currentChild);
      if (exact(currentChild, candidateChild)) return clone(currentChild);
      if (exact(currentChild, oldChild) && !exact(candidateChild, oldChild)) {
        appliedPaths.push(pointer || "");
        return clone(candidateChild);
      }
      const arrayRule = boundRule(
        tablePolicy.array_merge_rules,
        entityKeyValue,
        pointer,
        oldChild,
        candidateChild,
        currentChild,
      );
      if (!stableArrayIdentity(arrayRule, oldChild, candidateChild, currentChild)) {
        conflicts.push({ pointer: pointer || "", reason: "array_identity_unstable" });
        return clone(currentChild);
      }
      stableArrayEvidence.push(arrayRule!.evidence_sha256);
      const oldArray = oldChild as unknown[];
      const candidateArray = candidateChild as unknown[];
      const currentArray = currentChild as unknown[];
      return oldArray.map((entry, index) =>
        merge(
          entry,
          candidateArray[index],
          currentArray[index],
          childPointer(pointer, index),
          arrayRule,
        ),
      );
    }
    if (
      isObject(oldChild === MISSING ? {} : oldChild) &&
      isObject(candidateChild === MISSING ? {} : candidateChild) &&
      isObject(currentChild === MISSING ? {} : currentChild)
    ) {
      const oldObject = isObject(oldChild) ? oldChild : {};
      const candidateObject = isObject(candidateChild) ? candidateChild : {};
      const currentObject = isObject(currentChild) ? currentChild : {};
      const keys = new Set([
        ...Object.keys(oldObject),
        ...Object.keys(candidateObject),
        ...Object.keys(currentObject),
      ]);
      const output: JsonObject = {};
      for (const key of [...keys].sort(compareText)) {
        const merged = merge(
          valueAt(oldChild, key),
          valueAt(candidateChild, key),
          valueAt(currentChild, key),
          childPointer(pointer, key),
          arrayAuthority,
        );
        if (merged !== MISSING) output[key] = merged as JsonValue;
      }
      return output;
    }
    if (exact(candidateChild, oldChild) && exact(currentChild, oldChild)) {
      return clone(currentChild);
    }
    if (exact(currentChild, candidateChild)) return clone(currentChild);
    if (exact(currentChild, oldChild) && !exact(candidateChild, oldChild)) {
      appliedPaths.push(pointer || "");
      return clone(candidateChild);
    }

    const resolution = boundRule(
      tablePolicy.conflict_rules,
      entityKeyValue,
      pointer,
      oldChild,
      candidateChild,
      currentChild,
    );
    if (exact(candidateChild, oldChild) && !exact(currentChild, oldChild)) {
      if (resolution?.mode === "preserve_owner") {
        preservedPaths.push(pointer || "");
        preserveOwnerEvidence.push(resolution.evidence_sha256);
        return clone(currentChild);
      }
      if (resolution?.mode === "take_candidate") {
        appliedPaths.push(pointer || "");
        takeCandidateEvidence.push(resolution.evidence_sha256);
        return clone(candidateChild);
      }
      if (arrayAuthority) {
        preservedPaths.push(pointer || "");
        return clone(currentChild);
      }
      conflicts.push({ pointer: pointer || "", reason: "unattributed_current_drift" });
      return clone(currentChild);
    }
    if (resolution?.mode === "preserve_owner") {
      preservedPaths.push(pointer || "");
      preserveOwnerEvidence.push(resolution.evidence_sha256);
      return clone(currentChild);
    }
    if (resolution?.mode === "take_candidate") {
      appliedPaths.push(pointer || "");
      takeCandidateEvidence.push(resolution.evidence_sha256);
      return clone(candidateChild);
    }
    conflicts.push({ pointer: pointer || "", reason: "three_way_conflict" });
    return clone(currentChild);
  }

  return {
    value: merge(oldValue, candidateValue, currentValue, "") as JsonValue,
    conflicts,
    preserved_paths: [...new Set(preservedPaths)].sort(compareText),
    applied_paths: [...new Set(appliedPaths)].sort(compareText),
    noise_paths: [...new Set(noisePaths)].sort(compareText),
    noise_evidence_sha256: [...new Set(noiseEvidence)].sort(compareText),
    preserve_owner_evidence_sha256: [...new Set(preserveOwnerEvidence)].sort(compareText),
    take_candidate_evidence_sha256: [...new Set(takeCandidateEvidence)].sort(compareText),
    stable_array_evidence_sha256: [...new Set(stableArrayEvidence)].sort(compareText),
  };
}

export function diffPointers(
  left: unknown,
  right: unknown,
  pointer = "",
  output: string[] = [],
): string[] {
  if (exact(left, right)) return output;
  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort(compareText)) {
      diffPointers(valueAt(left, key), valueAt(right, key), childPointer(pointer, key), output);
    }
    return output;
  }
  output.push(pointer || "");
  return output;
}

export function evidenceForMerge(policySha256: string, merge: MergeResult): JsonObject {
  return {
    policy_sha256: policySha256,
    noise_evidence_sha256: [...new Set(merge.noise_evidence_sha256 ?? [])].sort(compareText),
    preserve_owner_evidence_sha256: [...new Set(merge.preserve_owner_evidence_sha256 ?? [])].sort(
      compareText,
    ),
    take_candidate_evidence_sha256: [...new Set(merge.take_candidate_evidence_sha256 ?? [])].sort(
      compareText,
    ),
    stable_array_evidence_sha256: [...new Set(merge.stable_array_evidence_sha256 ?? [])].sort(
      compareText,
    ),
  };
}

export function extractIdentity(
  payload: JsonValue,
  table: string,
): { id: string; version: string } {
  const [rootKey, informationKey] = TABLE_IDENTITIES[table] ?? [];
  const payloadRecord = isObject(payload) ? payload : {};
  const rootValue = rootKey ? payloadRecord[rootKey] : undefined;
  const root = isObject(rootValue) ? rootValue : payloadRecord;
  const informationValue = informationKey ? root[informationKey] : undefined;
  const information = isObject(informationValue) ? informationValue : {};
  const dataSetInformation = isObject(information.dataSetInformation)
    ? information.dataSetInformation
    : {};
  const administrative = isObject(root.administrativeInformation)
    ? root.administrativeInformation
    : {};
  const publication = isObject(administrative.publicationAndOwnership)
    ? administrative.publicationAndOwnership
    : {};
  return {
    id: asToken(dataSetInformation["common:UUID"] ?? dataSetInformation.UUID),
    version: asToken(publication["common:dataSetVersion"] ?? publication.dataSetVersion),
  };
}
