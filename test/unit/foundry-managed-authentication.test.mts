import assert from "node:assert/strict";
import test from "node:test";
import { createManagedFoundryAuthentication } from "../../scripts/lib/foundry-managed-authentication.ts";
import { createFoundryAuthenticationEnvironment } from "../../scripts/lib/foundry-authentication-environment.ts";

test("legacy and isolated managed launches never consume ambient authentication", () => {
  const unread = new Proxy(
    {},
    {
      get() {
        throw new Error("ambient authentication read");
      },
    },
  );
  assert.equal(createManagedFoundryAuthentication("isolated", true, unread), undefined);
  assert.equal(createManagedFoundryAuthentication("cli-auth", false, unread), undefined);
});

test("reviewed cli-auth carrier projects only explicit process headless credentials", () => {
  const source = {
    TIANGONG_LCA_AUTH_MODE: "access_token",
    TIANGONG_LCA_ACCESS_TOKEN: "synthetic-token",
    TIANGONG_LCA_API_BASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
    TIANGONG_LCA_SESSION_FILE: "/must-not-use",
    NODE_OPTIONS: "--must-not-use",
    EXTRA_SECRET: "must-not-use",
  };
  const auth = createManagedFoundryAuthentication("cli-auth", true, source);
  assert.deepEqual(auth, {
    mode: "headless",
    accessToken: source.TIANGONG_LCA_ACCESS_TOKEN,
    apiBaseUrl: source.TIANGONG_LCA_API_BASE_URL,
    publishableKey: source.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
  });
  assert.ok(Object.isFrozen(auth));
  const child = createFoundryAuthenticationEnvironment(auth, null, {});
  assert.equal(child.TIANGONG_LCA_AUTH_MODE, "access_token");
  assert.equal(child.TIANGONG_LCA_DISABLE_SESSION_CACHE, "true");
  assert.equal(child.TIANGONG_LCA_SESSION_FILE, undefined);
  assert.equal(child.NODE_OPTIONS, undefined);
  assert.equal(child.EXTRA_SECRET, undefined);
});

test("OAuth projection never infers headless mode or replaces registered session intent", () => {
  const auth = createManagedFoundryAuthentication("cli-auth", true, {
    TIANGONG_LCA_ACCESS_TOKEN: "ignored",
    TIANGONG_LCA_SESSION_FILE: "/ignored",
    TIANGONG_LCA_API_BASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    TIANGONG_LCA_OAUTH_CLIENT_ID: "public-client",
    TIANGONG_LCA_OAUTH_REDIRECT_URI: "http://127.0.0.1/callback",
  });
  assert.deepEqual(auth, {
    mode: "oauth",
    configuration: {
      apiBaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
      oauthClientId: "public-client",
      oauthRedirectUri: "http://127.0.0.1/callback",
    },
  });
  assert.equal("sessionReference" in auth, false);
  assert.equal("accessToken" in auth, false);
});

test("unsupported modes and incomplete headless targets reject without disclosing credentials", () => {
  for (const env of [
    { TIANGONG_LCA_AUTH_MODE: "password", TIANGONG_LCA_ACCESS_TOKEN: "private-fixture" },
    { TIANGONG_LCA_AUTH_MODE: "access_token", TIANGONG_LCA_ACCESS_TOKEN: "private-fixture" },
    {
      TIANGONG_LCA_AUTH_MODE: "access_token",
      TIANGONG_LCA_API_BASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY: "fixture-key",
    },
  ]) {
    assert.throws(
      () => createManagedFoundryAuthentication("cli-auth", true, env),
      (error) =>
        error instanceof Error &&
        !error.message.includes("private-fixture") &&
        !error.message.includes("fixture-key"),
    );
  }
});
