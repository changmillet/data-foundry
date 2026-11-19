import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import {
  captureFoundryInput,
  FoundryContextError,
  type FoundryInputFact,
} from "./foundry-runtime-context.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { hasStructuredTraceEvidence } from "./import-curation/internal/workflow-patch-evidence.ts";
import {
  reviewerPassValid,
  reviewerCoverageValid,
  reviewerContentBindingValid,
} from "./final-delivery-review.ts";
import type { FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { runWorkflowLocalCliResult } from "./foundry-workflow-io.ts";

type Json = Record<string, unknown>;
const MAX_BYTES = 64 * 1024 * 1024;
const shaPattern = /^[0-9a-f]{64}$/u;

function fail(message: string): never {
  throw new FoundryContextError("repair_scientific_evidence_invalid", message);
}

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object.`);
  return value as Json;
}

function exact(value: Json, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail(`${label} has missing or unsupported fields.`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 16_384)
    fail(`${label} must be bounded non-empty text.`);
  return value;
}

function jsonFile(file: string, read: (file: string) => Buffer): Json {
  try {
    return object(JSON.parse(read(file).toString("utf8")), "Scientific evidence");
  } catch (error) {
    if (error instanceof FoundryContextError) throw error;
    return fail("Scientific evidence must be readable bounded JSON.");
  }
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

export interface ScientificRepairRuntime {
  readonly configuration: FoundryInputFact;
  readonly executable: FoundryInputFact;
}

/** Deployment configuration is outside every task selection and survives the managed CLI host. */
export function readScientificRepairRuntime(
  excludedRoots: readonly string[],
): ScientificRepairRuntime {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  if (!path.isAbsolute(configRoot))
    fail("Provider-impact deployment configuration requires an absolute configuration root.");
  const file = path.join(configRoot, "tiangong-foundry", "provider-impact-runtime.json");
  if (excludedRoots.some((root) => inside(root, file)))
    fail(
      "Provider-impact deployment configuration must be outside task, workspace and cache inputs.",
    );
  let value: Json;
  try {
    const fact = captureFoundryInput(file);
    if (excludedRoots.some((root) => inside(root, fact.path)))
      fail(
        "Provider-impact deployment configuration must be outside task, workspace and cache inputs.",
      );
    if (fact.bytes > 16_384) fail("Provider-impact deployment configuration exceeds its bound.");
    const configurationBytes = fs.readFileSync(file);
    if (
      createHash("sha256").update(configurationBytes).digest("hex") !== fact.sha256 ||
      captureFoundryInput(file).sha256 !== fact.sha256
    )
      fail("Provider-impact deployment configuration changed while it was read.");
    value = object(
      JSON.parse(configurationBytes.toString("utf8")),
      "Provider-impact deployment configuration",
    );
    exact(value, ["schema", "executable", "sha256"], "Provider-impact deployment configuration");
    if (
      value.schema !== "tiangong-foundry.provider-impact-runtime.v1" ||
      typeof value.executable !== "string" ||
      !path.isAbsolute(value.executable) ||
      typeof value.sha256 !== "string" ||
      !shaPattern.test(value.sha256)
    )
      fail(
        "Provider-impact deployment configuration must bind an absolute executable and independently trusted SHA-256.",
      );
    const executable = captureFoundryInput(value.executable);
    if (
      excludedRoots.some((root) => inside(root, executable.path)) ||
      executable.sha256 !== value.sha256
    )
      fail(
        "The provider-impact executable differs from its trusted deployment binding or resides in task inputs.",
      );
    return Object.freeze({ configuration: fact, executable });
  } catch (error) {
    if (error instanceof FoundryContextError && error.code === "repair_scientific_evidence_invalid")
      throw error;
    return fail(
      "Install the trusted provider-impact runtime configuration under the host tiangong-foundry configuration directory.",
    );
  }
}

export interface ScientificRepairEvidence {
  readonly schema: "tiangong-foundry.scientific-repair-evidence.v1";
  readonly descriptor: FoundryInputFact;
  readonly worker_input: FoundryInputFact;
  readonly worker_report: FoundryInputFact;
  readonly changes: FoundryInputFact;
  readonly review: FoundryInputFact;
  readonly sources: readonly FoundryInputFact[];
  readonly runtime: ScientificRepairRuntime;
}

/** Exact JSON Pointer differences, with arrays of changed length covered as one complete value. */
export function scientificRepairChanges(
  before: unknown,
  candidate: unknown,
  pointer = "",
): string[] {
  if (sha256Json(before ?? null) === sha256Json(candidate ?? null)) return [];
  if (Array.isArray(before) && Array.isArray(candidate))
    return Array.from({ length: Math.max(before.length, candidate.length) }, (_, index) =>
      index < before.length && index < candidate.length
        ? scientificRepairChanges(before[index], candidate[index], `${pointer}/${index}`)
        : [`${pointer}/${index}`],
    ).flat();
  if (
    before &&
    candidate &&
    typeof before === "object" &&
    typeof candidate === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(candidate)
  ) {
    const left = before as Json,
      right = candidate as Json;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => {
      const child = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      return Object.hasOwn(left, key) && Object.hasOwn(right, key)
        ? scientificRepairChanges(left[key], right[key], child)
        : [child];
    });
  }
  return [pointer];
}

function pointerValue(value: unknown, pointer: string): unknown {
  let current = value;
  for (const segment of pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment))
      return { present: false };
    current = (current as Json)[segment];
  }
  return { present: true, value: current };
}

export function readScientificRepairEvidence(input: {
  descriptorFile: string;
  beforeFile: string;
  candidateFile: string;
  actorId: string;
  userId: string;
  selectedFiles: readonly string[];
  excludedRuntimeRoots: readonly string[];
  read: (file: string) => Buffer;
}): ScientificRepairEvidence {
  const read = (file: string) => {
    if (!input.selectedFiles.includes(file))
      fail("Every scientific evidence file must be an independently selected task source.");
    const bytes = input.read(file);
    if (bytes.length > MAX_BYTES) fail("Scientific evidence exceeds its file bound.");
    return bytes;
  };
  const descriptor = jsonFile(input.descriptorFile, read);
  exact(
    descriptor,
    ["schema", "author_id", "worker_input", "worker_report", "changes", "sources", "review"],
    "Scientific repair descriptor",
  );
  if (
    descriptor.schema !== "tiangong-foundry.scientific-repair.v1" ||
    descriptor.author_id !== input.actorId
  )
    fail("Scientific repair descriptor must bind the registered task author.");
  const fact = (value: unknown, label: string): FoundryInputFact => {
    const reference = object(value, label);
    exact(reference, ["file", "sha256"], label);
    const file = text(reference.file, `${label} file`);
    const observed = captureFoundryInput(file);
    const bytes = read(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const captured = captureFoundryInput(file);
    if (
      reference.sha256 !== hash ||
      observed.sha256 !== hash ||
      captured.sha256 !== hash ||
      observed.bytes !== bytes.length ||
      captured.bytes !== bytes.length
    )
      fail(`${label} selected bytes changed.`);
    return captured;
  };
  const workerInput = fact(descriptor.worker_input, "Worker input");
  const workerReport = fact(descriptor.worker_report, "Reviewed Worker report");
  const changes = fact(descriptor.changes, "Scientific changes");
  const review = fact(descriptor.review, "Independent scientific review");
  if (
    !Array.isArray(descriptor.sources) ||
    descriptor.sources.length < 1 ||
    descriptor.sources.length > 128
  )
    fail("Scientific repair requires bounded selected source evidence.");
  const sources = descriptor.sources.map((source) => fact(source, "Scientific source"));
  const all = [workerInput, workerReport, changes, review, ...sources];
  if (new Set(all.map((item) => item.path)).size !== all.length)
    fail("Scientific evidence selections must be distinct.");
  const before = readRows(input.beforeFile, (file) => read(file).toString("utf8")).map(
    (row, index) => datasetIdentity(row, index, "process"),
  );
  const candidate = readRows(input.candidateFile, (file) => read(file).toString("utf8")).map(
    (row, index) => datasetIdentity(row, index, "process"),
  );
  const worker = jsonFile(workerInput.path, read);
  const baseline = object(worker.baseline, "Worker baseline");
  if (
    worker.schema_version !== "worker.provider-impact.input.v1" ||
    worker.mode !== "matrix_only" ||
    baseline.actor_user_id !== input.userId ||
    !Array.isArray(worker.overlays)
  )
    fail("Worker input must bind the same actor and matrix-only provider-impact contract.");
  const overlays = worker.overlays.map((value) => object(value, "Worker overlay"));
  const changedRows = candidate.filter((row) => {
    const old = before.find((value) => value.id === row.id && value.version === row.version);
    return old && sha256Json(old.payload) !== sha256Json(row.payload);
  });
  if (overlays.length !== changedRows.length)
    fail("Worker overlays must cover exactly the changed Process candidates.");
  for (const row of changedRows) {
    const matches = overlays.filter((overlay) => {
      const identity = object(overlay.identity, "Worker overlay identity");
      return (
        identity.dataset_type === "process" &&
        identity.id === row.id &&
        identity.version === row.version
      );
    });
    const old = before.find((value) => value.id === row.id && value.version === row.version)!;
    const documents = Array.isArray(baseline.documents) ? baseline.documents : [];
    const frozen = documents
      .filter((value) => {
        const record = object(value, "Worker baseline document");
        const identity = object(record.identity, "Worker baseline identity");
        return (
          identity.dataset_type === "process" &&
          identity.id === row.id &&
          identity.version === row.version
        );
      })
      .map((value) => object(value, "Worker baseline document"));
    if (
      matches.length !== 1 ||
      frozen.length !== 1 ||
      frozen[0].state_code !== 0 ||
      frozen[0].user_id !== input.userId ||
      sha256Json(matches[0].document) !== sha256Json(row.payload) ||
      sha256Json(frozen[0].document) !== sha256Json(old.payload)
    )
      fail(
        "Worker baseline and overlays must contain the complete exact selected owner draft bodies.",
      );
  }
  const changeReport = jsonFile(changes.path, read);
  exact(changeReport, ["schema", "changes"], "Scientific changes");
  if (
    changeReport.schema !== "tiangong-foundry.scientific-repair-changes.v1" ||
    !Array.isArray(changeReport.changes) ||
    changeReport.changes.length > 2_000
  )
    fail("Scientific changes require a bounded field evidence ledger.");
  const expectedChanges = new Set<string>();
  for (const row of changedRows) {
    const old = before.find((value) => value.id === row.id && value.version === row.version)!;
    for (const pointer of scientificRepairChanges(old.payload, row.payload))
      expectedChanges.add(JSON.stringify([row.id, row.version, pointer]));
  }
  for (const value of changeReport.changes) {
    const change = object(value, "Scientific field change");
    exact(
      change,
      ["id", "version", "path", "before_sha256", "after_sha256", "basis", "evidence"],
      "Scientific field change",
    );
    const pointer = text(change.path, "Scientific field pointer");
    const row = candidate.find((item) => item.id === change.id && item.version === change.version);
    const old = before.find((item) => item.id === change.id && item.version === change.version);
    if (
      !pointer.startsWith("/") ||
      !row ||
      !old ||
      !expectedChanges.delete(JSON.stringify([change.id, change.version, pointer])) ||
      change.before_sha256 !== sha256Json(pointerValue(old.payload, pointer)) ||
      change.after_sha256 !== sha256Json(pointerValue(row.payload, pointer))
    )
      fail(
        "Scientific field evidence must cover every changed value exactly once with its before and candidate hashes.",
      );
    text(change.basis, "Scientific field basis");
    if (!Array.isArray(change.evidence) || !change.evidence.length || change.evidence.length > 128)
      fail("Every scientific field change requires structured source evidence.");
    for (const item of change.evidence) {
      const evidence = object(item, "Scientific field source evidence");
      const source = sources.find(
        (source) => evidence.source === source.path && evidence.source_sha256 === source.sha256,
      );
      if (!hasStructuredTraceEvidence(evidence) || !source)
        fail(
          "Scientific field evidence must bind a selected source and its exact bytes with a quote, trace, path or citation.",
        );
      const sourceText = read(source.path).toString("utf8");
      const quoted =
        typeof evidence.quote === "string" &&
        evidence.quote.trim().length > 0 &&
        sourceText.includes(evidence.quote);
      let located = false;
      if (
        typeof evidence.path === "string" &&
        evidence.path.startsWith("/") &&
        !/~(?![01])/u.test(evidence.path)
      ) {
        try {
          const value = object(
            pointerValue(JSON.parse(sourceText), evidence.path),
            "Scientific source locator",
          );
          located = value.present === true && evidence.value_sha256 === sha256Json(value);
        } catch {
          located = false;
        }
      }
      if (!quoted && !located)
        fail(
          "Scientific field evidence requires a quote present in the selected source bytes or an exact JSON Pointer with its located-value hash.",
        );
    }
  }
  if (expectedChanges.size) fail("Scientific field evidence omits changed values.");
  const reviewer = jsonFile(review.path, read);
  const reviewerId = text(reviewer.reviewer_id, "Scientific reviewer identity");
  const bindings = new Map<string, { sha256: string; bytes: number }>([
    ["before", captureFoundryInput(input.beforeFile)],
    ["candidate", captureFoundryInput(input.candidateFile)],
    ["worker_input", workerInput],
    ["worker_report", workerReport],
    ["changes", changes],
    ...sources.map((source, index) => [`source_${index}`, source] as const),
  ]);
  const required = [...bindings.keys()];
  if (
    reviewerId === input.actorId ||
    reviewer.scope !== "scientific-content-and-provider-impact" ||
    !reviewerPassValid(reviewer, reviewerId) ||
    !reviewerCoverageValid(reviewer, required, bindings, "review") ||
    !reviewerContentBindingValid(reviewer, required, bindings)
  )
    fail(
      "Independent scientific review must pass with exact coverage of the before/candidate, source, field ledger and complete Worker input/report.",
    );
  const runtime = readScientificRepairRuntime(input.excludedRuntimeRoots);
  if (worker.expected_worker_sha256 !== runtime.executable.sha256)
    fail("Worker input must select the independently trusted deployed executable digest.");
  return Object.freeze({
    schema: "tiangong-foundry.scientific-repair-evidence.v1",
    descriptor: captureFoundryInput(input.descriptorFile),
    worker_input: workerInput,
    worker_report: workerReport,
    changes,
    review,
    sources: Object.freeze(sources),
    runtime,
  });
}

/** Recompute the independently reviewed report with the exact trusted native bytes. */
export function runScientificRepairDiagnostic(
  evidence: ScientificRepairEvidence,
  directory: string,
): Json {
  const bound = evidence.runtime.executable;
  const bytes = fs.readFileSync(bound.path);
  if (createHash("sha256").update(bytes).digest("hex") !== bound.sha256)
    fail("The deployed provider-impact executable changed before dispatch.");
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-provider-impact-"));
  try {
    const output = path.join(directory, "provider-impact-report.json");
    const environment = createFoundryIsolatedChildEnvironment({ tempRoot: runtimeDirectory });
    const result = childProcess.spawnSync(
      bound.path,
      [
        "--provider-impact-input",
        evidence.worker_input.path,
        "--provider-impact-input-sha256",
        evidence.worker_input.sha256,
        "--provider-impact-out",
        output,
      ],
      {
        cwd: directory,
        env: environment,
        shell: false,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: MAX_BYTES,
      },
    );
    for (const [name, value] of [
      ["stdout", result.stdout],
      ["stderr", result.stderr],
    ] as const)
      fs.writeFileSync(path.join(directory, `provider-impact.${name}.log`), value ?? "", {
        flag: "wx",
        mode: 0o600,
      });
    if (
      captureFoundryInput(bound.path).sha256 !== bound.sha256 ||
      captureFoundryInput(evidence.runtime.configuration.path).sha256 !==
        evidence.runtime.configuration.sha256
    )
      fail("The trusted provider-impact deployment changed during native diagnosis.");
    if (result.error || result.signal || result.status !== 0)
      fail(
        "The trusted Worker provider-impact diagnostic did not complete successfully. Inspect its indexed provider-impact stderr evidence and retain the original frozen inputs.",
      );
    const reportFact = captureFoundryInput(output);
    if (reportFact.bytes > 128 * 1024 * 1024 || reportFact.sha256 !== evidence.worker_report.sha256)
      fail(
        "The complete native provider-impact output differs from the independently reviewed report.",
      );
    const report = object(
      JSON.parse(fs.readFileSync(output, "utf8")),
      "Native provider-impact report",
    );
    assertScientificRepairDiagnosticReport(report, evidence);
    return report;
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

export function assertScientificRepairDiagnosticReport(
  report: Json,
  evidence: ScientificRepairEvidence,
): void {
  const runtime = object(report.runtime, "Native provider-impact runtime");
  const counts = object(report.operation_counts, "Native provider-impact operation counts");
  const scope = object(report.scope, "Native provider-impact scope");
  const after = object(report.after, "Native provider-impact candidate phase");
  const readiness = object(after.readiness, "Native provider-impact readiness");
  if (
    report.schema_version !== "worker.provider-impact.report.v1" ||
    report.mode !== "matrix_only" ||
    report.status !== "diagnostic_complete" ||
    report.input_sha256 !== evidence.worker_input.sha256 ||
    runtime.worker_binary_sha256 !== evidence.runtime.executable.sha256 ||
    counts.matrix_assemblies !== 2 ||
    [
      "factorizations",
      "unit_solves",
      "database_queries",
      "queue_writes",
      "object_store_operations",
    ].some((key) => counts[key] !== 0) ||
    scope.kind !== "supplied_finite_universe" ||
    scope.frozen_selection_contract !== "worker.provider-impact.frozen-census.v1" ||
    scope.online_census_verified !== false ||
    scope.online_effective_selection_verified !== false ||
    scope.scientific_qualified !== false ||
    scope.save_admitted !== false ||
    scope.publication_qualified !== false ||
    !Array.isArray(readiness.blockers) ||
    readiness.blockers.length ||
    !Array.isArray(after.unresolved_balances) ||
    after.unresolved_balances.length
  )
    fail(
      "Native provider-impact evidence must be exact matrix-only output with a complete candidate provider closure and explicit finite-universe limits.",
    );
}

/** The published CLI applies the evidence-bound edit proposal to the complete before document. */
export function applyScientificRepairProposals(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  temporary: string,
  evidence: ScientificRepairEvidence,
  beforeFile: string,
  candidateFile: string,
  directory: string,
): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const changes = object(
    JSON.parse(fs.readFileSync(evidence.changes.path, "utf8")),
    "Scientific changes",
  ).changes as Json[];
  const before = readRows(beforeFile).map((row, index) => datasetIdentity(row, index, "process"));
  const candidates = readRows(candidateFile).map((row, index) =>
    datasetIdentity(row, index, "process"),
  );
  for (const [index, candidate] of candidates.entries()) {
    const old = before.find((row) => row.id === candidate.id && row.version === candidate.version)!;
    if (sha256Json(old.payload) === sha256Json(candidate.payload)) continue;
    const selected = changes
      .filter((change) => change.id === candidate.id && change.version === candidate.version)
      .sort((left, right) => {
        const rank = (value: Json) => {
          const previous = object(pointerValue(old.payload, String(value.path)), "Previous field");
          const desired = object(
            pointerValue(candidate.payload, String(value.path)),
            "Candidate field",
          );
          return desired.present ? (previous.present ? 0 : 2) : 1;
        };
        const leftRank = rank(left),
          rightRank = rank(right);
        return (
          leftRank - rightRank ||
          (leftRank === 1
            ? String(right.path).localeCompare(String(left.path), "en", { numeric: true })
            : String(left.path).localeCompare(String(right.path), "en", { numeric: true }))
        );
      });
    const operations = selected.flatMap((change) => {
      const pointer = String(change.path);
      const previous = object(pointerValue(old.payload, pointer), "Previous field");
      const desired = object(pointerValue(candidate.payload, pointer), "Candidate field");
      return [
        ...(previous.present ? [{ op: "test", path: pointer, value: previous.value }] : []),
        {
          op: desired.present ? (previous.present ? "replace" : "add") : "remove",
          path: pointer,
          ...(desired.present ? { value: desired.value } : {}),
          basis: change.basis,
          evidence: change.evidence,
        },
      ];
    });
    const input = path.join(directory, `patch-input-${index}.json`);
    const output = path.join(directory, `patch-output-${index}.json`);
    fs.writeFileSync(
      input,
      JSON.stringify({
        content: old.payload,
        expectedDigest: createHash("sha256").update(JSON.stringify(old.payload)).digest("hex"),
        operations,
      }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    const run = runWorkflowLocalCliResult(context, qualified, temporary, [
      "dataset",
      "process",
      "patch",
      "--input",
      input,
      "--output",
      output,
      "--json",
    ]);
    run.validate(() => {
      if (
        run.exit !== 0 ||
        run.report.status !== "completed" ||
        sha256Json(JSON.parse(fs.readFileSync(output, "utf8"))) !== sha256Json(candidate.payload)
      )
        fail(
          "The published CLI patch owner did not produce the complete exact reviewed scientific candidate.",
        );
    });
  }
}
