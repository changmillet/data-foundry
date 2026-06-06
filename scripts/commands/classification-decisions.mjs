import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function createClassificationDecisionCommands({
  asText,
  buildClassificationDecisionTaskContextFiles,
  buildClassificationTaskProvenanceContext,
  buildDecisionTaskContextBundle,
  classificationDecisionCode,
  classificationDecisionSchemaType,
  classificationDecisionTargetKey,
  classificationDecisionUsedContextKinds,
  classificationQueueInputRows,
  classificationQueueOutputRows,
  classificationQueueRowType,
  classificationQueueSchemaType,
  classificationQueueTargetKey,
  compactStageReport,
  datasetIdentity,
  decisionAuthoringContext,
  decisionCompletionStatus,
  decisionContextBundleSha256,
  decisionTaskBuildStatus,
  decisionTaskChunkLabel,
  decisionTaskContextBlockers,
  decisionTaskContextBundleHashes,
  decisionTaskContextFileSummary,
  decisionTaskInputRowsOverride,
  decisionTaskProofList,
  decisionTaskReportPayload,
  fileExists,
  hasQueueSelectionOptions,
  hasUnresolvedAiPlaceholder,
  nowIso,
  readDecisionTaskProofs,
  readJsonOrJsonLines,
  repoRelativeMaybe,
  repoRelativePath,
  repoRoot,
  resolveRepoPath,
  rewriteDecisionTaskQueueRowsForChunk,
  runTiangongJsonStage,
  selectDecisionTaskQueueRows,
  shellQuote,
  unique,
  writeJson,
  writeJsonLines,
}) {
  function classificationTaskQueueKey(row) {
    return [
      asText(row?.dataset_id),
      asText(row?.dataset_version),
      asText(row?.dataset_type),
      classificationQueueSchemaType(row),
    ].join("::");
  }

  function classificationTaskRowTypeForQueueRow(row) {
    const schemaType = classificationQueueSchemaType(row);
    if (schemaType === "flow-product" || schemaType === "flow-elementary") {
      return "flow";
    }
    return classificationQueueRowType(row) || asText(row?.dataset_type);
  }

  function classificationTaskInputRowIdentity(row, queueRow, index) {
    const rowType = classificationTaskRowTypeForQueueRow(queueRow);
    const identity = datasetIdentity(row, rowType);
    return {
      index,
      row_type: rowType,
      dataset_id: identity.id,
      dataset_version: identity.version,
    };
  }

  function buildClassificationTaskInputRowLookup(queueRows) {
    const byInput = new Map();
    for (const queueRow of queueRows) {
      const inputRows = classificationQueueInputRows(queueRow);
      if (!inputRows) continue;
      const resolved = resolveRepoPath(inputRows);
      if (!resolved || !fileExists(resolved)) continue;
      if (!byInput.has(resolved)) {
        byInput.set(resolved, readJsonOrJsonLines(resolved));
      }
    }
    const lookup = new Map();
    for (const [inputFile, rows] of byInput.entries()) {
      for (const queueRow of queueRows) {
        if (resolveRepoPath(classificationQueueInputRows(queueRow)) !== inputFile) {
          continue;
        }
        for (const [index, row] of rows.entries()) {
          const identity = classificationTaskInputRowIdentity(row, queueRow, index);
          if (
            identity.dataset_id === asText(queueRow.dataset_id) &&
            identity.dataset_version === asText(queueRow.dataset_version)
          ) {
            lookup.set(classificationTaskQueueKey(queueRow), {
              ...identity,
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

  function classificationTaskEvidenceForQueueRow(row, index, rowLookup) {
    const inputRow = rowLookup.get(classificationTaskQueueKey(row)) ?? null;
    return {
      source: "classification-authoring-queue",
      queue_row_index: index,
      current_classification: row.current_classification ?? null,
      source_classification: row.source_classification ?? null,
      authoring_context: row.authoring_context ?? null,
      source_file: row.source_file ?? null,
      input_rows: classificationQueueInputRows(row) || null,
      output_rows: classificationQueueOutputRows(row) || null,
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

  function buildClassificationDecisionTemplateRows(
    queueRows,
    rowLookup = new Map(),
    contextBundle = null,
  ) {
    const authoringContext = contextBundle ? decisionAuthoringContext(contextBundle) : null;
    return queueRows.map((row, index) => ({
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      category_type: classificationQueueSchemaType(row),
      decision_status: "completed",
      code: "__AI_SELECT_TIDAS_CLASSIFICATION_CODE__",
      basis: "__AI_FILL_CLASSIFICATION_DECISION_BASIS__",
      used_context_kinds: ["__AI_FILL_USED_CONTEXT_KINDS__"],
      ...(authoringContext ? { authoring_context: authoringContext } : {}),
      evidence: classificationTaskEvidenceForQueueRow(row, index, rowLookup),
    }));
  }

  function runDatasetClassificationDecisionTaskBuild(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-classification-decision-task-build",
        usage: [
          "node scripts/foundry.mjs dataset-classification-decision-task-build --classification-queue <classification-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
        ],
        purpose:
          "Build an AI-facing classification decision task from Foundry classification queue rows. AI fills TIDAS category codes; deterministic apply is handled by dataset-classification-decisions-apply.",
      };
    }

    const queuePath = resolveRepoPath(
      options.classificationQueue || options.queue || options.input,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
      );
    }
    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/classification-decision-task",
    );
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
    let selection = {
      source_queue_rows: sourceQueueRows.length,
      matched_queue_rows: sourceQueueRows.length,
      selected_queue_rows: sourceQueueRows.length,
      source_queue_row_indices: sourceQueueRows.map((_, index) => index),
    };
    if (shouldDeriveQueue) {
      const selected = useSelection
        ? selectDecisionTaskQueueRows(sourceQueueRows, options, classificationQueueSchemaType)
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
        inputRowsOverride ? "classification-current-rows" : "classification-chunk",
      );
      queueRows = rewriteDecisionTaskQueueRowsForChunk({
        selected: selected.selected,
        sourceQueuePath: queuePath,
        outDir,
        chunkLabel,
        workflowKey: "classification_workflow",
        outputSuffix: "classified",
        inputRowsForRow: classificationQueueInputRows,
        inputRowsOverride,
      });
      selection.chunk_label = chunkLabel;
      taskQueuePath = path.join(outDir, `classification-authoring-queue.${chunkLabel}.jsonl`);
      writeJsonLines(taskQueuePath, queueRows);
    }
    const rowLookup = buildClassificationTaskInputRowLookup(queueRows);
    const templatePath = path.join(outDir, "classification-decisions.template.jsonl");
    const taskPath = path.join(outDir, "classification-decision-task.json");
    const reportPath = path.join(outDir, "classification-decision-task-report.json");
    const decisionFile = path.join(outDir, "classification-decisions.jsonl");
    const contractContext = buildClassificationDecisionTaskContextFiles(options);
    const provenanceContext = buildClassificationTaskProvenanceContext(queuePath);
    const attachedInputRows = [...rowLookup.values()];
    const contextBundle = buildDecisionTaskContextBundle({
      taskKind: "classification_decision_authoring",
      taskPath,
      outDir,
      sharedContextCacheDir,
      queuePath: taskQueuePath,
      queueRows,
      contractContext,
      provenanceContext,
      attachedInputRows,
    });
    const templateRows = buildClassificationDecisionTemplateRows(
      queueRows,
      rowLookup,
      contextBundle,
    );
    const queueRowsWithAttachedInput = templateRows.filter(
      (row) => row.evidence?.input_row_payload,
    ).length;
    const blockers = decisionTaskContextBlockers({
      kind: "classification",
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
    const contextFiles = contractContext.files.map((file) => file.path);
    const schemaTypes = unique(queueRows.map(classificationQueueSchemaType));
    const rowTypes = unique(queueRows.map(classificationQueueRowType));
    const task = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: decisionTaskBuildStatus({
        queueRows,
        blockers,
        readyStatus: "ready_for_ai_classification_decisions",
        emptyStatus: "ready_no_classification_actions",
      }),
      task_kind: "classification_decision_authoring",
      classification_queue: repoRelativePath(taskQueuePath),
      counts: {
        queue_rows: queueRows.length,
        template_decisions: templateRows.length,
        schema_types: schemaTypes.length,
        row_types: rowTypes.length,
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
      schema_types: schemaTypes,
      row_types: rowTypes,
      selection,
      source_classification_queue: shouldDeriveQueue ? repoRelativePath(queuePath) : null,
      classification_queue_rows: queueRows,
      attached_input_rows: attachedInputRows,
      provenance_context: provenanceContext,
      context_bundle: contextBundle,
      shared_context_bundle: contextBundle.shared_context_bundle,
      context_files: contextFiles,
      contract_context_files: contractContext.files.map(decisionTaskContextFileSummary),
      missing_context_files: contractContext.missing,
      instructions: [
        "Read shared_context_bundle once for full Foundry/SDK schema, methodology YAML, runtime ruleset, classification/location schema text, then use this task's queue rows, attached payloads, provenance, and source trace before choosing codes.",
        "Replace each template code with a valid TIDAS leaf code for category_type; keep source classification as evidence, not target classification.",
        "Every decision must include dataset_id, dataset_version, category_type, code, basis, used_context_kinds, and structured evidence.",
        "Do not write row JSON directly; run dataset-classification-decisions-apply after decisions are complete.",
      ],
      files: {
        task: repoRelativePath(taskPath),
        template: repoRelativePath(templatePath),
        expected_decisions: repoRelativePath(decisionFile),
        report: repoRelativePath(reportPath),
        shared_context_bundle: contextBundle.shared_context_bundle.path,
      },
      commands: {
        apply_decisions: [
          process.execPath,
          path.join(repoRoot, "scripts", "foundry.mjs"),
          "dataset-classification-decisions-apply",
          "--classification-queue",
          taskQueuePath,
          "--decisions",
          decisionFile,
          "--decision-task",
          taskPath,
          "--out-dir",
          path.join(outDir, "apply"),
        ]
          .map(shellQuote)
          .join(" "),
      },
    };
    writeJsonLines(templatePath, templateRows);
    writeJson(taskPath, task);
    writeJson(reportPath, task);
    return task;
  }

  function validateClassificationDecisionsForQueue(
    queueRows,
    decisions,
    { decisionTaskProof = null, decisionKind = "classification" } = {},
  ) {
    const blockers = [];
    const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
    for (const proof of decisionTaskProofs) {
      blockers.push(...proof.blockers);
    }
    const contextBundleHashes = decisionTaskContextBundleHashes(decisionTaskProofs);
    const queueByKey = new Map(queueRows.map((row) => [classificationQueueTargetKey(row), row]));
    const decisionsByKey = new Map();
    for (const [index, decision] of decisions.entries()) {
      const schemaType = classificationDecisionSchemaType(decision);
      const key = classificationDecisionTargetKey(decision);
      if (hasUnresolvedAiPlaceholder(decision)) {
        blockers.push({
          code: "classification_decision_template_incomplete",
          message: "Classification decision still contains an AI placeholder.",
          decision_index: index,
        });
        continue;
      }
      if (decisionCompletionStatus(decision) !== "completed") {
        blockers.push({
          code: `${decisionKind}_decision_status_not_completed`,
          message:
            "Classification decision must declare decision_status=completed before deterministic apply.",
          decision_index: index,
          decision_status: decisionCompletionStatus(decision) || null,
        });
      }
      if (!schemaType) {
        blockers.push({
          code: "classification_decision_schema_type_missing",
          message: "Classification decision must include category_type.",
          decision_index: index,
        });
        continue;
      }
      if (!classificationDecisionCode(decision)) {
        blockers.push({
          code: "classification_decision_code_missing",
          message: "Classification decision must include a TIDAS category code.",
          decision_index: index,
        });
      }
      if (!asText(decision.basis)) {
        blockers.push({
          code: "classification_decision_basis_missing",
          message: "Classification decision must include basis.",
          decision_index: index,
        });
      }
      if (!decision.evidence || typeof decision.evidence !== "object") {
        blockers.push({
          code: "classification_decision_evidence_missing",
          message: "Classification decision must include structured evidence.",
          decision_index: index,
        });
      }
      if (classificationDecisionUsedContextKinds(decision).length === 0) {
        blockers.push({
          code: "classification_decision_used_context_missing",
          message:
            "Classification decision must include used_context_kinds so full-context AI evidence is auditable.",
          decision_index: index,
        });
      }
      if (contextBundleHashes.length > 0) {
        const decisionBundleHash = decisionContextBundleSha256(decision);
        if (!decisionBundleHash) {
          blockers.push({
            code: `${decisionKind}_decision_context_bundle_missing`,
            message:
              "Decision must include authoring_context.context_bundle_sha256 from the AI decision task template.",
            decision_index: index,
            decision_tasks: decisionTaskProofs.map((proof) => proof.path),
          });
        } else if (!contextBundleHashes.includes(decisionBundleHash)) {
          blockers.push({
            code: `${decisionKind}_decision_context_bundle_mismatch`,
            message:
              "Decision authoring context hash does not match the AI decision task context bundle.",
            decision_index: index,
            expected_context_bundle_sha256:
              contextBundleHashes.length === 1 ? contextBundleHashes[0] : null,
            expected_context_bundle_sha256_any_of: contextBundleHashes,
            actual_context_bundle_sha256: decisionBundleHash,
            decision_tasks: decisionTaskProofs.map((proof) => proof.path),
          });
        }
      }
      if (!queueByKey.has(key)) {
        blockers.push({
          code: "classification_decision_not_in_queue",
          message:
            "Classification decision does not match a queued dataset_id/version/category_type.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      if (decisionsByKey.has(key)) {
        blockers.push({
          code: "classification_decision_duplicate",
          message: "More than one decision targets the same queue row.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      decisionsByKey.set(key, { ...decision, category_type: schemaType });
    }
    for (const row of queueRows) {
      const key = classificationQueueTargetKey(row);
      if (!decisionsByKey.has(key)) {
        blockers.push({
          code: "classification_queue_item_unclosed",
          message: "Every classification queue row must be closed by one decision.",
          dataset_type: row.dataset_type,
          dataset_id: row.dataset_id,
          dataset_version: row.dataset_version,
          schema_type: classificationQueueSchemaType(row),
        });
      }
    }
    return { blockers, decisionsByKey };
  }

  function outputRowsForClassificationGroup(rows, outDir, inputRows, options) {
    if (options.out && rows.length > 0) return resolveRepoPath(options.out);
    const outputRows = unique(rows.map(classificationQueueOutputRows)).filter(Boolean);
    if (outputRows.length === 1) return resolveRepoPath(outputRows[0]);
    const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
    return path.join(outDir, "rows", `${inputBase}.classified.jsonl`);
  }

  function runDatasetClassificationDecisionsApply(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-classification-decisions-apply",
        wraps: "tiangong-lca dataset classification apply",
        usage: [
          "node scripts/foundry.mjs dataset-classification-decisions-apply --classification-queue <classification-authoring-queue.jsonl> --decisions <classification-decisions.jsonl> --decision-task <classification-decision-task.json> --out-dir <apply-dir>",
        ],
        purpose:
          "Validate AI-authored classification decisions against the Foundry queue and AI context task, then call the CLI classification apply command for each required schema type and row file.",
      };
    }

    const queuePath = resolveRepoPath(options.classificationQueue || options.queue);
    const decisionsPath = resolveRepoPath(
      options.decisions || options.decisionFile || options.input,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--classification-queue is required and must point to classification-authoring-queue.jsonl.",
      );
    }
    if (!decisionsPath || !fileExists(decisionsPath)) {
      throw new Error("--decisions is required and must point to JSON/JSONL decisions.");
    }
    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/classification-decisions-apply",
    );
    const reportPath = path.join(outDir, "classification-decisions-apply-report.json");
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisions = readJsonOrJsonLines(decisionsPath);
    const decisionTaskProofs = readDecisionTaskProofs(options, "classification", queuePath);
    const decisionTaskProof = decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
    const { blockers, decisionsByKey } = validateClassificationDecisionsForQueue(
      queueRows,
      decisions,
      { decisionTaskProof: decisionTaskProofs, decisionKind: "classification" },
    );
    const stages = [];
    const inputRowsFiles = [];
    const outputRows = [];

    if (blockers.length === 0 && queueRows.length > 0) {
      const queueRowsByInput = new Map();
      for (const row of queueRows) {
        const inputRows = resolveRepoPath(
          options.rowsFile || options.inputRows || classificationQueueInputRows(row),
        );
        if (!inputRows || !fileExists(inputRows)) {
          blockers.push({
            code: "classification_input_rows_missing",
            message: "Queued classification workflow input rows file is missing.",
            dataset_id: row.dataset_id,
            schema_type: classificationQueueSchemaType(row),
            input_rows: classificationQueueInputRows(row),
          });
          continue;
        }
        const key = repoRelativePath(inputRows);
        const group = queueRowsByInput.get(key) ?? {
          inputRows,
          rows: [],
        };
        group.rows.push(row);
        queueRowsByInput.set(key, group);
      }

      for (const group of queueRowsByInput.values()) {
        const finalOutputRows = outputRowsForClassificationGroup(
          group.rows,
          outDir,
          group.inputRows,
          options,
        );
        inputRowsFiles.push(repoRelativePath(group.inputRows));
        const schemaTypes = unique(group.rows.map(classificationQueueSchemaType));
        let currentInput = group.inputRows;
        for (const [index, schemaType] of schemaTypes.entries()) {
          const groupRowsForSchema = group.rows.filter(
            (row) => classificationQueueSchemaType(row) === schemaType,
          );
          const groupDecisions = groupRowsForSchema.map((row) =>
            decisionsByKey.get(classificationQueueTargetKey(row)),
          );
          const decisionFile = path.join(
            outDir,
            "decisions",
            `${schemaType}-classification-decisions.jsonl`,
          );
          const isLast = index === schemaTypes.length - 1;
          const stageOutputRows = isLast
            ? finalOutputRows
            : path.join(
                outDir,
                "intermediate",
                `${path.basename(group.inputRows).replace(/\.(jsonl|json)$/iu, "")}.${schemaType}.jsonl`,
              );
          fs.mkdirSync(path.dirname(decisionFile), { recursive: true });
          fs.mkdirSync(path.dirname(stageOutputRows), { recursive: true });
          writeJsonLines(decisionFile, groupDecisions);
          const stage = runTiangongJsonStage(`classification_apply_${schemaType}`, [
            "dataset",
            "classification",
            "apply",
            "--input",
            currentInput,
            "--decisions",
            decisionFile,
            "--out",
            stageOutputRows,
            "--type",
            schemaType,
            "--out-dir",
            path.join(outDir, "classification", schemaType),
            "--json",
          ]);
          stage.report_file = resolveRepoPath(stage.report?.files?.report);
          stages.push(stage);
          if (stage.exit_code !== 0) {
            blockers.push({
              code: "classification_apply_stage_failed",
              message: `CLI classification apply failed for ${schemaType}.`,
              schema_type: schemaType,
              exit_code: stage.exit_code,
              report_file: repoRelativeMaybe(stage.report_file),
            });
            break;
          }
          currentInput = stageOutputRows;
        }
        outputRows.push(repoRelativePath(finalOutputRows));
      }
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "completed",
      command: "dataset-classification-decisions-apply",
      classification_queue: repoRelativePath(queuePath),
      decisions_file: repoRelativePath(decisionsPath),
      decision_task: decisionTaskReportPayload(decisionTaskProof),
      decision_tasks: decisionTaskProofs.map(decisionTaskReportPayload),
      counts: {
        queue_rows: queueRows.length,
        decisions: decisions.length,
        stages: stages.length,
        applied: stages.reduce(
          (total, stage) => total + Number(stage.report?.counts?.applied ?? 0),
          0,
        ),
        blockers: blockers.length,
      },
      blockers,
      stages: stages.map(compactStageReport),
      files: {
        report: repoRelativePath(reportPath),
        input_rows: unique(inputRowsFiles),
        output_rows: outputRows,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetClassificationDecisionTaskBuild,
    runDatasetClassificationDecisionsApply,
  };
}
