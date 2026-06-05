import path from "node:path";
import { asText, datasetIdentity, ensureArray, fileExists, isAnnualSupplyTarget, optionList, readJsonOrJsonl, readText, repoRelativePath, resolveRepoPath, unique } from "./part-00.mjs";
import { curationEntityId, defaultSourceReferenceRewriteFile, identityKey, normalizeSourceReferenceRewriteRow, readFileArtifactIfOption, readJsonLines, readRowsIfExists, sha256Text } from "./part-06.mjs";
import { evidenceResolutionMode, readAuthoringPackageProof } from "./part-08.mjs";
import { normalizeClassificationDecisionRows } from "./part-09.mjs";
import { classificationDecisionCompletionStatus } from "./part-10.mjs";
import { referenceKey } from "./part-11.mjs";

export function readSourceReferenceRewriteContext({
  repoRoot,
  rowsFile,
  options,
  writeRows,
}) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.sourceReferenceRewrites ??
      options.sourceReferenceRewritesFile ??
      options.sourceReferenceRewriteFile ??
      options.referenceRewrites ??
      options.referenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultSourceReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const writeKeys = new Set(writeRows.keys());
  const writeIds = new Set(
    [...writeRows.values()].map(({ identity }) => identity.id).filter(Boolean),
  );
  const scopedRows = sourceRows
    .map(normalizeSourceReferenceRewriteRow)
    .filter((row) => {
      if (!row.dataset_id) return false;
      const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
      return writeKeys.has(key) || writeIds.has(row.dataset_id);
    });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
  };
}

export function defaultIdentityReferenceRewriteFile(rowsFile) {
  const rowsDir = path.dirname(rowsFile);
  const candidates = [
    path.join(rowsDir, "identity-reference-rewrites.jsonl"),
    path.join(rowsDir, "identity-flow-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-reference-rewrites.jsonl"),
    path.join(path.dirname(rowsDir), "identity-flow-reference-rewrites.jsonl"),
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

export function normalizeIdentityReferenceRewriteRow(row) {
  const canonical = row?.canonical ?? row?.target ?? row?.replacement ?? null;
  const original = row?.original ?? row?.source ?? null;
  const normalized = {
    ...row,
    dataset_type: asText(row?.dataset_type ?? row?.datasetType) || null,
    dataset_id: asText(row?.dataset_id ?? row?.datasetId ?? row?.entity_id),
    dataset_version:
      asText(row?.dataset_version ?? row?.datasetVersion ?? row?.version) ||
      "00.00.001",
    relation:
      asText(row?.relation) ||
      "flow_reference_to_identity_preflight_duplicate",
    path: asText(row?.path) || null,
    action:
      asText(row?.action) ||
      "rewrite_to_identity_preflight_duplicate_reference",
    reason: asText(row?.reason) || null,
    original,
    canonical,
  };
  normalized.evidence = {
    source: "identity-reference-rewrites.jsonl",
    identity_preflight: row?.identity_preflight ?? null,
    original,
    canonical,
    reason: normalized.reason,
  };
  return normalized;
}

export function readIdentityReferenceRewriteContext({
  repoRoot,
  rowsFile,
  options,
  writeRows,
  referenceRows = [],
  datasetType = null,
}) {
  const configuredFile = resolveRepoPath(
    repoRoot,
    options.identityReferenceRewrites ??
      options.identityReferenceRewritesFile ??
      options.identityFlowReferenceRewrites ??
      options.identityFlowReferenceRewritesFile,
  );
  const sourceFile =
    configuredFile && fileExists(configuredFile)
      ? configuredFile
      : defaultIdentityReferenceRewriteFile(rowsFile);
  const sourceRows = sourceFile ? readJsonLines(sourceFile) : [];
  const scopeIdentities = [
    ...[...writeRows.values()].map(({ identity }) => identity),
    ...ensureArray(referenceRows).map((row, index) =>
      datasetIdentity(row, index, datasetType),
    ),
  ];
  const writeKeys = new Set(scopeIdentities.map(identityKey));
  const writeIds = new Set(
    scopeIdentities.map((identity) => identity.id).filter(Boolean),
  );
  const scopedRows = sourceRows
    .map(normalizeIdentityReferenceRewriteRow)
    .filter((row) => {
      if (!row.dataset_id) return false;
      const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
      return writeKeys.has(key) || writeIds.has(row.dataset_id);
    });
  const byIdentity = new Map();
  for (const row of scopedRows) {
    const key = `${row.dataset_id}@@${row.dataset_version || "00.00.001"}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
    if (!byIdentity.has(row.dataset_id)) byIdentity.set(row.dataset_id, []);
    byIdentity.get(row.dataset_id).push(row);
  }
  return {
    sourceFile,
    sourceRows,
    scopedRows,
    byIdentity,
    status: asText(
      options.identityReferenceRewriteStatus ??
        options.identityReferenceRewritesStatus,
    ),
    inputRowsFile: resolveRepoPath(
      repoRoot,
      options.identityReferenceRewriteInputRows ??
        options.identityReferenceRewriteInputRowsFile,
    ),
    outputRowsFile: resolveRepoPath(
      repoRoot,
      options.identityReferenceRewriteOutputRows ??
        options.identityReferenceRewriteOutputRowsFile,
    ),
  };
}

export function identityDecisionDatasetType(decision) {
  return asText(
    decision?.dataset_type ??
      decision?.datasetType ??
      decision?.kind ??
      decision?.entity_type ??
      decision?.entityType,
  );
}

export function identityDecisionDatasetId(decision) {
  return asText(
    decision?.dataset_id ??
      decision?.datasetId ??
      decision?.entity_id ??
      decision?.entityId ??
      decision?.flow_id ??
      decision?.flowId,
  );
}

export function identityDecisionDatasetVersion(decision) {
  return (
    asText(decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version) ||
    "00.00.001"
  );
}

export function identityDecisionIdentityKeys({ datasetType, id, version }) {
  const normalizedType = asText(datasetType);
  const normalizedId = asText(id);
  const normalizedVersion = asText(version) || "00.00.001";
  if (!normalizedId) return [];
  return [
    `${normalizedType}:${normalizedId}@@${normalizedVersion}`,
    `${normalizedType}:${normalizedId}`,
    `${normalizedId}@@${normalizedVersion}`,
    normalizedId,
  ].filter(Boolean);
}

export function identityDecisionClosesAction(decision, code) {
  return optionList(
    decision?.closes_action_items ??
      decision?.closesActionItems ??
      decision?.resolution?.closes_action_items,
  ).includes(code);
}

export function identityDecisionValue(decision) {
  const raw = asText(
    decision?.identity_decision ??
      decision?.identityDecision ??
      decision?.decision ??
      decision?.resolution?.identity_decision ??
      decision?.resolution?.decision,
  );
  if (["reuse", "reuse_existing", "reference_reuse"].includes(raw)) {
    return "reuse_existing_reference";
  }
  if (["new", "insert", "write_new"].includes(raw)) return "create_new";
  if (["block", "blocked", "unresolved"].includes(raw)) return "block_unresolved";
  return raw;
}

export function identityDecisionCanonical(decision) {
  const canonical =
    decision?.canonical ??
    decision?.selected_reference ??
    decision?.selectedReference ??
    decision?.resolution?.canonical ??
    decision?.resolution?.selected_reference ??
    null;
  if (!canonical || typeof canonical !== "object") return null;
  const id = asText(
    canonical.ref_object_id ??
      canonical.refObjectId ??
      canonical.id ??
      canonical["@refObjectId"],
  );
  if (!id) return null;
  return {
    table: asText(canonical.table) || "flows",
    ref_object_id: id,
    version:
      asText(canonical.version ?? canonical.ref_version ?? canonical["@version"]) ||
      "00.00.001",
  };
}

export function identityDecisionPackageReference(decision) {
  return asText(
    decision?.authoring_package ??
      decision?.authoringPackage ??
      decision?.authoring_context?.authoring_package ??
      decision?.authoringContext?.authoringPackage,
  );
}

export function identityDecisionPackageSha(decision) {
  return asText(
    decision?.authoring_package_sha256 ??
      decision?.authoringPackageSha256 ??
      decision?.authoring_context?.authoring_package_sha256 ??
      decision?.authoringContext?.authoringPackageSha256,
  );
}

export function readIdentityDecisionApplyContext(repoRoot, identityDecisionApplyArtifact) {
  if (!identityDecisionApplyArtifact) return null;
  const report = identityDecisionApplyArtifact.value ?? {};
  const decisionsFile = resolveRepoPath(
    repoRoot,
    report.decisions_file ||
      report.decisionsFile ||
      report.files?.decisions ||
      report.files?.evidence,
  );
  let decisions = [];
  if (decisionsFile && fileExists(decisionsFile)) {
    decisions = normalizeClassificationDecisionRows(readJsonOrJsonl(decisionsFile));
  }
  if (decisions.length === 0) {
    decisions = normalizeClassificationDecisionRows(report.decisions);
  }
  const byIdentity = new Map();
  for (const decision of decisions) {
    const datasetType =
      identityDecisionDatasetType(decision) || asText(report.dataset_type);
    const id = identityDecisionDatasetId(decision);
    const version = identityDecisionDatasetVersion(decision);
    for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(decision);
    }
  }
  const packageProofs = [];
  const seenPackages = new Set();
  for (const decision of decisions) {
    const packageRef = identityDecisionPackageReference(decision);
    if (!packageRef) continue;
    const packageKey = `${packageRef}\u0000${identityDecisionPackageSha(decision)}`;
    if (seenPackages.has(packageKey)) continue;
    seenPackages.add(packageKey);
    packageProofs.push(
      readAuthoringPackageProof(
        repoRoot,
        packageRef,
        identityDecisionPackageSha(decision),
        "identity_decision_apply",
      ),
    );
  }
  return {
    status: asText(report.status),
    reportPath: identityDecisionApplyArtifact.path,
    decisionsFile,
    decisions,
    byIdentity,
    authoringPackageProofs: packageProofs,
    inputRows: ensureArray(
      report.rows_file ?? report.rowsFile ?? report.files?.input_rows,
    )
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    outputRows: ensureArray(report.files?.output_rows)
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    referenceRows: ensureArray(report.files?.reference_rows)
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    identityReferenceRewritesFile: resolveRepoPath(
      repoRoot,
      report.files?.identity_reference_rewrites,
    ),
  };
}

export function mergeIdentityDecisionApplyContexts(contexts) {
  const available = ensureArray(contexts).filter(Boolean);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  const byIdentity = new Map();
  const decisions = [];
  const authoringPackageProofs = [];
  const inputRows = [];
  const outputRows = [];
  const referenceRows = [];
  const identityReferenceRewritesFiles = [];
  const reportPaths = [];
  const seenPackages = new Set();
  for (const context of available) {
    reportPaths.push(context.reportPath);
    decisions.push(...ensureArray(context.decisions));
    inputRows.push(...ensureArray(context.inputRows));
    outputRows.push(...ensureArray(context.outputRows));
    referenceRows.push(...ensureArray(context.referenceRows));
    for (const filePath of ensureArray(context.identityReferenceRewritesFiles)) {
      if (filePath) identityReferenceRewritesFiles.push(filePath);
    }
    if (context.identityReferenceRewritesFile) {
      identityReferenceRewritesFiles.push(context.identityReferenceRewritesFile);
    }
    for (const [key, rows] of context.byIdentity.entries()) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(...rows);
    }
    for (const proof of ensureArray(context.authoringPackageProofs)) {
      const key = JSON.stringify({
        package: proof?.authoring_package ?? proof?.path ?? proof?.package_ref,
        expected: proof?.expected_sha256,
        actual: proof?.actual_sha256,
      });
      if (seenPackages.has(key)) continue;
      seenPackages.add(key);
      authoringPackageProofs.push(proof);
    }
  }
  const uniqueIdentityRewriteFiles = unique(identityReferenceRewritesFiles);
  return {
    status: available.every((context) => context.status === "completed")
      ? "completed"
      : "mixed",
    reportPath: reportPaths[0],
    reportPaths,
    decisionsFile: null,
    decisions,
    byIdentity,
    authoringPackageProofs,
    inputRows: unique(inputRows),
    outputRows: unique(outputRows),
    referenceRows: unique(referenceRows),
    identityReferenceRewritesFile: uniqueIdentityRewriteFiles[0] ?? null,
    identityReferenceRewritesFiles: uniqueIdentityRewriteFiles,
  };
}

export function readIdentityDecisionApplyContexts(repoRoot, artifacts) {
  const artifactList = ensureArray(artifacts).filter(Boolean);
  if (artifactList.length === 0) return null;
  return mergeIdentityDecisionApplyContexts(
    artifactList.map((artifact) =>
      readIdentityDecisionApplyContext(repoRoot, artifact),
    ),
  );
}

export function identityDecisionApplyContextDecisionsForIdentity({
  context,
  datasetType,
  id,
  version,
}) {
  if (!context) return [];
  for (const key of identityDecisionIdentityKeys({ datasetType, id, version })) {
    const rows = context.byIdentity.get(key);
    if (rows?.length) return rows;
  }
  return [];
}

export function identityDecisionApplyContextClosesAction({
  context,
  datasetType,
  id,
  version,
  code,
}) {
  return identityDecisionApplyContextDecisionsForIdentity({
    context,
    datasetType,
    id,
    version,
  }).some(
    (decision) =>
      classificationDecisionCompletionStatus(decision) === "completed" &&
      identityDecisionClosesAction(decision, code),
  );
}

export function identityDecisionApplyContextHasDecision({
  context,
  datasetType,
  id,
  version,
  decisionValue,
  closesAction,
}) {
  return identityDecisionApplyContextDecisionsForIdentity({
    context,
    datasetType,
    id,
    version,
  }).some(
    (decision) =>
      classificationDecisionCompletionStatus(decision) === "completed" &&
      identityDecisionValue(decision) === decisionValue &&
      (!closesAction || identityDecisionClosesAction(decision, closesAction)),
  );
}

export function identityDecisionUnresolvedReferenceKeys(context) {
  const keys = new Set();
  for (const decision of ensureArray(context?.decisions)) {
    const datasetType =
      identityDecisionDatasetType(decision) || asText(decision?.dataset_type);
    if (datasetType !== "flow") continue;
    if (identityDecisionValue(decision) !== "block_unresolved") continue;
    if (
      !identityDecisionClosesAction(
        decision,
        "elementary_flow_identity_manual_review",
      )
    ) {
      continue;
    }
    const id = identityDecisionDatasetId(decision);
    if (!id) continue;
    keys.add(
      referenceKey({
        table: "flows",
        id,
        version: identityDecisionDatasetVersion(decision),
      }),
    );
  }
  return keys;
}

export function mapSchemaRows(schemaReport) {
  const map = new Map();
  for (const row of ensureArray(schemaReport?.rows)) {
    const id = asText(row?.id ?? row?.dataset_id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, row);
    if (!map.has(id)) map.set(id, row);
  }
  return map;
}

export function mapCurationEntities(curationGateReport) {
  const map = new Map();
  for (const entity of ensureArray(
    curationGateReport?.entities ?? curationGateReport?.processes,
  )) {
    const id = curationEntityId(entity);
    const version = asText(entity?.version) || "00.00.001";
    if (!id) continue;
    map.set(`${id}@@${version}`, entity);
    if (!map.has(id)) map.set(id, entity);
  }
  return map;
}

export function normalizeDryRunOperation(operation) {
  switch (operation) {
    case "would_update_existing":
      return "update_existing";
    case "would_insert":
      return "insert";
    case "would_skip":
      return "skip";
    default:
      return operation || null;
  }
}

export function readFlowDryRunArtifacts(repoRoot, dryRunReport) {
  const successFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.success_list,
  );
  const failureFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.remote_failed,
  );
  const success = new Map();
  const failures = new Map();
  for (const row of readRowsIfExists(successFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) success.set(`${id}@@${version}`, row);
  }
  for (const row of readJsonLines(failureFile)) {
    const payload =
      row?.json_ordered ?? row?.jsonOrdered ?? row?.json ?? row?.payload ?? row;
    const identity = datasetIdentity(payload, 0, "flow");
    failures.set(identityKey(identity), row);
  }
  return { success, failures };
}

export function readProcessDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.progress_jsonl,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.failures_jsonl,
  );
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

export function readLifecyclemodelDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.progress_jsonl,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.failures_jsonl,
  );
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

export function readDatasetSaveDraftDryRunArtifacts(repoRoot, dryRunReport) {
  const progressFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.progress_jsonl,
  );
  const failuresFile = resolveRepoPath(
    repoRoot,
    dryRunReport?.files?.failures_jsonl,
  );
  const prepared = new Map();
  const failures = new Map();
  for (const row of readJsonLines(progressFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (!id) continue;
    if (row?.status === "prepared") {
      prepared.set(`${id}@@${version}`, row);
    } else {
      failures.set(`${id}@@${version}`, row);
    }
  }
  for (const row of readJsonLines(failuresFile)) {
    const id = asText(row?.id);
    const version = asText(row?.version) || "00.00.001";
    if (id) failures.set(`${id}@@${version}`, row);
  }
  return { prepared, failures };
}

export function remoteVerifyBlockerKeys(remoteVerifyReport, options = {}) {
  const plannedRootKeys = options.plannedRootKeys ?? new Set();
  const plannedRootIds = options.plannedRootIds ?? new Set();
  const keys = new Set();
  for (const blocker of ensureArray(remoteVerifyReport?.blockers)) {
    const role = asText(blocker?.role);
    const table = asText(blocker?.table);
    const version = asText(
      blocker?.version ??
        blocker?.dataset_version ??
        blocker?.reference_version ??
        blocker?.ref_version,
    );
    for (const key of [
      blocker?.root_id,
      blocker?.dataset_id,
      blocker?.id,
      blocker?.refObjectId,
      blocker?.ref_object_id,
      blocker?.reference_id,
    ]) {
      const value = asText(key);
      if (
        role === "reference" &&
        value &&
        ((table && plannedRootKeys.has(referenceKey({ table, id: value, version }))) ||
          plannedRootIds.has(value))
      ) {
        continue;
      }
      if (value) keys.add(value);
    }
  }
  return keys;
}

export function patchEvidenceIdentityKey(entry) {
  const id = asText(entry?.dataset_id ?? entry?.entity_id ?? entry?.id);
  const version =
    asText(entry?.dataset_version ?? entry?.version) || "00.00.001";
  return id ? `${id}@@${version}` : null;
}

export function compactPatchEvidenceEntry(entry) {
  return {
    row_index: Number.isInteger(entry?.row_index) ? entry.row_index : null,
    dataset_id:
      asText(entry?.dataset_id ?? entry?.entity_id ?? entry?.id) || null,
    dataset_version: asText(entry?.dataset_version ?? entry?.version) || null,
    operation: asText(entry?.op ?? entry?.operation) || null,
    path: asText(entry?.path) || null,
    basis: asText(entry?.basis) || null,
    evidence: entry?.evidence ?? null,
    resolution: entry?.resolution ?? null,
    authoring_package: asText(entry?.authoring_package) || null,
    authoring_package_sha256: asText(entry?.authoring_package_sha256) || null,
    closes_action_items: ensureArray(entry?.closes_action_items),
  };
}

export function readPatchApplyContext(
  repoRoot,
  patchApplyArtifact,
  patchEvidenceFile,
) {
  const report = patchApplyArtifact?.value ?? null;
  const reportPath = patchApplyArtifact?.path ?? null;
  const evidenceFile =
    patchEvidenceFile ??
    readFileArtifactIfOption(repoRoot, report?.files?.patch_evidence) ??
    null;
  const expectedEvidenceCount = Number(report?.evidence_count ?? 0);
  const evidenceRows = evidenceFile ? readJsonLines(evidenceFile) : [];
  const byIdentity = new Map();
  const byRowIndex = new Map();
  const globalBlockers = [];

  if (!report && evidenceFile) {
    globalBlockers.push({
      code: "patch_apply_report_required",
      stage: "ai_patch_apply",
      message:
        "Patch evidence was provided, but dataset-patch-apply-report.json is required to prove deterministic application.",
      patch_evidence_file: repoRelativePath(repoRoot, evidenceFile),
    });
  }
  if (report && report.status !== "completed") {
    globalBlockers.push({
      code: "patch_apply_not_completed",
      stage: "ai_patch_apply",
      message: `dataset-patch-apply status is ${report.status}.`,
      patch_apply_report: reportPath
        ? repoRelativePath(repoRoot, reportPath)
        : null,
    });
  }
  if ((expectedEvidenceCount > 0 || patchEvidenceFile) && !evidenceFile) {
    globalBlockers.push({
      code: "patch_evidence_file_missing",
      stage: "ai_patch_apply",
      message:
        "Patch apply report expects patch evidence, but no readable patch evidence JSONL file was provided.",
      patch_apply_report: reportPath
        ? repoRelativePath(repoRoot, reportPath)
        : null,
    });
  }

  for (const entry of evidenceRows) {
    const compact = compactPatchEvidenceEntry(entry);
    const key = patchEvidenceIdentityKey(entry);
    if (key) {
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(compact);
      if (compact.dataset_id && !byIdentity.has(compact.dataset_id)) {
        byIdentity.set(compact.dataset_id, []);
      }
      if (compact.dataset_id) byIdentity.get(compact.dataset_id).push(compact);
    }
    if (Number.isInteger(entry?.row_index)) {
      if (!byRowIndex.has(entry.row_index)) byRowIndex.set(entry.row_index, []);
      byRowIndex.get(entry.row_index).push(compact);
    }
  }

  return {
    status: report?.status ?? "not_provided",
    report,
    reportPath,
    inputRowsFile: resolveRepoPath(
      repoRoot,
      report?.input_path ?? report?.inputPath ?? report?.files?.input_rows,
    ),
    outputRows: unique([
      report?.out_path,
      report?.outPath,
      report?.output_path,
      report?.outputPath,
      report?.files?.patched_rows,
      report?.files?.output_rows,
    ])
      .flatMap((filePath) => ensureArray(filePath))
      .map((filePath) => resolveRepoPath(repoRoot, filePath))
      .filter(Boolean),
    evidenceFile,
    evidenceRows,
    byIdentity,
    byRowIndex,
    globalBlockers,
  };
}

export function patchEvidenceForRow(patchApplyContext, identity, rowIndex) {
  if (!patchApplyContext) return [];
  const seen = new Set();
  const entries = [
    ...(patchApplyContext.byIdentity.get(identityKey(identity)) ?? []),
    ...(patchApplyContext.byIdentity.get(identity.id) ?? []),
    ...(patchApplyContext.byRowIndex.get(rowIndex) ?? []),
  ];
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function patchEvidenceClosureCodes(entry) {
  return ensureArray(entry?.closes_action_items)
    .map((item) =>
      asText(
        typeof item === "string"
          ? item
          : item?.code ??
              item?.action_item_code ??
              item?.actionItemCode ??
              item?.rule_id ??
              item?.ruleId,
      ),
    )
    .filter(Boolean);
}

export function isDeterministicAnnualSupplyCleanupTrace(trace) {
  const actionCode = asText(trace?.action_item_code);
  const blockedPath = asText(trace?.blocked_path);
  const evidence = trace?.evidence ?? {};
  return (
    isAnnualSupplyTarget(actionCode, blockedPath) &&
    asText(evidence?.source) === "foundry_deterministic_cleanup"
  );
}

export function tracePatchEvidenceBlockers({
  traceSummary,
  aiPatchEvidence,
  identityDecisionApplyContext = null,
}) {
  const blockers = [];
  const deferredEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "deferred_to_common_other",
  );
  for (const trace of ensureArray(traceSummary?.unresolved_traces)) {
    const actionCode = asText(trace?.action_item_code);
    const matched =
      actionCode &&
      deferredEvidence.some((entry) =>
        patchEvidenceClosureCodes(entry).includes(actionCode),
      );
    const identityMatched =
      actionCode === "elementary_flow_identity_manual_review" &&
      identityDecisionApplyContextHasDecision({
        context: identityDecisionApplyContext,
        datasetType: "flow",
        id: trace?.reference_id,
        version: trace?.reference_version,
        decisionValue: "block_unresolved",
        closesAction: "elementary_flow_identity_manual_review",
      });
    if (
      !matched &&
      !identityMatched &&
      !isDeterministicAnnualSupplyCleanupTrace(trace)
    ) {
      blockers.push({
        code: "unresolved_trace_patch_evidence_required",
        stage: "full_context_ai_completion",
        message:
          "Final payload contains tiangongfoundry:unresolvedTrace. Each deferred trace must be backed by same-row AI patch evidence with resolution.mode=deferred_to_common_other, or by an AI identity block_unresolved decision for an elementary flow reference.",
        action_item_code: actionCode || null,
        blocked_path: trace?.blocked_path ?? null,
      });
    }
  }

  const sourceTraceEvidence = aiPatchEvidence.filter(
    (entry) => evidenceResolutionMode(entry) === "source_trace_verified",
  );
  for (const trace of ensureArray(
    traceSummary?.source_exchange_completeness,
  )) {
    if (sourceTraceEvidence.length === 0) {
      blockers.push({
        code: "source_exchange_trace_patch_evidence_required",
        stage: "full_context_ai_completion",
        message:
          "Final payload contains tiangongfoundry:sourceExchangeCompleteness. Source-only exchange acceptance must be backed by same-row AI patch evidence with resolution.mode=source_trace_verified.",
        status: trace?.status ?? null,
      });
    }
  }
  return blockers;
}

export function readPolicySnapshots(repoRoot, profile) {
  const entries = [
    ["safety_policy", "docs/safety-policy.md"],
    ...ensureArray(profile?.docs).map((filePath) => [
      "profile_context",
      filePath,
    ]),
  ];
  return entries.map(([kind, filePath]) => {
    const resolved = resolveRepoPath(repoRoot, filePath);
    if (!fileExists(resolved)) {
      return {
        kind,
        path: path.isAbsolute(filePath) ? filePath : filePath,
        exists: false,
        sha256: null,
      };
    }
    const text = readText(resolved);
    return {
      kind,
      path: repoRelativePath(repoRoot, resolved),
      exists: true,
      sha256: sha256Text(text),
    };
  });
}

export function traceSummaryCount(value) {
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const other = node["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      count += ensureArray(other["tiangongfoundry:importTraceSummary"]).length;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return count;
}

export function collectCommonOtherTraceEntries(value, traceKey, basePath = "$") {
  const entries = [];
  const visit = (node, currentPath) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    const other = node["common:other"];
    if (other && typeof other === "object" && !Array.isArray(other)) {
      const traceValue = other[traceKey];
      if (traceValue !== undefined) {
        ensureArray(traceValue).forEach((entry, index) => {
          entries.push({
            path: `${currentPath}.common:other.${traceKey}${Array.isArray(traceValue) ? `[${index}]` : ""}`,
            entry,
          });
        });
      }
    }
    Object.entries(node).forEach(([key, child]) => {
      if (key === "common:other") return;
      visit(child, `${currentPath}.${key}`);
    });
  };
  visit(value, basePath);
  return entries;
}
