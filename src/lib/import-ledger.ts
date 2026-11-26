import fs from "node:fs";
import path from "node:path";
import {
  appendJsonLinesDedup,
  blockerBucket,
  ensureDir,
  humanActionForBlocker,
  inferRowDatasetType,
  isJsonRecord,
  latestByKey,
  normalizedBlockerInputs,
  readJsonLinesIfExists,
  rowPayload,
  rowsFromValue,
  sha256,
  supportPluralForType,
  writeJsonLinesFile,
} from "./import-ledger-helpers.ts";
import {
  type AppendJsonLinesResult,
  BLOCKER_BUCKETS,
  type BlockedDependencyImportLedgerRow,
  type BlockedScopeImportLedgerRow,
  type CloseoutLedgerWriteOptions,
  type CloseoutReport,
  type DatasetImportLedgerHelpReport,
  type DatasetImportLedgerReport,
  type DatasetImportLedgerReportOptions,
  type FinalizeArtifactFiles,
  type FinalizeLedgerWriteOptions,
  type FinalizeReport,
  type ImportLedgerDependencies,
  type ImportLedgerManifest,
  type ImportLedgerUtils,
  type ImportLedgerWriteResult,
  type JsonValue,
  LEDGER_FILES,
  type ManifestUpdateOptions,
  type ResumePendingImportLedgerRow,
  type ResumeSkippedImportLedgerRow,
  type RetryImportLedgerRow,
  type RowIdentity,
  type VerifiedImportLedgerRow,
} from "./import-ledger-types.ts";

export type {
  BlockedCloseoutReport,
  BlockedDependencyImportLedgerRow,
  BlockedFinalizeReport,
  BlockedScopeImportLedgerRow,
  BlockerBucket,
  BlockingDependency,
  CloseoutLedgerWriteOptions,
  CloseoutReport,
  CompletedCloseoutReport,
  CompletedImportLedgerWriteResult,
  DatasetIdentity,
  DatasetImportLedgerHelpReport,
  DatasetImportLedgerReport,
  DatasetImportLedgerReportOptions,
  FinalizeArtifactFiles,
  FinalizeLedgerWriteOptions,
  FinalizeReport,
  ImportLedgerBlocker,
  ImportLedgerDependencies,
  ImportLedgerManifest,
  ImportLedgerRow,
  ImportLedgerUtils,
  ImportLedgerWriteResult,
  JsonPrimitive,
  JsonRecord,
  JsonValue,
  LedgerDatasetType,
  LedgerWriteCounts,
  ReadyFinalizeReport,
  ResumePendingImportLedgerRow,
  ResumeSkippedImportLedgerRow,
  RetryImportLedgerRow,
  SkippedImportLedgerWriteResult,
  VerifiedImportLedgerRow,
} from "./import-ledger-types.ts";

export function createImportLedgerUtils({
  asText,
  datasetIdentity,
  fileExists,
  nowIso,
  readJson,
  readJsonLines,
  repoRelativePath,
  resolveRepoPath,
  writeJson,
}: ImportLedgerDependencies): ImportLedgerUtils {
  function relativeInput(value: unknown): string | null {
    const resolved = resolveRepoPath(value);
    return resolved ? repoRelativePath(resolved) : null;
  }

  function readRowsFileMaybe(filePath: unknown): JsonValue[] {
    const resolved = resolveRepoPath(filePath);
    if (!resolved || !fileExists(resolved)) return [];
    if (resolved.toLowerCase().endsWith(".jsonl")) return readJsonLines(resolved);
    return rowsFromValue(readJson(resolved));
  }

  function rowIdentity(row: JsonValue, fallbackType: unknown): RowIdentity {
    const payload = rowPayload(row);
    const datasetType = inferRowDatasetType(payload, fallbackType);
    const identity =
      datasetType && datasetType !== "support" ? datasetIdentity(payload, datasetType) : {};
    const rowRecord = isJsonRecord(row) ? row : {};
    return {
      payload,
      dataset_type: datasetType,
      dataset_id:
        identity.id ||
        asText(rowRecord.dataset_id) ||
        asText(rowRecord.id) ||
        asText(rowRecord.entity_id) ||
        null,
      version: identity.version || asText(rowRecord.version) || null,
      payload_hash: sha256(JSON.stringify(payload ?? row ?? null)),
    };
  }

  function updateManifest({
    ledgerDir,
    eventKind,
    files = {},
    reportPath = null,
  }: ManifestUpdateOptions): string {
    ensureDir(ledgerDir);
    const manifestPath = path.join(ledgerDir, LEDGER_FILES.manifest);
    const previous = (
      fs.existsSync(manifestPath) ? readJson(manifestPath) : {}
    ) as Partial<ImportLedgerManifest>;
    const previousEventKinds = previous.event_kinds ?? [];
    const previousFiles = previous.files ?? {};
    const manifest: ImportLedgerManifest = {
      schema_version: 1,
      created_at_utc: previous.created_at_utc ?? nowIso(),
      updated_at_utc: nowIso(),
      ledger_dir: repoRelativePath(ledgerDir),
      event_kinds: [...new Set([...previousEventKinds, eventKind].filter(Boolean))],
      latest_report: reportPath ? repoRelativePath(reportPath) : (previous.latest_report ?? null),
      files: {
        ...previousFiles,
        ...Object.fromEntries(
          Object.entries(files)
            .filter(([, file]) => file)
            .map(([key, file]) => [key, repoRelativePath(file!)]),
        ),
      },
      contract: {
        ok_prefix: "ok.*.verified.jsonl",
        blocked_prefix: "blocked.*.jsonl",
        retry_prefix: "retry.*.jsonl",
        resume_prefix: "resume.*.jsonl",
        append_only: true,
        dedup_key: "ledger_key",
      },
    };
    writeJson(manifestPath, manifest);
    return manifestPath;
  }

  function writeCloseoutImportLedger(options: CloseoutLedgerWriteOptions): ImportLedgerWriteResult {
    const { reportPath, ledgerDir } = options;
    const report = options.report as CloseoutReport | null;
    if (!ledgerDir || !report) {
      return {
        status: "skipped",
        reason: !ledgerDir ? "ledger_dir_missing" : "report_missing",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    if (report.status !== "completed") {
      const blockerInputs = normalizedBlockerInputs(report.blockers);
      const blockers = blockerInputs.map(({ blocker }) => blocker);
      if (blockers.length === 0) {
        return {
          status: "skipped",
          reason: "closeout_not_completed_without_blockers",
          files: {},
          counts: { entries_written: 0 },
        };
      }
      const generatedAt = nowIso();
      const rowIdentities = readRowsFileMaybe(report.final_rows_file).map((row) =>
        rowIdentity(row, report.dataset_type),
      );
      const scopeKey = `${report.dataset_type ?? "unknown"}:${relativeInput(report.final_rows_file) ?? repoRelativePath(reportPath)}`;
      const scopeIds = rowIdentities
        .map((identity) => identity.dataset_id)
        .filter((value): value is string => Boolean(value));
      const scopeVersions = rowIdentities
        .map((identity) => identity.version)
        .filter((value): value is string => Boolean(value));
      const blockerCodes = blockers
        .map((blocker) => blocker.code)
        .filter((value): value is string => Boolean(value));
      const uniqueBlockerCodes = [...new Set(blockerCodes)];
      const summaryRow: BlockedScopeImportLedgerRow = {
        schema_version: 1,
        ledger_kind: "blocked",
        status: "blocked_human_review",
        blocked_at_utc: generatedAt,
        scope_dataset_type: report.dataset_type ?? null,
        profile: report.profile ?? null,
        scope_ids: [...new Set(scopeIds)],
        scope_versions: [...new Set(scopeVersions)],
        scope_key: scopeKey,
        blocker_codes: uniqueBlockerCodes,
        blocker_count: blockers.length,
        required_human_action:
          "Repair the commit/readback/account guard blocker for this exact final rows scope, then rerun post-write verification and closeout.",
        final_rows_file: relativeInput(report.final_rows_file),
        finalize_report: relativeInput(report.finalize_report),
        mutation_manifest: relativeInput(report.mutation_manifest),
        closeout_report: repoRelativePath(reportPath),
        rerun_command: `node src/dev-cli.ts dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <commit-report.json> --post-write-verify-report <remote-verification-report.json> --ledger-dir ${repoRelativePath(ledgerDir)}`,
        ledger_key: `blocked:closeout:${scopeKey}:${sha256(
          JSON.stringify(uniqueBlockerCodes),
        )}:${repoRelativePath(reportPath)}`,
      };
      const dependencyRows: BlockedDependencyImportLedgerRow[] = blockerInputs.map(
        ({ blocker, raw }, index) => {
          const bucket =
            blockerBucket(blocker) === "other" ? "remote-write" : blockerBucket(blocker);
          const reasonCode = blocker.code ?? "closeout_blocker";
          return {
            schema_version: 1,
            ledger_kind: "blocked",
            status: "blocked_human_review",
            blocked_at_utc: generatedAt,
            blocker_bucket: bucket,
            reason_code: reasonCode,
            message: blocker.message ?? null,
            blocking_stage: "post_write_closeout",
            scope_dataset_type: report.dataset_type ?? null,
            scope_ids: summaryRow.scope_ids,
            scope_key: summaryRow.scope_key,
            blocking_dependency: {
              dataset_type: blocker.dataset_type ?? null,
              id: blocker.reference_id || blocker.entity_id || blocker.id || null,
              version: blocker.reference_version || blocker.version || null,
              path: blocker.path ?? null,
            },
            required_human_action: humanActionForBlocker({
              ...blocker,
              code: blocker.code ?? "remote_write_blocker",
            }),
            final_rows_file: summaryRow.final_rows_file,
            closeout_report: repoRelativePath(reportPath),
            raw_blocker: raw,
            ledger_key: `blocked:closeout-dependency:${bucket}:${reasonCode}:${summaryRow.scope_key}:${index}:${repoRelativePath(reportPath)}`,
          };
        },
      );
      const writes: AppendJsonLinesResult[] = [
        appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.blockedScopes), [summaryRow]),
      ];
      for (const bucket of BLOCKER_BUCKETS) {
        const bucketRows = dependencyRows.filter((row) => row.blocker_bucket === bucket);
        if (bucketRows.length === 0) continue;
        writes.push(
          appendJsonLinesDedup(
            path.join(ledgerDir, `blocked.dependencies.${bucket}.jsonl`),
            bucketRows,
          ),
        );
      }
      const manifestPath = updateManifest({
        ledgerDir,
        eventKind: "post_write_closeout_blocked",
        files: { blocked_scopes: path.join(ledgerDir, LEDGER_FILES.blockedScopes) },
        reportPath,
      });
      return {
        status: "completed",
        files: {
          manifest: repoRelativePath(manifestPath),
          blocked_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.blockedScopes)),
        },
        counts: {
          blockers: blockers.length,
          blocked_scopes: 1,
          entries_written: writes.reduce((total, write) => total + write.appended, 0),
          entries_skipped_existing: writes.reduce(
            (total, write) => total + write.skipped_existing,
            0,
          ),
        },
      };
    }
    const rows = readRowsFileMaybe(report.final_rows_file);
    const generatedAt = nowIso();
    const common = {
      schema_version: 1 as const,
      ledger_kind: "ok" as const,
      status: "verified" as const,
      verified_at_utc: generatedAt,
      scope_dataset_type: report.dataset_type ?? null,
      profile: report.profile ?? null,
      target_user_id: report.target_user_id ?? null,
      expected_state_code: report.expected_state_code ?? null,
      final_rows_file: relativeInput(report.final_rows_file),
      finalize_report: relativeInput(report.finalize_report),
      mutation_manifest: relativeInput(report.mutation_manifest),
      commit_report: relativeInput(report.commit_report),
      post_write_verify_report: relativeInput(report.post_write_verify_report),
      closeout_report: repoRelativePath(reportPath),
      root_payload_mismatches: Number(report.counts?.root_payload_mismatches ?? -1),
    };
    const ledgerRows: VerifiedImportLedgerRow[] = rows.map((row, index) => {
      const identity = rowIdentity(row, report.dataset_type);
      const datasetKey = `${identity.dataset_type}:${identity.dataset_id ?? "missing"}:${identity.version ?? "missing"}`;
      return {
        ...common,
        row_index: index,
        row_dataset_type: identity.dataset_type,
        dataset_id: identity.dataset_id,
        version: identity.version,
        payload_hash: identity.payload_hash,
        dataset_key: datasetKey,
        scope_key: `${report.dataset_type ?? identity.dataset_type}:${common.final_rows_file ?? datasetKey}`,
        ledger_key: `ok:${datasetKey}:${identity.payload_hash}:${repoRelativePath(reportPath)}`,
      };
    });
    const writes: AppendJsonLinesResult[] = [];
    writes.push(appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.okScopes), ledgerRows));
    for (const [datasetType, typeRows] of Map.groupBy(
      ledgerRows,
      (row) => row.row_dataset_type || "unknown",
    )) {
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, `ok.${supportPluralForType(datasetType)}.verified.jsonl`),
          typeRows,
        ),
      );
    }
    const files = Object.fromEntries(
      writes.map((write) => [path.basename(write.file).replace(/[.-]/gu, "_"), write.file]),
    );
    const manifestPath = updateManifest({
      ledgerDir,
      eventKind: "post_write_closeout_verified",
      files: { ...files, ok_scopes: path.join(ledgerDir, LEDGER_FILES.okScopes) },
      reportPath,
    });
    return {
      status: "completed",
      files: {
        manifest: repoRelativePath(manifestPath),
        ok_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.okScopes)),
      },
      counts: {
        rows: rows.length,
        entries_written: writes.reduce((total, write) => total + write.appended, 0),
        entries_skipped_existing: writes.reduce(
          (total, write) => total + write.skipped_existing,
          0,
        ),
      },
    };
  }

  function writeFinalizeImportLedger(options: FinalizeLedgerWriteOptions): ImportLedgerWriteResult {
    const { reportPath, ledgerDir } = options;
    const report = options.report as FinalizeReport | null;
    if (
      !ledgerDir ||
      !report ||
      report.status === "ready_for_remote_write" ||
      report.status === "ready_reference_only"
    ) {
      return {
        status: "skipped",
        reason: !ledgerDir ? "ledger_dir_missing" : "finalize_ready",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    const blockerInputs = normalizedBlockerInputs(report.blockers);
    const blockers = blockerInputs.map(({ blocker }) => blocker);
    if (blockers.length === 0) {
      return {
        status: "skipped",
        reason: "no_blockers",
        files: {},
        counts: { entries_written: 0 },
      };
    }
    const rows = readRowsFileMaybe(report.final_rows_file || report.rows_file);
    const rowIdentities = rows.map((row) => rowIdentity(row, report.dataset_type));
    const scopeIds = rowIdentities
      .map((identity) => identity.dataset_id)
      .filter((value): value is string => Boolean(value));
    const scopeVersions = rowIdentities
      .map((identity) => identity.version)
      .filter((value): value is string => Boolean(value));
    const blockerCodes = blockers
      .map((blocker) => blocker.code)
      .filter((value): value is string => Boolean(value));
    const generatedAt = nowIso();
    const reportFiles = report.files as FinalizeArtifactFiles | undefined;
    const scopeKey = `${report.dataset_type ?? "unknown"}:${relativeInput(report.final_rows_file || report.rows_file) ?? sha256(JSON.stringify(scopeIds))}`;
    const uniqueBlockerCodes = [...new Set(blockerCodes)];
    const summaryRow: BlockedScopeImportLedgerRow = {
      schema_version: 1,
      ledger_kind: "blocked",
      status: "blocked_human_review",
      blocked_at_utc: generatedAt,
      scope_dataset_type: report.dataset_type ?? null,
      profile: report.profile ?? null,
      scope_ids: [...new Set(scopeIds)],
      scope_versions: [...new Set(scopeVersions)],
      scope_key: scopeKey,
      blocker_codes: uniqueBlockerCodes,
      blocker_count: blockers.length,
      required_human_action:
        "Repair the listed blocker dependencies or content fields, then rerun only this affected scope. Verified scopes in ok.* ledgers should be skipped.",
      final_rows_file: relativeInput(report.final_rows_file || report.rows_file),
      finalize_report: repoRelativePath(reportPath),
      curation_gate_report: relativeInput(reportFiles?.curation_gate_report),
      mutation_manifest: relativeInput(reportFiles?.mutation_manifest),
      commit_handoff_plan: relativeInput(reportFiles?.commit_handoff_plan),
      rerun_command: `node src/dev-cli.ts dataset-post-authoring-finalize --rows-file ${relativeInput(report.rows_file) ?? "<rows.jsonl>"} --type ${report.dataset_type ?? "<type>"} --out-dir <finalize-dir>`,
      ledger_key: `blocked:scope:${scopeKey}:${sha256(
        JSON.stringify(uniqueBlockerCodes),
      )}:${repoRelativePath(reportPath)}`,
    };

    const dependencyRows: BlockedDependencyImportLedgerRow[] = blockerInputs.map(
      ({ blocker, raw }, index) => {
        const bucket = blockerBucket(blocker);
        const reasonCode = blocker.code ?? "unknown_blocker";
        return {
          schema_version: 1,
          ledger_kind: "blocked",
          status: "blocked_human_review",
          blocked_at_utc: generatedAt,
          blocker_bucket: bucket,
          reason_code: reasonCode,
          message: blocker.message ?? null,
          blocking_stage: blocker.stage ?? null,
          scope_dataset_type: report.dataset_type ?? null,
          scope_ids: summaryRow.scope_ids,
          scope_key: summaryRow.scope_key,
          blocking_dependency: {
            dataset_type:
              blocker.blocking_dependency?.dataset_type ||
              blocker.dataset_type ||
              blocker.reference_type ||
              blocker.table ||
              null,
            id:
              blocker.blocking_dependency?.id ||
              blocker.reference_id ||
              blocker.entity_id ||
              blocker.id ||
              null,
            version:
              blocker.blocking_dependency?.version ||
              blocker.reference_version ||
              blocker.version ||
              null,
            path: blocker.path ?? null,
          },
          required_human_action: humanActionForBlocker(blocker),
          final_rows_file: summaryRow.final_rows_file,
          finalize_report: repoRelativePath(reportPath),
          mutation_manifest: summaryRow.mutation_manifest,
          raw_blocker: raw,
          ledger_key: `blocked:dependency:${bucket}:${reasonCode}:${summaryRow.scope_key}:${index}:${repoRelativePath(reportPath)}`,
        };
      },
    );

    const writes: AppendJsonLinesResult[] = [
      appendJsonLinesDedup(path.join(ledgerDir, LEDGER_FILES.blockedScopes), [summaryRow]),
    ];
    for (const bucket of BLOCKER_BUCKETS) {
      const bucketRows = dependencyRows.filter((row) => row.blocker_bucket === bucket);
      if (bucketRows.length === 0) continue;
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, `blocked.dependencies.${bucket}.jsonl`),
          bucketRows,
        ),
      );
    }
    const identityRetryRows = dependencyRows.filter(
      (row) =>
        row.blocker_bucket === "identity" &&
        /(timeout|429|network|rate)/iu.test(`${row.reason_code} ${row.message ?? ""}`),
    );
    if (identityRetryRows.length > 0) {
      writes.push(
        appendJsonLinesDedup(
          path.join(ledgerDir, "retry.identity-failed.jsonl"),
          identityRetryRows,
        ),
      );
    }
    const files = Object.fromEntries(
      writes.map((write) => [path.basename(write.file).replace(/[.-]/gu, "_"), write.file]),
    );
    const manifestPath = updateManifest({
      ledgerDir,
      eventKind: "post_authoring_finalize_blocked",
      files: { ...files, blocked_scopes: path.join(ledgerDir, LEDGER_FILES.blockedScopes) },
      reportPath,
    });
    return {
      status: "completed",
      files: {
        manifest: repoRelativePath(manifestPath),
        blocked_scopes: repoRelativePath(path.join(ledgerDir, LEDGER_FILES.blockedScopes)),
      },
      counts: {
        blockers: blockers.length,
        blocked_scopes: 1,
        entries_written: writes.reduce((total, write) => total + write.appended, 0),
        entries_skipped_existing: writes.reduce(
          (total, write) => total + write.skipped_existing,
          0,
        ),
      },
    };
  }

  function runDatasetImportLedgerReport(
    options: DatasetImportLedgerReportOptions,
  ): DatasetImportLedgerHelpReport | DatasetImportLedgerReport {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-import-ledger-report",
        usage: [
          "node src/dev-cli.ts dataset-import-ledger-report --ledger-dir .foundry/workspaces/<task-id>/import-ledger --out-dir .foundry/workspaces/<task-id>/import-ledger",
        ],
        purpose:
          "Build a read-only resume report from append-only ok/blocked/retry import ledgers. It never writes the database.",
        remote_write_mode: "read-only",
      };
    }
    const ledgerDir = resolveRepoPath(options.ledgerDir || options.importLedgerDir);
    if (!ledgerDir || !fs.existsSync(ledgerDir) || !fs.statSync(ledgerDir).isDirectory()) {
      throw new Error("--ledger-dir is required and must point to an import ledger directory.");
    }
    const outDir = resolveRepoPath(options.outDir || ledgerDir);
    ensureDir(outDir!);
    const okScopePath = path.join(ledgerDir, LEDGER_FILES.okScopes);
    const okRows: VerifiedImportLedgerRow[] = fs.existsSync(okScopePath)
      ? readJsonLinesIfExists<VerifiedImportLedgerRow>(okScopePath)
      : fs
          .readdirSync(ledgerDir)
          .filter((name) => /^ok\..*\.verified\.jsonl$/u.test(name))
          .flatMap((name) =>
            readJsonLinesIfExists<VerifiedImportLedgerRow>(path.join(ledgerDir, name)),
          );
    const blockedScopeRows = readJsonLinesIfExists<BlockedScopeImportLedgerRow>(
      path.join(ledgerDir, LEDGER_FILES.blockedScopes),
    );
    const blockedDependencyRows = fs
      .readdirSync(ledgerDir)
      .filter((name) => /^blocked\.dependencies\..*\.jsonl$/u.test(name))
      .flatMap((name) =>
        readJsonLinesIfExists<BlockedDependencyImportLedgerRow>(path.join(ledgerDir, name)),
      );
    const blockedRows = [...blockedScopeRows, ...blockedDependencyRows];
    const retryRows = fs
      .readdirSync(ledgerDir)
      .filter((name) => /^(?:retry\..*|failed\..*\.retry)\.jsonl$/u.test(name))
      .flatMap((name) => readJsonLinesIfExists<RetryImportLedgerRow>(path.join(ledgerDir, name)));
    const verifiedKeys = new Set<string>(
      okRows
        .map((row) => row.dataset_key || `${row.row_dataset_type}:${row.dataset_id}:${row.version}`)
        .filter(Boolean),
    );
    const latestBlockedScopes = latestByKey(blockedScopeRows, (row) => row.scope_key);
    const resumeRows = latestBlockedScopes
      .filter((row) => {
        const keys = Array.isArray(row.scope_ids)
          ? row.scope_ids.map(
              (id) => `${row.scope_dataset_type}:${id}:${row.scope_versions?.[0] ?? "missing"}`,
            )
          : [];
        return keys.length === 0 || keys.some((key) => !verifiedKeys.has(key));
      })
      .map<ResumePendingImportLedgerRow>((row) => ({
        schema_version: 1,
        ledger_kind: "resume",
        status: "pending_human_review",
        source_ledger_key: row.ledger_key ?? null,
        scope_key: row.scope_key ?? null,
        scope_dataset_type: row.scope_dataset_type ?? null,
        scope_ids: row.scope_ids ?? [],
        blocker_codes: row.blocker_codes ?? [],
        blocker_count: row.blocker_count ?? null,
        required_human_action: row.required_human_action ?? null,
        final_rows_file: row.final_rows_file ?? null,
        finalize_report: row.finalize_report ?? null,
        rerun_command: row.rerun_command ?? null,
      }));
    const skippedRows = latestByKey(okRows, (row) => row.dataset_key || row.ledger_key).map(
      (row): ResumeSkippedImportLedgerRow => ({
        schema_version: 1,
        ledger_kind: "resume",
        status: "skipped_verified",
        source_ledger_key: row.ledger_key ?? null,
        dataset_key: row.dataset_key ?? null,
        row_dataset_type: row.row_dataset_type ?? null,
        dataset_id: row.dataset_id ?? null,
        version: row.version ?? null,
        verified_at_utc: row.verified_at_utc ?? null,
        closeout_report: row.closeout_report ?? null,
      }),
    );
    const resumePath = path.join(outDir!, LEDGER_FILES.resumePlan);
    const skippedPath = path.join(outDir!, LEDGER_FILES.resumeSkipped);
    writeJsonLinesFile(resumePath, resumeRows);
    writeJsonLinesFile(skippedPath, skippedRows);
    const reportPath = path.join(outDir!, LEDGER_FILES.report);
    const report: DatasetImportLedgerReport = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      status: resumeRows.length > 0 ? "completed_with_blocked_scopes" : "completed",
      ledger_dir: repoRelativePath(ledgerDir),
      remote_write_mode: "read-only",
      policy: {
        resume_boundary:
          "The ledger report is read-only. Verified scopes are skipped; blocked scopes remain pending until human/database governance repairs their dependencies and reruns only affected scopes.",
      },
      counts: {
        ok_rows: okRows.length,
        blocked_rows: blockedRows.length,
        retry_rows: retryRows.length,
        resume_rows: resumeRows.length,
        skipped_verified_rows: skippedRows.length,
      },
      files: {
        report: repoRelativePath(reportPath),
        resume_plan: repoRelativePath(resumePath),
        resume_skipped_verified: repoRelativePath(skippedPath),
      },
    };
    writeJson(reportPath, report);
    updateManifest({
      ledgerDir,
      eventKind: "ledger_report",
      files: { report: reportPath, resume_plan: resumePath, resume_skipped_verified: skippedPath },
      reportPath,
    });
    return report;
  }

  return {
    runDatasetImportLedgerReport,
    writeCloseoutImportLedger,
    writeFinalizeImportLedger,
  };
}
