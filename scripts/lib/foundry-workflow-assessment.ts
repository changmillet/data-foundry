import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryAsset,
  resolveFoundryOutput,
  captureFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { copyFoundryIsolatedExecutable } from "./foundry-runtime-environment.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import { runTidasRowsValidation } from "./tidas-adapter.ts";
import { runDatasetCurationGate } from "./import-curation/curation-gate.ts";
import { runDatasetAuthoringTaskBuild } from "./import-curation/authoring-packages.ts";
import { routeFoundryDecisionAction } from "./foundry-decision-routing.ts";
import { prepareFoundryDecisionWork } from "./foundry-workflow-decisions.ts";
import {
  currentWorkflowState,
  workflowAssessmentQueueScopeSha256,
} from "./foundry-workflow-state.ts";
import { currentFoundryInteractionState } from "./foundry-interaction-input.ts";
import {
  applicableFoundryInteractionDigest,
  applicableFoundryInteractionProjection,
} from "./foundry-interaction-projection.ts";
import {
  createWorkflowStageDirectory,
  createWorkflowDirectory,
  registerWorkflowStageFiles,
  runWorkflowLocalCli,
  runWorkflowLocalCliResult,
} from "./foundry-workflow-io.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FoundryContextError("workflow_report_invalid", "Stage metadata must be an object.");
  return value as Record<string, unknown>;
}

function assertCurrentQueueBuild(
  context: FoundryRuntimeContext,
  queueDir: string,
  result: { exit: number; report: Record<string, unknown> },
  sets: readonly Record<string, unknown>[],
): void {
  const invalid = (): never => {
    throw new FoundryContextError(
      "workflow_queue_invalid",
      "The local curation queue report does not match current rows and bounded output files.",
    );
  };
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : invalid();
  const exactJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const expectedPath = (value: unknown, expected: string) => value === expected;
  const outputFile = (value: unknown, expected: string) => {
    if (!expectedPath(value, expected)) return invalid();
    try {
      const fact = captureFoundryInput(expected);
      if (fact.path !== expected || fact.bytes > 32 * 1024 * 1024) return invalid();
      const bytes = fs.readFileSync(expected);
      if (
        bytes.length !== fact.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== fact.sha256
      )
        return invalid();
      return bytes.toString("utf8");
    } catch {
      return invalid();
    }
  };
  const jsonFile = (value: unknown, expected: string): unknown => {
    try {
      return JSON.parse(outputFile(value, expected));
    } catch {
      return invalid();
    }
  };
  const jsonLines = (value: unknown, expected: string): unknown[] => {
    try {
      return outputFile(value, expected)
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
    } catch {
      return invalid();
    }
  };
  try {
    if (fs.realpathSync(queueDir) !== queueDir) invalid();
  } catch {
    invalid();
  }
  const report = result.report;
  if (
    report.schema_version !== 1 ||
    !(
      (result.exit === 0 && report.status === "ready") ||
      (result.exit === 1 && report.status === "blocked")
    ) ||
    !expectedPath(report.out_dir, queueDir)
  )
    invalid();
  const typedSets = sets.map((set) => {
    if (
      typeof set.type !== "string" ||
      typeof set.file !== "string" ||
      typeof set.count !== "number" ||
      !Number.isSafeInteger(set.count) ||
      set.count < 0
    )
      return invalid();
    return { type: set.type, file: set.file, count: set.count };
  });
  const processes = typedSets.find((set) => set.type === "process");
  const flows = typedSets.find((set) => set.type === "flow");
  const support = typedSets.filter((set) =>
    ["contact", "source", "unitgroup", "flowproperty"].includes(set.type),
  );
  if (!processes) return invalid();
  const selected = [processes, ...(flows ? [flows] : []), ...support];
  const inputs = object(report.inputs);
  const supportPaths = support.map((set) => set.file);
  if (
    !expectedPath(inputs.processes, processes.file) ||
    (flows ? !expectedPath(inputs.flows, flows.file) : inputs.flows !== null) ||
    !exactJson(inputs.support, supportPaths) ||
    !exactJson(inputs.external_flow_refs, [])
  )
    invalid();
  const expectedHashes = new Map(
    selected.map((set) => {
      const file = set.file;
      readFoundryInput(context, file);
      return [file, captureFoundryInput(file).sha256] as const;
    }),
  );
  const hashes = object(object(report.hashes).inputs);
  const taskRecords = Array.isArray(report.tasks) ? report.tasks.map(object) : invalid();
  const taskIds = taskRecords.map((task) => {
    if (typeof task.task_id !== "string" || !task.task_id) return invalid();
    return task.task_id;
  });
  if (
    !exactJson(Object.keys(hashes).sort(), [...expectedHashes.keys()].sort()) ||
    [...expectedHashes].some(([file, sha256]) => hashes[file] !== sha256) ||
    object(report.hashes).task_order !==
      createHash("sha256").update(taskIds.join("\n")).digest("hex")
  )
    invalid();
  const counts = object(report.counts);
  const supportCount = support.reduce((total, set) => total + set.count, 0);
  // This call supplies no process filters; the CLI emits one task and lock per selected row.
  const expectedTasks = processes.count + (flows?.count ?? 0) + supportCount;
  const blockers = report.blockers;
  const tasks = report.tasks;
  if (!Array.isArray(blockers) || !Array.isArray(tasks)) return invalid();
  for (const candidate of blockers) {
    const blocker = object(candidate);
    if (
      blocker.schema_version !== 1 ||
      blocker.severity !== "blocker" ||
      typeof blocker.code !== "string" ||
      !blocker.code ||
      typeof blocker.message !== "string" ||
      !blocker.message
    )
      invalid();
    if (blocker.code === "process_flow_reference_unresolved") {
      const refs = object(blocker.details).missing_flow_refs;
      if (!Array.isArray(refs) || !refs.length) return invalid();
      for (const candidateRef of refs) {
        const ref = object(candidateRef);
        if (
          typeof ref.id !== "string" ||
          !ref.id ||
          !(ref.version === null || (typeof ref.version === "string" && ref.version)) ||
          typeof ref.path !== "string" ||
          !ref.path
        )
          invalid();
      }
    }
  }
  if (
    counts.process_rows !== processes.count ||
    counts.flow_rows !== (flows?.count ?? 0) ||
    counts.support_rows !== supportCount ||
    counts.external_flow_refs !== 0 ||
    counts.tasks !== expectedTasks ||
    counts.blockers !== blockers.length ||
    tasks.length !== expectedTasks ||
    (report.status === "blocked") !== blockers.length > 0
  )
    invalid();
  const files = object(report.files);
  const outputs = path.join(queueDir, "outputs");
  const manifest = jsonFile(files.manifest, path.join(outputs, "curation-queue-manifest.json"));
  const taskRows = jsonLines(files.tasks, path.join(outputs, "curation-queue-tasks.jsonl"));
  const blockerRows = jsonLines(
    files.blockers,
    path.join(outputs, "curation-queue-blockers.jsonl"),
  );
  const locks = object(jsonFile(files.locks, path.join(outputs, "curation-queue-locks.json")));
  if (!Array.isArray(locks.locks)) return invalid();
  if (
    !exactJson(manifest, report) ||
    !exactJson(taskRows, tasks) ||
    !exactJson(blockerRows, blockers) ||
    locks.schema_version !== 1 ||
    locks.locks.length !== tasks.length
  )
    invalid();
  for (let index = 0; index < taskRecords.length; index += 1) {
    const task = taskRecords[index],
      lock = object(locks.locks[index]);
    for (const key of ["task_id", "entity_type", "entity_id", "version", "lock_key"])
      if (task[key] !== lock[key]) invalid();
  }
  for (const candidate of tasks) {
    const task = object(candidate);
    for (const key of ["input_rows_file", "closure_file", "run_plan_file"]) {
      const file = task[key];
      if (typeof file !== "string" || file !== path.resolve(file)) return invalid();
      const resolved = path.resolve(file);
      if (!resolved.startsWith(`${queueDir}${path.sep}`)) invalid();
      outputFile(file, resolved);
    }
  }
}

export interface FoundryAssessmentOptions {
  /** Omit to retain the original all-set operation for direct callers. */
  scopeType?: string;
  previousAssessment?: string;
  interactionSha256?: string | null;
}

export function assessFoundryWorkflowRows(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  rowsReport: string,
  contextReports: readonly string[],
  identityReport?: string,
  options: FoundryAssessmentOptions = {},
) {
  assertQualifiedFoundryRuntime(context, qualified);
  resolveFoundryAsset(context, "specs/prewrite-content-policy.json");
  resolveFoundryAsset(context, "specs/import-profiles.json");
  const previous = options.previousAssessment
    ? captureFoundryInput(options.previousAssessment)
    : null;
  if (previous) readFoundryInput(context, previous.path);
  if (options.previousAssessment && !options.scopeType)
    throw new FoundryContextError(
      "workflow_assessment_invalid",
      "An assessment predecessor requires a selected row set.",
    );
  let selectedState: ReturnType<typeof currentWorkflowState> | null = null;
  let selectedInteraction: ReturnType<typeof currentFoundryInteractionState> = null;
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-workflow-assessment",
      options: {
        rows_report: rowsReport,
        context_reports: contextReports,
        identity_report: identityReport ?? null,
        ...(options.scopeType
          ? {
              scope_type: options.scopeType,
              previous_assessment_sha256: previous?.sha256 ?? null,
            }
          : {}),
        ...(options.interactionSha256 ? { interaction_sha256: options.interactionSha256 } : {}),
      },
      validateCurrent(index) {
        const state = currentWorkflowState(context, index);
        selectedState = state;
        selectedInteraction = currentFoundryInteractionState(context, index);
        if (state.rows?.file !== rowsReport)
          throw new FoundryContextError(
            "workflow_rows_changed",
            "Current rows changed before assessment.",
          );
        if (
          (state.identity?.value.status === "completed" ? state.identity.file : null) !==
          (identityReport ?? null)
        )
          throw new FoundryContextError(
            "workflow_identity_changed",
            "Current identity evidence changed before assessment.",
          );
        if (state.interactionSha256 !== (options.interactionSha256 ?? null))
          throw new FoundryContextError(
            "workflow_interaction_changed",
            "Current task decisions changed before assessment.",
          );
        if (!options.scopeType) return;
        const current = state.assessment;
        if (current?.file === (previous?.path ?? null) || (!current && !previous)) return;
        // A concurrent identical operation can have completed before this caller obtains the lock.
        // The receipt path below will replay that exact result, without advancing another scope.
        if (
          current?.value.previous_assessment === (previous?.path ?? null) &&
          current.value.assessed_type === options.scopeType
        )
          return;
        throw new FoundryContextError(
          "workflow_assessment_changed",
          "Assessment progress changed before this row set was checked.",
        );
      },
    },
    (operation) => {
      for (const input of context.inputs) readFoundryInput(context, input.path);
      const rows = record(JSON.parse(readFoundryInput(context, rowsReport).toString("utf8")));
      if (rows.schema !== "tiangong-foundry.rows-stage.v1" || !Array.isArray(rows.sets))
        throw new FoundryContextError(
          "workflow_rows_invalid",
          "Select the current registered row sets.",
        );
      const identity = identityReport
        ? record(JSON.parse(readFoundryInput(context, identityReport).toString("utf8")))
        : null;
      if (
        identity &&
        (identity.status !== "completed" ||
          identity.rows_report !== rowsReport ||
          !Array.isArray(identity.sets))
      )
        throw new FoundryContextError(
          "workflow_identity_invalid",
          "Identity preflight must bind these current rows.",
        );
      const contracts = new Map<string, Record<string, unknown>>();
      const contractShaByType = new Map<string, string>();
      const retainedReports = (key: string) => {
        const value = rows[key] ?? [];
        if (!Array.isArray(value) || value.some((file) => typeof file !== "string"))
          throw new FoundryContextError(
            "workflow_rows_invalid",
            "Retained identity reports are invalid.",
          );
        return value.map((file) => {
          readFoundryInput(context, file);
          return String(file);
        });
      };
      const identityApplyReports = retainedReports("identity_reports");
      const identityRewriteReports = retainedReports("identity_rewrite_reports").map((file) =>
        record(JSON.parse(readFoundryInput(context, file).toString("utf8"))),
      );
      for (const file of contextReports) {
        const value = record(JSON.parse(readFoundryInput(context, file).toString("utf8")));
        if (value.status !== "completed" || typeof value.type !== "string")
          throw new FoundryContextError(
            "workflow_context_invalid",
            "A contract pack is incomplete.",
          );
        contracts.set(value.type, record(value.files));
        contractShaByType.set(value.type, captureFoundryInput(file).sha256);
      }
      const output = createWorkflowStageDirectory(context, operation, "assessment");
      fs.mkdirSync(resolveFoundryOutput(context, "tmp"), { recursive: true, mode: 0o700 });
      const temporary = createWorkflowDirectory(
        context,
        path.join(context.tempRoot, "assessment-"),
      );
      try {
        const executable = path.join(temporary, path.basename(qualified.tidas.executable_path));
        copyFoundryIsolatedExecutable(qualified.tidas.executable_path, executable);
        const actual = captureFoundryInput(executable),
          expected = qualified.tidas.expectation.executable;
        if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
          throw new FoundryContextError(
            "runtime_tidas_unqualified",
            "Selected native bytes changed.",
          );
        const environment = createFoundryIsolatedChildEnvironment({ tempRoot: temporary });
        const selectedSets = rows.sets.map(record);
        for (const set of selectedSets) {
          if (typeof set.type !== "string" || typeof set.file !== "string")
            throw new FoundryContextError("workflow_rows_invalid", "A row set is invalid.");
          readFoundryInput(context, set.file);
        }
        const previousReport = previous
          ? record(JSON.parse(readFoundryInput(context, previous.path).toString("utf8")))
          : null;
        const previousSets = selectedState?.assessment?.value.sets ?? [];
        if (options.scopeType) {
          if (
            (previousReport &&
              (previousReport.schema !== "tiangong-foundry.assessment-stage.v1" ||
                previousReport.owner_base !== context.assetRoot ||
                !["in_progress", "completed"].includes(String(previousReport.status)))) ||
            (previous && selectedState?.assessment?.file !== previous.path) ||
            (!previous && selectedState?.assessment) ||
            previousSets.length >= selectedSets.length ||
            !selectedState?.assessmentRemainingTypes.includes(options.scopeType)
          )
            throw new FoundryContextError(
              "workflow_assessment_invalid",
              "Select the next row set against the current registered assessment progress.",
            );
        }
        for (const set of previousSets) {
          for (const key of [
            "rows",
            "schema_report",
            "qa_report",
            "curation_report",
            "authoring_manifest",
            "interaction_context",
          ]) {
            const file = set[key];
            if (file !== undefined) readFoundryInput(context, String(file));
          }
        }
        const queueScopeSha256 = workflowAssessmentQueueScopeSha256(
          selectedSets.map((set) => ({
            type: String(set.type),
            file: String(set.file),
            count: Number(set.count),
          })),
        );
        const processes = selectedSets.find((set) => set.type === "process");
        let queueDir: string | undefined;
        if (processes && (!options.scopeType || ["flow", "process"].includes(options.scopeType))) {
          if (typeof processes.file !== "string")
            throw new FoundryContextError("workflow_rows_invalid", "Process rows are missing.");
          queueDir = path.join(output, "queue");
          const args = [
            "dataset",
            "curation-queue",
            "build",
            "--processes",
            processes.file,
            "--out-dir",
            queueDir,
            "--json",
          ];
          for (const set of selectedSets) {
            if (typeof set.file !== "string")
              throw new FoundryContextError("workflow_rows_invalid", "A row set file is missing.");
            readFoundryInput(context, set.file);
            if (set.type === "flow") args.push("--flows", set.file);
            else if (["contact", "source", "unitgroup", "flowproperty"].includes(String(set.type)))
              args.push("--support", set.file);
          }
          assertCurrentQueueBuild(
            context,
            queueDir,
            runWorkflowLocalCliResult(context, qualified, temporary, args),
            selectedSets,
          );
        }
        const assessed: Array<Record<string, unknown>> = previousSets.map(record);
        const toAssess = options.scopeType
          ? [selectedSets.find((set) => set.type === options.scopeType)]
          : selectedSets;
        for (const candidate of toAssess) {
          const set = record(candidate);
          if (
            typeof set.type !== "string" ||
            typeof set.file !== "string" ||
            !contracts.has(set.type)
          )
            throw new FoundryContextError(
              "workflow_context_required",
              "Every row set needs its matching contract pack.",
            );
          readFoundryInput(context, set.file);
          const contract = contracts.get(set.type)!;
          const contractPath = (key: string) => {
            const file = contract[key];
            if (file === null || file === undefined) return null;
            if (typeof file !== "string")
              throw new FoundryContextError(
                "workflow_context_invalid",
                "Contract file reference is invalid.",
              );
            readFoundryInput(context, file);
            return file;
          };
          const schema = runTidasRowsValidation({
            repoRoot: context.assetRoot,
            options: {
              tidasBin: executable,
              rowsFile: set.file,
              type: set.type,
              outDir: path.join(output, set.type, "schema"),
            },
            environment,
          });
          if (typeof schema.report_file !== "string")
            throw new FoundryContextError(
              "workflow_schema_failed",
              "Native validation returned no compatible report.",
            );
          const qaDir = path.join(output, set.type, "qa");
          let qaReport: string;
          if (["flow", "process", "lifecyclemodel"].includes(set.type)) {
            const qa = runWorkflowLocalCli(context, qualified, temporary, [
              "qa",
              set.type,
              "--rows-file",
              set.file,
              "--out-dir",
              qaDir,
              "--json",
            ]);
            const file = record(qa.files).report;
            if (typeof file !== "string")
              throw new FoundryContextError("workflow_qa_failed", "QA returned no report file.");
            qaReport = file;
          } else {
            qaReport = path.join(qaDir, "qa-not-required.json");
            operation.writeJson(qaReport, {
              status: "not_required_for_support_rows",
              dataset_type: set.type,
            });
          }
          const gateDir = path.join(output, set.type, "curation");
          const rewrite = identityRewriteReports.findLast(
            (report) => report.dataset_type === set.type,
          );
          const gate = runDatasetCurationGate({
            repoRoot: context.assetRoot,
            routeAction: routeFoundryDecisionAction,
            requireIdentityPreflight: Boolean(identity),
            options: {
              type: set.type,
              rowsFile: set.file,
              schemaReport: schema.report_file,
              qaReport,
              outDir: gateDir,
              includeExecutionCommands: false,
              profile: operation.job.target_profile,
              queueDir,
              requireQueueContext: Boolean(queueDir) && ["flow", "process"].includes(set.type),
              schemaFile: contractPath("schema"),
              yamlFile: contractPath("methodology"),
              rulesetFile: contractPath("ruleset"),
              identityPreflightIndex: identity?.index,
              identityDecisionApplyReport: identityApplyReports,
              identityReferenceRewrites: rewrite?.rewrite_file,
              identityReferenceRewriteStatus: rewrite?.status,
              identityReferenceRewriteInputRows: rewrite?.rows_file,
              identityReferenceRewriteOutputRows: rewrite?.output_rows_file,
            },
          });
          const gateReport = path.join(gateDir, "dataset-curation-gate-report.json");
          const decisionWork = prepareFoundryDecisionWork(context, qualified, temporary, {
            type: set.type,
            rows: set.file,
            gateReport,
            contract,
            outDir: path.join(output, set.type, "decisions"),
          });
          const authoringDir = path.join(output, set.type, "authoring");
          const authoring = runDatasetAuthoringTaskBuild({
            repoRoot: context.assetRoot,
            options: {
              curationGateReport: gateReport,
              outDir: authoringDir,
              includeExecutionCommands: false,
            },
          });
          const interactionDigest = applicableFoundryInteractionDigest(
            selectedInteraction?.state ?? null,
            set.type,
          );
          const interactionContext = selectedInteraction
            ? path.join(output, set.type, "interaction-context.json")
            : null;
          if (interactionContext && selectedInteraction) {
            const projected = applicableFoundryInteractionProjection(
              selectedInteraction.state,
              set.type,
            );
            operation.writeJson(interactionContext, {
              schema: projected.schema,
              dataset_type: set.type,
              source_state_sha256: selectedInteraction.entry.sha256,
              decisions: projected.decisions,
              ai_assumptions: projected.ai_assumptions,
            });
          }
          assessed.push({
            type: set.type,
            rows: set.file,
            schema_report: schema.report_file,
            qa_report: qaReport,
            curation_report: gateReport,
            curation_status: gate.status,
            curation_counts: gate.counts,
            authoring_manifest: path.join(authoringDir, "authoring-task-manifest.json"),
            authoring_status: authoring.status,
            authoring_counts: authoring.counts,
            decisions: decisionWork,
            ...(options.scopeType || selectedInteraction
              ? { context_report_sha256: contractShaByType.get(set.type) }
              : {}),
            ...(queueScopeSha256 &&
            ["flow", "process"].includes(set.type) &&
            (options.scopeType || selectedInteraction)
              ? { queue_scope_sha256: queueScopeSha256 }
              : {}),
            ...(interactionDigest ? { interaction_digest: interactionDigest } : {}),
            ...(interactionContext ? { interaction_context: interactionContext } : {}),
          });
        }
        const orderedAssessed = selectedSets
          .map((set) => assessed.find((item) => item.type === set.type))
          .filter((set): set is Record<string, unknown> => Boolean(set));
        for (const input of context.inputs) readFoundryInput(context, input.path);
        assertQualifiedFoundryRuntime(context, qualified);
        registerWorkflowStageFiles(context, operation, output);
        const report = {
          schema: "tiangong-foundry.assessment-stage.v1",
          status: orderedAssessed.length === selectedSets.length ? "completed" : "in_progress",
          owner_base: context.assetRoot,
          rows_report: rowsReport,
          identity_report: identityReport ?? null,
          sets: orderedAssessed,
          ...(options.scopeType
            ? {
                previous_assessment: previous?.path ?? null,
                previous_assessment_sha256: previous?.sha256 ?? null,
                assessed_type: options.scopeType,
              }
            : {}),
          ...(options.interactionSha256 ? { interaction_sha256: options.interactionSha256 } : {}),
        };
        operation.writeJson(path.join(output, "foundry-assessment.json"), report);
        return report;
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}
