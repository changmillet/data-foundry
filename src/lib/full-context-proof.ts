import {
  asJsonRecord,
  createDecisionApplyProofBlockerBuilder,
  type FullContextProofDependencies,
  type FullContextProofJsonArtifact,
  type FullContextProofJsonRecord,
  type FullContextRequirement,
  isJsonRecord,
  nestedValue,
} from "./full-context-proof-decision-blockers.ts";
import { createPatchApplyProofBlockerBuilder } from "./full-context-proof-patch-blockers.ts";

export function createFullContextProofUtils(deps: FullContextProofDependencies) {
  const {
    asText,
    ensureArray,
    listImportProfiles,
    normalizedList,
    readJsonArtifactOption,
    repoRelativePath,
    repoRoot,
  } = deps;
  const buildDecisionApplyProofBlockers = createDecisionApplyProofBlockerBuilder(deps);
  const buildPatchApplyProofBlockers = createPatchApplyProofBlockerBuilder(deps);

  function profileFullContextRequirement(
    profileId: unknown,
    datasetType: unknown,
  ): FullContextRequirement | null {
    const listing = asJsonRecord(listImportProfiles({ repoRoot }));
    const requestedProfileId = asText(
      profileId || listing.default_profile || "generic",
    ).toLowerCase();
    const defaultProfileId = asText(listing.default_profile || "generic").toLowerCase();
    const profiles = asJsonRecord(listing.profiles);
    const profile = asJsonRecord(
      profiles[requestedProfileId] ?? profiles[defaultProfileId] ?? profiles.generic,
    );
    const requirement = asJsonRecord(profile.full_context_ai_completion);
    if (requirement.required !== true) return null;

    const requiredDatasetTypes = normalizedList(
      requirement.dataset_types ?? requirement.datasetTypes,
    ).map((value) => value.toLowerCase());
    const normalizedDatasetType = asText(datasetType).toLowerCase();
    if (requiredDatasetTypes.length > 0 && !requiredDatasetTypes.includes(normalizedDatasetType)) {
      return null;
    }

    return {
      profile_id: profile?.id ?? requestedProfileId,
      dataset_type: normalizedDatasetType || null,
      required_context_kinds: normalizedList(
        requirement.required_context_kinds ?? requirement.requiredContextKinds,
      ),
      required_context_file_patterns: normalizedList(
        requirement.required_context_file_patterns ?? requirement.requiredContextFilePatterns,
      ),
    };
  }

  function taskProfileId(task: unknown): string {
    return asText(
      nestedValue(task, "meta", "profile") ??
        nestedValue(task, "meta", "import_profile") ??
        nestedValue(task, "meta", "importProfile") ??
        nestedValue(task, "meta", "dataset_profile") ??
        nestedValue(task, "meta", "datasetProfile"),
    );
  }

  function taskDatasetType(task: unknown): string {
    return asText(
      nestedValue(task, "meta", "dataset_type") ?? nestedValue(task, "meta", "datasetType"),
    );
  }

  function fullContextCount(counts: unknown, key: string): number {
    const value = Number(asJsonRecord(counts)[key] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function fullContextEvidenceArtifactBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
  }: {
    mutationArtifact: FullContextProofJsonArtifact;
    requirement: FullContextRequirement | null;
    prefix: FullContextProofJsonRecord;
    codePrefix: string;
  }): FullContextProofJsonRecord[] {
    const mutationManifest = asJsonRecord(mutationArtifact.value);
    const evidence = asJsonRecord(mutationManifest.evidence);
    if (!evidence.full_context_ai_completion_required) {
      return [];
    }
    const counts = mutationManifest.counts ?? {};
    return [
      ...buildPatchApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        expectedCount: fullContextCount(counts, "ai_patch_evidence_entries"),
      }),
      ...buildDecisionApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        kind: "classification",
        expectedCount: fullContextCount(counts, "ai_classification_decision_entries"),
      }),
      ...buildDecisionApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        kind: "location",
        expectedCount: fullContextCount(counts, "ai_location_decision_entries"),
      }),
      ...buildDecisionApplyProofBlockers({
        mutationArtifact,
        requirement,
        prefix,
        codePrefix,
        kind: "identity",
        expectedCount: fullContextCount(counts, "ai_identity_decision_entries"),
      }),
    ];
  }

  function fullContextProofCheck({
    prefix = {},
    profileId,
    datasetType,
    closeoutCounts = null,
    mutationArtifact = null,
    codePrefix = "completion",
  }: {
    prefix?: FullContextProofJsonRecord;
    profileId?: unknown;
    datasetType?: unknown;
    closeoutCounts?: unknown;
    mutationArtifact?: FullContextProofJsonArtifact | null;
    codePrefix?: string;
  }): { required: boolean; blockers: FullContextProofJsonRecord[] } {
    const mutationManifest = mutationArtifact ? asJsonRecord(mutationArtifact.value) : null;
    const mutationEvidence = asJsonRecord(mutationManifest?.evidence);
    const profileRequirement = profileId
      ? profileFullContextRequirement(profileId, datasetType)
      : null;
    const mutationMarkedRequired = mutationEvidence.full_context_ai_completion_required === true;
    if (!profileRequirement && !mutationMarkedRequired) {
      return { required: false, blockers: [] };
    }

    const blockerPrefix = {
      ...prefix,
      profile: profileRequirement?.profile_id ?? (asText(profileId) || null),
      dataset_type: profileRequirement?.dataset_type ?? (asText(datasetType).toLowerCase() || null),
    };
    const semanticEvidenceCount = (countsValue: unknown) => {
      const counts = asJsonRecord(countsValue);
      return (
        (Number(counts.ai_patch_evidence_entries ?? 0) || 0) +
        (Number(counts.ai_classification_decision_entries ?? 0) || 0) +
        (Number(counts.ai_location_decision_entries ?? 0) || 0) +
        (Number(counts.ai_identity_decision_entries ?? 0) || 0) +
        (Number(counts.source_contact_rewrite_semantic_evidence_entries ?? 0) || 0)
      );
    };
    const blockers: FullContextProofJsonRecord[] = [];
    if (closeoutCounts) {
      const closeoutCountRecord = asJsonRecord(closeoutCounts);
      if (closeoutCountRecord.full_context_ai_completion_required !== true) {
        blockers.push({
          ...blockerPrefix,
          code: `${codePrefix}_full_context_scope_missing`,
          message:
            "This committed scope belongs to a profile or manifest that requires full schema/YAML/context AI completion, but the closeout does not mark the scope as full-context completed.",
        });
      }
      if (semanticEvidenceCount(closeoutCountRecord) <= 0) {
        blockers.push({
          ...blockerPrefix,
          code: `${codePrefix}_full_context_semantic_evidence_missing`,
          message:
            "Full-context AI completion requires at least one AI patch evidence, AI identity decision, AI classification decision, or AI location decision entry.",
        });
      }
    }

    if (!mutationArtifact) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_manifest_missing`,
        message: "Full-context completion requires a readable mutation manifest.",
      });
      return { required: true, blockers };
    }
    if (mutationEvidence.full_context_ai_completion_required !== true) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_requirement_missing`,
        message: "Mutation manifest does not prove that full-context AI completion was required.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    if (!mutationEvidence.full_context_ai_completion_proof) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_proof_missing`,
        message: "Mutation manifest does not carry the full-context AI completion proof snapshot.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    if (semanticEvidenceCount(mutationManifest?.counts ?? {}) <= 0) {
      blockers.push({
        ...blockerPrefix,
        code: `${codePrefix}_full_context_mutation_semantic_evidence_missing`,
        message:
          "Mutation manifest has no AI patch evidence, AI identity decision, AI classification decision, or AI location decision entries for the full-context scope.",
        mutation_manifest: repoRelativePath(mutationArtifact.path),
      });
    }
    blockers.push(
      ...fullContextEvidenceArtifactBlockers({
        mutationArtifact,
        requirement: profileRequirement,
        prefix: blockerPrefix,
        codePrefix,
      }),
    );

    return { required: true, blockers };
  }

  function completionFullContextBlockers({
    task,
    completionReport,
  }: {
    task: unknown;
    completionReport: unknown;
  }): FullContextProofJsonRecord[] {
    const blockers: FullContextProofJsonRecord[] = [];
    const completion = asJsonRecord(completionReport);
    const closeouts = ensureArray(completion.closeouts).filter(isJsonRecord);
    const taskProfile = taskProfileId(task);
    const taskType = taskDatasetType(task);
    const taskRequirement = taskProfile
      ? profileFullContextRequirement(taskProfile, taskType)
      : null;
    let requiredCloseoutCount = 0;

    if (taskRequirement && closeouts.length === 0) {
      blockers.push({
        code: "completion_full_context_closeout_missing",
        message:
          "Task profile requires full schema/YAML/context AI completion, but the completion report has no closeout scope.",
        profile: taskRequirement.profile_id,
        dataset_type: taskRequirement.dataset_type,
      });
    }

    closeouts.forEach((closeout, index) => {
      const profileId = asText(closeout.profile) || taskProfile;
      const datasetType = asText(closeout.dataset_type) || taskType;
      const mutationArtifact = readJsonArtifactOption(closeout.mutation_manifest);
      const fullContextCheck = fullContextProofCheck({
        prefix: {
          closeout_index: index,
          closeout_report: closeout.closeout_report ?? null,
        },
        profileId,
        datasetType,
        closeoutCounts: closeout.counts ?? {},
        mutationArtifact,
        codePrefix: "completion",
      });
      if (!fullContextCheck.required) return;
      requiredCloseoutCount += 1;
      blockers.push(
        ...fullContextCheck.blockers.map((blocker) => ({
          ...blocker,
          closeout_index: index,
          closeout_report: closeout.closeout_report ?? null,
        })),
      );
    });

    const reportFullContextScopes = Number(
      nestedValue(completion, "counts", "full_context_scopes") ?? 0,
    );
    if (requiredCloseoutCount > 0 && reportFullContextScopes < requiredCloseoutCount) {
      blockers.push({
        code: "completion_full_context_scope_count_incomplete",
        message:
          "Completion report full_context_scopes does not cover every profile-required full-context closeout scope.",
        expected_minimum: requiredCloseoutCount,
        actual: Number.isFinite(reportFullContextScopes) ? reportFullContextScopes : 0,
      });
    }

    return blockers;
  }

  return {
    completionFullContextBlockers,
    fullContextProofCheck,
    profileFullContextRequirement,
  };
}
