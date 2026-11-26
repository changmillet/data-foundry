import path from "node:path";
import { asDecisionRecord, createDecisionTaskProofReaders } from "./decision-task-proof-readers.ts";
import type {
  AttachedInputRow,
  ContextFileInput,
  ContractContext,
  DecisionContextFile,
  DecisionQueueRow,
  DecisionRecord,
  DecisionTaskOptions,
  DecisionTaskUtilsDependencies,
  DecisionWorkflow,
  ProvenanceEntry,
  QueueSelection,
  SelectedQueueRow,
  UnknownRecord,
} from "./decision-task-types.ts";

export type {
  AttachedInputRow,
  ContextFileInput,
  ContextKindEvidence,
  ContractContext,
  DecisionContextFile,
  DecisionQueueRow,
  DecisionRecord,
  DecisionTaskInput,
  DecisionTaskOptions,
  DecisionTaskProof,
  DecisionWorkflow,
  MissingContextFile,
  ProvenanceEntry,
  QueueSelection,
  SelectedQueueRow,
  SharedContextInput,
  SharedContextProof,
  TaskContextInput,
  WorkflowCommands,
} from "./decision-task-types.ts";

export function createDecisionTaskUtils(deps: DecisionTaskUtilsDependencies) {
  const {
    asText,
    cloneJson,
    ensureArray,
    fileExists,
    integerOption,
    normalizedList,
    nowIso,
    positiveIntegerOption,
    readJson,
    readJsonLines,
    repoRelativePath,
    resolveRepoPath,
    sha256Text,
    unique,
    writeJson,
  } = deps;
  const proofReaders = createDecisionTaskProofReaders(deps);

  function classificationQueueSchemaType(row: DecisionQueueRow) {
    return asText(
      row?.classification_workflow?.schema_type ??
        row?.schema_type ??
        row?.category_type ??
        row?.type,
    );
  }

  function classificationQueueRowType(row: DecisionQueueRow) {
    return asText(row?.classification_workflow?.row_type ?? row?.dataset_type);
  }

  function classificationQueueInputRows(row: DecisionQueueRow) {
    return asText(row?.classification_workflow?.commands?.input_rows);
  }

  function classificationQueueOutputRows(row: DecisionQueueRow) {
    return asText(row?.classification_workflow?.commands?.output_rows);
  }

  function queueRowSourceFile(row: DecisionQueueRow) {
    return asText(row?.source_file ?? row?.sourceFile);
  }

  function queueRowBundleId(row: DecisionQueueRow) {
    const match = queueRowSourceFile(row).match(/(?:^|\/)process-bundles\/([^/]+)\//u);
    return match?.[1] ?? "";
  }

  function hasQueueSelectionOptions(options: DecisionTaskOptions) {
    return Boolean(
      normalizedList(options.datasetId || options.datasetIds || options.id).length ||
      normalizedList(options.datasetType || options.datasetTypes).length ||
      normalizedList(
        options.categoryType || options.categoryTypes || options.schemaType || options.schemaTypes,
      ).length ||
      normalizedList(options.bundleId || options.bundleIds || options.processId).length ||
      integerOption(options.offset, null) !== null ||
      positiveIntegerOption(options.limit || options.count, null) !== null,
    );
  }

  function queueSelectionSummary(options: DecisionTaskOptions): QueueSelection {
    return {
      dataset_ids: normalizedList(options.datasetId || options.datasetIds || options.id),
      dataset_types: normalizedList(options.datasetType || options.datasetTypes),
      category_types: normalizedList(
        options.categoryType || options.categoryTypes || options.schemaType || options.schemaTypes,
      ),
      bundle_ids: normalizedList(options.bundleId || options.bundleIds || options.processId),
      offset: Math.max(0, integerOption(options.offset, 0) ?? 0),
      limit: positiveIntegerOption(options.limit || options.count, null),
    };
  }

  function queueRowMatchesSelection<Row extends DecisionQueueRow>(
    row: Row,
    selection: QueueSelection,
    schemaTypeForRow: (row: Row) => string,
  ) {
    const datasetId = asText(row?.dataset_id);
    const datasetType = asText(row?.dataset_type);
    const categoryType = schemaTypeForRow(row);
    const bundleId = queueRowBundleId(row);
    if (selection.dataset_ids.length > 0 && !selection.dataset_ids.includes(datasetId)) {
      return false;
    }
    if (selection.dataset_types.length > 0 && !selection.dataset_types.includes(datasetType)) {
      return false;
    }
    if (selection.category_types.length > 0 && !selection.category_types.includes(categoryType)) {
      return false;
    }
    if (selection.bundle_ids.length > 0 && !selection.bundle_ids.includes(bundleId)) {
      return false;
    }
    return true;
  }

  function selectDecisionTaskQueueRows<Row extends DecisionQueueRow>(
    queueRows: Row[],
    options: DecisionTaskOptions,
    schemaTypeForRow: (row: Row) => string,
  ) {
    const selection = queueSelectionSummary(options);
    const filtered = queueRows
      .map((row, sourceIndex) => ({ row, sourceIndex }))
      .filter(({ row }) => queueRowMatchesSelection(row, selection, schemaTypeForRow));
    const start = selection.offset;
    const end = selection.limit ? start + selection.limit : undefined;
    const selected = filtered.slice(start, end);
    return {
      selection: {
        ...selection,
        source_queue_rows: queueRows.length,
        matched_queue_rows: filtered.length,
        selected_queue_rows: selected.length,
        source_queue_row_indices: selected.map((item) => item.sourceIndex),
      },
      selected,
    };
  }

  function safeFileToken(value: unknown, fallback: string) {
    const token = asText(value)
      .replace(/[^A-Za-z0-9_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return token || fallback;
  }

  function decisionTaskChunkLabel(
    options: DecisionTaskOptions,
    selection: Partial<QueueSelection> & Record<string, unknown>,
    fallback: string,
  ) {
    if (options.chunkLabel || options.chunk || options.label) {
      return safeFileToken(options.chunkLabel || options.chunk || options.label, fallback);
    }
    const bundleIds = ensureArray(selection.bundle_ids);
    const datasetTypes = ensureArray(selection.dataset_types);
    const categoryTypes = ensureArray(selection.category_types);
    if (bundleIds.length === 1) {
      return safeFileToken(`bundle-${bundleIds[0]}`, fallback);
    }
    if (datasetTypes.length === 1 && categoryTypes.length === 1) {
      return safeFileToken(`${datasetTypes[0]}-${categoryTypes[0]}`, fallback);
    }
    if (datasetTypes.length === 1) {
      return safeFileToken(datasetTypes[0], fallback);
    }
    return safeFileToken(`offset-${selection.offset}-limit-${selection.limit ?? "all"}`, fallback);
  }

  function rewriteDecisionTaskQueueRowsForChunk({
    selected,
    sourceQueuePath,
    outDir,
    chunkLabel,
    workflowKey,
    outputSuffix,
    inputRowsForRow,
    inputRowsOverride = null,
  }: {
    selected: SelectedQueueRow[];
    sourceQueuePath: string;
    outDir: string;
    chunkLabel: string;
    workflowKey: string;
    outputSuffix: string;
    inputRowsForRow: (row: DecisionQueueRow) => unknown;
    inputRowsOverride?: string | null;
  }) {
    const outputByInput = new Map<string, string>();
    return selected.map(({ row, sourceIndex }) => {
      const next = cloneJson(row);
      const inputRows = inputRowsOverride || resolveRepoPath(inputRowsForRow(next));
      const inputBase = inputRows
        ? path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "")
        : `rows-${sourceIndex}`;
      if (!outputByInput.has(inputBase)) {
        outputByInput.set(
          inputBase,
          path.join(outDir, "rows", `${inputBase}.${chunkLabel}.${outputSuffix}.jsonl`),
        );
      }
      next.foundry_selection = {
        source_queue: repoRelativePath(sourceQueuePath),
        source_queue_row_index: sourceIndex,
        bundle_id: queueRowBundleId(row) || null,
      };
      next[workflowKey] ??= {};
      const workflow = next[workflowKey] as DecisionWorkflow;
      workflow.commands ??= {};
      if (inputRowsOverride) {
        workflow.commands.input_rows = repoRelativePath(inputRowsOverride);
      }
      workflow.commands.output_rows = repoRelativePath(outputByInput.get(inputBase)!);
      return next;
    });
  }

  function decisionTaskInputRowsOverride(options: DecisionTaskOptions) {
    const optionValue =
      options.rowsFile ||
      options.inputRows ||
      options.inputRowsFile ||
      options.currentRows ||
      options.currentRowsFile;
    if (!optionValue) return null;
    const resolved = resolveRepoPath(optionValue);
    if (!resolved || !fileExists(resolved)) {
      throw new Error(
        "--rows-file/--input-rows must point to a readable current rows JSON/JSONL file.",
      );
    }
    return resolved;
  }

  function classificationDecisionSchemaType(decision: DecisionRecord) {
    return asText(
      decision?.category_type ??
        decision?.categoryType ??
        decision?.classification_type ??
        decision?.classificationType ??
        decision?.type,
    );
  }

  function classificationDecisionTargetKey(decision: DecisionRecord, schemaType = "") {
    const datasetId = asText(
      decision?.dataset_id ?? decision?.datasetId ?? decision?.id ?? decision?.uuid,
    );
    const version = asText(
      decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
    );
    const type = classificationDecisionSchemaType(decision) || schemaType;
    return `${type}::${datasetId}::${version}`;
  }

  function classificationQueueTargetKey(row: DecisionQueueRow) {
    return `${classificationQueueSchemaType(row)}::${asText(
      row?.dataset_id,
    )}::${asText(row?.dataset_version)}`;
  }

  function classificationDecisionCode(decision: DecisionRecord | undefined) {
    return asText(
      decision?.code ??
        decision?.class_id ??
        decision?.classId ??
        decision?.cat_id ??
        decision?.catId ??
        decision?.leaf_code ??
        decision?.leafCode,
    );
  }

  function classificationDecisionUsedContextKinds(decision: unknown) {
    const record = asDecisionRecord(decision);
    return unique([
      ...normalizedList(record?.used_context_kinds ?? record?.usedContextKinds),
      ...normalizedList(record?.evidence?.used_context_kinds ?? record?.evidence?.usedContextKinds),
      ...normalizedList(
        record?.resolution?.used_context_kinds ?? record?.resolution?.usedContextKinds,
      ),
    ]);
  }

  function readClassificationTaskJsonlContextRows(
    baseDir: string,
    fileName: string,
    maxRows = 2000,
  ) {
    const filePath = path.join(baseDir, fileName);
    if (!fileExists(filePath)) return { file: null, rows: [] };
    const rows = readJsonLines(filePath);
    return {
      file: repoRelativePath(filePath),
      rows: rows.slice(0, maxRows),
      truncated: rows.length > maxRows,
      total_rows: rows.length,
    };
  }

  function buildClassificationTaskProvenanceContext(queuePath: string) {
    const baseDir = path.dirname(queuePath);
    const sourceSemantics = readClassificationTaskJsonlContextRows(
      baseDir,
      "source-semantics.jsonl",
    );
    const processSourceReferences = readClassificationTaskJsonlContextRows(
      baseDir,
      "process-source-references.jsonl",
    );
    const sourceReferenceRewrites = readClassificationTaskJsonlContextRows(
      baseDir,
      "source-reference-rewrites.jsonl",
    );
    return {
      source_semantics: sourceSemantics,
      process_source_references: processSourceReferences,
      source_reference_rewrites: sourceReferenceRewrites,
    };
  }

  function decisionTaskContextFileDetails(contractContext: ContractContext) {
    return contractContext.files.map((file) => ({
      kind: file.kind,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    }));
  }

  function decisionTaskContextFileWithText(file: ContextFileInput): DecisionContextFile {
    const text = String(file?.text ?? "");
    return {
      kind: asText(file?.kind) || "context",
      path: asText(file?.path) || null,
      sha256: asText(file?.sha256) || sha256Text(text),
      bytes: Number(file?.bytes) || Buffer.byteLength(text, "utf8"),
      text,
    };
  }

  function decisionTaskContextFileSummary(file: unknown) {
    const withText = decisionTaskContextFileWithText(asDecisionRecord(file) ?? {});
    return {
      kind: withText.kind,
      path: withText.path,
      sha256: withText.sha256,
      bytes: withText.bytes,
    };
  }

  function dedupeDecisionTaskContextFiles(files: ContextFileInput | ContextFileInput[]) {
    const byKey = new Map<string, DecisionContextFile>();
    for (const file of ensureArray(files).map(decisionTaskContextFileWithText)) {
      const key = JSON.stringify([file.kind, file.path, file.sha256]);
      if (!byKey.has(key)) byKey.set(key, file);
    }
    return [...byKey.values()];
  }

  function writeDecisionTaskSharedContextBundle({
    outDir,
    taskKind,
    files,
    references = [],
    cacheDir = null,
  }: {
    outDir: string;
    taskKind: string;
    files: ContextFileInput | ContextFileInput[];
    references?: UnknownRecord[];
    cacheDir?: unknown;
  }) {
    const uniqueFiles = dedupeDecisionTaskContextFiles(files);
    const uniqueBytes = uniqueFiles.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
    const referenceRows = ensureArray(references);
    const referencedBytes =
      referenceRows.length > 0
        ? referenceRows.reduce((total, ref) => total + (Number(ref.bytes) || 0), 0)
        : uniqueBytes;
    const stablePayload = {
      schema_version: 1,
      kind: "tiangong_foundry_decision_shared_context_bundle",
      task_kind: taskKind,
      counts: {
        files: uniqueFiles.length,
        references: referenceRows.length,
        duplicate_references: Math.max(0, referenceRows.length - uniqueFiles.length),
        unique_context_bytes: uniqueBytes,
        referenced_context_bytes: referencedBytes,
        duplicate_context_bytes_avoided: Math.max(0, referencedBytes - uniqueBytes),
      },
      files: uniqueFiles,
      references: referenceRows,
    };
    const bundle = {
      ...stablePayload,
      generated_at_utc: nowIso(),
      hash_scope:
        "schema_version, kind, task_kind, counts, files, and references; generated_at_utc and output path are excluded so identical decision context keeps a stable hash.",
      sha256: sha256Text(JSON.stringify(stablePayload)),
    };
    const resolvedCacheDir = cacheDir ? resolveRepoPath(cacheDir) : null;
    const bundlePath = resolvedCacheDir
      ? path.join(resolvedCacheDir, `${taskKind}.${bundle.sha256}.json`)
      : path.join(outDir, "shared-context-bundle.json");
    let cacheReused = false;
    if (resolvedCacheDir && fileExists(bundlePath)) {
      try {
        cacheReused = readJson(bundlePath)?.sha256 === bundle.sha256;
      } catch {
        cacheReused = false;
      }
    }
    if (!cacheReused) {
      writeJson(bundlePath, bundle);
    }
    return {
      path: repoRelativePath(bundlePath),
      sha256: bundle.sha256,
      counts: bundle.counts,
      hash_scope: bundle.hash_scope,
      cache: resolvedCacheDir
        ? {
            enabled: true,
            dir: repoRelativePath(resolvedCacheDir),
            reused: cacheReused,
          }
        : {
            enabled: false,
            reused: false,
          },
      instruction:
        "Read this shared bundle once for full schema/YAML/ruleset/category/location text; the decision task carries queue rows, attached payloads, provenance, and the stable context bundle hash used by deterministic apply.",
    };
  }

  function stableDecisionTaskQueueRows(queueRows: DecisionQueueRow | DecisionQueueRow[]) {
    return ensureArray(queueRows).map((row) => {
      const next = cloneJson(row);
      if (next?.classification_workflow?.commands) {
        delete next.classification_workflow.commands.output_rows;
      }
      if (next?.location_workflow?.commands) {
        delete next.location_workflow.commands.output_rows;
      }
      return next;
    });
  }

  function decisionTaskQueueSha256(queueRows: DecisionQueueRow | DecisionQueueRow[]) {
    return sha256Text(JSON.stringify(stableDecisionTaskQueueRows(queueRows)));
  }

  function decisionTaskProvenanceFileDetails(provenanceContext: Record<string, ProvenanceEntry>) {
    return Object.fromEntries(
      Object.entries(provenanceContext).map(([key, value]) => [
        key,
        {
          file: value?.file ?? null,
          total_rows: value?.total_rows ?? 0,
          truncated: Boolean(value?.truncated),
        },
      ]),
    );
  }

  function buildDecisionTaskContextBundle({
    taskKind,
    taskPath,
    outDir,
    sharedContextCacheDir = null,
    queuePath,
    queueRows,
    contractContext,
    provenanceContext,
    attachedInputRows,
  }: {
    taskKind: string;
    taskPath: string;
    outDir?: string | null;
    sharedContextCacheDir?: unknown;
    queuePath: string;
    queueRows: DecisionQueueRow[];
    contractContext: ContractContext;
    provenanceContext: Record<string, ProvenanceEntry>;
    attachedInputRows: AttachedInputRow[];
  }) {
    const contextFiles = dedupeDecisionTaskContextFiles(contractContext.files);
    const contractFiles = contextFiles.map(decisionTaskContextFileSummary);
    const sharedContextBundle = writeDecisionTaskSharedContextBundle({
      outDir: outDir ?? path.dirname(taskPath),
      taskKind,
      files: contextFiles,
      references: contextFiles.map((file) => ({
        kind: file.kind,
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
      cacheDir: sharedContextCacheDir,
    });
    const stablePayload = {
      task_kind: taskKind,
      queue_sha256: decisionTaskQueueSha256(queueRows),
      queue_rows: queueRows.length,
      contract_context_files: contractFiles,
      missing_context_files: contractContext.missing,
      provenance_context: decisionTaskProvenanceFileDetails(provenanceContext),
      attached_input_rows: attachedInputRows.map((row) => ({
        input_rows: row.input_rows,
        input_row_index: row.index,
        row_type: row.row_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
      })),
      shared_context_bundle_sha256: sharedContextBundle.sha256,
    };
    return {
      ...stablePayload,
      task: repoRelativePath(taskPath),
      queue: repoRelativePath(queuePath),
      shared_context_bundle: sharedContextBundle,
      hash_scope:
        "task_kind, normalized queue_sha256, queue_rows, contract_context_files, missing_context_files, provenance_context, attached_input_rows, and shared_context_bundle_sha256; task path, queue path, and generated output_rows paths are excluded.",
      sha256: sha256Text(JSON.stringify(stablePayload)),
    };
  }

  function decisionAuthoringContext(contextBundle: Record<string, unknown>) {
    const rawFiles = contextBundle.contract_context_files;
    const files = Array.isArray(rawFiles) ? (rawFiles as DecisionContextFile[]) : [];
    return {
      task: typeof contextBundle.task === "string" ? contextBundle.task : "",
      context_bundle_sha256: typeof contextBundle.sha256 === "string" ? contextBundle.sha256 : "",
      required_context_kinds: unique(files.map((file) => file.kind)),
      context_files: files.map(({ kind, path: filePath, sha256 }) => ({
        kind,
        path: filePath,
        sha256,
      })),
    };
  }

  return {
    classificationQueueSchemaType,
    classificationQueueRowType,
    classificationQueueInputRows,
    classificationQueueOutputRows,
    queueRowSourceFile,
    queueRowBundleId,
    hasQueueSelectionOptions,
    queueSelectionSummary,
    queueRowMatchesSelection,
    selectDecisionTaskQueueRows,
    safeFileToken,
    decisionTaskChunkLabel,
    rewriteDecisionTaskQueueRowsForChunk,
    decisionTaskInputRowsOverride,
    classificationDecisionSchemaType,
    classificationDecisionTargetKey,
    classificationQueueTargetKey,
    classificationDecisionCode,
    classificationDecisionUsedContextKinds,
    readClassificationTaskJsonlContextRows,
    buildClassificationTaskProvenanceContext,
    decisionTaskContextFileDetails,
    decisionTaskContextFileWithText,
    decisionTaskContextFileSummary,
    dedupeDecisionTaskContextFiles,
    writeDecisionTaskSharedContextBundle,
    stableDecisionTaskQueueRows,
    decisionTaskQueueSha256,
    decisionTaskProvenanceFileDetails,
    buildDecisionTaskContextBundle,
    decisionAuthoringContext,
    ...proofReaders,
  };
}

export type DecisionTaskUtils = ReturnType<typeof createDecisionTaskUtils>;
