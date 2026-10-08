import path from "node:path";
import fs from "node:fs";
import { sha256Text } from "./identity-preflight-proof.ts";
import { FoundryContextError } from "./foundry-runtime-context.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function token(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

type Json = Record<string, unknown>;
const layerNames = ["schema", "authoring_evidence", "content", "multilingual"] as const;
const profile = "tidas.process-allocation-reference.v1";
const tolerance = 0.0010000001;
function fail(): never {
  throw new FoundryContextError(
    "workflow_validation_invalid",
    "Owner CLI validation must bind the exact current Process rows, layers and Flow evidence.",
  );
}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Json;
}
function findings(value: Json, statuses: readonly string[]): Json[] {
  if (!statuses.includes(String(value.status)) || !Array.isArray(value.issues)) fail();
  if (value.issue_count !== value.issues.length) fail();
  if ((value.status === "passed") !== (value.issues.length === 0)) fail();
  return value.issues.map((issue) => {
    const item = object(issue);
    if (
      typeof item.code !== "string" ||
      !item.code ||
      typeof item.path !== "string" ||
      typeof item.message !== "string"
    )
      fail();
    return item;
  });
}

/** Verify transport and content bindings; the CLI retains every scientific validation decision. */
export function parseFoundryPreparationCliReport(options: {
  report: unknown;
  rows: readonly unknown[];
  input: string;
  outDir: string;
  exit: number;
}): Json[] {
  const report = object(options.report);
  if (
    report.input_path !== options.input ||
    report.requested_type !== "process" ||
    object(report.files).report !==
      path.join(options.outDir, "outputs", "validation-report.json") ||
    !Array.isArray(report.rows) ||
    report.rows.length !== options.rows.length
  )
    fail();
  const rows = report.rows.map((raw, index) => {
    const row = object(raw);
    const identity = datasetIdentity(options.rows[index], index, "process");
    const candidateHash = sha256Json(identity.payload);
    const wrapper = record(options.rows[index]);
    const process = record(record(identity.payload).processDataSet);
    const id = token(
      wrapper.id,
      record(record(process.processInformation).dataSetInformation)["common:UUID"],
    );
    const version = token(
      wrapper.version,
      record(record(process.administrativeInformation).publicationAndOwnership)[
        "common:dataSetVersion"
      ],
    );
    if (
      row.index !== index ||
      row.id !== id ||
      row.version !== version ||
      row.type !== "process" ||
      row.payload_sha256 !== candidateHash ||
      !["valid", "invalid"].includes(String(row.status))
    )
      fail();
    const layers = object(row.validation_layers);
    const layerIssues = layerNames.flatMap((name) =>
      findings(object(layers[name]), ["passed", "failed"]),
    );
    const semantics = object(row.allocation_semantics);
    if (
      semantics.profile !== profile ||
      semantics.tolerance !== tolerance ||
      semantics.candidate_sha256 !== candidateHash ||
      semantics.options_sha256 !== sha256Json({ profile, tolerance }) ||
      !Array.isArray(semantics.dependencies) ||
      !Array.isArray(semantics.coverage)
    )
      fail();
    const semanticIssues = findings(semantics, ["passed", "failed", "unresolved"]);
    if (semantics.status === "passed") {
      const coverage = semantics.coverage as Json[];
      // SDK 0.5.1 emits applicable checks; undeclared/legacy modes omit target/fraction checks.
      const required = ["allocation-target-type", "quantitative-reference"];
      if (
        coverage.some((entry) => ["invalid", "unresolved"].includes(String(entry.status))) ||
        required.some((check) => !coverage.some((entry) => entry.check === check))
      )
        fail();
    }

    const supplied = object(options.rows[index]);
    // Published dataset validate reads semantic_context from the original row only.
    const suppliedContexts = [supplied];
    const flowHashes = new Set<string>();
    for (const holder of suppliedContexts) {
      const context = holder.semantic_context;
      if (!context || typeof context !== "object" || Array.isArray(context)) continue;
      const documents = (context as Json).flow_documents;
      if (!Array.isArray(documents)) continue;
      for (const document of documents) {
        if (!document || typeof document !== "object" || Array.isArray(document)) continue;
        const flow = (document as Json).flowDataSet as Json | undefined;
        if (!flow) continue;
        const information = flow.flowInformation as Json | undefined;
        const administration = flow.administrativeInformation as Json | undefined;
        const id = (information?.dataSetInformation as Json | undefined)?.["common:UUID"];
        const version = (administration?.publicationAndOwnership as Json | undefined)?.[
          "common:dataSetVersion"
        ];
        flowHashes.add(JSON.stringify([id, version, sha256Json(document)]));
      }
    }
    for (const rawDependency of semantics.dependencies) {
      const dependency = object(rawDependency);
      if (
        !flowHashes.has(
          JSON.stringify([dependency.uuid, dependency.version, dependency.content_sha256]),
        )
      )
        fail();
    }
    for (const rawCoverage of semantics.coverage) {
      const coverage = object(rawCoverage);
      if (
        typeof coverage.check !== "string" ||
        !Array.isArray(coverage.path) ||
        !["passed", "invalid", "unresolved", "not-applicable"].includes(String(coverage.status))
      )
        fail();
    }
    const knownIssues = new Set([...layerIssues, ...semanticIssues].map(sha256Json));
    if (
      !Array.isArray(row.issues) ||
      row.issue_count !== row.issues.length ||
      row.issues.some((issue) => !knownIssues.has(sha256Json(issue))) ||
      (row.status === "valid") !== (row.issues.length === 0) ||
      (row.status === "valid") !== (layerIssues.length + semanticIssues.length === 0)
    )
      fail();
    return row;
  });
  const invalid = rows.filter((row) => row.status === "invalid").length;
  const counts = object(report.counts);
  if (
    counts.total !== rows.length ||
    counts.invalid !== invalid ||
    counts.valid !== rows.length - invalid ||
    object(counts.by_type).process !== rows.length ||
    options.exit !== (invalid ? 1 : 0) ||
    report.status !== (invalid ? "completed_with_failures" : "completed")
  )
    fail();
  return rows;
}

/** Project owner findings into the existing evidence-backed field patch workflow, without repairs. */
export function preparationValidationActions(row: Json, receipt?: Json): Json[] {
  const layers = object(row.validation_layers);
  const semantics = object(row.allocation_semantics);
  const groups = [
    ...layerNames.map((name) => ({ name, value: object(layers[name]) })),
    { name: "allocation_semantics", value: semantics },
  ];
  return groups.flatMap(({ name, value }) =>
    (value.issues as Json[]).map((issue) => ({
      source: "cli_validation",
      validation_layer: name,
      code: issue.code,
      path: issue.path,
      message: issue.message,
      action_kind: "ai_authoring",
      required_owner: "foundry_ai_authoring",
      ai_required: true,
      instruction:
        "Review the source evidence and current owner finding in full task context. Use the existing bounded authoring patch workflow only for source-backed corrections, then rerun preparation on the exact changed candidate. Unknown scientific evidence remains blocked; do not invent quantities, annual periods, references or allocation fractions.",
      evidence: {
        ...receipt,
        candidate_sha256: row.payload_sha256,
        validation_layer: name,
        validation_layers: layers,
        allocation_semantics: semantics,
      },
    })),
  );
}

export function preparationValidationEvidence(row: Json, report: string, hash: unknown): Json {
  return {
    report_file: report,
    report_sha256: hash,
    row,
    policy:
      "Owning CLI local save-equivalent evidence; native schema and final remote eligibility remain separate.",
  };
}

export function readPreparationCliEvidence(
  receipt: { report: string; exit: number },
  rows: readonly unknown[],
  input: string,
) {
  const bytes = fs.readFileSync(receipt.report, "utf8");
  return {
    rows: parseFoundryPreparationCliReport({
      report: JSON.parse(bytes),
      rows,
      input,
      outDir: path.dirname(path.dirname(receipt.report)),
      exit: receipt.exit,
    }),
    sha256: sha256Text(bytes),
  };
}
