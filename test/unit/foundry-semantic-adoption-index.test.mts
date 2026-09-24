import assert from "node:assert/strict";
import test from "node:test";
import { foundryInteractionObjectKey } from "../../scripts/lib/foundry-interaction-scope.ts";
import { indexedFoundryAdoptionRows } from "../../scripts/lib/foundry-workflow-semantic.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

const version = "00.00.001";

function processRow(index: number) {
  const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  return {
    id,
    version,
    json: {
      processDataSet: {
        processInformation: { dataSetInformation: { "common:UUID": id } },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": version },
        },
      },
    },
  };
}

test("row adoption indexes a multi-object set with one bounded read", () => {
  const rows = Array.from({ length: 512 }, (_, index) => processRow(index));
  const selected = [0, 257, 511].map((index) => rows[index]);
  const keys = new Set(
    selected.map((row) => foundryInteractionObjectKey("process", row.id, row.version)),
  );
  const contents = rows.map((row) => JSON.stringify(row)).join("\n");
  let reads = 0;
  const indexed = indexedFoundryAdoptionRows("rows.jsonl", "process", keys, (file) => {
    assert.equal(file, "rows.jsonl");
    reads += 1;
    return contents;
  });
  assert.equal(reads, 1);
  assert.equal(indexed.size, selected.length);
  for (const row of selected)
    assert.equal(
      indexed.get(foundryInteractionObjectKey("process", row.id, row.version)),
      sha256Json(row),
    );
});

test("row adoption index preserves missing and duplicate identity failures", () => {
  const first = processRow(1);
  const missing = processRow(2);
  const keys = new Set(
    [first, missing].map((row) => foundryInteractionObjectKey("process", row.id, row.version)),
  );
  const indexed = indexedFoundryAdoptionRows(
    "rows.jsonl",
    "process",
    keys,
    () => `${JSON.stringify(first)}\n${JSON.stringify(first)}\n`,
  );
  assert.equal(indexed.get(foundryInteractionObjectKey("process", first.id, version)), null);
  assert.equal(indexed.has(foundryInteractionObjectKey("process", missing.id, version)), false);
});
