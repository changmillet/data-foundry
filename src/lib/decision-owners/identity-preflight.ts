import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createIdentityPreflightBinding,
  parseFreshIntentBoundAuthReceipt,
  validateBoundExecutionManifest,
  validateIdentityPreflightExecution,
} from "../identity-preflight-proof.ts";
import type { AuthIdentityReceipt, IdentityPreflightBinding } from "../identity-preflight-proof.ts";
import { createFileArtifactFact, createFoundryCommandSpec } from "../foundry-command-spec.ts";
import {
  buildIdentityPreflightRunCounts,
  createIdentityPreflightRunHelpers,
  type IdentityPreflightOptions,
  type IdentityPreflightReport,
  identityPreflightResultCacheDir,
  identityPreflightResultCacheEntryDir,
  type IdentityPreflightRunDependencies,
  identityPreflightRunHelpPayload,
  identityPreflightRunStageContract,
  type JsonRecord,
  type RunResultRow,
} from "./identity-preflight-helpers.ts";
import { createIdentityPreflightIndexAndAuditCommands } from "./identity-preflight-index-and-audit.ts";

export function createIdentityPreflightRunCommands(deps: IdentityPreflightRunDependencies) {
  const {
    executionEnvironment = process.env,
    executionCwd,
    asText,
    booleanOption,
    ensureArray,
    fileExists,
    jsonSha256,
    nowIso,
    positiveIntegerOption,
    readJson,
    readJsonLines,
    repoRelativeMaybe,
    repoRelativePath,
    repoRoot,
    resolveRepoPath,
    resolveTiangongLcaCliCommand,
    resolveTiangongLcaCliBin,
    safeFileToken,
    sha256Text,
    shellQuote,
    writeJson,
    writeJsonLines,
    writeText,
  } = deps;
  const {
    identityPreflightRunIndexPath,
    identityPreflightSpawnTimeoutMs,
    identityPreflightRunReportFile,
    identityPreflightRunOutputDir,
    identityPreflightRunRequestFile,
    identityPreflightRunRowKey,
    selectIdentityPreflightRunRows,
    identityPreflightRunIdentityKey,
    parseJsonMaybe,
    retryFailedKeysFromArtifact,
    retriableIdentityPreflightFailure,
    reusablePositiveIdentityReport,
  } = createIdentityPreflightRunHelpers(deps);
  const {
    runDatasetIdentityPreflightIndexMerge,
    runDatasetIdentityPreflightQueryAudit,
    runDatasetIdentityPreflightRequestsBuild,
  } = createIdentityPreflightIndexAndAuditCommands(deps);

  function runDatasetIdentityPreflightRun(options: IdentityPreflightOptions) {
    if (options.help) {
      return identityPreflightRunHelpPayload();
    }
    const indexPath = identityPreflightRunIndexPath(options);
    if (!indexPath || !fileExists(indexPath)) {
      throw new Error("--index is required and must point to identity-preflight-requests.jsonl.");
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(path.dirname(indexPath)), "identity-preflight-run"),
    )!;
    const rows = readJsonLines(indexPath);
    const retryFailedPath = resolveRepoPath(
      options.retryFailed || options.retryFailedReport || options.retryLedger,
    );
    const retryFailedKeys = retryFailedPath ? retryFailedKeysFromArtifact(retryFailedPath) : null;
    const initiallySelectedRows = selectIdentityPreflightRunRows(rows, options);
    const selectedRows = retryFailedKeys
      ? initiallySelectedRows.filter((row) =>
          retryFailedKeys.has(identityPreflightRunIdentityKey(row)),
        )
      : initiallySelectedRows;
    const onlyPending = booleanOption(options.onlyPending);
    const dryRun = booleanOption(options.dryRun);
    const maxAttempts =
      positiveIntegerOption(
        options.maxAttempts || options.retryMaxAttempts,
        retryFailedKeys ? 3 : 1,
      ) ?? (retryFailedKeys ? 3 : 1);
    const timeoutMs =
      positiveIntegerOption(
        options.timeoutMs || options.timeout || options.identityPreflightTimeoutMs,
        60_000,
      ) ?? 60_000;
    const spawnTimeoutMs = identityPreflightSpawnTimeoutMs(timeoutMs);
    const cli = resolveTiangongLcaCliCommand
      ? resolveTiangongLcaCliCommand()
      : {
          command: resolveTiangongLcaCliBin(),
          args: [],
          display: resolveTiangongLcaCliBin(),
          package: null,
        };
    const authReceiptPath = resolveRepoPath(
      options.authReceipt || options.authIdentityReceipt || options.accountReceipt,
    );
    const verifiedProjectRef = asText(executionEnvironment.FOUNDRY_VERIFIED_PROJECT_REF);
    const verifiedUserId = asText(executionEnvironment.FOUNDRY_VERIFIED_USER_ID);
    const optionExpectedProjectRef = asText(
      options.expectedProjectRef || options.expectedProject || options.projectRef,
    );
    const optionExpectedUserId = asText(options.expectedUserId || options.targetUserId);
    if (
      (verifiedProjectRef &&
        optionExpectedProjectRef &&
        verifiedProjectRef !== optionExpectedProjectRef) ||
      (verifiedUserId && optionExpectedUserId && verifiedUserId !== optionExpectedUserId)
    ) {
      throw new Error("Identity-preflight expected account does not match the receipt-bound env.");
    }
    const expectedProjectRef =
      verifiedProjectRef ||
      optionExpectedProjectRef ||
      asText(executionEnvironment.FOUNDRY_EXPECTED_PROJECT_REF);
    const expectedUserId =
      verifiedUserId ||
      optionExpectedUserId ||
      asText(executionEnvironment.FOUNDRY_EXPECTED_USER_ID);
    let authReceipt: AuthIdentityReceipt | null = null;
    if (!dryRun && selectedRows.length > 0) {
      if (!expectedProjectRef || !expectedUserId) {
        throw new Error(
          "Identity-preflight execution requires --expected-project-ref and --expected-user-id (or receipt-bound Foundry account env).",
        );
      }
      let receiptValue;
      if (authReceiptPath) {
        if (!verifiedProjectRef || !verifiedUserId) {
          throw new Error(
            "Explicit --auth-receipt requires a receipt-bound Foundry account environment.",
          );
        }
        if (!fileExists(authReceiptPath)) {
          throw new Error("--auth-receipt must point to a readable CLI AuthIdentityReceipt.");
        }
        receiptValue = readJson(authReceiptPath);
      } else {
        const receiptArgs = [
          ...cli.args,
          "auth",
          "identity-receipt",
          "--expected-project-ref",
          expectedProjectRef,
          "--expected-user-id",
          expectedUserId,
          "--json",
        ];
        const receiptResult = spawnSync(cli.command, receiptArgs, {
          cwd: executionCwd ?? repoRoot,
          env: {
            ...executionEnvironment,
            TIANGONG_LCA_AUTH_MODE: "oauth",
            TIANGONG_LCA_DISABLE_SESSION_CACHE: "false",
            TIANGONG_LCA_FORCE_REAUTH: "false",
          },
          encoding: "utf8",
          maxBuffer: 256 * 1024,
          timeout: 30_000,
          killSignal: "SIGTERM",
          shell: false,
          windowsHide: true,
        });
        if (
          receiptResult.error ||
          receiptResult.status !== 0 ||
          receiptResult.signal !== null ||
          receiptResult.stderr !== ""
        ) {
          throw new Error("CLI auth identity-receipt failed before identity-preflight execution.");
        }
        receiptValue = parseJsonMaybe(String(receiptResult.stdout || "").trim());
        if (!receiptValue) {
          throw new Error("CLI auth identity-receipt did not emit one JSON receipt.");
        }
      }
      authReceipt = parseFreshIntentBoundAuthReceipt(receiptValue, {
        nowMs: Date.now(),
        maxAgeMs: positiveIntegerOption(options.authReceiptMaxAgeMs, 300_000) ?? 300_000,
        expectedProjectRef,
        expectedUserId,
        sessionMode: ["access-token", "access_token"].includes(
          executionEnvironment.TIANGONG_LCA_AUTH_MODE ?? "",
        )
          ? "headless"
          : "oauth",
      });
    }
    const logDir = path.join(outDir, "logs");
    const resultRows: RunResultRow[] = [];
    const resultCacheDir = identityPreflightResultCacheDir(resolveRepoPath, executionEnvironment);

    selectedRows.forEach((row, selectedIndex) => {
      const datasetType = asText(row.dataset_type || row.type);
      const datasetId = asText(row.dataset_id || row.entity_id || row.id);
      const datasetVersion = asText(row.dataset_version || row.version) || "00.00.001";
      const requestFile = identityPreflightRunRequestFile(row);
      const outputDir = identityPreflightRunOutputDir(row);
      const reportFile = identityPreflightRunReportFile(row);
      const key = identityPreflightRunRowKey(row, selectedIndex);
      const logToken = safeFileToken(key, `row-${selectedIndex}`);
      const stdoutLog = path.join(logDir, `${logToken}.stdout.json`);
      const stderrLog = path.join(logDir, `${logToken}.stderr.log`);

      const cliArgs = [
        datasetType,
        "identity-preflight",
        "--input",
        requestFile!,
        "--out-dir",
        outputDir!,
        "--json",
        "--timeout-ms",
        String(timeoutMs),
      ];
      let baseRow: JsonRecord = {
        selected_index: selectedIndex,
        dataset_type: datasetType,
        dataset_id: datasetId,
        dataset_version: datasetVersion,
        request_file: repoRelativeMaybe(requestFile),
        output_dir: repoRelativeMaybe(outputDir),
        report_file: repoRelativeMaybe(reportFile),
        command: [cli.command, ...cli.args, ...cliArgs].map(shellQuote).join(" "),
        executable: cli.command,
        cli_package: cli.package,
        cli_args: cliArgs,
        command_spec:
          requestFile && fileExists(requestFile)
            ? createFoundryCommandSpec({
                executable: cli.command,
                argv: [...cli.args, ...cliArgs],
                binding: {
                  artifacts: [
                    createFileArtifactFact({
                      role: "identity_preflight_request",
                      path: repoRelativePath(requestFile),
                      filePath: requestFile,
                    }),
                  ],
                },
              })
            : null,
        stdout_log: repoRelativePath(stdoutLog),
        stderr_log: repoRelativePath(stderrLog),
      };

      const failRow = (failureCode: string): void => {
        resultRows.push({
          ...baseRow,
          status: "failed",
          failure_code: failureCode,
          cli_exit_code: null,
          report_status: null,
          decision: null,
        });
      };

      if (!datasetType || !["flow", "process"].includes(datasetType)) {
        failRow("identity_preflight_dataset_type_invalid");
        return;
      }
      if (!requestFile || !fileExists(requestFile)) {
        failRow("identity_preflight_request_missing");
        return;
      }
      if (!outputDir) {
        failRow("identity_preflight_output_dir_missing");
        return;
      }
      const requestText = fs.readFileSync(requestFile, "utf8");
      const requestBytesSha256 = sha256Text(requestText);
      if (row.request_bytes_sha256 && asText(row.request_bytes_sha256) !== requestBytesSha256) {
        failRow("identity_preflight_request_hash_drift");
        return;
      }
      let requestValue: IdentityPreflightReport;
      try {
        requestValue = JSON.parse(requestText) as IdentityPreflightReport;
      } catch {
        failRow("identity_preflight_request_non_json");
        return;
      }
      if (row.request_json_sha256 && asText(row.request_json_sha256) !== jsonSha256(requestValue)) {
        failRow("identity_preflight_request_json_hash_drift");
        return;
      }
      const requestTargetSha256 = jsonSha256(requestValue?.target);
      const declaredTargetSha256 = asText(row.target_sha256) || requestTargetSha256;
      if (declaredTargetSha256 !== requestTargetSha256) {
        failRow("identity_preflight_target_hash_drift");
        return;
      }
      const relevantInputHashes = {
        ...(row.relevant_input_hashes && typeof row.relevant_input_hashes === "object"
          ? row.relevant_input_hashes
          : {}),
      };
      const sourceFile = resolveRepoPath(row.source_file || row.sourceFile);
      if (sourceFile && fileExists(sourceFile)) {
        relevantInputHashes.source_file = sha256Text(fs.readFileSync(sourceFile, "utf8"));
      }
      const packageSpec = asText(cli.package);
      const packageAt = packageSpec.lastIndexOf("@");
      const packageName =
        packageAt > 0 ? packageSpec.slice(0, packageAt) : packageSpec || "cli-override";
      const packageVersion =
        asText(cli.package_version) ||
        (packageAt > 0 ? packageSpec.slice(packageAt + 1) : "override");
      const binPath = asText(cli.bin_path);
      const packageIntegrity =
        binPath && fileExists(binPath)
          ? `sha256-${sha256Text(fs.readFileSync(binPath, "utf8"))}`
          : null;
      let executionBinding: IdentityPreflightBinding;
      try {
        executionBinding = createIdentityPreflightBinding({
          datasetType,
          datasetId,
          datasetVersion,
          targetSha256: declaredTargetSha256,
          requestText,
          semanticArgv: [
            datasetType,
            "identity-preflight",
            "--json",
            "--timeout-ms",
            String(timeoutMs),
          ],
          cli: { packageName, packageVersion, packageIntegrity },
          authReceipt,
          relevantInputHashes,
        });
      } catch {
        failRow("identity_preflight_execution_binding_invalid");
        return;
      }
      const executionManifestFile = path.join(
        outputDir,
        "outputs",
        "foundry-identity-preflight-execution.json",
      );
      const resultCacheEntryDir = identityPreflightResultCacheEntryDir(
        resultCacheDir,
        executionBinding.binding_sha256,
      );
      baseRow = {
        ...baseRow,
        request_bytes_sha256: requestBytesSha256,
        binding_sha256: executionBinding.binding_sha256,
        execution_manifest_file: repoRelativeMaybe(executionManifestFile),
      };

      if (resultCacheEntryDir && reportFile && outputDir && !fileExists(reportFile)) {
        const cachedReportFile = path.join(resultCacheEntryDir, "identity-decision.json");
        const cachedManifestFile = path.join(
          resultCacheEntryDir,
          "foundry-identity-preflight-execution.json",
        );
        if (fileExists(cachedReportFile) && fileExists(cachedManifestFile)) {
          try {
            const cachedReportText = fs.readFileSync(cachedReportFile, "utf8");
            const cachedManifest = readJson(cachedManifestFile);
            if (
              validateBoundExecutionManifest(cachedManifest, executionBinding, cachedReportText).ok
            ) {
              const outputsDir = path.join(outputDir, "outputs");
              const restoredReport = JSON.parse(cachedReportText);
              if (!reusablePositiveIdentityReport(restoredReport)) {
                throw new Error("unsafe negative identity cache entry");
              }
              fs.mkdirSync(outputsDir, { recursive: true });
              fs.cpSync(resultCacheEntryDir, outputsDir, { recursive: true });
              resultRows.push({
                ...baseRow,
                status: "restored_from_bound_cache",
                cli_exit_code: null,
                report_status: restoredReport.status ?? null,
                decision: restoredReport.decision ?? null,
                result_cache_entry: repoRelativeMaybe(resultCacheEntryDir),
              });
              return;
            }
          } catch {
            // Invalid or racing cache entries are ignored and never become evidence.
          }
        }
      }

      if (
        onlyPending &&
        reportFile &&
        fileExists(reportFile) &&
        fileExists(executionManifestFile)
      ) {
        try {
          const existingReportText = fs.readFileSync(reportFile, "utf8");
          const existingManifest = readJson(executionManifestFile);
          if (
            validateBoundExecutionManifest(existingManifest, executionBinding, existingReportText)
              .ok
          ) {
            const existingReport = JSON.parse(existingReportText);
            if (!reusablePositiveIdentityReport(existingReport)) {
              throw new Error("negative identity evidence must be searched again");
            }
            resultRows.push({
              ...baseRow,
              status: "skipped_bound_execution",
              cli_exit_code: null,
              report_status: existingReport.status ?? null,
              decision: existingReport.decision ?? null,
            });
            return;
          }
        } catch {
          // Existing bytes without a valid exact binding must be executed again.
        }
      }
      if (dryRun) {
        resultRows.push({
          ...baseRow,
          status: "planned",
          attempts: 0,
          cli_exit_code: null,
          report_status: null,
          decision: null,
        });
        return;
      }

      const attemptRows: RunResultRow[] = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptSuffix = maxAttempts > 1 ? `.attempt-${attempt}` : "";
        const attemptStdoutLog =
          maxAttempts > 1
            ? path.join(logDir, `${logToken}${attemptSuffix}.stdout.json`)
            : stdoutLog;
        const attemptStderrLog =
          maxAttempts > 1 ? path.join(logDir, `${logToken}${attemptSuffix}.stderr.log`) : stderrLog;
        const spawnArgs = [...cli.args, ...cliArgs];
        const startedAtMs = Date.now();
        const result = spawnSync(cli.command, spawnArgs, {
          cwd: executionCwd ?? repoRoot,
          env: executionEnvironment,
          encoding: "utf8",
          // Mega-scope flows return large preflight payloads on stdout; the 1MB
          // spawnSync default overflows with ENOBUFS. Cap below V8's max string length.
          maxBuffer: 512 * 1024 * 1024,
          timeout: spawnTimeoutMs,
          killSignal: "SIGTERM",
        });
        writeText(attemptStdoutLog, result.stdout || "");
        writeText(attemptStderrLog, result.stderr || "");
        const timedOut =
          (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") ||
          result.signal === "SIGTERM";
        if (result.error && !timedOut) throw result.error;
        const cliExitCode = typeof result.status === "number" ? result.status : 1;
        const stdoutReport = parseJsonMaybe(result.stdout);
        const diskReportText =
          reportFile && fileExists(reportFile) ? fs.readFileSync(reportFile, "utf8") : null;
        const diskReport = parseJsonMaybe(diskReportText);
        const report = stdoutReport || diskReport;
        const executionValidation = timedOut
          ? null
          : validateIdentityPreflightExecution({
              binding: executionBinding,
              exitCode: cliExitCode,
              stdoutText: result.stdout || "",
              diskReportText,
              startedAtMs,
              diskReportMtimeMs:
                reportFile && fileExists(reportFile) ? fs.statSync(reportFile).mtimeMs : null,
              completedAtUtc: nowIso(),
              requestFile: requestFile ?? undefined,
              outputDir,
              reportFile: reportFile ?? undefined,
              stderrText: result.stderr || "",
              signal: result.signal,
            });
        if (executionValidation?.ok) {
          writeJson(executionManifestFile, executionValidation.manifest);
        }
        const sharedFields = {
          ...baseRow,
          attempt,
          attempts: attempt,
          stdout_log: repoRelativePath(attemptStdoutLog),
          stderr_log: repoRelativePath(attemptStderrLog),
          report_status: report?.status ?? null,
          decision: report?.decision ?? null,
          confidence: report?.confidence ?? null,
          next_action: report?.next_action ?? null,
          blocker_count: ensureArray(report?.blockers).length,
          candidate_count: ensureArray(report?.candidates).length,
          candidate_source_count: ensureArray(report?.candidate_sources).length,
        };
        const attemptRow = timedOut
          ? {
              ...sharedFields,
              status: "failed",
              failure_code: "identity_preflight_timeout",
              cli_exit_code: null,
              signal: result.signal ?? null,
              timeout_ms: timeoutMs,
              spawn_timeout_ms: spawnTimeoutMs,
            }
          : {
              ...sharedFields,
              status: executionValidation?.ok ? "completed" : "failed",
              failure_code: executionValidation?.ok
                ? null
                : executionValidation?.code || "identity_preflight_execution_invalid",
              cli_exit_code: cliExitCode,
            };
        attemptRows.push(attemptRow);
        if (!retriableIdentityPreflightFailure(attemptRow)) break;
      }
      const finalAttempt = attemptRows.at(-1);
      if (!finalAttempt) {
        throw new Error("Identity-preflight execution produced no attempt evidence.");
      }
      // Persist only a fully validated result under its complete execution binding.
      if (
        resultCacheEntryDir &&
        finalAttempt?.status === "completed" &&
        outputDir &&
        reportFile &&
        fileExists(reportFile) &&
        fs.existsSync(path.join(outputDir, "outputs")) &&
        fs.statSync(path.join(outputDir, "outputs")).isDirectory()
      ) {
        try {
          const cacheableReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
          if (!reusablePositiveIdentityReport(cacheableReport)) {
            throw new Error("negative identity evidence is not cacheable");
          }
          fs.mkdirSync(path.dirname(resultCacheEntryDir), { recursive: true });
          const tmpDir = `${resultCacheEntryDir}.tmp-${process.pid}-${selectedIndex}`;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fs.cpSync(path.join(outputDir, "outputs"), tmpDir, { recursive: true });
          if (fs.existsSync(resultCacheEntryDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } else {
            try {
              fs.renameSync(tmpDir, resultCacheEntryDir);
            } catch {
              fs.rmSync(tmpDir, { recursive: true, force: true });
            }
          }
        } catch {
          // Cache persistence is best-effort; never fail the import because of it.
        }
      }
      resultRows.push({
        ...finalAttempt,
        retry_attempts: attemptRows.map((attemptRow) => ({
          attempt: attemptRow.attempt,
          status: attemptRow.status,
          failure_code: attemptRow.failure_code ?? null,
          cli_exit_code: attemptRow.cli_exit_code,
          stdout_log: attemptRow.stdout_log,
          stderr_log: attemptRow.stderr_log,
        })),
      });
    });

    const failedRows = resultRows.filter((row) => row.status === "failed");
    const identityFindingRows = resultRows.filter((row) =>
      ["blocked", "needs_review"].includes(row.report_status ?? ""),
    );
    const blockers: JsonRecord[] = failedRows.map((row) => ({
      code: row.failure_code || "identity_preflight_run_failed",
      message: "Identity-preflight runner could not produce usable evidence for a selected row.",
      dataset_type: row.dataset_type || null,
      dataset_id: row.dataset_id || null,
      dataset_version: row.dataset_version || null,
      request_file: row.request_file || null,
      report_file: row.report_file || null,
      stdout_log: row.stdout_log || null,
      stderr_log: row.stderr_log || null,
    }));
    const status = dryRun
      ? "planned"
      : failedRows.length > 0
        ? "failed"
        : identityFindingRows.length > 0
          ? "completed_with_identity_findings"
          : "completed";
    const resultsPath = path.join(outDir, "identity-preflight-run-results.jsonl");
    const reportPath = path.join(outDir, "dataset-identity-preflight-run-report.json");
    writeJsonLines(resultsPath, resultRows);
    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status,
      command: "dataset-identity-preflight-run",
      index_file: repoRelativePath(indexPath),
      ...identityPreflightRunStageContract,
      runtime_options: {
        timeout_ms: timeoutMs,
        spawn_timeout_ms: spawnTimeoutMs,
        max_attempts: maxAttempts,
        result_cache_dir: repoRelativeMaybe(resultCacheDir),
        retry_failed:
          retryFailedPath && fileExists(retryFailedPath) ? repoRelativePath(retryFailedPath) : null,
        cli: {
          command: cli.display,
          executable: cli.command,
          args_prefix: cli.args,
          package: cli.package,
          source: cli.source,
        },
        auth_receipt: authReceipt
          ? {
              file: repoRelativeMaybe(authReceiptPath),
              project_ref: authReceipt.project.project_ref,
              user_id: authReceipt.identity.user_id,
              receipt_scope_sha256: authReceipt.receipt_scope_sha256,
            }
          : null,
      },
      counts: buildIdentityPreflightRunCounts({
        rows,
        initiallySelectedRows,
        retryFailedKeys,
        selectedRows,
        resultRows,
        failedRows,
        blockers,
      }),
      policy: {
        fail_closed_execution:
          "Nonzero CLI exits fail except the qualified CLI 0.1.28 complete, bound, error-free needs_review/manual_review exit 1 diagnostic. Missing/malformed or stale reports, stdout/disk mismatch, ok:false, failed/error status, execution signals/stderr and binding drift remain failures.",
        valid_identity_findings:
          "A blocked/needs_review report remains scientific diagnostic evidence only with a valid execution manifest; the pinned manual-review exit 1 contract does not resolve identity or grant a write.",
        curation_gate_usage:
          "Pass this same index to dataset-curation-gate with --identity-preflight-index so authoring packages include current and dependency identity-preflight context.",
      },
      files: {
        report: repoRelativePath(reportPath),
        results: repoRelativePath(resultsPath),
      },
      blockers,
      results: resultRows,
    };
    writeJson(reportPath, report);
    return report;
  }

  return {
    identityPreflightRunIndexPath,
    identityPreflightRunReportFile,
    runDatasetIdentityPreflightIndexMerge,
    runDatasetIdentityPreflightQueryAudit,
    runDatasetIdentityPreflightRequestsBuild,
    runDatasetIdentityPreflightRun,
  };
}
