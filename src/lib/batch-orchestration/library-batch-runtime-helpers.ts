import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { SchemaPaths } from "../bafu-classification/schema-repair.ts";
import type { BatchFinalizeStageResult as StageResult } from "../bafu-orchestration/batch-finalize-stage.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../foundry-runtime-utils.ts";
import { resolveFoundryStageSpawnCommand } from "../foundry-stage-invocation.ts";
import type { JsonRecord } from "./library-batch-profile-strategy.ts";
import type { UniverseCoverageRuntimeAdapter } from "./universe-coverage.ts";

export interface DatasetIdentity {
  id: string | null;
  version: string;
}

export interface LibraryBatchRuntime {
  nowIso: () => string;
  resolveRepoPath: (value: unknown) => string | null;
  repoRelativeMaybe: (filePath: string | null | undefined) => string | null;
  fileExists: (filePath: string | null | undefined) => boolean;
  directoryExists: (filePath: string | null | undefined) => boolean;
  readJson: (filePath: string) => unknown;
  readJsonLines: (filePath: string) => unknown[];
  writeJson: (filePath: string, value: unknown) => void;
  writeJsonLines: (filePath: string, rows: readonly unknown[]) => void;
  asText: (value: unknown) => string;
  booleanOption: (value: unknown) => boolean;
  integerOption: (value: unknown, fallback?: number | null) => number | null;
  normalizedList: (value: unknown) => string[];
  shellQuote: (value: string) => string;
  datasetIdentity: (
    row: unknown,
    datasetType: string,
  ) => {
    id?: string | null;
    version?: string | null;
  };
}

export const libraryBatchRuntimeKeys = [
  "nowIso",
  "resolveRepoPath",
  "repoRelativeMaybe",
  "fileExists",
  "directoryExists",
  "readJson",
  "readJsonLines",
  "writeJson",
  "writeJsonLines",
  "asText",
  "booleanOption",
  "integerOption",
  "normalizedList",
  "shellQuote",
  "datasetIdentity",
] as const satisfies readonly (keyof LibraryBatchRuntime)[];

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function jsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

export function resolveLibraryBatchRuntime(deps: unknown): LibraryBatchRuntime {
  const record = isJsonRecord(deps) ? deps : null;
  const missing = libraryBatchRuntimeKeys.filter((key) => typeof record?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(`createBafuBatchImportRunCommands missing dependencies: ${missing.join(", ")}`);
  }
  return deps as LibraryBatchRuntime;
}

export function createUniverseCoverageRuntimeAdapter(
  deps: LibraryBatchRuntime,
): UniverseCoverageRuntimeAdapter {
  const pathAdapter = Object.freeze({
    join: (...parts: string[]) => path.join(...parts),
    dirname: (filePath: string) => path.dirname(filePath),
    basename: (filePath: string, suffix?: string) => path.basename(filePath, suffix),
    isAbsolute: (filePath: string) => path.isAbsolute(filePath),
    resolve: (filePath: string) => path.resolve(filePath),
  });
  return Object.freeze({
    nowIso: deps.nowIso,
    resolveRepoPath: deps.resolveRepoPath,
    repoRelative: deps.repoRelativeMaybe,
    fileExists: deps.fileExists,
    directoryExists: deps.directoryExists,
    readJson: deps.readJson,
    readJsonLines: deps.readJsonLines,
    writeJson: deps.writeJson,
    writeJsonLines: deps.writeJsonLines,
    ensureDirectory: (directory: string) => fs.mkdirSync(directory, { recursive: true }),
    normalizedList: deps.normalizedList,
    asText: deps.asText,
    datasetIdentity: deps.datasetIdentity,
    path: pathAdapter,
    walkFiles: (rootDir: unknown, predicate: (filePath: string) => boolean): string[] => {
      const resolved = deps.resolveRepoPath(rootDir);
      if (!resolved || !fs.existsSync(resolved)) return [];
      const stack = [resolved];
      const files: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const next = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(next);
          else if (entry.isFile() && predicate(next)) files.push(next);
        }
      }
      return files.sort();
    },
  });
}

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function datasetTypeFromRow(row: JsonRecord): string | null {
  if (row?.contactDataSet) return "contact";
  if (row?.sourceDataSet) return "source";
  if (row?.flowDataSet) return "flow";
  if (row?.processDataSet) return "process";
  if (row?.unitGroupDataSet) return "unitgroup";
  if (row?.flowPropertyDataSet) return "flowproperty";
  return null;
}

export function parseJsonStdout(stdout: unknown): JsonRecord | null {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function appendOption(args: string[], name: string, value: unknown): void {
  if (value == null || value === "") return;
  if (value === true) {
    args.push(name);
    return;
  }
  args.push(name, String(value));
}

export function createLibraryBatchRuntimeHelpers({
  getRuntime,
  repoRoot,
  foundryEntryPath,
}: {
  getRuntime: () => LibraryBatchRuntime;
  repoRoot: string;
  foundryEntryPath: string;
}) {
  const nowIso = (): string => getRuntime().nowIso();
  const resolveRepoPath = (value: unknown): string | null => getRuntime().resolveRepoPath(value);
  const repoRelative = (filePath: string | null | undefined): string =>
    getRuntime().repoRelativeMaybe(filePath) as string;
  const fileExists = (filePath: string | null | undefined): boolean =>
    getRuntime().fileExists(filePath);
  const directoryExists = (filePath: string | null | undefined): boolean =>
    getRuntime().directoryExists(filePath);
  const readJson = (filePath: string): JsonRecord => getRuntime().readJson(filePath) as JsonRecord;
  const readJsonLines = (filePath: string | null | undefined): JsonRecord[] => {
    if (!fileExists(filePath)) return [];
    return getRuntime().readJsonLines(filePath!) as JsonRecord[];
  };
  const writeJson = (filePath: string, value: unknown): void => {
    getRuntime().writeJson(filePath, value);
  };
  const writeJsonLines = (filePath: string, rows: readonly unknown[]): void => {
    getRuntime().writeJsonLines(filePath, rows);
  };
  const appendJsonLine = (filePath: string, row: unknown): void => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
  };
  const sha256File = (filePath: string): string =>
    crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const asText = (value: unknown): string => getRuntime().asText(value);
  const booleanOption = (value: unknown): boolean => getRuntime().booleanOption(value);
  const integerOption = (value: unknown, fallback: number | null = null): number | null =>
    getRuntime().integerOption(value, fallback);
  const normalizedList = (value: unknown): string[] => getRuntime().normalizedList(value);
  const shellQuote = (value: string): string => getRuntime().shellQuote(value);
  const commandString = (argv: string[]): string => argv.map(shellQuote).join(" ");

  function findFiles(rootDir: unknown, predicate: (filePath: string) => boolean): string[] {
    const resolved = resolveRepoPath(rootDir);
    if (!resolved || !fs.existsSync(resolved)) return [];
    const stack = [resolved];
    const matches: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(next);
        else if (entry.isFile() && predicate(next)) matches.push(next);
      }
    }
    return matches.sort();
  }

  function findOneFile(rootDir: unknown, pattern: RegExp): string | null {
    const resolved = resolveRepoPath(rootDir);
    if (!directoryExists(resolved)) return null;
    const matches = fs
      .readdirSync(resolved!)
      .filter((name) => pattern.test(name))
      .sort();
    return matches.length ? path.join(resolved!, matches[0]) : null;
  }

  function requestedProcessIdValues(options: JsonRecord): string[] {
    const values = [...normalizedList(options.processId || options.processIds)];
    const fileOption = options.processIdFile ?? options.processIdsFile;
    if (fileOption == null || fileOption === false) return values;
    const filePath = resolveRepoPath(asText(fileOption));
    if (!filePath || !fileExists(filePath)) {
      throw new Error(`--process-id-file not found: ${filePath || asText(fileOption)}`);
    }
    const fileIds = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .flatMap((line) => line.split(",").map((entry) => entry.trim()))
      .filter(Boolean);
    return [...values, ...fileIds];
  }

  function datasetIdentity(row: JsonRecord, type: string): DatasetIdentity {
    const injected = getRuntime().datasetIdentity(row, type);
    if (injected?.id || injected?.version) {
      return {
        id: injected.id ?? null,
        version: injected.version || "00.00.001",
      };
    }
    const root = jsonRecord(row[`${type}DataSet`] ?? row);
    const typeInformation = jsonRecord(root[`${type}Information`]);
    const dataSetInformation =
      typeInformation.dataSetInformation ??
      typeInformation["common:dataSetInformation"] ??
      jsonRecord(root.processInformation).dataSetInformation ??
      jsonRecord(root.flowInformation).dataSetInformation ??
      {};
    const information = jsonRecord(dataSetInformation);
    const publication =
      jsonRecord(root.administrativeInformation).publicationAndOwnership ??
      jsonRecord(root.administrativeInformation)["common:publicationAndOwnership"] ??
      {};
    const publicationRecord = jsonRecord(publication);
    return {
      id:
        asText(information["common:UUID"]) ||
        asText(information.UUID) ||
        asText(row.dataset_id) ||
        asText(row.id),
      version:
        asText(publicationRecord["common:dataSetVersion"]) ||
        asText(publicationRecord.dataSetVersion) ||
        asText(row.dataset_version) ||
        asText(row.version) ||
        "00.00.001",
    };
  }

  function readRows(filePath: string | null | undefined): JsonRecord[] {
    if (!fileExists(filePath)) return [];
    if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
    const value: unknown = readJson(filePath!);
    if (Array.isArray(value)) return value.map(jsonRecord);
    const record = jsonRecord(value);
    if (Array.isArray(record.rows)) return record.rows.map(jsonRecord);
    return [record];
  }

  function uniqueExistingPaths(paths: unknown[]): string[] {
    return [
      ...new Set(
        paths
          .map(resolveRepoPath)
          .filter((filePath): filePath is string => Boolean(filePath && fileExists(filePath))),
      ),
    ];
  }

  function foundryCommand(command: string, options: JsonRecord = {}): string[] {
    const args = [process.execPath, foundryEntryPath, command];
    for (const [key, value] of Object.entries(options)) {
      const flag = `--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
      if (Array.isArray(value)) {
        for (const item of value) appendOption(args, flag, item);
      } else {
        appendOption(args, flag, value);
      }
    }
    return args;
  }

  function stageTimeoutMs(stage: unknown): number {
    const override = integerOption(process.env.BAFU_BATCH_STAGE_TIMEOUT_MS, null);
    if (override && override > 0) return override;
    const name = String(stage ?? "");
    if (name.includes("post_write_verify") || name.includes("verify")) return 180_000;
    if (name.includes("finalize")) return 900_000;
    if (name.includes("commit")) return 300_000;
    return 180_000;
  }

  function runStage({
    stage,
    command,
    logDir,
  }: {
    stage: string;
    command: string[];
    logDir: string;
  }): Promise<StageResult> {
    fs.mkdirSync(logDir, { recursive: true });
    const safeStage = stage.replace(/[^A-Za-z0-9_.-]+/gu, "-");
    const stdoutLog = path.join(logDir, `${safeStage}.stdout.log`);
    const stderrLog = path.join(logDir, `${safeStage}.stderr.log`);
    const startedAt = nowIso();
    return new Promise<StageResult>((resolve) => {
      const timeoutMs = stageTimeoutMs(stage);
      let timedOut = false;
      let closed = false;
      const childEnv = { ...process.env };
      delete childEnv.TIANGONG_LCA_FORCE_REAUTH;
      const invocation = resolveFoundryStageSpawnCommand(repoRoot, foundryEntryPath, command);
      const child = spawn(invocation.executable, invocation.args, {
        cwd: repoRoot,
        env: childEnv,
        shell: false,
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        stderr += `Stage timed out after ${timeoutMs} ms.\n`;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!closed) child.kill("SIGKILL");
        }, 10_000).unref();
      }, timeoutMs);
      timeout.unref();
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        stderr += `${error.stack || error.message || String(error)}\n`;
      });
      child.on("close", (code, signal) => {
        closed = true;
        clearTimeout(timeout);
        fs.writeFileSync(stdoutLog, stdout);
        fs.writeFileSync(stderrLog, stderr);
        resolve({
          stage,
          command: commandString(command),
          exit_code: timedOut ? 124 : typeof code === "number" ? code : 1,
          signal: signal ?? null,
          timed_out: timedOut,
          timeout_ms: timeoutMs,
          started_at_utc: startedAt,
          finished_at_utc: nowIso(),
          stdout_log: repoRelative(stdoutLog),
          stderr_log: repoRelative(stderrLog),
          json: parseJsonStdout(stdout),
        });
      });
    });
  }

  async function runArgvStage({
    stage,
    argv,
    logDir,
    reportPath,
  }: {
    stage: string;
    argv: string[];
    logDir: string;
    reportPath?: unknown;
  }): Promise<StageResult> {
    const result = await runStage({ stage, logDir, command: argv });
    const resolvedReport = resolveRepoPath(reportPath);
    if (fileExists(resolvedReport)) {
      result.json = readJson(resolvedReport!);
      result.report = repoRelative(resolvedReport);
    }
    return result;
  }

  function defaultSchemaFiles(options: JsonRecord): SchemaPaths {
    const schemaRoot = resolveRepoPath(
      options.tidasSchemaDir || resolveInstalledTiangongLcaCliPackage().schemaDir,
    );
    return {
      processCategory: path.join(schemaRoot!, "tidas_processes_category.json"),
      flowProductCategory: path.join(schemaRoot!, "tidas_flows_product_category.json"),
      flowElementaryCategory: path.join(schemaRoot!, "tidas_flows_elementary_category.json"),
      location: path.join(schemaRoot!, "tidas_locations_category.json"),
      allClassification: [
        "tidas_contacts_category.json",
        "tidas_flowproperties_category.json",
        "tidas_flows_elementary_category.json",
        "tidas_flows_product_category.json",
        "tidas_lciamethods_category.json",
        "tidas_processes_category.json",
        "tidas_sources_category.json",
        "tidas_unitgroups_category.json",
      ].map((name) => path.join(schemaRoot!, name)),
    };
  }

  return {
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
    shellQuote,
    commandString,
    findFiles,
    findOneFile,
    requestedProcessIdValues,
    datasetIdentity,
    readRows,
    uniqueExistingPaths,
    foundryCommand,
    stageTimeoutMs,
    runStage,
    runArgvStage,
    defaultSchemaFiles,
  };
}
