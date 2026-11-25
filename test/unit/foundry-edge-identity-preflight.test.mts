import assert from "node:assert/strict";
import test from "node:test";
import {
  edgeIdentityCandidates,
  validateEdgeIdentityQuery,
} from "../../src/lib/foundry-edge-identity-preflight.ts";
import { foundryEdgeProjectOrigin } from "../../src/lib/foundry-edge-session.ts";
import { sha256Text } from "../../src/lib/identity-preflight-proof.ts";
import { flowRow } from "../fixtures/row-builders.ts";

test("Foundry Edge identity query must retain every audited search option", () => {
  const dataset = "77777777-7777-4777-8777-777777777777";
  const target = flowRow(dataset);
  const body = {
    query: "identity of electricity",
    data_source: "tg",
    filter: { flowType: "Product flow" },
    match_count: 20,
    page_size: 20,
    match_threshold: 0.15,
    lexical_weight: 0.8,
    semantic_weight: 0.2,
    rrf_k: 30,
  };
  const { match_count: limit, page_size: _pageSize, ...search } = body;
  const requestText = JSON.stringify({
    target,
    remote_candidate_search: { enabled: true, ...search, limit },
  });
  const row = {
    dataset_type: "flow",
    dataset_id: dataset,
    dataset_version: "00.00.001",
    request_bytes_sha256: sha256Text(requestText),
    target_sha256: sha256Text(JSON.stringify(target)),
    remote_search: { edge_request: { endpoint: "flow_hybrid_search", body } },
  };
  assert.deepEqual(validateEdgeIdentityQuery("flow", row, requestText).body, body);
  body.semantic_weight = 0.5;
  assert.throws(() => validateEdgeIdentityQuery("flow", row, requestText), /audited request/);
  assert.throws(
    () => validateEdgeIdentityQuery("flow", row, requestText + "\n"),
    /audited request/,
  );
});

test("Edge identity keeps exact versions and refuses duplicate and over-limit candidates", () => {
  const id = "77777777-7777-4777-8777-777777777777";
  const row = { id, version: "00.00.001", json: flowRow(id) };
  assert.equal(edgeIdentityCandidates("flow", { data: [row] }, 1)[0].version, row.version);
  assert.throws(() => edgeIdentityCandidates("flow", [row, row], 2), /audited request/);
  assert.throws(() => edgeIdentityCandidates("flow", [row, row], 1), /audited request/);
  assert.throws(
    () => edgeIdentityCandidates("flow", [{ ...row, version: "00.00.002" }], 1),
    /audited request/,
  );
});

test("Edge actor project accepts only the verified project API base routes", () => {
  assert.equal(
    foundryEdgeProjectOrigin("https://test.supabase.co/functions/v1/"),
    "https://test.supabase.co",
  );
  for (const url of [
    "https://user@test.supabase.co",
    "https://test.supabase.co/functions/v1/flow_hybrid_search",
    "https://test.supabase.co/?key=other",
  ])
    assert.throws(() => foundryEdgeProjectOrigin(url), /explicit project base URL/);
});
