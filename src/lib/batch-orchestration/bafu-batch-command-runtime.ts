import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  bafuFamilyPlanFields,
  bafuFamilySelectionRank,
  bafuFamilySignatureForScope,
  buildBafuFamilySignatureIndex,
  compactBafuFamilySignature,
  emptyBafuFamilySignatureIndex,
  summarizeBafuFamilyScopes,
  type BafuFamilySignatureIndexLike,
} from "../bafu-family-signatures.ts";
import {
  assertFoundryCommandSpecArtifactsCurrent,
  assertFoundryCommandSpecBindsArtifact,
} from "../foundry-command-spec.ts";
import {
  buildClassificationDecisionIndex,
  preflightPlanRows,
  selectScopesForRun,
  scopeKey,
} from "./scope-selection.ts";
import { loadScopeResumeProjection } from "./scope-resume-projection.ts";
import { createScopeAttemptLedgerService } from "./scope-attempt-ledger.ts";
import { createScopeExecutionExceptionRecorder } from "./scope-execution-exception.ts";
import { createScopeMutationRecoveryService } from "./scope-mutation-recovery.ts";
import { runFoundryScopeBatch } from "./foundry-scope-batch-runner.ts";
import { createBatchScopeExecutionService } from "./scope-execution.ts";
import { createIdentityPatchStageService } from "./identity-patch-stage.ts";
import { createBatchScopePreparationService } from "./scope-preparation.ts";
import { createUniverseCoverageService } from "./universe-coverage.ts";
import {
  DEFAULT_BATCH_COMMAND_NAME,
  DEFAULT_COVERAGE_COMMAND_NAME,
  resolveLibraryBatchProfileStrategy,
  type JsonRecord,
  type LibraryBatchProfileConfig,
  type LibraryBatchProfileStrategy,
} from "./library-batch-profile-strategy.ts";
import {
  createLibraryBatchRuntimeHelpers,
  createUniverseCoverageRuntimeAdapter,
  resolveLibraryBatchRuntime,
  type LibraryBatchRuntime,
} from "./library-batch-runtime-helpers.ts";
import { createLibraryBatchStageServices } from "./library-batch-stage-wiring.ts";
import {
  buildScopeResumeContracts,
  resolveBatchRunConfig,
} from "./library-batch-paths-and-resume.ts";
import {
  buildBatchHelpPayload,
  buildBatchRunManifest,
  buildUniverseCoverageHelpPayload,
  writeCommitBatchReport,
  writeFamilySignaturesReport,
  writePreflightBatchReport,
} from "./library-batch-reporting.ts";
import { resolveFoundryRuntimePaths } from "../foundry-runtime-paths.ts";

type BafuFamilySignature = ReturnType<typeof bafuFamilySignatureForScope>;

const { entryRepoRelativePath: foundryEntryPath, repoRoot } = resolveFoundryRuntimePaths(
  import.meta.url,
);
const verifiedSupportIdentities = new Set<string>();

let activeBatchRuntime: LibraryBatchRuntime | null = null;
let activeBatchStrategy: LibraryBatchProfileStrategy = resolveLibraryBatchProfileStrategy({});

function installBatchRuntime(
  deps: unknown,
  config: LibraryBatchProfileConfig = {},
): LibraryBatchRuntime {
  const resolved = resolveLibraryBatchRuntime(deps);
  activeBatchRuntime = resolved;
  activeBatchStrategy = resolveLibraryBatchProfileStrategy(config);
  return resolved;
}

function runtime(): LibraryBatchRuntime {
  if (!activeBatchRuntime) {
    throw new Error("createBafuBatchImportRunCommands must install command dependencies.");
  }
  return activeBatchRuntime;
}

const activeProfile = (): string => activeBatchStrategy.profile;
const activeCommandName = (): string => activeBatchStrategy.commandName;
const bafuAutofillEnabled = (): boolean => activeBatchStrategy.enableBafuAutofill;
const familySignaturesEnabled = (): boolean => activeBatchStrategy.enableFamilySignatures;
const commitFlowSupportInline = (): boolean => activeBatchStrategy.commitFlowSupportInline;

const helpers = createLibraryBatchRuntimeHelpers({
  getRuntime: runtime,
  repoRoot,
  foundryEntryPath,
});

const {
  nowIso,
  resolveRepoPath,
  repoRelative,
  fileExists,
  directoryExists,
  readJson,
  readJsonLines,
  writeJson,
  writeJsonLines,
  appendJsonLine,
  sha256File,
  asText,
  booleanOption,
  integerOption,
  commandString,
  findOneFile,
  requestedProcessIdValues,
  datasetIdentity,
  readRows,
  uniqueExistingPaths,
  foundryCommand,
  runArgvStage,
  defaultSchemaFiles,
} = helpers;

// Identity preflight result cache entries consumed by carry-forward are produced by
// src/commands/identity-preflight-run.ts.
const stageServices = createLibraryBatchStageServices({
  helpers,
  repoRoot,
  foundryEntryPath,
  getStrategy: () => activeBatchStrategy,
  verifiedSupportIdentities,
  assertCommandSpecBindsArtifact: assertFoundryCommandSpecBindsArtifact,
  assertCommandSpecArtifactsCurrent: (commandSpec) =>
    assertFoundryCommandSpecArtifactsCurrent(commandSpec, resolveRepoPath),
});

const {
  supportIdentityTypes,
  supportIdentityCache,
  classificationSchemaRepair,
  identityDecisionCarryForward,
  verifiedLedgerProjection,
  flowResumeLedger,
  verifiedFlowWrite,
  authoringTaskFilter,
  supportIdentityKeysFromHandoffPlan,
  batchPostWriteHandoff,
  scopeRecoveryEvidence,
  batchFinalizeStage,
  batchScopeFinalizeCommit,
  scopeScratchPolicy,
} = stageServices;

const identityPatchStage = createIdentityPatchStageService({
  processExecPath: process.execPath,
  foundryEntryPath,
  activeProfile,
  bafuAutofillEnabled,
  resolveRepoPath,
  repoRelative,
  fileExists,
  foundryCommand,
  runArgvStage,
  statusIs: scopeRecoveryEvidence.statusIs,
  firstBlocker: scopeRecoveryEvidence.firstBlocker,
  reportFile: scopeRecoveryEvidence.reportFile,
  mergeCompletedReusableIdentityDecisions:
    identityDecisionCarryForward.mergeCompletedReusableIdentityDecisions,
  identityUnresolvedReferenceBlocker: scopeRecoveryEvidence.identityUnresolvedReferenceBlocker,
  filterAuthoringTaskManifestToRows: authoringTaskFilter.filterAuthoringTaskManifestToRows,
  writeJsonLines,
});

export const { filterAuthoringTaskManifestToRows } = authoringTaskFilter;

export function createLibraryBatchImportRunCommands(
  deps: unknown,
  config: LibraryBatchProfileConfig = {},
): {
  runDatasetBafuBatchImportRun: (options?: JsonRecord) => Promise<JsonRecord>;
  runDatasetBafuUniverseCoverageReport: (options?: JsonRecord) => JsonRecord;
} {
  const resolvedDeps = installBatchRuntime(deps, config);
  const recordScopeExecutionException = createScopeExecutionExceptionRecorder({
    processExecPath: process.execPath,
    foundryEntryPath,
    commandName: activeCommandName,
    nowIso,
    asText,
    repoRelative,
    commandString,
    familyPlanFields: (signature) =>
      bafuFamilyPlanFields(signature as BafuFamilySignature | null | undefined),
    blockRow: verifiedLedgerProjection.blockRow,
    appendJsonLine,
  });
  const universeCoverage = createUniverseCoverageService(
    createUniverseCoverageRuntimeAdapter(resolvedDeps),
  );
  const { ledgerFiles, resolveLedgerSourceDirs, summarizeLedgerSources, sumLedgerSourceRows } =
    universeCoverage;
  const scopePreparation = createBatchScopePreparationService({
    io: {
      processExecPath: process.execPath,
      foundryEntryPath,
      joinPath: (...parts) => path.join(...parts),
      repoRelative,
      resolveRepoPath,
      fileExists,
      fileBytes: (filePath) => fs.statSync(filePath).size,
      sha256File,
      readJsonLines,
    },
    operations: {
      runArgvStage,
      foundryCommand,
      activeProfile,
      libraryContact: () => activeBatchStrategy.libraryContact,
      firstBlocker: scopeRecoveryEvidence.firstBlocker,
      repairClassificationDecisionCodes: classificationSchemaRepair.repair,
      defaultContext: batchScopeFinalizeCommit.defaultContext,
      reportFile: scopeRecoveryEvidence.reportFile,
      outputRowsByStem: scopeRecoveryEvidence.outputRowsByStem,
      findOneFile,
    },
  });
  const scopeExecution = createBatchScopeExecutionService({
    io: {
      processExecPath: process.execPath,
      foundryEntryPath,
      rerunCommandName: DEFAULT_BATCH_COMMAND_NAME,
      joinPath: (...parts) => path.join(...parts),
      ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
      nowIso,
      asText,
      integerOption,
      booleanOption,
      repoRelative,
      resolveRepoPath,
      fileExists,
      readJsonLines,
      readRows,
      writeJson,
      writeJsonLines,
      appendJsonLine,
    },
    operations: {
      prepareScope: scopePreparation.prepareScope,
      requestedProcessIdValues,
      familyPlanFields: (signature) => bafuFamilyPlanFields(signature as BafuFamilySignature),
      compactFamilySignature: (signature, relativePath) =>
        compactBafuFamilySignature(signature as BafuFamilySignature, relativePath),
      commandString,
      blockRow: verifiedLedgerProjection.blockRow,
      categoryForBlocker: scopeRecoveryEvidence.categoryForBlocker,
      retryableStageFailure: batchFinalizeStage.retryableStageFailure,
      firstBlocker: scopeRecoveryEvidence.firstBlocker,
      datasetIdentity,
      datasetIdentityKey: verifiedLedgerProjection.datasetIdentityKey,
      flowRowsPendingVerification: flowResumeLedger.partitionRows,
      recordVerifiedFlowRows: verifiedFlowWrite.record,
      writeScopeCarriedForwardVerifiedFlowRows:
        verifiedLedgerProjection.writeScopeCarriedForwardVerifiedFlowRows,
      existingIdentityApplyReportsWithReferenceRewrites:
        scopeRecoveryEvidence.existingIdentityApplyReportsWithReferenceRewrites,
      uniqueExistingPaths,
      buildFinalizeArgs: batchFinalizeStage.buildFinalizeArgs,
      runFinalizeStage: batchFinalizeStage.runFinalizeStage,
      defaultContext: batchScopeFinalizeCommit.defaultContext,
      commitFlowSupportInline,
      maybeCommitSupportThenRerunFinalize:
        batchScopeFinalizeCommit.maybeCommitSupportThenRerunFinalize,
      runIdentityAndPatch: identityPatchStage.runIdentityAndPatch,
      preFinalizeRecoveryBlocker: scopeRecoveryEvidence.preFinalizeRecoveryBlocker,
      finalizeAndCommitDataset: batchScopeFinalizeCommit.finalizeAndCommit,
      okDatasetRow: verifiedLedgerProjection.okDatasetRow,
      executeHandoff: batchPostWriteHandoff.execute,
      trimVerifiedScopeScratch: scopeScratchPolicy.trimVerifiedScopeScratch,
    },
  });

  function runDatasetBafuUniverseCoverageReport(options: JsonRecord = {}): JsonRecord {
    if (options.help) return buildUniverseCoverageHelpPayload(DEFAULT_COVERAGE_COMMAND_NAME);
    return universeCoverage.runReport(options, {
      commandName: DEFAULT_COVERAGE_COMMAND_NAME,
      defaultInputDir: "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09",
    });
  }

  async function runDatasetBafuBatchImportRun(options: JsonRecord = {}): Promise<JsonRecord> {
    installBatchRuntime(deps, config);
    if (options.help || options.h) return buildBatchHelpPayload(activeCommandName());

    const runConfig = resolveBatchRunConfig({
      options,
      repoRoot,
      strategy: activeBatchStrategy,
      helpers,
      loadResolutionRewritesByProcess: identityDecisionCarryForward.loadResolutionRewritesByProcess,
    });
    const {
      scopeFile,
      processBundlesDir,
      outDir,
      commit,
      preflightOnly,
      targetUserId,
      stateCode,
      parallel,
      limit,
      requestedProcessIds,
      pendingOnly,
      force,
      selectionOrder,
      requireLeafClassification,
      pauseFile,
      stopAfterBlocked,
      paths,
    } = runConfig;
    const ledgerSourceDirs = resolveLedgerSourceDirs(
      options.ledgerSourceDir ||
        options.ledgerSourceDirs ||
        options.carryForwardLedgerDir ||
        options.carryForwardLedgerDirs,
    );
    const ledgerSourceSummary = summarizeLedgerSources(ledgerSourceDirs);
    const okScopeFiles = [
      ...ledgerFiles(ledgerSourceDirs, "ok.scopes.verified.jsonl"),
      paths.okScopes,
    ];
    const okFlowFiles = [
      ...ledgerFiles(ledgerSourceDirs, "ok.flows.verified.jsonl"),
      paths.okFlows,
    ];
    const blockedScopeFiles = [
      ...ledgerFiles(ledgerSourceDirs, "blocked.scopes.human-review.jsonl"),
      paths.blockedHumanReview,
    ];
    const allScopes = readJsonLines(scopeFile);
    const defaultProcessesDir = path.join(path.dirname(processBundlesDir), "tidas", "processes");
    const processFilesDir = resolveRepoPath(
      options.bafuProcessesDir ||
        options.processesDir ||
        (directoryExists(defaultProcessesDir) ? defaultProcessesDir : null),
    );
    const schemas = defaultSchemaFiles(options);
    paths.resumeContractsByScopeKey = buildScopeResumeContracts({
      allScopes,
      runConfig,
      schemas,
      strategy: activeBatchStrategy,
      defaultContext: batchScopeFinalizeCommit.defaultContext,
      helpers,
    });
    const {
      verifiedScopes,
      blockedScopes,
      invalidatedRows: resumeInvalidatedRows,
    } = loadScopeResumeProjection({
      verifiedFiles: okScopeFiles,
      blockedFiles: blockedScopeFiles,
      contracts: paths.resumeContractsByScopeKey,
      adapter: { nowIso, readJsonLines, repoRelative },
    });
    writeJsonLines(paths.resumeInvalidated, resumeInvalidatedRows);
    const verifiedFlows = verifiedLedgerProjection.loadVerifiedSetFromFiles(okFlowFiles, "flow");
    const verifiedFlowRowsByKey = flowResumeLedger.loadRowsByKey(okFlowFiles);
    const supportCacheSummary = supportIdentityCache.prime({
      outDir,
      cacheFile: paths.supportIdentityCache,
      sourceLedgerDirs: ledgerSourceDirs,
    });
    const familySignatureIndex: BafuFamilySignatureIndexLike = familySignaturesEnabled()
      ? buildBafuFamilySignatureIndex({
          scopes: allScopes,
          processBundlesDir,
          processesDir: directoryExists(processFilesDir) ? processFilesDir : null,
          readJson,
        })
      : emptyBafuFamilySignatureIndex();
    const familyAdapter = {
      selectionRank: bafuFamilySelectionRank,
      planFields: bafuFamilyPlanFields,
    };
    const classificationDecisionIndex = buildClassificationDecisionIndex(
      readJsonLines(paths.libraryClassificationDecisions),
    );
    const selection = selectScopesForRun({
      allScopes,
      requestedProcessIds,
      verifiedScopes,
      blockedScopes,
      pendingOnly,
      force,
      selectionOrder,
      limit,
      familySignaturesByScopeKey: familySignatureIndex.byScopeKey,
      familyAdapter,
      classificationDecisionIndex,
      requireLeafClassification,
    });
    const scopes = selection.scopes;
    const selectedFamilySummary = summarizeBafuFamilyScopes(scopes, familySignatureIndex);
    writeFamilySignaturesReport({
      paths,
      nowIso,
      activeCommandName: activeCommandName(),
      scopeFile,
      processBundlesDir,
      processFilesDir,
      familySignatureIndex,
      selectedFamilySummary,
      repoRelative,
      writeJson,
    });
    const manifest = buildBatchRunManifest({
      nowIso,
      activeCommandName: activeCommandName(),
      preflightOnly,
      targetUserId,
      stateCode,
      commit,
      parallel,
      allScopesCount: allScopes.length,
      selectedScopesCount: scopes.length,
      selection,
      resumeInvalidatedCount: resumeInvalidatedRows.length,
      verifiedScopesCount: verifiedScopes.size,
      verifiedFlowsCount: verifiedFlows.size,
      blockedScopesCount: blockedScopes.size,
      verifiedSupportIdentitiesCount: verifiedSupportIdentities.size,
      ledgerSourceDirs,
      ledgerSourceSummary,
      sumLedgerSourceRows,
      classificationDecisionIndex,
      familySignatureIndex,
      selectedFamilySummary,
      paths,
      pendingOnly,
      selectionOrder,
      limit,
      requestedProcessIds,
      requireLeafClassification,
      pauseFile,
      stopAfterBlocked,
      supportIdentityCache: supportCacheSummary,
      repoRelative,
    });
    writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), manifest);
    if (preflightOnly) {
      writeJsonLines(
        paths.preflightPlan,
        preflightPlanRows({
          scopes,
          verifiedScopes,
          blockedScopes,
          familySignaturesByScopeKey: familySignatureIndex.byScopeKey,
          familyAdapter,
          classificationDecisionIndex,
        }),
      );
      return writePreflightBatchReport({
        outDir,
        paths,
        manifest,
        nowIso,
        activeCommandName: activeCommandName(),
        parallel,
        targetUserId,
        supportIdentityCache: supportCacheSummary,
        familySignatureIndex,
        selectedFamilySummary,
        selectedScopesCount: scopes.length,
        selection,
        resumeInvalidatedCount: resumeInvalidatedRows.length,
        verifiedScopesCount: verifiedScopes.size,
        verifiedFlowsCount: verifiedFlows.size,
        blockedScopesCount: blockedScopes.size,
        verifiedSupportIdentitiesCount: verifiedSupportIdentities.size,
        ledgerSourceSummary,
        sumLedgerSourceRows,
        classificationDecisionIndex,
        repoRelative,
        writeJson,
      });
    }

    const attemptLedger = createScopeAttemptLedgerService({
      paths: { state: paths.attemptState, events: paths.attemptEvents },
      adapter: { nowIso, readJsonLines, appendJsonLine, writeJsonLines },
    });
    const mutationRecovery = createScopeMutationRecoveryService({
      paths,
      adapter: {
        nowIso,
        asText,
        readJson,
        readJsonLines,
        fileExists,
        resolveRepoPath,
        repoRelative,
        appendJsonLine,
      },
    });
    const batchResult = await runFoundryScopeBatch({
      runPath: outDir,
      outDirIdentity: repoRelative(outDir),
      scopeFileIdentity: repoRelative(scopeFile),
      pauseFileIdentity: repoRelative(pauseFile),
      command: activeCommandName(),
      profile: activeProfile(),
      targetUserId,
      stateCode,
      selectionOrder,
      stopAfterBlocked,
      maxConcurrency: parallel,
      items: scopes,
      getScopeKey: scopeKey,
      getScopeResumeContract: (scope) => paths.resumeContractsByScopeKey.get(scopeKey(scope))!,
      getFamilyPolicy: (scope) => {
        const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
        return {
          familyGroupKey: familySignature?.family_group_key ?? null,
          optimizationRole: familySignature?.optimization_role ?? "unknown",
        };
      },
      executeScope: async (scope, inputIndex) => {
        const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
        return scopeExecution.runOneScope({
          scope,
          familySignature,
          options: { ...options, targetUserId, stateCode },
          paths,
          schemas,
          verifiedScopes,
          verifiedFlows,
          verifiedFlowRowsByKey,
          blockedScopes,
          workerIndex: inputIndex % parallel,
        });
      },
      recoverScopeMutation: (scope, _error, source) => mutationRecovery.recover(scope, source),
      recoverScopeFailure: (scope, error) => {
        const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
        return recordScopeExecutionException({ scope, familySignature, error, paths });
      },
      summarizeScope: (scope, result) => {
        const familySignature = bafuFamilySignatureForScope(familySignatureIndex, scope);
        return {
          process_id: scope.process_id || scope.id,
          status: result.status,
          ...bafuFamilyPlanFields(familySignature),
        };
      },
      afterScope: () => scopeScratchPolicy.enforceSharedContextCacheCap(paths.runDir, options),
      pauseRequested: () => Boolean(pauseFile && fileExists(pauseFile)),
      resumeItems: attemptLedger.loadResumeItems(new Set(scopes.map(scopeKey))),
      onEvent: attemptLedger.record,
    });
    attemptLedger.compact();
    const results: JsonRecord[] = batchResult.results;
    const pauseObserved = batchResult.paused;
    const stoppedAfterBlocked = batchResult.stoppedAfterBlocked;
    const blockedScopeViews = verifiedLedgerProjection.writeBlockedScopeViews(paths);
    const pausedNotStarted = pauseObserved || stoppedAfterBlocked ? batchResult.unclaimedCount : 0;

    return writeCommitBatchReport({
      outDir,
      paths,
      manifest,
      nowIso,
      activeCommandName: activeCommandName(),
      status: verifiedLedgerProjection.batchRunStatus(results, {
        paused: pauseObserved,
        stoppedAfterBlocked,
      }),
      parallel,
      targetUserId,
      supportIdentityCache: supportCacheSummary,
      familySignatureIndex,
      selectedFamilySummary,
      selectedScopesCount: scopes.length,
      selection,
      resumeInvalidatedCount: resumeInvalidatedRows.length,
      results,
      pausedNotStarted,
      pauseObserved,
      stoppedAfterBlocked,
      blockedScopeViews,
      verifiedScopesCount: verifiedScopes.size,
      verifiedFlowsCount: verifiedFlows.size,
      blockedScopesCount: blockedScopes.size,
      verifiedSupportIdentitiesCount: verifiedSupportIdentities.size,
      ledgerSourceSummary,
      sumLedgerSourceRows,
      classificationDecisionIndex,
      readJsonLines,
      repoRelative,
      writeJson,
    });
  }

  return { runDatasetBafuBatchImportRun, runDatasetBafuUniverseCoverageReport };
}

export const createBafuBatchImportRunCommands = createLibraryBatchImportRunCommands;

export const bafuBatchImportRunTestHooks = {
  commitFailuresAllAlreadyExist: batchPostWriteHandoff.commitFailuresAllAlreadyExist,
  enforceSharedContextCacheCap: scopeScratchPolicy.enforceSharedContextCacheCap,
  flowPayloadSha256: flowResumeLedger.payloadSha256,
  flowRowsPendingVerification: flowResumeLedger.partitionRows,
  foundryCommand,
  identityUnresolvedReferenceBlocker: scopeRecoveryEvidence.identityUnresolvedReferenceBlocker,
  invalidateIdentityPreflightResultCacheEntry:
    identityDecisionCarryForward.invalidateIdentityPreflightResultCacheEntry,
  mergeCompletedReusableIdentityDecisions:
    identityDecisionCarryForward.mergeCompletedReusableIdentityDecisions,
  postWriteVerifyRetryReason: batchPostWriteHandoff.postWriteVerifyRetryReason,
  preFinalizeRecoveryBlocker: scopeRecoveryEvidence.preFinalizeRecoveryBlocker,
  requestedProcessIdValues,
  retryableStageFailure: batchFinalizeStage.retryableStageFailure,
  sha256File,
  splitSupportIdentityKey: supportIdentityCache.splitIdentityKey,
  supportIdentityKeysFromHandoffPlan,
  supportIdentityTypes,
  trimVerifiedScopeScratch: scopeScratchPolicy.trimVerifiedScopeScratch,
  writeScopeCarriedForwardVerifiedFlowRows:
    verifiedLedgerProjection.writeScopeCarriedForwardVerifiedFlowRows,
  setBafuBatchConfigForTest: (config: LibraryBatchProfileConfig): void => {
    activeBatchStrategy = resolveLibraryBatchProfileStrategy(config);
  },
};
