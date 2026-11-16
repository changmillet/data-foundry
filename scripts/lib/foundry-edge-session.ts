import { FoundryContextError, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import {
  assertVerifiedFoundryIdentity,
  type FoundryAuthentication,
  verifyFoundryRuntimeIdentity,
} from "./foundry-runtime-identity.ts";
import { resolveFoundryEdgeOAuth } from "./foundry-edge-oauth.ts";

type IdentityEndpoint = "flow_hybrid_search" | "process_hybrid_search";
type EdgeEndpoint = IdentityEndpoint | "app_dataset_create" | "app_dataset_verify_remote";

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

export async function createFoundryEdgeActor(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
) {
  const credentials =
    authentication.mode === "headless"
      ? { ...authentication }
      : {
          ...authentication,
          configuration: { ...authentication.configuration },
        };
  const identity = verifyFoundryRuntimeIdentity(context, credentials, process.env, qualified);
  const verifiedOrigin = foundryEdgeProjectOrigin(identity.receipt.project.project_base_url);
  const configured =
    credentials.mode === "headless" ? credentials.apiBaseUrl : credentials.configuration.apiBaseUrl;
  const origin = configured ? foundryEdgeProjectOrigin(configured) : verifiedOrigin;
  if (origin !== verifiedOrigin)
    throw new FoundryContextError(
      "edge_project_mismatch",
      "Edge target must match the verified operator project.",
    );
  const token =
    credentials.mode === "headless"
      ? credentials.accessToken
      : await resolveFoundryEdgeOAuth(
          origin,
          identity.receipt.identity.user_id,
          credentials.configuration,
        );
  const publishableKey =
    credentials.mode === "headless"
      ? credentials.publishableKey
      : credentials.configuration.publishableKey;
  // Browser authorization can take longer than the CLI receipt window.
  const current =
    credentials.mode === "headless"
      ? identity
      : verifyFoundryRuntimeIdentity(context, credentials, process.env, qualified);
  if (foundryEdgeProjectOrigin(current.receipt.project.project_base_url) !== origin)
    throw new FoundryContextError(
      "edge_project_mismatch",
      "The OAuth project changed during authentication.",
    );
  return {
    receipt: current.receipt,
    async post(endpoint: EdgeEndpoint, body: Record<string, unknown>): Promise<unknown> {
      assertVerifiedFoundryIdentity(context, current, qualified);
      const url = new URL(`/functions/v1/${endpoint}`, origin);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(publishableKey ? { apikey: publishableKey } : {}),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(body),
      });
      if (!response.ok && !(endpoint === "app_dataset_verify_remote" && response.status === 409))
        throw new FoundryContextError(
          "edge_request_failed",
          "The selected Edge request was rejected.",
        );
      const text = await response.text();
      if (Buffer.byteLength(text) > 8 * 1024 * 1024)
        throw new FoundryContextError(
          "edge_response_invalid",
          "The Edge response exceeds the evidence limit.",
        );
      return JSON.parse(text) as unknown;
    },
  };
}

export async function queryFoundryEdgeIdentity(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  endpoint: IdentityEndpoint,
  body: Record<string, unknown>,
) {
  const actor = await createFoundryEdgeActor(context, qualified, authentication);
  return { receipt: actor.receipt, result: await actor.post(endpoint, body) };
}
