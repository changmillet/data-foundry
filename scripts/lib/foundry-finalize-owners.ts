import { spawnSync } from "node:child_process";
import {
  bindWorkflowChildExecution,
  workflowChildFailure,
} from "./foundry-workflow-child-failure.ts";
import { parseScalar } from "./foundry-args.ts";
import {
  createFoundryRuntimeUtils,
  resolveTiangongLcaCliRuntimeCommand,
} from "./foundry-runtime-utils.ts";
import { createTidasRowUtils } from "./tidas-row-utils.ts";
import { bundleRowTypes } from "./bundle-row-types.ts";
import { createDecisionTaskUtils } from "./decision-task-utils.ts";
import { createFullContextProofUtils } from "./full-context-proof.ts";
import { createTraceCoverageUtils } from "./trace-coverage.ts";
import { createCanonicalSupportRewriteUtils } from "./canonical-support-rewrites.ts";
import { createSourceSemanticUtils } from "./source-semantics.ts";
import { createBundleSampleUtils } from "./bundle-sample-utils.ts";
import { createIdentityReferenceRewriteUtils } from "./identity-reference-rewrite-utils.ts";
import { createPostAuthoringFinalizeUtils } from "./post-authoring-finalize-utils.ts";
import { createFoundryIdentityOwners } from "./foundry-identity-owners.ts";
import { createCliWrapperCommands } from "./finalize-owners/cli-wrappers.ts";
import { createCommitHandoffCommands } from "./finalize-owners/commit-handoff.ts";
import { createPostAuthoringFinalizeCommands } from "./finalize-owners/post-authoring.ts";
import { createPostWriteCloseoutCommands } from "./finalize-owners/post-write-closeout.ts";
import { listImportProfiles, profileFor } from "./import-curation/profiles.ts";
import { foundryTraceSummary } from "./import-curation/trace-summary.ts";
import { runDatasetCurationCleanup } from "./import-curation/curation-cleanup.ts";
import { runDatasetCurationGate } from "./import-curation/curation-gate.ts";
import { runDatasetMutationManifest } from "./import-curation/mutation-manifest.ts";
import { normalizeUtcDateTimeString } from "./import-curation/internal/prewrite-cleanup.ts";
import { runTidasRowsValidation } from "./tidas-adapter.ts";
import { ensureArray } from "./import-curation/internal/runtime-io.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { assertWorkflowReportArtifact, runWorkflowLocalCliResult } from "./foundry-workflow-io.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import {
  FoundryContextError,
  readFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";

function bind<Factory extends (input: never) => unknown>(
  factory: Factory,
  dependencies: Record<keyof Parameters<Factory>[0], unknown>,
): ReturnType<Factory> {
  return factory(dependencies as never) as ReturnType<Factory>;
}

interface FoundryFinalizeOwners {
  finalize: ReturnType<typeof createPostAuthoringFinalizeCommands>;
  handoff: ReturnType<typeof createCommitHandoffCommands>;
  preflight: ReturnType<typeof createFoundryIdentityOwners>["preflight"];
  closeout: ReturnType<typeof createPostWriteCloseoutCommands>;
  invoke<T>(action: () => T): T;
}

/** Reuse finalization owners with fixed installed CLI and explicitly selected execution environments. */
export function createFoundryFinalizeOwners(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  execution: {
    environment: NodeJS.ProcessEnv;
    tidasExecutable: string;
    receiptFile?: string;
    datasetType?: string;
  },
): FoundryFinalizeOwners {
  assertQualifiedFoundryRuntime(context, qualified);
  const runtime = createFoundryRuntimeUtils({ parseScalar, repoRoot: context.assetRoot });
  const rows = createTidasRowUtils({ ...runtime, bundleRowTypes });
  const localEnvironment = createFoundryIsolatedChildEnvironment({ tempRoot: temporary });
  const cli = resolveTiangongLcaCliRuntimeCommand({});
  const base = {
    ...runtime,
    ...rows,
    repoRoot: context.assetRoot,
    ensureArray,
    datasetIdentity: (row: unknown, type: string) => datasetIdentity(row, 0, type),
    flowTypeOfDataSet: (row: unknown) => rows.flowTypeOfDataSet(unwrapDatasetPayload(row, "flow")),
    flowClassificationSchemaType: (row: unknown) =>
      rows.flowClassificationSchemaType(unwrapDatasetPayload(row, "flow")),
    bundleClassificationPath: (row: unknown, type: string) =>
      rows.bundleClassificationPath(unwrapDatasetPayload(row, type), type),
    resolveTiangongLcaCliCommand: () => cli,
    resolveTiangongLcaCliBin: () => cli.display,
    resolveTiangongLcaCliCommandPrefix: () => [cli.command, ...cli.args],
  };
  const decisions = bind(createDecisionTaskUtils, base);
  const proofs = bind(createFullContextProofUtils, { ...base, ...decisions, listImportProfiles });
  const trace = bind(createTraceCoverageUtils, { ...base, foundryTraceSummary });
  const canonical = bind(createCanonicalSupportRewriteUtils, base);
  const source = bind(createSourceSemanticUtils, base);
  const bundle = bind(createBundleSampleUtils, { ...base, ...source, normalizeUtcDateTimeString });
  const identity = createFoundryIdentityOwners(context, qualified, "flow", {
    environment: execution.environment,
    cwd: temporary,
  }).preflight;
  const identityCommands = {
    ...identity,
    runDatasetIdentityPreflightRun: (
      options: Parameters<typeof identity.runDatasetIdentityPreflightRun>[0],
    ) =>
      identity.runDatasetIdentityPreflightRun({
        ...options,
        type: execution.datasetType ?? options.type,
        ...(execution.receiptFile ? { authReceipt: execution.receiptFile } : {}),
        expectedProjectRef: context.accountIntent?.projectRef,
        expectedUserId: context.accountIntent?.userId,
      }),
  };
  const references = bind(createIdentityReferenceRewriteUtils, {
    ...base,
    ...canonical,
    foundryTraceNamespace: "https://tiangong-lca.dev/foundry/import-curation/1",
    identityPreflightCommands: identityCommands,
  });
  const cliWrappers = bind(createCliWrapperCommands, {
    ...base,
    executionEnvironment: localEnvironment,
    executionCwd: temporary,
  });
  const finalizeUtils = bind(createPostAuthoringFinalizeUtils, {
    ...base,
    ...references,
    cliWrapperCommands: cliWrappers,
    identityPreflightCommands: identityCommands,
    executionEnvironment: execution.environment,
    readRowsFile: (file: string) =>
      runtime.readRowsFile(file).map((row) => unwrapDatasetPayload(row, "")),
  });
  const handoff = bind(createCommitHandoffCommands, {
    ...base,
    ...proofs,
    ...trace,
    profileFor,
    executionEnvironment: execution.environment,
  });
  const closeout = bind(createPostWriteCloseoutCommands, {
    ...base,
    ...proofs,
    ...trace,
    executionEnvironment: execution.environment,
    writeCloseoutImportLedger: undefined,
    readRowsFile: (file: string) =>
      runtime.readRowsFile(file).map((row) => unwrapDatasetPayload(row, "")),
  });
  const readOnlyReports = new WeakMap<
    object,
    { outputDirectory: string; failure: (rejection: unknown) => Error }
  >();
  const runTiangongJsonStage = (stage: string, argv: string[]) => {
    assertQualifiedFoundryRuntime(context, qualified);
    const name = argv.slice(0, 2).join(" ");
    const dryRun =
      [
        "flow publish-version",
        "process save-draft",
        "lifecyclemodel save-draft",
        "dataset save-draft",
      ].includes(name) && argv.includes("--dry-run");
    const remoteRead = name === "dataset verify-remote";
    if (argv.some((arg) => /^--(?:commit|execute)(?:=|$)/u.test(arg)))
      throw new FoundryContextError(
        "finalize_write_forbidden",
        "Finalization cannot dispatch a remote mutation.",
      );
    if (!dryRun && !remoteRead) {
      const result = runWorkflowLocalCliResult(context, qualified, temporary, argv);
      return result.validate(() => {
        const ownerStage = {
          stage,
          exit_code: result.exit,
          report: result.report,
          status: String(result.report.status),
          command: cli.command,
          args: [...cli.args, ...argv],
          stderr: "",
        };
        const reportFile = runtime.reportFileFromCliStage(ownerStage, ["files.report"], null);
        if (!reportFile)
          throw new FoundryContextError(
            "workflow_report_invalid",
            "The local finalization owner returned no existing report artifact.",
          );
        result.verifyReportFile(reportFile);
        return ownerStage;
      });
    }
    if (!context.accountIntent)
      throw new FoundryContextError(
        "needs_auth",
        "Remote finalization checks require explicit task account intent.",
      );
    const childExecution = bindWorkflowChildExecution(
      context,
      qualified,
      cli.bin_path,
      argv,
      temporary,
      cli.command,
    );
    const result = spawnSync(cli.command, [...cli.args, ...argv], {
      cwd: temporary,
      env: execution.environment,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const kind = result.error
      ? "spawn_error"
      : result.signal
        ? "signal"
        : ![0, 1, 2].includes(result.status ?? -1)
          ? "exit_code"
          : !result.stdout.trim()
            ? "empty_stdout"
            : null;
    if (kind) throw workflowChildFailure(childExecution, result, kind);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw workflowChildFailure(childExecution, result, "malformed_json");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw workflowChildFailure(childExecution, result, "invalid_report");
    const report = workflowObject(parsed);
    // Domain blocked/readback findings remain with the existing read-only owner contract.
    if ("error" in report || typeof report.status !== "string" || !report.status.trim())
      throw workflowChildFailure(
        childExecution,
        result,
        "stage_rejected",
        new FoundryContextError(
          "finalize_cli_failed",
          "The qualified read-only owner returned an error or no stage status.",
        ),
      );
    const ownerStage = {
      stage,
      exit_code: result.status ?? 1,
      report,
      status: report.status,
      command: cli.command,
      args: [...cli.args, ...argv],
      stderr: result.stderr,
    };
    readOnlyReports.set(ownerStage, {
      outputDirectory: argv[argv.indexOf("--out-dir") + 1],
      failure: (rejection) =>
        workflowChildFailure(childExecution, result, "stage_rejected", rejection),
    });
    return ownerStage;
  };
  const finalize = bind(createPostAuthoringFinalizeCommands, {
    ...base,
    ...canonical,
    ...source,
    ...bundle,
    ...references,
    ...proofs,
    ...finalizeUtils,
    ...handoff,
    profileFor,
    readReferenceBytes: (file: string) => readFoundryInput(context, file),
    runDatasetCurationCleanup,
    runDatasetMutationManifest,
    runDatasetCurationGate: (request: Parameters<typeof runDatasetCurationGate>[0]) =>
      runDatasetCurationGate({
        ...request,
        requireIdentityPreflight: true,
      }),
    runTidasRowsValidation: (options: Record<string, unknown>) =>
      runTidasRowsValidation({
        repoRoot: context.assetRoot,
        options: { ...options, tidasBin: execution.tidasExecutable },
        environment: localEnvironment,
      }),
    runTiangongJsonStage,
    reportFileFromCliStage(
      stage: Parameters<typeof runtime.reportFileFromCliStage>[0],
      selectors: string[],
      fallbackPath: unknown,
    ) {
      const proof = readOnlyReports.get(stage);
      if (!proof) return runtime.reportFileFromCliStage(stage, selectors, fallbackPath);
      try {
        // Preserve the owner selectors and fallback rules. Some read-only commands return
        // a summary rather than the same full report, so do not invent stdout/file equality.
        const file = runtime.reportFileFromCliStage(stage, selectors, fallbackPath);
        if (!file)
          throw new FoundryContextError(
            "finalize_report_invalid",
            "The read-only owner returned no existing selected or fallback report artifact.",
          );
        return assertWorkflowReportArtifact(context, file, proof.outputDirectory);
      } catch (error) {
        throw proof.failure(error);
      }
    },
    writeFinalizeImportLedger: undefined,
  });
  return {
    finalize,
    handoff,
    closeout,
    preflight: identityCommands,
    invoke<T>(action: () => T): T {
      const previous = process.exitCode;
      try {
        return action();
      } finally {
        process.exitCode = previous;
      }
    },
  };
}
