import type { RuntimeLaunch } from "@tiangong-lca/cli/runtime";
import type {
  FoundryAuthentication,
  FoundryPublicOAuthConfiguration,
} from "./foundry-authentication-environment.ts";
import { FoundryContextError } from "./foundry-runtime-error.ts";

/** The verified carrier and CLI launch policy select this existing credential channel. */
export function createManagedFoundryAuthentication(
  environment: RuntimeLaunch["environment"],
  carrierAdmitted: boolean,
  source: NodeJS.ProcessEnv,
): FoundryAuthentication | undefined {
  if (!carrierAdmitted || environment !== "cli-auth") return undefined;
  const mode = source.TIANGONG_LCA_AUTH_MODE || "oauth";
  if (mode === "access_token") {
    const accessToken = source.TIANGONG_LCA_ACCESS_TOKEN;
    const apiBaseUrl = source.TIANGONG_LCA_API_BASE_URL;
    const publishableKey = source.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY;
    if (!accessToken || !apiBaseUrl || !publishableKey)
      throw new FoundryContextError(
        "managed_authentication_invalid",
        "Managed headless authentication requires the existing CLI explicit public target and process-only token.",
      );
    return Object.freeze({ mode: "headless", accessToken, apiBaseUrl, publishableKey });
  }
  if (mode !== "oauth")
    throw new FoundryContextError(
      "managed_authentication_invalid",
      "The selected managed authentication mode is unsupported.",
    );
  const fields = [
    ["apiBaseUrl", "TIANGONG_LCA_API_BASE_URL"],
    ["publishableKey", "TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY"],
    ["oauthClientId", "TIANGONG_LCA_OAUTH_CLIENT_ID"],
    ["oauthRedirectUri", "TIANGONG_LCA_OAUTH_REDIRECT_URI"],
  ] as const;
  const configuration: FoundryPublicOAuthConfiguration = {};
  for (const [key, variable] of fields) if (source[variable]) configuration[key] = source[variable];
  return Object.freeze({ mode: "oauth", configuration: Object.freeze(configuration) });
}
