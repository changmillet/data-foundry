import { FoundryContextError, type FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import {
  assertVerifiedFoundryIdentity,
  type FoundryAuthentication,
  verifyFoundryRuntimeIdentity,
} from "./foundry-runtime-identity.ts";
import { resolveFoundryEdgeOAuth } from "./foundry-edge-oauth.ts";

type IdentityEndpoint = "flow_hybrid_search" | "process_hybrid_search";
type EdgeEndpoint =
  IdentityEndpoint | "app_dataset_create" | "app_dataset_save_draft" | "app_dataset_verify_remote";

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

async function readCensusPageBody(response: Response): Promise<string> {
  const limit = 8 * 1024 * 1024;
  const tooLarge = () =>
    new FoundryContextError("repair_census_read_invalid", "Repair census page exceeds 8 MiB.");
  if (!response.body)
    throw new FoundryContextError("repair_census_read_invalid", "Repair census page is empty.");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    throw tooLarge();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw tooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
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
  let token =
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
  let current =
    credentials.mode === "headless"
      ? identity
      : verifyFoundryRuntimeIdentity(context, credentials, process.env, qualified);
  if (foundryEdgeProjectOrigin(current.receipt.project.project_base_url) !== origin)
    throw new FoundryContextError(
      "edge_project_mismatch",
      "The OAuth project changed during authentication.",
    );
  return {
    get receipt() {
      return current.receipt;
    },
    async readDataPage(input: {
      table:
        | "processes"
        | "lifecyclemodels"
        | "flows"
        | "flowproperties"
        | "unitgroups"
        | "sources"
        | "contacts"
        | "lciamethods";
      state?: 0 | 100;
      owner?: string;
      id?: string;
      version?: string;
      ids?: readonly string[];
      projection?: "dependencies";
      offset: number;
      limit: number;
    }) {
      try {
        assertVerifiedFoundryIdentity(context, current, qualified);
      } catch (error) {
        if (!(error instanceof FoundryContextError) || error.code !== "identity_receipt_stale")
          throw error;
        current = verifyFoundryRuntimeIdentity(context, credentials, process.env, qualified);
        if (foundryEdgeProjectOrigin(current.receipt.project.project_base_url) !== origin)
          throw new FoundryContextError(
            "edge_project_mismatch",
            "The census project changed during identity renewal.",
          );
        if (credentials.mode !== "headless")
          token = await resolveFoundryEdgeOAuth(
            origin,
            current.receipt.identity.user_id,
            credentials.configuration,
          );
        assertVerifiedFoundryIdentity(context, current, qualified);
      }
      const allowed = [
        "processes",
        "lifecyclemodels",
        "flows",
        "flowproperties",
        "unitgroups",
        "sources",
        "contacts",
        "lciamethods",
      ];
      if (
        !allowed.includes(input.table) ||
        !Number.isSafeInteger(input.offset) ||
        input.offset < 0 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100 ||
        (input.state !== undefined && input.state !== 0 && input.state !== 100) ||
        (input.state === 0 && input.owner !== current.receipt.identity.user_id) ||
        (input.id === undefined && input.state === undefined) ||
        (input.version !== undefined && input.id === undefined)
      )
        throw new FoundryContextError(
          "repair_census_query_invalid",
          "Select a bounded public or current-owner draft census, or an exact reference identity.",
        );
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
      if (
        (input.owner !== undefined && !uuid.test(input.owner)) ||
        (input.id !== undefined &&
          (!uuid.test(input.id) ||
            (input.version === undefined
              ? input.table !== "flows" || input.state === undefined
              : !/^[0-9]{2}\.[0-9]{2}\.[0-9]{3}$/u.test(input.version))))
      )
        throw new FoundryContextError(
          "repair_census_query_invalid",
          "Repair census reads require exact owner and versioned dataset identities.",
        );
      if (
        (input.ids !== undefined &&
          (!Array.isArray(input.ids) ||
            input.ids.length < 1 ||
            input.ids.length > 100 ||
            new Set(input.ids).size !== input.ids.length ||
            input.ids.some((id) => !uuid.test(id)) ||
            input.id !== undefined ||
            input.version !== undefined ||
            input.state === undefined)) ||
        (input.projection !== undefined &&
          (input.projection !== "dependencies" ||
            !["processes", "lifecyclemodels", "flows"].includes(input.table) ||
            input.state === undefined))
      )
        throw new FoundryContextError(
          "repair_census_query_invalid",
          "Select bounded exact family identities or the supported dependency directory projection.",
        );
      const projected = {
        processes:
          "id,version,user_id,state_code,model_id,model_version,team_id,review_id,exchanges:json->processDataSet->exchanges->exchange",
        lifecyclemodels:
          "id,version,user_id,state_code,result_process:json->lifeCycleModelDataSet->lifeCycleModelInformation->dataSetInformation->referenceToResultingProcess,process_instances:json->lifeCycleModelDataSet->lifeCycleModelInformation->technology->processes->processInstance",
        flows:
          "id,version,user_id,state_code,declared_type:json->flowDataSet->modellingAndValidation->LCIMethod->typeOfDataSet",
      };
      const url = new URL(`/rest/v1/${input.table}`, origin);
      url.searchParams.set(
        "select",
        input.projection
          ? projected[input.table as keyof typeof projected]
          : `id,version,user_id,state_code,json${input.table === "processes" ? ",model_id,model_version,team_id,review_id" : ""}`,
      );
      if (input.ids) url.searchParams.set("id", `in.(${input.ids.join(",")})`);
      url.searchParams.set("order", "id.asc,version.asc");
      if (input.state !== undefined) url.searchParams.set("state_code", `eq.${input.state}`);
      if (input.owner !== undefined) url.searchParams.set("user_id", `eq.${input.owner}`);
      if (input.id !== undefined) url.searchParams.set("id", `eq.${input.id}`);
      if (input.version !== undefined) url.searchParams.set("version", `eq.${input.version}`);
      const requestedAtUtc = new Date().toISOString();
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(publishableKey ? { apikey: publishableKey } : {}),
          Accept: "application/json",
          "Accept-Profile": "public",
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: `${input.offset}-${input.offset + input.limit - 1}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new FoundryContextError(
          "repair_census_read_failed",
          "The authenticated read interface rejected the repair census.",
        );
      const raw = await readCensusPageBody(response);
      return {
        raw,
        contentRange: response.headers.get("content-range"),
        status: response.status,
        identityReceipt: current.receipt,
        requestedAtUtc,
      };
    },
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
