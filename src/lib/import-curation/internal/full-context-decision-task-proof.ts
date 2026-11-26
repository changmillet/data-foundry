import { contextFileDetails } from "./context-inputs.ts";
import {
  datasetIdentity,
  detectDatasetType,
  identityFreshnessIdentityKey,
} from "./dataset-payload.ts";
import { sha256Json, sha256Text } from "./hash-utils.ts";
import {
  asText,
  ensureArray,
  fileExists,
  readJson,
  readRows,
  readText,
  repoRelativeArtifactPath,
  repoRelativePath,
  resolveRepoPath,
} from "./runtime-io.ts";

export interface ProofJsonRecord {
  [key: string]: unknown;
}

export interface ProofContextFile extends ProofJsonRecord {
  kind?: unknown;
  path?: unknown;
  text?: unknown;
}

export interface ProofContextFileDetail extends ProofJsonRecord {
  kind: string;
  path: string | null;
  sha256: string;
  bytes: number;
}

export interface ProofBlocker extends ProofJsonRecord {
  code: string;
  stage: string;
  message: string;
}

interface DecisionTaskReference extends ProofJsonRecord {
  path?: unknown;
  task?: unknown;
  decision_task?: unknown;
  decisionTask?: unknown;
  sha256?: unknown;
  context_bundle_sha256?: unknown;
  contextBundleSha256?: unknown;
}

interface DecisionTaskPayload extends ProofJsonRecord {
  status?: unknown;
  task_kind?: unknown;
  context_bundle?: unknown;
  authoring_context?: unknown;
  shared_context_bundle?: unknown;
  contract_context_files?: unknown;
  missing_context_files?: unknown;
  schema_types?: unknown;
  schemaTypes?: unknown;
  row_types?: unknown;
  rowTypes?: unknown;
  files?: unknown;
}

export interface SharedContextBundleProof {
  path: string | null;
  sha256: string | null;
  expected_sha256: string | null;
  files: ProofContextFile[];
  blockers: ProofBlocker[];
}

export interface DecisionTaskProof {
  source: unknown;
  path: string | null;
  exists: boolean;
  sha256: string | null;
  expected_sha256: string | null;
  expected_context_bundle_sha256: string | null;
  payload: DecisionTaskPayload | null;
  status: string | null;
  task_kind: string | null;
  context_bundle_sha256: string | null;
  contract_context_files: ProofContextFile[];
  contract_context_file_details: ProofContextFileDetail[];
  missing_context_files: unknown[];
  shared_context_bundle: SharedContextBundleProof | null;
  blockers: ProofBlocker[];
}

export interface FullContextRequirement {
  requiredContextKinds: string[];
  requiredContextFilePatterns: string[];
}

interface FullContextBlockerOptions<TProof> {
  requirement: FullContextRequirement;
  proof: TProof;
}

interface DecisionTaskEvidence {
  blockers: ProofJsonRecord[];
  payload: DecisionTaskPayload | null;
  path?: unknown;
  source?: unknown;
  task_kind?: unknown;
  status?: unknown;
  contract_context_files?: unknown;
  missing_context_files: unknown[];
  context_bundle_sha256?: unknown;
}

interface DecisionTaskBlockerOptions extends FullContextBlockerOptions<DecisionTaskEvidence | null> {
  label: string;
}

export function contextFileArray(value: unknown): ProofContextFile[] {
  return ensureArray(value) as ProofContextFile[];
}

export function contextFileHasNonEmptyText(file: ProofContextFile | null | undefined): boolean {
  return Buffer.byteLength(String(file?.text ?? ""), "utf8") > 0;
}

export function contextFilesHaveKind(files: unknown, kind: unknown): boolean {
  return contextFileArray(files).some(
    (file) => asText(file?.kind) === kind && contextFileHasNonEmptyText(file),
  );
}

export function contextFilesHavePattern(files: unknown, pattern: unknown): boolean {
  const needle = String(pattern).toLowerCase();
  return contextFileArray(files).some(
    (file) =>
      String(file?.path ?? "")
        .toLowerCase()
        .includes(needle) && contextFileHasNonEmptyText(file),
  );
}

export function normalizeClassificationDecisionRows(value: unknown): unknown[] {
  const record = value as { decisions?: unknown; rows?: unknown } | null | undefined;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(record?.decisions)) return record.decisions.filter(Boolean);
  if (Array.isArray(record?.rows)) return record.rows.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

export function readDecisionTaskProof(
  repoRoot: string,
  taskRef: unknown,
  expectedSha256: unknown = null,
  expectedContextBundleSha256: unknown = null,
  source: unknown = null,
): DecisionTaskProof {
  const taskPath = resolveRepoPath(repoRoot, taskRef as string | null | undefined);
  const proof: DecisionTaskProof = {
    source,
    path: taskRef ? repoRelativeArtifactPath(repoRoot, taskRef) : null,
    exists: false,
    sha256: null,
    expected_sha256: asText(expectedSha256) || null,
    expected_context_bundle_sha256: asText(expectedContextBundleSha256) || null,
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
      message: "Full-context decision evidence references an unreadable AI decision task.",
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
    proof.payload = JSON.parse(rawText) as DecisionTaskPayload;
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
  if (!proof.payload || typeof proof.payload !== "object" || Array.isArray(proof.payload)) {
    proof.blockers.push({
      code: "full_context_decision_task_invalid",
      stage: "full_context_ai_completion",
      message: "Decision task must be a JSON object.",
      decision_task: proof.path,
      source,
    });
    return proof;
  }
  const contextBundle = (proof.payload.context_bundle ??
    proof.payload.authoring_context ??
    {}) as ProofJsonRecord;
  proof.status = asText(proof.payload.status);
  proof.task_kind = asText(proof.payload.task_kind);
  proof.context_bundle_sha256 = asText(contextBundle.sha256 ?? contextBundle.context_bundle_sha256);
  proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(
    repoRoot,
    proof.payload,
    proof.path,
  );
  proof.blockers.push(...proof.shared_context_bundle.blockers);
  proof.contract_context_files = [
    ...contextFileArray(proof.payload.contract_context_files),
    ...proof.shared_context_bundle.files,
  ];
  proof.contract_context_file_details = contextFileDetails(proof.contract_context_files);
  proof.missing_context_files = ensureArray(proof.payload.missing_context_files);
  if (proof.expected_sha256 && proof.expected_sha256 !== proof.sha256) {
    proof.blockers.push({
      code: "full_context_decision_task_hash_mismatch",
      stage: "full_context_ai_completion",
      message: "Recorded decision task sha256 does not match the current decision task content.",
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
      message: "Recorded decision task context bundle hash does not match the decision task.",
      decision_task: proof.path,
      expected_context_bundle_sha256: proof.expected_context_bundle_sha256,
      actual_context_bundle_sha256: proof.context_bundle_sha256,
      source,
    });
  }
  return proof;
}

export function decisionTaskProofFromApplyReport(
  repoRoot: string,
  report: ProofJsonRecord | null | undefined,
  source: unknown,
): DecisionTaskProof | null {
  const task = (report?.decision_task ?? report?.decisionTask) as
    DecisionTaskReference | null | undefined;
  const taskRef = asText(task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask);
  if (!taskRef) return null;
  return readDecisionTaskProof(
    repoRoot,
    taskRef,
    task?.sha256,
    task?.context_bundle_sha256 ?? task?.contextBundleSha256,
    source,
  );
}

export function readDecisionTaskSharedContextBundleProof(
  repoRoot: string,
  payload: DecisionTaskPayload | null | undefined,
  taskPath: unknown,
): SharedContextBundleProof {
  const contextBundle = (payload?.context_bundle ??
    payload?.authoring_context ??
    {}) as ProofJsonRecord;
  const sharedContext = (payload?.shared_context_bundle ??
    contextBundle.shared_context_bundle ??
    {}) as ProofJsonRecord;
  const payloadFiles = payload?.files as ProofJsonRecord | null | undefined;
  const sharedPath = asText(sharedContext?.path ?? payloadFiles?.shared_context_bundle);
  const expectedSha256 = asText(
    sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
  );
  const proof: SharedContextBundleProof = {
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
      message: "Decision task references an unreadable shared full-context bundle.",
      decision_task: taskPath,
      shared_context_bundle: proof.path,
    });
    return proof;
  }
  try {
    const bundle = readJson<ProofJsonRecord | null>(bundlePath);
    proof.sha256 = asText(bundle?.sha256);
    proof.files = contextFileArray(bundle?.files);
    if (expectedSha256 && proof.sha256 !== expectedSha256) {
      proof.blockers.push({
        code: "full_context_decision_task_shared_context_bundle_hash_mismatch",
        stage: "full_context_ai_completion",
        message: "Decision task shared context bundle sha256 no longer matches the task reference.",
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

export function decisionTaskProofsFromApplyReport(
  repoRoot: string,
  report: ProofJsonRecord | null | undefined,
  source: unknown,
): DecisionTaskProof[] {
  const tasks = ensureArray(
    report?.decision_tasks ?? report?.decisionTasks,
  ) as DecisionTaskReference[];
  if (tasks.length === 0) {
    const single = decisionTaskProofFromApplyReport(repoRoot, report, source);
    return single ? [single] : [];
  }
  return tasks
    .map((task) => {
      const taskRef = asText(task?.path ?? task?.task ?? task?.decision_task ?? task?.decisionTask);
      if (!taskRef) return null;
      return readDecisionTaskProof(
        repoRoot,
        taskRef,
        task?.sha256,
        task?.context_bundle_sha256 ?? task?.contextBundleSha256,
        source,
      );
    })
    .filter(Boolean) as DecisionTaskProof[];
}

export function payloadSha256ByIdentityForRows(
  repoRoot: string,
  rowFiles: unknown,
  fallbackDatasetType: string | null = null,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rowFile of ensureArray(rowFiles)) {
    const resolved = resolveRepoPath(repoRoot, rowFile as string | null | undefined);
    if (!resolved || !fileExists(resolved)) continue;
    readRows(resolved).forEach((row, index) => {
      const datasetType = detectDatasetType(row, fallbackDatasetType);
      if (!datasetType) return;
      const identity = datasetIdentity(row, index, datasetType);
      const key = identityFreshnessIdentityKey({ datasetType, identity });
      if (key) map.set(key, sha256Json(identity.payload));
    });
  }
  return map;
}

export function fullContextDecisionTaskProofBlockers({
  requirement,
  proof,
  label,
}: DecisionTaskBlockerOptions): ProofJsonRecord[] {
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
    label === "location" ? "location_decision_authoring" : "classification_decision_authoring";
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
      message: "Decision apply report must reference a ready full-context AI decision task.",
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

export function decisionTaskRequiredContextFilePatterns({
  requirement,
  proof,
  label,
}: DecisionTaskBlockerOptions): string[] {
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

  const schemaTypeToFile: Record<string, string> = {
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
  return profilePatterns.filter((pattern) => required.has(String(pattern).toLowerCase()));
}
