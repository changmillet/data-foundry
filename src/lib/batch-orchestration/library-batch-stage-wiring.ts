import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClassificationSchemaRepairService } from "../bafu-classification/schema-repair.ts";
import { createBafuIdentityDecisionCarryForwardService } from "../bafu-orchestration/identity-decision-carry-forward.ts";
import { createBatchFinalizeStageService } from "../bafu-orchestration/batch-finalize-stage.ts";
import { createFlowResumeLedgerService } from "./flow-resume-ledger.ts";
import { createVerifiedFlowWriteService } from "./verified-flow-write.ts";
import { createAuthoringTaskFilterService } from "./authoring-task-filter.ts";
import { createScopeRecoveryEvidenceService } from "./scope-recovery-evidence.ts";
import { createScopeScratchPolicy } from "./scope-scratch-policy.ts";
import { createSupportIdentityCacheService } from "./support-identity-cache.ts";
import { createVerifiedLedgerProjectionService } from "./verified-ledger-projection.ts";
import { createBatchPostWriteHandoffService } from "./post-write-handoff.ts";
import { createBatchScopeFinalizeCommitService } from "./scope-finalize-commit.ts";
import { createIdentityPatchStageService } from "./identity-patch-stage.ts";
import type { JsonRecord, LibraryBatchProfileStrategy } from "./library-batch-profile-strategy.ts";
import {
  datasetTypeFromRow,
  jsonRecord,
  normalizeSearchText,
  type createLibraryBatchRuntimeHelpers,
} from "./library-batch-runtime-helpers.ts";
import { acceptTraceHashOnlyRemoteVerificationMismatch } from "../remote-verification-accepted-diff.ts";
import {
  commandSpecOptionValue,
  type assertFoundryCommandSpecArtifactsCurrent,
  type assertFoundryCommandSpecBindsArtifact,
} from "../foundry-command-spec.ts";
import {
  assertReceiptBoundHandoffAccount,
  traceHashNormalizationAllowed,
} from "../production-case-policy.ts";

type BatchRuntimeHelpers = ReturnType<typeof createLibraryBatchRuntimeHelpers>;

export function createLibraryBatchStageServices({
  helpers,
  repoRoot,
  foundryEntryPath,
  getStrategy,
  verifiedSupportIdentities,
  assertCommandSpecBindsArtifact,
  assertCommandSpecArtifactsCurrent,
}: {
  helpers: BatchRuntimeHelpers;
  repoRoot: string;
  foundryEntryPath: string;
  getStrategy: () => LibraryBatchProfileStrategy;
  verifiedSupportIdentities: Set<string>;
  assertCommandSpecBindsArtifact: typeof assertFoundryCommandSpecBindsArtifact;
  assertCommandSpecArtifactsCurrent: (
    commandSpec: Parameters<typeof assertFoundryCommandSpecArtifactsCurrent>[0],
  ) => ReturnType<typeof assertFoundryCommandSpecArtifactsCurrent>;
}) {
  const activeProfile = (): string => getStrategy().profile;
  const bafuAutofillEnabled = (): boolean => getStrategy().enableBafuAutofill;
  const mintUnmatchedFpUgSupport = (): boolean => getStrategy().mintUnmatchedFpUgSupport;
  const supportIdentityTypes = (): string[] => [...getStrategy().supportIdentityTypes];

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
    normalizedList,
    findFiles,
    datasetIdentity,
    readRows,
    uniqueExistingPaths,
    foundryCommand,
    runStage,
    runArgvStage,
  } = helpers;

  const supportIdentityCache = createSupportIdentityCacheService(
    {
      nowIso,
      repoRelative,
      resolveRepoPath,
      fileExists,
      directoryExists,
      readJson,
      readJsonLines,
      appendJsonLine,
      findFiles,
      supportedTypes: supportIdentityTypes,
      path: {
        join: (...parts: string[]) => path.join(...parts),
        basename: (filePath: string) => path.basename(filePath),
        dirname: (filePath: string) => path.dirname(filePath),
        separator: path.sep,
      },
    },
    verifiedSupportIdentities,
  );

  const classificationSchemaRepair = createClassificationSchemaRepairService({
    fileExists,
    readJson,
    readJsonLines,
    writeJsonLines,
    repoRelative,
    normalizeSearchText,
    pathJoin: (...parts: string[]) => path.join(...parts),
  });

  const identityDecisionCarryForward = createBafuIdentityDecisionCarryForwardService({
    nowIso,
    repoRelative,
    resolveRepoPath,
    datasetIdentity: (row, datasetType) => datasetIdentity(jsonRecord(row), datasetType),
    resultCacheDirectory: () => process.env.BAFU_IDENTITY_PREFLIGHT_RESULT_CACHE ?? null,
    fs: {
      fileExists,
      directoryExists,
      readDirectory: (directory) =>
        fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })),
      readJson,
      readJsonLines,
      writeJson,
      writeJsonLines,
      ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true }),
      copyFile: (source, destination) => fs.copyFileSync(source, destination),
      readText: (filePath) => fs.readFileSync(filePath, "utf8"),
      removeDirectory: (directory) => fs.rmSync(directory, { recursive: true, force: true }),
    },
    path: {
      join: (...parts) => path.join(...parts),
      basename: (filePath) => path.basename(filePath),
      parse: (filePath) => path.parse(filePath),
    },
    hash: { sha256File },
  });

  const verifiedLedgerProjection = createVerifiedLedgerProjectionService({
    nowIso,
    asText,
    datasetIdentity,
    readJsonLines,
    writeJsonLines,
    appendJsonLine,
    repoRelative,
    pathJoin: (...parts: string[]) => path.join(...parts),
  });

  const flowResumeLedger = createFlowResumeLedgerService({
    asText,
    datasetIdentity,
    readJsonLines,
    repoRelative,
  });

  const verifiedFlowWrite = createVerifiedFlowWriteService({
    asText,
    datasetIdentity,
    datasetIdentityKey: verifiedLedgerProjection.datasetIdentityKey,
    payloadSha256: flowResumeLedger.payloadSha256,
    repoRelative,
    invalidateIdentityPreflightResultCacheEntry:
      identityDecisionCarryForward.invalidateIdentityPreflightResultCacheEntry,
    okDatasetRow: verifiedLedgerProjection.okDatasetRow,
    appendJsonLine,
  });

  const authoringTaskFilter = createAuthoringTaskFilterService({
    nowIso,
    resolveRepoPath,
    readJson,
    readRows,
    writeJson,
    repoRelative,
    asText,
    datasetIdentity,
  });

  function supportIdentityKeysFromHandoffPlan(handoffPlan: JsonRecord): string[] {
    const commands = jsonRecord(handoffPlan.commands);
    const inputPath = resolveRepoPath(
      commandSpecOptionValue(commands.commit, "--input") ||
        commandSpecOptionValue(commands.commit, "--input-file"),
    );
    if (!fileExists(inputPath)) return [];
    return readRows(inputPath)
      .map((row) => {
        const type = datasetTypeFromRow(row) || commandSpecOptionValue(commands.commit, "--type");
        if (!type || !supportIdentityTypes().includes(type)) return null;
        const identity = datasetIdentity(row, type);
        return identity.id ? `${type}:${identity.id}@${identity.version}` : null;
      })
      .filter((key): key is string => Boolean(key));
  }

  const batchPostWriteHandoff = createBatchPostWriteHandoffService({
    processExecutable: process.execPath,
    foundryEntryPath,
    repoRoot,
    environment: process.env,
    resolveRepoPath,
    repoRelative,
    fileExists,
    readJson,
    findFiles,
    joinPath: (...parts: string[]) => path.join(...parts),
    basename: (filePath: string) => path.basename(filePath),
    asText,
    integerOption,
    assertReceiptBoundHandoffAccount,
    assertCommandSpecBindsArtifact,
    assertCommandSpecArtifactsCurrent,
    runStage,
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    traceHashNormalizationAllowed,
    acceptTraceHashOnlyRemoteVerificationMismatch,
  });

  const scopeRecoveryEvidence = createScopeRecoveryEvidenceService({
    resolveRepoPath,
    fileExists,
    readJson,
    readJsonLines,
    findFiles,
    uniqueExistingPaths,
    repoRelative,
  });

  const batchFinalizeStage = createBatchFinalizeStageService({
    processExecPath: process.execPath,
    foundryEntryPath,
    activeProfile,
    libraryContact: () => getStrategy().libraryContact,
    mintUnmatchedFpUgSupport,
    nowIso,
    normalizedList,
    repoRelative,
    resolveRepoPath,
    fileExists,
    readJson,
    runArgvStage,
  });

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

  const batchScopeFinalizeCommit = createBatchScopeFinalizeCommitService({
    joinPath: (...parts: string[]) => path.join(...parts),
    nowIso,
    repoRelative,
    resolveRepoPath,
    fileExists,
    readJson,
    writeJson,
    buildFinalizeArgs: batchFinalizeStage.buildFinalizeArgs,
    runFinalizeStage: batchFinalizeStage.runFinalizeStage,
    executeHandoff: batchPostWriteHandoff.execute,
    runIdentityAndPatch: identityPatchStage.runIdentityAndPatch,
    supportIdentityKeysFromHandoffPlan,
    verifiedSupportIdentities,
    staleReusedSupportIdentityKeys: supportIdentityCache.staleReusedKeys,
    appendSupportIdentityInvalidationRows: supportIdentityCache.appendInvalidationRows,
    appendSupportIdentityCacheRows: supportIdentityCache.appendVerifiedRows,
    firstBlocker: scopeRecoveryEvidence.firstBlocker,
  });

  const scopeScratchPolicy = createScopeScratchPolicy({
    booleanOption,
    nowIso,
    processEnv: process.env,
    repoRelative,
    resolveRepoPath,
  });

  return {
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
    identityPatchStage,
    batchScopeFinalizeCommit,
    scopeScratchPolicy,
  };
}
