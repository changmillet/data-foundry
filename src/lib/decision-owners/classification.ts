import fs from "node:fs";
import path from "node:path";
import {
  asRecord,
  type ClassificationDecisionDependencies,
  createClassificationTaskAndProjectCommands,
  type LooseRecord,
  type RuntimeStage,
} from "./classification-task-and-project.ts";

export function createClassificationDecisionCommands(deps: ClassificationDecisionDependencies) {
  const {
    asText,
    classificationDecisionCode,
    classificationDecisionSchemaType,
    classificationDecisionTargetKey,
    classificationDecisionUsedContextKinds,
    classificationQueueInputRows,
    classificationQueueOutputRows,
    classificationQueueSchemaType,
    classificationQueueTargetKey,
    compactStageReport,
    decisionCompletionStatus,
    decisionContextBundleSha256,
    decisionTaskContextBundleHashes,
    decisionTaskProofList,
    decisionTaskReportPayload,
    fileExists,
    hasUnresolvedAiPlaceholder,
    nowIso,
    readDecisionTaskProofs,
    readJsonOrJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    runTiangongJsonStage,
    unique,
    writeJson,
    writeJsonLines,
  } = deps;
  const {
    runDatasetClassificationDecisionTaskBuild,
    runDatasetLibraryClassificationDecisionsProject,
  } = createClassificationTaskAndProjectCommands(deps);

  function validateClassificationDecisionsForQueue(
    queueRows: LooseRecord[],
    decisions: LooseRecord[],
    {
      decisionTaskProof = null,
      decisionKind = "classification",
    }: { decisionTaskProof?: unknown; decisionKind?: string } = {},
  ) {
    const blockers: Array<Record<string, unknown>> = [];
    const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
    for (const proof of decisionTaskProofs) {
      blockers.push(...proof.blockers);
    }
    const contextBundleHashes = decisionTaskContextBundleHashes(decisionTaskProofs);
    const queueByKey = new Map<string, LooseRecord>(
      queueRows.map((row) => [classificationQueueTargetKey(row), row] as const),
    );
    const decisionsByKey = new Map<string, unknown>();
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

  function outputRowsForClassificationGroup(
    rows: LooseRecord[],
    outDir: string,
    inputRows: string,
    options: LooseRecord,
  ): string {
    if (options.out && rows.length > 0) return resolveRepoPath(options.out)!;
    const outputRows = unique(rows.map(classificationQueueOutputRows)).filter(Boolean);
    if (outputRows.length === 1) return resolveRepoPath(outputRows[0])!;
    const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
    return path.join(outDir, "rows", `${inputBase}.classified.jsonl`);
  }

  function runDatasetClassificationDecisionsApply(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-classification-decisions-apply",
        wraps: "tiangong-lca dataset classification apply",
        usage: [
          "node src/dev-cli.ts dataset-classification-decisions-apply --classification-queue <classification-authoring-queue.jsonl> --decisions <classification-decisions.jsonl> --decision-task <classification-decision-task.json> --out-dir <apply-dir>",
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
    )!;
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
    const stages: RuntimeStage[] = [];
    const inputRowsFiles: string[] = [];
    const outputRows: string[] = [];

    if (blockers.length === 0 && queueRows.length > 0) {
      const queueRowsByInput = new Map<string, { inputRows: string; rows: LooseRecord[] }>();
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
          stage.report_file = resolveRepoPath(asRecord(asRecord(stage.report).files).report);
          stages.push(stage);
          if (stage.exit_code !== 0) {
            const stageSummary = compactStageReport(stage);
            blockers.push({
              code: "classification_apply_stage_failed",
              message: `CLI classification apply failed for ${schemaType}.`,
              schema_type: schemaType,
              exit_code: stage.exit_code,
              report_file: repoRelativeMaybe(stage.report_file),
              stage: stageSummary,
              stderr: stageSummary.stderr || "",
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
          (total, stage) => total + Number(asRecord(asRecord(stage.report).counts).applied ?? 0),
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
    runDatasetLibraryClassificationDecisionsProject,
  };
}
