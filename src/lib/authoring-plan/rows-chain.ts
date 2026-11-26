import path from "node:path";
import type {
  AuthoringPlanDependencies,
  IdentityApplyCommand,
  LooseRecord,
  PhaseLike,
} from "./types-and-status.ts";
import type { createAuthoringPlanStatusHelpers } from "./types-and-status.ts";

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : {};
}

/** Creates rows-chain resolution and apply-command builders for dataset-authoring-plan. */
export function createAuthoringPlanRowsChainHelpers(
  deps: AuthoringPlanDependencies,
  helpers: ReturnType<typeof createAuthoringPlanStatusHelpers>,
) {
  const {
    appendOption,
    asText,
    datasetRowsFileStem,
    ensureArray,
    normalizedList,
    repoRelativeMaybe,
    repoRelativePath,
    resolveRepoPath,
    unique,
  } = deps;
  const { existingArtifact, foundryCommand } = helpers;

  function authoringPlanIdentityDatasetTypes(
    taskPath: string,
    curationGateReport: LooseRecord,
  ): string[] {
    const task = existingArtifact(taskPath)?.value;
    const taskTypes = normalizedList(task?.dataset_types ?? task?.datasetTypes);
    if (taskTypes.length > 0) return taskTypes;
    const reportType = asText(curationGateReport?.dataset_type);
    return reportType ? [reportType] : ["<flow-or-process>"];
  }

  function authoringPlanRowsFileForDatasetType(
    datasetType: unknown,
    workspaceDir: string,
    curationGateReport: LooseRecord,
  ): string {
    const reportType = asText(curationGateReport?.dataset_type).toLowerCase();
    const normalizedType = asText(datasetType).toLowerCase();
    if (normalizedType && normalizedType === reportType && curationGateReport?.rows_file) {
      return asText(curationGateReport.rows_file);
    }
    const queueManifest = existingArtifact(
      asRecord(asRecord(curationGateReport?.context).curation_queue).manifest_file,
    )?.value;
    const queueInputs = asRecord(queueManifest?.inputs);
    const queueInput = asText(
      {
        process: queueInputs.processes,
        flow: queueInputs.flows,
        support: ensureArray(queueInputs.support)[0],
      }[normalizedType],
    );
    if (queueInput) {
      const resolved = resolveRepoPath(queueInput);
      return resolved ? repoRelativePath(resolved) : queueInput;
    }
    if (!normalizedType || normalizedType.startsWith("<")) {
      return "<rows-file-containing-identity-targets>";
    }
    return repoRelativePath(
      path.join(workspaceDir, "rows", `${datasetRowsFileStem(normalizedType)}.jsonl`),
    );
  }

  function authoringPlanAuthoringPackageDir(curationGateReport: LooseRecord): string | null {
    const packageDirs = unique(
      ensureArray(
        curationGateReport?.entities ??
          curationGateReport?.processes ??
          curationGateReport?.flows ??
          curationGateReport?.items,
      )
        .map((entity) => asText(entity?.authoring_package ?? entity?.authoringPackage))
        .filter(Boolean)
        .map((packageRef) => path.dirname(packageRef)),
    );
    return packageDirs.length === 1 ? packageDirs[0] : null;
  }

  function authoringPlanIdentityApplyReports(
    workspaceDir: string,
    datasetTypes: string[],
    explicitReportPath: string | null,
  ): string[] {
    if (explicitReportPath && datasetTypes.length <= 1) return [explicitReportPath];
    if (datasetTypes.length <= 1) {
      return [
        path.join(workspaceDir, "identity-decision-apply", "identity-decisions-apply-report.json"),
      ];
    }
    return datasetTypes.map((datasetType) =>
      path.join(
        workspaceDir,
        "identity-decision-apply",
        datasetType,
        "identity-decisions-apply-report.json",
      ),
    );
  }

  function authoringPlanIdentityApplyCommands({
    workspaceDir,
    curationGateReport,
    datasetTypes,
    decisionsPath,
    applyReportPaths,
    authoringPackageDir,
  }: {
    workspaceDir: string;
    curationGateReport: LooseRecord;
    datasetTypes: string[];
    decisionsPath: string;
    applyReportPaths: string[];
    authoringPackageDir: string | null;
  }): IdentityApplyCommand[] {
    return datasetTypes.map((datasetType, index) => {
      const reportPath = applyReportPaths[index];
      const rowsFile = authoringPlanRowsFileForDatasetType(
        datasetType,
        workspaceDir,
        curationGateReport,
      );
      const args = [
        "dataset-identity-decisions-apply",
        "--type",
        datasetType,
        "--rows-file",
        rowsFile,
        "--decisions",
        decisionsPath,
        "--out-dir",
        path.dirname(reportPath),
      ];
      appendOption(args, "--authoring-package-dir", authoringPackageDir);
      return {
        dataset_type: datasetType,
        rows_file: rowsFile,
        authoring_package_dir: authoringPackageDir,
        command: foundryCommand(args),
      };
    });
  }

  function authoringPlanRowsFileRef(fileRef: unknown): string | null {
    const text = asText(fileRef);
    if (!text) return null;
    const resolved = resolveRepoPath(text);
    return resolved ? repoRelativePath(resolved) : text;
  }

  function authoringPlanRowsFiles(values: unknown): string[] {
    return unique(
      ensureArray(values)
        .flatMap((value) => ensureArray(value))
        .map(authoringPlanRowsFileRef)
        .filter((value): value is string => Boolean(value)),
    );
  }

  function authoringPlanSingleRowsFile(values: unknown): string | null {
    const rowsFiles = authoringPlanRowsFiles(values);
    return rowsFiles.length === 1 ? rowsFiles[0] : null;
  }

  function authoringPlanCompletedOutputRows(reportPath: string, kind: string): string[] {
    const artifact = existingArtifact(reportPath);
    if (!artifact || asText(artifact.value.status) !== "completed") return [];
    const report = artifact.value;
    const files = asRecord(report.files);
    if (kind === "patch") {
      return authoringPlanRowsFiles([
        files.output_rows,
        files.patched_rows,
        report.output_rows,
        report.out_path,
      ]);
    }
    return authoringPlanRowsFiles([files.output_rows, report.output_rows]);
  }

  function authoringPlanPlannedTransformOutputRows(
    currentRows: string,
    reportPath: string,
    suffix: string,
  ): string | null {
    const resolvedReport = resolveRepoPath(reportPath);
    const resolvedCurrentRows = resolveRepoPath(currentRows);
    if (!resolvedReport || !resolvedCurrentRows) return null;
    const inputBase = path.basename(resolvedCurrentRows).replace(/\.(jsonl|json)$/iu, "");
    return repoRelativePath(
      path.join(path.dirname(resolvedReport), "rows", `${inputBase}.${suffix}.jsonl`),
    );
  }

  function authoringPlanPlannedPatchOutputRows(
    currentRows: string,
    patchApplyReportPath: string,
  ): string | null {
    return authoringPlanPlannedTransformOutputRows(currentRows, patchApplyReportPath, "patched");
  }

  function authoringPlanPlannedIdentityOutputRows(
    identityApplyReportPath: string,
    datasetType: unknown,
  ): string | null {
    const resolvedReport = resolveRepoPath(identityApplyReportPath);
    const normalizedType = asText(datasetType);
    if (!resolvedReport || !normalizedType) return null;
    return repoRelativePath(
      path.join(
        path.dirname(resolvedReport),
        `${datasetRowsFileStem(normalizedType)}.identity-decisions-applied.jsonl`,
      ),
    );
  }

  function authoringPlanChainedClassificationCommand({
    queue,
    decisionsPath,
    taskPath,
    inputRows,
    outputRows,
    reportPath,
  }: {
    queue: string;
    decisionsPath: string;
    taskPath: string;
    inputRows: string | null;
    outputRows: string | null;
    reportPath: string;
  }): string | null {
    if (!inputRows || !outputRows) return null;
    return foundryCommand([
      "dataset-classification-decisions-apply",
      "--classification-queue",
      queue,
      "--decisions",
      decisionsPath,
      "--decision-task",
      taskPath,
      "--rows-file",
      inputRows,
      "--out",
      outputRows,
      "--out-dir",
      path.dirname(reportPath),
    ]);
  }

  function authoringPlanChainedLocationCommand({
    queue,
    decisionsPath,
    taskPath,
    inputRows,
    outputRows,
    reportPath,
  }: {
    queue: string;
    decisionsPath: string;
    taskPath: string;
    inputRows: string | null;
    outputRows: string | null;
    reportPath: string;
  }): string | null {
    if (!inputRows || !outputRows) return null;
    return foundryCommand([
      "dataset-location-decisions-apply",
      "--location-queue",
      queue,
      "--decisions",
      decisionsPath,
      "--decision-task",
      taskPath,
      "--rows-file",
      inputRows,
      "--out",
      outputRows,
      "--out-dir",
      path.dirname(reportPath),
    ]);
  }

  function authoringPlanChainedPatchCommand({
    manifestPath,
    patchApplyReportPath,
    authoringPackageDir,
    inputRows,
    outputRows,
  }: {
    manifestPath: string;
    patchApplyReportPath: string;
    authoringPackageDir: string | null;
    inputRows: string | null;
    outputRows: string | null;
  }): string | null {
    const manifest = existingArtifact(manifestPath)?.value;
    const resolvedManifestPath = resolveRepoPath(manifestPath) ?? manifestPath;
    const patchFile = authoringPlanRowsFileRef(
      asRecord(manifest?.batch_patch_contract).output_patch_file ||
        path.join(path.dirname(resolvedManifestPath), "ai-patches.batch.json"),
    );
    if (!inputRows || !outputRows || !patchFile || !authoringPackageDir) return null;
    return foundryCommand([
      "dataset-patch-apply",
      "--input",
      inputRows,
      "--patch",
      patchFile,
      "--out",
      outputRows,
      "--out-dir",
      path.dirname(patchApplyReportPath),
      "--authoring-package-dir",
      authoringPackageDir,
      "--require-authoring-package",
      "--require-action-item-closure",
    ]);
  }

  function authoringPlanChainedIdentityCommands({
    datasetTypes,
    decisionsPath,
    applyReportPaths,
    authoringPackageDir,
    inputRows,
  }: {
    datasetTypes: string[];
    decisionsPath: string;
    applyReportPaths: string[];
    authoringPackageDir: string | null;
    inputRows: string | null;
  }): IdentityApplyCommand[] {
    if (!inputRows || datasetTypes.length !== 1) return [];
    return datasetTypes.map((datasetType, index) => {
      const reportPath = applyReportPaths[index];
      const args = [
        "dataset-identity-decisions-apply",
        "--type",
        datasetType,
        "--rows-file",
        inputRows,
        "--decisions",
        decisionsPath,
        "--out-dir",
        path.dirname(reportPath),
      ];
      appendOption(args, "--authoring-package-dir", authoringPackageDir);
      return {
        dataset_type: datasetType,
        rows_file: inputRows,
        authoring_package_dir: authoringPackageDir,
        output_rows: authoringPlanPlannedIdentityOutputRows(reportPath, datasetType),
        command: foundryCommand(args),
      };
    });
  }

  function authoringPlanRowsChain({
    baseRows,
    classificationPhase,
    classificationApplyReportPath,
    classificationApplyQueue,
    classificationDecisionsPath,
    classificationTaskPath,
    locationPhase,
    locationApplyReportPath,
    locationApplyQueue,
    locationDecisionsPath,
    locationTaskPath,
    patchPhase,
    authoringTaskManifestPath,
    patchApplyReportPath,
    authoringPackageDir,
    identityPhase,
    identityDatasetTypes,
    identityDecisionsPath,
    identityApplyReportPaths,
  }: {
    baseRows: unknown;
    classificationPhase: PhaseLike;
    classificationApplyReportPath: string;
    classificationApplyQueue: string;
    classificationDecisionsPath: string;
    classificationTaskPath: string;
    locationPhase: PhaseLike;
    locationApplyReportPath: string;
    locationApplyQueue: string;
    locationDecisionsPath: string;
    locationTaskPath: string;
    patchPhase: PhaseLike;
    authoringTaskManifestPath: string;
    patchApplyReportPath: string;
    authoringPackageDir: string | null;
    identityPhase: PhaseLike;
    identityDatasetTypes: string[];
    identityDecisionsPath: string;
    identityApplyReportPaths: string[];
  }) {
    let currentRows = authoringPlanRowsFileRef(baseRows);
    const steps: Array<Record<string, unknown>> = [];
    const commands: Record<string, Record<string, unknown>> = {};
    const blockers: Array<Record<string, unknown>> = [];
    const pending: Array<Record<string, unknown>> = [];

    function requireCurrentRows(phase: string): boolean {
      if (currentRows) return true;
      blockers.push({
        code: "authoring_rows_chain_current_rows_missing",
        phase,
        message: "Cannot build chained apply commands without a current rows file.",
      });
      return false;
    }

    function recordNoChange(phase: string, status: string): void {
      steps.push({
        phase,
        status,
        required: false,
        input_rows: currentRows,
        output_rows: currentRows,
        command: null,
      });
    }

    function recordTransformStep({
      phaseName,
      phase,
      reportPath,
      outputSuffix,
      outputKind,
      buildCommand,
    }: {
      phaseName: string;
      phase: PhaseLike;
      reportPath: string;
      outputSuffix: string;
      outputKind: string;
      buildCommand: (rows: { inputRows: string; outputRows: string | null }) => string | null;
    }): void {
      if (!phase.required) {
        recordNoChange(phaseName, phase.status);
        return;
      }
      if (["completed_no_actions", "not_required"].includes(phase.status)) {
        recordNoChange(phaseName, phase.status);
        return;
      }
      const inputRows = currentRows!;
      if (!requireCurrentRows(phaseName)) return;
      if (phase.status === "completed") {
        const outputRows = authoringPlanSingleRowsFile(
          authoringPlanCompletedOutputRows(reportPath, outputKind),
        );
        if (!outputRows) {
          blockers.push({
            code: "authoring_rows_chain_output_rows_ambiguous",
            phase: phaseName,
            report: repoRelativeMaybe(reportPath),
            message: "Completed apply report must expose exactly one output rows file.",
          });
          return;
        }
        steps.push({
          phase: phaseName,
          status: phase.status,
          required: true,
          input_rows: inputRows,
          output_rows: outputRows,
          report: repoRelativeMaybe(reportPath),
          command: null,
        });
        currentRows = outputRows;
        return;
      }
      if (phase.status === "needs_deterministic_apply") {
        const outputRows =
          outputKind === "patch"
            ? authoringPlanPlannedPatchOutputRows(inputRows, reportPath)
            : authoringPlanPlannedTransformOutputRows(inputRows, reportPath, outputSuffix);
        const command = buildCommand({ inputRows, outputRows });
        if (!outputRows || !command) {
          blockers.push({
            code: "authoring_rows_chain_command_unavailable",
            phase: phaseName,
            message: "The authoring plan could not build a safe chained apply command.",
          });
          return;
        }
        steps.push({
          phase: phaseName,
          status: phase.status,
          required: true,
          input_rows: inputRows,
          output_rows: outputRows,
          report: repoRelativeMaybe(reportPath),
          command,
        });
        commands[phaseName] = { command, input_rows: inputRows, output_rows: outputRows };
        currentRows = outputRows;
        return;
      }
      pending.push({ phase: phaseName, status: phase.status });
      steps.push({
        phase: phaseName,
        status: phase.status,
        required: true,
        input_rows: inputRows,
        output_rows: null,
        command: null,
      });
    }

    recordTransformStep({
      phaseName: "classification_decisions",
      phase: classificationPhase,
      reportPath: classificationApplyReportPath,
      outputSuffix: "classified",
      outputKind: "decision",
      buildCommand: ({ inputRows, outputRows }) =>
        authoringPlanChainedClassificationCommand({
          queue: classificationApplyQueue,
          decisionsPath: classificationDecisionsPath,
          taskPath: classificationTaskPath,
          inputRows,
          outputRows,
          reportPath: classificationApplyReportPath,
        }),
    });
    recordTransformStep({
      phaseName: "location_decisions",
      phase: locationPhase,
      reportPath: locationApplyReportPath,
      outputSuffix: "located",
      outputKind: "decision",
      buildCommand: ({ inputRows, outputRows }) =>
        authoringPlanChainedLocationCommand({
          queue: locationApplyQueue,
          decisionsPath: locationDecisionsPath,
          taskPath: locationTaskPath,
          inputRows,
          outputRows,
          reportPath: locationApplyReportPath,
        }),
    });
    recordTransformStep({
      phaseName: "field_patches",
      phase: patchPhase,
      reportPath: patchApplyReportPath,
      outputSuffix: "patched",
      outputKind: "patch",
      buildCommand: ({ inputRows, outputRows }) =>
        authoringPlanChainedPatchCommand({
          manifestPath: authoringTaskManifestPath,
          patchApplyReportPath,
          authoringPackageDir,
          inputRows,
          outputRows,
        }),
    });

    if (identityPhase.required) {
      const inputRows = currentRows;
      if (requireCurrentRows("identity_decisions")) {
        if (identityPhase.status === "completed") {
          const outputs = identityApplyReportPaths.flatMap((reportPath) =>
            authoringPlanCompletedOutputRows(reportPath, "decision"),
          );
          const outputRows = authoringPlanSingleRowsFile(outputs);
          if (!outputRows) {
            blockers.push({
              code: "authoring_rows_chain_output_rows_ambiguous",
              phase: "identity_decisions",
              message: "Completed identity apply reports must expose exactly one output rows file.",
            });
          } else {
            steps.push({
              phase: "identity_decisions",
              status: identityPhase.status,
              required: true,
              input_rows: inputRows,
              output_rows: outputRows,
              reports: identityApplyReportPaths.map(repoRelativeMaybe),
              command: null,
            });
            currentRows = outputRows;
          }
        } else if (identityPhase.status === "needs_deterministic_apply") {
          const chainedCommands = authoringPlanChainedIdentityCommands({
            datasetTypes: identityDatasetTypes,
            decisionsPath: identityDecisionsPath,
            applyReportPaths: identityApplyReportPaths,
            authoringPackageDir,
            inputRows,
          });
          const outputRows = authoringPlanSingleRowsFile(
            chainedCommands.map((command) => command.output_rows),
          );
          if (chainedCommands.length !== 1 || !outputRows) {
            blockers.push({
              code: "authoring_rows_chain_identity_command_unavailable",
              phase: "identity_decisions",
              dataset_types: identityDatasetTypes,
              message:
                "Chained identity apply currently requires one dataset type and one current rows file.",
            });
          } else {
            steps.push({
              phase: "identity_decisions",
              status: identityPhase.status,
              required: true,
              input_rows: inputRows,
              output_rows: outputRows,
              reports: identityApplyReportPaths.map(repoRelativeMaybe),
              commands: chainedCommands,
            });
            commands.identity_decisions = {
              commands: chainedCommands,
              input_rows: inputRows,
              output_rows: outputRows,
            };
            currentRows = outputRows;
          }
        } else {
          pending.push({ phase: "identity_decisions", status: identityPhase.status });
          steps.push({
            phase: "identity_decisions",
            status: identityPhase.status,
            required: true,
            input_rows: inputRows,
            output_rows: null,
            command: null,
          });
        }
      }
    } else {
      recordNoChange("identity_decisions", identityPhase.status);
    }

    return {
      status:
        blockers.length > 0
          ? "blocked_ambiguous_rows_chain"
          : pending.length > 0
            ? "waiting_for_prior_phase_completion"
            : steps.some((step) => step.command || step.commands)
              ? "needs_deterministic_apply"
              : "ready",
      order: [
        "classification_decisions",
        "location_decisions",
        "field_patches",
        "identity_decisions",
      ],
      base_rows: authoringPlanRowsFileRef(baseRows),
      current_rows: currentRows,
      pending,
      blockers,
      commands,
      steps,
      instruction:
        "Run chained commands in order and rerun dataset-authoring-plan after each deterministic apply. Downstream phases must use the previous step's output rows.",
    };
  }

  return {
    authoringPlanIdentityDatasetTypes,
    authoringPlanRowsFileForDatasetType,
    authoringPlanAuthoringPackageDir,
    authoringPlanIdentityApplyReports,
    authoringPlanIdentityApplyCommands,
    authoringPlanRowsChain,
  };
}
