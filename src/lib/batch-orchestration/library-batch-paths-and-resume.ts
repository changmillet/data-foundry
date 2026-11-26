import fs from "node:fs";
import path from "node:path";
import type { SchemaPaths } from "../bafu-classification/schema-repair.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../foundry-runtime-utils.ts";
import {
  DEFAULT_BATCH_COMMAND_NAME,
  type JsonRecord,
  type LibraryBatchProfileStrategy,
} from "./library-batch-profile-strategy.ts";
import type { createLibraryBatchRuntimeHelpers } from "./library-batch-runtime-helpers.ts";
import type { BatchScopeExecutionPaths as BatchPaths } from "./scope-execution.ts";
import {
  createBafuScopeResumeContract,
  type BafuScopeResumeContext,
} from "./scope-resume-contract.ts";
import { selectionOrderOption } from "./scope-selection.ts";
import { createBafuScopeSourceContent } from "./scope-source-content.ts";

type BatchRuntimeHelpers = ReturnType<typeof createLibraryBatchRuntimeHelpers>;

export interface ResolvedBatchRunConfig {
  runDir: string;
  scopeFile: string;
  processBundlesDir: string;
  outDir: string;
  commit: boolean;
  preflightOnly: boolean;
  targetUserId: string;
  stateCode: number;
  parallel: number;
  limit: number | null;
  requestedProcessIds: Set<string>;
  pendingOnly: boolean;
  force: boolean;
  selectionOrder: ReturnType<typeof selectionOrderOption>;
  requireLeafClassification: boolean;
  resolutionRewritesByProcess: Map<string, JsonRecord[]>;
  pauseFile: string | null;
  stopAfterBlocked: number | null;
  paths: BatchPaths;
}

export function buildBatchPaths({
  runDir,
  outDir,
  scopeFile,
  processBundlesDir,
  options,
  resolutionRewritesByProcess,
  applyResolutionRewritesMode,
  resolveRepoPath,
}: {
  runDir: string;
  outDir: string;
  scopeFile: string;
  processBundlesDir: string;
  options: JsonRecord;
  resolutionRewritesByProcess: Map<string, JsonRecord[]>;
  applyResolutionRewritesMode: boolean;
  resolveRepoPath: (value: unknown) => string | null;
}): BatchPaths {
  return {
    runDir,
    outDir,
    scopeFile,
    processBundlesDir,
    libraryClassificationDecisions: resolveRepoPath(
      options.libraryClassificationDecisions ||
        path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
    ),
    scopeCheckpoints: path.join(outDir, "scope-checkpoints.jsonl"),
    okFlows: path.join(outDir, "import-ledger", "ok.flows.verified.jsonl"),
    okProcesses: path.join(outDir, "import-ledger", "ok.processes.verified.jsonl"),
    okScopes: path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"),
    blockedHumanReview: path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"),
    blockedHumanReviewActive: path.join(
      outDir,
      "import-ledger",
      "blocked.scopes.human-review.active.jsonl",
    ),
    blockedHumanReviewResolved: path.join(
      outDir,
      "import-ledger",
      "blocked.scopes.human-review.resolved.jsonl",
    ),
    blocked_human_review: path.join(
      outDir,
      "import-ledger",
      "blocked.dependencies.human-review.jsonl",
    ),
    blocked_reference_closure: path.join(
      outDir,
      "import-ledger",
      "blocked.dependencies.reference-closure.jsonl",
    ),
    blocked_remote_write: path.join(
      outDir,
      "import-ledger",
      "blocked.dependencies.remote-write.jsonl",
    ),
    blockedOther: path.join(outDir, "import-ledger", "blocked.dependencies.other.jsonl"),
    failedRetry: path.join(outDir, "import-ledger", "failed.scopes.retry.jsonl"),
    supportIdentityCache: resolveRepoPath(
      options.verifiedSupportIdentitiesFile ||
        options.supportIdentityCache ||
        path.join(outDir, "import-ledger", "verified-support-identities.jsonl"),
    )!,
    preflightPlan: path.join(outDir, "import-ledger", "preflight.plan.jsonl"),
    bafuFamilySignatures: path.join(outDir, "import-ledger", "bafu-family-signatures.json"),
    controlArtifactStore:
      resolveRepoPath(options.controlArtifactStoreDir) ||
      path.join(runDir, "control-artifact-store"),
    resumeInvalidated: path.join(outDir, "import-ledger", "resume.invalidated.jsonl"),
    attemptEvents: path.join(outDir, "import-ledger", "scope-attempt-events.jsonl"),
    attemptState: path.join(outDir, "import-ledger", "scope-attempt-state.jsonl"),
    ambiguousNoReplay: path.join(
      outDir,
      "import-ledger",
      "failed.scopes.ambiguous-no-replay.jsonl",
    ),
    resumeContractsByScopeKey: new Map(),
    resolutionRewritesByProcess,
    applyResolutionRewritesMode,
  };
}

export function resolveBatchRunConfig({
  options,
  repoRoot,
  strategy,
  helpers,
  loadResolutionRewritesByProcess,
}: {
  options: JsonRecord;
  repoRoot: string;
  strategy: LibraryBatchProfileStrategy;
  helpers: BatchRuntimeHelpers;
  loadResolutionRewritesByProcess: (dir: string) => Map<string, JsonRecord[]>;
}): ResolvedBatchRunConfig {
  const {
    resolveRepoPath,
    fileExists,
    directoryExists,
    booleanOption,
    asText,
    integerOption,
    requestedProcessIdValues,
  } = helpers;
  const runDir = resolveRepoPath(
    options.runDir || path.dirname(resolveRepoPath(options.scopeFile || "") || repoRoot),
  )!;
  const scopeFile = resolveRepoPath(
    options.scopeFile ||
      path.join(runDir, "library-resolution-v4-leaf-category-map", "ready-scopes.jsonl"),
  )!;
  const processBundlesDir = resolveRepoPath(
    options.processBundlesDir ||
      options.bundlesDir ||
      "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles",
  )!;
  if (!fileExists(scopeFile)) throw new Error("--scope-file is required.");
  if (!directoryExists(processBundlesDir)) throw new Error("--process-bundles-dir is required.");
  if (!directoryExists(runDir)) throw new Error("--run-dir is required.");
  const outDir = resolveRepoPath(options.outDir || path.join(runDir, "batch-import"))!;
  const commit = booleanOption(options.commit);
  const preflightOnly = booleanOption(options.preflightOnly || options.planOnly);
  if (!commit && !preflightOnly) {
    throw new Error(
      `${DEFAULT_BATCH_COMMAND_NAME} requires --commit for remote writes, or --preflight-only for a read-only execution plan.`,
    );
  }
  const targetUserId = asText(options.targetUserId);
  if (!preflightOnly && !targetUserId) throw new Error("--target-user-id is required.");
  const stateCode = integerOption(options.stateCode, 0) ?? 0;
  const parallel = Math.max(1, Math.min(20, integerOption(options.parallel, 5) ?? 5));
  const limit = options.limit == null ? null : Math.max(0, integerOption(options.limit, 0) ?? 0);
  const requestedProcessIds = new Set(requestedProcessIdValues(options));
  const pendingOnly = booleanOption(options.pendingOnly);
  const force = booleanOption(options.force);
  const selectionOrder = selectionOrderOption(options.selectionOrder || options.scopeOrder);
  const requireLeafClassification = booleanOption(
    options.requireLeafClassification || options.leafClassificationOnly,
  );
  const libraryResolutionDir = asText(options.libraryResolution || options.libraryResolutionDir)
    ? resolveRepoPath(options.libraryResolution || options.libraryResolutionDir)
    : null;
  const resolutionRewritesByProcess =
    strategy.applyResolutionRewrites && libraryResolutionDir
      ? loadResolutionRewritesByProcess(libraryResolutionDir)
      : new Map<string, JsonRecord[]>();
  const pauseFile = asText(options.pauseFile) ? resolveRepoPath(options.pauseFile) : null;
  const stopAfterBlocked =
    options.stopAfterBlocked == null
      ? null
      : Math.max(1, integerOption(options.stopAfterBlocked, 1) ?? 1);
  fs.mkdirSync(outDir, { recursive: true });
  const paths = buildBatchPaths({
    runDir,
    outDir,
    scopeFile,
    processBundlesDir,
    options,
    resolutionRewritesByProcess,
    applyResolutionRewritesMode: strategy.applyResolutionRewrites,
    resolveRepoPath,
  });
  return {
    runDir,
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
    resolutionRewritesByProcess,
    pauseFile,
    stopAfterBlocked,
    paths,
  };
}

export function buildScopeResumeContracts({
  allScopes,
  runConfig,
  schemas,
  strategy,
  defaultContext,
  helpers,
}: {
  allScopes: JsonRecord[];
  runConfig: ResolvedBatchRunConfig;
  schemas: SchemaPaths;
  strategy: LibraryBatchProfileStrategy;
  defaultContext: (
    runDir: string,
    type: string,
  ) => { schemaFile: string; yamlFile: string; rulesetFile: string };
  helpers: BatchRuntimeHelpers;
}) {
  const { fileExists, repoRelative, asText } = helpers;
  const resumeSharedFiles = [
    runConfig.paths.libraryClassificationDecisions,
    defaultContext(runConfig.runDir, "process").schemaFile,
    defaultContext(runConfig.runDir, "process").yamlFile,
    defaultContext(runConfig.runDir, "process").rulesetFile,
    defaultContext(runConfig.runDir, "flow").schemaFile,
    defaultContext(runConfig.runDir, "flow").yamlFile,
    defaultContext(runConfig.runDir, "flow").rulesetFile,
    schemas.processCategory,
    schemas.flowProductCategory,
    schemas.location,
    ...schemas.allClassification,
  ].filter((filePath): filePath is string => Boolean(filePath));
  const missingInputs = resumeSharedFiles.filter((filePath) => !fileExists(filePath));
  if (missingInputs.length > 0) {
    throw new Error(
      `Missing required batch import inputs:\n${missingInputs.map(repoRelative).join("\n")}`,
    );
  }
  const resumeContext: BafuScopeResumeContext = {
    command: strategy.commandName,
    profile: strategy.profile,
    targetUserId: runConfig.targetUserId,
    stateCode: runConfig.stateCode,
    commit: runConfig.commit,
    parallel: runConfig.parallel,
    requireLeafClassification: runConfig.requireLeafClassification,
    selectionOrder: runConfig.selectionOrder,
    applyResolutionRewrites: strategy.applyResolutionRewrites,
    familySignatures: strategy.enableFamilySignatures,
    mintUnmatchedFpUgSupport: strategy.mintUnmatchedFpUgSupport,
    cliPackage: resolveInstalledTiangongLcaCliPackage().packageSpec,
  };
  return new Map(
    allScopes.map((scope) => {
      const processId = asText(scope.process_id || scope.id);
      const contract = createBafuScopeResumeContract(scope, {
        ...resumeContext,
        sourceContent: createBafuScopeSourceContent({
          scope,
          processBundlesDir: runConfig.processBundlesDir,
          sharedFiles: resumeSharedFiles,
          resolutionRewriteRows: runConfig.resolutionRewritesByProcess.get(processId) ?? [],
          repoRelative,
        }),
      });
      return [contract.identity_key, contract] as const;
    }),
  );
}
