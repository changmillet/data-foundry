import path from "node:path";
import { asText, contextFileDetails, datasetIdentity, detectDatasetType, ensureArray, fileExists, readJson, readJsonOrJsonl, readText, repoRelativePath, resolveRepoPath } from "./part-00.mjs";
import { identityFreshnessIdentityKey } from "./part-01.mjs";
import { sha256Json } from "./part-05.mjs";
import { readRowsIfExists, sha256Text } from "./part-06.mjs";
import { contextFilesHaveKind, contextFilesHavePattern, readAuthoringPackageProof, repoRelativeArtifactPath, rowsFileChainsThroughUnresolvedExchangeExternalization, sameArtifactPath } from "./part-08.mjs";

export function authoringPackageProofsFromPatchCollect(
  repoRoot,
  patchCollectArtifact,
) {
  const manifestRef = patchCollectArtifact?.value?.task_manifest;
  const manifestPath = resolveRepoPath(repoRoot, manifestRef);
  if (!manifestRef || !manifestPath || !fileExists(manifestPath)) return [];
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return [];
  }
  return ensureArray(manifest?.tasks)
    .map((task) => {
      const packageRef = asText(
        task?.files?.authoring_package ?? task?.files?.authoringPackage,
      );
      if (!packageRef) return null;
      return readAuthoringPackageProof(
        repoRoot,
        packageRef,
        task?.context?.authoring_package_sha256,
        "patch_collect_task_manifest",
      );
    })
    .filter(Boolean);
}

export function fullContextPackageProofBlockers({ requirement, proof }) {
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: "full_context_authoring_package_context_kind_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of requirement.requiredContextFilePatterns) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: "full_context_authoring_package_context_file_missing",
        stage: "full_context_ai_completion",
        message: `Authoring package does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        authoring_package: proof.path,
        source: proof.source,
      });
    }
  }
  if (ensureArray(proof.payload.missing_context_files).length > 0) {
    blockers.push({
      code: "full_context_authoring_package_missing_context_files",
      stage: "full_context_ai_completion",
      message:
        "Authoring package records missing context files and cannot prove full-context AI completion.",
      authoring_package: proof.path,
      missing_context_files: ensureArray(proof.payload.missing_context_files),
      source: proof.source,
    });
  }
  return blockers;
}

export function normalizeClassificationDecisionRows(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.decisions)) return value.decisions.filter(Boolean);
  if (Array.isArray(value?.rows)) return value.rows.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

export function readDecisionTaskProof(
  repoRoot,
  taskRef,
  expectedSha256 = null,
  expectedContextBundleSha256 = null,
  source = null,
) {
  const taskPath = resolveRepoPath(repoRoot, taskRef);
  const proof = {
    source,
    path: taskRef ? repoRelativeArtifactPath(repoRoot, taskRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    expected_context_bundle_sha256:
      asText(expectedContextBundleSha256) || null,
    payload: null,
    status: null,
    task_kind: null,
    context_bundle_sha256: null,
    contract_context_files: [],
    contract_context_file_details: [],
    missing_context_files: [],
    shared_context_bundle: null,
    blockers: [],
  };
  if (!taskRef || !taskPath || !fileExists(taskPath)) {
    proof.blockers.push({
      code: "full_context_decision_task_missing",
      stage: "full_context_ai_completion",
      message:
        "Full-context decision evidence references an unreadable AI decision task.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  proof.exists = true;
  proof.path = repoRelativePath(repoRoot, taskPath);
  let rawText = "";
  try {
    rawText = readText(taskPath);
    proof.sha256 = sha256Text(rawText);
    proof.payload = JSON.parse(rawText);
  } catch (error) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  if (
    !proof.payload ||
    typeof proof.payload !== "object" ||
    Array.isArray(proof.payload)
  ) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: "Decision task must be a JSON object.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  const contextBundle =
    proof.payload.context_bundle ?? proof.payload.authoring_context ?? {};
  proof.status = asText(proof.payload.status);
  proof.task_kind = asText(proof.payload.task_kind);
  proof.context_bundle_sha256 = asText(
    contextBundle.sha256 ?? contextBundle.context_bundle_sha256,
  );
  proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(
    repoRoot,
    proof.payload,
    proof.path,
  );
  proof.blockers.push(...proof.shared_context_bundle.blockers);
  proof.contract_context_files = [
    ...ensureArray(proof.payload.contract_context_files),
    ...proof.shared_context_bundle.files,
  ];
  proof.contract_context_file_details = contextFileDetails(
    proof.contract_context_files,
  );
  proof.missing_context_files = ensureArray(proof.payload.missing_context_files);
  if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "full_context_decision_task_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded decision task sha256 does not match the current decision task content.",
      decision_task: proof.path,
      expected_sha256: proof.expected_sha256,
      actual_sha256: proof.sha256,
      source,
    });
  }
  if (
    proof.expected_context_bundle_sha256 &&
    proof.context_bundle_sha256 &&
    proof.expected_context_bundle_sha256 !== proof.context_bundle_sha256
  ) {
    proof.blockers.push({
      code: "full_context_decision_task_context_hash_mismatch",
      stage: "full_context_ai_completion",
      message:
        "Recorded decision task context bundle hash does not match the decision task.",
      decision_task: proof.path,
      expected_context_bundle_sha256: proof.expected_context_bundle_sha256,
      actual_context_bundle_sha256: proof.context_bundle_sha256,
      source,
    });
  }
  return proof;
}

export function decisionTaskProofFromApplyReport(repoRoot, report, source) {
  const task = report?.decision_task ?? report?.decisionTask;
  const taskRef = asText(
    task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask,
  );
  if (!taskRef) return null;
  return readDecisionTaskProof(
    repoRoot,
    taskRef,
    task?.sha256,
    task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    source,
  );
}

export function readDecisionTaskSharedContextBundleProof(repoRoot, payload, taskPath) {
  const contextBundle = payload?.context_bundle ?? payload?.authoring_context ?? {};
  const sharedContext =
    payload?.shared_context_bundle ?? contextBundle?.shared_context_bundle ?? {};
  const sharedPath = asText(
    sharedContext?.path ?? payload?.files?.shared_context_bundle,
  );
  const expectedSha256 = asText(
    sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
  );
  const proof = {
    path: sharedPath ? repoRelativeArtifactPath(repoRoot, sharedPath) : null,
    sha256: null,
    expected_sha256: expectedSha256 || null,
    files: [],
    blockers: [],
  };
  if (!sharedPath) return proof;
  const bundlePath = resolveRepoPath(repoRoot, sharedPath);
  if (!bundlePath || !fileExists(bundlePath)) {
    proof.blockers.push({
      code: "full_context_decision_task_shared_context_bundle_missing",
      stage: "full_context_ai_completion",
      message:
        "Decision task references an unreadable shared full-context bundle.",
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
    return proof;
  }
  try {
    const bundle = readJson(bundlePath);
    proof.sha256 = asText(bundle?.sha256);
    proof.files = ensureArray(bundle?.files);
    if (expectedSha256 && proof.sha256 !== expectedSha256) {
      proof.blockers.push({
        code: "full_context_decision_task_shared_context_bundle_hash_mismatch",
        stage: "full_context_ai_completion",
        message:
          "Decision task shared context bundle sha256 no longer matches the task reference.",
        decision_task: taskPath,
        shared_context_bundle: proof.path,
        expected_sha256: expectedSha256,
        actual_sha256: proof.sha256 || null,
      });
    }
  } catch (error) {
    proof.blockers.push({
      code: "full_context_decision_task_shared_context_bundle_invalid",
      stage: "full_context_ai_completion",
      message: error instanceof Error ? error.message : String(error),
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
  }
  return proof;
}

export function decisionTaskProofsFromApplyReport(repoRoot, report, source) {
  const tasks = ensureArray(report?.decision_tasks ?? report?.decisionTasks);
  if (tasks.length === 0) {
    const single = decisionTaskProofFromApplyReport(repoRoot, report, source);
    return single ? [single] : [];
  }
  return tasks
    .map((task) => {
      const taskRef = asText(
        task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask,
      );
      if (!taskRef) return null;
      return readDecisionTaskProof(
        repoRoot,
        taskRef,
        task?.sha256,
        task?.context_bundle_sha256 ?? task?.contextBundleSha256,
        source,
      );
    })
    .filter(Boolean);
}

export function payloadSha256ByIdentityForRows(repoRoot, rowFiles, fallbackDatasetType = null) {
  const map = new Map();
  for (const rowFile of ensureArray(rowFiles)) {
    const resolved = resolveRepoPath(repoRoot, rowFile);
    if (!resolved || !fileExists(resolved)) continue;
    readRowsIfExists(resolved).forEach((row, index) => {
      const datasetType = detectDatasetType(row, fallbackDatasetType);
      if (!datasetType) return;
      const identity = datasetIdentity(row, index, datasetType);
      const key = identityFreshnessIdentityKey({ datasetType, identity });
      if (key) map.set(key, sha256Json(identity.payload));
    });
  }
  return map;
}

export function fullContextDecisionTaskProofBlockers({ requirement, proof, label }) {
  if (!proof) {
    return [
      {
        code: `full_context_ai_${label}_decision_task_required`,
        stage: "full_context_ai_completion",
        message:
          "Decision apply report must bind to the AI decision task that carried the full schema/YAML/context bundle.",
      },
    ];
  }
  const blockers = [...proof.blockers];
  if (blockers.length > 0 || !proof.payload) return blockers;
  const expectedTaskKind =
    label === "location"
      ? "location_decision_authoring"
      : "classification_decision_authoring";
  const expectedStatus =
    label === "location"
      ? "ready_for_ai_location_decisions"
      : "ready_for_ai_classification_decisions";
  if (proof.task_kind !== expectedTaskKind) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_kind_invalid`,
      stage: "full_context_ai_completion",
      message:
        "Decision apply report must reference the matching full-context AI decision task kind.",
      decision_task: proof.path,
      expected_task_kind: expectedTaskKind,
      actual_task_kind: proof.task_kind || null,
      source: proof.source,
    });
  }
  if (proof.status !== expectedStatus) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_status_invalid`,
      stage: "full_context_ai_completion",
      message:
        "Decision apply report must reference a ready full-context AI decision task.",
      decision_task: proof.path,
      expected_status: expectedStatus,
      actual_status: proof.status || null,
      source: proof.source,
    });
  }
  for (const kind of requirement.requiredContextKinds) {
    if (!contextFilesHaveKind(proof.contract_context_files, kind)) {
      blockers.push({
        code: `full_context_ai_${label}_decision_task_context_kind_missing`,
        stage: "full_context_ai_completion",
        message: `Decision task does not contain full non-empty context text for '${kind}'.`,
        required_kind: kind,
        decision_task: proof.path,
        source: proof.source,
      });
    }
  }
  for (const pattern of decisionTaskRequiredContextFilePatterns({
    requirement,
    proof,
    label,
  })) {
    if (!contextFilesHavePattern(proof.contract_context_files, pattern)) {
      blockers.push({
        code: `full_context_ai_${label}_decision_task_context_file_missing`,
        stage: "full_context_ai_completion",
        message: `Decision task does not contain full non-empty context text for a file matching '${pattern}'.`,
        required_file_pattern: pattern,
        decision_task: proof.path,
        source: proof.source,
      });
    }
  }
  if (proof.missing_context_files.length > 0) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_missing_context_files`,
      stage: "full_context_ai_completion",
      message:
        "Decision task records missing context files and cannot prove full-context AI completion.",
      decision_task: proof.path,
      missing_context_files: proof.missing_context_files,
      source: proof.source,
    });
  }
  if (!proof.context_bundle_sha256) {
    blockers.push({
      code: `full_context_ai_${label}_decision_task_context_hash_missing`,
      stage: "full_context_ai_completion",
      message:
        "Decision task must include context_bundle.sha256 so decisions can be tied to the exact context bundle.",
      decision_task: proof.path,
      source: proof.source,
    });
  }
  return blockers;
}

export function decisionTaskRequiredContextFilePatterns({ requirement, proof, label }) {
  const profilePatterns = ensureArray(requirement.requiredContextFilePatterns);
  if (label === "location") {
    return profilePatterns.filter((pattern) =>
      [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_locations_category.json",
      ].includes(String(pattern).toLowerCase()),
    );
  }
  if (label !== "classification") return profilePatterns;

  const schemaTypeToFile = {
    contact: "tidas_contacts_category.json",
    contacts: "tidas_contacts_category.json",
    flowproperty: "tidas_flowproperties_category.json",
    flowproperties: "tidas_flowproperties_category.json",
    "flow-elementary": "tidas_flows_elementary_category.json",
    elementary: "tidas_flows_elementary_category.json",
    "flow-product": "tidas_flows_product_category.json",
    flow: "tidas_flows_product_category.json",
    lciamethod: "tidas_lciamethods_category.json",
    lciamethods: "tidas_lciamethods_category.json",
    process: "tidas_processes_category.json",
    processes: "tidas_processes_category.json",
    source: "tidas_sources_category.json",
    sources: "tidas_sources_category.json",
    unitgroup: "tidas_unitgroups_category.json",
    unitgroups: "tidas_unitgroups_category.json",
  };
  const payload = proof?.payload ?? {};
  const schemaTypes = [
    ...ensureArray(payload.schema_types ?? payload.schemaTypes),
    ...ensureArray(payload.row_types ?? payload.rowTypes),
  ]
    .map((value) => asText(value).toLowerCase())
    .filter(Boolean);
  const required = new Set([
    "schema.json",
    "methodology.yaml",
    "runtime-ruleset.json",
    "tidas_locations_category.json",
  ]);
  for (const schemaType of schemaTypes) {
    const fileName = schemaTypeToFile[schemaType];
    if (fileName) required.add(fileName);
  }
  if (schemaTypes.length === 0) {
    for (const pattern of profilePatterns) {
      if (contextFilesHavePattern(proof?.contract_context_files, pattern)) {
        required.add(String(pattern).toLowerCase());
      }
    }
  }
  return profilePatterns.filter((pattern) =>
    required.has(String(pattern).toLowerCase()),
  );
}

export function readClassificationDecisionApplyContext(
  repoRoot,
  classificationDecisionApplyArtifact,
  sourceLabel = "classification_decision_apply",
) {
  if (!classificationDecisionApplyArtifact) return null;
  const report = classificationDecisionApplyArtifact.value ?? {};
  const decisionsFile = resolveRepoPath(
    repoRoot,
    report.decisions_file || report.decisionsFile,
  );
  let decisions = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(
      readJsonOrJsonl(decisionsFile),
    );
  }
  const decisionTaskProofs = decisionTaskProofsFromApplyReport(
    repoRoot,
    report,
    sourceLabel,
  );
  const inputRows = ensureArray(report.files?.input_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const outputRows = ensureArray(report.files?.output_rows)
    .map((filePath) => resolveRepoPath(repoRoot, filePath))
    .filter(Boolean);
  const fallbackDatasetType =
    decisions.some((decision) =>
      asText(decision?.category_type ?? decision?.categoryType).startsWith(
        "flow",
      ),
    )
      ? "flow"
      : decisions.some(
            (decision) =>
              asText(decision?.category_type ?? decision?.categoryType) ===
              "process",
          )
        ? "process"
        : null;
	  return {
	    status: asText(report.status),
	    reportPath: classificationDecisionApplyArtifact.path,
	    decisionsFile,
	    decisions,
    decisionTaskProof:
      decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null,
    decisionTaskProofs,
    inputRows,
	    outputRows,
    inputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      inputRows,
      fallbackDatasetType,
    ),
    outputPayloadSha256ByIdentity: payloadSha256ByIdentityForRows(
      repoRoot,
      outputRows,
      fallbackDatasetType,
    ),
    applied: Number(report.counts?.applied ?? 0) || 0,
  };
}

export function cleanupInputRowsFile(repoRoot, cleanupArtifact) {
  const inputRows =
    cleanupArtifact?.value?.rows_file ??
    cleanupArtifact?.value?.rowsFile ??
    cleanupArtifact?.value?.input_path ??
    cleanupArtifact?.value?.inputPath;
  return inputRows ? resolveRepoPath(repoRoot, inputRows) : null;
}

export function decisionApplyExpectedRowsFile({ repoRoot, rowsFile, cleanupArtifact }) {
  return cleanupArtifact
    ? cleanupInputRowsFile(repoRoot, cleanupArtifact)
    : rowsFile;
}

export function decisionApplyOutputRowsMatch(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
      context?.outputRows.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, expectedRowsFile),
      ),
  );
}

export function decisionApplyInputRowsMatch(repoRoot, context, expectedRowsFile) {
  return Boolean(
    expectedRowsFile &&
      context?.inputRows.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, expectedRowsFile),
      ),
  );
}

export function rowsFileTransformEntriesFromDecisionApply(context, kind) {
  const entries = [];
  if (!context?.inputRows?.length || !context?.outputRows?.length) return entries;
  if (context.status && context.status !== "completed") return entries;
  for (const inputRowsFile of context.inputRows) {
    for (const outputRowsFile of context.outputRows) {
      entries.push({ kind, inputRowsFile, outputRowsFile });
    }
  }
  return entries;
}

export function rowsFileTransformEntriesFromPatchApply(context) {
  if (!context?.inputRowsFile || !context?.outputRows?.length) return [];
  return context.outputRows.map((outputRowsFile) => ({
    kind: "patch_apply",
    inputRowsFile: context.inputRowsFile,
    outputRowsFile,
  }));
}

export function rowsFileTransformEntryFromIdentityReferenceRewrite(context) {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  return [
    {
      kind: "identity_reference_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
    },
  ];
}

export function rowsFileTransformEntryFromUnresolvedExchangeExternalization(context) {
  if (
    context?.status !== "completed" ||
    !context.inputRowsFile ||
    !context.outputRowsFile
  ) {
    return [];
  }
  return [
    {
      kind: "unresolved_exchange_externalization",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
    },
  ];
}

export function rowsFileTransformEntryFromCanonicalSupportRewrite(context) {
  if (!context?.inputRowsFile || !context?.outputRowsFile) return [];
  const status = asText(context.status);
  if (
    status &&
    ![
      "completed",
      "completed_no_rewrites",
      "completed_with_deferred_rows",
      "blocked",
    ].includes(status)
  ) {
    return [];
  }
  return [
    {
      kind: "canonical_support_rewrite",
      inputRowsFile: context.inputRowsFile,
      outputRowsFile: context.outputRowsFile,
    },
  ];
}

export function deterministicRowsFileTransformEntries({
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  return [
    ...rowsFileTransformEntriesFromPatchApply(patchApplyContext),
    ...rowsFileTransformEntriesFromDecisionApply(
      classificationDecisionApplyContext,
      "classification_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      locationDecisionApplyContext,
      "location_decision_apply",
    ),
    ...rowsFileTransformEntriesFromDecisionApply(
      identityDecisionApplyContext,
      "identity_decision_apply",
    ),
    ...rowsFileTransformEntryFromIdentityReferenceRewrite(
      identityReferenceRewriteContext,
    ),
    ...rowsFileTransformEntryFromUnresolvedExchangeExternalization(
      unresolvedExchangeExternalizationContext,
    ),
    ...rowsFileTransformEntryFromCanonicalSupportRewrite(
      canonicalSupportRewriteContext,
    ),
  ].filter((entry) => entry.inputRowsFile && entry.outputRowsFile);
}

export function rowsFileReachableThroughTransformChain({
  repoRoot,
  startFiles,
  expectedRowsFile,
  transforms,
}) {
  if (!expectedRowsFile) return false;
  const reachable = [];
  const addReachable = (filePath) => {
    if (!filePath) return false;
    if (reachable.some((existing) => sameArtifactPath(repoRoot, existing, filePath))) {
      return false;
    }
    reachable.push(filePath);
    return true;
  };
  for (const filePath of ensureArray(startFiles)) addReachable(filePath);
  if (reachable.some((filePath) => sameArtifactPath(repoRoot, filePath, expectedRowsFile))) {
    return true;
  }
  for (let pass = 0; pass <= transforms.length; pass += 1) {
    let changed = false;
    for (const transform of transforms) {
      const inputReachable = reachable.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, transform.inputRowsFile),
      );
      if (inputReachable) {
        changed = addReachable(transform.outputRowsFile) || changed;
      }
    }
    if (reachable.some((filePath) => sameArtifactPath(repoRoot, filePath, expectedRowsFile))) {
      return true;
    }
    if (!changed) break;
  }
  return false;
}

export function decisionApplyOutputRowsReachableThroughDeterministicTransforms({
  repoRoot,
  context,
  expectedRowsFile,
  patchApplyContext,
  classificationDecisionApplyContext,
  locationDecisionApplyContext,
  identityDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  canonicalSupportRewriteContext,
}) {
  return rowsFileReachableThroughTransformChain({
    repoRoot,
    startFiles: context?.outputRows ?? [],
    expectedRowsFile,
    transforms: deterministicRowsFileTransformEntries({
      patchApplyContext,
      classificationDecisionApplyContext,
      locationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      canonicalSupportRewriteContext,
    }),
  });
}

export function decisionApplyOutputRowsChainThroughPatch(
  repoRoot,
  context,
  patchApplyContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      patchApplyContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        patchApplyContext.inputRowsFile,
      ) &&
      patchApplyContext.outputRows.some((filePath) =>
        sameArtifactPath(repoRoot, filePath, expectedRowsFile),
      ),
  );
}

export function patchApplyOutputChainsThroughIdentityRewrite({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
}) {
  return Boolean(
    patchOut &&
      cleanupInput &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      sameArtifactPath(
        repoRoot,
        patchOut,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        cleanupInput,
      ),
  );
}

export function patchApplyOutputChainsThroughUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  unresolvedExchangeExternalizationContext,
}) {
  return rowsFileChainsThroughUnresolvedExchangeExternalization({
    repoRoot,
    upstreamFile: patchOut,
    finalFile: cleanupInput,
    unresolvedExchangeExternalizationContext,
  });
}

export function patchApplyOutputChainsThroughIdentityRewriteAndUnresolvedExchangeExternalization({
  repoRoot,
  patchOut,
  cleanupInput,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
}) {
  return Boolean(
    patchApplyOutputChainsThroughIdentityRewrite({
      repoRoot,
      patchOut,
      cleanupInput: unresolvedExchangeExternalizationContext?.inputRowsFile,
      identityReferenceRewriteContext,
    }) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: identityReferenceRewriteContext?.outputRowsFile,
        finalFile: cleanupInput,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

export function decisionApplyOutputRowsChainThroughPatchAndIdentityRewrite(
  repoRoot,
  context,
  patchApplyContext,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      patchApplyContext?.inputRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        patchApplyContext.inputRowsFile,
      ) &&
      patchApplyContext.outputRows.some((filePath) =>
        sameArtifactPath(
          repoRoot,
          filePath,
          identityReferenceRewriteContext.inputRowsFile,
        ),
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        expectedRowsFile,
      ),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewrite(
  repoRoot,
  context,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        expectedRowsFile,
      ),
  );
}

export function decisionApplyOutputRowsChainThroughIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        context,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}

export function decisionApplyOutputRowsChainThroughClassification(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      classificationDecisionApplyContext?.inputRows.some((filePath) =>
        decisionApplyOutputRowsMatch(repoRoot, context, filePath),
      ) &&
      decisionApplyOutputRowsMatch(
        repoRoot,
        classificationDecisionApplyContext,
        expectedRowsFile,
      ),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      identityReferenceRewriteContext?.inputRowsFile &&
      identityReferenceRewriteContext?.outputRowsFile &&
      classificationDecisionApplyContext?.outputRows.some((filePath) =>
        sameArtifactPath(
          repoRoot,
          filePath,
          identityReferenceRewriteContext.inputRowsFile,
        ),
      ) &&
      decisionApplyOutputRowsChainThroughClassification(
        repoRoot,
        context,
        classificationDecisionApplyContext,
        identityReferenceRewriteContext.inputRowsFile,
      ) &&
      sameArtifactPath(
        repoRoot,
        identityReferenceRewriteContext.outputRowsFile,
        expectedRowsFile,
      ),
  );
}

export function decisionApplyOutputRowsChainThroughClassificationIdentityRewriteAndUnresolvedExchangeExternalization(
  repoRoot,
  context,
  classificationDecisionApplyContext,
  identityReferenceRewriteContext,
  unresolvedExchangeExternalizationContext,
  expectedRowsFile,
) {
  return Boolean(
    expectedRowsFile &&
      unresolvedExchangeExternalizationContext?.inputRowsFile &&
      decisionApplyOutputRowsChainThroughClassificationAndIdentityRewrite(
        repoRoot,
        context,
        classificationDecisionApplyContext,
        identityReferenceRewriteContext,
        unresolvedExchangeExternalizationContext.inputRowsFile,
      ) &&
      rowsFileChainsThroughUnresolvedExchangeExternalization({
        repoRoot,
        upstreamFile: unresolvedExchangeExternalizationContext.inputRowsFile,
        finalFile: expectedRowsFile,
        unresolvedExchangeExternalizationContext,
      }),
  );
}
