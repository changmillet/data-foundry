import fs from "node:fs";
import path from "node:path";
import {
  FoundryContextError,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import type { FoundryAuthentication } from "./foundry-runtime-identity.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import {
  createIdentityPreflightBinding,
  createIdentityPreflightExecutionManifest,
  sha256Json,
  sha256Text,
  parseFreshIntentBoundAuthReceipt,
  validateBoundExecutionManifest,
  type IdentityPreflightBindingInput,
} from "./identity-preflight-proof.ts";
import {
  datasetIdentity,
  datasetRoot,
  dataSetInformation,
} from "./import-curation/internal/dataset-payload.ts";
import { queryFoundryEdgeIdentity } from "./foundry-edge-session.ts";

function invalid(): never {
  throw new FoundryContextError(
    "edge_identity_evidence_invalid",
    "The Edge identity evidence does not match the current audited request.",
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

export function validateEdgeIdentityQuery(
  type: "flow" | "process",
  rowValue: unknown,
  requestText: string,
) {
  const row = object(rowValue);
  const request = object(JSON.parse(requestText));
  const search = object(request.remote_candidate_search);
  const edge = object(object(row.remote_search).edge_request);
  const endpoint = type === "flow" ? "flow_hybrid_search" : "process_hybrid_search";
  const body = {
    query: search.query,
    ...(search.filter ? { filter: search.filter } : {}),
    match_count: search.limit,
    page_size: search.limit,
    data_source: search.data_source,
    match_threshold: search.match_threshold,
    lexical_weight: search.lexical_weight,
    semantic_weight: search.semantic_weight,
    rrf_k: search.rrf_k,
  };
  if (
    edge.endpoint !== endpoint ||
    sha256Json(edge.body) !== sha256Json(body) ||
    row.dataset_type !== type ||
    row.request_bytes_sha256 !== sha256Text(requestText) ||
    row.target_sha256 !== sha256Text(JSON.stringify(request.target)) ||
    search.enabled !== true ||
    typeof body.query !== "string" ||
    !body.query.trim() ||
    !Number.isSafeInteger(body.match_count) ||
    Number(body.match_count) < 1 ||
    Number(body.match_count) > 80 ||
    body.data_source !== "tg"
  )
    return invalid();
  const target = datasetIdentity(request.target, 0, type);
  if (target.id !== row.dataset_id || target.version !== row.dataset_version) return invalid();
  return { endpoint, body, target } as const;
}

export function edgeIdentityCandidates(type: "flow" | "process", result: unknown, limit: number) {
  const rows = Array.isArray(result) ? result : object(result).data;
  if (!Array.isArray(rows) || rows.length > limit) return invalid();
  const keys = new Set<string>();
  return rows.map((value: unknown) => {
    const row = object(value);
    const id = row.id;
    const version = row.version;
    const json = row.json_ordered ?? row.json;
    if (
      typeof id !== "string" ||
      typeof version !== "string" ||
      !/^\d{2}\.\d{2}\.\d{3}$/u.test(version)
    )
      return invalid();
    const key = `${id}@${version}`;
    if (keys.has(key)) return invalid();
    keys.add(key);
    const content = object(json);
    const root = datasetRoot(content, type);
    const ownership = object(object(root.administrativeInformation).publicationAndOwnership);
    if (
      dataSetInformation(root, type)["common:UUID"] !== id ||
      ownership["common:dataSetVersion"] !== version
    )
      return invalid();
    return { id, version, content, score: row.combined_score ?? row.score ?? null };
  });
}

type Claim = {
  dispatchSha256: string;
  sourceSha256: string;
  claimedAt: string;
  receipt: NonNullable<IdentityPreflightBindingInput["authReceipt"]>;
};

function bindingForEdgeObservation(
  type: "flow" | "process",
  row: Record<string, unknown>,
  requestText: string,
  receipt: Claim["receipt"],
  observation: unknown,
  claim?: Claim,
) {
  const { endpoint, target } = validateEdgeIdentityQuery(type, row, requestText);
  const cli = resolveInstalledTiangongLcaCliPackage();
  return createIdentityPreflightBinding({
    datasetType: type,
    datasetId: target.id,
    datasetVersion: target.version,
    targetSha256: String(row.target_sha256),
    requestText,
    semanticArgv: ["edge", "POST", endpoint],
    cli: {
      packageName: cli.packageName,
      packageVersion: cli.packageVersion,
      packageIntegrity: null,
    },
    authReceipt: receipt,
    relevantInputHashes: {
      edge_observation: sha256Json(observation),
      ...(claim
        ? { explicit_dispatch: claim.dispatchSha256, source_file: claim.sourceSha256 }
        : {}),
    },
  });
}

/** Run the already-audited bounded query and hand the decision to Foundry's existing review lane. */
export async function runFoundryEdgeIdentityPreflight(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  type: "flow" | "process",
  indexFile: string,
  outDir: string,
  claim?: Claim,
) {
  const index = fs.readFileSync(resolveFoundryOutput(context, indexFile), "utf8");
  const rows = index
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => object(JSON.parse(line)));
  if (!rows.length || (claim && rows.length !== 1)) return invalid();
  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const file = (value: unknown) => {
      if (typeof value !== "string") return invalid();
      return resolveFoundryOutput(context, path.resolve(context.assetRoot, value));
    };
    const requestFile = file(row.request_file);
    const reportFile = file(row.expected_report_file);
    const requestText = fs.readFileSync(requestFile, "utf8");
    const { endpoint, body, target } = validateEdgeIdentityQuery(type, row, requestText);
    const { receipt, result } = await queryFoundryEdgeIdentity(
      context,
      qualified,
      authentication,
      endpoint,
      body,
    );
    if (fs.readFileSync(requestFile, "utf8") !== requestText) return invalid();
    const candidates = edgeIdentityCandidates(type, result, Number(body.match_count));
    const candidateFile = path.join(path.dirname(reportFile), "edge-search-observation.json");
    const observation = {
      schema: "tiangong-foundry.edge-identity-observation.v1",
      endpoint,
      project_ref: receipt.project.project_ref,
      user_id: receipt.identity.user_id,
      query: body,
      ...(claim ? { verified_actor_receipt: receipt } : {}),
      result,
    };
    writeFoundryArtifact(context, candidateFile, JSON.stringify(observation, null, 2) + "\n");
    const binding = bindingForEdgeObservation(
      type,
      row,
      requestText,
      claim?.receipt ?? receipt,
      observation,
      claim,
    );
    const report = {
      schema: "tiangong-foundry.edge-identity-decision.v1",
      producer: "foundry",
      status: "needs_review",
      decision: "manual_review",
      next_action: "queue_manual_review",
      target: { id: target.id, version: target.version },
      candidates,
      candidate_sources: [
        {
          kind: "remote_search",
          endpoint,
          path: candidateFile,
          query: body.query,
          row_count: candidates.length,
          bounded: true,
        },
      ],
      findings: [],
      blockers: [],
    };
    const reportText = JSON.stringify(report, null, 2) + "\n";
    writeFoundryArtifact(context, reportFile, reportText);
    const manifest = createIdentityPreflightExecutionManifest(
      binding,
      reportText,
      new Date().toISOString(),
    );
    const manifestFile = path.join(
      path.dirname(reportFile),
      "foundry-identity-preflight-execution.json",
    );
    writeFoundryArtifact(context, manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    const { command_spec: _legacyCommand, ...rest } = row;
    results.push({
      ...rest,
      command: `POST ${endpoint}`,
      execution_manifest_file: manifestFile,
      expected_project_ref: receipt.project.project_ref,
      expected_user_id: receipt.identity.user_id,
    });
  }
  const completedIndex = path.join(outDir, "identity-preflight-requests.jsonl");
  writeFoundryArtifact(
    context,
    completedIndex,
    results.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  const reportFile = path.join(outDir, "dataset-identity-preflight-run-report.json");
  const report = {
    schema: "tiangong-foundry.edge-identity-preflight.v1",
    status: "completed_with_identity_findings",
    producer: "foundry",
    index: completedIndex,
    files: { report: reportFile },
  };
  writeFoundryArtifact(context, reportFile, JSON.stringify(report, null, 2) + "\n");
  return report;
}

/** Adopt one original Edge observation only when the persisted dispatch and all response evidence agree. */
export function readRetainedFoundryEdgeIdentity(
  context: FoundryRuntimeContext,
  type: "flow" | "process",
  row: Record<string, unknown>,
  runDir: string,
  mode: FoundryAuthentication["mode"],
  claim: Claim,
) {
  const file = (value: unknown) => {
    if (typeof value !== "string") return invalid();
    return resolveFoundryOutput(context, path.resolve(context.assetRoot, value));
  };
  const read = (name: string) => {
    const stat = fs.lstatSync(name);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return invalid();
    return fs.readFileSync(name, "utf8");
  };
  const runFile = file(path.join(runDir, "dataset-identity-preflight-run-report.json"));
  const index = file(path.join(runDir, "identity-preflight-requests.jsonl"));
  const run = object(JSON.parse(read(runFile)));
  const completedRows = read(index).trimEnd().split("\n");
  if (
    run.schema !== "tiangong-foundry.edge-identity-preflight.v1" ||
    run.producer !== "foundry" ||
    run.status !== "completed_with_identity_findings" ||
    run.index !== index ||
    object(run.files).report !== runFile ||
    completedRows.length !== 1
  )
    return invalid();

  const requestText = read(file(row.request_file));
  const { endpoint, body, target } = validateEdgeIdentityQuery(type, row, requestText);
  const reportFile = file(row.expected_report_file);
  const directory = path.dirname(reportFile);
  const candidateFile = file(path.join(directory, "edge-search-observation.json"));
  const manifestFile = file(path.join(directory, "foundry-identity-preflight-execution.json"));
  const observation = object(JSON.parse(read(candidateFile)));
  const reportText = read(reportFile);
  const report = object(JSON.parse(reportText));
  const manifest = object(JSON.parse(read(manifestFile)));
  const checkedAt = Date.parse(String(manifest.completed_at_utc));
  const claimedAt = Date.parse(claim.claimedAt);
  const actor = parseFreshIntentBoundAuthReceipt(observation.verified_actor_receipt, {
    nowMs: checkedAt,
    maxAgeMs: 60_000,
    expectedProjectRef: claim.receipt.project.project_ref,
    expectedUserId: claim.receipt.identity.user_id,
    sessionMode: mode,
  });
  const { command_spec: _legacyCommand, ...rest } = row;
  const completed = object(JSON.parse(completedRows[0]));
  const expected = {
    ...rest,
    command: `POST ${endpoint}`,
    execution_manifest_file: manifestFile,
    expected_project_ref: actor.project.project_ref,
    expected_user_id: actor.identity.user_id,
  };
  const candidates = edgeIdentityCandidates(type, observation.result, Number(body.match_count));
  const source =
    Array.isArray(report.candidate_sources) && report.candidate_sources.length === 1
      ? object(report.candidate_sources[0])
      : invalid();
  const binding = bindingForEdgeObservation(
    type,
    row,
    requestText,
    claim.receipt,
    observation,
    claim,
  );
  if (
    observation.schema !== "tiangong-foundry.edge-identity-observation.v1" ||
    observation.endpoint !== endpoint ||
    observation.project_ref !== actor.project.project_ref ||
    observation.user_id !== actor.identity.user_id ||
    sha256Json(actor.cli) !== sha256Json(claim.receipt.cli) ||
    actor.project.project_base_url !== claim.receipt.project.project_base_url ||
    sha256Json(observation.query) !== sha256Json(body) ||
    !Number.isFinite(claimedAt) ||
    checkedAt < claimedAt ||
    Date.parse(actor.captured_at_utc) < claimedAt - 5_000 ||
    sha256Json(completed) !== sha256Json(expected) ||
    report.schema !== "tiangong-foundry.edge-identity-decision.v1" ||
    report.producer !== "foundry" ||
    report.decision !== "manual_review" ||
    report.status !== "needs_review" ||
    object(report.target).id !== target.id ||
    object(report.target).version !== target.version ||
    sha256Json(report.candidates) !== sha256Json(candidates) ||
    source.endpoint !== endpoint ||
    source.path !== candidateFile ||
    source.row_count !== candidates.length ||
    source.bounded !== true ||
    !validateBoundExecutionManifest(manifest, binding, reportText).ok
  )
    return invalid();
  return { run, row: completed };
}
