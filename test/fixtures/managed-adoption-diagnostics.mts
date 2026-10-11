import fs from "node:fs";
import path from "node:path";

export const managedDiagnosticsEnvironment = "FOUNDRY_MANAGED_TEST_DIAGNOSTICS_ROOT";
export function managedChildEnvironment(environment: NodeJS.ProcessEnv) {
  const child = { ...environment };
  delete child[managedDiagnosticsEnvironment];
  return child;
}
const maximumInput = 1024 * 1024;
const maximumRead = 8 * maximumInput;
const maximumRecords = 64;
const maximumProofs = 128;
const states = [
  "ready",
  "planned",
  "completed",
  "completed_with_identity_findings",
  "failed",
  "blocked",
  "needs_input",
  "needs_review",
  "passed",
  "UNKNOWN_DO_NOT_REPLAY",
  "CLAIMED_OUTCOME_UNPROVEN",
  "ORPHANED_CLAIM_UNPROVEN",
];
const phases = [
  "dataset-workflow-rows",
  "dataset-workflow-assessment",
  "dataset-workflow-identity",
  "dataset-context-pack",
  "dataset-workflow-identity-stage-prepare",
  "dataset-workflow-identity-stage-dispatch",
];
const codes = [
  "ENOENT",
  "EACCES",
  "EPERM",
  "EINVAL",
  "ENOBUFS",
  "ETIMEDOUT",
  "ENAMETOOLONG",
  "ERR_MODULE_NOT_FOUND",
  "MODULE_NOT_FOUND",
  "identity_stage_unproven",
  "identity_stage_outcome_unproven",
  "identity_preflight_timeout",
  "identity_preflight_execution_invalid",
  "identity_preflight_report_missing_or_non_json",
];
const cases = [
  "actual unmodified CLI manager directly enters the package and brands carrier qualification for plan/apply/audit",
  "ordinary argv/task self-authority cannot qualify managed adoption and read launch cannot write",
  "actual CLI managed host refuses changed carrier, qualification, execution and component expectations",
  "real manager + synthetic owned auth/search transport performs exact Flow3/Process1 readonly stage and preserves Source2",
  "real managed subprocess preserves UNKNOWN after interrupted synthetic readonly query and never requeries",
  "managed cli-auth admits neither wrong account, stale receipt, auth error nor incomplete process credentials",
];
type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const quantity = (value: unknown) =>
  number(value) !== null && Number(value) >= 0 ? Number(value) : null;
const boolean = (value: unknown) => (typeof value === "boolean" ? value : null);
const choice = (value: unknown, allowed: readonly string[]) =>
  value === null || value === undefined
    ? null
    : typeof value === "string" && allowed.includes(value)
      ? value
      : "unrecognized";
const time = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;
function counts(value: unknown) {
  const selected = row(value);
  return Object.fromEntries(
    ["admitted_targets", "accepted_targets", "cli_invocations", "underlying_retrievals"].map(
      (key) => [key, quantity(selected[key])],
    ),
  );
}
function outcome(value: unknown) {
  const selected = row(value);
  return {
    status: choice(selected.status, states),
    failure_code: choice(selected.failure_code, codes),
    cli_exit_code: number(selected.cli_exit_code),
    attempts: number(selected.attempts),
    counts: counts(selected.counts),
  };
}
function parsed(text: unknown): { state: string; value?: unknown } {
  if (typeof text !== "string") return { state: "missing" };
  if (text.length > maximumInput || Buffer.byteLength(text) > maximumInput)
    return { state: "oversized" };
  try {
    return { state: "ok", value: JSON.parse(text) };
  } catch {
    return { state: "malformed" };
  }
}
export function projectManagedSubprocess(record: Row) {
  const stdout = parsed(record.stdout),
    operation = row(stdout.value);
  const artifacts = Array.isArray(operation.artifacts) ? operation.artifacts.slice(0, 256) : [];
  const stage = row(
    row(artifacts.findLast((item) => row(item).role === "explicit_readonly_identity_stage")).value,
  );
  return {
    role: choice(record.role, ["actual-managed-returned-action"]),
    started_at_utc: time(record.started_at_utc),
    ended_at_utc: time(record.ended_at_utc),
    elapsed_ms: number(record.elapsed_ms),
    status: number(record.status),
    signal: choice(record.signal, ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"]),
    error: record.error
      ? {
          name: choice(row(record.error).name, [
            "Error",
            "TypeError",
            "SyntaxError",
            "AssertionError",
          ]),
          code: choice(row(record.error).code, codes),
        }
      : null,
    timed_out: boolean(record.timed_out),
    test_deadline_ms: quantity(record.test_deadline_ms),
    owned_child: {
      pid: quantity(row(record.owned_child).pid),
      close_observed: boolean(row(record.owned_child).close_observed),
      synchronous_return_observed: boolean(row(record.owned_child).synchronous_return_observed),
      sigterm_sent: boolean(row(record.owned_child).sigterm_sent),
      sigkill_sent: boolean(row(record.owned_child).sigkill_sent),
    },
    stdout_bytes: number(record.stdout_bytes),
    stderr_bytes: number(record.stderr_bytes),
    stdout_projection: stdout.state,
    operation_status: choice(operation.status, states),
    stage_status: choice(stage.status, states),
    counts: counts(stage.counts),
    this_invocation: counts(stage.this_invocation),
  };
}
function write(file: string, value: unknown) {
  const parent = path.dirname(file);
  if (fs.realpathSync(parent) !== path.resolve(parent) || fs.lstatSync(parent).isSymbolicLink())
    throw new Error("Managed diagnostic output requires a physical directory.");
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > maximumInput)
    throw new Error("Managed diagnostic output exceeds its bound.");
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
}
export function prepareManagedDiagnostics(
  output: string,
  context: { source: string; platform: string; plan_sha256: string; shard: number },
) {
  validateContext(context);
  const root = path.join(fs.realpathSync(output), "managed-adoption");
  fs.mkdirSync(root, { mode: 0o700 });
  write(path.join(root, "context.json"), {
    schema: "foundry.managed-diagnostics-context.v1",
    source: context.source,
    platform: context.platform,
    plan_sha256: context.plan_sha256,
    shard: context.shard,
  });
  return fs.realpathSync(root);
}
export function startManagedDiagnosticsOutput(
  output: string,
  context: Parameters<typeof prepareManagedDiagnostics>[1],
) {
  try {
    return { root: prepareManagedDiagnostics(output, context), omission: null };
  } catch {
    return { root: undefined, omission: "initialization-unavailable" };
  }
}
function validateContext(context: Row) {
  if (
    typeof context.source !== "string" ||
    !/^[0-9a-f]{40}$/u.test(context.source) ||
    typeof context.plan_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(context.plan_sha256) ||
    typeof context.platform !== "string" ||
    !["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64"].includes(context.platform) ||
    !Number.isInteger(context.shard) ||
    Number(context.shard) < 1 ||
    Number(context.shard) > 8
  )
    throw new Error("Invalid managed diagnostic context.");
}
type Read = { state: string; value?: unknown; mtime_ms?: number; bytes?: number };
function boundedReader(root: string) {
  let consumed = 0;
  let rootState = "ok";
  let rootIdentity: { dev: bigint; ino: bigint } | undefined;
  try {
    if (!path.isAbsolute(root) || root !== path.resolve(root) || fs.realpathSync(root) !== root)
      rootState = "rejected-link";
    const initial = fs.lstatSync(root, { bigint: true });
    if (!initial.isDirectory() || initial.isSymbolicLink()) rootState = "rejected-link";
    rootIdentity = { dev: initial.dev, ino: initial.ino };
  } catch (error) {
    rootState = row(error).code === "ENOENT" ? "missing" : "read-error";
  }
  const owned = (file: string) => {
    if (rootState !== "ok") throw new Error(rootState);
    if (fs.realpathSync(root) !== root) throw new Error("rejected-link");
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
      throw new Error("rejected-path");
    let current = root;
    const directories: { dev: bigint; ino: bigint }[] = [];
    for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
      current = part ? path.join(current, part) : current;
      const selected = fs.lstatSync(current, { bigint: true });
      if (selected.isSymbolicLink()) throw new Error("rejected-link");
      if (
        current === root &&
        (selected.dev !== rootIdentity?.dev || selected.ino !== rootIdentity?.ino)
      )
        throw new Error("unstable");
      if (current !== file && !selected.isDirectory()) throw new Error("rejected-path");
      if (selected.isDirectory()) directories.push({ dev: selected.dev, ino: selected.ino });
    }
    return directories;
  };
  const read = (file: string, json = true): Read => {
    let fd: number | undefined;
    try {
      const parents = owned(file);
      const before = fs.lstatSync(file);
      if (!before.isFile() || before.nlink !== 1) return { state: "rejected-file" };
      if (before.size > maximumInput || consumed + before.size > maximumRead)
        return { state: "oversized" };
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd);
      if (opened.ino !== before.ino || opened.dev !== before.dev) return { state: "unstable" };
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0,
        size = 0;
      do {
        size = fs.readSync(fd, bytes, length, bytes.length - length, null);
        length += size;
      } while (size > 0 && length < bytes.length);
      const body = bytes.subarray(0, length).toString("utf8"),
        after = fs.fstatSync(fd),
        located = fs.lstatSync(file);
      consumed += length;
      // Compare directory identity, not mtime: concurrent fixture writes are valid.
      // Path-boundary observations are not a transaction against arbitrary same-UID races.
      const finalParents = owned(file);
      if (
        parents.length !== finalParents.length ||
        parents.some(
          (item, at) => item.dev !== finalParents[at].dev || item.ino !== finalParents[at].ino,
        )
      )
        return { state: "unstable" };
      if (
        length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        located.isSymbolicLink() ||
        located.ino !== after.ino ||
        located.dev !== after.dev
      )
        return { state: "unstable" };
      if (!json) return { state: "ok", value: body, bytes: before.size, mtime_ms: before.mtimeMs };
      const decoded = parsed(body);
      return {
        state: decoded.state,
        value: decoded.value,
        bytes: before.size,
        mtime_ms: before.mtimeMs,
      };
    } catch (error) {
      return {
        state:
          error instanceof Error &&
          ["rejected-path", "rejected-link", "missing", "read-error", "unstable"].includes(
            error.message,
          )
            ? error.message
            : row(error).code === "ENOENT"
              ? "missing"
              : "read-error",
      };
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  const list = (directory: string): { names: string[]; state: string } => {
    let handle: fs.Dir | undefined;
    try {
      owned(directory);
      handle = fs.opendirSync(directory);
      const names: string[] = [];
      while (true) {
        const entry = handle.readSync();
        if (!entry) return { names: names.sort(), state: "ok" };
        if (names.length === maximumProofs) return { names: names.sort(), state: "entry-limit" };
        names.push(entry.name);
      }
    } catch (error) {
      return {
        names: [],
        state:
          error instanceof Error &&
          ["rejected-link", "missing", "read-error", "unstable"].includes(error.message)
            ? error.message
            : row(error).code === "ENOENT"
              ? "missing"
              : "read-error",
      };
    } finally {
      handle?.closeSync();
    }
  };
  return { read, list };
}
export function createManagedDiagnostics(root: string | undefined, caseName: string) {
  if (!root) return null;
  if (!path.isAbsolute(root)) throw new Error("Managed diagnostic root must be absolute.");
  const contextRead = boundedReader(root).read(path.join(root, "context.json"));
  if (
    contextRead.state !== "ok" ||
    row(contextRead.value).schema !== "foundry.managed-diagnostics-context.v1"
  )
    throw new Error("Managed diagnostic context is unavailable.");
  const context = row(contextRead.value);
  validateContext(context);
  const directory = fs.mkdtempSync(path.join(root, "fixture-"));
  write(path.join(directory, "fixture.json"), {
    schema: "foundry.managed-fixture-feedback.v1",
    case_number: cases.indexOf(caseName) + 1,
  });
  let sequence = 0;
  return {
    directory,
    completion(record: Row) {
      if (++sequence > maximumRecords) return;
      write(path.join(directory, `command-${String(sequence).padStart(3, "0")}.json`), {
        schema: "foundry.managed-command-feedback.v1",
        completion_number: sequence,
        ...projectManagedSubprocess(record),
      });
    },
    failure(fixtureRoot: string) {
      const reader = boundedReader(fixtureRoot),
        proofs: unknown[] = [],
        omissions: unknown[] = [];
      let omitted = 0;
      const add = (kind: string, file: string) => {
        if (proofs.length >= maximumProofs) {
          omitted++;
          return;
        }
        const selected = reader.read(file, kind !== "stderr-log"),
          value = row(selected.value);
        const results = Array.isArray(value.results) ? value.results.slice(0, 8).map(outcome) : [];
        proofs.push({
          kind,
          read: selected.state,
          bytes: selected.bytes,
          mtime_ms: selected.mtime_ms,
          command: choice(value.command, phases),
          created_at_utc: time(value.created_at_utc),
          claimed_at_utc: time(value.claimed_at_utc),
          dispatch_state: choice(value.dispatch_state, states),
          ...outcome(value),
          results,
        });
      };
      const tasks = path.join(fixtureRoot, "workspace/.foundry/workspaces"),
        taskList = reader.list(tasks);
      const limited = (role: string, directory: string, limit: number) => {
        const result = reader.list(directory);
        if (result.state !== "ok") omissions.push({ role, state: result.state });
        if (result.names.length > limit) omissions.push({ role, state: "entry-limit" });
        return result.names.slice(0, limit);
      };
      if (taskList.names.length > 8) omissions.push({ role: "tasks", state: "entry-limit" });
      for (const task of taskList.names.slice(0, 8)) {
        const taskRoot = path.join(tasks, task),
          checkpoints = path.join(taskRoot, "checkpoints");
        for (const file of limited("checkpoints", checkpoints, 32).filter((name) =>
          name.endsWith(".plan.json"),
        )) {
          add("plan", path.join(checkpoints, file));
          add("receipt", path.join(checkpoints, file.replace(/\.plan\.json$/u, ".json")));
        }
        const stages = path.join(taskRoot, "outputs/identity-stage");
        for (const stage of limited("stages", stages, 8)) {
          const dispatch = path.join(stages, stage, "dispatch");
          for (const target of limited("dispatch", dispatch, 8)) {
            const base = path.join(dispatch, target);
            add("dispatch", path.join(base, "dispatch.json"));
            const claim = reader.read(path.join(base, "dispatch.json")),
              receipt = reader.read(path.join(base, "identity-receipt.json"));
            const captured =
              row(receipt.value).schema === "tiangong-lca.auth-identity-receipt.v1" &&
              row(receipt.value).status === "passed"
                ? time(row(receipt.value).captured_at_utc)
                : null;
            const claimed =
              row(claim.value).schema === "tiangong-foundry.identity-stage-dispatch.v1"
                ? time(row(claim.value).claimed_at_utc)
                : null;
            // Syntax-checked time observations only, never an authentication or freshness decision.
            if (proofs.length < maximumProofs)
              proofs.push({
                kind: "receipt-time",
                read: receipt.state,
                captured_at_utc: captured,
                claimed_at_utc: claimed,
                mtime_ms: quantity(receipt.mtime_ms),
                observed_gap_ms:
                  captured && claimed ? Date.parse(claimed) - Date.parse(captured) : null,
              });
            else omitted++;
            add("run-report", path.join(base, "run/dataset-identity-preflight-run-report.json"));
            const logs = path.join(base, "run/logs");
            for (const log of limited("logs", logs, 8))
              if (log.endsWith(".stdout.json") || log.endsWith(".stderr.log"))
                add(
                  log.endsWith(".stdout.json") ? "stdout-log" : "stderr-log",
                  path.join(logs, log),
                );
          }
        }
      }
      const calls = reader.read(path.join(fixtureRoot, "synthetic-calls.jsonl"), false);
      const callCounts: Record<string, number> = {
        auth: 0,
        flow: 0,
        process: 0,
        "forbidden-write": 0,
      };
      let callState = calls.state;
      if (callState === "ok") {
        try {
          for (const line of String(calls.value).split("\n").filter(Boolean)) {
            const value: unknown = JSON.parse(line),
              kind = row(value).kind;
            if (
              !value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              typeof kind !== "string" ||
              !Object.hasOwn(callCounts, kind)
            ) {
              callState = "unrecognized";
              break;
            }
            callCounts[kind]++;
          }
        } catch {
          callState = "malformed";
        }
      }
      write(path.join(directory, "failure.json"), {
        schema: "foundry.managed-failure-feedback.v1",
        disposition: "failed-or-incomplete",
        completed_records: Math.min(sequence, maximumRecords),
        omitted_records: Math.max(0, sequence - maximumRecords),
        task_directory_read: taskList.state,
        proofs,
        omissions,
        omitted_proofs: omitted,
        calls_read: callState,
        synthetic_call_counts: callState === "ok" ? callCounts : null,
        source: context.source,
        platform: context.platform,
      });
    },
  };
}

export function startManagedDiagnostics(root: string | undefined, caseName: string) {
  try {
    return { feedback: createManagedDiagnostics(root, caseName), omission: null };
  } catch {
    return { feedback: null, omission: "initialization-unavailable" };
  }
}
