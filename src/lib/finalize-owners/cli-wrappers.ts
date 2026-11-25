import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { buildFoundryCurationQueue } from "../foundry-curation-queue.ts";
import { applyTypedAuthoringPatch } from "../foundry-typed-authoring-patch.ts";
import { runTypedDatasetQa } from "../foundry-typed-flow-qa.ts";
import { createFoundryIsolatedChildEnvironment } from "../foundry-runtime-environment.ts";

type JsonRecord = Record<string, unknown>;

type CliResolution = {
  command: string;
  args: string[];
  display: string;
  package: string | JsonRecord | null;
  package_version?: string | null;
};

type JsonCliResult = {
  cliBin: string;
  cli: CliResolution;
  spawnArgs: string[];
  exitCode: number;
  report: JsonRecord;
  stderr: string;
};

export type CliWrapperOptions = Record<string, unknown> & {
  help?: unknown;
  processes?: unknown;
  processesFile?: unknown;
  processRows?: unknown;
  outDir?: unknown;
  flows?: unknown;
  flowsFile?: unknown;
  flowRows?: unknown;
  support?: unknown;
  supportFile?: unknown;
  supportRows?: unknown;
  externalFlowRef?: unknown;
  externalFlowRefs?: unknown;
  excludeProcessId?: unknown;
  excludeProcessIds?: unknown;
  processLimit?: unknown;
  input?: unknown;
  rowsFile?: unknown;
  rows?: unknown;
  patch?: unknown;
  patchFile?: unknown;
  patches?: unknown;
  suggestions?: unknown;
  out?: unknown;
  outFile?: unknown;
  authoringPackageDir?: unknown;
  authoringPackagesDir?: unknown;
  requireAuthoringPackage?: unknown;
  requireActionItemClosure?: unknown;
};

export type CliWrapperFactoryDependencies = {
  executionEnvironment?: NodeJS.ProcessEnv;
  executionCwd?: string;
  appendOption: (args: string[], option: string, value: unknown) => unknown;
  appendRepeatedOptions: (args: string[], option: string, value: unknown) => unknown;
  repoRoot: string;
  resolveTiangongLcaCliCommand?: () => CliResolution;
  resolveTiangongLcaCliBin: () => string;
};

export function createCliWrapperCommands({
  executionEnvironment = process.env,
  executionCwd,
  appendOption,
  appendRepeatedOptions,
  repoRoot,
  resolveTiangongLcaCliCommand,
  resolveTiangongLcaCliBin,
}: CliWrapperFactoryDependencies) {
  function runJsonCli(cliArgs: string[], errorMessage: string, temporary?: string): JsonCliResult {
    const cli = resolveTiangongLcaCliCommand
      ? resolveTiangongLcaCliCommand()
      : {
          command: resolveTiangongLcaCliBin(),
          args: [],
          display: resolveTiangongLcaCliBin(),
          package: null,
        };
    const spawnArgs = [...cli.args, ...cliArgs];
    const result = spawnSync(cli.command, spawnArgs, {
      cwd: temporary ?? executionCwd ?? repoRoot,
      env: temporary
        ? createFoundryIsolatedChildEnvironment({ tempRoot: temporary })
        : executionEnvironment,
      encoding: "utf8",
      // Mega-scope stages emit large JSON payloads on stdout; the 1MB spawnSync
      // default overflows with ENOBUFS. Cap below V8's max string length.
      maxBuffer: 512 * 1024 * 1024,
    });
    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (result.error) {
      throw result.error;
    }
    let report: JsonRecord;
    try {
      report = JSON.parse(result.stdout || "{}") as JsonRecord;
    } catch {
      throw new Error(
        [
          errorMessage,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return {
      cliBin: cli.display,
      cli,
      spawnArgs,
      exitCode,
      report,
      stderr: result.stderr || "",
    };
  }

  const localPath = (name: unknown) => path.resolve(executionCwd ?? repoRoot, String(name));
  function writeLocalText(file: string, value: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
  }
  const localStage = (temporary: string) => ({
    workspace: temporary,
    readInput: fs.readFileSync,
    readRowsFile: (file: string) => fs.readFileSync(file, "utf8"),
    readResult(file: string) {
      if (!fs.lstatSync(file).isFile())
        throw new Error("Expected a regular typed CLI result file.");
      return fs.readFileSync(file);
    },
    writeJson: (file: string, value: unknown) =>
      writeLocalText(file, JSON.stringify(value, null, 2) + "\n"),
    run(args: string[]) {
      const { exitCode, report } = runJsonCli(
        args,
        "Typed CLI stage did not emit JSON.",
        temporary,
      );
      return { exit: exitCode, report, validate: <T>(check: () => T) => check() };
    },
  });
  function runDatasetQaStage(stage: string, argv: string[]) {
    const qaType = argv[0] === "qa" ? argv[1] : null;
    if (qaType !== "flow" && qaType !== "process" && qaType !== "lifecyclemodel") return null;
    const cli = resolveTiangongLcaCliCommand?.();
    if (cli?.package_version !== "0.4.0") return null;
    const rowsFile = localPath(argv[argv.indexOf("--rows-file") + 1]);
    const directory = localPath(argv[argv.indexOf("--out-dir") + 1]);
    const referenceFiles = argv.flatMap((value, index) =>
      value === "--reference-rows-file" ? [localPath(argv[index + 1])] : [],
    );
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-local-qa-"));
    try {
      const result = runTypedDatasetQa(
        qaType,
        rowsFile,
        directory,
        { referenceFiles },
        localStage(temporary),
      );
      return {
        stage,
        exit_code: result.exit || (qaType !== "process" && result.report.findings.length) ? 2 : 0,
        report: result.report,
        report_file: result.reportFile,
        ...(qaType === "process"
          ? { cli_validation: { report: result.validationReportFile, exit: result.exit } }
          : {}),
        status: result.report.status,
        command: cli.command,
        args: [...cli.args, "dataset", qaType === "lifecyclemodel" ? "model" : qaType, "validate"],
        stderr: "",
      };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  function runDatasetCurationQueueBuild(options: CliWrapperOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-curation-queue-build",
        wraps: "tiangong-lca dataset curation-queue build",
        usage: [
          "tiangong-lca dataset curation-queue build --processes <processes.jsonl> --out-dir <queue-dir>",
          "node src/dev-cli.ts dataset-curation-queue-build --processes ./rows/processes.jsonl --flows ./rows/flows.jsonl --support ./rows/sources.jsonl --out-dir ./curation-queue",
        ],
        foundry_wrapper: {
          exit_code: 0,
          owner: "tiangong-lca-cli",
        },
      };
    }
    const processes = options.processes || options.processesFile || options.processRows;
    const outDir = options.outDir || ".foundry/workspaces/dataset-curation-queue";
    const cliArgs = ["dataset", "curation-queue", "build", "--json"];
    appendOption(cliArgs, "--processes", processes);
    appendOption(cliArgs, "--flows", options.flows || options.flowsFile || options.flowRows);
    appendRepeatedOptions(
      cliArgs,
      "--support",
      options.support || options.supportFile || options.supportRows,
    );
    appendRepeatedOptions(
      cliArgs,
      "--external-flow-ref",
      options.externalFlowRef || options.externalFlowRefs,
    );
    appendRepeatedOptions(
      cliArgs,
      "--exclude-process-id",
      options.excludeProcessId || options.excludeProcessIds,
    );
    appendOption(cliArgs, "--process-limit", options.processLimit);
    appendOption(cliArgs, "--out-dir", outDir);

    const cliVersion = resolveTiangongLcaCliCommand?.().package_version;
    if (cliVersion === "0.4.0") {
      const cwd = executionCwd ?? repoRoot;
      const file = (name: string) => path.resolve(cwd, name);
      const repeated = (flag: string) =>
        cliArgs.flatMap((name, index) => (name === flag ? [cliArgs[index + 1]] : []));
      const processLimit = repeated("--process-limit")[0];
      const limit = processLimit === undefined ? undefined : Number.parseInt(processLimit, 10);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        throw new Error("--process-limit must be a positive integer.");
      const [processesFile] = repeated("--processes");
      if (!processesFile) throw new Error("--processes requires a Process rows file.");
      const [flowsFile] = repeated("--flows");
      const report = buildFoundryCurationQueue({
        processes: file(processesFile),
        flows: flowsFile ? file(flowsFile) : null,
        support: repeated("--support").map(file),
        external: repeated("--external-flow-ref").map(file),
        excludeProcessIds: repeated("--exclude-process-id"),
        processLimit: limit,
        outDir: file(String(outDir)),
      });
      return {
        ...report,
        foundry_wrapper: { exit_code: report.blockers.length ? 1 : 0, owner: "foundry" },
      };
    }

    const { cliBin, cli, spawnArgs, exitCode, report, stderr } = runJsonCli(
      cliArgs,
      "tiangong-lca dataset curation-queue build did not emit JSON.",
    );
    return {
      ...report,
      foundry_wrapper: {
        command: cliBin,
        executable: cli.command,
        args: spawnArgs,
        cli_args: cliArgs,
        cli_package: cli.package,
        exit_code: exitCode,
        stderr,
        owner: "tiangong-lca-cli",
      },
    };
  }

  function runDatasetPatchApply(options: CliWrapperOptions): JsonRecord {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-patch-apply",
        wraps: "tiangong-lca dataset patch apply",
        usage: [
          "node src/dev-cli.ts dataset-patch-apply --input <rows.jsonl> --patch <ai-patches.json> --out <patched.jsonl> --out-dir <apply-dir>",
          "node src/dev-cli.ts dataset-patch-apply --input ./rows/processes.jsonl --patch ./curation/patches.json --out ./rows/processes.patched.jsonl --out-dir ./patch-apply --authoring-package-dir ./curation-gate/ai-authoring-packages --require-action-item-closure",
        ],
        foundry_wrapper: {
          exit_code: 0,
          owner: "tiangong-lca-cli",
          stage: "post_ai_authoring_deterministic_apply",
        },
      };
    }

    const input = options.input || options.rowsFile || options.rows;
    const patch = options.patch || options.patchFile || options.patches || options.suggestions;
    const outDir = (options.outDir || ".foundry/workspaces/dataset-patch-apply") as string;
    const out = options.out || options.outFile || path.join(outDir, "patched-rows.jsonl");
    if (resolveTiangongLcaCliCommand?.().package_version === "0.4.0") {
      if (!input || !patch) throw new Error("Dataset patch apply requires --input and --patch.");
      const packageDir = options.authoringPackageDir || options.authoringPackagesDir;
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-local-patch-"));
      const io = localStage(temporary);
      try {
        const result = applyTypedAuthoringPatch(
          {
            input: localPath(input),
            patch: localPath(patch),
            output: localPath(out),
            directory: localPath(outDir),
            packageDirectory: packageDir ? localPath(packageDir) : undefined,
            requirePackage:
              options.requireAuthoringPackage === true ||
              options.requireAuthoringPackage === "true",
            requireClosure:
              options.requireActionItemClosure === true ||
              options.requireActionItemClosure === "true",
            writeText: writeLocalText,
            writeJson: io.writeJson,
          },
          io,
        );
        return {
          ...result.report,
          foundry_wrapper: {
            exit_code: result.exit,
            owner: "tiangong-lca-cli",
            remote_write_mode: "read-only",
          },
        };
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }

    const cliArgs = ["dataset", "patch", "apply", "--json"];
    appendOption(cliArgs, "--input", input);
    appendOption(cliArgs, "--patch", patch);
    appendOption(cliArgs, "--out", out);
    appendOption(cliArgs, "--out-dir", outDir);
    appendOption(
      cliArgs,
      "--authoring-package-dir",
      options.authoringPackageDir || options.authoringPackagesDir,
    );
    if (options.requireAuthoringPackage === true || options.requireAuthoringPackage === "true") {
      cliArgs.push("--require-authoring-package");
    }
    if (options.requireActionItemClosure === true || options.requireActionItemClosure === "true") {
      cliArgs.push("--require-action-item-closure");
    }

    const { cliBin, cli, spawnArgs, exitCode, report, stderr } = runJsonCli(
      cliArgs,
      "tiangong-lca dataset patch apply did not emit JSON.",
    );
    return {
      ...report,
      foundry_wrapper: {
        command: cliBin,
        executable: cli.command,
        args: spawnArgs,
        cli_args: cliArgs,
        cli_package: cli.package,
        exit_code: exitCode,
        stderr,
        owner: "tiangong-lca-cli",
        stage: "post_ai_authoring_deterministic_apply",
        remote_write_mode: "read-only",
      },
    };
  }

  return {
    runDatasetCurationQueueBuild,
    runDatasetPatchApply,
    runDatasetQaStage,
  };
}
