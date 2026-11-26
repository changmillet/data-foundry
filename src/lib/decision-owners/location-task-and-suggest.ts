import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { DecisionTaskProof, DecisionTaskUtils } from "../decision-task-utils.ts";

export interface LooseRecord {
  [key: string]: unknown;
}

export interface ContextFile {
  kind?: unknown;
  path?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  [key: string]: unknown;
}

export interface ContractContext {
  files: ContextFile[];
  missing: Array<{ kind: string; path: string; [key: string]: unknown }>;
}

export interface ProvenanceFile {
  file: string | null;
  [key: string]: unknown;
}

export interface ProvenanceContext {
  source_semantics: ProvenanceFile;
  process_source_references: ProvenanceFile;
  source_reference_rewrites: ProvenanceFile;
  [key: string]: ProvenanceFile;
}

export interface DecisionContextBundle {
  task?: string;
  sha256: string;
  contract_context_files?: ContextFile[];
  shared_context_bundle: { path: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface QueueSelection {
  source_queue_rows: number;
  matched_queue_rows: number;
  selected_queue_rows: number;
  source_queue_row_indices: number[];
  input_rows_override?: string | null;
  chunk_label?: string;
  [key: string]: unknown;
}

export interface AttachedInputRow {
  index: number;
  row_type: string;
  dataset_id: string;
  dataset_version: string;
  input_rows: string;
  payload: LooseRecord;
  [key: string]: unknown;
}

export interface DecisionTemplateRow {
  evidence: {
    input_row_payload: LooseRecord | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RuntimeStage {
  exit_code: number;
  report?: LooseRecord;
  report_file?: string | null;
  [key: string]: unknown;
}

export interface StageSummary {
  stderr?: string;
  [key: string]: unknown;
}

export interface LocationDecisionDependencies {
  includeExecutionCommands?: boolean;
  asText: (value: unknown) => string;
  buildClassificationDecisionTaskContextFiles: (options: LooseRecord) => ContractContext;
  buildClassificationTaskProvenanceContext: (queuePath: string) => ProvenanceContext;
  buildDecisionTaskContextBundle: DecisionTaskUtils["buildDecisionTaskContextBundle"];
  classificationDecisionCode: (decision: LooseRecord | undefined) => string;
  classificationDecisionSchemaType: (decision: LooseRecord) => string;
  classificationDecisionUsedContextKinds: (decision: LooseRecord) => string[];
  compactStageReport: (stage: RuntimeStage) => StageSummary;
  datasetIdentity: (
    row: LooseRecord,
    type: string,
  ) => { id: string | null; version: string | null };
  decisionAuthoringContext: (contextBundle: DecisionContextBundle) => Record<string, unknown>;
  decisionCompletionStatus: (decision: LooseRecord | undefined) => string;
  decisionContextBundleSha256: (decision: LooseRecord) => string;
  decisionTaskBuildStatus: DecisionTaskUtils["decisionTaskBuildStatus"];
  decisionTaskChunkLabel: DecisionTaskUtils["decisionTaskChunkLabel"];
  decisionTaskContextBlockers: DecisionTaskUtils["decisionTaskContextBlockers"];
  decisionTaskContextBundleHashes: (proofs: DecisionTaskProof[]) => Array<string | null>;
  decisionTaskContextFileSummary: (file: ContextFile) => unknown;
  decisionTaskInputRowsOverride: (options: LooseRecord) => string | null;
  decisionTaskProofList: (proof: unknown) => DecisionTaskProof[];
  decisionTaskReportPayload: (proof: DecisionTaskProof | null) => unknown;
  ensureArray: (value: unknown) => LooseRecord[];
  fileExists: (filePath: string | null | undefined) => boolean;
  hasQueueSelectionOptions: (options: LooseRecord) => boolean;
  hasUnresolvedAiPlaceholder: (value: unknown) => boolean;
  nowIso: () => string;
  readDecisionTaskProofs: DecisionTaskUtils["readDecisionTaskProofs"];
  readJsonOrJsonLines: (filePath: string) => LooseRecord[];
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  repoRelativePath: (filePath: string) => string;
  repoRoot: string;
  resolveRepoPath: (filePath: unknown) => string | null;
  rewriteDecisionTaskQueueRowsForChunk: DecisionTaskUtils["rewriteDecisionTaskQueueRowsForChunk"];
  runTiangongJsonStage: (stage: string, argv: string[]) => RuntimeStage;
  selectDecisionTaskQueueRows: DecisionTaskUtils["selectDecisionTaskQueueRows"];
  shellQuote: (value: string) => string;
  unique: <T>(values: T[]) => T[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
}

export function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : {};
}

export function recordArray(value: unknown): LooseRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is LooseRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export function createLocationTaskAndSuggestCommands(deps: LocationDecisionDependencies) {
  const {
    includeExecutionCommands = true,
    asText,
    buildClassificationDecisionTaskContextFiles,
    buildClassificationTaskProvenanceContext,
    buildDecisionTaskContextBundle,
    datasetIdentity,
    decisionAuthoringContext,
    decisionTaskBuildStatus,
    decisionTaskChunkLabel,
    decisionTaskContextBlockers,
    decisionTaskContextFileSummary,
    decisionTaskInputRowsOverride,
    ensureArray,
    fileExists,
    hasQueueSelectionOptions,
    nowIso,
    readJsonOrJsonLines,
    repoRelativePath,
    repoRoot,
    resolveRepoPath,
    rewriteDecisionTaskQueueRowsForChunk,
    selectDecisionTaskQueueRows,
    shellQuote,
    unique,
    writeJson,
    writeJsonLines,
  } = deps;

  function locationQueueInputRows(row: LooseRecord): string {
    return asText(asRecord(asRecord(row?.location_workflow).commands).input_rows);
  }

  function locationQueueOutputRows(row: LooseRecord): string {
    return asText(asRecord(asRecord(row?.location_workflow).commands).output_rows);
  }

  function locationQueueTargetKey(row: LooseRecord): string {
    return `location::${asText(row?.dataset_id)}::${asText(
      row?.dataset_version,
    )}::${asText(row?.path)}`;
  }

  function buildLocationTaskInputRowLookup(
    queueRows: LooseRecord[],
  ): Map<string, AttachedInputRow> {
    const byInput = new Map<string, LooseRecord[]>();
    for (const queueRow of queueRows) {
      const inputRows = locationQueueInputRows(queueRow);
      if (!inputRows) continue;
      const resolved = resolveRepoPath(inputRows);
      if (!resolved || !fileExists(resolved)) continue;
      if (!byInput.has(resolved)) {
        byInput.set(resolved, readJsonOrJsonLines(resolved));
      }
    }
    const lookup = new Map<string, AttachedInputRow>();
    for (const [inputFile, rows] of byInput.entries()) {
      for (const queueRow of queueRows) {
        if (resolveRepoPath(locationQueueInputRows(queueRow)) !== inputFile) {
          continue;
        }
        const rowType = asText(queueRow.dataset_type);
        for (const [index, row] of rows.entries()) {
          const identity = datasetIdentity(row, rowType);
          if (
            identity.id === asText(queueRow.dataset_id) &&
            identity.version === asText(queueRow.dataset_version)
          ) {
            lookup.set(locationQueueTargetKey(queueRow), {
              index,
              row_type: rowType,
              dataset_id: identity.id,
              dataset_version: identity.version,
              input_rows: repoRelativePath(inputFile),
              payload: row,
            });
            break;
          }
        }
      }
    }
    return lookup;
  }

  function locationTaskEvidenceForQueueRow(
    row: LooseRecord,
    index: number,
    rowLookup: Map<string, AttachedInputRow>,
  ) {
    const inputRow = rowLookup.get(locationQueueTargetKey(row)) ?? null;
    return {
      source: "location-authoring-queue",
      queue_row_index: index,
      current_location: row.current_location ?? null,
      target_path: row.path ?? null,
      source_file: row.source_file ?? null,
      input_rows: locationQueueInputRows(row) || null,
      output_rows: locationQueueOutputRows(row) || null,
      input_row_index: inputRow?.index ?? null,
      input_row_identity: inputRow
        ? {
            dataset_id: inputRow.dataset_id,
            dataset_version: inputRow.dataset_version,
            row_type: inputRow.row_type,
          }
        : null,
      input_row_payload: inputRow?.payload ?? null,
    };
  }

  function buildLocationDecisionTemplateRows(
    queueRows: LooseRecord[],
    rowLookup = new Map<string, AttachedInputRow>(),
    contextBundle: DecisionContextBundle | null = null,
  ): DecisionTemplateRow[] {
    const authoringContext = contextBundle ? decisionAuthoringContext(contextBundle) : null;
    return queueRows.map((row, index) => ({
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      category_type: "location",
      decision_status: "completed",
      code: "__AI_SELECT_TIDAS_LOCATION_CODE__",
      target_path: row.path,
      basis: "__AI_FILL_LOCATION_DECISION_BASIS__",
      used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
      ...(authoringContext ? { authoring_context: authoringContext } : {}),
      evidence: locationTaskEvidenceForQueueRow(row, index, rowLookup),
    }));
  }

  function runDatasetLocationDecisionTaskBuild(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decision-task-build",
        usage: [
          "node src/dev-cli.ts dataset-location-decision-task-build --location-queue <location-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
        ],
        purpose:
          "Build an AI-facing location coding task from Foundry location queue rows. AI fills TIDAS location codes; deterministic apply is handled by dataset-location-decisions-apply.",
      };
    }

    const queuePath = resolveRepoPath(options.locationQueue || options.queue || options.input);
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--location-queue is required and must point to location-authoring-queue.jsonl.",
      );
    }
    const outDir = resolveRepoPath(options.outDir || ".foundry/workspaces/location-decision-task")!;
    const sharedContextCacheDir = resolveRepoPath(
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    fs.mkdirSync(outDir, { recursive: true });
    const sourceQueueRows = readJsonOrJsonLines(queuePath);
    const useSelection = hasQueueSelectionOptions(options);
    const inputRowsOverride = decisionTaskInputRowsOverride(options);
    const shouldDeriveQueue = useSelection || Boolean(inputRowsOverride);
    let queueRows = sourceQueueRows;
    let taskQueuePath = queuePath;
    let selection: QueueSelection = {
      source_queue_rows: sourceQueueRows.length,
      matched_queue_rows: sourceQueueRows.length,
      selected_queue_rows: sourceQueueRows.length,
      source_queue_row_indices: sourceQueueRows.map((_, index) => index),
    };
    if (shouldDeriveQueue) {
      const selected = useSelection
        ? selectDecisionTaskQueueRows(sourceQueueRows, options, () => "location")
        : {
            selection,
            selected: sourceQueueRows.map((row, sourceIndex) => ({
              row,
              sourceIndex,
            })),
          };
      selection = {
        ...selected.selection,
        input_rows_override: inputRowsOverride ? repoRelativePath(inputRowsOverride) : null,
      };
      const chunkLabel = decisionTaskChunkLabel(
        options,
        selection,
        inputRowsOverride ? "location-current-rows" : "location-chunk",
      );
      queueRows = rewriteDecisionTaskQueueRowsForChunk({
        selected: selected.selected,
        sourceQueuePath: queuePath,
        outDir,
        chunkLabel,
        workflowKey: "location_workflow",
        outputSuffix: "located",
        inputRowsForRow: locationQueueInputRows,
        inputRowsOverride,
      });
      selection.chunk_label = chunkLabel;
      taskQueuePath = path.join(outDir, `location-authoring-queue.${chunkLabel}.jsonl`);
      writeJsonLines(taskQueuePath, queueRows);
    }
    const rowLookup = buildLocationTaskInputRowLookup(queueRows);
    const templatePath = path.join(outDir, "location-decisions.template.jsonl");
    const taskPath = path.join(outDir, "location-decision-task.json");
    const reportPath = path.join(outDir, "location-decision-task-report.json");
    const decisionFile = path.join(outDir, "location-decisions.jsonl");
    const contractContext = buildClassificationDecisionTaskContextFiles(options);
    const provenanceContext = buildClassificationTaskProvenanceContext(queuePath);
    const attachedInputRows = [...rowLookup.values()];
    const contextBundle = buildDecisionTaskContextBundle({
      taskKind: "location_decision_authoring",
      taskPath,
      outDir,
      sharedContextCacheDir,
      queuePath: taskQueuePath,
      queueRows,
      contractContext,
      provenanceContext,
      attachedInputRows,
    });
    const templateRows = buildLocationDecisionTemplateRows(queueRows, rowLookup, contextBundle);
    const queueRowsWithAttachedInput = templateRows.filter(
      (row) => row.evidence?.input_row_payload,
    ).length;
    const blockers = decisionTaskContextBlockers({
      kind: "location",
      queueRows,
      contractContext,
      requiredContextKinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
      attachedInputRowCount: queueRowsWithAttachedInput,
    });
    const datasetTypes = unique(queueRows.map((row) => asText(row.dataset_type)));
    const task = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: decisionTaskBuildStatus({
        queueRows,
        blockers,
        readyStatus: "ready_for_ai_location_decisions",
        emptyStatus: "ready_no_location_actions",
      }),
      task_kind: "location_decision_authoring",
      location_queue: repoRelativePath(taskQueuePath),
      counts: {
        queue_rows: queueRows.length,
        template_decisions: templateRows.length,
        dataset_types: datasetTypes.length,
        contract_context_files: contractContext.files.length,
        missing_context_files: contractContext.missing.length,
        attached_input_rows: queueRowsWithAttachedInput,
        unique_attached_input_rows: attachedInputRows.length,
        missing_input_row_payloads: queueRows.length - queueRowsWithAttachedInput,
        provenance_context_files: [
          provenanceContext.source_semantics.file,
          provenanceContext.process_source_references.file,
          provenanceContext.source_reference_rewrites.file,
        ].filter(Boolean).length,
        blockers: blockers.length,
      },
      blockers,
      dataset_types: datasetTypes,
      selection,
      source_location_queue: shouldDeriveQueue ? repoRelativePath(queuePath) : null,
      location_queue_rows: queueRows,
      attached_input_rows: attachedInputRows,
      provenance_context: provenanceContext,
      context_bundle: contextBundle,
      shared_context_bundle: contextBundle.shared_context_bundle,
      context_files: contractContext.files.map((file) => file.path),
      contract_context_files: contractContext.files.map(decisionTaskContextFileSummary),
      missing_context_files: contractContext.missing,
      instructions: [
        "Read shared_context_bundle once for full Foundry/SDK schema, methodology YAML, runtime ruleset, tidas_locations_category.json text, then use this task's queue rows, attached payloads, provenance, and source trace before choosing location codes.",
        "Replace each template code with a valid TIDAS location code; keep source location text as evidence, not target code.",
        "Every decision must include dataset_id, dataset_version, category_type=location, code, target_path, basis, used_context_kinds, and structured evidence.",
        "Do not write row JSON directly; run dataset-location-decisions-apply after decisions are complete.",
      ],
      files: {
        task: repoRelativePath(taskPath),
        template: repoRelativePath(templatePath),
        expected_decisions: repoRelativePath(decisionFile),
        report: repoRelativePath(reportPath),
        shared_context_bundle: contextBundle.shared_context_bundle.path,
      },
      commands: {
        apply_decisions: includeExecutionCommands
          ? [
              process.execPath,
              path.join(repoRoot, "scripts", "foundry.ts"),
              "dataset-location-decisions-apply",
              "--location-queue",
              taskQueuePath,
              "--decisions",
              decisionFile,
              "--decision-task",
              taskPath,
              "--out-dir",
              path.join(outDir, "apply"),
            ]
              .map(shellQuote)
              .join(" ")
          : null,
      },
    };
    writeJsonLines(templatePath, templateRows);
    writeJson(taskPath, task);
    writeJson(reportPath, task);
    return task;
  }

  function locationDecisionTaskAuthoringContext(task: LooseRecord, taskPath: string) {
    const contextBundle = asRecord(task?.context_bundle ?? task?.contextBundle);
    const contractFiles = recordArray(contextBundle.contract_context_files);
    return {
      task: contextBundle.task ?? repoRelativePath(taskPath),
      context_bundle_sha256: asText(contextBundle.sha256),
      required_context_kinds: unique(
        contractFiles.map((file) => asText(file?.kind)).filter(Boolean),
      ),
      context_files: contractFiles.map((file) => ({
        kind: asText(file?.kind) || "context",
        path: asText(file?.path) || null,
        sha256: asText(file?.sha256) || null,
      })),
    };
  }

  function locationSchemaCodeSet(options: LooseRecord): Set<string> | null {
    const schemaPath = resolveRepoPath(options.locationSchema || options.locationCategorySchema);
    if (!schemaPath || !fileExists(schemaPath)) return null;
    const schemaRows = readJsonOrJsonLines(schemaPath);
    const schema = Array.isArray(schemaRows) && schemaRows.length === 1 ? schemaRows[0] : {};
    const oneOf = recordArray(schema?.oneOf);
    return new Set(oneOf.map((entry) => asText(entry?.const)).filter(Boolean));
  }

  function collectSuggestedLocationCodes(queueRow: LooseRecord): string[] {
    const evidence = asRecord(queueRow?.evidence);
    const values = [
      queueRow?.suggested_location_code,
      queueRow?.suggestedLocationCode,
      queueRow?.suggested_code,
      queueRow?.suggestedCode,
      evidence.suggested_value,
      evidence.suggestedValue,
    ];
    for (const candidate of ensureArray(evidence.candidates)) {
      values.push(candidate?.code);
      values.push(candidate?.suggested_value);
    }
    return unique(values.map(asText).filter(Boolean));
  }

  function runDatasetLocationDecisionsSuggest(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decisions-suggest",
        usage: [
          "node src/dev-cli.ts dataset-location-decisions-suggest --location-queue <location-authoring-queue.jsonl> --decision-task <location-decision-task.json> --location-schema <tidas_locations_category.json> --out-dir <decisions-dir>",
        ],
        purpose:
          "Generate completed location decisions only for queue rows that already contain one provable TIDAS location code candidate, binding each decision to the exact location decision task context bundle.",
      };
    }

    const queuePath = resolveRepoPath(options.locationQueue || options.queue);
    const decisionTaskPath = resolveRepoPath(
      options.decisionTask || options.locationDecisionTask || options.task,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--location-queue is required and must point to location-authoring-queue.jsonl.",
      );
    }
    if (!decisionTaskPath || !fileExists(decisionTaskPath)) {
      throw new Error(
        "--decision-task is required so suggested decisions can bind to the exact full-context task bundle.",
      );
    }
    const outDir = resolveRepoPath(options.outDir || ".foundry/workspaces/location-decisions")!;
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisionTask = readJsonOrJsonLines(decisionTaskPath);
    const taskPayload = Array.isArray(decisionTask) ? decisionTask[0] : decisionTask;
    const authoringContext = locationDecisionTaskAuthoringContext(taskPayload, decisionTaskPath);
    const requiredContextKinds = unique([
      ...authoringContext.required_context_kinds,
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
      "location_authoring_queue",
    ]);
    const validCodes = locationSchemaCodeSet(options);
    const decisions: Array<Record<string, unknown>> = [];
    const manualReview: Array<Record<string, unknown>> = [];

    for (const [index, queueRow] of queueRows.entries()) {
      const candidates = collectSuggestedLocationCodes(queueRow);
      const validCandidates = validCodes
        ? candidates.filter((code) => validCodes.has(code))
        : candidates;
      if (validCandidates.length !== 1) {
        manualReview.push({
          schema_version: 1,
          status: "manual_review",
          reason:
            validCandidates.length === 0
              ? "location_suggestion_missing_or_invalid"
              : "location_suggestion_conflict",
          queue_row_index: index,
          dataset_type: queueRow.dataset_type ?? null,
          dataset_id: queueRow.dataset_id ?? null,
          dataset_version: queueRow.dataset_version ?? null,
          target_path: queueRow.path ?? null,
          candidate_codes: candidates,
          valid_candidate_codes: validCandidates,
          required_human_action:
            "Provide one evidence-backed TIDAS location code decision for this queue row, then rerun deterministic location apply.",
        });
        continue;
      }
      const code = validCandidates[0];
      const usedContextKinds = requiredContextKinds;
      decisions.push({
        schema_version: 1,
        dataset_id: queueRow.dataset_id,
        dataset_version: queueRow.dataset_version,
        category_type: "location",
        decision_status: "completed",
        code,
        target_path: queueRow.path,
        basis: `The location queue contains one valid source-backed TIDAS location code candidate (${code}) for this target path.`,
        authoring_context: authoringContext,
        used_context_kinds: usedContextKinds,
        evidence: {
          source: "dataset-location-decisions-suggest",
          projection: "queue_suggested_location_code_to_decision",
          used_context_kinds: usedContextKinds,
          queue: {
            row_index: index,
            dataset_type: queueRow.dataset_type ?? null,
            dataset_id: queueRow.dataset_id ?? null,
            dataset_version: queueRow.dataset_version ?? null,
            target_path: queueRow.path ?? null,
            current_location: queueRow.current_location ?? null,
            source_file: queueRow.source_file ?? null,
            suggested_location_code: queueRow.suggested_location_code ?? null,
            evidence: queueRow.evidence ?? null,
          },
        },
      });
    }

    const decisionsPath = path.join(outDir, "location-decisions.jsonl");
    const manualReviewPath = path.join(outDir, "location-decisions.manual-review.jsonl");
    const reportPath = path.join(outDir, "dataset-location-decisions-suggest-report.json");
    writeJsonLines(decisionsPath, decisions);
    writeJsonLines(manualReviewPath, manualReview);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: manualReview.length > 0 ? "blocked" : "completed",
      command: "dataset-location-decisions-suggest",
      location_queue: repoRelativePath(queuePath),
      decision_task: repoRelativePath(decisionTaskPath),
      counts: {
        queue_rows: queueRows.length,
        suggested_decisions: decisions.length,
        manual_review: manualReview.length,
        blockers: manualReview.length,
      },
      policy: {
        automatic_scope:
          "Only queue rows with exactly one valid TIDAS location code candidate are converted to decisions. Conflicts or missing candidates remain blocked for human/AI review.",
        apply_boundary:
          "This command creates decision artifacts only; dataset-location-decisions-apply must perform the deterministic row update.",
      },
      blockers: manualReview.map((row) => ({
        code: row.reason,
        message: row.required_human_action,
        dataset_type: row.dataset_type,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        target_path: row.target_path,
        candidate_codes: row.candidate_codes,
        valid_candidate_codes: row.valid_candidate_codes,
      })),
      files: {
        report: repoRelativePath(reportPath),
        decisions: repoRelativePath(decisionsPath),
        manual_review: repoRelativePath(manualReviewPath),
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return {
    locationQueueInputRows,
    locationQueueOutputRows,
    locationQueueTargetKey,
    runDatasetLocationDecisionTaskBuild,
    runDatasetLocationDecisionsSuggest,
  };
}
