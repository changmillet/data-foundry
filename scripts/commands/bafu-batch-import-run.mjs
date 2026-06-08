import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acceptTraceHashOnlyRemoteVerificationMismatch } from "../lib/remote-verification-accepted-diff.mjs";
import { stageContract } from "../lib/stage-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const commandName = "dataset-bafu-batch-import-run";
let supportCommitQueue = Promise.resolve();
const verifiedSupportIdentities = new Set();
const bafuBatchStageContract = {
  remote_write_mode: "explicit-commit-only",
  stage_pipeline: stageContract([
    {
      stage: "load_scope_ledgers",
      phase: "prepare",
      purpose:
        "Load ready scopes plus existing ok/blocked/retry ledgers so reruns skip verified and deferred scopes.",
      inputs: ["ready-scopes.jsonl", "import-ledger/*.jsonl"],
      outputs: ["selected process scopes", "run-manifest.json"],
      side_effects: ["writes local Foundry run manifest"],
    },
    {
      stage: "materialize_scope",
      phase: "rewrite_cleanup",
      purpose:
        "Materialize one process scope from process-bundles, apply deterministic rewrites, and refresh exact-payload identity evidence when needed.",
      inputs: ["process-bundles/<process>", "library classification decisions", "context packs"],
      outputs: ["scope materialized rows", "identity preflight artifacts", "patch/apply reports"],
      side_effects: ["writes local scope workspace artifacts"],
    },
    {
      stage: "scope_commit_gate",
      phase: "gate_validate",
      purpose:
        "Run finalize, mutation manifest, handoff planning, remote commit, and readback verify only for scopes whose dependency closure is ready.",
      inputs: ["materialized scope rows", "finalize context", "target user/account guard"],
      outputs: ["commit reports", "remote verification reports", "blocked-scope ledger rows"],
      blockers: [
        "unresolved AI/human review dependencies",
        "reference closure failures",
        "remote write failures",
      ],
      side_effects: ["may write verified rows to the remote database when --commit is supplied"],
    },
    {
      stage: "ledger_report",
      phase: "report",
      purpose:
        "Write separated ok, blocked, and retry ledgers plus a reader-facing batch report for resumable import.",
      inputs: ["scope run results"],
      outputs: [
        "dataset-bafu-batch-import-run-report.json",
        "scope-checkpoints.jsonl",
        "import-ledger/ok.*.jsonl",
        "import-ledger/blocked.*.jsonl",
        "import-ledger/failed.scopes.retry.jsonl",
      ],
      side_effects: ["writes local Foundry ledgers"],
    },
  ]).map((stage) => ({
    ...stage,
    report_contract: {
      ...stage.report_contract,
      remote_write_mode: "explicit-commit-only",
    },
  })),
};

const bafuBatchRuntimeKeys = [
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
];

let bafuBatchRuntime = null;

function installBafuBatchRuntime(deps) {
  const missing = bafuBatchRuntimeKeys.filter((key) => typeof deps?.[key] !== "function");
  if (missing.length > 0) {
    throw new Error(`createBafuBatchImportRunCommands missing dependencies: ${missing.join(", ")}`);
  }
  bafuBatchRuntime = deps;
}

function runtime() {
  if (!bafuBatchRuntime) {
    throw new Error("createBafuBatchImportRunCommands must install command dependencies.");
  }
  return bafuBatchRuntime;
}

function nowIso() {
  return runtime().nowIso();
}

function resolveRepoPath(value) {
  return runtime().resolveRepoPath(value);
}

function repoRelative(filePath) {
  return runtime().repoRelativeMaybe(filePath);
}

function fileExists(filePath) {
  return runtime().fileExists(filePath);
}

function directoryExists(filePath) {
  return runtime().directoryExists(filePath);
}

function readJson(filePath) {
  return runtime().readJson(filePath);
}

function readJsonLines(filePath) {
  if (!fileExists(filePath)) return [];
  return runtime().readJsonLines(filePath);
}

function writeJson(filePath, value) {
  runtime().writeJson(filePath, value);
}

function writeJsonLines(filePath, rows) {
  runtime().writeJsonLines(filePath, rows);
}

function appendJsonLine(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function asText(value) {
  return runtime().asText(value);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\\+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function booleanOption(value) {
  return runtime().booleanOption(value);
}

function integerOption(value, fallback) {
  return runtime().integerOption(value, fallback);
}

function normalizedList(value) {
  return runtime().normalizedList(value);
}

function shellQuote(value) {
  return runtime().shellQuote(value);
}

function commandString(argv) {
  return argv.map(shellQuote).join(" ");
}

function datasetIdentity(row, type) {
  const injected = runtime().datasetIdentity(row, type);
  if (injected?.id || injected?.version) {
    return {
      id: injected.id ?? null,
      version: injected.version || "00.00.001",
    };
  }
  const root = row?.[`${type}DataSet`] ?? row;
  const dataSetInformation =
    root?.[`${type}Information`]?.dataSetInformation ??
    root?.[`${type}Information`]?.["common:dataSetInformation"] ??
    root?.processInformation?.dataSetInformation ??
    root?.flowInformation?.dataSetInformation ??
    {};
  const publication =
    root?.administrativeInformation?.publicationAndOwnership ??
    root?.administrativeInformation?.["common:publicationAndOwnership"] ??
    {};
  return {
    id:
      asText(dataSetInformation["common:UUID"]) ||
      asText(dataSetInformation.UUID) ||
      asText(row?.dataset_id) ||
      asText(row?.id),
    version:
      asText(publication["common:dataSetVersion"]) ||
      asText(publication.dataSetVersion) ||
      asText(row?.dataset_version) ||
      asText(row?.version) ||
      "00.00.001",
  };
}

function taskIdentity(task) {
  return {
    id: asText(task?.entity?.entity_id ?? task?.dataset_id ?? task?.id),
    version: asText(task?.entity?.version ?? task?.dataset_version ?? task?.version) || "00.00.001",
  };
}

export function filterAuthoringTaskManifestToRows({ taskManifest, rowsFile, type, reportPath }) {
  const resolvedTaskManifest = resolveRepoPath(taskManifest);
  const resolvedRowsFile = resolveRepoPath(rowsFile);
  const resolvedReportPath =
    resolveRepoPath(reportPath) ||
    path.join(path.dirname(resolvedTaskManifest), "authoring-task-filter-report.json");
  const manifest = readJson(resolvedTaskManifest);
  const rows = readRows(resolvedRowsFile);
  const retainedKeys = new Set(
    rows
      .map((row) => datasetIdentity(row, type))
      .filter((identity) => identity.id)
      .map((identity) => `${identity.id}@${identity.version}`),
  );
  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
  const retainedTasks = [];
  const skippedTasks = [];
  for (const task of tasks) {
    const identity = taskIdentity(task);
    const key = identity.id ? `${identity.id}@${identity.version}` : "";
    if (key && retainedKeys.has(key)) {
      retainedTasks.push(task);
    } else {
      skippedTasks.push({
        dataset_type: task?.entity?.dataset_type ?? type,
        dataset_id: identity.id || null,
        dataset_version: identity.version || null,
        reason: "dataset_not_present_after_identity_apply",
      });
    }
  }
  const filtered =
    skippedTasks.length > 0
      ? path.join(path.dirname(resolvedTaskManifest), "authoring-task-manifest.current-rows.json")
      : resolvedTaskManifest;
  if (filtered !== resolvedTaskManifest) {
    writeJson(filtered, {
      ...manifest,
      tasks: retainedTasks,
      counts: {
        ...(manifest.counts ?? {}),
        tasks: retainedTasks.length,
        original_tasks: tasks.length,
        skipped_not_in_current_rows: skippedTasks.length,
      },
      filter: {
        source_manifest: repoRelative(resolvedTaskManifest),
        current_rows_file: repoRelative(resolvedRowsFile),
        reason: "identity decisions may rewrite/reuse rows before content patches are applied",
      },
    });
  }
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: retainedTasks.length > 0 ? "ready_for_ai_authoring_batch" : "ready_no_action_items",
    task_manifest: repoRelative(resolvedTaskManifest),
    filtered_task_manifest: repoRelative(filtered),
    current_rows_file: repoRelative(resolvedRowsFile),
    type,
    counts: {
      current_rows: rows.length,
      original_tasks: tasks.length,
      retained_tasks: retainedTasks.length,
      skipped_tasks: skippedTasks.length,
    },
    skipped_tasks: skippedTasks.slice(0, 200),
  };
  writeJson(resolvedReportPath, report);
  return {
    status: report.status,
    taskManifest: filtered,
    reportPath: resolvedReportPath,
    counts: report.counts,
  };
}

function readRows(filePath) {
  if (!fileExists(filePath)) return [];
  if (String(filePath).toLowerCase().endsWith(".jsonl")) return readJsonLines(filePath);
  const value = readJson(filePath);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.rows)) return value.rows;
  return [value];
}

function uniqueExistingPaths(paths) {
  return [...new Set((paths ?? []).map(resolveRepoPath).filter(fileExists))];
}

function shellTokens(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  const text = String(command ?? "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < text.length) {
      index += 1;
      current += text[index];
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function commandOptionValue(command, optionName) {
  const tokens = shellTokens(command);
  const index = tokens.indexOf(optionName);
  return index >= 0 ? tokens[index + 1] || null : null;
}

function datasetTypeFromRow(row) {
  if (row?.contactDataSet) return "contact";
  if (row?.sourceDataSet) return "source";
  if (row?.flowDataSet) return "flow";
  if (row?.processDataSet) return "process";
  if (row?.unitGroupDataSet) return "unitgroup";
  if (row?.flowPropertyDataSet) return "flowproperty";
  return null;
}

function supportIdentityKeysFromHandoffPlan(handoffPlan) {
  const inputPath = resolveRepoPath(commandOptionValue(handoffPlan?.commands?.commit, "--input"));
  if (!fileExists(inputPath)) return [];
  return readRows(inputPath)
    .map((row) => {
      const type =
        datasetTypeFromRow(row) || commandOptionValue(handoffPlan?.commands?.commit, "--type");
      if (!["contact", "source"].includes(type)) return null;
      const identity = datasetIdentity(row, type);
      return identity.id ? `${type}:${identity.id}@${identity.version}` : null;
    })
    .filter(Boolean);
}

function appendOption(args, name, value) {
  if (value == null || value === "") return;
  if (value === true) {
    args.push(name);
    return;
  }
  args.push(name, String(value));
}

function appendPathOption(args, name, value) {
  if (!value) return;
  appendOption(args, name, repoRelative(resolveRepoPath(value)));
}

function appendPathOptions(args, name, values) {
  for (const value of normalizedList(values)) appendPathOption(args, name, value);
}

function foundryCommand(command, options = {}) {
  const args = [process.execPath, "scripts/foundry.mjs", command];
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

function parseJsonStdout(stdout) {
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

function stageTimeoutMs(stage) {
  const override = integerOption(process.env.BAFU_BATCH_STAGE_TIMEOUT_MS, null);
  if (override && override > 0) return override;
  const name = String(stage ?? "");
  if (name.includes("post_write_verify") || name.includes("verify")) return 180_000;
  if (name.includes("finalize")) return 900_000;
  if (name.includes("commit")) return 300_000;
  return 180_000;
}

async function runArgvStage({ stage, argv, logDir, reportPath }) {
  const result = await runStage({ stage, logDir, command: argv, shell: false });
  const resolvedReport = resolveRepoPath(reportPath);
  if (fileExists(resolvedReport)) {
    result.json = readJson(resolvedReport);
    result.report = repoRelative(resolvedReport);
  }
  return result;
}

function runShellStage({ stage, command, logDir }) {
  return runStage({ stage, logDir, command, shell: true });
}

function runStage({ stage, command, logDir, shell }) {
  fs.mkdirSync(logDir, { recursive: true });
  const safeStage = stage.replace(/[^A-Za-z0-9_.-]+/gu, "-");
  const stdoutLog = path.join(logDir, `${safeStage}.stdout.log`);
  const stderrLog = path.join(logDir, `${safeStage}.stderr.log`);
  const startedAt = nowIso();
  return new Promise((resolve) => {
    const timeoutMs = stageTimeoutMs(stage);
    let timedOut = false;
    let closed = false;
    const childEnv = { ...process.env };
    delete childEnv.TIANGONG_LCA_FORCE_REAUTH;
    const child = shell
      ? spawn(command, { cwd: repoRoot, env: childEnv, shell: true })
      : spawn(command[0], command.slice(1), { cwd: repoRoot, env: childEnv });
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
        command: shell ? command : commandString(command),
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

function firstExistingPath(candidates) {
  return candidates.map(resolveRepoPath).find(fileExists) ?? null;
}

function findReportFile(rootDir, predicate) {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return null;
  const stack = [resolved];
  const matches = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && predicate(next)) {
        matches.push(next);
      }
    }
  }
  return matches.sort()[0] ?? null;
}

function findFiles(rootDir, predicate) {
  const resolved = resolveRepoPath(rootDir);
  if (!resolved || !fs.existsSync(resolved)) return [];
  const stack = [resolved];
  const matches = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && predicate(next)) {
        matches.push(next);
      }
    }
  }
  return matches.sort();
}

function commitReportForHandoffPlan(handoffPlan) {
  const expectedDir = resolveRepoPath(handoffPlan?.files?.expected_commit_report_dir);
  return (
    firstExistingPath([
      path.join(
        expectedDir || "",
        "process-save-draft",
        "outputs",
        "save-draft-rpc",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "support-save-draft",
        "outputs",
        "dataset-save-draft",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "contact-save-draft",
        "outputs",
        "dataset-save-draft",
        "summary.json",
      ),
      path.join(
        expectedDir || "",
        "source-save-draft",
        "outputs",
        "dataset-save-draft",
        "summary.json",
      ),
      path.join(expectedDir || "", "flow-publish-version", "outputs", "summary.json"),
    ]) ??
    findReportFile(expectedDir, (filePath) =>
      /(?:summary|sync_report)\.json$/u.test(path.basename(filePath)),
    )
  );
}

function verifyReportForHandoffPlan(handoffPlan) {
  const expectedDir = resolveRepoPath(handoffPlan?.files?.expected_post_write_verify_dir);
  return (
    firstExistingPath([
      path.join(expectedDir || "", "outputs", "remote-verification-report.json"),
    ]) ??
    findReportFile(
      expectedDir,
      (filePath) => path.basename(filePath) === "remote-verification-report.json",
    )
  );
}

async function executeHandoff({ handoffPlanPath, ledgerDir, outDir, logDir, label }) {
  if (!fileExists(handoffPlanPath)) {
    return {
      status: "blocked",
      blockers: [{ code: "handoff_plan_missing", message: `${label} handoff plan is missing.` }],
      stages: [],
    };
  }
  const handoffPlan = readJson(handoffPlanPath);
  const blockers = [];
  const stages = [];
  if (handoffPlan.status !== "ready_for_explicit_commit") {
    return {
      status: "blocked",
      blockers: [
        {
          code: "handoff_plan_not_ready",
          message: `${label} handoff plan status is ${handoffPlan.status || "missing"}.`,
          handoff_plan: repoRelative(handoffPlanPath),
        },
      ],
      stages,
      handoffPlan,
    };
  }
  if (!handoffPlan.commands?.commit || !handoffPlan.commands?.post_write_verify) {
    return {
      status: "blocked",
      blockers: [
        {
          code: "handoff_commands_missing",
          message: `${label} handoff plan must include commit and post_write_verify commands.`,
          handoff_plan: repoRelative(handoffPlanPath),
        },
      ],
      stages,
      handoffPlan,
    };
  }

  const commitStage = await runShellStage({
    stage: `${label}.commit`,
    command: handoffPlan.commands.commit,
    logDir,
  });
  const commitReportPath = commitReportForHandoffPlan(handoffPlan);
  stages.push({ ...commitStage, report: repoRelative(commitReportPath) });
  if (commitStage.exit_code !== 0 || !commitReportPath) {
    blockers.push({
      code: "commit_handoff_command_failed",
      message: `${label} commit handoff failed or did not emit the expected commit report.`,
      handoff_plan: repoRelative(handoffPlanPath),
      exit_code: commitStage.exit_code,
      commit_report: repoRelative(commitReportPath),
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }

  const verifyStage = await runShellStage({
    stage: `${label}.post_write_verify`,
    command: handoffPlan.commands.post_write_verify,
    logDir,
  });
  let verifyReportPath = verifyReportForHandoffPlan(handoffPlan);
  let verifyAccepted = verifyStage.exit_code === 0;
  stages.push({ ...verifyStage, report: repoRelative(verifyReportPath) });
  if (verifyStage.exit_code !== 0 && verifyReportPath) {
    const acceptedVerify = acceptTraceHashOnlyRemoteVerificationMismatch({
      verifyReportPath,
      outDir,
      repoRoot,
    });
    if (acceptedVerify.accepted) {
      verifyReportPath = acceptedVerify.verifyReportPath;
      verifyAccepted = true;
      stages.push({
        stage: `${label}.post_write_verify.accepted_diff`,
        status: "accepted",
        report: repoRelative(acceptedVerify.acceptanceReportPath),
        accepted_differences: acceptedVerify.evidence.length,
      });
    }
  }
  if (!verifyAccepted || !verifyReportPath) {
    blockers.push({
      code: "post_write_verify_command_failed",
      message: `${label} post-write verification failed or did not emit the expected remote verification report.`,
      handoff_plan: repoRelative(handoffPlanPath),
      exit_code: verifyStage.exit_code,
      post_write_verify_report: repoRelative(verifyReportPath),
    });
    return { status: "failed", blockers, stages, handoffPlan };
  }

  const closeoutDir = path.join(outDir, "closeout");
  const closeoutCommand = commandString([
    process.execPath,
    "scripts/foundry.mjs",
    "dataset-post-write-closeout",
    "--handoff-plan",
    repoRelative(handoffPlanPath),
    "--commit-report",
    repoRelative(commitReportPath),
    "--post-write-verify-report",
    repoRelative(verifyReportPath),
    "--out-dir",
    repoRelative(closeoutDir),
    "--ledger-dir",
    repoRelative(ledgerDir),
  ]);
  const closeoutStage = await runShellStage({
    stage: `${label}.closeout`,
    command: closeoutCommand,
    logDir,
  });
  const closeoutReportPath = path.join(closeoutDir, "dataset-post-write-closeout-report.json");
  const closeoutReport = fileExists(closeoutReportPath) ? readJson(closeoutReportPath) : null;
  stages.push({ ...closeoutStage, report: repoRelative(closeoutReportPath) });
  if (closeoutStage.exit_code !== 0 || closeoutReport?.status !== "completed") {
    blockers.push({
      code: "post_write_closeout_failed",
      message: `${label} post-write closeout status is ${closeoutReport?.status || "missing"}.`,
      handoff_plan: repoRelative(handoffPlanPath),
      closeout_report: repoRelative(closeoutReportPath),
      closeout_blockers: closeoutReport?.blockers ?? [],
    });
    return { status: "failed", blockers, stages, handoffPlan, closeoutReport };
  }

  return {
    status: "completed",
    blockers,
    stages,
    handoffPlan,
    closeoutReport,
    commitReportPath,
    verifyReportPath,
    closeoutReportPath,
  };
}

function reportFile(stageJson, fallback) {
  const value = stageJson?.files?.report ?? stageJson?.report;
  return resolveRepoPath(value) || fallback;
}

function outputRowsByStem(report, stem) {
  const rows = Array.isArray(report?.files?.output_rows)
    ? report.files.output_rows
    : [report?.files?.output_rows].filter(Boolean);
  return resolveRepoPath(
    rows.find((entry) => path.basename(String(entry)).startsWith(stem)) ?? rows[0],
  );
}

function identityApplyReportHasReferenceRewrites(reportPath) {
  if (!fileExists(reportPath)) return false;
  const report = readJson(reportPath);
  const rewritesFile = resolveRepoPath(report?.files?.identity_reference_rewrites);
  return readJsonLines(rewritesFile).length > 0;
}

function existingIdentityApplyReportsWithReferenceRewrites(scopeDir, label) {
  const candidates = [
    path.join(scopeDir, `${label}-identity-apply`, "identity-decisions-apply-report.json"),
    ...findFiles(
      scopeDir,
      (filePath) => path.basename(filePath) === "identity-decisions-apply-report.json",
    ),
  ];
  return uniqueExistingPaths(candidates).filter(identityApplyReportHasReferenceRewrites);
}

function countRows(filePath) {
  return readRows(filePath).length;
}

function categoryForBlocker(code) {
  const text = String(code || "");
  if (/classification|location|identity|authoring|patch|curation/u.test(text)) {
    return "human-review";
  }
  if (/reference|closure|support/u.test(text)) return "reference-closure";
  if (/commit|verify|remote|timeout|network/u.test(text)) return "remote-write";
  return "other";
}

function firstBlocker(report, fallbackCode, fallbackMessage) {
  return report?.blockers?.[0] ?? { code: fallbackCode, message: fallbackMessage };
}

function statusIs(report, values) {
  return values.includes(String(report?.status || ""));
}

function findOneFile(rootDir, pattern) {
  const resolved = resolveRepoPath(rootDir);
  if (!directoryExists(resolved)) return null;
  const matches = fs
    .readdirSync(resolved)
    .filter((name) => pattern.test(name))
    .sort();
  return matches.length ? path.join(resolved, matches[0]) : null;
}

function defaultContext(runDir, type) {
  return {
    schemaFile: path.join(runDir, "context", type, "outputs", "schema.json"),
    yamlFile: path.join(runDir, "context", type, "outputs", "methodology.yaml"),
    rulesetFile: path.join(runDir, "context", type, "outputs", "runtime-ruleset.json"),
  };
}

function defaultSchemaFiles(options) {
  const schemaRoot = resolveRepoPath(
    options.tidasSchemaDir || "../tiangong-lca-cli/assets/tidas-schemas",
  );
  return {
    processCategory: path.join(schemaRoot, "tidas_processes_category.json"),
    flowProductCategory: path.join(schemaRoot, "tidas_flows_product_category.json"),
    flowElementaryCategory: path.join(schemaRoot, "tidas_flows_elementary_category.json"),
    location: path.join(schemaRoot, "tidas_locations_category.json"),
    allClassification: [
      "tidas_contacts_category.json",
      "tidas_flowproperties_category.json",
      "tidas_flows_elementary_category.json",
      "tidas_flows_product_category.json",
      "tidas_lciamethods_category.json",
      "tidas_processes_category.json",
      "tidas_sources_category.json",
      "tidas_unitgroups_category.json",
    ].map((name) => path.join(schemaRoot, name)),
  };
}

function schemaClasses(schemaFile) {
  const classes = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    const classId = value?.properties?.["@classId"]?.const;
    if (classId != null) {
      classes.set(String(classId), {
        classId: String(classId),
        level: String(value?.properties?.["@level"]?.const ?? ""),
        text: String(value?.properties?.["#text"]?.const ?? ""),
      });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(readJson(schemaFile));
  return classes;
}

function categorySchemaForDecision(decision, schemas) {
  const type = String(decision?.category_type || decision?.schema_type || "").toLowerCase();
  if (type === "process") return schemas.processCategory;
  if (type === "flow-elementary") return schemas.flowElementaryCategory;
  if (type === "flow-product" || type === "flow" || type === "product") {
    return schemas.flowProductCategory;
  }
  return null;
}

function childClassesFor(classes, parentCode) {
  const parent = classes.get(parentCode);
  const parentLevel = Number(parent?.level);
  if (!Number.isFinite(parentLevel)) return [];
  return [...classes.values()]
    .filter((entry) => {
      const level = Number(entry.level);
      return (
        Number.isFinite(level) &&
        level === parentLevel + 1 &&
        entry.classId.startsWith(parentCode) &&
        entry.classId !== parentCode
      );
    })
    .sort((left, right) => left.classId.localeCompare(right.classId));
}

function decisionEvidenceText(row) {
  const queue = row?.evidence?.queue ?? {};
  const authoringContext = queue?.authoring_context ?? {};
  const libraryDecision = row?.evidence?.library_decision ?? {};
  return normalizeSearchText(
    [
      row?.basis,
      row?.code,
      row?.selected_code,
      libraryDecision?.basis,
      libraryDecision?.source_name,
      queue?.source_classification?.category,
      queue?.source_classification?.localCategory,
      authoringContext?.source_name,
      authoringContext?.source_local_name,
      authoringContext?.technology,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function bestChildRepairCode(row, parentCode, children) {
  if (children.length === 0) return null;
  const text = decisionEvidenceText(row);

  if (parentCode === "351") {
    const mentionsDistribution = /\b(?:distribution|transmission)\b/u.test(text);
    const negatesDistribution =
      /\b(?:not|nor|without)\s+(?:include\s+)?(?:transport\s+)?(?:nor\s+)?distribution\b/u.test(
        text,
      );
    if (
      mentionsDistribution &&
      !negatesDistribution &&
      !/\b(?:production|generation)\b/u.test(text)
    ) {
      return children.find((child) => child.classId === "3513")?.classId ?? null;
    }
    const renewableOnly =
      /\b(?:renewable|wind|hydro|hydropower|photovoltaic|solar|biogas|wood)\b/u.test(text) &&
      !/\b(?:coal|diesel|gas|industrial gas|natural gas|nuclear|oil|non renewable|nonrenewable)\b/u.test(
        text,
      );
    if (renewableOnly) return children.find((child) => child.classId === "3512")?.classId ?? null;
    if (/\b(?:electricity|power|production|generation|plant|cogen|cogeneration)\b/u.test(text)) {
      return children.find((child) => child.classId === "3511")?.classId ?? null;
    }
  }

  let best = null;
  let bestScore = -1;
  const tokens = new Set(text.split(" ").filter((token) => token.length > 2));
  for (const child of children) {
    const childTokens = normalizeSearchText(child.text)
      .split(" ")
      .filter((token) => token.length > 2);
    const score = childTokens.reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }
  return best?.classId ?? null;
}

function repairClassificationDecisionCodes({ decisionsFile, schemas, outDir }) {
  const rows = readJsonLines(decisionsFile);
  const cache = new Map();
  const repairs = [];
  const unresolved = [];
  const repaired = rows.map((row) => {
    const schemaFile = categorySchemaForDecision(row, schemas);
    if (!schemaFile || !fileExists(schemaFile)) return row;
    if (!cache.has(schemaFile)) cache.set(schemaFile, schemaClasses(schemaFile));
    const classes = cache.get(schemaFile);
    const code = String(row.code ?? row.selected_code ?? "").trim();
    if (!code || classes.has(code)) return row;
    const stripped = code.replace(/0+$/u, "");
    if (stripped && stripped !== code && classes.has(stripped)) {
      const children = childClassesFor(classes, stripped);
      const repairedCode = bestChildRepairCode(row, stripped, children) ?? stripped;
      const repairKind =
        repairedCode === stripped
          ? "strip_invalid_trailing_zero_to_valid_parent_class"
          : "replace_invalid_trailing_zero_code_with_schema_valid_child_class";
      repairs.push({
        schema_version: 1,
        dataset_id: row.dataset_id,
        dataset_version: row.dataset_version,
        category_type: row.category_type ?? row.schema_type,
        original_code: code,
        repaired_code: repairedCode,
        basis:
          repairedCode === stripped
            ? "Projected category code was not valid in the bundled TIDAS schema; removing trailing zeroes selected the valid parent class without changing the semantic branch."
            : "Projected category code was not valid in the bundled TIDAS schema; the valid parent branch required one more schema level, so the closest source-backed child class was selected.",
      });
      return {
        ...row,
        code: repairedCode,
        basis:
          repairedCode === stripped
            ? `${row.basis || "Classification decision projected from library-level semantic decision."} Schema repair: ${code} -> ${stripped} because ${code} is not a valid bundled TIDAS classId and ${stripped} is the valid parent class.`
            : `${row.basis || "Classification decision projected from library-level semantic decision."} Schema repair: ${code} -> ${repairedCode} because ${code} is not a valid bundled TIDAS classId and ${repairedCode} is the closest valid child class under parent ${stripped}.`,
        evidence: {
          ...(row.evidence ?? {}),
          schema_repair: {
            source: "dataset-bafu-batch-import-run",
            original_code: code,
            repaired_code: repairedCode,
            parent_code: stripped,
            schema_file: repoRelative(schemaFile),
            repair_kind: repairKind,
            child_candidates: children.map((child) => ({
              code: child.classId,
              label: child.text,
            })),
          },
        },
      };
    }
    unresolved.push({
      schema_version: 1,
      dataset_id: row.dataset_id,
      dataset_version: row.dataset_version,
      category_type: row.category_type ?? row.schema_type,
      code,
      schema_file: repoRelative(schemaFile),
      reason: "classification_code_not_in_bundled_tidas_schema",
    });
    return row;
  });
  writeJsonLines(decisionsFile, repaired);
  const repairPath = path.join(outDir, "classification-decisions.schema-repairs.jsonl");
  const unresolvedPath = path.join(
    outDir,
    "classification-decisions.schema-invalid.manual-review.jsonl",
  );
  writeJsonLines(repairPath, repairs);
  writeJsonLines(unresolvedPath, unresolved);
  return { repairs, unresolved, repairPath, unresolvedPath };
}

function loadVerifiedSet(filePath, type) {
  const set = new Set();
  for (const row of readJsonLines(filePath)) {
    const id = row.dataset_id || row.id || row[`${type}_id`] || row.process_id;
    const version =
      row.dataset_version ||
      row.version ||
      row[`${type}_version`] ||
      row.process_version ||
      "00.00.001";
    if (id) set.add(`${id}@${version}`);
  }
  return set;
}

function scopeKeyFromLedgerRow(row) {
  const id = row?.process_id || row?.dataset_id || row?.id;
  const version = row?.process_version || row?.dataset_version || row?.version || "00.00.001";
  return id ? `${id}@${version}` : null;
}

function writeBlockedScopeViews(paths) {
  const verified = new Map();
  for (const row of readJsonLines(paths.okScopes)) {
    const key = scopeKeyFromLedgerRow(row);
    if (key) verified.set(key, row);
  }
  const historical = readJsonLines(paths.blockedHumanReview);
  const active = [];
  const resolved = [];
  for (const row of historical) {
    const key = scopeKeyFromLedgerRow(row);
    const ok = key ? verified.get(key) : null;
    if (!ok) {
      active.push(row);
      continue;
    }
    resolved.push({
      ...row,
      resolution_status: "resolved_by_verified_scope",
      resolved_at_utc: ok.generated_at_utc ?? null,
      resolved_report: ok.report ?? null,
    });
  }
  writeJsonLines(paths.blockedHumanReviewActive, active);
  writeJsonLines(paths.blockedHumanReviewResolved, resolved);
  return {
    historical: historical.length,
    active: active.length,
    resolved: resolved.length,
  };
}

function loadActiveBlockedScopeSet(paths, verifiedScopes) {
  const set = new Set();
  for (const row of readJsonLines(paths.blockedHumanReview)) {
    const key = scopeKeyFromLedgerRow(row);
    if (key && !verifiedScopes.has(key)) set.add(key);
  }
  return set;
}

function scopeKey(scope) {
  return `${scope.process_id || scope.id}@${scope.process_version || scope.version || "00.00.001"}`;
}

function okDatasetRow({ type, id, version, processId, report, files }) {
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    dataset_type: type,
    dataset_id: id,
    dataset_version: version || "00.00.001",
    process_id: processId,
    status: "verified",
    report: repoRelative(report),
    files,
  };
}

function blockRow({ scope, stage, blocker, report, rerunCommand }) {
  return {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: scope.process_id || scope.id,
    process_version: scope.process_version || scope.version || "00.00.001",
    stage,
    code: blocker?.code || "blocked",
    message: blocker?.message || "Scope is blocked.",
    blocker,
    report: repoRelative(report),
    required_human_action:
      blocker?.required_human_action ||
      "Review the stage report, complete missing semantic decisions or references, then rerun this scope.",
    rerun_command: rerunCommand,
  };
}

function buildFinalizeArgs({
  type,
  rowsFile,
  outDir,
  ledgerDir,
  sourceSupportRowsFile,
  sourceRowsFile,
  identityPreflightIndex,
  context,
  classificationQueue,
  locationQueue,
  classificationApplyReport,
  locationApplyReport,
  identityApplyReports,
  patchCollectReport,
  patchApplyReport,
  targetUserId,
  stateCode,
}) {
  const args = [
    process.execPath,
    "scripts/foundry.mjs",
    "dataset-post-authoring-finalize",
    "--type",
    type,
    "--profile",
    "bafu",
    "--rows-file",
    repoRelative(rowsFile),
    "--out-dir",
    repoRelative(outDir),
    "--ledger-dir",
    repoRelative(ledgerDir),
  ];
  appendPathOption(args, "--source-support-rows-file", sourceSupportRowsFile);
  appendPathOption(args, "--source-rows-file", sourceRowsFile);
  appendPathOption(args, "--identity-preflight-index", identityPreflightIndex);
  appendPathOption(args, "--schema-file", context.schemaFile);
  appendPathOption(args, "--yaml-file", context.yamlFile);
  appendPathOption(args, "--ruleset-file", context.rulesetFile);
  appendPathOption(args, "--classification-queue", classificationQueue);
  appendPathOption(args, "--location-queue", locationQueue);
  appendPathOption(args, "--classification-decision-apply-report", classificationApplyReport);
  appendPathOption(args, "--location-decision-apply-report", locationApplyReport);
  appendPathOptions(args, "--identity-decision-apply-report", identityApplyReports);
  appendPathOption(args, "--patch-collect-report", patchCollectReport);
  appendPathOption(args, "--patch-apply-report", patchApplyReport);
  appendOption(args, "--target-user-id", targetUserId);
  appendOption(args, "--state-code", stateCode);
  appendOption(args, "--root-policy", "candidate");
  args.push(
    "--finalize-source-contact-support",
    "--verify-remote",
    "--run-identity-preflight",
    "--refresh-identity-preflight",
  );
  if (patchCollectReport) args.push("--require-patch-collect-report");
  return args;
}

async function runFinalizeStage({ stage, args, reportPath, logDir }) {
  const result = await runArgvStage({ stage, argv: args, logDir });
  const reportExists = fileExists(reportPath);
  const report = reportExists
    ? readJson(reportPath)
    : {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "failed_retryable",
        blockers: [
          {
            code: result.timed_out ? "finalize_stage_timeout" : "finalize_report_missing",
            message: result.timed_out
              ? `${stage} timed out before writing the expected finalize report.`
              : `${stage} did not write the expected finalize report.`,
            stage,
            expected_report: repoRelative(reportPath),
            exit_code: result.exit_code,
            timed_out: Boolean(result.timed_out),
            stdout_log: result.stdout_log,
            stderr_log: result.stderr_log,
            stdout_report_status: result.json?.status ?? null,
            stdout_report_dataset_type: result.json?.dataset_type ?? null,
          },
        ],
        files: {
          expected_report: repoRelative(reportPath),
          stdout_log: result.stdout_log,
          stderr_log: result.stderr_log,
        },
      };
  result.finalize_report_missing = !reportExists;
  result.report = repoRelative(reportPath);
  result.json = report;
  return result;
}

async function runIdentityAndPatch({
  type,
  inputRowsFile,
  preFinalizeReport,
  scopeDir,
  runDir,
  logDir,
  stages,
  label = type,
  stagePrefix = type,
}) {
  const gateReport = resolveRepoPath(preFinalizeReport?.files?.curation_gate_report);
  if (!fileExists(gateReport)) {
    return {
      status: "blocked",
      blocker: {
        code: `${type}_curation_gate_report_missing`,
        message: `${type} curation gate report is required for identity and patch authoring.`,
      },
    };
  }

  const identityTaskDir = path.join(scopeDir, `${label}-identity-task`);
  const identityTask = await runArgvStage({
    stage: `${stagePrefix}.identity_task`,
    argv: foundryCommand("dataset-identity-decision-task-build", {
      curationGateReport: repoRelative(gateReport),
      outDir: repoRelative(identityTaskDir),
      sharedContextCacheDir: repoRelative(path.join(runDir, "shared-context-cache")),
    }),
    logDir,
    reportPath: path.join(identityTaskDir, "identity-decision-task-report.json"),
  });
  stages.push(identityTask);
  if (
    !statusIs(identityTask.json, ["ready_for_ai_identity_decisions", "ready_no_identity_actions"])
  ) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        identityTask.json,
        `${type}_identity_task_not_ready`,
        `${type} identity task did not become ready.`,
      ),
      report: reportFile(
        identityTask.json,
        path.join(identityTaskDir, "identity-decision-task-report.json"),
      ),
    };
  }

  let identityApplyReport = null;
  let identityOutputRows = inputRowsFile;
  const identityDecisions = path.join(identityTaskDir, "identity-decisions.jsonl");
  if (statusIs(identityTask.json, ["ready_for_ai_identity_decisions"])) {
    const identityAutofill = await runArgvStage({
      stage: `${stagePrefix}.identity_autofill`,
      argv: foundryCommand("dataset-bafu-identity-decisions-autofill", {
        identityDecisionTask: repoRelative(
          path.join(identityTaskDir, "identity-decision-task.json"),
        ),
      }),
      logDir,
      reportPath: path.join(identityTaskDir, "bafu-identity-decisions-autofill-report.json"),
    });
    stages.push(identityAutofill);
    if (!statusIs(identityAutofill.json, ["completed", "completed_with_manual_review"])) {
      return {
        status: "blocked",
        blocker: firstBlocker(
          identityAutofill.json,
          `${type}_identity_autofill_not_completed`,
          `${type} identity autofill did not complete.`,
        ),
        report: reportFile(
          identityAutofill.json,
          path.join(identityTaskDir, "bafu-identity-decisions-autofill-report.json"),
        ),
      };
    }
    const identityApplyDir = path.join(scopeDir, `${label}-identity-apply`);
    const identityApply = await runArgvStage({
      stage: `${stagePrefix}.identity_apply`,
      argv: foundryCommand("dataset-identity-decisions-apply", {
        type,
        rowsFile: repoRelative(inputRowsFile),
        decisions: repoRelative(identityDecisions),
        outDir: repoRelative(identityApplyDir),
        authoringPackageDir: repoRelative(
          path.join(identityTaskDir, "authoring-package-snapshots"),
        ),
      }),
      logDir,
      reportPath: path.join(identityApplyDir, "identity-decisions-apply-report.json"),
    });
    stages.push(identityApply);
    identityApplyReport = reportFile(
      identityApply.json,
      path.join(identityApplyDir, "identity-decisions-apply-report.json"),
    );
    if (!statusIs(identityApply.json, ["completed"])) {
      return {
        status: "blocked",
        blocker: firstBlocker(
          identityApply.json,
          `${type}_identity_apply_not_completed`,
          `${type} identity decisions did not apply cleanly.`,
        ),
        report: identityApplyReport,
      };
    }
    identityOutputRows =
      resolveRepoPath(identityApply.json?.files?.output_rows) || identityOutputRows;
  }

  const authoringDir = path.join(scopeDir, `${label}-authoring-tasks`);
  const taskManifest = path.join(authoringDir, "authoring-task-manifest.json");
  const taskBuild = await runArgvStage({
    stage: `${stagePrefix}.authoring_task`,
    argv: foundryCommand("dataset-authoring-task-build", {
      curationGateReport: repoRelative(gateReport),
      outDir: repoRelative(authoringDir),
      sharedContextCacheDir: repoRelative(path.join(runDir, "shared-context-cache")),
    }),
    logDir,
    reportPath: taskManifest,
  });
  stages.push(taskBuild);
  if (!statusIs(taskBuild.json, ["ready_for_ai_authoring_batch", "ready_no_action_items"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        taskBuild.json,
        `${type}_authoring_task_not_ready`,
        `${type} authoring task did not become ready.`,
      ),
      report: reportFile(taskBuild.json, taskManifest),
    };
  }
  if (statusIs(taskBuild.json, ["ready_no_action_items"])) {
    return {
      status: "completed",
      rowsFile: identityOutputRows,
      identityApplyReport,
      patchCollectReport: null,
      patchApplyReport: null,
    };
  }

  const taskFilter = filterAuthoringTaskManifestToRows({
    taskManifest,
    rowsFile: identityOutputRows,
    type,
    reportPath: path.join(authoringDir, "authoring-task-filter-report.json"),
  });
  const activeTaskManifest = taskFilter.taskManifest;
  if (taskFilter.status === "ready_no_action_items") {
    return {
      status: "completed",
      rowsFile: identityOutputRows,
      identityApplyReport,
      patchCollectReport: null,
      patchApplyReport: null,
    };
  }

  const patchAutofill = await runArgvStage({
    stage: `${stagePrefix}.patch_autofill`,
    argv: foundryCommand("dataset-bafu-authoring-patches-autofill", {
      taskManifest: repoRelative(activeTaskManifest),
    }),
    logDir,
    reportPath: path.join(authoringDir, "bafu-authoring-patches-autofill-report.json"),
  });
  stages.push(patchAutofill);
  if (!statusIs(patchAutofill.json, ["completed", "completed_no_supported_patches"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        patchAutofill.json,
        `${type}_patch_autofill_not_completed`,
        `${type} patch autofill did not complete.`,
      ),
      report: reportFile(
        patchAutofill.json,
        path.join(authoringDir, "bafu-authoring-patches-autofill-report.json"),
      ),
    };
  }

  const patchCollect = await runArgvStage({
    stage: `${stagePrefix}.patch_collect`,
    argv: foundryCommand("dataset-authoring-patch-collect", {
      taskManifest: repoRelative(activeTaskManifest),
    }),
    logDir,
    reportPath: path.join(authoringDir, "authoring-patch-collect-report.json"),
  });
  stages.push(patchCollect);
  const patchCollectReport = reportFile(
    patchCollect.json,
    path.join(authoringDir, "authoring-patch-collect-report.json"),
  );
  if (!statusIs(patchCollect.json, ["ready_for_patch_apply", "ready_no_patch_required"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        patchCollect.json,
        `${type}_patch_collect_not_ready`,
        `${type} patch collection did not become ready.`,
      ),
      report: patchCollectReport,
    };
  }
  if (statusIs(patchCollect.json, ["ready_no_patch_required"])) {
    return {
      status: "completed",
      rowsFile: identityOutputRows,
      identityApplyReport,
      patchCollectReport,
      patchApplyReport: null,
    };
  }

  const patchedRowsFile = path.join(
    authoringDir,
    `${type === "flow" ? "flows" : "processes"}.patched.jsonl`,
  );
  const patchApplyDir = path.join(authoringDir, "patch-apply");
  const patchApply = await runArgvStage({
    stage: `${stagePrefix}.patch_apply`,
    argv: [
      process.execPath,
      "scripts/foundry.mjs",
      "dataset-patch-apply",
      "--input",
      repoRelative(identityOutputRows),
      "--patch",
      repoRelative(
        patchCollect.json?.files?.batch_patch || path.join(authoringDir, "ai-patches.batch.json"),
      ),
      "--out",
      repoRelative(patchedRowsFile),
      "--out-dir",
      repoRelative(patchApplyDir),
      "--authoring-package-dir",
      repoRelative(path.join(authoringDir, "authoring-package-snapshots")),
      "--require-authoring-package",
      "--require-action-item-closure",
    ],
    logDir,
    reportPath: path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json"),
  });
  stages.push(patchApply);
  const patchApplyReport = reportFile(
    patchApply.json,
    path.join(patchApplyDir, "outputs", "dataset-patch-apply-report.json"),
  );
  if (!statusIs(patchApply.json, ["completed"])) {
    return {
      status: "blocked",
      blocker: firstBlocker(
        patchApply.json,
        `${type}_patch_apply_not_completed`,
        `${type} patch apply did not complete.`,
      ),
      report: patchApplyReport,
    };
  }
  return {
    status: "completed",
    rowsFile: resolveRepoPath(patchApply.json?.files?.patched_rows) || patchedRowsFile,
    identityApplyReport,
    patchCollectReport,
    patchApplyReport,
  };
}

async function maybeCommitSupportThenRerunFinalize({
  type,
  finalizeReport,
  finalizeReportPath,
  finalizeArgs,
  ledgerDir,
  scopeDir,
  logDir,
  stages,
}) {
  const supportPlan = resolveRepoPath(
    finalizeReport?.files?.source_contact_support_commit_handoff_plan,
  );
  if (!fileExists(supportPlan)) return finalizeReport;
  const handoffPlan = readJson(supportPlan);
  const supportIdentityKeys = supportIdentityKeysFromHandoffPlan(handoffPlan);
  const previousSupportCommit = supportCommitQueue;
  let releaseSupportCommit;
  supportCommitQueue = new Promise((resolve) => {
    releaseSupportCommit = resolve;
  });
  await previousSupportCommit;
  let supportResult;
  try {
    if (
      supportIdentityKeys.length > 0 &&
      supportIdentityKeys.every((identityKey) => verifiedSupportIdentities.has(identityKey))
    ) {
      const reuseDir = path.join(scopeDir, `${type}-source-contact-support-handoff`);
      const reuseReportPath = path.join(reuseDir, "reused-support-identities.json");
      writeJson(reuseReportPath, {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "reused_verified_support_identities",
        handoff_plan: repoRelative(supportPlan),
        support_identities: supportIdentityKeys,
      });
      stages.push({
        stage: `${type}.support.reuse_verified`,
        status: "skipped",
        report: repoRelative(reuseReportPath),
        support_identities: supportIdentityKeys,
      });
      const rerun = await runFinalizeStage({
        stage: `${type}.finalize_after_support_reuse`,
        args: finalizeArgs,
        reportPath: finalizeReportPath,
        logDir,
      });
      stages.push(rerun);
      return rerun.json;
    }
    supportResult = await executeHandoff({
      handoffPlanPath: supportPlan,
      ledgerDir,
      outDir: path.join(scopeDir, `${type}-source-contact-support-handoff`),
      logDir,
      label: `${type}.support`,
    });
  } finally {
    releaseSupportCommit();
  }
  stages.push(...supportResult.stages);
  if (supportResult.status !== "completed") {
    return {
      ...finalizeReport,
      status: "blocked",
      blockers: [...(supportResult.blockers ?? []), ...(finalizeReport.blockers ?? [])],
    };
  }
  for (const identityKey of supportIdentityKeys) verifiedSupportIdentities.add(identityKey);
  const rerun = await runFinalizeStage({
    stage: `${type}.finalize_after_support`,
    args: finalizeArgs,
    reportPath: finalizeReportPath,
    logDir,
  });
  stages.push(rerun);
  return rerun.json;
}

async function finalizeAndCommitDataset({
  type,
  rowsFile,
  scopeDir,
  runDir,
  materialized,
  classificationApplyReport,
  locationApplyReport,
  identityApplyReports,
  patchCollectReport,
  patchApplyReport,
  targetUserId,
  stateCode,
  logDir,
  ledgerDir,
  stages,
}) {
  const context = defaultContext(runDir, type);
  const finalizeDir = path.join(scopeDir, `finalize-${type}-ready`);
  const finalizeReportPath = path.join(finalizeDir, "dataset-post-authoring-finalize-report.json");
  let currentRowsFile = rowsFile;
  const currentIdentityApplyReports = [...(identityApplyReports ?? [])];
  let currentPatchCollectReport = patchCollectReport;
  let currentPatchApplyReport = patchApplyReport;
  let finalizeReport = null;
  let finalizeArgs = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    finalizeArgs = buildFinalizeArgs({
      type,
      rowsFile: currentRowsFile,
      outDir: finalizeDir,
      ledgerDir,
      sourceSupportRowsFile: materialized.supportRowsFile,
      sourceRowsFile: materialized.sourceRowsFile,
      identityPreflightIndex: materialized.identityPreflightIndex,
      context,
      classificationQueue: materialized.classificationQueue,
      locationQueue: materialized.locationQueue,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: currentIdentityApplyReports,
      patchCollectReport: currentPatchCollectReport,
      patchApplyReport: currentPatchApplyReport,
      targetUserId,
      stateCode,
    });
    const finalize = await runFinalizeStage({
      stage:
        attempt === 0
          ? `${type}.finalize_ready`
          : `${type}.finalize_ready_after_authoring_${attempt}`,
      args: finalizeArgs,
      reportPath: finalizeReportPath,
      logDir,
    });
    stages.push(finalize);
    if (finalize.finalize_report_missing) {
      finalizeReport = finalize.json;
      return {
        status: "failed",
        blocker: firstBlocker(
          finalizeReport,
          "finalize_report_missing",
          `${type} finalize did not write the expected report.`,
        ),
        report: finalizeReportPath,
        finalizeReport,
      };
    }
    finalizeReport = await maybeCommitSupportThenRerunFinalize({
      type,
      finalizeReport: finalize.json,
      finalizeReportPath,
      finalizeArgs,
      ledgerDir,
      scopeDir,
      logDir,
      stages,
    });
    if (finalizeReport?.status === "ready_for_remote_write") break;
    const gateReport = resolveRepoPath(finalizeReport?.files?.curation_gate_report);
    if (!fileExists(gateReport)) break;
    const recovery = await runIdentityAndPatch({
      type,
      inputRowsFile: currentRowsFile,
      preFinalizeReport: finalizeReport,
      scopeDir,
      runDir,
      logDir,
      stages,
      label: `${type}-post-finalize-${attempt + 1}`,
      stagePrefix: `${type}.post_finalize_${attempt + 1}`,
    });
    if (recovery.status !== "completed") {
      return {
        status: "blocked",
        blocker: recovery.blocker,
        report: recovery.report ?? finalizeReportPath,
        finalizeReport,
      };
    }
    const producedEvidence =
      recovery.identityApplyReport || recovery.patchCollectReport || recovery.patchApplyReport;
    if (!producedEvidence) break;
    currentRowsFile = recovery.rowsFile;
    if (recovery.identityApplyReport)
      currentIdentityApplyReports.push(recovery.identityApplyReport);
    if (recovery.patchCollectReport) currentPatchCollectReport = recovery.patchCollectReport;
    if (recovery.patchApplyReport) currentPatchApplyReport = recovery.patchApplyReport;
  }
  if (finalizeReport?.status !== "ready_for_remote_write") {
    return {
      status: "blocked",
      blocker: firstBlocker(
        finalizeReport,
        `${type}_finalize_not_ready`,
        `${type} finalize status is ${finalizeReport?.status || "missing"}.`,
      ),
      report: finalizeReportPath,
      finalizeReport,
    };
  }
  const handoffPlan = resolveRepoPath(finalizeReport?.files?.commit_handoff_plan);
  const handoff = await executeHandoff({
    handoffPlanPath: handoffPlan,
    ledgerDir,
    outDir: path.join(scopeDir, `${type}-handoff`),
    logDir,
    label: type,
  });
  stages.push(...handoff.stages);
  if (handoff.status !== "completed") {
    return {
      status: "failed",
      blocker: handoff.blockers?.[0] ?? {
        code: `${type}_handoff_failed`,
        message: `${type} commit/verify handoff failed.`,
      },
      report: finalizeReportPath,
      finalizeReport,
      handoff,
    };
  }
  return {
    status: "completed",
    report: finalizeReportPath,
    finalizeReport,
    handoff,
  };
}

async function runOneScope({
  scope,
  options,
  paths,
  schemas,
  verifiedScopes,
  verifiedFlows,
  blockedScopes,
}) {
  const processId = scope.process_id || scope.id;
  const processVersion = scope.process_version || scope.version || "00.00.001";
  const scopeDir = path.join(paths.outDir, "scopes", processId);
  const logDir = path.join(scopeDir, "logs");
  const ledgerDir = path.join(scopeDir, "import-ledger");
  const stages = [];
  const checkpointBase = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: processId,
    process_version: processVersion,
    scope_lock: `process:${processId}:${processVersion}`,
  };
  const rerunCommand = commandString([
    process.execPath,
    "scripts/foundry.mjs",
    commandName,
    "--scope-file",
    repoRelative(paths.scopeFile),
    "--process-bundles-dir",
    repoRelative(paths.processBundlesDir),
    "--run-dir",
    repoRelative(paths.runDir),
    "--out-dir",
    repoRelative(paths.outDir),
    "--process-id",
    processId,
    "--commit",
    "--parallel",
    "1",
  ]);

  fs.mkdirSync(scopeDir, { recursive: true });
  if (verifiedScopes.has(`${processId}@${processVersion}`) && !booleanOption(options.force)) {
    const checkpoint = { ...checkpointBase, state: "skipped_already_verified" };
    appendJsonLine(paths.scopeCheckpoints, checkpoint);
    return { status: "skipped", checkpoint, stages };
  }
  const explicitProcessIds = new Set(normalizedList(options.processId || options.processIds));
  if (
    blockedScopes?.has(`${processId}@${processVersion}`) &&
    !booleanOption(options.force) &&
    !explicitProcessIds.has(processId)
  ) {
    const checkpoint = { ...checkpointBase, state: "skipped_blocked_deferred" };
    appendJsonLine(paths.scopeCheckpoints, checkpoint);
    return { status: "skipped_blocked", checkpoint, stages };
  }

  appendJsonLine(paths.scopeCheckpoints, { ...checkpointBase, state: "started" });

  const block = ({ stage, blocker, report }) => {
    const row = blockRow({ scope, stage, blocker, report, rerunCommand });
    appendJsonLine(paths.blockedHumanReview, row);
    appendJsonLine(
      paths[`blocked_${categoryForBlocker(row.code).replace(/-/gu, "_")}`] || paths.blockedOther,
      row,
    );
    appendJsonLine(paths.scopeCheckpoints, {
      ...checkpointBase,
      state: "blocked_deferred",
      stage,
      code: row.code,
    });
    return {
      status: "blocked",
      checkpoint: { ...checkpointBase, state: "blocked_deferred" },
      block: row,
      stages,
    };
  };

  const fail = ({ stage, blocker, report }) => {
    const row = blockRow({ scope, stage, blocker, report, rerunCommand });
    appendJsonLine(paths.failedRetry, row);
    appendJsonLine(paths.blocked_remote_write, row);
    appendJsonLine(paths.scopeCheckpoints, {
      ...checkpointBase,
      state: "failed_retryable",
      stage,
      code: row.code,
    });
    return {
      status: "failed",
      checkpoint: { ...checkpointBase, state: "failed_retryable" },
      block: row,
      stages,
    };
  };

  const materializedDir = path.join(scopeDir, "materialized");
  const materialize = await runArgvStage({
    stage: "materialize",
    argv: foundryCommand("dataset-bundle-sample-rows", {
      bundlesDir: repoRelative(paths.processBundlesDir),
      processId,
      outDir: repoRelative(materializedDir),
      profile: "bafu",
    }),
    logDir,
    reportPath: path.join(materializedDir, "dataset-bundle-sample-rows-report.json"),
  });
  stages.push(materialize);
  const materializedReport = materialize.json;
  const fatalMaterializeBlocker = (materializedReport?.blockers ?? []).find((blocker) =>
    [
      "requested_process_bundle_missing",
      "bundle_row_identity_missing",
      "process_scope_dependency_unresolved",
    ].includes(String(blocker?.code || "")),
  );
  if (!materializedReport || fatalMaterializeBlocker) {
    return block({
      stage: "materialize",
      blocker:
        fatalMaterializeBlocker ??
        firstBlocker(materializedReport, "materialize_not_ready", "Bundle materialization failed."),
      report: path.join(materializedDir, "dataset-bundle-sample-rows-report.json"),
    });
  }
  const materialized = {
    flowRowsFile: resolveRepoPath(materializedReport.files?.rows?.flow),
    processRowsFile: resolveRepoPath(materializedReport.files?.rows?.process),
    sourceRowsFile: resolveRepoPath(materializedReport.files?.rows?.source),
    supportRowsFile: resolveRepoPath(materializedReport.files?.rows?.support),
    classificationQueue: resolveRepoPath(materializedReport.files?.classification_authoring_queue),
    locationQueue: resolveRepoPath(materializedReport.files?.location_authoring_queue),
    identityPreflightIndex: resolveRepoPath(materializedReport.files?.identity_preflight_requests),
  };
  if (!fileExists(materialized.processRowsFile)) {
    return block({
      stage: "materialize",
      blocker: {
        code: "materialized_process_rows_missing",
        message: "Materialized process rows are missing.",
      },
      report: path.join(materializedDir, "dataset-bundle-sample-rows-report.json"),
    });
  }

  const classificationTaskDir = path.join(scopeDir, "classification-task");
  const processContext = defaultContext(paths.runDir, "process");
  const classificationTask = await runArgvStage({
    stage: "classification.task",
    argv: [
      process.execPath,
      "scripts/foundry.mjs",
      "dataset-classification-decision-task-build",
      "--classification-queue",
      repoRelative(materialized.classificationQueue),
      "--schema-file",
      repoRelative(processContext.schemaFile),
      "--yaml-file",
      repoRelative(processContext.yamlFile),
      "--ruleset-file",
      repoRelative(processContext.rulesetFile),
      "--classification-schema",
      schemas.allClassification.map(repoRelative).join(","),
      "--location-schema",
      repoRelative(schemas.location),
      "--out-dir",
      repoRelative(classificationTaskDir),
      "--shared-context-cache-dir",
      repoRelative(path.join(paths.runDir, "shared-context-cache")),
    ],
    logDir,
    reportPath: path.join(classificationTaskDir, "classification-decision-task-report.json"),
  });
  stages.push(classificationTask);
  if (
    !statusIs(classificationTask.json, [
      "ready_for_ai_classification_decisions",
      "ready_no_classification_actions",
    ])
  ) {
    return block({
      stage: "classification.task",
      blocker: firstBlocker(
        classificationTask.json,
        "classification_task_not_ready",
        "Classification decision task did not become ready.",
      ),
      report: path.join(classificationTaskDir, "classification-decision-task-report.json"),
    });
  }

  let classificationApplyReport = null;
  let flowClassifiedRows = materialized.flowRowsFile;
  let processClassifiedRows = materialized.processRowsFile;
  if (statusIs(classificationTask.json, ["ready_for_ai_classification_decisions"])) {
    const classificationProjectionDir = path.join(scopeDir, "classification-projection");
    const classificationProjection = await runArgvStage({
      stage: "classification.project",
      argv: foundryCommand("dataset-library-classification-decisions-project", {
        classificationQueue: repoRelative(materialized.classificationQueue),
        libraryDecisions: repoRelative(paths.libraryClassificationDecisions),
        decisionTask: repoRelative(
          path.join(classificationTaskDir, "classification-decision-task.json"),
        ),
        outDir: repoRelative(classificationProjectionDir),
      }),
      logDir,
      reportPath: path.join(
        classificationProjectionDir,
        "dataset-library-classification-decisions-project-report.json",
      ),
    });
    stages.push(classificationProjection);
    if (!statusIs(classificationProjection.json, ["completed", "completed_with_manual_review"])) {
      return block({
        stage: "classification.project",
        blocker: firstBlocker(
          classificationProjection.json,
          "classification_projection_not_completed",
          "Library classification decisions could not be projected to this scope.",
        ),
        report: path.join(
          classificationProjectionDir,
          "dataset-library-classification-decisions-project-report.json",
        ),
      });
    }
    const schemaRepair = repairClassificationDecisionCodes({
      decisionsFile: path.join(classificationProjectionDir, "classification-decisions.jsonl"),
      schemas,
      outDir: classificationProjectionDir,
    });
    if (schemaRepair.unresolved.length > 0) {
      return block({
        stage: "classification.schema_repair",
        blocker: {
          code: "classification_decision_code_invalid",
          message:
            "Projected classification decisions contain codes that are not valid in the bundled TIDAS category schema.",
          manual_review_rows: repoRelative(schemaRepair.unresolvedPath),
        },
        report: path.join(
          classificationProjectionDir,
          "dataset-library-classification-decisions-project-report.json",
        ),
      });
    }
    const manualRows = path.join(
      classificationProjectionDir,
      "classification-decisions.manual-review.jsonl",
    );
    if (readJsonLines(manualRows).length > 0) {
      return block({
        stage: "classification.project",
        blocker: {
          code: "classification_requires_human_review",
          message:
            "This scope still has classification decisions without a completed library-level decision.",
          manual_review_rows: repoRelative(manualRows),
        },
        report: path.join(
          classificationProjectionDir,
          "dataset-library-classification-decisions-project-report.json",
        ),
      });
    }
    const classificationApplyDir = path.join(scopeDir, "classification-apply");
    const classificationApply = await runArgvStage({
      stage: "classification.apply",
      argv: foundryCommand("dataset-classification-decisions-apply", {
        classificationQueue: repoRelative(materialized.classificationQueue),
        decisions: repoRelative(
          path.join(classificationProjectionDir, "classification-decisions.jsonl"),
        ),
        decisionTask: repoRelative(
          path.join(classificationTaskDir, "classification-decision-task.json"),
        ),
        outDir: repoRelative(classificationApplyDir),
      }),
      logDir,
      reportPath: path.join(classificationApplyDir, "classification-decisions-apply-report.json"),
    });
    stages.push(classificationApply);
    classificationApplyReport = reportFile(
      classificationApply.json,
      path.join(classificationApplyDir, "classification-decisions-apply-report.json"),
    );
    if (!statusIs(classificationApply.json, ["completed"])) {
      return block({
        stage: "classification.apply",
        blocker: firstBlocker(
          classificationApply.json,
          "classification_apply_not_completed",
          "Classification decisions did not apply cleanly.",
        ),
        report: classificationApplyReport,
      });
    }
    flowClassifiedRows = outputRowsByStem(classificationApply.json, "flows.") || flowClassifiedRows;
    processClassifiedRows =
      outputRowsByStem(classificationApply.json, "processes.") || processClassifiedRows;
  }

  let flowRowsForFinalize = flowClassifiedRows;
  let locationApplyReport = null;
  if (
    fileExists(materialized.locationQueue) &&
    readJsonLines(materialized.locationQueue).length > 0 &&
    fileExists(flowClassifiedRows)
  ) {
    const locationTaskDir = path.join(scopeDir, "location-task");
    const flowContext = defaultContext(paths.runDir, "flow");
    const locationTask = await runArgvStage({
      stage: "location.task",
      argv: [
        process.execPath,
        "scripts/foundry.mjs",
        "dataset-location-decision-task-build",
        "--location-queue",
        repoRelative(materialized.locationQueue),
        "--rows-file",
        repoRelative(flowClassifiedRows),
        "--schema-file",
        repoRelative(flowContext.schemaFile),
        "--yaml-file",
        repoRelative(flowContext.yamlFile),
        "--ruleset-file",
        repoRelative(flowContext.rulesetFile),
        "--classification-schema",
        repoRelative(schemas.flowProductCategory),
        "--location-schema",
        repoRelative(schemas.location),
        "--out-dir",
        repoRelative(locationTaskDir),
        "--shared-context-cache-dir",
        repoRelative(path.join(paths.runDir, "shared-context-cache")),
      ],
      logDir,
      reportPath: path.join(locationTaskDir, "location-decision-task-report.json"),
    });
    stages.push(locationTask);
    if (
      !statusIs(locationTask.json, ["ready_for_ai_location_decisions", "ready_no_location_actions"])
    ) {
      return block({
        stage: "location.task",
        blocker: firstBlocker(
          locationTask.json,
          "location_task_not_ready",
          "Location task did not become ready.",
        ),
        report: path.join(locationTaskDir, "location-decision-task-report.json"),
      });
    }
    if (statusIs(locationTask.json, ["ready_for_ai_location_decisions"])) {
      const locationDecisionDir = path.join(scopeDir, "location-decisions");
      const locationSuggest = await runArgvStage({
        stage: "location.suggest",
        argv: foundryCommand("dataset-location-decisions-suggest", {
          locationQueue: repoRelative(
            findOneFile(locationTaskDir, /^location-authoring-queue\..*\.jsonl$/u) ||
              materialized.locationQueue,
          ),
          decisionTask: repoRelative(path.join(locationTaskDir, "location-decision-task.json")),
          locationSchema: repoRelative(schemas.location),
          outDir: repoRelative(locationDecisionDir),
        }),
        logDir,
        reportPath: path.join(
          locationDecisionDir,
          "dataset-location-decisions-suggest-report.json",
        ),
      });
      stages.push(locationSuggest);
      if (!statusIs(locationSuggest.json, ["completed", "completed_with_manual_review"])) {
        return block({
          stage: "location.suggest",
          blocker: firstBlocker(
            locationSuggest.json,
            "location_suggest_not_completed",
            "Location decisions could not be suggested.",
          ),
          report: path.join(locationDecisionDir, "dataset-location-decisions-suggest-report.json"),
        });
      }
      const manualRows = path.join(locationDecisionDir, "location-decisions.manual-review.jsonl");
      if (readJsonLines(manualRows).length > 0) {
        return block({
          stage: "location.suggest",
          blocker: {
            code: "location_requires_human_review",
            message:
              "This scope still has location decisions without one provable TIDAS location code.",
            manual_review_rows: repoRelative(manualRows),
          },
          report: path.join(locationDecisionDir, "dataset-location-decisions-suggest-report.json"),
        });
      }
      const taskQueue =
        findOneFile(locationTaskDir, /^location-authoring-queue\..*\.jsonl$/u) ||
        materialized.locationQueue;
      const locationApplyDir = path.join(scopeDir, "location-apply");
      const locationApply = await runArgvStage({
        stage: "location.apply",
        argv: foundryCommand("dataset-location-decisions-apply", {
          locationQueue: repoRelative(taskQueue),
          decisions: repoRelative(path.join(locationDecisionDir, "location-decisions.jsonl")),
          decisionTask: repoRelative(path.join(locationTaskDir, "location-decision-task.json")),
          outDir: repoRelative(locationApplyDir),
        }),
        logDir,
        reportPath: path.join(locationApplyDir, "location-decisions-apply-report.json"),
      });
      stages.push(locationApply);
      locationApplyReport = reportFile(
        locationApply.json,
        path.join(locationApplyDir, "location-decisions-apply-report.json"),
      );
      if (!statusIs(locationApply.json, ["completed"])) {
        return block({
          stage: "location.apply",
          blocker: firstBlocker(
            locationApply.json,
            "location_apply_not_completed",
            "Location decisions did not apply cleanly.",
          ),
          report: locationApplyReport,
        });
      }
      flowRowsForFinalize = outputRowsByStem(locationApply.json, "flows.") || flowRowsForFinalize;
    }
  }

  const flowRows = readRows(flowRowsForFinalize);
  const flowIds = flowRows
    .map((row) => datasetIdentity(row, "flow"))
    .filter((identity) => identity.id);
  const unverifiedFlowIds = flowIds.filter(
    (identity) => !verifiedFlows.has(`${identity.id}@${identity.version}`),
  );
  let flowIdentityReport = null;
  let flowIdentityReportsForProcess = existingIdentityApplyReportsWithReferenceRewrites(
    scopeDir,
    "flow",
  );
  if (flowRows.length > 0 && unverifiedFlowIds.length > 0) {
    const flowPreDir = path.join(scopeDir, "flow-pre-finalize");
    const flowPreReportPath = path.join(flowPreDir, "dataset-post-authoring-finalize-report.json");
    const flowPreArgs = buildFinalizeArgs({
      type: "flow",
      rowsFile: flowRowsForFinalize,
      outDir: flowPreDir,
      ledgerDir,
      sourceSupportRowsFile: materialized.supportRowsFile,
      sourceRowsFile: materialized.sourceRowsFile,
      identityPreflightIndex: materialized.identityPreflightIndex,
      context: defaultContext(paths.runDir, "flow"),
      classificationQueue: materialized.classificationQueue,
      locationQueue: materialized.locationQueue,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: [],
      targetUserId: options.targetUserId,
      stateCode: options.stateCode,
    });
    const flowPre = await runFinalizeStage({
      stage: "flow.pre_finalize",
      args: flowPreArgs,
      reportPath: flowPreReportPath,
      logDir,
    });
    stages.push(flowPre);
    if (flowPre.finalize_report_missing) {
      return fail({
        stage: "flow.pre_finalize",
        blocker: firstBlocker(
          flowPre.json,
          "finalize_report_missing",
          "Flow pre-finalize did not write the expected report.",
        ),
        report: flowPreReportPath,
      });
    }
    let flowReadyRows = resolveRepoPath(flowPre.json?.files?.final_rows) || flowRowsForFinalize;
    let flowPatchCollectReport = null;
    let flowPatchApplyReport = null;
    if (flowPre.json?.status !== "ready_for_remote_write") {
      const flowAuthoring = await runIdentityAndPatch({
        type: "flow",
        inputRowsFile: flowReadyRows,
        preFinalizeReport: flowPre.json,
        scopeDir,
        runDir: paths.runDir,
        logDir,
        stages,
      });
      if (flowAuthoring.status !== "completed") {
        return block({
          stage: "flow.authoring",
          blocker: flowAuthoring.blocker,
          report: flowAuthoring.report,
        });
      }
      flowReadyRows = flowAuthoring.rowsFile;
      flowIdentityReport = flowAuthoring.identityApplyReport;
      flowIdentityReportsForProcess = uniqueExistingPaths([
        ...flowIdentityReportsForProcess,
        flowIdentityReport,
      ]);
      flowPatchCollectReport = flowAuthoring.patchCollectReport;
      flowPatchApplyReport = flowAuthoring.patchApplyReport;
    }
    const flowCommit = await finalizeAndCommitDataset({
      type: "flow",
      rowsFile: flowReadyRows,
      scopeDir,
      runDir: paths.runDir,
      materialized,
      classificationApplyReport,
      locationApplyReport,
      identityApplyReports: flowIdentityReport ? [flowIdentityReport] : [],
      patchCollectReport: flowPatchCollectReport,
      patchApplyReport: flowPatchApplyReport,
      targetUserId: options.targetUserId,
      stateCode: options.stateCode,
      logDir,
      ledgerDir,
      stages,
    });
    if (flowCommit.status === "failed") {
      return fail({ stage: "flow.commit", blocker: flowCommit.blocker, report: flowCommit.report });
    }
    if (flowCommit.status !== "completed") {
      if (categoryForBlocker(flowCommit.blocker?.code) === "remote-write") {
        return fail({
          stage: "flow.finalize",
          blocker: flowCommit.blocker,
          report: flowCommit.report,
        });
      }
      return block({
        stage: "flow.finalize",
        blocker: flowCommit.blocker,
        report: flowCommit.report,
      });
    }
    const committedFlowRows =
      readRows(resolveRepoPath(flowCommit.finalizeReport?.files?.final_rows)).length > 0
        ? readRows(resolveRepoPath(flowCommit.finalizeReport?.files?.final_rows))
        : readRows(flowReadyRows);
    for (const identity of committedFlowRows
      .map((row) => datasetIdentity(row, "flow"))
      .filter((entry) => entry.id)) {
      const identityKey = `${identity.id}@${identity.version}`;
      const alreadyVerified = verifiedFlows.has(identityKey);
      verifiedFlows.add(identityKey);
      if (alreadyVerified) continue;
      appendJsonLine(
        paths.okFlows,
        okDatasetRow({
          type: "flow",
          id: identity.id,
          version: identity.version,
          processId,
          report: flowCommit.report,
          files: {
            finalize_report: repoRelative(flowCommit.report),
            closeout_report: repoRelative(flowCommit.handoff?.closeoutReportPath),
          },
        }),
      );
    }
  }

  const processPreDir = path.join(scopeDir, "process-pre-finalize");
  const processPreReportPath = path.join(
    processPreDir,
    "dataset-post-authoring-finalize-report.json",
  );
  const processPreArgs = buildFinalizeArgs({
    type: "process",
    rowsFile: processClassifiedRows,
    outDir: processPreDir,
    ledgerDir,
    sourceSupportRowsFile: materialized.supportRowsFile,
    sourceRowsFile: materialized.sourceRowsFile,
    identityPreflightIndex: materialized.identityPreflightIndex,
    context: defaultContext(paths.runDir, "process"),
    classificationQueue: materialized.classificationQueue,
    locationQueue: materialized.locationQueue,
    classificationApplyReport,
    locationApplyReport,
    identityApplyReports: flowIdentityReportsForProcess,
    targetUserId: options.targetUserId,
    stateCode: options.stateCode,
  });
  const processPre = await runFinalizeStage({
    stage: "process.pre_finalize",
    args: processPreArgs,
    reportPath: processPreReportPath,
    logDir,
  });
  stages.push(processPre);
  if (processPre.finalize_report_missing) {
    return fail({
      stage: "process.pre_finalize",
      blocker: firstBlocker(
        processPre.json,
        "finalize_report_missing",
        "Process pre-finalize did not write the expected report.",
      ),
      report: processPreReportPath,
    });
  }
  let processRowsForE2e =
    resolveRepoPath(processPre.json?.files?.final_rows) || processClassifiedRows;
  let processIdentityReport = null;
  let processPatchCollectReport = null;
  let processPatchApplyReport = null;
  if (processPre.json?.status !== "ready_for_remote_write") {
    const processAuthoring = await runIdentityAndPatch({
      type: "process",
      inputRowsFile: processRowsForE2e,
      preFinalizeReport: processPre.json,
      scopeDir,
      runDir: paths.runDir,
      logDir,
      stages,
    });
    if (processAuthoring.status !== "completed") {
      return block({
        stage: "process.authoring",
        blocker: processAuthoring.blocker,
        report: processAuthoring.report,
      });
    }
    processRowsForE2e = processAuthoring.rowsFile;
    processIdentityReport = processAuthoring.identityApplyReport;
    processPatchCollectReport = processAuthoring.patchCollectReport;
    processPatchApplyReport = processAuthoring.patchApplyReport;
  }

  const e2eDir = path.join(scopeDir, "process-e2e");
  const e2eArgs = [
    process.execPath,
    "scripts/foundry.mjs",
    "dataset-bafu-process-scope-e2e",
    "--rows-file",
    repoRelative(processRowsForE2e),
    "--source-support-rows-file",
    repoRelative(materialized.supportRowsFile),
    "--source-rows-file",
    repoRelative(materialized.sourceRowsFile),
    "--identity-preflight-index",
    repoRelative(materialized.identityPreflightIndex),
    "--schema-file",
    repoRelative(defaultContext(paths.runDir, "process").schemaFile),
    "--yaml-file",
    repoRelative(defaultContext(paths.runDir, "process").yamlFile),
    "--ruleset-file",
    repoRelative(defaultContext(paths.runDir, "process").rulesetFile),
    "--classification-queue",
    repoRelative(materialized.classificationQueue),
    "--location-queue",
    repoRelative(materialized.locationQueue),
    "--classification-decision-apply-report",
    repoRelative(classificationApplyReport),
    "--target-user-id",
    options.targetUserId,
    "--state-code",
    String(options.stateCode),
    "--root-policy",
    "candidate",
    "--verify-remote",
    "true",
    "--finalize-source-contact-support",
    "true",
    "--run-identity-preflight",
    "true",
    "--refresh-identity-preflight",
    "true",
    "--out-dir",
    repoRelative(e2eDir),
    "--execute",
    "--commit-support",
    "--commit",
    "--force",
  ];
  appendPathOption(e2eArgs, "--location-decision-apply-report", locationApplyReport);
  appendPathOptions(
    e2eArgs,
    "--identity-decision-apply-report",
    [...flowIdentityReportsForProcess, processIdentityReport].filter(Boolean),
  );
  appendPathOption(e2eArgs, "--patch-collect-report", processPatchCollectReport);
  appendPathOption(e2eArgs, "--patch-apply-report", processPatchApplyReport);
  const e2e = await runArgvStage({
    stage: "process.e2e_commit",
    argv: e2eArgs,
    logDir,
    reportPath: path.join(e2eDir, "bafu-process-scope-e2e-report.json"),
  });
  stages.push(e2e);
  const e2eReport = reportFile(e2e.json, path.join(e2eDir, "bafu-process-scope-e2e-report.json"));
  if (!statusIs(e2e.json, ["completed"])) {
    const blocker = firstBlocker(
      e2e.json,
      e2e.exit_code === 0 ? "process_e2e_not_completed" : "process_e2e_failed",
      "Process scope e2e commit did not complete.",
    );
    if (categoryForBlocker(blocker.code) === "remote-write") {
      return fail({ stage: "process.e2e_commit", blocker, report: e2eReport });
    }
    return block({ stage: "process.e2e_commit", blocker, report: e2eReport });
  }

  verifiedScopes.add(`${processId}@${processVersion}`);
  appendJsonLine(
    paths.okProcesses,
    okDatasetRow({
      type: "process",
      id: processId,
      version: processVersion,
      processId,
      report: e2eReport,
      files: {
        e2e_report: repoRelative(e2eReport),
        process_closeout_report: e2e.json?.files?.process_closeout_report ?? null,
      },
    }),
  );
  appendJsonLine(paths.okScopes, {
    schema_version: 1,
    generated_at_utc: nowIso(),
    process_id: processId,
    process_version: processVersion,
    status: "verified",
    report: repoRelative(e2eReport),
    rows: {
      flows: flowIds.length,
      processes: 1,
    },
  });
  appendJsonLine(paths.scopeCheckpoints, {
    ...checkpointBase,
    state: "verified",
    stages: stages.map((stage) => ({
      stage: stage.stage,
      exit_code: stage.exit_code,
      report: stage.report,
      stdout_log: stage.stdout_log,
      stderr_log: stage.stderr_log,
    })),
  });
  writeJson(path.join(scopeDir, "scope-run-report.json"), {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: "verified",
    process_id: processId,
    process_version: processVersion,
    stages,
    files: {
      e2e_report: repoRelative(e2eReport),
    },
  });
  return { status: "verified", stages };
}

export function createBafuBatchImportRunCommands(deps) {
  installBafuBatchRuntime(deps);
  async function runDatasetBafuBatchImportRun(options = {}) {
    if (options.help || options.h) {
      return {
        schema_version: 1,
        status: "help",
        command: commandName,
        usage: [
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-bundles-dir <.../process-bundles> --run-dir <run-dir> --out-dir <run-dir>/batch-import --parallel 5 --commit",
          "node scripts/foundry.mjs dataset-bafu-batch-import-run --scope-file <ready-scopes.jsonl> --process-id <uuid> --commit",
        ],
        purpose:
          "Run BAFU ready process scopes through materialize, semantic decisions, dependency flow commit, support commit, process commit, readback verify, and resumable ledgers.",
        remote_write_mode: "explicit-commit-only",
        ...bafuBatchStageContract,
      };
    }

    const runDir = resolveRepoPath(
      options.runDir || path.dirname(resolveRepoPath(options.scopeFile || "") || repoRoot),
    );
    const scopeFile = resolveRepoPath(
      options.scopeFile ||
        path.join(runDir, "library-resolution-v4-leaf-category-map", "ready-scopes.jsonl"),
    );
    const processBundlesDir = resolveRepoPath(
      options.processBundlesDir ||
        options.bundlesDir ||
        "inputs/BAFU-2025 Version 2 - TIDAS 2026-03-09/process-bundles",
    );
    if (!fileExists(scopeFile)) throw new Error("--scope-file is required.");
    if (!directoryExists(processBundlesDir)) throw new Error("--process-bundles-dir is required.");
    if (!directoryExists(runDir)) throw new Error("--run-dir is required.");
    const outDir = resolveRepoPath(options.outDir || path.join(runDir, "batch-import"));
    const commit = booleanOption(options.commit);
    if (!commit) {
      throw new Error(
        `${commandName} currently requires --commit so every remote write has verify/closeout evidence.`,
      );
    }
    const targetUserId = asText(options.targetUserId);
    if (!targetUserId) throw new Error("--target-user-id is required.");
    const stateCode = integerOption(options.stateCode, 0);
    const parallel = Math.max(1, Math.min(12, integerOption(options.parallel, 5)));
    const limit = options.limit == null ? null : Math.max(0, integerOption(options.limit, 0));
    const requestedProcessIds = new Set(normalizedList(options.processId || options.processIds));
    const allScopes = readJsonLines(scopeFile);
    let scopes = requestedProcessIds.size
      ? allScopes.filter((scope) => requestedProcessIds.has(scope.process_id || scope.id))
      : allScopes;
    if (limit != null) scopes = scopes.slice(0, limit);
    fs.mkdirSync(outDir, { recursive: true });
    const paths = {
      runDir,
      outDir,
      scopeFile,
      processBundlesDir,
      libraryClassificationDecisions: resolveRepoPath(
        options.libraryClassificationDecisions ||
          path.join(runDir, "decisions-v4-leaf-category-map", "classification-decisions.jsonl"),
      ),
      scopeCheckpoints: path.join(outDir, "scope-checkpoints.jsonl"),
      okFlows: path.join(outDir, "import-ledger", "ok.flows.verified.jsonl"),
      okProcesses: path.join(outDir, "import-ledger", "ok.processes.verified.jsonl"),
      okScopes: path.join(outDir, "import-ledger", "ok.scopes.verified.jsonl"),
      blockedHumanReview: path.join(outDir, "import-ledger", "blocked.scopes.human-review.jsonl"),
      blockedHumanReviewActive: path.join(
        outDir,
        "import-ledger",
        "blocked.scopes.human-review.active.jsonl",
      ),
      blockedHumanReviewResolved: path.join(
        outDir,
        "import-ledger",
        "blocked.scopes.human-review.resolved.jsonl",
      ),
      blocked_human_review: path.join(
        outDir,
        "import-ledger",
        "blocked.dependencies.human-review.jsonl",
      ),
      blocked_reference_closure: path.join(
        outDir,
        "import-ledger",
        "blocked.dependencies.reference-closure.jsonl",
      ),
      blocked_remote_write: path.join(
        outDir,
        "import-ledger",
        "blocked.dependencies.remote-write.jsonl",
      ),
      blockedOther: path.join(outDir, "import-ledger", "blocked.dependencies.other.jsonl"),
      failedRetry: path.join(outDir, "import-ledger", "failed.scopes.retry.jsonl"),
    };
    const schemas = defaultSchemaFiles(options);
    const missingInputs = [
      paths.libraryClassificationDecisions,
      defaultContext(runDir, "process").schemaFile,
      defaultContext(runDir, "process").yamlFile,
      defaultContext(runDir, "process").rulesetFile,
      defaultContext(runDir, "flow").schemaFile,
      defaultContext(runDir, "flow").yamlFile,
      defaultContext(runDir, "flow").rulesetFile,
      schemas.processCategory,
      schemas.flowProductCategory,
      schemas.location,
    ].filter((filePath) => !fileExists(filePath));
    if (missingInputs.length > 0) {
      throw new Error(
        `Missing required batch import inputs:\n${missingInputs.map(repoRelative).join("\n")}`,
      );
    }
    const verifiedScopes = loadVerifiedSet(paths.okScopes, "scope");
    const verifiedFlows = loadVerifiedSet(paths.okFlows, "flow");
    const blockedScopes = loadActiveBlockedScopeSet(paths, verifiedScopes);
    const manifest = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: commandName,
      status: "running",
      mode: "commit",
      target_user_id: targetUserId,
      state_code: stateCode,
      parallel,
      counts: {
        input_scopes: allScopes.length,
        selected_scopes: scopes.length,
        already_verified_scopes: verifiedScopes.size,
        already_verified_flows: verifiedFlows.size,
        already_blocked_scopes: blockedScopes.size,
      },
      files: Object.fromEntries(
        Object.entries(paths)
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, repoRelative(value)]),
      ),
      policy: {
        ready_scopes_only: true,
        blocked_scopes_deferred: true,
        process_scope_atomic_commit: true,
        support_and_flows_commit_before_process_commit: true,
        retryable_remote_failures_are_separate_from_human_review: true,
      },
    };
    writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), manifest);

    const results = [];
    let nextIndex = 0;
    async function worker(workerIndex) {
      while (nextIndex < scopes.length) {
        const scope = scopes[nextIndex];
        nextIndex += 1;
        const result = await runOneScope({
          scope,
          options: { ...options, targetUserId, stateCode },
          paths,
          schemas,
          verifiedScopes,
          verifiedFlows,
          blockedScopes,
          workerIndex,
        });
        results.push({ process_id: scope.process_id || scope.id, status: result.status });
      }
    }
    await Promise.all(Array.from({ length: parallel }, (_, index) => worker(index)));
    const blockedScopeViews = writeBlockedScopeViews(paths);

    const report = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      command: commandName,
      status: results.some((row) => row.status === "failed")
        ? "completed_with_retryable_failures"
        : results.some((row) => row.status === "blocked")
          ? "completed_with_deferred_scopes"
          : "completed",
      mode: "commit",
      parallel,
      target_user_id: targetUserId,
      counts: {
        selected_scopes: scopes.length,
        verified: results.filter((row) => row.status === "verified").length,
        skipped: results.filter((row) => row.status === "skipped").length,
        skipped_blocked: results.filter((row) => row.status === "skipped_blocked").length,
        blocked: results.filter((row) => row.status === "blocked").length,
        failed_retryable: results.filter((row) => row.status === "failed").length,
        ok_scope_ledger_rows: readJsonLines(paths.okScopes).length,
        ok_flow_ledger_rows: readJsonLines(paths.okFlows).length,
        human_review_rows: blockedScopeViews.active,
        historical_human_review_rows: blockedScopeViews.historical,
        resolved_human_review_rows: blockedScopeViews.resolved,
        retry_rows: readJsonLines(paths.failedRetry).length,
      },
      files: {
        report: repoRelative(path.join(outDir, "dataset-bafu-batch-import-run-report.json")),
        run_manifest: repoRelative(path.join(outDir, "import-ledger", "run-manifest.json")),
        scope_checkpoints: repoRelative(paths.scopeCheckpoints),
        ok_scopes: repoRelative(paths.okScopes),
        ok_flows: repoRelative(paths.okFlows),
        ok_processes: repoRelative(paths.okProcesses),
        blocked_human_review: repoRelative(paths.blockedHumanReview),
        blocked_human_review_active: repoRelative(paths.blockedHumanReviewActive),
        blocked_human_review_resolved: repoRelative(paths.blockedHumanReviewResolved),
        failed_retry: repoRelative(paths.failedRetry),
      },
      results,
    };
    writeJson(path.join(outDir, "dataset-bafu-batch-import-run-report.json"), report);
    writeJson(path.join(outDir, "import-ledger", "run-manifest.json"), {
      ...manifest,
      status: report.status,
      finished_at_utc: report.generated_at_utc,
      final_counts: report.counts,
    });
    return report;
  }

  return { runDatasetBafuBatchImportRun };
}
