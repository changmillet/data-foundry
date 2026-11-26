#!/usr/bin/env node
import { createAuthoringPlanCommands } from "./commands/authoring-plan.ts";
import { createBafuAutoAuthoringCommands } from "./commands/bafu-auto-authoring.ts";
import { createBafuBatchImportRunCommands } from "./commands/bafu-batch-import-run.ts";
import { createBafuLeafClassificationTaskCommands } from "./commands/bafu-leaf-classification-tasks.ts";
import { createBafuProcessScopeE2eCommands } from "./commands/bafu-process-scope-e2e.ts";
import { createBundleSampleRowsCommands } from "./commands/bundle-sample-rows.ts";
import { createCliWrapperCommands } from "./commands/cli-wrappers.ts";
import { createCommitHandoffCommands } from "./commands/commit-handoff.ts";
import { createCoreCommands } from "./commands/core.ts";
import { createExecutionCapsuleCommands } from "./commands/execution-capsule.ts";
import { createFinalDeliveryPromotionCommands } from "./commands/final-delivery-promotion.ts";
import { createIdentityDecisionTaskCommands } from "./commands/identity-decision-task.ts";
import { createIdentityDecisionCommands } from "./commands/identity-decisions.ts";
import { createIdentityPreflightRunCommands } from "./commands/identity-preflight-run.ts";
import { createIdentityReferenceRewriteCommands } from "./commands/identity-reference-rewrites.ts";
import { createImportCompletionCommands } from "./commands/import-completion.ts";
import { createImportLedgerCommands } from "./commands/import-ledger.ts";
import { createIncrementalChangeSetCommands } from "./commands/incremental-change-set.ts";
import { createLibraryBatchImportCommands } from "./commands/library-batch-import.ts";
import { createLibraryScopeWorkflowCommands } from "./commands/library-scope-workflow.ts";
import { createPostAuthoringFinalizeCommands } from "./commands/post-authoring-finalize.ts";
import { createPostWriteCloseoutCommands } from "./commands/post-write-closeout.ts";
import { createSupportCacheCommands } from "./commands/support-cache.ts";
import { createTaskCommands } from "./commands/tasks.ts";
import { createTidasWorkflowCommands } from "./commands/tidas-workflow.ts";
import { createTopologyConvergenceCommands } from "./commands/topology-convergence.ts";
import { createUslciBatchImportRunCommands } from "./commands/uslci-batch-import-run.ts";
import { createWorldsteelBatchImportRunCommands } from "./commands/worldsteel-batch-import-run.ts";
import { bundleRowTypes } from "./lib/bundle-row-types.ts";
import { createBundleSampleUtils } from "./lib/bundle-sample-utils.ts";
import { createCanonicalSupportRewriteUtils } from "./lib/canonical-support-rewrites.ts";
import { createDecisionTaskUtils } from "./lib/decision-task-utils.ts";
import { parseArgs, parseScalar } from "./lib/foundry-args.ts";
import { createFoundryCommandDispatcher, runFoundryCli } from "./lib/foundry-cli.ts";
import { exitCodeForCommand, usage } from "./lib/foundry-command-registry.ts";
import { createFoundryRuntimeUtils } from "./lib/foundry-runtime-utils.ts";
import { resolveFoundryRuntimePaths } from "./lib/foundry-runtime-paths.ts";
import { createFullContextProofUtils } from "./lib/full-context-proof.ts";
import { createIdentityPreflightArtifactUtils } from "./lib/identity-preflight-artifacts.ts";
import { createIdentityReferenceRewriteUtils } from "./lib/identity-reference-rewrite-utils.ts";
import {
  foundryTraceSummary,
  listImportProfiles,
  profileFor,
  runDatasetAuthoringPatchCollect,
  runDatasetAuthoringTaskBuild,
  runDatasetCurationCleanup,
  runDatasetCurationGate,
  runDatasetMutationManifest,
} from "./lib/import-curation.ts";
import { normalizeUtcDateTimeString } from "./lib/import-curation/internal/prewrite-cleanup.ts";
import { createImportLedgerUtils } from "./lib/import-ledger.ts";
import { createLocationQualityUtils } from "./lib/location-quality-utils.ts";
import { createPostAuthoringFinalizeUtils } from "./lib/post-authoring-finalize-utils.ts";
import { createSourceSemanticUtils } from "./lib/source-semantics.ts";
import {
  runTidasHandshake,
  runTidasImport,
  runTidasPackageValidation,
  runTidasRowsValidation,
} from "./lib/tidas-adapter.ts";
import { createTidasRowUtils } from "./lib/tidas-row-utils.ts";
import { createTraceCoverageUtils } from "./lib/trace-coverage.ts";
import { runFoundryRuntimeCommand } from "./runtime-entry.ts";

export interface FoundryApplicationOptions {
  repoRoot: string;
  utilities?: ReturnType<typeof createFoundryRuntimeUtils>;
}

/** Internal command composition. The consumer runtime admits each command with its own task/I/O guards. */
export function createFoundryApplication({ repoRoot, utilities }: FoundryApplicationOptions) {
  const foundryTraceNamespace = "https://tiangong-lca.dev/foundry/import-curation/1";
  const runtime = utilities ?? createFoundryRuntimeUtils({ parseScalar, repoRoot });
  const tidasRows = createTidasRowUtils({ ...runtime, bundleRowTypes });
  const base = { ...runtime, ...tidasRows, repoRoot, bundleRowTypes };

  const decisionTasks = createDecisionTaskUtils(base);
  const fullContextProof = createFullContextProofUtils({
    ...base,
    ...decisionTasks,
    listImportProfiles,
  });
  const traceCoverage = createTraceCoverageUtils({ ...base, foundryTraceSummary });
  const canonicalSupport = createCanonicalSupportRewriteUtils(base);

  const coreCommands = createCoreCommands({ ...base, listImportProfiles });
  const taskCommands = createTaskCommands({ ...base, ...fullContextProof });
  const executionCapsuleCommands = createExecutionCapsuleCommands({ repoRoot });
  const finalDeliveryPromotionCommands = createFinalDeliveryPromotionCommands({ repoRoot });
  const incrementalChangeSetCommands = createIncrementalChangeSetCommands({ repoRoot });
  const topologyConvergenceCommands = createTopologyConvergenceCommands({ repoRoot });
  const tidasWorkflowCommands = createTidasWorkflowCommands({
    repoRoot,
    runTidasHandshake,
    runTidasImport,
    runTidasPackageValidation,
    runTidasRowsValidation,
  });
  const cliWrapperCommands = createCliWrapperCommands(base);
  const commitHandoffCommands = createCommitHandoffCommands({
    ...base,
    ...fullContextProof,
    ...traceCoverage,
    profileFor,
  });
  const importLedgerUtils = createImportLedgerUtils(base);
  const importLedgerCommands = createImportLedgerCommands({
    runDatasetImportLedgerReport: importLedgerUtils.runDatasetImportLedgerReport,
  });
  const postWriteCloseoutCommands = createPostWriteCloseoutCommands({
    ...base,
    ...fullContextProof,
    ...traceCoverage,
    writeCloseoutImportLedger: importLedgerUtils.writeCloseoutImportLedger,
  });
  const importCompletionCommands = createImportCompletionCommands({
    ...base,
    ...fullContextProof,
  });
  const supportCacheCommands = createSupportCacheCommands({ ...base, ...canonicalSupport });

  const sourceSemantics = createSourceSemanticUtils(base);
  const bundleSampleUtils = createBundleSampleUtils({
    ...base,
    ...sourceSemantics,
    normalizeUtcDateTimeString,
  });
  const identityPreflightArtifacts = createIdentityPreflightArtifactUtils({
    ...base,
    ...decisionTasks,
    ...bundleSampleUtils,
  });
  const locationQuality = createLocationQualityUtils(base);
  const identityPreflightCommands = createIdentityPreflightRunCommands({
    ...base,
    ...decisionTasks,
    ...identityPreflightArtifacts,
  });
  const libraryScopeWorkflowCommands = createLibraryScopeWorkflowCommands({
    ...base,
    profileFor,
  });
  const bafuProcessScopeE2eCommands = createBafuProcessScopeE2eCommands(base);
  const batchImportRunDeps = { ...base, asText: tidasRows.textValue };
  const bafuBatchImportRunCommands = createBafuBatchImportRunCommands(batchImportRunDeps);
  const uslciBatchImportRunCommands = createUslciBatchImportRunCommands(batchImportRunDeps);
  const worldsteelBatchImportRunCommands =
    createWorldsteelBatchImportRunCommands(batchImportRunDeps);
  const libraryBatchImportCommands = createLibraryBatchImportCommands({
    bafuBatchImportRunCommands,
    uslciBatchImportRunCommands,
    worldsteelBatchImportRunCommands,
  });
  const bafuLeafClassificationTaskCommands = createBafuLeafClassificationTaskCommands({
    ...base,
    asText: tidasRows.textValue,
  });
  const bafuAutoAuthoringCommands = createBafuAutoAuthoringCommands(base);
  const identityReferenceRewriteUtils = createIdentityReferenceRewriteUtils({
    ...base,
    ...canonicalSupport,
    foundryTraceNamespace,
    identityPreflightCommands,
  });
  const postAuthoringFinalizeUtils = createPostAuthoringFinalizeUtils({
    ...base,
    cliWrapperCommands,
    identityPreflightCommands,
    ...identityReferenceRewriteUtils,
  });
  const authoringPlanCommands = createAuthoringPlanCommands({ ...base, ...decisionTasks });
  const identityReferenceRewriteCommands = createIdentityReferenceRewriteCommands({
    ...base,
    ...identityReferenceRewriteUtils,
  });
  const identityDecisionCommands = createIdentityDecisionCommands({
    ...base,
    ...identityReferenceRewriteUtils,
    profileFor,
  });
  const identityDecisionTaskCommands = createIdentityDecisionTaskCommands({
    ...base,
    ...decisionTasks,
  });
  const postAuthoringFinalizeCommands = createPostAuthoringFinalizeCommands({
    ...base,
    ...canonicalSupport,
    ...sourceSemantics,
    ...bundleSampleUtils,
    ...fullContextProof,
    ...identityReferenceRewriteUtils,
    ...postAuthoringFinalizeUtils,
    profileFor,
    runDatasetCommitHandoffPlan: commitHandoffCommands.runDatasetCommitHandoffPlan,
    runDatasetCurationCleanup,
    runDatasetCurationGate,
    runDatasetMutationManifest,
    runTidasRowsValidation: (options: Record<string, unknown>) =>
      runTidasRowsValidation({ repoRoot, options }),
    runTiangongJsonStage: (stage: string, args: string[]) =>
      cliWrapperCommands.runDatasetQaStage(stage, args) ??
      runtime.runTiangongJsonStage(stage, args),
    writeFinalizeImportLedger: importLedgerUtils.writeFinalizeImportLedger,
  });
  const bundleSampleRowsCommands = createBundleSampleRowsCommands({
    ...base,
    ...canonicalSupport,
    ...sourceSemantics,
    ...bundleSampleUtils,
    ...identityPreflightArtifacts,
    ...locationQuality,
    profileFor,
  });

  const bindings = {
    commandDeps: {
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
      topologyConvergenceCommands,
    },
    decisionDeps: { ...base, ...decisionTasks },
    runtime: { exitCodeForCommand, parseArgs, printJson: tidasRows.printJson, usage },
  };
  const dispatcher = createFoundryCommandDispatcher(bindings);
  return Object.freeze({
    ...dispatcher,
    runCli: (argv: string[]) => runFoundryCli({ argv, ...bindings }),
    runStageCli: (argv: string[]) =>
      runFoundryCli({ allowInternalStages: true, argv, ...bindings }),
  });
}

export function runFoundryStageCli(argv: string[] = process.argv): void {
  const { repoRoot } = resolveFoundryRuntimePaths(import.meta.url);
  const utilities = createFoundryRuntimeUtils({ parseScalar, repoRoot });
  utilities.loadRuntimeEnv();
  createFoundryApplication({ repoRoot, utilities }).runStageCli(argv);
}

export function main(argv: string[] = process.argv): void {
  if (
    ["workspace", "task"].includes(argv[2] ?? "") ||
    Object.hasOwn(parseArgs(argv.slice(3)), "workspace")
  ) {
    void runFoundryRuntimeCommand(argv);
    return;
  }
  const { repoRoot } = resolveFoundryRuntimePaths(import.meta.url);
  const utilities = createFoundryRuntimeUtils({ parseScalar, repoRoot });
  utilities.loadRuntimeEnv();
  createFoundryApplication({ repoRoot, utilities }).runCli(argv);
}

if (import.meta.main) main();
