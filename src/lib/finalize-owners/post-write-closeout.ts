import path from "node:path";
import { createFileArtifactFact, type FoundryArtifactFact } from "../foundry-command-spec.ts";
import { normalizeAllowedTraceHashDifference } from "../remote-verification-accepted-diff.ts";
import { canonicalPayloadSha256, validateUniqueRootReadbacks } from "../post-write-root-proof.ts";
import type { IntendedRoot, RootReadbackCheck } from "../post-write-root-proof.ts";
import { validateReferenceIntentReadback } from "./reference-intent-closeout.ts";
import {
  createPostWriteCloseoutValidators,
  isJsonRecord,
  type JsonRecord,
  type PostWriteCloseoutFactoryDependencies,
  type PostWriteCloseoutOptions,
  type ReportValue,
  rootTypeAndTable,
} from "./post-write-closeout-helpers.ts";

export type {
  PostWriteCloseoutFactoryDependencies,
  PostWriteCloseoutOptions,
} from "./post-write-closeout-helpers.ts";

export function createPostWriteCloseoutCommands(deps: PostWriteCloseoutFactoryDependencies) {
  const {
    executionEnvironment = process.env,
    asText,
    countRowsFile,
    datasetIdentity,
    ensureArray,
    fileExists,
    fullContextProofCheck,
    readJsonArtifactOption,
    readJsonLines,
    readRowsFile,
    repoRelativeMaybe,
    repoRelativePath,
    reportInputPath,
    resolveRepoPath,
    sameResolvedPath,
    writeCloseoutImportLedger,
    writeJson,
  } = deps;
  const {
    validateCommitReportForCloseout,
    validateTraceQueuesForCloseout,
    buildPostWriteCloseoutReportPayload,
  } = createPostWriteCloseoutValidators(deps);

  function validatePostWriteVerifyForCloseout({
    verifyReport,
    handoffPlan,
    verifyReportPath,
    finalRowsFile,
    expectedRows,
    targetUserId,
    expectedStateCode,
    intendedRoots,
    allowTraceHashOnlyNormalization,
    blockers,
  }: {
    verifyReport: ReportValue;
    handoffPlan?: ReportValue;
    verifyReportPath: string;
    finalRowsFile: string;
    expectedRows: number;
    targetUserId: string;
    expectedStateCode: number | null;
    intendedRoots: IntendedRoot[];
    allowTraceHashOnlyNormalization: boolean;
    blockers: JsonRecord[];
  }): {
    referenceArtifacts?: FoundryArtifactFact[];
    checksFile: string | null;
    readbackChecks: RootReadbackCheck[];
    uniqueReadbackCount: number;
  } {
    let referenceArtifacts: FoundryArtifactFact[] = [];
    try {
      referenceArtifacts = validateReferenceIntentReadback({
        handoff: handoffPlan ?? {},
        report: verifyReport,
        rowsFile: finalRowsFile,
        datasetType: asText(handoffPlan?.dataset_type),
        targetUserId,
        resolveFile: resolveRepoPath,
        relativePath: repoRelativePath,
      });
    } catch {
      blockers.push({
        code: "reference_intent_evidence_invalid",
        message:
          "Post-write verification must retain the same current consumer, intent, precommit and review evidence as its handoff.",
      });
    }
    const inputPath = resolveRepoPath(reportInputPath(verifyReport));
    const counts = verifyReport.counts ?? {};
    const blockerCount = Number(
      counts.blockers ?? (Array.isArray(verifyReport.blockers) ? verifyReport.blockers.length : 0),
    );
    const rootReadbackCount = Number(counts.root_readback_checks ?? 0);
    const rootPayloadMismatches = Number(counts.root_payload_mismatches ?? -1);

    if (!inputPath || !sameResolvedPath(inputPath, finalRowsFile)) {
      blockers.push({
        code: "post_write_verify_input_mismatch",
        message: "Post-write verification input must match the handoff final rows file.",
        post_write_verify_report: repoRelativePath(verifyReportPath),
        expected_input: repoRelativeMaybe(finalRowsFile),
        actual_input: inputPath ? repoRelativeMaybe(inputPath) : null,
      });
    }
    if (verifyReport.status !== "passed_remote_verification") {
      blockers.push({
        code: "post_write_verify_not_passed",
        message: `Post-write verification status is ${verifyReport.status ?? "missing"}.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }
    if (
      !Number.isFinite(blockerCount) ||
      blockerCount !== 0 ||
      ensureArray(verifyReport.blockers).length > 0
    ) {
      blockers.push({
        code: "post_write_verify_blockers_present",
        message: `Post-write verification contains ${Number.isFinite(blockerCount) ? blockerCount : "unknown"} blockers.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }
    if (
      !Number.isFinite(rootReadbackCount) ||
      rootReadbackCount !== expectedRows ||
      expectedRows <= 0
    ) {
      blockers.push({
        code: "post_write_verify_root_readback_incomplete",
        message: `Post-write verification has ${Number.isFinite(rootReadbackCount) ? rootReadbackCount : "unknown"} root readback checks; expected exactly ${expectedRows}.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }
    if (!Number.isFinite(rootPayloadMismatches) || rootPayloadMismatches !== 0) {
      blockers.push({
        code: "post_write_verify_payload_mismatch",
        message: `Post-write verification root payload mismatches: ${Number.isFinite(rootPayloadMismatches) ? rootPayloadMismatches : "missing"}.`,
        post_write_verify_report: repoRelativePath(verifyReportPath),
      });
    }

    const checksFile = resolveRepoPath(verifyReport.files?.checks);
    if (!checksFile || !fileExists(checksFile)) {
      blockers.push({
        code: "post_write_verify_checks_missing",
        message:
          "Post-write closeout requires the remote-verification.jsonl checks file to prove --compare-root-payload hashes.",
        post_write_verify_report: repoRelativePath(verifyReportPath),
        checks_file: verifyReport.files?.checks ?? null,
      });
      return { checksFile: null, readbackChecks: [], uniqueReadbackCount: 0 };
    }

    const checks = readJsonLines(checksFile) as RootReadbackCheck[];
    const readbackChecks = checks.filter(
      (check) => check?.role === "root" && String(check?.path ?? "").endsWith("#readback"),
    );
    if (readbackChecks.length !== expectedRows) {
      blockers.push({
        code: "post_write_verify_readback_check_rows_missing",
        message: `Post-write check file contains ${readbackChecks.length} root readback checks; expected exactly ${expectedRows}.`,
        checks_file: repoRelativePath(checksFile),
      });
    }

    for (const check of readbackChecks) {
      const localHash = asText(check.local_payload_sha256);
      const remoteHash = asText(check.remote_payload_sha256);
      if (check.status !== "ok") {
        blockers.push({
          code: "post_write_verify_readback_check_not_ok",
          message: `Readback check for ${check.table}:${check.id}@${check.version} is ${check.status ?? "missing"}.`,
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
        });
      }
      if (!localHash || !remoteHash || localHash !== remoteHash) {
        blockers.push({
          code: "post_write_verify_compare_root_payload_not_proven",
          message:
            "Readback check is missing equal local/remote payload hashes, so --compare-root-payload was not proven.",
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
          table: check.table ?? null,
          id: check.id ?? null,
        });
      }
      if (targetUserId && check.remote_user_id !== targetUserId) {
        blockers.push({
          code: "post_write_verify_owner_not_proven",
          message: `Readback owner ${check.remote_user_id ?? "missing"} does not match ${targetUserId}.`,
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
        });
      }
      if (expectedStateCode !== null && Number(check.remote_state_code) !== expectedStateCode) {
        blockers.push({
          code: "post_write_verify_state_code_not_proven",
          message: `Readback state_code ${check.remote_state_code ?? "missing"} does not match ${expectedStateCode}.`,
          checks_file: repoRelativePath(checksFile),
          row_index: check.row_index ?? null,
        });
      }
    }
    const uniqueProof = validateUniqueRootReadbacks({
      intended: intendedRoots,
      checks: readbackChecks,
      targetUserId,
      expectedStateCode: expectedStateCode as number,
      allowTraceHashOnlyNormalization,
    });
    blockers.push(...uniqueProof.blockers);

    return {
      checksFile,
      readbackChecks,
      uniqueReadbackCount: uniqueProof.uniqueReadbackCount,
      ...(referenceArtifacts.length ? { referenceArtifacts } : {}),
    };
  }

  function validateHandoffFinalRowsArtifact({
    handoffPlan,
    finalRowsFile,
    blockers,
  }: {
    handoffPlan: ReportValue;
    finalRowsFile: string;
    blockers: JsonRecord[];
  }): FoundryArtifactFact | null {
    const artifact = handoffPlan.final_rows_artifact;
    if (
      !artifact ||
      !isJsonRecord(artifact) ||
      typeof artifact.path !== "string" ||
      !Number.isSafeInteger(artifact.bytes) ||
      Number(artifact.bytes) < 0 ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256)
    ) {
      blockers.push({
        code: "handoff_final_rows_artifact_missing_or_invalid",
        message: "Post-write closeout requires handoff final_rows_artifact path/bytes/SHA-256.",
      });
      return null;
    }
    const artifactPath = resolveRepoPath(artifact.path);
    if (!artifactPath || !sameResolvedPath(artifactPath, finalRowsFile)) {
      blockers.push({
        code: "handoff_final_rows_artifact_path_mismatch",
        message: "Handoff final_rows_artifact path must resolve to the exact final rows file.",
        expected_rows: repoRelativeMaybe(finalRowsFile),
        artifact_path: artifact.path,
      });
      return null;
    }
    const current = createFileArtifactFact({
      role: "final_rows",
      path: artifact.path,
      filePath: finalRowsFile,
    });
    if (current.bytes !== artifact.bytes) {
      blockers.push({
        code: "handoff_final_rows_artifact_bytes_drift",
        message: "Final rows byte length changed after commit handoff.",
        expected_bytes: artifact.bytes,
        actual_bytes: current.bytes,
      });
    }
    if (current.sha256 !== artifact.sha256) {
      blockers.push({
        code: "handoff_final_rows_artifact_sha256_drift",
        message: "Final rows bytes changed after commit handoff.",
        expected_sha256: artifact.sha256,
        actual_sha256: current.sha256,
      });
    }
    return current;
  }

  function runDatasetPostWriteCloseout(options: PostWriteCloseoutOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-post-write-closeout",
        usage: [
          "node src/dev-cli.ts dataset-post-write-closeout --handoff-plan <dataset-commit-handoff-plan.json> --commit-report <summary-or-sync-report.json> --post-write-verify-report <remote-verification-report.json> --out-dir <closeout-dir> --ledger-dir <task-import-ledger-dir>",
        ],
        purpose:
          "Close an explicit remote write only after Foundry handoff, CLI commit report, and post-write verify-root-payload evidence prove the exact same final rows were written and read back.",
        remote_write_mode: "read-only",
      };
    }

    const handoffArtifact = readJsonArtifactOption(
      options.handoffPlan || options.plan || options.input,
    );
    const commitArtifact = readJsonArtifactOption(
      options.commitReport || options.commit || options.writeReport,
    );
    const verifyArtifact = readJsonArtifactOption(
      options.postWriteVerifyReport || options.verifyReport || options.remoteVerifyReport,
    );
    if (!handoffArtifact) {
      throw new Error(
        "--handoff-plan is required and must point to dataset-commit-handoff-plan.json.",
      );
    }
    if (!commitArtifact) {
      throw new Error("--commit-report is required and must point to the CLI commit report JSON.");
    }
    if (!verifyArtifact) {
      throw new Error(
        "--post-write-verify-report is required and must point to remote-verification-report.json.",
      );
    }

    const handoffPlan = handoffArtifact.value;
    const datasetType = String(options.type || handoffPlan.dataset_type || "")
      .trim()
      .toLowerCase();
    if (
      !["support", "contact", "source", "process", "flow", "lifecyclemodel"].includes(datasetType)
    ) {
      throw new Error(
        `Unsupported dataset type for post-write closeout: ${datasetType || "(missing)"}.`,
      );
    }
    const outDir = resolveRepoPath(
      options.outDir || path.join(path.dirname(handoffArtifact.path), "post-write-closeout"),
    )!;
    const finalRowsFile = resolveRepoPath(options.rowsFile || handoffPlan.final_rows_file);
    const finalizeArtifact = readJsonArtifactOption(
      options.finalizeReport || handoffPlan.finalize_report,
    );
    const mutationArtifact = readJsonArtifactOption(
      options.mutationManifest || handoffPlan.mutation_manifest,
    );
    const finalizeReport = finalizeArtifact?.value ?? null;
    const mutationManifest = mutationArtifact?.value ?? null;
    const targetUserId = asText(options.targetUserId || handoffPlan.target_user_id);
    const expectedStateCodeText = asText(options.stateCode ?? handoffPlan.expected_state_code);
    const expectedStateCode =
      expectedStateCodeText === "" || Number.isNaN(Number(expectedStateCodeText))
        ? null
        : Number(expectedStateCodeText);
    const blockers: JsonRecord[] = [];
    const handoffAccountMode = asText(handoffPlan.account_mode).toLowerCase() || "ordinary";
    const environmentAccountMode = asText(executionEnvironment.FOUNDRY_ACCOUNT_MODE).toLowerCase();
    if (environmentAccountMode && environmentAccountMode !== handoffAccountMode) {
      blockers.push({
        code: "handoff_account_mode_mismatch",
        message: "Post-write closeout account mode must match the receipt-bound handoff mode.",
      });
    }
    const productionTestAccount =
      handoffAccountMode === "production-test" ||
      environmentAccountMode === "production-test" ||
      ["1", "true"].includes(String(options.productionCase || ""));

    if (handoffPlan.status !== "ready_for_explicit_commit") {
      blockers.push({
        code: "handoff_plan_not_ready",
        message: `Handoff plan status is ${handoffPlan.status ?? "missing"}.`,
        handoff_plan: repoRelativePath(handoffArtifact.path),
      });
    }
    if (!finalRowsFile || !fileExists(finalRowsFile)) {
      blockers.push({
        code: "final_rows_missing",
        message: "Post-write closeout requires the exact final rows file from handoff.",
        final_rows_file: handoffPlan.final_rows_file ?? null,
      });
    }
    const finalRowsArtifact =
      finalRowsFile && fileExists(finalRowsFile)
        ? validateHandoffFinalRowsArtifact({ handoffPlan, finalRowsFile, blockers })
        : null;
    if (!targetUserId) {
      blockers.push({
        code: "target_user_id_missing",
        message: "Post-write closeout requires target_user_id from handoff or options.",
      });
    }
    if (expectedStateCodeText === "" || expectedStateCode === null) {
      blockers.push({
        code: "state_code_missing",
        message: "Post-write closeout requires expected_state_code from handoff or options.",
      });
    }
    if (!finalizeArtifact) {
      blockers.push({
        code: "finalize_report_missing",
        message:
          "Post-write closeout requires the finalize report referenced by the handoff so AI/context prewrite gates remain attached to the committed import.",
        finalize_report: handoffPlan.finalize_report ?? null,
      });
    }
    if (!mutationArtifact) {
      blockers.push({
        code: "mutation_manifest_missing",
        message:
          "Post-write closeout requires the mutation manifest referenced by the handoff so exact-scope AI/context evidence remains attached to the committed import.",
        mutation_manifest: handoffPlan.mutation_manifest ?? null,
      });
    }
    if (finalizeReport && finalizeReport.status !== "ready_for_remote_write") {
      blockers.push({
        code: "finalize_report_not_ready",
        message: `Finalize report status is ${finalizeReport.status ?? "missing"}.`,
        finalize_report: repoRelativeMaybe(finalizeArtifact?.path),
      });
    }
    if (mutationManifest && mutationManifest.status !== "ready_for_remote_write") {
      blockers.push({
        code: "mutation_manifest_not_ready",
        message: `Mutation manifest status is ${mutationManifest.status ?? "missing"}.`,
        mutation_manifest: repoRelativeMaybe(mutationArtifact?.path),
      });
    }
    if (finalizeReport && finalRowsFile) {
      const finalizeRowsFile = resolveRepoPath(
        finalizeReport.files?.final_rows ||
          finalizeReport.final_rows_file ||
          finalizeReport.rows_file,
      );
      if (!finalizeRowsFile || !sameResolvedPath(finalizeRowsFile, finalRowsFile)) {
        blockers.push({
          code: "finalize_report_rows_mismatch",
          message: "Finalize report final rows must match the handoff final rows file.",
          finalize_report: repoRelativeMaybe(finalizeArtifact?.path),
          expected_rows: repoRelativeMaybe(finalRowsFile),
          actual_rows: finalizeRowsFile ? repoRelativeMaybe(finalizeRowsFile) : null,
        });
      }
    }
    if (mutationManifest && finalRowsFile) {
      const mutationRowsFile = resolveRepoPath(
        mutationManifest.rows_file ||
          mutationManifest.files?.final_rows ||
          mutationManifest.files?.rows_file,
      );
      if (!mutationRowsFile || !sameResolvedPath(mutationRowsFile, finalRowsFile)) {
        blockers.push({
          code: "mutation_manifest_rows_mismatch",
          message: "Mutation manifest rows_file must match the handoff final rows file.",
          mutation_manifest: repoRelativeMaybe(mutationArtifact?.path),
          expected_rows: repoRelativeMaybe(finalRowsFile),
          actual_rows: mutationRowsFile ? repoRelativeMaybe(mutationRowsFile) : null,
        });
      }
    }
    const closeoutProfile = asText(
      handoffPlan.profile ?? finalizeReport?.profile ?? mutationManifest?.profile,
    );
    const postWriteFullContextCheck = fullContextProofCheck({
      profileId: closeoutProfile,
      datasetType,
      mutationArtifact,
      codePrefix: "post_write_closeout",
    });
    blockers.push(...postWriteFullContextCheck.blockers);

    const expectedRows =
      finalRowsFile && fileExists(finalRowsFile) ? countRowsFile(finalRowsFile) : 0;
    const intendedRoots: IntendedRoot[] = [];
    if (finalRowsFile && fileExists(finalRowsFile)) {
      readRowsFile(finalRowsFile).forEach((row, rowIndex) => {
        const rootType = rootTypeAndTable(row, datasetType);
        const identity = datasetIdentity(row, rootType.type);
        if (!rootType.table || !identity.id || !identity.version) {
          blockers.push({
            code: "intended_root_identity_missing",
            message: `Final row ${rowIndex} does not expose one supported root identity.`,
            row_index: rowIndex,
          });
          return;
        }
        const acceptedNormalization = normalizeAllowedTraceHashDifference(row);
        intendedRoots.push({
          rowIndex,
          table: rootType.table,
          id: identity.id,
          version: identity.version,
          payloadSha256: canonicalPayloadSha256(row),
          acceptedNormalizedPayloadSha256:
            acceptedNormalization.removed_paths.length > 0
              ? acceptedNormalization.normalized_sha256
              : null,
          acceptedNormalizedRemovedPaths: acceptedNormalization.removed_paths,
        });
      });
    }
    if (expectedRows <= 0) {
      blockers.push({
        code: "final_rows_empty",
        message: "Post-write closeout requires at least one final row.",
        final_rows_file: repoRelativeMaybe(finalRowsFile),
      });
    }

    let rootProof: {
      checksFile: string | null;
      readbackChecks: RootReadbackCheck[];
      uniqueReadbackCount: number;
    } = { checksFile: null, readbackChecks: [], uniqueReadbackCount: 0 };
    if (finalRowsFile && fileExists(finalRowsFile)) {
      validateCommitReportForCloseout({
        commitReport: commitArtifact.value,
        commitReportPath: commitArtifact.path,
        datasetType,
        finalRowsFile,
        expectedRows,
        blockers,
        handoffPlan,
        targetUserId,
        expectedStateCode,
      });
      rootProof = validatePostWriteVerifyForCloseout({
        verifyReport: verifyArtifact.value,
        handoffPlan,
        verifyReportPath: verifyArtifact.path,
        finalRowsFile,
        expectedRows,
        targetUserId,
        expectedStateCode,
        intendedRoots,
        allowTraceHashOnlyNormalization: !productionTestAccount,
        blockers,
      });
    }

    const traceQueues = validateTraceQueuesForCloseout({
      handoffPlan,
      finalizeReport,
      mutationManifest,
      datasetType,
      finalRowsFile,
      blockers,
    });

    const reportPath = path.join(outDir, "dataset-post-write-closeout-report.json");
    const report = buildPostWriteCloseoutReportPayload({
      blockers,
      datasetType,
      handoffArtifact,
      handoffPlan,
      finalizeArtifact,
      finalizeReport,
      mutationArtifact,
      mutationManifest,
      commitArtifact,
      verifyArtifact,
      finalRowsFile,
      finalRowsArtifact,
      targetUserId,
      expectedStateCode,
      productionTestAccount,
      expectedRows,
      uniqueReadbackCount: rootProof.uniqueReadbackCount,
      traceQueues,
      postWriteFullContextRequired: postWriteFullContextCheck.required,
      reportPath,
    });
    const importLedger = writeCloseoutImportLedger
      ? writeCloseoutImportLedger({
          report,
          reportPath,
          ledgerDir: resolveRepoPath(
            options.ledgerDir || options.importLedgerDir || path.join(outDir, "import-ledger"),
          ),
        })
      : { status: "skipped", files: {}, counts: { entries_written: 0 } };
    const finalReport = {
      ...report,
      counts: {
        ...report.counts,
        import_ledger_entries: importLedger.counts?.entries_written ?? 0,
      },
      files: {
        ...report.files,
        import_ledger: importLedger.files ?? {},
      },
    };
    writeJson(reportPath, finalReport);
    return finalReport;
  }

  return {
    runDatasetPostWriteCloseout,
    validatePostWriteVerifyForCloseout,
    validateCommitReportForCloseout,
  };
}
