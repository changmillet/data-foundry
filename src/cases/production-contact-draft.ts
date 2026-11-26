#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFreshIntentBoundAuthReceipt, sha256Json } from "../lib/identity-preflight-proof.ts";
import {
  contactPayload,
  contactRootProbe,
  containsSecretMaterial,
  fileFact,
  hardenTree,
  parseSingleJsonLine,
  readChecks,
  redactCredentialText,
  requireDiskReport,
  safeChildCode,
  signalExitCode,
  validateCommit,
  validateDryRun,
  validatePostwriteVerify,
  validatePrewriteVerify,
  validatePublicFlowRead,
  validateSelfDraftRead,
  validateValidationReport,
} from "./production-contact-draft-reports.ts";
import {
  CASE_SCHEMA,
  CHILD_TIMEOUT_MS,
  FAILURE_SCHEMA,
  MAX_CHILD_OUTPUT_BYTES,
  ProductionContactDraftCaseError,
  RECEIPT_MAX_AGE_MS,
  assertCanonicalUuid,
  assertGitIgnoredCaseOutDir,
  assertPrivateParentInsideRepository,
  assertReceiptRuntime,
  fail,
  normalizeOptions,
  parseProductionContactDraftCaseArgs,
  prepareRuntimeSnapshotForRunner,
  projectRefFromBaseUrl,
  readCaseEnv,
  readRegularFile,
  remoteEnv,
  repositoryRoot,
  systemEnv,
  token,
  validateRuntimeEvidence,
  type ArtifactFact,
  type JsonRecord,
  type ManifestScope,
  type ProductionContactDraftCaseManifest,
  type ProductionContactDraftCaseOptions,
  type ProductionContactDraftRuntimeEvidence,
  type ProductionContactDraftSpawn,
  type RunProductionContactDraftCaseDeps,
  type SpawnResult,
  type StageEvidence,
} from "./production-contact-draft-runtime.ts";

export {
  parseProductionContactDraftCaseArgs,
  type ProductionContactDraftCaseManifest,
  type ProductionContactDraftCaseOptions,
  type ProductionContactDraftRuntimeEvidence,
  type ProductionContactDraftSpawn,
  type RunProductionContactDraftCaseDeps,
};

function prepareRuntimeSnapshot(): ProductionContactDraftRuntimeEvidence {
  return prepareRuntimeSnapshotForRunner(import.meta.url);
}

function writePrivateFile(filePath: string, text: string, mode = 0o600): void {
  const descriptor = openSync(filePath, "wx", mode);
  try {
    writeFileSync(descriptor, text, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (process.platform !== "win32") chmodSync(filePath, mode);
}

function overwritePrivateFile(filePath: string, text: string): void {
  const descriptor = openSync(filePath, "w", 0o600);
  try {
    writeFileSync(descriptor, text, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (process.platform !== "win32") chmodSync(filePath, 0o600);
}

function writePrivateJson(filePath: string, value: unknown, mode = 0o600): void {
  writePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function redactSecrets(root: string, secrets: string[]): string[] {
  if (!existsSync(root)) return [];
  const changedPaths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        const text = readFileSync(entryPath).toString("utf8");
        const redacted = redactCredentialText(text, secrets);
        if (redacted !== text) {
          overwritePrivateFile(entryPath, redacted);
          changedPaths.push(entryPath);
        }
      }
    }
  };
  visit(root);
  return changedPaths.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function artifactInventory(root: string): ArtifactFact[] {
  const facts: ArtifactFact[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (
        entry.isFile() &&
        !["case-manifest.json", "case-failure.json"].includes(entry.name)
      ) {
        facts.push(fileFact(entryPath, root));
      }
    }
  };
  visit(root);
  return facts.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")),
  );
}

function writeFailure(
  outDir: string,
  input: {
    stage: string;
    code: string;
    mutationDispatchCount: number;
    contactId: string | null;
    runtimeCleanupErrorCode: string | null;
    redactionErrorCode: string | null;
  },
): void {
  if (!existsSync(outDir) || existsSync(path.join(outDir, "case-failure.json"))) return;
  writePrivateJson(path.join(outDir, "case-failure.json"), {
    schema: FAILURE_SCHEMA,
    status: "failed",
    stage: input.stage,
    error_code: input.code,
    mutation_dispatch_count: input.mutationDispatchCount,
    contact_id: input.contactId,
    runtime_cleanup_error_code: input.runtimeCleanupErrorCode,
    redaction_error_code: input.redactionErrorCode,
    automatic_retry_performed: false,
  });
}

export async function runProductionContactDraftCase(
  rawOptions: ProductionContactDraftCaseOptions,
  deps: RunProductionContactDraftCaseDeps = {},
): Promise<ProductionContactDraftCaseManifest> {
  const options = normalizeOptions(rawOptions);
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    return fail(
      "Secure private case storage is unsupported on Windows without a verified user-exclusive ACL.",
      "CASE_PLATFORM_PRIVATE_STORAGE_UNSUPPORTED",
      2,
    );
  }
  const root = repositoryRoot();
  assertPrivateParentInsideRepository(root, options.outDir);
  assertGitIgnoredCaseOutDir(root, options.outDir);
  const runtime = validateRuntimeEvidence(
    (deps.prepareRuntimeSnapshot ?? prepareRuntimeSnapshot)(),
  );
  let cleanupAttempted = false;
  let runtimeCleanupErrorCode: string | null = null;
  const cleanup = (): void => {
    if (cleanupAttempted) return;
    cleanupAttempted = true;
    try {
      runtime.cleanup();
    } catch {
      runtimeCleanupErrorCode = "CASE_RUNTIME_CLEANUP_FAILED";
    }
  };
  const now = deps.now ?? (() => new Date());
  const processEnv = deps.processEnv ?? process.env;
  const spawnImpl =
    deps.spawnImpl ??
    ((command: string, args: string[], spawnOptions: ProductionContactDraftSpawn["options"]) =>
      spawnSync(command, args, spawnOptions));
  const stages: StageEvidence[] = [];
  let stage = "prepare";
  let mutationDispatchCount = 0;
  let contactId: string | null = null;
  let secrets: string[] = [];

  try {
    const outParent = path.dirname(options.outDir);
    const outParentExisted = existsSync(outParent);
    try {
      mkdirSync(outParent, { recursive: true, mode: 0o700 });
      if (!lstatSync(outParent).isDirectory()) throw new Error("not a directory");
      const realParent = realpathSync(outParent);
      const relativeRealParent = path.relative(root, realParent);
      if (relativeRealParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRealParent)) {
        throw new Error("parent escaped repository");
      }
      if (!outParentExisted && process.platform !== "win32") chmodSync(outParent, 0o700);
    } catch {
      return fail(
        "Production case output parent could not be created safely.",
        "CASE_OUTPUT_PARENT_CREATE_FAILED",
        2,
      );
    }
    try {
      mkdirSync(options.outDir, { recursive: false, mode: 0o700 });
    } catch {
      return fail(
        "Production case output directory could not be created exclusively.",
        "CASE_OUTPUT_CREATE_FAILED",
        2,
      );
    }
    if (process.platform !== "win32") chmodSync(options.outDir, 0o700);
    const cleanCwd = path.join(options.outDir, "clean-cwd");
    mkdirSync(cleanCwd, { recursive: false, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(cleanCwd, 0o700);
    if (existsSync(path.join(cleanCwd, ".env"))) {
      return fail("Production case cwd contains .env.", "CASE_CWD_UNSAFE", 2);
    }

    contactId = assertCanonicalUuid((deps.randomUUID ?? nodeRandomUUID)(), "Generated contact id");
    const candidate = contactPayload(contactId, now());
    const candidatePath = path.join(options.outDir, "contact.jsonl");
    const candidateText = `${JSON.stringify(candidate)}\n`;
    const candidateBytes = Buffer.from(candidateText, "utf8");
    writePrivateFile(candidatePath, candidateText);
    const rootProbePath = path.join(options.outDir, "contact-root-probe.jsonl");
    writePrivateFile(rootProbePath, `${JSON.stringify(contactRootProbe(contactId))}\n`);
    chmodSync(candidatePath, 0o400);
    chmodSync(rootProbePath, 0o400);
    const candidatePayloadSha256 = sha256Json(candidate);

    const invoke = (
      stageName: string,
      argv: string[],
      env: NodeJS.ProcessEnv,
      diskReportPath: string | null,
      markMutationDispatch = false,
    ): JsonRecord => {
      stage = stageName;
      if (diskReportPath && existsSync(diskReportPath)) {
        return fail(`Refusing stale report path at ${stageName}.`, "CASE_STALE_ARTIFACT");
      }
      const spawnOptions: ProductionContactDraftSpawn["options"] = {
        cwd: cleanCwd,
        env,
        shell: false,
        encoding: "utf8",
        maxBuffer: MAX_CHILD_OUTPUT_BYTES,
        timeout: CHILD_TIMEOUT_MS,
        windowsHide: true,
      };
      let child: SpawnResult;
      try {
        runtime.verifyCurrent();
      } catch {
        return fail(`Runtime evidence drifted at ${stageName}.`, "CASE_RUNTIME_DRIFT");
      }
      if (markMutationDispatch) mutationDispatchCount += 1;
      try {
        child = spawnImpl(process.execPath, [runtime.entrypoint, ...argv], spawnOptions);
      } catch {
        return fail(
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? `CLI failed at ${stageName} with an ambiguous mutation outcome.`
            : `CLI spawn failed at ${stageName}.`,
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? "CASE_MUTATION_OUTCOME_AMBIGUOUS"
            : "CASE_CHILD_SPAWN_FAILED",
          stageName === "commit-contact-draft" && mutationDispatchCount > 0 ? 70 : 1,
        );
      }
      try {
        runtime.verifyCurrent();
      } catch {
        return fail(
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? `CLI failed at ${stageName} with an ambiguous mutation outcome.`
            : `Runtime evidence drifted at ${stageName}.`,
          stageName === "commit-contact-draft" && mutationDispatchCount > 0
            ? "CASE_MUTATION_OUTCOME_AMBIGUOUS"
            : "CASE_RUNTIME_DRIFT",
          stageName === "commit-contact-draft" && mutationDispatchCount > 0 ? 70 : 1,
        );
      }
      if (child.error || child.status !== 0 || child.signal !== null || child.stderr !== "") {
        if (stageName === "commit-contact-draft" && mutationDispatchCount > 0) {
          return fail(
            `CLI failed at ${stageName} with an ambiguous mutation outcome.`,
            "CASE_MUTATION_OUTCOME_AMBIGUOUS",
            70,
          );
        }
        if (child.signal) {
          return fail(
            `CLI was cancelled at ${stageName}.`,
            "CASE_CHILD_CANCELLED",
            signalExitCode(child.signal),
          );
        }
        return fail(
          `CLI failed at ${stageName}.`,
          child.error ? "CASE_CHILD_SPAWN_FAILED" : safeChildCode(child.stderr),
        );
      }
      if (
        containsSecretMaterial(child.stdout, secrets) ||
        containsSecretMaterial(child.stderr, secrets)
      ) {
        return fail(
          "Secret material was detected in production case child output.",
          "CASE_SECRET_MATERIAL_DETECTED",
        );
      }
      const report = parseSingleJsonLine(child.stdout, stageName);
      const diskFact = diskReportPath ? requireDiskReport(diskReportPath, report, stageName) : null;
      if (diskReportPath && containsSecretMaterial(readFileSync(diskReportPath, "utf8"), secrets)) {
        return fail(
          "Secret material was detected in a production case disk report.",
          "CASE_SECRET_MATERIAL_DETECTED",
        );
      }
      stages.push({
        stage: stageName,
        argv,
        argv_sha256: sha256Json(argv),
        report_sha256: sha256Json(report),
        disk_report_sha256: diskFact?.sha256 ?? null,
        status: token(report.status),
      });
      return report;
    };

    const offlineEnv = systemEnv(processEnv);
    const validateDir = path.join(options.outDir, "offline-validate");
    const validation = invoke(
      "offline-validate",
      [
        "dataset",
        "validate",
        "--input",
        candidatePath,
        "--type",
        "contact",
        "--out-dir",
        validateDir,
        "--json",
      ],
      offlineEnv,
      path.join(validateDir, "outputs", "validation-report.json"),
    );
    validateValidationReport(validation, candidatePath);

    const dryRunDir = path.join(options.outDir, "offline-save-draft-dry-run");
    const dryRun = invoke(
      "offline-save-draft-dry-run",
      [
        "dataset",
        "save-draft",
        "--input",
        candidatePath,
        "--type",
        "contact",
        "--out-dir",
        dryRunDir,
        "--dry-run",
        "--json",
      ],
      offlineEnv,
      path.join(dryRunDir, "outputs", "dataset-save-draft", "summary.json"),
    );
    validateDryRun(dryRun, candidatePath);

    stage = "load-production-env";
    const caseEnv = readCaseEnv(options.envFile, root);
    secrets = [caseEnv.TIANGONG_LCA_SESSION_FILE];
    if (projectRefFromBaseUrl(caseEnv.TIANGONG_LCA_API_BASE_URL) !== options.expectedProjectRef) {
      return fail("Production env project does not match intent.", "CASE_PROJECT_MISMATCH", 2);
    }
    const authenticatedEnv = remoteEnv(processEnv, caseEnv);

    const authArgv = [
      "auth",
      "identity-receipt",
      "--expected-project-ref",
      options.expectedProjectRef,
      "--expected-user-id",
      options.expectedUserId,
      "--json",
    ];
    const firstReceiptValue = invoke("identity-before-reads", authArgv, authenticatedEnv, null);
    const firstReceipt = parseFreshIntentBoundAuthReceipt(firstReceiptValue, {
      nowMs: now().getTime(),
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      expectedProjectRef: options.expectedProjectRef,
      expectedUserId: options.expectedUserId,
    });
    assertReceiptRuntime(firstReceipt, runtime);
    const firstReceiptPath = path.join(options.outDir, "identity-receipt-before-reads.json");
    writePrivateJson(firstReceiptPath, firstReceipt);

    const publicRead = invoke(
      "public-flow-read",
      ["flow", "list", "--state-code", "100", "--limit", "1", "--json"],
      authenticatedEnv,
      null,
    );
    validatePublicFlowRead(publicRead);

    const selfDraftRead = invoke(
      "self-process-draft-read",
      [
        "process",
        "list",
        "--user-id",
        options.expectedUserId,
        "--state-code",
        "0",
        "--limit",
        "1",
        "--json",
      ],
      authenticatedEnv,
      null,
    );
    validateSelfDraftRead(selfDraftRead, options.expectedUserId);

    const prewriteDir = path.join(options.outDir, "prewrite-verify");
    const prewrite = invoke(
      "prewrite-verify",
      [
        "dataset",
        "verify-remote",
        "--input",
        rootProbePath,
        "--out-dir",
        prewriteDir,
        "--root-policy",
        "candidate",
        "--json",
      ],
      authenticatedEnv,
      path.join(prewriteDir, "outputs", "remote-verification-report.json"),
    );
    validatePrewriteVerify(
      prewrite,
      readChecks(path.join(prewriteDir, "outputs", "remote-verification.jsonl")),
      rootProbePath,
      contactId,
    );

    const secondReceiptValue = invoke("identity-before-write", authArgv, authenticatedEnv, null);
    const secondReceipt = parseFreshIntentBoundAuthReceipt(secondReceiptValue, {
      nowMs: now().getTime(),
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      expectedProjectRef: options.expectedProjectRef,
      expectedUserId: options.expectedUserId,
    });
    assertReceiptRuntime(secondReceipt, runtime);
    if (Date.parse(secondReceipt.captured_at_utc) < Date.parse(firstReceipt.captured_at_utc)) {
      return fail("Write receipt predates the read receipt.", "CASE_RECEIPT_ORDER_INVALID");
    }
    const secondReceiptPath = path.join(options.outDir, "identity-receipt-before-write.json");
    writePrivateJson(secondReceiptPath, secondReceipt);

    const commitDir = path.join(options.outDir, "commit-contact-draft");
    const currentCandidateBytes = readRegularFile(candidatePath);
    if (!currentCandidateBytes.equals(candidateBytes)) {
      return fail(
        "The candidate bytes changed before mutation dispatch.",
        "CASE_CANDIDATE_ARTIFACT_DRIFT",
      );
    }
    const commit = invoke(
      "commit-contact-draft",
      [
        "dataset",
        "save-draft",
        "--input",
        candidatePath,
        "--type",
        "contact",
        "--out-dir",
        commitDir,
        "--commit",
        "--json",
      ],
      authenticatedEnv,
      path.join(commitDir, "outputs", "dataset-save-draft", "summary.json"),
      true,
    );
    validateCommit(commit, candidatePath, contactId);

    const postwriteDir = path.join(options.outDir, "postwrite-verify");
    const postwrite = invoke(
      "postwrite-verify",
      [
        "dataset",
        "verify-remote",
        "--input",
        candidatePath,
        "--out-dir",
        postwriteDir,
        "--root-policy",
        "candidate",
        "--compare-root-payload",
        "--target-user-id",
        options.expectedUserId,
        "--state-code",
        "0",
        "--json",
      ],
      authenticatedEnv,
      path.join(postwriteDir, "outputs", "remote-verification-report.json"),
    );
    validatePostwriteVerify(
      postwrite,
      readChecks(path.join(postwriteDir, "outputs", "remote-verification.jsonl")),
      candidatePath,
      contactId,
      options.expectedUserId,
      candidatePayloadSha256,
    );

    cleanup();
    if (runtimeCleanupErrorCode) {
      return fail("The private runtime snapshot could not be cleaned up.", runtimeCleanupErrorCode);
    }
    const redactedPaths = redactSecrets(options.outDir, secrets);
    if (redactedPaths.length > 0) {
      return fail(
        "Secret material was detected in persisted production case artifacts.",
        "CASE_SECRET_MATERIAL_DETECTED",
      );
    }
    hardenTree(options.outDir);
    const candidateFact = fileFact(candidatePath, options.outDir);
    const firstReceiptFact = fileFact(firstReceiptPath, options.outDir);
    const secondReceiptFact = fileFact(secondReceiptPath, options.outDir);
    const scope: ManifestScope = {
      schema: CASE_SCHEMA,
      status: "passed",
      executed_at_utc: now().toISOString(),
      project_ref: options.expectedProjectRef,
      user_id: options.expectedUserId,
      contact_id: contactId,
      contact_version: "00.00.001",
      contact_artifact: { ...candidateFact, payload_sha256: candidatePayloadSha256 },
      cli: {
        package_name: runtime.cliPackageName,
        package_version: runtime.cliPackageVersion,
        entrypoint_sha256: runtime.cliEntrypointSha256,
        runtime_sha256: runtime.cliRuntimeSha256,
        pnpm_installation_sha256: runtime.pnpmInstallationSha256,
      },
      foundry: {
        runner_sha256: runtime.runnerSha256,
        source_sha256: runtime.foundrySourceSha256 ?? null,
        pnpm_lock_sha256: runtime.pnpmLockSha256,
      },
      receipts: [
        {
          role: "before_reads",
          file: firstReceiptFact.path,
          file_sha256: firstReceiptFact.sha256,
          receipt_scope_sha256: firstReceipt.receipt_scope_sha256,
          captured_at_utc: firstReceipt.captured_at_utc,
        },
        {
          role: "before_write",
          file: secondReceiptFact.path,
          file_sha256: secondReceiptFact.sha256,
          receipt_scope_sha256: secondReceipt.receipt_scope_sha256,
          captured_at_utc: secondReceipt.captured_at_utc,
        },
      ],
      stages,
      mutation_dispatch_count: 1,
      mutation_disposition: "retained_owner_draft",
      unique_root_readback_checks: 1,
      artifacts: artifactInventory(options.outDir),
    };
    const manifest = { ...scope, manifest_scope_sha256: sha256Json(scope) };
    writePrivateJson(path.join(options.outDir, "case-manifest.json"), manifest, 0o400);
    if (process.platform !== "win32") {
      for (const immutable of [candidatePath, firstReceiptPath, secondReceiptPath]) {
        chmodSync(immutable, 0o400);
      }
    }
    return manifest;
  } catch (error) {
    cleanup();
    let redactionErrorCode: string | null = null;
    try {
      redactSecrets(options.outDir, secrets);
    } catch {
      redactionErrorCode = "CASE_SECRET_REDACTION_FAILED";
    }
    const code =
      error instanceof ProductionContactDraftCaseError ? error.code : "CASE_UNEXPECTED_FAILURE";
    writeFailure(options.outDir, {
      stage,
      code,
      mutationDispatchCount,
      contactId,
      runtimeCleanupErrorCode,
      redactionErrorCode,
    });
    hardenTree(options.outDir);
    throw error;
  } finally {
    cleanup();
  }
}

function renderHelp(): string {
  return `Usage:
  pnpm case:production:contact-draft -- --env-file <ignored-.env> --expected-project-ref <ref> --expected-user-id <uuid> --out-dir <new-private-dir>

This explicit case runs offline validation, bounded production reads, one owner-draft contact write,
and an exact owner/state/payload readback. It is POSIX-only, requires an owner-private env file plus
a repository-local git-ignored output without symlink parents, is not part of ordinary CI, and never retries a write.`;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${renderHelp()}\n`);
    return 0;
  }
  try {
    const options = parseProductionContactDraftCaseArgs(argv);
    const manifest = await runProductionContactDraftCase(options);
    process.stdout.write(
      `${JSON.stringify({ status: manifest.status, out_dir: options.outDir, contact_id: manifest.contact_id, manifest_scope_sha256: manifest.manifest_scope_sha256 })}\n`,
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof ProductionContactDraftCaseError ? error.code : "CASE_UNEXPECTED_FAILURE";
    const exitCode = error instanceof ProductionContactDraftCaseError ? error.exitCode : 1;
    process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
    return exitCode;
  }
}

function isDirectEntry(importMetaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  let invokedPath = path.resolve(argv1);
  let modulePath = fileURLToPath(importMetaUrl);
  try {
    invokedPath = realpathSync(invokedPath);
  } catch {
    // A missing invoked path cannot be the loaded module.
  }
  try {
    modulePath = realpathSync(modulePath);
  } catch {
    // Keep the canonical URL path when a test virtualizes the module.
  }
  return pathToFileURL(invokedPath).href === pathToFileURL(modulePath).href;
}

export const __testInternals = {
  contactPayload,
  contactRootProbe,
  prepareRuntimeSnapshot,
  signalExitCode,
};

if (isDirectEntry(import.meta.url, process.argv[1])) process.exitCode = await main();
