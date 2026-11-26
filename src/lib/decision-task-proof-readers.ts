import path from "node:path";
import type {
  ContextFileInput,
  ContractContext,
  DecisionContextFile,
  DecisionQueueRow,
  DecisionRecord,
  DecisionTaskInput,
  DecisionTaskOptions,
  DecisionTaskProof,
  DecisionTaskUtilsDependencies,
  MissingContextFile,
  SharedContextProof,
  UnknownRecord,
} from "./decision-task-types.ts";

export function asDecisionRecord(value: unknown): DecisionRecord | undefined {
  return value && typeof value === "object" ? (value as DecisionRecord) : undefined;
}

export function createDecisionTaskProofReaders(deps: DecisionTaskUtilsDependencies) {
  const {
    asText,
    ensureArray,
    fileExists,
    normalizedList,
    readJson,
    readText,
    repoRelativePath,
    resolveRepoPath,
    sameResolvedPath,
    sha256Text,
    unique,
  } = deps;

  function classificationDecisionTaskContextKind(kind: string, filePath: unknown) {
    const baseName = path.basename(String(filePath || "")).toLowerCase();
    if (baseName === "schema.json") return "schema";
    if (baseName === "methodology.yaml" || baseName === "methodology.yml") {
      return "methodology_yaml";
    }
    if (baseName === "runtime-ruleset.json") return "ruleset";
    if (baseName === "tidas_locations_category.json") return "location_schema";
    if (/^tidas_.*_category\.json$/u.test(baseName)) {
      return "classification_schema";
    }
    return kind;
  }

  function buildClassificationDecisionTaskContextFiles(
    options: DecisionTaskOptions,
  ): ContractContext {
    const inputs: Array<readonly [string, unknown]> = [
      ["schema", options.schemaFile],
      ["methodology_yaml", options.yamlFile],
      ["ruleset", options.rulesetFile],
      ["context", options.contextFile],
      ["classification_schema", options.classificationSchema],
      ["location_schema", options.locationSchema],
    ];
    const files: DecisionContextFile[] = [];
    const missing: MissingContextFile[] = [];
    for (const [defaultKind, optionValue] of inputs) {
      for (const filePath of normalizedList(optionValue)) {
        const resolved = resolveRepoPath(filePath);
        const kind = classificationDecisionTaskContextKind(defaultKind, filePath);
        if (!resolved || !fileExists(resolved)) {
          missing.push({ kind, path: filePath });
          continue;
        }
        const text = readText(resolved);
        files.push({
          kind,
          path: repoRelativePath(resolved),
          sha256: sha256Text(text),
          bytes: Buffer.byteLength(text, "utf8"),
          text,
        });
      }
    }
    return { files, missing };
  }

  function decisionTaskContextBlockers({
    kind,
    queueRows,
    contractContext,
    requiredContextKinds,
    attachedInputRowCount,
  }: {
    kind: string;
    queueRows: DecisionQueueRow[];
    contractContext: ContractContext;
    requiredContextKinds: string[];
    attachedInputRowCount: number;
  }) {
    if (queueRows.length === 0) return [];
    const blockers: UnknownRecord[] = [];
    const availableKinds = new Set(
      contractContext.files.filter((file) => Number(file.bytes) > 0).map((file) => file.kind),
    );
    for (const missingFile of contractContext.missing) {
      blockers.push({
        code: `${kind}_decision_task_context_file_missing`,
        message: "Decision task cannot be sent to AI while a referenced context file is missing.",
        kind: missingFile.kind,
        path: missingFile.path,
      });
    }
    for (const file of contractContext.files) {
      if (Number(file.bytes) === 0) {
        blockers.push({
          code: `${kind}_decision_task_context_file_empty`,
          message: "Decision task cannot be sent to AI with an empty context file.",
          kind: file.kind,
          path: file.path,
        });
      }
    }
    for (const requiredKind of requiredContextKinds) {
      if (!availableKinds.has(requiredKind)) {
        blockers.push({
          code: `${kind}_decision_task_required_context_missing`,
          message:
            "Decision task must include the full schema/YAML/ruleset/category context before AI authoring.",
          kind: requiredKind,
        });
      }
    }
    const missingInputRows = queueRows.length - attachedInputRowCount;
    if (missingInputRows > 0) {
      blockers.push({
        code: `${kind}_decision_task_input_row_payload_missing`,
        message:
          "Decision task must attach the converted TIDAS row payload for every queued item before AI authoring.",
        missing_input_row_payloads: missingInputRows,
        queue_rows: queueRows.length,
      });
    }
    return blockers;
  }

  function decisionTaskBuildStatus({
    queueRows,
    blockers,
    readyStatus,
    emptyStatus,
  }: {
    queueRows: unknown[];
    blockers: unknown[];
    readyStatus: string;
    emptyStatus: string;
  }) {
    if (queueRows.length === 0) return emptyStatus;
    if (blockers.length > 0) return "blocked_missing_full_context";
    return readyStatus;
  }

  function decisionTaskOptionPath(options: DecisionTaskOptions, kind: string) {
    if (kind === "classification") {
      return (
        options.decisionTask ||
        options.classificationDecisionTask ||
        options.classificationTask ||
        options.taskReport ||
        options.task
      );
    }
    return (
      options.decisionTask ||
      options.locationDecisionTask ||
      options.locationTask ||
      options.taskReport ||
      options.task
    );
  }

  function decisionTaskOptionPaths(options: DecisionTaskOptions, kind: string) {
    return normalizedList(decisionTaskOptionPath(options, kind));
  }

  function readDecisionTaskSharedContextBundleProof(
    task: DecisionTaskInput,
    proofPath: string,
  ): SharedContextProof {
    const contextBundle = task?.context_bundle ?? task?.authoring_context ?? {};
    const sharedContext = task?.shared_context_bundle ?? contextBundle?.shared_context_bundle ?? {};
    const sharedPath = asText(sharedContext?.path ?? task?.files?.shared_context_bundle);
    const expectedSha256 = asText(
      sharedContext?.sha256 ?? contextBundle?.shared_context_bundle_sha256,
    );
    const proof: SharedContextProof = {
      path: sharedPath || null,
      sha256: null,
      expected_sha256: expectedSha256 || null,
      counts: sharedContext?.counts ?? null,
      files: [],
      blockers: [],
    };
    if (!sharedPath) return proof;
    const resolved = resolveRepoPath(sharedPath);
    if (!resolved || !fileExists(resolved)) {
      proof.blockers.push({
        code: "decision_task_shared_context_bundle_missing",
        message: "Decision task references an unreadable shared full-context bundle.",
        decision_task: proofPath,
        shared_context_bundle: sharedPath,
      });
      return proof;
    }
    try {
      const bundle = readJson(resolved);
      proof.sha256 = asText(bundle?.sha256);
      proof.files = ensureArray(bundle?.files);
      proof.counts = bundle?.counts ?? proof.counts;
      if (expectedSha256 && proof.sha256 !== expectedSha256) {
        proof.blockers.push({
          code: "decision_task_shared_context_bundle_hash_mismatch",
          message:
            "Decision task shared context bundle sha256 no longer matches the task reference.",
          decision_task: proofPath,
          shared_context_bundle: sharedPath,
          expected_sha256: expectedSha256,
          actual_sha256: proof.sha256 || null,
        });
      }
    } catch (error) {
      proof.blockers.push({
        code: "decision_task_shared_context_bundle_invalid",
        message: error instanceof Error ? error.message : String(error),
        decision_task: proofPath,
        shared_context_bundle: sharedPath,
      });
    }
    return proof;
  }

  function readDecisionTaskProofFromPath(
    taskPathInput: unknown,
    kind: string,
    queuePath: string,
  ): DecisionTaskProof | null {
    const taskPath = resolveRepoPath(taskPathInput);
    if (!taskPath) return null;
    const proof: DecisionTaskProof = {
      path: repoRelativePath(taskPath),
      sha256: null,
      status: null,
      task_kind: null,
      context_bundle_sha256: null,
      queue: null,
      source_queue: null,
      contract_context_files: [],
      missing_context_files: [],
      shared_context_bundle: null,
      blockers: [],
    };
    if (!fileExists(taskPath)) {
      proof.blockers.push({
        code: `${kind}_decision_task_missing`,
        message: "Decision apply was given an unreadable AI decision task file.",
        decision_task: proof.path,
      });
      return proof;
    }
    try {
      const rawText = readText(taskPath);
      proof.sha256 = sha256Text(rawText);
      const task = JSON.parse(rawText) as DecisionTaskInput;
      const contextBundle = task.context_bundle ?? task.authoring_context;
      proof.status = asText(task.status);
      proof.task_kind = asText(task.task_kind);
      proof.context_bundle_sha256 = asText(
        contextBundle?.sha256 ?? contextBundle?.context_bundle_sha256,
      );
      proof.queue = asText(
        kind === "classification" ? task.classification_queue : task.location_queue,
      );
      proof.source_queue = asText(
        kind === "classification" ? task.source_classification_queue : task.source_location_queue,
      );
      proof.contract_context_files = ensureArray(task.contract_context_files) as ContextFileInput[];
      proof.missing_context_files = ensureArray(task.missing_context_files);
      proof.context_bundle = contextBundle ?? null;
      proof.shared_context_bundle = readDecisionTaskSharedContextBundleProof(task, proof.path);
      proof.blockers.push(...proof.shared_context_bundle.blockers);
      if (kind === "classification" && proof.task_kind !== "classification_decision_authoring") {
        proof.blockers.push({
          code: "classification_decision_task_kind_invalid",
          message: "Classification decisions must be bound to a classification decision task.",
          task_kind: proof.task_kind,
          decision_task: proof.path,
        });
      }
      if (kind === "location" && proof.task_kind !== "location_decision_authoring") {
        proof.blockers.push({
          code: "location_decision_task_kind_invalid",
          message: "Location decisions must be bound to a location decision task.",
          task_kind: proof.task_kind,
          decision_task: proof.path,
        });
      }
      const taskQueuePath = resolveRepoPath(proof.queue);
      const sourceQueuePath = resolveRepoPath(proof.source_queue);
      if (
        !sameResolvedPath(taskQueuePath, queuePath) &&
        !sameResolvedPath(sourceQueuePath, queuePath)
      ) {
        proof.blockers.push({
          code: `${kind}_decision_task_queue_mismatch`,
          message: "Decision task queue does not match the queue being applied.",
          decision_task: proof.path,
          task_queue: proof.queue,
          source_queue: proof.source_queue,
          apply_queue: repoRelativePath(queuePath),
        });
      }
      if (!proof.context_bundle_sha256) {
        proof.blockers.push({
          code: `${kind}_decision_task_context_bundle_missing`,
          message:
            "Decision task must include context_bundle.sha256 so AI output can be tied to the exact context bundle.",
          decision_task: proof.path,
        });
      }
      if (proof.missing_context_files.length > 0) {
        proof.blockers.push({
          code: `${kind}_decision_task_context_files_missing`,
          message:
            "Decision task records missing context files and cannot prove full-context AI completion.",
          decision_task: proof.path,
          missing_context_files: proof.missing_context_files,
        });
      }
    } catch (error) {
      proof.blockers.push({
        code: `${kind}_decision_task_invalid`,
        message: error instanceof Error ? error.message : String(error),
        decision_task: proof.path,
      });
    }
    return proof;
  }

  function readDecisionTaskProof(options: DecisionTaskOptions, kind: string, queuePath: string) {
    const [taskPath] = decisionTaskOptionPaths(options, kind);
    return taskPath ? readDecisionTaskProofFromPath(taskPath, kind, queuePath) : null;
  }

  function readDecisionTaskProofs(options: DecisionTaskOptions, kind: string, queuePath: string) {
    return decisionTaskOptionPaths(options, kind)
      .map((taskPath) => readDecisionTaskProofFromPath(taskPath, kind, queuePath))
      .filter((proof): proof is DecisionTaskProof => proof !== null);
  }

  function decisionContextBundleSha256(decision: unknown) {
    const record = asDecisionRecord(decision);
    return asText(
      record?.authoring_context?.context_bundle_sha256 ??
        record?.authoringContext?.contextBundleSha256 ??
        record?.authoring_context_sha256 ??
        record?.context_bundle_sha256 ??
        record?.contextBundleSha256,
    );
  }

  function decisionCompletionStatus(decision: unknown) {
    const record = asDecisionRecord(decision);
    return asText(record?.decision_status ?? record?.decisionStatus ?? record?.status);
  }

  function decisionTaskReportPayload(proof: DecisionTaskProof | null) {
    if (!proof) return null;
    return {
      path: proof.path,
      sha256: proof.sha256,
      status: proof.status,
      task_kind: proof.task_kind,
      queue: proof.queue,
      source_queue: proof.source_queue,
      context_bundle_sha256: proof.context_bundle_sha256,
      contract_context_files: proof.contract_context_files.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
      missing_context_files: proof.missing_context_files,
      shared_context_bundle: proof.shared_context_bundle
        ? {
            path: proof.shared_context_bundle.path,
            sha256: proof.shared_context_bundle.sha256,
            expected_sha256: proof.shared_context_bundle.expected_sha256,
            counts: proof.shared_context_bundle.counts,
          }
        : null,
    };
  }

  function decisionTaskProofList(proofOrProofs: unknown): DecisionTaskProof[] {
    return ensureArray(proofOrProofs).filter(
      (proof): proof is DecisionTaskProof =>
        Boolean(proof) && typeof proof === "object" && !Array.isArray(proof),
    );
  }

  function decisionTaskContextBundleHashes(
    proofs: DecisionTaskProof | DecisionTaskProof[] | null | undefined,
  ) {
    return unique(decisionTaskProofList(proofs).map((proof) => proof.context_bundle_sha256));
  }

  return {
    classificationDecisionTaskContextKind,
    buildClassificationDecisionTaskContextFiles,
    decisionTaskContextBlockers,
    decisionTaskBuildStatus,
    decisionTaskOptionPath,
    decisionTaskOptionPaths,
    readDecisionTaskSharedContextBundleProof,
    readDecisionTaskProofFromPath,
    readDecisionTaskProof,
    readDecisionTaskProofs,
    decisionContextBundleSha256,
    decisionCompletionStatus,
    decisionTaskReportPayload,
    decisionTaskProofList,
    decisionTaskContextBundleHashes,
  };
}
