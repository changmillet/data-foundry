import fs from "node:fs";
import path from "node:path";
import { createAuthoringPlanRowsChainHelpers } from "./rows-chain.ts";
import {
  authoringPlanStageContract,
  createAuthoringPlanStatusHelpers,
  type AuthoringPlanDependencies,
  type IdentityApplyCommand,
  type LooseRecord,
  type MutablePhase,
} from "./types-and-status.ts";

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : {};
}

/** Creates the dataset-authoring-plan command implementation backed by modular planning helpers. */
export function createAuthoringPlanRunner(deps: AuthoringPlanDependencies) {
  const {
    appendOption,
    asText,
    fileExists,
    nowIso,
    readJson,
    repoRelativePath,
    resolveRepoPath,
    writeJson,
  } = deps;
  const helpers = createAuthoringPlanStatusHelpers(deps);
  const rowsChainHelpers = createAuthoringPlanRowsChainHelpers(deps, helpers);

  function requireRepoPath(value: unknown, fallback: string): string {
    return resolveRepoPath(value) ?? resolveRepoPath(fallback) ?? fallback;
  }

  function runDatasetAuthoringPlan(options: LooseRecord) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-authoring-plan",
        usage: [
          "node src/dev-cli.ts dataset-authoring-plan --curation-gate-report <dataset-curation-gate-report.json> --out-dir <plan-dir>",
        ],
        purpose:
          "Summarize the next required AI authoring, deterministic apply, and post-authoring validation steps from a Foundry curation gate report. This command never writes the database.",
        ...authoringPlanStageContract,
      };
    }

    const curationGateReportPath = resolveRepoPath(
      options.curationGateReport || options.report || options.input,
    );
    if (!curationGateReportPath || !fileExists(curationGateReportPath)) {
      throw new Error(
        "--curation-gate-report is required and must point to dataset-curation-gate-report.json.",
      );
    }
    const curationGateReport = readJson(curationGateReportPath);
    const workspaceDir = helpers.authoringPlanWorkspaceDir(curationGateReportPath, options);
    const defaults = helpers.authoringPlanDefaultPaths(workspaceDir);
    const outDir = requireRepoPath(
      options.outDir || path.join(workspaceDir, "authoring-plan"),
      path.join(workspaceDir, "authoring-plan"),
    );
    const contextPaths = helpers.authoringPlanContextPaths(curationGateReport);
    const gateContext = asRecord(curationGateReport?.context);
    const classificationQueueInfo = asRecord(gateContext.classification_queue);
    const locationQueueInfo = asRecord(gateContext.location_queue);
    const classificationQueue = asText(classificationQueueInfo.queue_file);
    const locationQueue = asText(locationQueueInfo.queue_file);
    const counts = asRecord(curationGateReport.counts);
    const gateScope = helpers.authoringPlanGateScope(curationGateReport);
    const classificationRows = Number(
      counts.classification_queue_action_items ?? classificationQueueInfo.rows ?? 0,
    );
    const locationRows = Number(counts.location_queue_action_items ?? locationQueueInfo.rows ?? 0);
    const identityActionItems = Number(counts.identity_action_items ?? 0);
    const fieldActionItems = Math.max(
      0,
      Number(counts.action_items ?? 0) -
        identityActionItems -
        Number(counts.classification_queue_action_items ?? 0) -
        Number(counts.location_queue_action_items ?? 0),
    );

    const identityTaskPath = requireRepoPath(
      options.identityDecisionTask || options.identityTask || defaults.identityTask,
      defaults.identityTask,
    );
    const identityDecisionsPath = requireRepoPath(
      options.identityDecisions || defaults.identityDecisions,
      defaults.identityDecisions,
    );
    const explicitIdentityApplyReportPath = resolveRepoPath(
      options.identityDecisionApplyReport || options.identityApplyReport,
    );
    const classificationTaskPath = requireRepoPath(
      options.classificationDecisionTask ||
        options.classificationTask ||
        defaults.classificationTask,
      defaults.classificationTask,
    );
    const classificationDecisionsPath = requireRepoPath(
      options.classificationDecisions || defaults.classificationDecisions,
      defaults.classificationDecisions,
    );
    const classificationApplyReportPath = requireRepoPath(
      options.classificationDecisionApplyReport ||
        options.classificationApplyReport ||
        defaults.classificationApplyReport,
      defaults.classificationApplyReport,
    );
    const locationTaskPath = requireRepoPath(
      options.locationDecisionTask || options.locationTask || defaults.locationTask,
      defaults.locationTask,
    );
    const locationDecisionsPath = requireRepoPath(
      options.locationDecisions || defaults.locationDecisions,
      defaults.locationDecisions,
    );
    const locationApplyReportPath = requireRepoPath(
      options.locationDecisionApplyReport ||
        options.locationApplyReport ||
        defaults.locationApplyReport,
      defaults.locationApplyReport,
    );
    const authoringTaskManifestPath = requireRepoPath(
      options.authoringTaskManifest || options.taskManifest || defaults.authoringTaskManifest,
      defaults.authoringTaskManifest,
    );
    const patchCollectReportPath = requireRepoPath(
      options.patchCollectReport || defaults.patchCollectReport,
      defaults.patchCollectReport,
    );
    const patchApplyReportPath = requireRepoPath(
      options.patchApplyReport || defaults.patchApplyReport,
      defaults.patchApplyReport,
    );
    const identityDatasetTypes = rowsChainHelpers.authoringPlanIdentityDatasetTypes(
      identityTaskPath,
      curationGateReport,
    );
    const identityApplyReportPaths = rowsChainHelpers.authoringPlanIdentityApplyReports(
      workspaceDir,
      identityDatasetTypes,
      explicitIdentityApplyReportPath,
    );
    const authoringPackageDir =
      rowsChainHelpers.authoringPlanAuthoringPackageDir(curationGateReport);
    const identityApplyCommands = rowsChainHelpers.authoringPlanIdentityApplyCommands({
      workspaceDir,
      curationGateReport,
      datasetTypes: identityDatasetTypes,
      decisionsPath: identityDecisionsPath,
      applyReportPaths: identityApplyReportPaths,
      authoringPackageDir,
    });
    const identityChunkSize = helpers.authoringPlanChunkSize(options, "identity");
    const classificationChunkSize = helpers.authoringPlanChunkSize(options, "classification");
    const locationChunkSize = helpers.authoringPlanChunkSize(options, "location");
    const sharedContextCacheDir = requireRepoPath(
      options.sharedContextCacheDir ||
        options.contextCacheDir ||
        path.join(workspaceDir, "shared-context-cache"),
      path.join(workspaceDir, "shared-context-cache"),
    );
    const sharedContextCacheDirRef = repoRelativePath(sharedContextCacheDir);

    const identityBuildArgs = [
      "dataset-identity-decision-task-build",
      "--curation-gate-report",
      curationGateReportPath,
      "--shared-context-cache-dir",
      sharedContextCacheDirRef,
      "--out-dir",
      path.dirname(identityTaskPath),
    ];

    const classificationBuildArgs = [
      "dataset-classification-decision-task-build",
      "--classification-queue",
      classificationQueue || "<classification-authoring-queue.jsonl>",
    ];
    helpers.appendAuthoringPlanGateScopeOptions(classificationBuildArgs, gateScope);
    helpers.appendContextOptions(classificationBuildArgs, contextPaths);
    appendOption(classificationBuildArgs, "--shared-context-cache-dir", sharedContextCacheDirRef);
    classificationBuildArgs.push("--out-dir", path.dirname(classificationTaskPath));

    const locationBuildArgs = [
      "dataset-location-decision-task-build",
      "--location-queue",
      locationQueue || "<location-authoring-queue.jsonl>",
    ];
    helpers.appendAuthoringPlanGateScopeOptions(locationBuildArgs, gateScope);
    helpers.appendContextOptions(locationBuildArgs, contextPaths);
    appendOption(locationBuildArgs, "--shared-context-cache-dir", sharedContextCacheDirRef);
    locationBuildArgs.push("--out-dir", path.dirname(locationTaskPath));
    const classificationApplyQueue = helpers.authoringPlanScopedDecisionQueuePath({
      taskPath: classificationTaskPath,
      taskQueueKey: "classification_queue",
      originalQueue: classificationQueue || "<classification-authoring-queue.jsonl>",
      scope: gateScope,
      kind: "classification",
    });
    const locationApplyQueue = helpers.authoringPlanScopedDecisionQueuePath({
      taskPath: locationTaskPath,
      taskQueueKey: "location_queue",
      originalQueue: locationQueue || "<location-authoring-queue.jsonl>",
      scope: gateScope,
      kind: "location",
    });
    const scopedApplyRowsFile = gateScope.dataset_type
      ? rowsChainHelpers.authoringPlanRowsFileForDatasetType(
          gateScope.dataset_type,
          workspaceDir,
          curationGateReport,
        )
      : null;

    const identityPhase: MutablePhase = {
      phase: "identity_decisions",
      action_items: identityActionItems,
      ...helpers.phaseStatusFromTaskDecision({
        required: identityActionItems > 0,
        taskPath: identityTaskPath,
        readyStatus: "ready_for_ai_identity_decisions",
        emptyStatus: "ready_no_identity_actions",
        decisionsPath: identityDecisionsPath,
        applyReportPaths: identityApplyReportPaths,
      }),
      dataset_types: identityDatasetTypes,
      chunk_plan: helpers.authoringPlanDecisionChunkPlan({
        kind: "identity",
        rows: helpers.authoringPlanDecisionRows(identityTaskPath, "identity_action_items"),
        chunkSize: identityChunkSize,
        buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => [
          "dataset-identity-decision-task-build",
          "--curation-gate-report",
          curationGateReportPath,
          "--dataset-type",
          datasetType,
          "--limit",
          limit,
          "--offset",
          offset,
          "--chunk-label",
          chunkLabel,
          "--shared-context-cache-dir",
          sharedContextCacheDirRef,
          "--out-dir",
          path.join(path.dirname(identityTaskPath), "chunks", chunkLabel),
        ],
      }),
      commands: {
        build_task: helpers.foundryCommand(identityBuildArgs),
        apply_decisions:
          identityApplyCommands.length === 1 ? identityApplyCommands[0].command : null,
        apply_decisions_by_type: identityApplyCommands,
      },
    };
    const classificationPhase: MutablePhase = {
      phase: "classification_decisions",
      queue_rows: classificationRows,
      ...helpers.phaseStatusFromTaskDecision({
        required: classificationRows > 0,
        taskPath: classificationTaskPath,
        readyStatus: "ready_for_ai_classification_decisions",
        emptyStatus: "ready_no_classification_actions",
        decisionsPath: classificationDecisionsPath,
        applyReportPath: classificationApplyReportPath,
      }),
      chunk_plan: helpers.authoringPlanDecisionChunkPlan({
        kind: "classification",
        rows: helpers.authoringPlanDecisionRows(
          classificationTaskPath,
          "classification_queue_rows",
        ),
        chunkSize: classificationChunkSize,
        buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => {
          const args = [
            "dataset-classification-decision-task-build",
            "--classification-queue",
            classificationQueue || "<classification-authoring-queue.jsonl>",
            "--dataset-type",
            datasetType,
            "--limit",
            String(limit),
            "--offset",
            String(offset),
            "--chunk-label",
            chunkLabel,
          ];
          helpers.appendContextOptions(args, contextPaths);
          appendOption(args, "--shared-context-cache-dir", sharedContextCacheDirRef);
          args.push(
            "--out-dir",
            path.join(path.dirname(classificationTaskPath), "chunks", chunkLabel),
          );
          return args;
        },
      }),
      commands: {
        build_task: helpers.foundryCommand(classificationBuildArgs),
        apply_decisions: helpers.foundryCommand([
          "dataset-classification-decisions-apply",
          "--classification-queue",
          classificationApplyQueue,
          "--decisions",
          classificationDecisionsPath,
          "--decision-task",
          classificationTaskPath,
          ...(scopedApplyRowsFile ? ["--rows-file", scopedApplyRowsFile] : []),
          "--out-dir",
          path.dirname(classificationApplyReportPath),
        ]),
      },
    };
    const locationPhase: MutablePhase = {
      phase: "location_decisions",
      queue_rows: locationRows,
      ...helpers.phaseStatusFromTaskDecision({
        required: locationRows > 0,
        taskPath: locationTaskPath,
        readyStatus: "ready_for_ai_location_decisions",
        emptyStatus: "ready_no_location_actions",
        decisionsPath: locationDecisionsPath,
        applyReportPath: locationApplyReportPath,
      }),
      chunk_plan: helpers.authoringPlanDecisionChunkPlan({
        kind: "location",
        rows: helpers.authoringPlanDecisionRows(locationTaskPath, "location_queue_rows"),
        chunkSize: locationChunkSize,
        buildArgsForChunk: ({ datasetType, offset, limit, chunkLabel }) => {
          const args = [
            "dataset-location-decision-task-build",
            "--location-queue",
            locationQueue || "<location-authoring-queue.jsonl>",
            "--dataset-type",
            datasetType,
            "--limit",
            String(limit),
            "--offset",
            String(offset),
            "--chunk-label",
            chunkLabel,
          ];
          helpers.appendContextOptions(args, contextPaths);
          appendOption(args, "--shared-context-cache-dir", sharedContextCacheDirRef);
          args.push("--out-dir", path.join(path.dirname(locationTaskPath), "chunks", chunkLabel));
          return args;
        },
      }),
      commands: {
        build_task: helpers.foundryCommand(locationBuildArgs),
        apply_decisions: helpers.foundryCommand([
          "dataset-location-decisions-apply",
          "--location-queue",
          locationApplyQueue,
          "--decisions",
          locationDecisionsPath,
          "--decision-task",
          locationTaskPath,
          ...(scopedApplyRowsFile ? ["--rows-file", scopedApplyRowsFile] : []),
          "--out-dir",
          path.dirname(locationApplyReportPath),
        ]),
      },
    };
    const patchPhase: MutablePhase = {
      phase: "field_patches",
      action_items: fieldActionItems,
      ...helpers.phaseStatusFromPatchAuthoring({
        required: fieldActionItems > 0,
        manifestPath: authoringTaskManifestPath,
        patchCollectReportPath,
        patchApplyReportPath,
      }),
      commands: {
        build_task: helpers.foundryCommand([
          "dataset-authoring-task-build",
          "--curation-gate-report",
          curationGateReportPath,
          "--shared-context-cache-dir",
          sharedContextCacheDirRef,
          "--out-dir",
          path.dirname(authoringTaskManifestPath),
        ]),
        collect_patches: helpers.foundryCommand([
          "dataset-authoring-patch-collect",
          "--task-manifest",
          authoringTaskManifestPath,
        ]),
        apply_patches:
          asRecord(helpers.existingArtifact(authoringTaskManifestPath)?.value?.commands)
            .apply_all_patches ?? null,
      },
    };
    const phases = [identityPhase, classificationPhase, locationPhase, patchPhase];
    const rowsChain = rowsChainHelpers.authoringPlanRowsChain({
      baseRows: scopedApplyRowsFile || curationGateReport.rows_file,
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
    });
    const chainedClassification = rowsChain.commands.classification_decisions as
      { command?: string } | undefined;
    if (chainedClassification?.command) {
      classificationPhase.commands.apply_decisions = chainedClassification.command;
    }
    const chainedLocation = rowsChain.commands.location_decisions as
      { command?: string } | undefined;
    if (chainedLocation?.command) {
      locationPhase.commands.apply_decisions = chainedLocation.command;
    }
    const manifestPatchApplyCommand = patchPhase.commands.apply_patches;
    if (manifestPatchApplyCommand) {
      patchPhase.commands.apply_patches_manifest = manifestPatchApplyCommand;
    }
    if (rowsChain.commands.field_patches?.command) {
      patchPhase.commands.apply_patches = rowsChain.commands.field_patches.command;
    } else if (
      patchPhase.required &&
      rowsChain.steps.some(
        (step) =>
          ["classification_decisions", "location_decisions"].includes(asText(step.phase)) &&
          step.required &&
          !step.output_rows,
      )
    ) {
      patchPhase.commands.apply_patches = null;
      patchPhase.commands.apply_patches_unavailable_reason =
        "Earlier classification/location phases have not produced a current rows file yet; rerun dataset-authoring-plan after those applies complete.";
    }
    const chainedIdentityGroup = rowsChain.commands.identity_decisions as
      { commands?: IdentityApplyCommand[] } | undefined;
    if ((chainedIdentityGroup?.commands?.length ?? 0) > 0) {
      const chainedIdentityCommands = chainedIdentityGroup!.commands!;
      identityPhase.commands.apply_decisions =
        chainedIdentityCommands.length === 1 ? chainedIdentityCommands[0].command : null;
      identityPhase.commands.apply_decisions_by_type = chainedIdentityCommands;
    }
    const reportPath = path.join(outDir, "dataset-authoring-plan.json");
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: helpers.authoringPlanOverallStatus(phases),
      command: "dataset-authoring-plan",
      ...authoringPlanStageContract,
      curation_gate_report: repoRelativePath(curationGateReportPath),
      workspace_dir: repoRelativePath(workspaceDir),
      profile: curationGateReport.profile ?? null,
      dataset_type: curationGateReport.dataset_type ?? null,
      rows_file: curationGateReport.rows_file ?? null,
      counts: {
        action_items: Number(counts.action_items ?? 0),
        identity_action_items: identityActionItems,
        classification_queue_rows: classificationRows,
        location_queue_rows: locationRows,
        field_patch_action_items: fieldActionItems,
        deterministic_cleanup_items: Number(counts.deterministic_cleanup_items ?? 0),
        blockers: 0,
      },
      context: {
        schema_file: contextPaths.schema,
        methodology_yaml: contextPaths.methodology_yaml,
        ruleset_file: contextPaths.ruleset,
        classification_schema_files: contextPaths.classification_schema,
        location_schema_file: contextPaths.location_schema,
        authoring_package_dir: authoringPackageDir,
        shared_context_cache_dir: sharedContextCacheDirRef,
      },
      rows_chain: rowsChain,
      phases,
      blockers: [],
      instructions: [
        "Run any needs_task_build command first; task status must be ready before AI authoring.",
        "AI/Codex/skills must read the task JSON and referenced authoring packages before writing decisions or patches.",
        "When multiple authoring phases touch the same rows, follow rows_chain order and use the chained apply commands so classification/location/patch/identity evidence references one current rows lineage.",
        "Run deterministic apply commands after decisions/patches are completed; do not edit row JSON directly.",
        "After all required phases are completed, rerun Rust tidas validation, deterministic CLI QA, curation gate, post-authoring finalize, mutation manifest, and only then remote write planning.",
      ],
      files: {
        report: repoRelativePath(reportPath),
      },
    };
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(reportPath, report);
    return report;
  }

  return { runDatasetAuthoringPlan };
}
