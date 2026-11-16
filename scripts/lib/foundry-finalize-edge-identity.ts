import path from "node:path";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { readIdentityPreflightIndexRow } from "./import-curation/internal/workflow-identity-preflight.ts";
import type { createFoundryIdentityOwners } from "./foundry-identity-owners.ts";
import { runFoundryEdgeIdentityPreflight } from "./foundry-edge-identity-preflight.ts";
import { assertWorkflowReportArtifact } from "./foundry-workflow-io.ts";
import {
  FoundryContextError,
  readFoundryInput,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { FoundryAuthentication } from "./foundry-runtime-identity.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { workflowObject } from "./foundry-workflow-state.ts";

export async function refreshFoundryFinalizeIdentity(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  owner: ReturnType<typeof createFoundryIdentityOwners>,
  scope: { rowsFile: string; outDir: string; type: "flow" | "process"; index: string },
) {
  const invalid = () =>
    new FoundryContextError(
      "finalize_identity_inputs_invalid",
      "Finalization requires an audited request for each exact cleaned row.",
    );
  const { rowsFile, type } = scope;
  const outDir = resolveFoundryOutput(context, path.join(scope.outDir, "identity-preflight-run"));
  const baseIndex = resolveFoundryOutput(context, scope.index);
  const previous = readRows(baseIndex, (file) =>
    readFoundryInput(context, file).toString("utf8"),
  ).map(workflowObject);
  const prepared = workflowObject(
    owner.invoke(() =>
      owner.preflight.runDatasetIdentityPreflightRequestsBuild({
        type,
        rowsFile,
        sourceIndex: baseIndex,
        outDir: path.join(outDir, "requests"),
      }),
    ),
  );
  const candidate = workflowObject(prepared.files).identity_preflight_requests;
  if (prepared.status !== "ready" || typeof candidate !== "string") throw invalid();
  const preparedIndex = assertWorkflowReportArtifact(
    context,
    path.resolve(context.assetRoot, candidate),
    outDir,
  );
  const current = readRows(preparedIndex).map(workflowObject);
  const key = (row: Record<string, unknown>) =>
    JSON.stringify([row.dataset_type, row.dataset_id, row.dataset_version, row.target_sha256]);
  const original = new Map(previous.map((row) => [key(row), row]));
  const retained = new Map<string, Record<string, unknown>>();
  const pending = current.filter((row) => {
    const old = original.get(key(row));
    if (
      !old ||
      old.dataset_type !== type ||
      old.command !== `POST ${type}_hybrid_search` ||
      old.expected_project_ref !== context.accountIntent?.projectRef ||
      old.expected_user_id !== context.accountIntent?.userId
    )
      return true;
    for (const locator of [
      old.request_file,
      old.expected_report_file,
      old.execution_manifest_file,
    ]) {
      if (typeof locator !== "string") throw invalid();
      readFoundryInput(context, path.resolve(context.assetRoot, locator));
    }
    if (readIdentityPreflightIndexRow(context.assetRoot, baseIndex, old)?.status !== "completed")
      throw invalid();
    retained.set(key(row), old);
    return false;
  });
  if (
    !current.length ||
    current.some((row) => row.dataset_type !== type) ||
    new Set(current.map(key)).size !== current.length
  )
    throw invalid();

  const write = (file: string, rows: readonly Record<string, unknown>[]) =>
    writeFoundryArtifact(context, file, rows.map((row) => JSON.stringify(row) + "\n").join(""));
  let edgeReport: string | null = null;
  if (pending.length) {
    const pendingIndex = path.join(outDir, "pending.jsonl");
    write(pendingIndex, pending);
    const audit = owner.invoke(() =>
      owner.preflight.runDatasetIdentityPreflightQueryAudit({
        index: pendingIndex,
        outDir: path.join(outDir, "query-audit"),
      }),
    );
    if (audit.status !== "passed") throw invalid();
    const edge = await runFoundryEdgeIdentityPreflight(
      context,
      qualified,
      authentication,
      type,
      pendingIndex,
      path.join(outDir, "edge"),
    );
    edgeReport = edge.files.report;
    for (const row of readRows(edge.index).map(workflowObject)) retained.set(key(row), row);
  }
  const finalRows = current.map((row) => {
    const matched = retained.get(key(row));
    if (!matched) throw invalid();
    return matched;
  });
  const indexFile = path.join(outDir, "identity-preflight-requests.jsonl");
  write(indexFile, [...previous.filter((row) => row.dataset_type !== type), ...finalRows]);
  const reportFile = path.join(outDir, "finalize-identity-refresh.json");
  const report = {
    schema: "tiangong-foundry.finalize-edge-identity.v1",
    status: "completed_with_identity_findings",
    counts: {
      selected_rows: current.length,
      completed: current.length,
      skipped_existing_report: current.length - pending.length,
      failed: 0,
    },
    index_file: indexFile,
    base_index_file: baseIndex,
    edge_report: edgeReport,
  };
  writeFoundryArtifact(context, reportFile, JSON.stringify(report, null, 2) + "\n");
  return {
    stage: "identity_preflight_run",
    status: report.status,
    report,
    report_file: reportFile,
    index_file: indexFile,
    base_index_file: baseIndex,
    refresh_required: pending.length > 0,
  };
}
