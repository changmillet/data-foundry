import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function createLocationDecisionCommands({
  asText,
  buildClassificationDecisionTaskContextFiles,
  buildClassificationTaskProvenanceContext,
  buildDecisionTaskContextBundle,
  classificationDecisionCode,
  classificationDecisionSchemaType,
  classificationDecisionUsedContextKinds,
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
  function locationQueueInputRows(row) {
    return asText(row?.location_workflow?.commands?.input_rows);
  }

  function locationQueueOutputRows(row) {
    return asText(row?.location_workflow?.commands?.output_rows);
  }

  function locationQueueTargetKey(row) {
    return `location::${asText(row?.dataset_id)}::${asText(
      row?.dataset_version,
    )}::${asText(row?.path)}`;
  }

  function locationDecisionTargetPath(decision) {
    return asText(
      decision?.target_path ??
        decision?.targetPath ??
        decision?.location_path ??
        decision?.locationPath ??
        decision?.path,
    );
  }

  function locationDecisionTargetKey(decision) {
    return `location::${asText(
      decision?.dataset_id ?? decision?.datasetId ?? decision?.id,
    )}::${asText(
      decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
    )}::${locationDecisionTargetPath(decision)}`;
  }

  function buildLocationTaskInputRowLookup(queueRows) {
    const byInput = new Map();
    for (const queueRow of queueRows) {
      const inputRows = locationQueueInputRows(queueRow);
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

  function locationTaskEvidenceForQueueRow(row, index, rowLookup) {
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
    queueRows,
    rowLookup = new Map(),
    contextBundle = null,
  ) {
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

  function runDatasetLocationDecisionTaskBuild(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decision-task-build",
        usage: [
          "node scripts/foundry.mjs dataset-location-decision-task-build --location-queue <location-authoring-queue.jsonl> --rows-file <current-rows.jsonl> --schema-file <schema.json> --yaml-file <methodology.yaml> --ruleset-file <runtime-ruleset.json> --classification-schema <tidas_*_category.json> --location-schema <tidas_locations_category.json> --out-dir <task-dir> [--shared-context-cache-dir <cache-dir>]",
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
    const outDir = resolveRepoPath(options.outDir || ".foundry/workspaces/location-decision-task");
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
      requiredContextKinds: ["schema", "methodology_yaml", "ruleset", "location_schema"],
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
        apply_decisions: [
          process.execPath,
          path.join(repoRoot, "scripts", "foundry.mjs"),
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
          .join(" "),
      },
    };
    writeJsonLines(templatePath, templateRows);
    writeJson(taskPath, task);
    writeJson(reportPath, task);
    return task;
  }

  function validateLocationDecisionsForQueue(
    queueRows,
    decisions,
    { decisionTaskProof = null } = {},
  ) {
    const blockers = [];
    const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
    for (const proof of decisionTaskProofs) {
      blockers.push(...proof.blockers);
    }
    const contextBundleHashes = decisionTaskContextBundleHashes(decisionTaskProofs);
    const queueByKey = new Map(queueRows.map((row) => [locationQueueTargetKey(row), row]));
    const decisionsByKey = new Map();
    for (const [index, decision] of decisions.entries()) {
      const key = locationDecisionTargetKey(decision);
      if (hasUnresolvedAiPlaceholder(decision)) {
        blockers.push({
          code: "location_decision_template_incomplete",
          message: "Location decision still contains an AI placeholder.",
          decision_index: index,
        });
        continue;
      }
      if (decisionCompletionStatus(decision) !== "completed") {
        blockers.push({
          code: "location_decision_status_not_completed",
          message:
            "Location decision must declare decision_status=completed before deterministic apply.",
          decision_index: index,
          decision_status: decisionCompletionStatus(decision) || null,
        });
      }
      if (classificationDecisionSchemaType(decision) !== "location") {
        blockers.push({
          code: "location_decision_schema_type_invalid",
          message: "Location decision must include category_type=location.",
          decision_index: index,
        });
      }
      if (!classificationDecisionCode(decision)) {
        blockers.push({
          code: "location_decision_code_missing",
          message: "Location decision must include a TIDAS location code.",
          decision_index: index,
        });
      }
      if (!locationDecisionTargetPath(decision)) {
        blockers.push({
          code: "location_decision_target_path_missing",
          message: "Location decision must include target_path.",
          decision_index: index,
        });
      }
      if (!asText(decision.basis)) {
        blockers.push({
          code: "location_decision_basis_missing",
          message: "Location decision must include basis.",
          decision_index: index,
        });
      }
      if (!decision.evidence || typeof decision.evidence !== "object") {
        blockers.push({
          code: "location_decision_evidence_missing",
          message: "Location decision must include structured evidence.",
          decision_index: index,
        });
      }
      if (classificationDecisionUsedContextKinds(decision).length === 0) {
        blockers.push({
          code: "location_decision_used_context_missing",
          message:
            "Location decision must include used_context_kinds so full-context AI evidence is auditable.",
          decision_index: index,
        });
      }
      if (contextBundleHashes.length > 0) {
        const decisionBundleHash = decisionContextBundleSha256(decision);
        if (!decisionBundleHash) {
          blockers.push({
            code: "location_decision_context_bundle_missing",
            message:
              "Location decision must include authoring_context.context_bundle_sha256 from the AI decision task template.",
            decision_index: index,
            decision_tasks: decisionTaskProofs.map((proof) => proof.path),
          });
        } else if (!contextBundleHashes.includes(decisionBundleHash)) {
          blockers.push({
            code: "location_decision_context_bundle_mismatch",
            message:
              "Location decision authoring context hash does not match the AI decision task context bundle.",
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
          code: "location_decision_not_in_queue",
          message: "Location decision does not match a queued dataset_id/version/target_path.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      if (decisionsByKey.has(key)) {
        blockers.push({
          code: "location_decision_duplicate",
          message: "More than one location decision targets the same queue row.",
          decision_index: index,
          decision_key: key,
        });
        continue;
      }
      decisionsByKey.set(key, { ...decision, category_type: "location" });
    }
    for (const row of queueRows) {
      const key = locationQueueTargetKey(row);
      if (!decisionsByKey.has(key)) {
        blockers.push({
          code: "location_queue_item_unclosed",
          message: "Every location queue row must be closed by one decision.",
          dataset_type: row.dataset_type,
          dataset_id: row.dataset_id,
          dataset_version: row.dataset_version,
          path: row.path,
        });
      }
    }
    return { blockers, decisionsByKey };
  }

  function outputRowsForLocationGroup(rows, outDir, inputRows, options) {
    if (options.out && rows.length > 0) return resolveRepoPath(options.out);
    const outputRows = unique(rows.map(locationQueueOutputRows)).filter(Boolean);
    if (outputRows.length === 1) return resolveRepoPath(outputRows[0]);
    const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
    return path.join(outDir, "rows", `${inputBase}.located.jsonl`);
  }

  function runDatasetLocationDecisionsApply(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decisions-apply",
        wraps: "tiangong-lca dataset classification apply --type location",
        usage: [
          "node scripts/foundry.mjs dataset-location-decisions-apply --location-queue <location-authoring-queue.jsonl> --decisions <location-decisions.jsonl> --decision-task <location-decision-task.json> --out-dir <apply-dir>",
        ],
        purpose:
          "Validate AI-authored location decisions against the Foundry queue and AI context task, then call the CLI location classification apply command for each required row file.",
      };
    }

    const queuePath = resolveRepoPath(options.locationQueue || options.queue);
    const decisionsPath = resolveRepoPath(
      options.decisions || options.decisionFile || options.input,
    );
    if (!queuePath || !fileExists(queuePath)) {
      throw new Error(
        "--location-queue is required and must point to location-authoring-queue.jsonl.",
      );
    }
    if (!decisionsPath || !fileExists(decisionsPath)) {
      throw new Error("--decisions is required and must point to JSON/JSONL location decisions.");
    }
    const outDir = resolveRepoPath(
      options.outDir || ".foundry/workspaces/location-decisions-apply",
    );
    const reportPath = path.join(outDir, "location-decisions-apply-report.json");
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisions = readJsonOrJsonLines(decisionsPath);
    const decisionTaskProofs = readDecisionTaskProofs(options, "location", queuePath);
    const decisionTaskProof = decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
    const { blockers, decisionsByKey } = validateLocationDecisionsForQueue(queueRows, decisions, {
      decisionTaskProof: decisionTaskProofs,
    });
    const stages = [];
    const outputRows = [];

    if (blockers.length === 0 && queueRows.length > 0) {
      const queueRowsByInput = new Map();
      for (const row of queueRows) {
        const inputRows = resolveRepoPath(
          options.rowsFile || options.inputRows || locationQueueInputRows(row),
        );
        if (!inputRows || !fileExists(inputRows)) {
          blockers.push({
            code: "location_input_rows_missing",
            message: "Queued location workflow input rows file is missing.",
            dataset_id: row.dataset_id,
            input_rows: locationQueueInputRows(row),
          });
          continue;
        }
        const key = repoRelativePath(inputRows);
        const group = queueRowsByInput.get(key) ?? { inputRows, rows: [] };
        group.rows.push(row);
        queueRowsByInput.set(key, group);
      }

      for (const group of queueRowsByInput.values()) {
        const finalOutputRows = outputRowsForLocationGroup(
          group.rows,
          outDir,
          group.inputRows,
          options,
        );
        const groupDecisions = group.rows.map((row) =>
          decisionsByKey.get(locationQueueTargetKey(row)),
        );
        const decisionFile = path.join(outDir, "decisions", "location-decisions.jsonl");
        fs.mkdirSync(path.dirname(decisionFile), { recursive: true });
        fs.mkdirSync(path.dirname(finalOutputRows), { recursive: true });
        writeJsonLines(decisionFile, groupDecisions);
        const stage = runTiangongJsonStage("location_apply", [
          "dataset",
          "classification",
          "apply",
          "--input",
          group.inputRows,
          "--decisions",
          decisionFile,
          "--out",
          finalOutputRows,
          "--type",
          "location",
          "--out-dir",
          path.join(outDir, "classification", "location"),
          "--json",
        ]);
        stage.report_file = resolveRepoPath(stage.report?.files?.report);
        stages.push(stage);
        if (stage.exit_code !== 0) {
          blockers.push({
            code: "location_apply_stage_failed",
            message: "CLI location apply failed.",
            exit_code: stage.exit_code,
            report_file: repoRelativeMaybe(stage.report_file),
          });
          break;
        }
        outputRows.push(repoRelativePath(finalOutputRows));
      }
    }

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: blockers.length > 0 ? "blocked" : "completed",
      command: "dataset-location-decisions-apply",
      location_queue: repoRelativePath(queuePath),
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
        output_rows: outputRows,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetLocationDecisionTaskBuild,
    runDatasetLocationDecisionsApply,
  };
}
