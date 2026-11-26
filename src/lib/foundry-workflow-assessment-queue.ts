import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  FoundryContextError,
  readFoundryInput,
  captureFoundryInput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";

export function assertCurrentAssessmentQueueBuild(
  context: FoundryRuntimeContext,
  queueDir: string,
  result: { exit: number; report: Record<string, unknown> },
  sets: readonly Record<string, unknown>[],
  external?: { file: string; count: number },
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
    !exactJson(inputs.external_flow_refs, external ? [external.file] : [])
  )
    invalid();
  const expectedHashes = new Map(
    selected.map((set) => {
      const file = set.file;
      readFoundryInput(context, file);
      return [file, captureFoundryInput(file).sha256] as const;
    }),
  );
  if (external) expectedHashes.set(external.file, captureFoundryInput(external.file).sha256);
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
    counts.external_flow_refs !== (external?.count ?? 0) ||
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
