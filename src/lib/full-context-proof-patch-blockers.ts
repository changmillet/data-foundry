import {
  asJsonRecord,
  type AuthoringPackageProof,
  createJsonOrJsonlRowsArtifactReader,
  fullContextEvidenceArtifactBlocker,
  type FullContextProofDependencies,
  type FullContextProofJsonArtifact,
  type FullContextProofJsonRecord,
  type FullContextRequirement,
  nestedValue,
} from "./full-context-proof-decision-blockers.ts";

const FULL_CONTEXT_PATCH_RESOLUTION_MODES = new Set([
  "evidence_backed_completion",
  "source_language_normalization",
  "classification_decision",
  "location_decision",
  "source_trace_verified",
  "deferred_to_common_other",
]);

export function createPatchApplyProofBlockerBuilder(deps: FullContextProofDependencies) {
  const {
    asText,
    ensureArray,
    fileExists,
    normalizedList,
    readJsonArtifactOption,
    readText,
    repoRelativePath,
    resolveRepoPath,
    sha256Text,
    unique,
  } = deps;
  const readJsonOrJsonlRowsArtifact = createJsonOrJsonlRowsArtifactReader(deps);

  function patchEvidenceResolution(entry: unknown): FullContextProofJsonRecord {
    return asJsonRecord(asJsonRecord(entry).resolution);
  }

  function patchEvidenceResolutionMode(entry: unknown): string {
    return asText(patchEvidenceResolution(entry).mode);
  }

  function patchEvidenceResolutionContextKinds(entry: unknown): string[] {
    return unique(
      normalizedList(
        patchEvidenceResolution(entry).used_context_kinds ??
          patchEvidenceResolution(entry).usedContextKinds,
      ),
    );
  }

  function readAuthoringPackageProofForFullContext({
    packageRef,
    expectedSha256 = null,
    source = null,
  }: {
    packageRef: unknown;
    expectedSha256?: unknown;
    source?: unknown;
  }): AuthoringPackageProof {
    const packagePath = resolveRepoPath(packageRef);
    const proof: AuthoringPackageProof = {
      source,
      path: packageRef || null,
      sha256: null,
      expected_sha256: asText(expectedSha256) || null,
      contract_context_files: [],
      missing_context_files: [],
      blockers: [],
    };
    if (!packageRef || !packagePath || !fileExists(packagePath)) {
      proof.blockers.push({
        code: "authoring_package_missing",
        message: "Patch evidence references no readable full-context authoring package.",
        authoring_package: packageRef || null,
        source,
      });
      return proof;
    }
    proof.path = repoRelativePath(packagePath);
    let payload: unknown = null;
    try {
      const rawText = readText(packagePath);
      proof.sha256 = sha256Text(rawText);
      payload = JSON.parse(rawText);
    } catch (error) {
      proof.blockers.push({
        code: "authoring_package_invalid",
        message: error instanceof Error ? error.message : String(error),
        authoring_package: proof.path,
        source,
      });
      return proof;
    }
    const payloadRecord = asJsonRecord(payload);
    proof.contract_context_files = ensureArray(payloadRecord.contract_context_files);
    proof.missing_context_files = ensureArray(payloadRecord.missing_context_files);
    if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
      proof.blockers.push({
        code: "authoring_package_hash_mismatch",
        message:
          "Recorded authoring_package_sha256 does not match the current authoring package content.",
        authoring_package: proof.path,
        expected_sha256: proof.expected_sha256,
        actual_sha256: proof.sha256,
        source,
      });
    }
    return proof;
  }

  function authoringPackageProofsFromPatchCollect(
    patchCollectArtifact: FullContextProofJsonArtifact | null | undefined,
  ): AuthoringPackageProof[] {
    const manifestRef = nestedValue(patchCollectArtifact?.value, "task_manifest");
    const manifestArtifact = readJsonArtifactOption(manifestRef);
    if (!manifestArtifact) return [];
    return ensureArray(nestedValue(manifestArtifact.value, "tasks"))
      .map((taskValue) => {
        const task = asJsonRecord(taskValue);
        const packageRef = asText(
          nestedValue(task, "files", "authoring_package") ??
            nestedValue(task, "files", "authoringPackage"),
        );
        if (!packageRef) return null;
        return readAuthoringPackageProofForFullContext({
          packageRef,
          expectedSha256: nestedValue(task, "context", "authoring_package_sha256"),
          source: "patch_collect_task_manifest",
        });
      })
      .filter((proof): proof is AuthoringPackageProof => proof !== null);
  }

  function authoringPackageProofsFromCurationGate(
    mutationManifest: unknown,
  ): AuthoringPackageProof[] {
    const manifest = asJsonRecord(mutationManifest);
    const evidence = asJsonRecord(manifest.evidence);
    const curationGateArtifact = readJsonArtifactOption(evidence.curation_gate_report);
    if (!curationGateArtifact) return [];
    const entities = ensureArray(
      nestedValue(curationGateArtifact.value, "entities") ??
        nestedValue(curationGateArtifact.value, "processes") ??
        nestedValue(curationGateArtifact.value, "flows") ??
        nestedValue(curationGateArtifact.value, "items"),
    );
    return entities
      .map((entityValue) => {
        const entity = asJsonRecord(entityValue);
        const packageRef = asText(entity.authoring_package ?? entity.authoringPackage);
        if (!packageRef) return null;
        return readAuthoringPackageProofForFullContext({
          packageRef,
          expectedSha256: entity?.authoring_package_sha256,
          source: "curation_gate",
        });
      })
      .filter((proof): proof is AuthoringPackageProof => proof !== null);
  }

  return function buildPatchApplyProofBlockers({
    mutationArtifact,
    requirement,
    prefix,
    codePrefix,
    expectedCount,
  }: {
    mutationArtifact: FullContextProofJsonArtifact;
    requirement: FullContextRequirement | null;
    prefix: FullContextProofJsonRecord;
    codePrefix: string;
    expectedCount: number;
  }): FullContextProofJsonRecord[] {
    if (expectedCount <= 0) return [];
    const blockers: FullContextProofJsonRecord[] = [];
    const mutationManifest = asJsonRecord(mutationArtifact.value);
    const evidence = asJsonRecord(mutationManifest.evidence);
    const patchCollectArtifact = readJsonArtifactOption(evidence.patch_collect_report);
    if (!patchCollectArtifact) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_collect_report_missing",
          message:
            "Mutation manifest full-context patch evidence references no readable patch collect report.",
          details: {
            mutation_manifest: repoRelativePath(mutationArtifact.path),
            report: evidence.patch_collect_report ?? null,
          },
        }),
      );
    } else if (asJsonRecord(patchCollectArtifact.value).status !== "ready_for_patch_apply") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_collect_not_ready",
          message: `Patch collect report status is ${asJsonRecord(patchCollectArtifact.value).status ?? "missing"}.`,
          details: { report: repoRelativePath(patchCollectArtifact.path) },
        }),
      );
    }
    const authoringPackageProofs = [
      ...authoringPackageProofsFromPatchCollect(patchCollectArtifact),
      ...authoringPackageProofsFromCurationGate(mutationManifest),
    ];
    for (const proof of authoringPackageProofs) {
      for (const blocker of proof.blockers) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: `patch_${blocker.code}`,
            message: blocker.message,
            details: blocker,
          }),
        );
      }
    }

    const patchApplyArtifact = readJsonArtifactOption(evidence.patch_apply_report);
    if (!patchApplyArtifact) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_apply_report_missing",
          message:
            "Mutation manifest full-context patch evidence references no readable patch apply report.",
          details: {
            mutation_manifest: repoRelativePath(mutationArtifact.path),
            report: evidence.patch_apply_report ?? null,
          },
        }),
      );
      return blockers;
    }
    const patchApplyReport = asJsonRecord(patchApplyArtifact.value);
    if (patchApplyReport.status !== "completed") {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_apply_not_completed",
          message: `Patch apply report status is ${patchApplyReport.status ?? "missing"}.`,
          details: { report: repoRelativePath(patchApplyArtifact.path) },
        }),
      );
    }
    const patchEvidenceFile =
      evidence.patch_evidence_file ?? nestedValue(patchApplyReport, "files", "patch_evidence");
    const patchEvidenceArtifact = readJsonOrJsonlRowsArtifact(patchEvidenceFile);
    if (patchEvidenceArtifact.error) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_evidence_file_unreadable",
          message:
            "Patch apply report must retain readable AI patch evidence rows for closeout proof.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: patchEvidenceFile ?? null,
            error: patchEvidenceArtifact.error,
          },
        }),
      );
    } else if (patchEvidenceArtifact.rows.length < expectedCount) {
      blockers.push(
        fullContextEvidenceArtifactBlocker({
          prefix,
          codePrefix,
          suffix: "patch_evidence_count_incomplete",
          message:
            "Patch evidence rows are fewer than the mutation manifest AI patch evidence count.",
          details: {
            report: repoRelativePath(patchApplyArtifact.path),
            patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
            expected_patch_evidence_entries: expectedCount,
            actual_patch_evidence_entries: patchEvidenceArtifact.rows.length,
          },
        }),
      );
    }
    if (!patchEvidenceArtifact.error) {
      const patchEvidenceRows = patchEvidenceArtifact.rows;
      const missingPackageHash = patchEvidenceRows.filter(
        (entry) => !asText(asJsonRecord(entry).authoring_package_sha256),
      );
      if (missingPackageHash.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_package_hash_missing",
            message:
              "Every retained AI patch evidence row must still include authoring_package_sha256.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingPackageHash.length,
            },
          }),
        );
      }
      const knownPackageHashes = new Set(
        authoringPackageProofs.map((proof) => asText(proof.sha256)).filter(Boolean),
      );
      const unknownPackageHash = patchEvidenceRows.filter((entry) => {
        const hash = asText(asJsonRecord(entry).authoring_package_sha256);
        return hash && !knownPackageHashes.has(hash);
      });
      if (unknownPackageHash.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_package_hash_unknown",
            message:
              "Every retained AI patch evidence authoring_package_sha256 must match a readable full-context authoring package from patch collect or curation gate evidence.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: unknownPackageHash.length,
            },
          }),
        );
      }
      const missingClosures = patchEvidenceRows.filter(
        (entry) => ensureArray(asJsonRecord(entry).closes_action_items).length === 0,
      );
      if (missingClosures.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_action_closure_missing",
            message:
              "Every retained AI patch evidence row must still close at least one authoring action item.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingClosures.length,
            },
          }),
        );
      }
      const missingEvidence = patchEvidenceRows.filter((entry) => {
        const evidenceValue = asJsonRecord(entry).evidence;
        return !evidenceValue || typeof evidenceValue !== "object";
      });
      if (missingEvidence.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_evidence_missing",
            message: "Every retained AI patch evidence row must still include structured evidence.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingEvidence.length,
            },
          }),
        );
      }
      const missingResolution = patchEvidenceRows.filter(
        (entry) => !patchEvidenceResolutionMode(entry),
      );
      if (missingResolution.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_resolution_missing",
            message: "Every retained AI patch evidence row must still include resolution.mode.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingResolution.length,
            },
          }),
        );
      }
      const invalidResolutionMode = patchEvidenceRows.filter((entry) => {
        const mode = patchEvidenceResolutionMode(entry);
        return mode && !FULL_CONTEXT_PATCH_RESOLUTION_MODES.has(mode);
      });
      if (invalidResolutionMode.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_resolution_mode_invalid",
            message: "Retained AI patch evidence contains unsupported resolution.mode values.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: invalidResolutionMode.length,
            },
          }),
        );
      }
      const missingContextKinds = [];
      for (const entry of patchEvidenceRows) {
        const usedKinds = new Set(patchEvidenceResolutionContextKinds(entry));
        for (const requiredKind of requirement?.required_context_kinds ?? []) {
          if (!usedKinds.has(requiredKind)) {
            missingContextKinds.push({ entry, requiredKind });
          }
        }
      }
      if (missingContextKinds.length > 0) {
        blockers.push(
          fullContextEvidenceArtifactBlocker({
            prefix,
            codePrefix,
            suffix: "patch_resolution_context_missing",
            message:
              "Retained AI patch evidence resolution.used_context_kinds must still include every required full-context kind.",
            details: {
              report: repoRelativePath(patchApplyArtifact.path),
              patch_evidence_file: repoRelativePath(patchEvidenceArtifact.path!),
              count: missingContextKinds.length,
              required_context_kinds: requirement?.required_context_kinds ?? [],
            },
          }),
        );
      }
    }
    return blockers;
  };
}
