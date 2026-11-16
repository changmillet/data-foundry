import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { parseAuthIdentityReceipt } from "@tiangong-lca/cli/auth-identity-receipt";
import path from "node:path";
import { bundleRowTypes, type BundleRowType } from "./bundle-row-types.ts";
import { buildEdgeSupportPlan, type EdgeDraftType } from "./foundry-edge-support-plan.ts";
import {
  FoundryContextError,
  captureFoundryInput,
  resolveFoundryOutput,
  writeFoundryArtifact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import {
  bindWorkflowChildExecution,
  workflowChildFailure,
} from "./foundry-workflow-child-failure.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

export function planFoundryEdgeSupportStage(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  environment: NodeJS.ProcessEnv,
  type: EdgeDraftType,
  stage: string,
  source: readonly string[],
  verifyDependencies: boolean,
  receiptFile: string | undefined,
) {
  const input = resolveFoundryOutput(context, source[source.indexOf("--input") + 1]);
  const output = resolveFoundryOutput(context, source[source.indexOf("--out-dir") + 1]);
  const account = context.accountIntent;
  if (!account)
    throw new FoundryContextError(
      "needs_auth",
      "Edge support planning requires task account intent.",
    );
  if (type === "process" && source.includes("--reference-intent-file"))
    throw new FoundryContextError(
      "edge_draft_reference_intent_required",
      "Process creation requires the original exact reference-intent proof.",
    );
  const rows = readRows(input);
  const plan = buildEdgeSupportPlan(
    type,
    captureFoundryInput(input),
    {
      project_ref: account.projectRef,
      user_id: account.userId,
    },
    rows,
  );
  const save = (name: string, value: unknown) => {
    const file = path.join(output, name);
    writeFoundryArtifact(context, file, JSON.stringify(value, null, 2) + "\n");
    return file;
  };

  if (!verifyDependencies) {
    const reportFile = path.join(output, "edge-support-dry-run.json");
    const progress = path.join(output, "edge-support-progress.jsonl");
    const builds = plan.roots.map(({ id, version }) =>
      JSON.stringify({ id, version, status: "prepared", operation: "would_insert" }),
    );
    writeFoundryArtifact(context, progress, builds.join("\n") + "\n");
    const report = {
      schema: "tiangong-foundry.edge-support-dry-run.v1",
      status: "completed_dataset_save_draft",
      mode: "dry_run",
      dry_run: true,
      commit: false,
      input_path: input,
      counts: { selected: plan.roots.length, executed: 0, failed: 0 },
      files: { summary_json: reportFile, progress_jsonl: progress },
    };
    save("edge-support-dry-run.json", report);
    return {
      stage,
      status: report.status,
      report,
      exit_code: 0,
      command: "foundry-edge-support-plan",
      args: [],
      stderr: "",
    };
  }

  const cli = resolveInstalledTiangongLcaCliPackage();
  const references = new Map(
    plan.roots
      .flatMap((root) => root.references)
      .map((ref) => [`${ref.table}:${ref.id}@${ref.version}`, ref]),
  );
  const assessedFlowHashes = new Map<string, string>();
  if (type === "process") {
    for (const row of rows) {
      const documents = workflowObject(workflowObject(row).semantic_context ?? {}).flow_documents;
      if (!Array.isArray(documents)) continue;
      for (const document of documents) {
        const flow = datasetIdentity(document, 0, "flow");
        const key = `flows:${flow.id}@${flow.version}`;
        const hash = sha256Json(flow.payload);
        if (assessedFlowHashes.has(key) && assessedFlowHashes.get(key) !== hash)
          throw new FoundryContextError(
            "edge_draft_flow_conflict",
            "Final rows carry competing exact Flow reference evidence.",
          );
        assessedFlowHashes.set(key, hash);
      }
    }
  }
  const types = Object.keys(bundleRowTypes) as BundleRowType[];
  if (!receiptFile)
    throw new FoundryContextError(
      "needs_auth",
      "Exact support dependency lookup requires the verified project receipt.",
    );
  const receipt = parseAuthIdentityReceipt(JSON.parse(fs.readFileSync(receiptFile, "utf8")));
  if (
    receipt.project.project_ref !== account.projectRef ||
    receipt.identity.user_id !== account.userId
  )
    throw new FoundryContextError(
      "edge_support_account_mismatch",
      "The selected dependency receipt belongs to a different account.",
    );
  const expectedOrigin = new URL(receipt.project.project_base_url).origin;
  const checks = [];
  for (const [key, reference] of references) {
    const dataset = types.find((kind) => bundleRowTypes[kind].plural === reference.table);
    const cliType =
      dataset === "lifecyclemodel"
        ? "model"
        : (dataset ?? (reference.table === "lciamethods" ? "lciamethod" : null));
    if (!cliType)
      throw new FoundryContextError(
        "edge_support_reference_invalid",
        "Unsupported exact support reference type.",
      );
    const argv = [
      "dataset",
      cliType,
      "get",
      "--id",
      reference.id,
      "--version",
      reference.version,
      "--json",
    ];
    const execution = bindWorkflowChildExecution(context, qualified, cli.binPath, argv);
    const child = spawnSync(process.execPath, [cli.binPath, ...argv], {
      cwd: path.dirname(input),
      env: environment,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const reject = (error?: unknown): never => {
      throw workflowChildFailure(execution, child, "stage_rejected", error);
    };
    if (child.error || child.signal || child.stderr || ![0, 1].includes(child.status ?? -1))
      reject();
    try {
      const envelope = workflowObject(JSON.parse(child.stdout));
      const observed = workflowObject(envelope.context);
      const selected = workflowObject(observed.effectiveInput);
      if (
        envelope.schemaVersion !== 1 ||
        envelope.operation !== `dataset ${cliType} get` ||
        typeof observed.environment !== "string" ||
        new URL(observed.environment).origin !== expectedOrigin ||
        selected.id !== reference.id ||
        selected.version !== reference.version
      )
        throw new Error("Typed reference result has a different project, UUID or version.");
      save(`reference-${sha256Json(key)}.json`, envelope);
      if (
        envelope.status === "failed" &&
        envelope.outcome === "not_found_or_not_visible" &&
        workflowObject(envelope.error).code === "DATASET_NOT_FOUND"
      ) {
        checks.push({ ...reference, role: "reference", status: "missing_dataset" });
        continue;
      }
      const data = workflowObject(envelope.data);
      const subject = workflowObject(data.subject);
      const states = [100, 200];
      const visible =
        typeof subject.stateCode === "number" &&
        (states.includes(subject.stateCode) ||
          (subject.stateCode === 0 && subject.owner === account.userId));
      if (
        child.status !== 0 ||
        envelope.status !== "completed" ||
        envelope.error !== null ||
        envelope.outcome !== "dataset_read" ||
        subject.type !== cliType ||
        subject.id !== reference.id ||
        subject.version !== reference.version
      )
        throw new Error("Typed reference result does not prove the exact visible version.");
      const content = workflowObject(data.content);
      const observedHash = sha256Json(content);
      const expectedHash = assessedFlowHashes.get(key);
      checks.push({
        ...reference,
        role: "reference",
        status:
          expectedHash && expectedHash !== observedHash
            ? "payload_mismatch"
            : visible
              ? "ok"
              : "state_code_mismatch",
        remote_user_id: subject.owner,
        remote_state_code: subject.stateCode,
        remote_payload_sha256: observedHash,
      });
    } catch (error) {
      reject(error);
    }
  }
  const blockers = checks
    .filter((check) => check.status !== "ok")
    .map((check) => ({ ...check, code: check.status }));
  const reportFile = path.join(output, "edge-support-precommit.json");
  const report = {
    schema: "tiangong-foundry.edge-support-precommit.v1",
    status: blockers.length ? "blocked_remote_verification" : "passed_remote_verification",
    input_path: input,
    edge_plan_sha256: plan.sha256,
    checks,
    blockers,
    counts: { blockers: blockers.length },
    files: { report: reportFile },
  };
  save("edge-support-precommit.json", report);
  return {
    stage,
    status: report.status,
    report,
    exit_code: blockers.length ? 1 : 0,
    command: "foundry-edge-support-dependency-read",
    args: [],
    stderr: "",
  };
}
