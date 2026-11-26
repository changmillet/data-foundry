import process from "node:process";
import { createClassificationDecisionCommands } from "../commands/classification-decisions.ts";
import { createLocationDecisionCommands } from "../commands/location-decisions.ts";

interface JsonRecord {
  [key: string]: unknown;
}

type OptionHandler = (options: JsonRecord) => unknown;
type NoArgHandler = () => unknown;
type DecisionDependencies = Parameters<typeof createLocationDecisionCommands>[0] &
  Parameters<typeof createClassificationDecisionCommands>[0];

interface CommandDependencies {
  authoringPlanCommands: { runDatasetAuthoringPlan: OptionHandler };
  uslciBatchImportRunCommands: { runDatasetUslciBatchImportRun: OptionHandler };
  worldsteelBatchImportRunCommands: { runDatasetWorldsteelBatchImportRun: OptionHandler };
  bafuAutoAuthoringCommands: {
    runDatasetBafuIdentityDecisionsAutofill: OptionHandler;
    runDatasetBafuAuthoringPatchesAutofill: OptionHandler;
  };
  bafuBatchImportRunCommands: {
    runDatasetBafuBatchImportRun: OptionHandler;
    runDatasetBafuUniverseCoverageReport: OptionHandler;
  };
  bafuLeafClassificationTaskCommands: {
    runDatasetBafuLeafClassificationTasksPrepare: OptionHandler;
    runDatasetBafuLeafClassificationCategoryMapProject: OptionHandler;
  };
  bafuProcessScopeE2eCommands: { runDatasetBafuProcessScopeE2e: OptionHandler };
  bundleSampleRowsCommands: { runDatasetBundleSampleRows: OptionHandler };
  cliWrapperCommands: {
    runDatasetCurationQueueBuild: OptionHandler;
    runDatasetPatchApply: OptionHandler;
  };
  commitHandoffCommands: { runDatasetCommitHandoffPlan: OptionHandler };
  coreCommands: {
    doctor: NoArgHandler;
    envCheck: NoArgHandler;
    workflowCheck: NoArgHandler;
    storageCheck: NoArgHandler;
    surfaceAuditCheck: NoArgHandler;
    workspaceMap: NoArgHandler;
    capabilitiesList: OptionHandler;
    initRuntime: NoArgHandler;
    acceptanceCheck: NoArgHandler;
    buildRoutePlan: (options: JsonRecord) => JsonRecord;
    writeRoutePlan: (plan: JsonRecord, outDir?: string) => unknown;
  };
  executionCapsuleCommands: { runExecutionCapsuleAdmit: OptionHandler };
  finalDeliveryPromotionCommands: { runFinalDeliveryPromote: OptionHandler };
  identityDecisionCommands: { runDatasetIdentityDecisionsApply: OptionHandler };
  identityDecisionTaskCommands: { runDatasetIdentityDecisionTaskBuild: OptionHandler };
  identityPreflightCommands: {
    runDatasetIdentityPreflightRequestsBuild: OptionHandler;
    runDatasetIdentityPreflightQueryAudit: OptionHandler;
    runDatasetIdentityPreflightRun: OptionHandler;
    runDatasetIdentityPreflightIndexMerge: OptionHandler;
  };
  identityReferenceRewriteCommands: { runDatasetIdentityReferenceRewritesApply: OptionHandler };
  incrementalChangeSetCommands: { runDatasetIncrementalChangeSetCompose: OptionHandler };
  topologyConvergenceCommands: { runDatasetTopologyConvergenceCompose: OptionHandler };
  importCompletionCommands: { runDatasetImportCompletionReport: OptionHandler };
  importLedgerCommands: { runDatasetImportLedgerReport: OptionHandler };
  libraryBatchImportCommands: { runLibraryBatchImport: OptionHandler };
  libraryScopeWorkflowCommands: {
    runDatasetLibraryIndexBuild: OptionHandler;
    runDatasetLibraryAuthoringPlan: OptionHandler;
    runDatasetLibraryIdentityDecisionsFromPreflight: OptionHandler;
    runDatasetLibraryDecisionsApply: OptionHandler;
    runDatasetProcessScopeRun: OptionHandler;
  };
  listImportProfiles: (input: { repoRoot: string; options: JsonRecord }) => unknown;
  postAuthoringFinalizeCommands: { runDatasetPostAuthoringFinalize: OptionHandler };
  postWriteCloseoutCommands: { runDatasetPostWriteCloseout: OptionHandler };
  repoRoot: string;
  runDatasetAuthoringPatchCollect: (input: { repoRoot: string; options: JsonRecord }) => unknown;
  runDatasetAuthoringTaskBuild: (input: { repoRoot: string; options: JsonRecord }) => unknown;
  runDatasetCurationCleanup: (input: { repoRoot: string; options: JsonRecord }) => unknown;
  runDatasetCurationGate: (input: { repoRoot: string; options: JsonRecord }) => unknown;
  runDatasetMutationManifest: (input: { repoRoot: string; options: JsonRecord }) => unknown;
  supportCacheCommands: {
    runDatasetSupportCacheRefresh: OptionHandler;
    runDatasetCanonicalSupportMappingsAutofill: OptionHandler;
  };
  taskCommands: {
    tasksList: NoArgHandler;
    tasksCheck: NoArgHandler;
    runTaskComplete: OptionHandler;
  };
  tidasWorkflowCommands: {
    runTidasHandshake: OptionHandler;
    runTidasImport: OptionHandler;
    runTidasPackageValidation: OptionHandler;
  };
}

interface CliRuntime {
  exitCodeForCommand: (command: string, result: unknown) => number;
  parseArgs: (argv: string[]) => JsonRecord;
  printJson: (value: unknown) => void;
  usage: () => { commands: string[]; [key: string]: unknown };
}

interface FoundryCliInput {
  allowInternalStages?: boolean;
  argv?: string[];
  commandDeps: CommandDependencies;
  decisionDeps: DecisionDependencies;
  runtime: CliRuntime;
}

export function runFoundryCli({
  allowInternalStages = false,
  argv = process.argv,
  commandDeps,
  decisionDeps,
  runtime,
}: FoundryCliInput): void {
  runFoundryCliMain({ allowInternalStages, argv, commandDeps, decisionDeps, runtime }).catch(
    (error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exit(1);
    },
  );
}

/** One owner registry for both process adapters and in-process orchestration. */
export function createFoundryCommandDispatcher({
  commandDeps,
  decisionDeps,
  runtime,
}: Omit<FoundryCliInput, "argv" | "allowInternalStages">) {
  const { usage } = runtime;
  const {
    authoringPlanCommands,
    uslciBatchImportRunCommands,
    worldsteelBatchImportRunCommands,
    bafuAutoAuthoringCommands,
    bafuBatchImportRunCommands,
    bafuLeafClassificationTaskCommands,
    bafuProcessScopeE2eCommands,
    bundleSampleRowsCommands,
    cliWrapperCommands,
    commitHandoffCommands,
    coreCommands,
    executionCapsuleCommands,
    finalDeliveryPromotionCommands,
    identityDecisionCommands,
    identityDecisionTaskCommands,
    identityPreflightCommands,
    identityReferenceRewriteCommands,
    incrementalChangeSetCommands,
    topologyConvergenceCommands,
    importCompletionCommands,
    importLedgerCommands,
    libraryBatchImportCommands,
    libraryScopeWorkflowCommands,
    listImportProfiles,
    postAuthoringFinalizeCommands,
    postWriteCloseoutCommands,
    repoRoot,
    runDatasetAuthoringPatchCollect,
    runDatasetAuthoringTaskBuild,
    runDatasetCurationCleanup,
    runDatasetCurationGate,
    runDatasetMutationManifest,
    supportCacheCommands,
    taskCommands,
    tidasWorkflowCommands,
  } = commandDeps;
  const locationDecisionCommands = createLocationDecisionCommands(decisionDeps);
  const classificationDecisionCommands = createClassificationDecisionCommands(decisionDeps);
  const commandHandlers: Record<string, (options: JsonRecord) => unknown> = {
    help: () => usage(),
    "--help": () => usage(),
    "-h": () => usage(),
    doctor: () => coreCommands.doctor(),
    "env-check": () => coreCommands.envCheck(),
    "workflow-check": () => coreCommands.workflowCheck(),
    "storage-check": () => coreCommands.storageCheck(),
    "surface-audit": () => coreCommands.surfaceAuditCheck(),
    "workspace-map": () => coreCommands.workspaceMap(),
    "capabilities-list": (options) => coreCommands.capabilitiesList(options),
    "profiles-list": (options) => listImportProfiles({ repoRoot, options }),
    "tidas-handshake": (options) => tidasWorkflowCommands.runTidasHandshake(options),
    "execution-capsule-admit": (options) =>
      executionCapsuleCommands.runExecutionCapsuleAdmit(options),
    "dataset-incremental-change-set-compose": (options) =>
      incrementalChangeSetCommands.runDatasetIncrementalChangeSetCompose(options),
    "dataset-topology-convergence-compose": (options) =>
      topologyConvergenceCommands.runDatasetTopologyConvergenceCompose(options),
    "final-delivery-promote": (options) =>
      finalDeliveryPromotionCommands.runFinalDeliveryPromote(options),
    "dataset-import-ledger-report": (options) =>
      importLedgerCommands.runDatasetImportLedgerReport(options),
    "library-batch-import": (options) => libraryBatchImportCommands.runLibraryBatchImport(options),
  };

  const internalStageHandlers: Record<string, (options: JsonRecord) => unknown> = {
    init: () => coreCommands.initRuntime(),
    "acceptance-check": () => coreCommands.acceptanceCheck(),
    "route-task": (options) =>
      coreCommands.writeRoutePlan(
        coreCommands.buildRoutePlan(options),
        typeof options.outDir === "string" ? options.outDir : undefined,
      ),
    "tasks-list": () => taskCommands.tasksList(),
    "tasks-check": () => taskCommands.tasksCheck(),
    "task-complete": (options) => taskCommands.runTaskComplete(options),
    "dataset-tidas-import": (options) => tidasWorkflowCommands.runTidasImport(options),
    "dataset-tidas-validate": (options) => tidasWorkflowCommands.runTidasPackageValidation(options),
    "dataset-curation-queue-build": (options) =>
      cliWrapperCommands.runDatasetCurationQueueBuild(options),
    "dataset-curation-gate": (options) => runDatasetCurationGate({ repoRoot, options }),
    "dataset-authoring-plan": (options) => authoringPlanCommands.runDatasetAuthoringPlan(options),
    "dataset-authoring-task-build": (options) =>
      runDatasetAuthoringTaskBuild({ repoRoot, options }),
    "dataset-authoring-patch-collect": (options) =>
      runDatasetAuthoringPatchCollect({ repoRoot, options }),
    "dataset-identity-decision-task-build": (options) =>
      identityDecisionTaskCommands.runDatasetIdentityDecisionTaskBuild(options),
    "dataset-classification-decision-task-build": (options) =>
      classificationDecisionCommands.runDatasetClassificationDecisionTaskBuild(options),
    "dataset-library-classification-decisions-project": (options) =>
      classificationDecisionCommands.runDatasetLibraryClassificationDecisionsProject(options),
    "dataset-bafu-leaf-classification-tasks-prepare": (options) =>
      bafuLeafClassificationTaskCommands.runDatasetBafuLeafClassificationTasksPrepare(options),
    "dataset-bafu-leaf-classification-category-map-project": (options) =>
      bafuLeafClassificationTaskCommands.runDatasetBafuLeafClassificationCategoryMapProject(
        options,
      ),
    "dataset-bafu-identity-decisions-autofill": (options) =>
      bafuAutoAuthoringCommands.runDatasetBafuIdentityDecisionsAutofill(options),
    "dataset-bafu-authoring-patches-autofill": (options) =>
      bafuAutoAuthoringCommands.runDatasetBafuAuthoringPatchesAutofill(options),
    "dataset-classification-decisions-apply": (options) =>
      classificationDecisionCommands.runDatasetClassificationDecisionsApply(options),
    "dataset-location-decision-task-build": (options) =>
      locationDecisionCommands.runDatasetLocationDecisionTaskBuild(options),
    "dataset-location-decisions-suggest": (options) =>
      locationDecisionCommands.runDatasetLocationDecisionsSuggest(options),
    "dataset-location-decisions-apply": (options) =>
      locationDecisionCommands.runDatasetLocationDecisionsApply(options),
    "dataset-curation-cleanup": (options) => runDatasetCurationCleanup({ repoRoot, options }),
    "dataset-patch-apply": (options) => cliWrapperCommands.runDatasetPatchApply(options),
    "dataset-support-cache-refresh": (options) =>
      supportCacheCommands.runDatasetSupportCacheRefresh(options),
    "dataset-canonical-support-mappings-autofill": (options) =>
      supportCacheCommands.runDatasetCanonicalSupportMappingsAutofill(options),
    "dataset-bundle-sample-rows": (options) =>
      bundleSampleRowsCommands.runDatasetBundleSampleRows(options),
    "dataset-identity-preflight-requests-build": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightRequestsBuild(options),
    "dataset-identity-preflight-query-audit": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightQueryAudit(options),
    "dataset-identity-preflight-run": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightRun(options),
    "dataset-identity-preflight-index-merge": (options) =>
      identityPreflightCommands.runDatasetIdentityPreflightIndexMerge(options),
    "dataset-library-index-build": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryIndexBuild(options),
    "dataset-library-authoring-plan": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryAuthoringPlan(options),
    "dataset-library-identity-decisions-from-preflight": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryIdentityDecisionsFromPreflight(options),
    "dataset-library-decisions-apply": (options) =>
      libraryScopeWorkflowCommands.runDatasetLibraryDecisionsApply(options),
    "dataset-process-scope-run": (options) =>
      libraryScopeWorkflowCommands.runDatasetProcessScopeRun(options),
    "dataset-bafu-process-scope-e2e": (options) =>
      bafuProcessScopeE2eCommands.runDatasetBafuProcessScopeE2e(options),
    "dataset-bafu-batch-import-run": (options) =>
      bafuBatchImportRunCommands.runDatasetBafuBatchImportRun(options),
    "dataset-uslci-batch-import-run": (options) =>
      uslciBatchImportRunCommands.runDatasetUslciBatchImportRun(options),
    "dataset-worldsteel-batch-import-run": (options) =>
      worldsteelBatchImportRunCommands.runDatasetWorldsteelBatchImportRun(options),
    "dataset-bafu-universe-coverage-report": (options) =>
      bafuBatchImportRunCommands.runDatasetBafuUniverseCoverageReport(options),
    "dataset-identity-reference-rewrites-apply": (options) =>
      identityReferenceRewriteCommands.runDatasetIdentityReferenceRewritesApply(options),
    "dataset-identity-decisions-apply": (options) =>
      identityDecisionCommands.runDatasetIdentityDecisionsApply(options),
    "dataset-post-authoring-finalize": (options) =>
      postAuthoringFinalizeCommands.runDatasetPostAuthoringFinalize(options),
    "dataset-commit-handoff-plan": (options) =>
      commitHandoffCommands.runDatasetCommitHandoffPlan(options),
    "dataset-post-write-closeout": (options) =>
      postWriteCloseoutCommands.runDatasetPostWriteCloseout(options),
    "dataset-import-completion-report": (options) =>
      importCompletionCommands.runDatasetImportCompletionReport(options),
    "dataset-mutation-manifest": (options) => runDatasetMutationManifest({ repoRoot, options }),
  };

  const stageHandlers: Record<string, (options: JsonRecord) => unknown> = {
    ...commandHandlers,
    ...internalStageHandlers,
  };

  return Object.freeze({
    commands: Object.freeze(Object.keys(stageHandlers)),
    cliCommands: Object.freeze(Object.keys(commandHandlers)),
    async execute(command: string, options: JsonRecord = {}): Promise<unknown> {
      if (!Object.hasOwn(stageHandlers, command))
        throw new Error(`Unknown Foundry command: ${command}`);
      return stageHandlers[command](options);
    },
  });
}

async function runFoundryCliMain({
  allowInternalStages,
  argv,
  commandDeps,
  decisionDeps,
  runtime,
}: Required<FoundryCliInput>): Promise<void> {
  const { exitCodeForCommand, parseArgs, printJson, usage } = runtime;
  const dispatcher = createFoundryCommandDispatcher({
    commandDeps,
    decisionDeps,
    runtime,
  });
  const [command = "help", ...rest] = argv.slice(2);
  const options = parseArgs(rest);
  const admitted = allowInternalStages ? dispatcher.commands : dispatcher.cliCommands;
  if (!admitted.includes(command)) {
    console.error(`Unknown Foundry command: ${command}`);
    console.error(`Known commands: ${usage().commands.join(", ")}`);
    process.exit(2);
  }
  const result = await dispatcher.execute(command, options);
  const exitCode = exitCodeForCommand(command, result);
  printJson(result);
  process.exit(exitCode);
}
