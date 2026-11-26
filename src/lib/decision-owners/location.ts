import fs from "node:fs";
import path from "node:path";
import {
  asRecord,
  createLocationTaskAndSuggestCommands,
  type LocationDecisionDependencies,
  type LooseRecord,
  type RuntimeStage,
} from "./location-task-and-suggest.ts";

export function createLocationDecisionCommands(deps: LocationDecisionDependencies) {
  const {
    asText,
    classificationDecisionCode,
    classificationDecisionSchemaType,
    classificationDecisionUsedContextKinds,
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
    locationQueueInputRows,
    locationQueueOutputRows,
    locationQueueTargetKey,
    runDatasetLocationDecisionTaskBuild,
    runDatasetLocationDecisionsSuggest,
  } = createLocationTaskAndSuggestCommands(deps);

  function locationDecisionTargetPath(decision: LooseRecord): string {
    return asText(
      decision?.target_path ??
        decision?.targetPath ??
        decision?.location_path ??
        decision?.locationPath ??
        decision?.path,
    );
  }

  function locationDecisionTargetKey(decision: LooseRecord): string {
    return `location::${asText(
      decision?.dataset_id ?? decision?.datasetId ?? decision?.id,
    )}::${asText(
      decision?.dataset_version ?? decision?.datasetVersion ?? decision?.version,
    )}::${locationDecisionTargetPath(decision)}`;
  }

  function validateLocationDecisionsForQueue(
    queueRows: LooseRecord[],
    decisions: LooseRecord[],
    { decisionTaskProof = null }: { decisionTaskProof?: unknown } = {},
  ) {
    const blockers: Array<Record<string, unknown>> = [];
    const decisionTaskProofs = decisionTaskProofList(decisionTaskProof);
    for (const proof of decisionTaskProofs) {
      blockers.push(...proof.blockers);
    }
    const contextBundleHashes = decisionTaskContextBundleHashes(decisionTaskProofs);
    const queueByKey = new Map<string, LooseRecord>(
      queueRows.map((row) => [locationQueueTargetKey(row), row] as const),
    );
    const decisionsByKey = new Map<string, unknown>();
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

  function outputRowsForLocationGroup(
    rows: LooseRecord[],
    outDir: string,
    inputRows: string,
    options: LooseRecord,
  ): string {
    if (options.out && rows.length > 0) return resolveRepoPath(options.out)!;
    const outputRows = unique(rows.map(locationQueueOutputRows)).filter(Boolean);
    if (outputRows.length === 1) return resolveRepoPath(outputRows[0])!;
    const inputBase = path.basename(inputRows).replace(/\.(jsonl|json)$/iu, "");
    return path.join(outDir, "rows", `${inputBase}.located.jsonl`);
  }

  function runDatasetLocationDecisionsApply(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-location-decisions-apply",
        wraps: "tiangong-lca dataset classification apply --type location",
        usage: [
          "node src/dev-cli.ts dataset-location-decisions-apply --location-queue <location-authoring-queue.jsonl> --decisions <location-decisions.jsonl> --decision-task <location-decision-task.json> --out-dir <apply-dir>",
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
    )!;
    const reportPath = path.join(outDir, "location-decisions-apply-report.json");
    const queueRows = readJsonOrJsonLines(queuePath);
    const decisions = readJsonOrJsonLines(decisionsPath);
    const decisionTaskProofs = readDecisionTaskProofs(options, "location", queuePath);
    const decisionTaskProof = decisionTaskProofs.length === 1 ? decisionTaskProofs[0] : null;
    const { blockers, decisionsByKey } = validateLocationDecisionsForQueue(queueRows, decisions, {
      decisionTaskProof: decisionTaskProofs,
    });
    const stages: RuntimeStage[] = [];
    const inputRows: string[] = [];
    const outputRows: string[] = [];

    if (blockers.length === 0 && queueRows.length > 0) {
      const queueRowsByInput = new Map<string, { inputRows: string; rows: LooseRecord[] }>();
      for (const row of queueRows) {
        const resolvedInputRows = resolveRepoPath(
          options.rowsFile || options.inputRows || locationQueueInputRows(row),
        );
        if (!resolvedInputRows || !fileExists(resolvedInputRows)) {
          blockers.push({
            code: "location_input_rows_missing",
            message: "Queued location workflow input rows file is missing.",
            dataset_id: row.dataset_id,
            input_rows: locationQueueInputRows(row),
          });
          continue;
        }
        const key = repoRelativePath(resolvedInputRows);
        const group = queueRowsByInput.get(key) ?? { inputRows: resolvedInputRows, rows: [] };
        group.rows.push(row);
        queueRowsByInput.set(key, group);
      }

      for (const group of queueRowsByInput.values()) {
        inputRows.push(repoRelativePath(group.inputRows));
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
        stage.report_file = resolveRepoPath(asRecord(asRecord(stage.report).files).report);
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
          (total, stage) => total + Number(asRecord(asRecord(stage.report).counts).applied ?? 0),
          0,
        ),
        blockers: blockers.length,
      },
      blockers,
      stages: stages.map(compactStageReport),
      files: {
        report: repoRelativePath(reportPath),
        input_rows: inputRows,
        output_rows: outputRows,
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return {
    runDatasetLocationDecisionTaskBuild,
    runDatasetLocationDecisionsSuggest,
    runDatasetLocationDecisionsApply,
  };
}
