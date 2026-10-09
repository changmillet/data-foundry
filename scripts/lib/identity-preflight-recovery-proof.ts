import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createFileArtifactFact, createFoundryCommandSpec } from "./foundry-command-spec.ts";
import {
  sha256Json,
  sha256Text,
  stableJson,
  parseFreshIntentBoundAuthReceipt,
  type IdentityPreflightBindingEvidence,
} from "./identity-preflight-proof.ts";

type JsonRecord = Record<string, unknown>;
export interface IdentityRecoveryFact {
  path: string;
  bytes: number;
  sha256: string;
}
export interface RetainedIdentityCliInventory {
  role: "current_retained_cli_inventory";
  root: string;
  package_version: string;
  content_sha256: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}
/** Compare retained executable dependencies with the independent current/transition inventory. */
export function verifyRetainedIdentityCliInventory(
  value: RetainedIdentityCliInventory,
  bin: string,
): void {
  if (
    value.role !== "current_retained_cli_inventory" ||
    !path.isAbsolute(value.root) ||
    fs.realpathSync(value.root) !== value.root ||
    fs.realpathSync(bin) !== path.join(value.root, "bin/tiangong-lca.js") ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > 10_000 ||
    sha256Text(JSON.stringify(value.files)) !== value.content_sha256 ||
    new Set(value.files.map((file) => file.path)).size !== value.files.length
  )
    throw new Error("Retained CLI inventory is invalid.");
  for (const fact of value.files) {
    const file = path.resolve(value.root, fact.path);
    if (
      path.isAbsolute(fact.path) ||
      !file.startsWith(value.root + path.sep) ||
      fs.realpathSync(file) !== file
    )
      throw new Error("Retained CLI inventory path changed.");
    readIdentityRecoveryFact({ ...fact, path: file });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(value.root, "package.json"), "utf8"));
  if (pkg.name !== "@tiangong-lca/cli" || pkg.version !== value.package_version)
    throw new Error("Retained CLI package identity changed.");
}
export interface IdentityPreflightRecoveryProof {
  schema: "tiangong-foundry.identity-preflight-recovery.v1";
  task_id: string;
  actor_id: string;
  new_cli_execution: false;
  binding: IdentityPreflightBindingEvidence;
  binding_sha256: string;
  original: {
    producer_base: string;
    attempt: 1;
    status: "failed";
    failure_code: "identity_preflight_cli_exit_nonzero";
    cli_exit_code: 1;
    producer_auth: {
      project_ref: string;
      user_id: string;
      receipt_scope_sha256: string;
      captured_at_utc: string;
    };
    batch_prepared_at_utc: string;
    query_generated_at_utc: string;
    batch_completed_at_utc: string;
    facts: Record<string, IdentityRecoveryFact>;
  };
  current_owner_interpretation_auth: {
    project_ref: string;
    user_id: string;
    receipt_scope_sha256: string;
    captured_at_utc: string;
  };
  recovered_at_utc: string;
  current_retained_runtime_observation: {
    role: "current_retained_runtime_observation";
    observed_at_utc: string;
    original_executable: IdentityRecoveryFact;
    qualified_node_sha256: string;
  };
  current_retained_cli_inventory: RetainedIdentityCliInventory;
  proof_sha256: string;
}

/** Current readback of a retained executable; it does not claim a query-time runtime capture. */
export function observeRetainedIdentityExecutable(file: string): IdentityRecoveryFact | null {
  let fd: number | undefined;
  try {
    if (!path.isAbsolute(file) || fs.realpathSync(file) !== file) return null;
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 256n * 1024n * 1024n) return null;
    const bytes = fs.readFileSync(fd),
      after = fs.fstatSync(fd, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.length) !== after.size
    )
      return null;
    return {
      path: file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function object(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const hash = /^[0-9a-f]{64}$/u;

/** Read only the exact named regular original evidence; never discover reports or reconstruct attempts. */
export function readIdentityRecoveryFact(fact: IdentityRecoveryFact): Buffer {
  const fd = fs.openSync(fact.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== fact.bytes || stat.size > 8 * 1024 * 1024)
      throw new Error("Recovery evidence changed.");
    const bytes = fs.readFileSync(fd);
    if (createHash("sha256").update(bytes).digest("hex") !== fact.sha256)
      throw new Error("Recovery evidence changed.");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function validateIdentityPreflightRecoveryEvidence(
  value: unknown,
  input: {
    requestText: string | null;
    reportText: string | null;
    datasetType: string;
    datasetId: string;
    datasetVersion: string;
    targetSha256: string;
    expectedProjectRef?: string | null;
    expectedUserId?: string | null;
    expectedRetainedCliContentSha256?: string;
  },
): { ok: boolean; code?: string; binding?: IdentityPreflightBindingEvidence } {
  const fail = () => ({ ok: false, code: "identity_preflight_recovery_invalid" });
  if (
    !object(value) ||
    value.schema !== "tiangong-foundry.identity-preflight-recovery.v1" ||
    value.new_cli_execution !== false ||
    typeof value.task_id !== "string" ||
    typeof value.actor_id !== "string" ||
    !object(value.binding) ||
    value.binding.schema !== "tiangong-foundry.identity-preflight-binding.v1" ||
    !object(value.original) ||
    !object(value.current_owner_interpretation_auth)
  )
    return fail();
  if (
    typeof input.expectedRetainedCliContentSha256 !== "string" ||
    !hash.test(input.expectedRetainedCliContentSha256) ||
    !object(value.current_retained_cli_inventory) ||
    value.current_retained_cli_inventory.content_sha256 !== input.expectedRetainedCliContentSha256
  )
    return fail();
  const { proof_sha256, ...scope } = value;
  if (proof_sha256 !== sha256Json(scope)) return fail();
  const binding = value.binding,
    original = value.original,
    auth = value.current_owner_interpretation_auth;
  if (
    !object(binding.dataset) ||
    !object(binding.request) ||
    !object(binding.command) ||
    !object(binding.cli) ||
    !object(binding.account) ||
    !object(binding.relevant_input_hashes)
  )
    return fail();
  const { binding_sha256, ...bindingScope } = binding;
  if (
    binding_sha256 !== sha256Json(bindingScope) ||
    value.binding_sha256 !== binding_sha256 ||
    binding.cli.package_name !== "@tiangong-lca/cli" ||
    !["0.1.22", "0.1.27"].includes(String(binding.cli.package_version)) ||
    typeof binding.cli.package_integrity !== "string" ||
    !/^sha256-[0-9a-f]{64}$/u.test(binding.cli.package_integrity) ||
    binding.dataset.type !== input.datasetType ||
    binding.dataset.id !== input.datasetId ||
    binding.dataset.version !== input.datasetVersion ||
    binding.dataset.target_sha256 !== input.targetSha256
  )
    return fail();
  if (
    original.attempt !== 1 ||
    original.status !== "failed" ||
    original.failure_code !== "identity_preflight_cli_exit_nonzero" ||
    original.cli_exit_code !== 1 ||
    !object(original.producer_auth) ||
    typeof original.producer_auth.captured_at_utc !== "string" ||
    !object(original.facts)
  )
    return fail();
  for (const account of [original.producer_auth, auth]) {
    if (
      account.project_ref !== binding.account.project_ref ||
      account.user_id !== binding.account.user_id ||
      typeof account.receipt_scope_sha256 !== "string" ||
      !hash.test(account.receipt_scope_sha256)
    )
      return fail();
  }
  if (
    (input.expectedProjectRef && input.expectedProjectRef !== binding.account.project_ref) ||
    (input.expectedUserId && input.expectedUserId !== binding.account.user_id)
  )
    return fail();
  const prepared = Date.parse(String(original.batch_prepared_at_utc)),
    query = Date.parse(String(original.query_generated_at_utc)),
    completed = Date.parse(String(original.batch_completed_at_utc)),
    interpreted = Date.parse(String(value.recovered_at_utc)),
    admitted = Date.parse(String(auth.captured_at_utc));
  if (
    ![prepared, query, completed, interpreted, admitted].every(Number.isFinite) ||
    query < prepared ||
    completed < query ||
    interpreted < completed ||
    admitted > interpreted ||
    interpreted - admitted > 300_000
  )
    return fail();
  if (input.requestText === null || input.reportText === null) return fail();
  try {
    const request: unknown = JSON.parse(input.requestText),
      report: unknown = JSON.parse(input.reportText);
    if (
      !object(request) ||
      !object(report) ||
      binding.request.bytes_sha256 !== sha256Text(input.requestText) ||
      binding.request.canonical_sha256 !== sha256Json(request) ||
      sha256Text(JSON.stringify(request.target)) !== input.targetSha256 ||
      report.schema_version !== 1 ||
      report.kind !== input.datasetType ||
      report.status !== "needs_review" ||
      report.decision !== "manual_review" ||
      report.next_action !== "queue_manual_review" ||
      report.generated_at_utc !== original.query_generated_at_utc ||
      !object(report.target) ||
      report.target.id !== input.datasetId ||
      report.target.version !== input.datasetVersion ||
      !Array.isArray(report.candidates) ||
      !Array.isArray(report.candidate_sources) ||
      !Array.isArray(report.findings) ||
      !Array.isArray(report.blockers) ||
      report.blockers.length ||
      Object.hasOwn(report, "error") ||
      (Object.hasOwn(report, "errors") &&
        (!Array.isArray(report.errors) || report.errors.length)) ||
      (Object.hasOwn(report, "ok") && report.ok !== true)
    )
      return fail();
    const texts = new Map<string, string>();
    const facts = original.facts as Record<string, IdentityRecoveryFact>;
    for (const key of [
      "stage",
      "run",
      "results",
      "preparation",
      "audit",
      "request",
      "stdout",
      "stderr",
      "report",
      "producer_receipt",
      "producer_plan",
      "job",
      "index",
      "source_file",
      "assessment",
      "auth_receipt",
    ]) {
      const fact = original.facts[key];
      if (
        !object(fact) ||
        typeof fact.path !== "string" ||
        !Number.isSafeInteger(fact.bytes) ||
        typeof fact.sha256 !== "string" ||
        !hash.test(fact.sha256)
      )
        return fail();
      texts.set(
        key,
        readIdentityRecoveryFact(fact as unknown as IdentityRecoveryFact).toString("utf8"),
      );
    }
    if (
      texts.get("request") !== input.requestText ||
      texts.get("report") !== input.reportText ||
      texts.get("stderr") !== "" ||
      stableJson(JSON.parse(texts.get("stdout")!)) !== stableJson(report)
    )
      return fail();
    const run = JSON.parse(texts.get("run")!),
      stage = JSON.parse(texts.get("stage")!),
      plan = JSON.parse(texts.get("producer_plan")!),
      receipt = JSON.parse(texts.get("producer_receipt")!),
      job = JSON.parse(texts.get("job")!);
    if (
      !object(run) ||
      !object(stage) ||
      !object(plan) ||
      !object(receipt) ||
      !object(job) ||
      run.status !== "failed" ||
      run.command !== "dataset-identity-preflight-run" ||
      run.generated_at_utc !== original.batch_completed_at_utc ||
      stage.schema !== "tiangong-foundry.identity-stage.v1" ||
      stage.status !== "blocked" ||
      plan.command !== "dataset-workflow-identity" ||
      receipt.status !== "completed" ||
      job.task_id !== value.task_id ||
      job.actor_id !== value.actor_id ||
      plan.job_sha256 !== facts.job.sha256 ||
      receipt.job_sha256 !== plan.job_sha256 ||
      !object(receipt.plan) ||
      receipt.plan.sha256 !== facts.producer_plan.sha256 ||
      !Array.isArray(receipt.outputs)
    )
      return fail();
    const options = run.runtime_options;
    if (
      !object(options) ||
      !object(options.cli) ||
      !object(options.auth_receipt) ||
      options.cli.package !== `@tiangong-lca/cli@${String(binding.cli.package_version)}` ||
      options.auth_receipt.project_ref !== original.producer_auth.project_ref ||
      options.auth_receipt.user_id !== original.producer_auth.user_id ||
      options.auth_receipt.receipt_scope_sha256 !== original.producer_auth.receipt_scope_sha256 ||
      !object(stage.account) ||
      stage.account.project_ref !== binding.account.project_ref ||
      stage.account.user_id !== binding.account.user_id ||
      !Array.isArray(run.results)
    )
      return fail();
    const originalReceipt = parseFreshIntentBoundAuthReceipt(
      JSON.parse(texts.get("auth_receipt")!),
      {
        nowMs: prepared,
        maxAgeMs: 300_000,
        expectedProjectRef: String(binding.account.project_ref),
        expectedUserId: String(binding.account.user_id),
      },
    );
    if (
      originalReceipt.receipt_scope_sha256 !== original.producer_auth.receipt_scope_sha256 ||
      originalReceipt.captured_at_utc !== original.producer_auth.captured_at_utc ||
      originalReceipt.cli.package_name !== binding.cli.package_name ||
      originalReceipt.cli.package_version !== binding.cli.package_version
    )
      return fail();
    const observed = value.current_retained_runtime_observation;
    if (
      !object(observed) ||
      observed.role !== "current_retained_runtime_observation" ||
      observed.observed_at_utc !== value.recovered_at_utc ||
      !object(observed.original_executable) ||
      typeof observed.qualified_node_sha256 !== "string" ||
      !hash.test(observed.qualified_node_sha256) ||
      observed.original_executable.path !== options.cli.executable
    )
      return fail();
    const executable = observeRetainedIdentityExecutable(String(observed.original_executable.path));
    if (
      !object(value.current_retained_cli_inventory) ||
      value.current_retained_cli_inventory.package_version !== binding.cli.package_version ||
      !Array.isArray(options.cli.args_prefix) ||
      typeof options.cli.args_prefix[0] !== "string"
    )
      return fail();
    verifyRetainedIdentityCliInventory(
      value.current_retained_cli_inventory as unknown as RetainedIdentityCliInventory,
      options.cli.args_prefix[0],
    );
    if (
      !executable ||
      executable.bytes !== observed.original_executable.bytes ||
      executable.sha256 !== observed.original_executable.sha256 ||
      executable.sha256 !== observed.qualified_node_sha256
    )
      return fail();
    const result = run.results.find(
      (row) =>
        object(row) &&
        row.dataset_type === input.datasetType &&
        row.dataset_id === input.datasetId &&
        row.dataset_version === input.datasetVersion,
    );
    if (
      !object(result) ||
      result.status !== "failed" ||
      result.failure_code !== original.failure_code ||
      result.cli_exit_code !== 1 ||
      result.attempt !== 1 ||
      result.attempts !== 1 ||
      result.binding_sha256 !== binding_sha256 ||
      result.request_bytes_sha256 !== binding.request.bytes_sha256 ||
      result.report_status !== "needs_review" ||
      result.decision !== "manual_review"
    )
      return fail();
    const indexRows = texts
      .get("index")!
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const selected = indexRows.filter(
      (row) =>
        object(row) &&
        row.dataset_type === input.datasetType &&
        row.dataset_id === input.datasetId &&
        row.dataset_version === input.datasetVersion,
    );
    if (selected.length !== 1 || !object(selected[0])) return fail();
    const assessment = JSON.parse(texts.get("assessment")!);
    if (
      typeof original.producer_base !== "string" ||
      !path.isAbsolute(original.producer_base) ||
      !object(assessment) ||
      assessment.owner_base !== original.producer_base ||
      assessment.schema !== "tiangong-foundry.assessment-stage.v1"
    )
      return fail();
    const row = selected[0],
      taskRoot = path.dirname(facts.job.path),
      resolve = (locator: unknown) =>
        typeof locator === "string" ? path.resolve(String(original.producer_base), locator) : null;
    // Absolute fact paths are confined to this original task and must match its registered producer outputs.
    if (
      Object.values(facts).some(
        (fact) => !path.isAbsolute(fact.path) || !fact.path.startsWith(taskRoot + path.sep),
      )
    )
      return fail();
    if (
      resolve(row.request_file) !== facts.request.path ||
      resolve(row.expected_report_file) !== facts.report.path ||
      resolve(row.source_file) !== facts.source_file.path ||
      binding.relevant_input_hashes.source_file !== facts.source_file.sha256 ||
      row.request_bytes_sha256 !== binding.request.bytes_sha256 ||
      row.target_sha256 !== input.targetSha256 ||
      row.request_json_sha256 !== sha256Text(JSON.stringify(request)) ||
      report.input_path !== facts.request.path ||
      report.out_dir !== resolve(row.output_dir) ||
      !object(report.files) ||
      report.files.identity_decision !== facts.report.path
    )
      return fail();
    const semanticArgv = [
      input.datasetType,
      "identity-preflight",
      "--json",
      "--timeout-ms",
      String(options.timeout_ms),
    ];
    const argv = [
      input.datasetType,
      "identity-preflight",
      "--input",
      facts.request.path,
      "--out-dir",
      String(report.out_dir),
      "--json",
      "--timeout-ms",
      String(options.timeout_ms),
    ];
    if (
      stableJson(binding.command.semantic_argv) !== stableJson(semanticArgv) ||
      !/^[1-9][0-9]*$/u.test(String(options.timeout_ms)) ||
      options.max_attempts !== 1 ||
      options.retry_failed !== null ||
      !Array.isArray(options.cli.args_prefix) ||
      options.cli.args_prefix.length !== 1 ||
      typeof options.cli.args_prefix[0] !== "string" ||
      `sha256-${sha256Text(fs.readFileSync(options.cli.args_prefix[0], "utf8"))}` !==
        binding.cli.package_integrity ||
      result.executable !== options.cli.executable ||
      result.cli_package !== options.cli.package ||
      stableJson(result.cli_args) !== stableJson(argv) ||
      resolve(result.request_file) !== facts.request.path ||
      resolve(result.report_file) !== facts.report.path ||
      resolve(result.stdout_log) !== facts.stdout.path ||
      resolve(result.stderr_log) !== facts.stderr.path
    )
      return fail();
    const spec = createFoundryCommandSpec({
      executable: String(options.cli.executable),
      argv: [...(options.cli.args_prefix as string[]), ...argv],
      binding: {
        artifacts: [
          createFileArtifactFact({
            role: "identity_preflight_request",
            path: String(row.request_file),
            filePath: facts.request.path,
          }),
        ],
      },
    });
    if (
      stableJson(result.command_spec) !== stableJson(spec) ||
      stableJson(run.results) !==
        stableJson(
          texts
            .get("results")!
            .trim()
            .split(/\r?\n/u)
            .map((line) => JSON.parse(line)),
        )
    )
      return fail();
    const preparation = JSON.parse(texts.get("preparation")!),
      audit = JSON.parse(texts.get("audit")!);
    if (
      !object(preparation) ||
      preparation.status !== "ready" ||
      preparation.generated_at_utc !== original.batch_prepared_at_utc ||
      !object(audit) ||
      audit.status !== "passed" ||
      !Array.isArray(audit.blockers) ||
      audit.blockers.length
    )
      return fail();
    for (const key of [
      "stage",
      "run",
      "results",
      "preparation",
      "audit",
      "request",
      "stdout",
      "stderr",
      "report",
      "index",
      "auth_receipt",
    ]) {
      const fact = original.facts[key] as IdentityRecoveryFact;
      if (
        !receipt.outputs.some(
          (item) =>
            object(item) &&
            item.sha256 === fact.sha256 &&
            item.bytes === fact.bytes &&
            path.resolve(taskRoot, String(item.path)) === fact.path,
        )
      )
        return fail();
    }
    return { ok: true, binding: binding as unknown as IdentityPreflightBindingEvidence };
  } catch {
    return fail();
  }
}
