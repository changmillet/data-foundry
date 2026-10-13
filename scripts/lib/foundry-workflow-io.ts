import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  FoundryContextError,
  assertFoundryWorkspaceWrite,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import {
  bindWorkflowChildExecution,
  workflowChildFailure,
  WorkflowChildFailure,
} from "./foundry-workflow-child-failure.ts";
import type { FoundryTaskOperation } from "./foundry-task-types.ts";

export function createWorkflowDirectory(context: FoundryRuntimeContext, prefix: string): string {
  assertFoundryWorkspaceWrite(context);
  const directory = resolveFoundryOutput(context, `${prefix}${randomUUID()}`);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  resolveFoundryOutput(context, directory);
  // mkdir is exclusive and supports long Windows paths where mkdtemp fails.
  fs.mkdirSync(directory, { mode: 0o700 });
  return resolveFoundryOutput(context, directory);
}

export function createWorkflowStageDirectory(
  context: FoundryRuntimeContext,
  operation: FoundryTaskOperation,
  stage: string,
): string {
  return createWorkflowDirectory(context, `outputs/${stage}/${operation.operationId}/run-`);
}

export function registerWorkflowStageFiles(
  context: FoundryRuntimeContext,
  operation: FoundryTaskOperation,
  directory: string | readonly string[],
): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    resolveFoundryOutput(context, current);
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new FoundryContextError(
          "workflow_output_invalid",
          "Stage outputs must be regular files.",
        );
      if (stat.isDirectory()) visit(file);
      else {
        if (files.length >= 9_998)
          throw new FoundryContextError(
            "workflow_output_limit",
            "Stage exceeds the task artifact limit.",
          );
        files.push(file);
      }
    }
  };
  // Snapshot only the selected roots; one result retains one complete capture roster.
  for (const root of typeof directory === "string" ? [directory] : [...directory]) visit(root);
  operation.registerExistingFiles(files);
  return files;
}

/** Existing owner-selected report paths must belong to this actual call's output generation. */
export function assertWorkflowReportArtifact(
  context: FoundryRuntimeContext,
  file: string,
  selectedDir: string,
): string {
  const output = resolveFoundryOutput(context, selectedDir);
  const current = resolveFoundryOutput(context, file);
  const relative = path.relative(output, current);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new FoundryContextError(
      "workflow_report_invalid",
      "The child report locator is outside this call's output directory.",
    );
  const stat = fs.lstatSync(current);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw new FoundryContextError(
      "workflow_report_invalid",
      "The child report must be a bounded regular output artifact.",
    );
  return current;
}

export function runWorkflowLocalCli(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  argv: readonly string[],
): Record<string, unknown> {
  const result = runWorkflowLocalCliResult(context, qualified, temporary, argv);
  if (![0, 2].includes(result.exit) || "error" in result.report) throw result.failure();
  return result.report;
}

export function runWorkflowLocalCliResult(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  argv: readonly string[],
): {
  exit: number;
  report: Record<string, unknown>;
  failure: (rejection?: unknown) => WorkflowChildFailure;
  validate: <T>(check: () => T) => T;
  verifyReportFile: (file: string) => void;
} {
  const local =
    (argv[0] === "dataset" && argv[1] === "validate") ||
    (argv[0] === "qa" && ["flow", "process", "lifecyclemodel"].includes(argv[1])) ||
    (argv[0] === "dataset" && argv[1] === "curation-queue" && argv[2] === "build") ||
    (argv[0] === "dataset" &&
      argv[1] === "classification" &&
      ["apply", "audit"].includes(argv[2])) ||
    (argv[0] === "dataset" && argv[1] === "patch" && argv[2] === "apply");
  if (!local)
    throw new FoundryContextError(
      "workflow_command_invalid",
      "This stage admits local validation, QA, queue preparation and patch application only.",
    );
  assertQualifiedFoundryRuntime(context, qualified);
  const cli = resolveInstalledTiangongLcaCliPackage();
  const execution = bindWorkflowChildExecution(context, qualified, cli.binPath, argv);
  const child = spawnSync(process.execPath, [cli.binPath, ...argv], {
    cwd: context.workspaceRoot,
    env: createFoundryIsolatedChildEnvironment({ tempRoot: temporary }),
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const kind = child.error
    ? "spawn_error"
    : child.signal
      ? "signal"
      : ![0, 1, 2].includes(child.status ?? -1)
        ? "exit_code"
        : !child.stdout.trim()
          ? "empty_stdout"
          : null;
  if (kind) throw workflowChildFailure(execution, child, kind);
  let report: unknown;
  try {
    report = JSON.parse(child.stdout);
  } catch {
    throw workflowChildFailure(execution, child, "malformed_json");
  }
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw workflowChildFailure(execution, child, "invalid_report");
  if (
    "error" in report ||
    !("status" in report) ||
    typeof report.status !== "string" ||
    !report.status.trim()
  )
    throw workflowChildFailure(
      execution,
      child,
      "stage_rejected",
      new FoundryContextError(
        "workflow_report_invalid",
        "Local CLI returned an error or no stage status.",
      ),
    );
  assertQualifiedFoundryRuntime(context, qualified);
  const failure = (rejection?: unknown) =>
    workflowChildFailure(execution, child, "stage_rejected", rejection);
  return {
    exit: child.status!,
    report,
    failure,
    verifyReportFile(file: string): void {
      try {
        const selectedDir = argv[argv.indexOf("--out-dir") + 1];
        if (!argv.includes("--out-dir") || typeof selectedDir !== "string")
          throw new FoundryContextError(
            "workflow_report_invalid",
            "The child report has no bound output directory.",
          );
        const current = assertWorkflowReportArtifact(context, file, selectedDir);
        const recorded: unknown = JSON.parse(fs.readFileSync(current, "utf8"));
        if (JSON.stringify(recorded) !== JSON.stringify(report))
          throw new FoundryContextError(
            "workflow_report_invalid",
            "The child report file differs from its original returned report.",
          );
      } catch (error) {
        throw failure(error);
      }
    },
    validate<T>(check: () => T): T {
      try {
        return check();
      } catch (error) {
        if (error instanceof WorkflowChildFailure) throw error;
        throw failure(error);
      }
    },
  };
}
