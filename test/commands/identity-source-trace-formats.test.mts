import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { repoRoot, runFoundry, testTmpRoot, writeJsonLines } from "../fixtures/foundry-core.ts";

for (const type of ["flow", "process"] as const) {
  for (const count of [1, 2, 3]) {
    test(`${type} identity requests preserve JSON and ${count}-row JSONL source evidence`, (t) => {
      const prefix = `${testTmpRoot(`identity-source-formats-${type}`)}-`;
      fs.mkdirSync(path.dirname(prefix), { recursive: true });
      const root = fs.mkdtempSync(prefix);
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const fixture = JSON.parse(
        fs.readFileSync(
          new URL("../fixtures/managed-allocation-input.json", import.meta.url),
          "utf8",
        ),
      ) as {
        payload: Record<string, unknown>;
        context: { flow_documents: Array<Record<string, unknown>> };
      };
      const rows = ["01.00.001", "01.00.002", "02.00.000"].slice(0, count).map((version, index) => {
        const row = structuredClone(
          type === "flow" ? fixture.context.flow_documents[0] : fixture.payload,
        );
        const dataset = row[`${type}DataSet`] as Record<string, unknown>;
        const information = dataset[`${type}Information`] as Record<string, unknown>;
        const identity = information.dataSetInformation as Record<string, unknown>;
        identity["common:UUID"] = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        identity["common:other"] = {
          "tidasimport:sourceTrace": {
            payload: {
              attributes: [
                {
                  name: ["unit", "location", "category"][index],
                  value: ["kg", "CN", "Chemicals"][index],
                },
              ],
            },
          },
        };
        const administrative = dataset.administrativeInformation as Record<string, unknown>;
        const publication = administrative.publicationAndOwnership as Record<string, unknown>;
        publication["common:dataSetVersion"] = version;
        assert.ok(dataset.modellingAndValidation);
        assert.ok(type === "flow" ? dataset.flowProperties : dataset.exchanges);
        return row;
      });
      const input = path.join(root, "rows.json");
      fs.writeFileSync(input, JSON.stringify(rows));
      const inputBefore = fs.readFileSync(input);
      const queries: unknown[][] = [];
      for (const format of ["array", "object", "jsonl", "JSONL"] as const) {
        const source = path.join(
          root,
          `source.${format === "jsonl" || format === "JSONL" ? format : "json"}`,
        );
        fs.writeFileSync(
          source,
          format === "array"
            ? JSON.stringify(rows)
            : format === "object"
              ? JSON.stringify(count === 1 ? rows[0] : { rows })
              : `\r\n${rows.map((row) => JSON.stringify(row)).join("\r\n\r\n")}\r\n`,
        );
        const before = fs.readFileSync(source);
        const sourceIndex = path.join(root, "source-index.jsonl");
        writeJsonLines(
          sourceIndex,
          rows.map((_, index) => ({
            dataset_type: type,
            dataset_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            dataset_version: ["01.00.001", "01.00.002", "02.00.000"][index],
            source_file: source,
          })),
        );
        const result = runFoundry(
          [
            "dataset-identity-preflight-requests-build",
            "--type",
            type,
            "--rows-file",
            input,
            "--source-index",
            sourceIndex,
            "--out-dir",
            path.join(root, `requests-${format}`),
          ],
          { env: { FOUNDRY_RUNTIME_ENV_FILE_POLICY: "disabled" } },
        );
        assert.equal(result.code, 0);
        assert.equal(result.json.status, "ready");
        const index = fs
          .readFileSync(
            path.resolve(repoRoot, result.json.files.identity_preflight_requests),
            "utf8",
          )
          .trim()
          .split(/\r?\n/u)
          .map(
            (line) =>
              JSON.parse(line) as {
                dataset_id: string;
                dataset_version: string;
                target_sha256: string;
                request_file: string;
              },
          );
        assert.equal(index.length, count);
        const requests = index.map((entry, position) => {
          const request = JSON.parse(
            fs.readFileSync(path.resolve(repoRoot, entry.request_file), "utf8"),
          ) as { target: unknown; remote_candidate_search: { query: string } };
          assert.deepEqual(request.target, rows[position]);
          assert.equal(
            entry.dataset_id,
            `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
          );
          assert.equal(entry.dataset_version, ["01.00.001", "01.00.002", "02.00.000"][position]);
          assert.equal(
            entry.target_sha256,
            createHash("sha256").update(JSON.stringify(rows[position])).digest("hex"),
          );
          if (count === 3) {
            assert.match(request.remote_candidate_search.query, /Chemicals/u);
            assert.match(request.remote_candidate_search.query, /CN/u);
          }
          if (type === "flow")
            assert.match(request.remote_candidate_search.query, /reference unit: kg/u);
          return request;
        });
        queries.push(requests);
        assert.deepEqual(fs.readFileSync(source), before);
        assert.deepEqual(fs.readFileSync(input), inputBefore);
      }
      for (const requests of queries.slice(1)) assert.deepEqual(requests, queries[0]);
    });
  }
}
