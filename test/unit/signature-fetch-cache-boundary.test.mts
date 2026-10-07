import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the real installed development signing transport without a new dependency.
const rootRequire = createRequire(import.meta.url);
const sigstoreRequire = createRequire(rootRequire.resolve("sigstore"));
const signRequire = createRequire(sigstoreRequire.resolve("@sigstore/sign"));
const signingFetch = signRequire("make-fetch-happen") as (
  url: string,
  options: { headers: Record<string, string>; timeout: number; retry: false },
) => Promise<{ text: () => Promise<string> }>;

test("installed signing fetch does not retain responses without an HTTP cache path", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, {
      "cache-control": "public, max-age=60",
      "set-cookie": "session=local-fixture",
    });
    response.end(`origin-response-${requests}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/signing-fixture`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await signingFetch(url, {
        headers: { "cache-control": "max-stale=999999" },
        timeout: 5_000,
        retry: false,
      });
      assert.equal(await result.text(), `origin-response-${attempt}`);
    }
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
