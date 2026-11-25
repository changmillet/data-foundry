import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { FoundryContextError } from "./foundry-runtime-context.ts";
import type { FoundryPublicOAuthConfiguration } from "./foundry-authentication-environment.ts";

// The existing public TianGong CLI registration used by the released CLI 0.4.0.
const officialOrigin = "https://qgzvkongdjqiiamzbbts.supabase.co";
const officialClient = "1837c6d3-3c9d-48e0-bbf7-b532b78f9f76";
const defaultCallback = "http://127.0.0.1:49191/oauth/callback";
const inMemory = new Map<string, { token: string; expiresAt: number }>();

type PublicClient = { origin: string; clientId: string; redirect: URL };
type OpenBrowser = (url: string) => Promise<void>;

function fail(code: string, message: string): never {
  throw new FoundryContextError(code, message);
}

function browser(url: string): Promise<void> {
  const windows = process.platform === "win32";
  const command = windows ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = windows ? ["url.dll,FileProtocolHandler", url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () =>
      reject(
        new FoundryContextError(
          "edge_oauth_browser_failed",
          "Open the OAuth authorization in an available system browser.",
        ),
      ),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function clientSettings(
  origin: string,
  configuration: FoundryPublicOAuthConfiguration,
): PublicClient {
  const clientId = configuration.oauthClientId || (origin === officialOrigin ? officialClient : "");
  const redirect = new URL(configuration.oauthRedirectUri || defaultCallback);
  if (
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(clientId) ||
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    Number(redirect.port) < 1024 ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== "/oauth/callback"
  )
    return fail(
      "edge_oauth_config_invalid",
      "OAuth requires the selected project's public client and its registered loopback redirect.",
    );
  return { origin, clientId, redirect };
}

async function authorize(client: PublicClient, openBrowser: OpenBrowser) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const authorization = new URL("/auth/v1/oauth/authorize", client.origin);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirect.href,
    scope: "openid email profile",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state,
  }).toString();
  return new Promise<{ code: string; verifier: string }>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.closeAllConnections();
      server.close();
      if (error) reject(error);
      else resolve({ code: code!, verifier });
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", client.redirect.origin);
      if (
        request.method !== "GET" ||
        request.headers.host !== client.redirect.host ||
        url.origin !== client.redirect.origin ||
        url.pathname !== client.redirect.pathname ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== state
      ) {
        response.writeHead(400, { "Cache-Control": "no-store" }).end("Invalid OAuth callback.");
        return;
      }
      const code = url.searchParams.get("code");
      if (
        !code ||
        code.length > 4096 ||
        url.searchParams.getAll("code").length !== 1 ||
        url.searchParams.has("error")
      ) {
        response
          .writeHead(400, { "Cache-Control": "no-store" })
          .end("Authorization was not completed.", () =>
            finish(
              new FoundryContextError(
                "edge_oauth_not_authorized",
                "The operator did not authorize the Edge session.",
              ),
            ),
          );
        return;
      }
      response
        .writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        })
        .end("Foundry received authorization. You can close this tab.", () => finish(null, code));
    });
    const timeout = setTimeout(
      () =>
        finish(
          new FoundryContextError(
            "edge_oauth_timeout",
            "The loopback OAuth authorization expired.",
          ),
        ),
      120_000,
    );
    server.once("error", () =>
      finish(
        new FoundryContextError(
          "edge_oauth_callback_unavailable",
          "The registered loopback OAuth port is unavailable.",
        ),
      ),
    );
    server.listen(
      Number(client.redirect.port),
      "127.0.0.1",
      () => void openBrowser(authorization.href).catch((error: Error) => finish(error)),
    );
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function resolveFoundryEdgeOAuth(
  origin: string,
  expectedUser: string,
  configuration: FoundryPublicOAuthConfiguration,
  openBrowser: OpenBrowser = browser,
): Promise<string> {
  if (new URL(origin).protocol !== "https:")
    return fail("edge_oauth_config_invalid", "Use an HTTPS project for operator OAuth.");
  const client = clientSettings(origin, configuration);
  const key = JSON.stringify([origin, client.clientId, expectedUser]);
  let selected = inMemory.get(key);
  if (!selected || selected.expiresAt - Date.now() < 90_000) {
    const { code, verifier } = await authorize(client, openBrowser);
    const response = await fetch(new URL("/auth/v1/oauth/token", origin), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.clientId,
        redirect_uri: client.redirect.href,
        code,
        code_verifier: verifier,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return fail(
        "edge_oauth_token_failed",
        "The existing OAuth service did not issue an operator session.",
      );
    const body = object(await response.json());
    if (
      typeof body.access_token !== "string" ||
      !body.access_token ||
      String(body.token_type).toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(body.expires_in) ||
      Number(body.expires_in) <= 0
    )
      return fail("edge_oauth_token_invalid", "OAuth returned an invalid operator session.");
    selected = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in) * 1000 };
  }

  const response = await fetch(new URL("/auth/v1/oauth/userinfo", origin), {
    headers: { Accept: "application/json", Authorization: `Bearer ${selected.token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || object(await response.json()).sub !== expectedUser) {
    inMemory.delete(key);
    return fail(
      "edge_oauth_actor_mismatch",
      "The browser session does not match the verified task account.",
    );
  }
  inMemory.set(key, selected);
  return selected.token;
}
