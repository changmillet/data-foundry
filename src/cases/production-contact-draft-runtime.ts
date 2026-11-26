import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import type { parseFreshIntentBoundAuthReceipt } from "../lib/identity-preflight-proof.ts";
import { requirePrivateOAuthSessionFile } from "../lib/oauth-session-reference.ts";

export const CASE_SCHEMA = "tiangong-foundry.production-contact-draft-case.v1" as const;
export const FAILURE_SCHEMA = "tiangong-foundry.production-contact-draft-case-failure.v1" as const;
const CLI_PACKAGE_NAME = "@tiangong-lca/cli" as const;
const CLI_PACKAGE_VERSION = "0.1.28" as const;
export const MAX_CHILD_OUTPUT_BYTES = 8 * 1024 * 1024;
export const CHILD_TIMEOUT_MS = 120_000;
export const RECEIPT_MAX_AGE_MS = 5 * 60_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_REF_PATTERN = /^[a-z0-9-]+$/u;
const REQUIRED_ENV_KEYS = [
  "TIANGONG_LCA_API_BASE_URL",
  "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY",
  "TIANGONG_LCA_SESSION_FILE",
  "TIANGONG_LCA_OAUTH_CLIENT_ID",
] as const;
const SYSTEM_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

export type JsonRecord = Record<string, unknown>;
export type CaseEnv = Record<(typeof REQUIRED_ENV_KEYS)[number], string>;

export type ProductionContactDraftCaseOptions = {
  envFile: string;
  expectedProjectRef: string;
  expectedUserId: string;
  outDir: string;
};

export type ProductionContactDraftRuntimeEvidence = {
  entrypoint: string;
  cliPackageName: string;
  cliPackageVersion: string;
  cliEntrypointSha256: string;
  cliRuntimeSha256: string;
  runnerSha256: string;
  pnpmLockSha256: string;
  pnpmInstallationSha256: string;
  foundrySourceSha256?: string;
  verifyCurrent: () => void;
  cleanup: () => void;
};

export type ProductionContactDraftSpawn = {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    encoding: "utf8";
    maxBuffer: number;
    timeout: number;
    windowsHide: true;
  };
};

export type SpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type StageEvidence = {
  stage: string;
  argv: string[];
  argv_sha256: string;
  report_sha256: string;
  disk_report_sha256: string | null;
  status: string | null;
};

export type ArtifactFact = { path: string; bytes: number; sha256: string };

export type ManifestScope = {
  schema: typeof CASE_SCHEMA;
  status: "passed";
  executed_at_utc: string;
  project_ref: string;
  user_id: string;
  contact_id: string;
  contact_version: "00.00.001";
  contact_artifact: ArtifactFact & { payload_sha256: string };
  cli: {
    package_name: string;
    package_version: string;
    entrypoint_sha256: string;
    runtime_sha256: string;
    pnpm_installation_sha256: string;
  };
  foundry: {
    runner_sha256: string;
    source_sha256: string | null;
    pnpm_lock_sha256: string;
  };
  receipts: Array<{
    role: "before_reads" | "before_write";
    file: string;
    file_sha256: string;
    receipt_scope_sha256: string;
    captured_at_utc: string;
  }>;
  stages: StageEvidence[];
  mutation_dispatch_count: 1;
  mutation_disposition: "retained_owner_draft";
  unique_root_readback_checks: 1;
  artifacts: ArtifactFact[];
};

export type ProductionContactDraftCaseManifest = ManifestScope & {
  manifest_scope_sha256: string;
};

export type RunProductionContactDraftCaseDeps = {
  processEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomUUID?: () => string;
  platform?: NodeJS.Platform;
  prepareRuntimeSnapshot?: () => ProductionContactDraftRuntimeEvidence;
  spawnImpl?: (
    command: string,
    args: string[],
    options: ProductionContactDraftSpawn["options"],
  ) => SpawnResult;
};

export class ProductionContactDraftCaseError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(message: string, code: string, exitCode = 1) {
    super(message);
    this.name = "ProductionContactDraftCaseError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function fail(message: string, code: string, exitCode = 1): never {
  throw new ProductionContactDraftCaseError(message, code, exitCode);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function token(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

export function required(value: unknown, label: string): string {
  return (
    token(value) ??
    fail(`Production contact draft case requires ${label}.`, "CASE_ARGS_REQUIRED", 2)
  );
}

export function assertCanonicalUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    return fail(`${label} must be a canonical lowercase UUID.`, "CASE_ARGS_INVALID", 2);
  }
  return value;
}

export function normalizeOptions(
  options: ProductionContactDraftCaseOptions,
): ProductionContactDraftCaseOptions {
  const normalized = {
    envFile: path.resolve(required(options.envFile, "--env-file")),
    expectedProjectRef: required(options.expectedProjectRef, "--expected-project-ref"),
    expectedUserId: assertCanonicalUuid(
      required(options.expectedUserId, "--expected-user-id"),
      "--expected-user-id",
    ),
    outDir: path.resolve(required(options.outDir, "--out-dir")),
  };
  if (!PROJECT_REF_PATTERN.test(normalized.expectedProjectRef)) {
    return fail(
      "--expected-project-ref must contain only lowercase project-ref characters.",
      "CASE_ARGS_INVALID",
      2,
    );
  }
  if (existsSync(normalized.outDir)) {
    return fail(
      "Production contact draft case output directory must not already exist.",
      "CASE_OUTPUT_EXISTS",
      2,
    );
  }
  return normalized;
}

export function parseProductionContactDraftCaseArgs(
  argv: string[],
): ProductionContactDraftCaseOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        "env-file": { type: "string" },
        "expected-project-ref": { type: "string" },
        "expected-user-id": { type: "string" },
        "out-dir": { type: "string" },
      },
    });
  } catch (error) {
    return fail(
      `Invalid production contact draft case arguments: ${error instanceof Error ? error.message : "parse failure"}`,
      "CASE_ARGS_INVALID",
      2,
    );
  }
  for (const name of ["env-file", "expected-project-ref", "expected-user-id", "out-dir"] as const) {
    if (
      (parsed.tokens ?? []).filter((entry) => entry.kind === "option" && entry.name === name)
        .length !== 1
    ) {
      return fail(
        `Production contact draft case requires exactly one --${name}.`,
        "CASE_ARGS_INVALID",
        2,
      );
    }
  }
  return {
    envFile: path.resolve(required(parsed.values["env-file"], "--env-file")),
    expectedProjectRef: required(parsed.values["expected-project-ref"], "--expected-project-ref"),
    expectedUserId: assertCanonicalUuid(
      required(parsed.values["expected-user-id"], "--expected-user-id"),
      "--expected-user-id",
    ),
    outDir: path.resolve(required(parsed.values["out-dir"], "--out-dir")),
  };
}

export function repositoryRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, "pnpm-lock.yaml"))
    ) {
      const manifest = JSON.parse(readFileSync(path.join(current, "package.json"), "utf8")) as {
        name?: unknown;
      };
      if (manifest.name === "@tiangong-lca/foundry") return realpathSync(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fail("Could not resolve the trusted Foundry repository root.", "CASE_RUNTIME_INVALID", 2);
}

export function assertGitIgnoredCaseOutDir(root: string, outDir: string): void {
  const relative = path.relative(root, outDir);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return fail(
      "Production case output must be a git-ignored per-run directory inside the repository.",
      "CASE_OUTPUT_NOT_IGNORED",
      2,
    );
  }
  const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", outDir], {
    cwd: root,
    env: systemEnv(process.env),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || result.signal !== null || result.error) {
    return fail(
      "Production case output must be a git-ignored per-run directory inside the repository.",
      "CASE_OUTPUT_NOT_IGNORED",
      2,
    );
  }
}

export function assertPrivateParentInsideRepository(root: string, outDir: string): void {
  const parent = path.dirname(outDir);
  const relativeParent = path.relative(root, parent);
  let current = root;
  for (const part of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      return fail(
        "Production case output parent must not traverse a symbolic link.",
        "CASE_OUTPUT_PARENT_SYMLINK",
        2,
      );
    }
  }
}

type BufferedFile = { relativePath: string; bytes: Buffer };

function comparePortablePaths(left: BufferedFile, right: BufferedFile): number {
  return Buffer.compare(
    Buffer.from(left.relativePath, "utf8"),
    Buffer.from(right.relativePath, "utf8"),
  );
}

export function readRegularFile(filePath: string): Buffer {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    return fail("Production case runtime evidence is incomplete.", "CASE_RUNTIME_INVALID", 2);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return fail(
      "Production case runtime evidence must contain regular files only.",
      "CASE_RUNTIME_INVALID",
      2,
    );
  }
  return readFileSync(filePath);
}

function collectFiles(root: string): BufferedFile[] {
  const files: BufferedFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        return fail("CLI runtime snapshot cannot contain symlinks.", "CASE_RUNTIME_INVALID", 2);
      }
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        files.push({
          relativePath: path.relative(root, entryPath).replaceAll("\\", "/"),
          bytes: readRegularFile(entryPath),
        });
      }
    }
  };
  visit(root);
  return files.sort(comparePortablePaths);
}

function collectPnpmInstallationFiles(root: string): BufferedFile[] {
  const files: BufferedFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".foundry-contact-case-runtime-")) continue;
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, entryPath).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        files.push({
          relativePath,
          bytes: Buffer.from(`SYMLINK\0${readlinkSync(entryPath)}`, "utf8"),
        });
      } else if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push({ relativePath, bytes: readRegularFile(entryPath) });
      else
        return fail(
          "pnpm installation contains an unsupported filesystem entry.",
          "CASE_RUNTIME_INVALID",
          2,
        );
    }
  };
  visit(root);
  return files.sort(comparePortablePaths);
}

function hashBufferedFiles(files: BufferedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath).update("\0").update(file.bytes).update("\0");
  }
  return hash.digest("hex");
}

function sourceEvidence(root: string): string {
  const paths = [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.build.json",
    "src/cases/production-contact-draft.ts",
    "src/cases/production-contact-draft-runtime.ts",
    "src/cases/production-contact-draft-reports.ts",
    "src/lib/identity-preflight-proof.ts",
  ];
  return hashBufferedFiles(
    paths.map((relativePath) => ({
      relativePath,
      bytes: readRegularFile(path.join(root, relativePath)),
    })),
  );
}

export function prepareRuntimeSnapshotForRunner(
  runnerUrl: string,
): ProductionContactDraftRuntimeEvidence {
  const root = repositoryRoot();
  const logicalPackageRoot = path.join(root, "node_modules", "@tiangong-lca", "cli");
  const packageRoot = realpathSync(logicalPackageRoot);
  const packageJsonBytes = readRegularFile(path.join(packageRoot, "package.json"));
  const packageJson = JSON.parse(packageJsonBytes.toString("utf8")) as {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
  };
  if (packageJson.name !== CLI_PACKAGE_NAME || packageJson.version !== CLI_PACKAGE_VERSION) {
    return fail(
      `Expected installed ${CLI_PACKAGE_NAME}@${CLI_PACKAGE_VERSION}.`,
      "CASE_RUNTIME_INVALID",
      2,
    );
  }
  const binEntry =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : isRecord(packageJson.bin)
        ? token(packageJson.bin["tiangong-lca"])
        : null;
  if (!binEntry) return fail("Installed CLI bin is missing.", "CASE_RUNTIME_INVALID", 2);
  const packageFiles = collectFiles(packageRoot);
  const binRelativePath = path
    .relative(packageRoot, path.resolve(packageRoot, binEntry))
    .replaceAll("\\", "/");
  const binFile = packageFiles.find((file) => file.relativePath === binRelativePath);
  if (!binFile) return fail("Installed CLI entrypoint is missing.", "CASE_RUNTIME_INVALID", 2);
  const pnpmInstallationRoot = path.join(root, "node_modules", ".pnpm");
  const pnpmInstallationSha256 = hashBufferedFiles(
    collectPnpmInstallationFiles(pnpmInstallationRoot),
  );
  const cliRuntimeSha256 = hashBufferedFiles(packageFiles);
  const runnerPath = fileURLToPath(runnerUrl);
  const runnerSha256 = createHash("sha256").update(readRegularFile(runnerPath)).digest("hex");
  const lockPath = path.join(root, "pnpm-lock.yaml");
  const pnpmLockSha256 = createHash("sha256").update(readRegularFile(lockPath)).digest("hex");
  const foundrySourceSha256 = sourceEvidence(root);

  // Keep the private copy inside the installed package's pnpm dependency island.
  // ESM does not honor NODE_PATH, so moving the package under a generic cache
  // directory would detach it from pnpm's non-hoisted dependency links.
  const snapshotParent = path.dirname(packageRoot);
  const snapshotRoot = mkdtempSync(path.join(snapshotParent, ".foundry-contact-case-runtime-"));
  try {
    if (process.platform !== "win32") chmodSync(snapshotRoot, 0o700);
    for (const file of packageFiles) {
      const target = path.join(snapshotRoot, "cli", file.relativePath);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, file.bytes, { flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") chmodSync(target, 0o600);
    }
    const snapshotPackageRoot = path.join(snapshotRoot, "cli");
    const verifyCurrent = (): void => {
      if (
        hashBufferedFiles(collectPnpmInstallationFiles(pnpmInstallationRoot)) !==
          pnpmInstallationSha256 ||
        hashBufferedFiles(collectFiles(snapshotPackageRoot)) !== cliRuntimeSha256 ||
        createHash("sha256").update(readRegularFile(runnerPath)).digest("hex") !== runnerSha256 ||
        createHash("sha256").update(readRegularFile(lockPath)).digest("hex") !== pnpmLockSha256 ||
        sourceEvidence(root) !== foundrySourceSha256
      ) {
        return fail(
          "The pinned runtime, source, lock, or pnpm dependency bytes changed during the production case.",
          "CASE_RUNTIME_DRIFT",
        );
      }
    };
    return {
      entrypoint: path.join(snapshotRoot, "cli", binRelativePath),
      cliPackageName: CLI_PACKAGE_NAME,
      cliPackageVersion: CLI_PACKAGE_VERSION,
      cliEntrypointSha256: createHash("sha256").update(binFile.bytes).digest("hex"),
      cliRuntimeSha256,
      runnerSha256,
      pnpmLockSha256,
      pnpmInstallationSha256,
      foundrySourceSha256,
      verifyCurrent,
      cleanup: () =>
        rmSync(snapshotRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        }),
    };
  } catch (error) {
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

export function validateRuntimeEvidence(
  evidence: ProductionContactDraftRuntimeEvidence,
): ProductionContactDraftRuntimeEvidence {
  if (
    !path.isAbsolute(evidence.entrypoint) ||
    evidence.cliPackageName !== CLI_PACKAGE_NAME ||
    evidence.cliPackageVersion !== CLI_PACKAGE_VERSION ||
    !SHA256_PATTERN.test(evidence.cliEntrypointSha256) ||
    !SHA256_PATTERN.test(evidence.cliRuntimeSha256) ||
    !SHA256_PATTERN.test(evidence.runnerSha256) ||
    !SHA256_PATTERN.test(evidence.pnpmLockSha256) ||
    !SHA256_PATTERN.test(evidence.pnpmInstallationSha256) ||
    (evidence.foundrySourceSha256 !== undefined &&
      !SHA256_PATTERN.test(evidence.foundrySourceSha256)) ||
    typeof evidence.verifyCurrent !== "function" ||
    typeof evidence.cleanup !== "function"
  ) {
    return fail("Production case runtime evidence is invalid.", "CASE_RUNTIME_INVALID", 2);
  }
  return evidence;
}

export function assertReceiptRuntime(
  receipt: ReturnType<typeof parseFreshIntentBoundAuthReceipt>,
  runtime: ProductionContactDraftRuntimeEvidence,
): void {
  if (
    receipt.cli.package_name !== runtime.cliPackageName ||
    receipt.cli.package_version !== runtime.cliPackageVersion
  ) {
    return fail(
      "The identity receipt CLI does not match the pinned runtime.",
      "CASE_RECEIPT_RUNTIME_MISMATCH",
    );
  }
}

export function readCaseEnv(envFile: string, root: string): CaseEnv {
  let stats;
  try {
    stats = lstatSync(envFile);
  } catch {
    return fail("Production case env file is not readable.", "CASE_ENV_INVALID", 2);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return fail("Production case env file must be a regular file.", "CASE_ENV_INVALID", 2);
  }
  if ((stats.mode & 0o077) !== 0) {
    return fail(
      "Production case env file must be owner-private (0600 or stricter).",
      "CASE_ENV_NOT_PRIVATE",
      2,
    );
  }
  const relative = path.relative(root, envFile);
  if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", envFile], {
      cwd: root,
      env: systemEnv(process.env),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    if (ignored.status !== 0 || ignored.signal !== null || ignored.error) {
      return fail(
        "Production case env file inside the repository must be git-ignored.",
        "CASE_ENV_NOT_IGNORED",
        2,
      );
    }
  }
  let parsed: NodeJS.ProcessEnv;
  try {
    parsed = parseEnv(readFileSync(envFile, "utf8"));
  } catch {
    return fail("Production case env file could not be parsed.", "CASE_ENV_INVALID", 2);
  }
  const selected = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, token(parsed[key])]),
  ) as Record<(typeof REQUIRED_ENV_KEYS)[number], string | null>;
  const missing = REQUIRED_ENV_KEYS.filter((key) => !selected[key]);
  if (missing.length > 0) {
    return fail(
      `Missing required production-case env: ${missing.join(", ")}.`,
      "CASE_ENV_REQUIRED",
      2,
    );
  }
  requirePrivateOAuthSessionFile(selected.TIANGONG_LCA_SESSION_FILE as string);
  return selected as CaseEnv;
}

export function projectRefFromBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Production case API base URL is invalid.", "CASE_PROJECT_INVALID", 2);
  }
  const suffix = ".supabase.co";
  const hostname = url.hostname.toLowerCase();
  const projectRef = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : "";
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (
    url.protocol !== "https:" ||
    !PROJECT_REF_PATTERN.test(projectRef) ||
    projectRef.includes(".") ||
    !["", "/functions/v1", "/rest/v1"].includes(pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return fail("Production case API base URL is invalid.", "CASE_PROJECT_INVALID", 2);
  }
  return projectRef;
}

export function systemEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    if (typeof source[key] === "string") selected[key] = source[key];
  }
  return selected;
}

export function remoteEnv(source: NodeJS.ProcessEnv, caseEnv: CaseEnv): NodeJS.ProcessEnv {
  return {
    ...systemEnv(source),
    TIANGONG_LCA_API_BASE_URL: caseEnv.TIANGONG_LCA_API_BASE_URL,
    TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: caseEnv.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
    TIANGONG_LCA_AUTH_MODE: "oauth",
    TIANGONG_LCA_SESSION_FILE: caseEnv.TIANGONG_LCA_SESSION_FILE,
    TIANGONG_LCA_OAUTH_CLIENT_ID: caseEnv.TIANGONG_LCA_OAUTH_CLIENT_ID,
    TIANGONG_LCA_DISABLE_SESSION_CACHE: "false",
    TIANGONG_LCA_FORCE_REAUTH: "false",
  };
}
