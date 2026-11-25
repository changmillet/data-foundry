import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import type { TestContext } from "node:test";
import { datasetIdentity } from "../../src/lib/import-curation/internal/dataset-payload.ts";
import { sha256Json } from "../../src/lib/identity-preflight-proof.ts";
import { bundleRowTypes } from "../../src/lib/bundle-row-types.ts";
import { supportFixtureReferences } from "./support-row-builders.ts";

type RemoteRow = {
  table: string;
  id: string;
  version: string;
  owner: string | null;
  state: number;
  content: unknown;
};
type Identity = {
  table: string;
  id: string;
  version: string;
  role: string;
  expectedJsonSha256?: string;
};

export async function installEdgeDraftFixture(
  t: TestContext,
  options: {
    project: string;
    user: string;
    writes: string[];
    readbacks: string[];
    firstId: string;
    secondId: string;
    firstType: "unitgroup" | "contact";
    secondType: "flowproperty" | "source";
  },
) {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(typeof address === "object" && address);
  const callback = `http://127.0.0.1:${address.port}/oauth/callback`;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const origin = `https://${options.project}.supabase.co`;
  const token = "test-only-browser-operator";
  const code = "test-only-authorization-code";
  const references = new Map(
    (options.firstType === "unitgroup" ? supportFixtureReferences : []).map(
      ({ table, id, version }) => [
        id,
        {
          table,
          id,
          version,
          state: 100,
          owner: null,
          content: { fixture: { table, id, version } },
        } satisfies RemoteRow,
      ],
    ),
  );
  const created = new Map<string, RemoteRow>();
  const backingFetch = globalThis.fetch;
  const backingSpawn = childProcess.spawn;
  let challenge: string | null = null;
  let launches = 0;
  let disconnected = false;
  let interruptedRead = false;
  let callbackError: unknown = null;

  t.mock.method(childProcess, "spawn", (...args: Parameters<typeof childProcess.spawn>) => {
    const argv = args[1];
    const selected = Array.isArray(argv)
      ? argv.find(
          (value) =>
            typeof value === "string" && value.startsWith(origin + "/auth/v1/oauth/authorize?"),
        )
      : undefined;
    if (!selected) return Reflect.apply(backingSpawn, childProcess, args);
    const auth = new URL(selected);
    assert.equal(auth.searchParams.get("redirect_uri"), callback);
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.ok(auth.searchParams.get("client_id"));
    challenge = auth.searchParams.get("code_challenge");
    const state = auth.searchParams.get("state");
    assert.ok(state);
    launches += 1;
    const fake = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => {
      fake.emit("spawn");
      void (async () => {
        const wrong = await backingFetch(
          callback + "?" + new URLSearchParams({ code, state: "wrong" }),
        );
        assert.equal(wrong.status, 400, "a mismatched state never releases the OAuth code");
        const right = await backingFetch(callback + "?" + new URLSearchParams({ code, state }));
        assert.equal(right.status, 200);
      })().catch((error: unknown) => {
        callbackError = error;
      });
    });
    return fake;
  });

  const rowFor = (id: string) => created.get(id) ?? references.get(id);
  t.mock.method(globalThis, "fetch", (input: URL, init: RequestInit) => {
    assert.equal(input.origin, origin);
    assert.equal(init.redirect, "error");
    if (input.pathname === "/auth/v1/oauth/token") {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), code);
      assert.equal(body.get("redirect_uri"), callback);
      assert.equal(
        createHash("sha256").update(body.get("code_verifier")!).digest("base64url"),
        challenge,
      );
      return Promise.resolve(
        Response.json({ access_token: token, token_type: "Bearer", expires_in: 3600 }),
      );
    }
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer " + token);
    if (input.pathname === "/auth/v1/oauth/userinfo")
      return Promise.resolve(Response.json({ sub: options.user }));

    if (input.pathname === "/functions/v1/app_dataset_create") {
      const { table, id, jsonOrdered } = JSON.parse(String(init.body)) as {
        table: string;
        id: string;
        jsonOrdered: unknown;
      };
      const { firstType, secondType } = options;
      const first = table === bundleRowTypes[firstType].plural;
      const type = first ? firstType : secondType;
      assert.equal(table, bundleRowTypes[type].plural);
      assert.equal(id, first ? options.firstId : options.secondId);
      assert.ok(!created.has(id), "an already-dispatched Edge create cannot be replayed");
      if (!first) {
        assert.ok(options.readbacks.includes(firstType));
        assert.ok(created.has(options.firstId));
      }
      const version = datasetIdentity(jsonOrdered, 0, type).version;
      created.set(id, { table, id, version, owner: options.user, state: 0, content: jsonOrdered });
      options.writes.push(type);
      if (first && !disconnected) {
        disconnected = true;
        return Promise.reject(new TypeError("fixture network loss after commit"));
      }
      return Promise.resolve(
        Response.json({
          ok: true,
          command: "dataset_create",
          data: { id, version, user_id: options.user, state_code: 0 },
        }),
      );
    }

    assert.equal(input.pathname, "/functions/v1/app_dataset_verify_remote");
    const body = JSON.parse(String(init.body)) as {
      rootPolicy: "existing" | "candidate";
      references: Identity[];
    };
    const root = body.references[0];
    if (
      body.rootPolicy === "existing" &&
      root.id === options.firstId &&
      disconnected &&
      !interruptedRead
    ) {
      interruptedRead = true;
      return Promise.reject(new TypeError("fixture link has not recovered yet"));
    }
    const checks = body.references.map((ref, index) => {
      const remote = rowFor(ref.id);
      const exact = remote?.version === ref.version && remote.table === ref.table ? remote : null;
      const hash = exact ? sha256Json(exact.content) : null;
      const status = exact
        ? ref.expectedJsonSha256 && ref.expectedJsonSha256 !== hash
          ? "payload_hash_mismatch"
          : "ok"
        : body.rootPolicy === "candidate" && ref.role === "root" && !remote
          ? "candidate_root"
          : "missing_dataset";
      return {
        ...ref,
        index,
        status,
        exact_version: exact?.version ?? null,
        latest_version: remote?.version ?? null,
        user_id: exact?.owner ?? null,
        state_code: exact?.state ?? null,
        payload_present: Boolean(exact),
        actual_json_sha256: hash,
      };
    });
    const failed = checks.some(({ status }) => !["ok", "candidate_root"].includes(status));
    if (body.rootPolicy === "existing" && !failed)
      options.readbacks.push(root.id === options.firstId ? options.firstType : options.secondType);
    return Promise.resolve(
      Response.json(
        {
          ok: !failed,
          command: "dataset_verify_remote",
          data: { root_policy: body.rootPolicy, checks },
        },
        { status: failed ? 409 : 200 },
      ),
    );
  });

  return {
    callback,
    origin,
    rowFor,
    assertRecovered() {
      if (callbackError) throw callbackError;
      assert.equal(launches, 1, "OAuth is reused within the runtime");
      assert.equal(disconnected, true);
      assert.equal(interruptedRead, true);
    },
  };
}
