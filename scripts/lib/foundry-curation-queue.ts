import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FoundryContextError } from "./foundry-runtime-error.ts";
import {
  datasetIdentity,
  detectDatasetType,
  unwrapDatasetPayload,
} from "./import-curation/internal/dataset-payload.ts";
import { asText, readRows } from "./import-curation/internal/runtime-io.ts";
import { collectCommonOtherTraceEntries } from "./import-curation/internal/trace-summary.ts";
import { collectDatasetReferences } from "./import-curation/internal/workflow-reference-closure.ts";

type Entity = "support" | "flow" | "process";
type QueueOptions = {
  processes: string;
  flows?: string | null;
  support?: readonly string[];
  external?: readonly string[];
  outDir: string;
  readInput?: (file: string) => Buffer;
};

const layout = {
  support: { dir: "supports", stages: ["identity", "schema", "qa_or_profile", "checkpoint"] },
  flow: { dir: "flows", stages: ["identity", "name_plan", "schema", "qa", "checkpoint"] },
  process: {
    dir: "processes",
    stages: [
      "dependency_closure",
      "reference_refresh",
      "required_fields",
      "schema",
      "qa",
      "curation",
      "remote_dry_run",
      "readback",
    ],
  },
};

function sha256(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function invalid(message: string): never {
  throw new FoundryContextError("workflow_queue_invalid", message);
}

function writeText(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, contents, { mode: 0o600, flag: "wx" });
}

function writeJson(file: string, value: unknown) {
  writeText(file, JSON.stringify(value, null, 2) + "\n");
}

function writeRows(file: string, rows: readonly unknown[]) {
  writeText(file, rows.map((row) => JSON.stringify(row) + "\n").join(""));
}

const versionKey = (id: string, version: string | null) => JSON.stringify([id, version]);
const refPath = (pointer: string) => pointer.replace(/^\/+|\/+$/gu, "").replace(/\//gu, ".");

export function buildFoundryCurationQueue(options: QueueOptions) {
  const outDir = path.resolve(options.outDir);
  const files = {
    processes: path.resolve(options.processes),
    flows: options.flows ? path.resolve(options.flows) : null,
    support: (options.support ?? []).map((file) => path.resolve(file)),
    external_flow_refs: (options.external ?? []).map((file) => path.resolve(file)),
  };
  const hashes: Record<string, string> = {};
  const read = (file: string) => {
    const bytes = (options.readInput ?? fs.readFileSync)(file);
    hashes[file] = sha256(bytes);
    return readRows(file, () => bytes.toString("utf8"));
  };

  const taskIds = new Set<string>();
  const workDirs = new Set<string>();
  const entities = (file: string, type: Entity) =>
    read(file).map((row, index) => {
      const kind =
        type === "support" ? detectDatasetType(unwrapDatasetPayload(row, "support")) : type;
      if (!kind) return invalid("Support queue rows need a recognized dataset type.");
      const { id, version, payload } = datasetIdentity(row, index, kind);
      if (!id || !version || /^row-\d+$/u.test(id))
        return invalid("Queue rows need a stable identity.");
      const taskId = `${type}:${id}@${version}`;
      const token = (value: string) => value.replace(/[^A-Za-z0-9._-]+/gu, "_");
      const workDir = path.join(
        outDir,
        "entities",
        layout[type].dir,
        `${token(id)}__${token(version)}`,
      );
      if (taskIds.has(taskId) || workDirs.has(workDir))
        return invalid("The queue has conflicting rows for one task or path.");
      taskIds.add(taskId);
      workDirs.add(workDir);
      const task = {
        schema_version: 1,
        entity_type: type,
        task_id: taskId,
        entity_id: id,
        version,
        lock_key: taskId,
        depends_on: [] as string[],
        work_dir: workDir,
        input_rows_file: path.join(workDir, "input.jsonl"),
        checkpoint_file: path.join(workDir, "checkpoint.json"),
        run_plan_file: path.join(workDir, "entity-run-plan.json"),
        closure_file: path.join(workDir, "closure.json"),
      };
      return { task, row, payload, source: { file, index } };
    });
  const support = files.support.flatMap((file) => entities(file, "support"));
  const flows = files.flows ? entities(files.flows, "flow") : [];
  const processes = entities(files.processes, "process");
  const externalRows = files.external_flow_refs.flatMap(read);
  const external = new Set(
    externalRows.map((row) => {
      const source = record(row);
      const id = asText(source.id ?? source.dataset_id ?? source.uuid);
      if (!id) return invalid("External Flow evidence requires a stable identity.");
      return versionKey(id, asText(source.version) || null);
    }),
  );
  const byFlowVersion = new Map(
    flows.map(({ task }) => [versionKey(task.entity_id, task.version), task]),
  );
  const flowCounts = new Map<string, number>();
  const firstByFlow = new Map<string, (typeof flows)[number]["task"]>();
  for (const { task } of flows) {
    flowCounts.set(task.entity_id, (flowCounts.get(task.entity_id) ?? 0) + 1);
    if (!firstByFlow.has(task.entity_id)) firstByFlow.set(task.entity_id, task);
  }

  const blockers = [];
  const all = [...support, ...flows, ...processes];
  for (const item of all) {
    const { task, row, payload, source } = item;
    const localTasks = [],
      externalRefs = [],
      deferredRefs = [],
      unresolvedRefs = [];
    if (task.entity_type === "process") {
      const deferred = new Map(
        collectCommonOtherTraceEntries(payload, "tiangongfoundry:unresolvedTrace")
          .map(record)
          .filter(
            (trace) =>
              (trace.action_item_code ?? trace.actionItemCode) ===
              "elementary_flow_identity_manual_review",
          )
          .map((trace) => [
            JSON.stringify([
              asText(trace.reference_id ?? trace.referenceId ?? trace.ref_object_id),
              asText(trace.reference_version ?? trace.referenceVersion ?? trace.version) || null,
              refPath(asText(trace.blocked_path ?? trace.blockedPath ?? trace.path)),
            ]),
            trace,
          ]),
      );
      const missing = [];
      const refs = collectDatasetReferences(payload).filter((ref) => ref.table === "flows");
      for (const ref of refs) {
        const version = ref.version || null;
        const key = versionKey(ref.id, version);
        const location = refPath(ref.path);
        const target = version
          ? byFlowVersion.get(key)
          : flowCounts.get(ref.id) === 1
            ? firstByFlow.get(ref.id)
            : undefined;
        const base = { entity_type: "flow", entity_id: ref.id, version, ref_path: location };
        const trace = deferred.get(JSON.stringify([ref.id, version, location]));
        if (target) {
          localTasks.push({ ...base, version: target.version, task_id: target.task_id });
        } else if (version && external.has(key)) {
          externalRefs.push(base);
        } else if (trace) {
          deferredRefs.push({
            ...base,
            action_item_code: "elementary_flow_identity_manual_review",
            reason: asText(trace.reason) || null,
          });
        } else {
          unresolvedRefs.push(base);
          missing.push({ id: ref.id, version, path: location });
        }
      }
      if (missing.length)
        blockers.push({
          schema_version: 1,
          code: "process_flow_reference_unresolved",
          severity: "blocker",
          entity_type: "process",
          entity_id: task.entity_id,
          version: task.version,
          message:
            "Process Flow dependencies require one local task or exact external Flow evidence.",
          details: { missing_flow_refs: missing },
        });
    }
    task.depends_on = [...new Set(localTasks.map((entry) => entry.task_id))].sort();
    writeRows(task.input_rows_file, [row]);
    writeJson(task.closure_file, {
      schema_version: 1,
      entity_type: task.entity_type,
      entity_id: task.entity_id,
      version: task.version,
      source,
      dependencies: {
        local_tasks: localTasks,
        external_refs: externalRefs,
        deferred_refs: deferredRefs,
        unresolved_refs: unresolvedRefs,
      },
    });
    writeJson(task.run_plan_file, {
      schema_version: 1,
      task_id: task.task_id,
      entity_type: task.entity_type,
      entity_id: task.entity_id,
      version: task.version,
      input_rows_file: task.input_rows_file,
      checkpoint_file: task.checkpoint_file,
      stages: layout[task.entity_type].stages.map((id) => ({
        id,
        status: "pending",
        checkpoint_file: path.join(task.work_dir, "checkpoints", `${id}.json`),
      })),
      ai_authoring_policy: {
        output_only: "structured_patch_or_build_plan",
        deterministic_apply_required: true,
        remote_write_allowed: false,
      },
    });
  }

  const tasks = all.map(({ task }) => task);
  const output = path.join(outDir, "outputs");
  const artifacts = {
    manifest: path.join(output, "curation-queue-manifest.json"),
    tasks: path.join(output, "curation-queue-tasks.jsonl"),
    blockers: path.join(output, "curation-queue-blockers.jsonl"),
    locks: path.join(output, "curation-queue-locks.json"),
  };
  const generated = new Date().toISOString();
  const report = {
    schema_version: 1,
    producer: "foundry",
    generated_at_utc: generated,
    status: blockers.length ? "blocked" : "ready",
    out_dir: outDir,
    inputs: files,
    counts: {
      support_rows: support.length,
      flow_rows: flows.length,
      process_rows: processes.length,
      external_flow_refs: externalRows.length,
      tasks: tasks.length,
      blockers: blockers.length,
    },
    hashes: { inputs: hashes, task_order: sha256(tasks.map((task) => task.task_id).join("\n")) },
    files: artifacts,
    tasks,
    blockers,
  };
  writeRows(artifacts.tasks, tasks);
  writeRows(artifacts.blockers, blockers);
  writeJson(artifacts.locks, {
    schema_version: 1,
    generated_at_utc: generated,
    locks: tasks.map(({ task_id, entity_type, entity_id, version, lock_key }) => ({
      task_id,
      entity_type,
      entity_id,
      version,
      lock_key,
      status: "available",
    })),
  });
  writeJson(artifacts.manifest, report);
  return report;
}
