import { FoundryContextError, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import {
  assertVerifiedFoundryIdentity,
  type FoundryAuthentication,
  verifyFoundryRuntimeIdentity,
} from "./foundry-runtime-identity.ts";

type IdentityEndpoint = "flow_hybrid_search" | "process_hybrid_search";

export function foundryEdgeProjectOrigin(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/functions/v1", "/rest/v1"].includes(url.pathname.replace(/\/+$/u, ""))
  )
    throw new FoundryContextError("edge_project_invalid", "Expected an explicit project base URL.");
  return url.origin;
}

export async function queryFoundryEdgeIdentity(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  endpoint: IdentityEndpoint,
  body: Record<string, unknown>,
) {
  if (authentication.mode !== "headless")
    throw new FoundryContextError(
      "edge_actor_session_required",
      "This Edge call requires an explicit process-only operator session.",
    );
  const credentials = { ...authentication };
  const identity = verifyFoundryRuntimeIdentity(context, credentials, process.env, qualified);
  assertVerifiedFoundryIdentity(context, identity, qualified);
  const origin = foundryEdgeProjectOrigin(credentials.apiBaseUrl);
  if (origin !== foundryEdgeProjectOrigin(identity.receipt.project.project_base_url))
    throw new FoundryContextError(
      "edge_project_mismatch",
      "Edge target must match the verified operator project.",
    );
  const url = new URL(`/functions/v1/${endpoint}`, origin);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      apikey: credentials.publishableKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new FoundryContextError(
      "edge_identity_query_failed",
      "Edge identity query was rejected.",
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > 8 * 1024 * 1024)
    throw new FoundryContextError(
      "edge_identity_query_invalid",
      "Edge identity response exceeds the evidence limit.",
    );
  return { receipt: identity.receipt, result: JSON.parse(text) as unknown };
}
