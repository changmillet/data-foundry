import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  createFoundryAuthenticationEnvironment,
  type FoundryAuthentication,
} from "./foundry-authentication-environment.ts";
import type { createFoundryEdgeActor } from "./foundry-edge-session.ts";
import type { EdgeSupportRoot } from "./foundry-edge-support-plan.ts";
import { FoundryContextError, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { sha256Json, sha256Text } from "./identity-preflight-proof.ts";

export function createFoundryTypedModelDraft(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  receipt: Awaited<ReturnType<typeof createFoundryEdgeActor>>["receipt"],
  originalRequest: string,
  root: EdgeSupportRoot,
  content: Record<string, unknown>,
) {
  assertQualifiedFoundryRuntime(context, qualified);
  const cli = resolveInstalledTiangongLcaCliPackage();
  const expectedActor = receipt.identity.user_id;
  const expectedEnvironment = new URL(receipt.project.project_base_url).origin;
  const request = {
    id: root.id,
    version: root.version,
    content,
    requestId: sha256Json({ originalRequest, id: root.id, version: root.version }),
    expectedActor,
    expectedEnvironment,
  };
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent?.sessionReference,
    process.env,
  );
  let child: SpawnSyncReturns<string>;
  try {
    child = spawnSync(
      process.execPath,
      [cli.binPath, "dataset", "model", "create", "--input", "-", "--json"],
      {
        cwd: context.workspaceRoot,
        env: environment,
        input: JSON.stringify(request),
        encoding: "utf8",
        shell: false,
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } finally {
    delete environment.TIANGONG_LCA_ACCESS_TOKEN;
  }
  const unproven = () =>
    new FoundryContextError(
      "model_draft_result_unproven",
      "The original Model write requires independent exact readback.",
    );
  if (child.status !== 0 || child.signal || child.error || child.stderr) throw unproven();
  const envelope = workflowObject(JSON.parse(child.stdout));
  const data = workflowObject(envelope.data);
  const subject = workflowObject(data.subject);
  const provenance = workflowObject(envelope.context);
  if (
    envelope.schemaVersion !== 1 ||
    envelope.operation !== "dataset model create" ||
    envelope.status !== "completed" ||
    envelope.outcome !== "dataset_written" ||
    envelope.error !== null ||
    subject.type !== "model" ||
    subject.id !== root.id ||
    subject.version !== root.version ||
    data.contentDigest !== sha256Text(JSON.stringify(content)) ||
    provenance.environment !== expectedEnvironment ||
    workflowObject(provenance.actor).id !== expectedActor ||
    provenance.requestId !== request.requestId ||
    workflowObject(data.readback).contentMatchesIntent !== true
  )
    throw unproven();
  return envelope;
}
