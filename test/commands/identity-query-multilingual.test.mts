import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { repoRoot, runFoundry, testTmpRoot, writeJsonLines } from "../fixtures/foundry-core.ts";

type DatasetType = "flow" | "process";
type Name = Record<string, unknown>;
interface QueryRow {
  request_file: string;
  remote_search: { query: string; edge_request: { body: { query: string } } };
}

function buildQueries(t: TestContext, type: DatasetType, names: readonly Name[]): QueryRow[] {
  const prefix = `${testTmpRoot(`identity-query-${type}`)}-`;
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const root = fs.mkdtempSync(prefix);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = names.map((name, index) => {
    const information = {
      dataSetInformation: {
        "common:UUID": `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name,
      },
    };
    return {
      [`${type}DataSet`]: {
        [`${type}Information`]: information,
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    };
  });
  const input = path.join(root, "rows.jsonl");
  writeJsonLines(input, rows);
  const before = fs.readFileSync(input);
  const result = runFoundry(
    [
      "dataset-identity-preflight-requests-build",
      "--type",
      type,
      "--rows-file",
      input,
      "--out-dir",
      path.join(root, "requests"),
    ],
    { env: { FOUNDRY_RUNTIME_ENV_FILE_POLICY: "disabled" } },
  );
  assert.equal(result.code, 0);
  assert.equal(result.json.status, "ready");
  const index = path.resolve(repoRoot, result.json.files.identity_preflight_requests);
  const queries = fs
    .readFileSync(index, "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as QueryRow);
  assert.equal(queries.length, rows.length);
  for (const [index, query] of queries.entries()) {
    const request = JSON.parse(
      fs.readFileSync(path.resolve(repoRoot, query.request_file), "utf8"),
    ) as {
      target: unknown;
      remote_candidate_search: { query: string };
    };
    assert.deepEqual(request.target, rows[index]);
    assert.equal(request.remote_candidate_search.query, query.remote_search.query);
    assert.equal(query.remote_search.edge_request.body.query, query.remote_search.query);
  }
  assert.ok(fs.readFileSync(input).equals(before));
  return queries;
}

test("Flow identity queries retain multilingual name order and existing scalar names", (t) => {
  const rows = buildQueries(t, "flow", [
    {
      baseName: "Scalar name",
      treatmentStandardsRoutes: { "#text": "Purified" },
      mixAndLocationTypes: "At plant",
    },
    {
      baseName: [
        { "#text": "Example product", "@xml:lang": "en" },
        { "#text": "示例产品", "@xml:lang": "zh" },
      ],
      treatmentStandardsRoutes: [{ "#text": "Purified", "@xml:lang": "en" }],
      mixAndLocationTypes: [{ "#text": "At plant", "@xml:lang": "en" }],
    },
  ]);
  assert.equal(
    rows[0].remote_search.query.split("\n")[0],
    "flow name: Scalar name; Purified; At plant",
  );
  assert.equal(
    rows[1].remote_search.query.split("\n")[0],
    "flow name: Example product; 示例产品; Purified; At plant",
  );
});

test("Process identity queries retain multilingual name order and existing scalar names", (t) => {
  const rows = buildQueries(t, "process", [
    {
      baseName: "Scalar name",
      treatmentStandardsRoutes: { "#text": "Purified" },
      mixAndLocationTypes: "At plant",
    },
    {
      baseName: [
        { "#text": "Example product", "@xml:lang": "en" },
        { "#text": "示例产品", "@xml:lang": "zh" },
      ],
      treatmentStandardsRoutes: [{ "#text": "Purified", "@xml:lang": "en" }],
      mixAndLocationTypes: [{ "#text": "At plant", "@xml:lang": "en" }],
    },
  ]);
  assert.equal(
    rows[0].remote_search.query.split("\n")[0],
    "process name: Scalar name; Purified; At plant",
  );
  assert.equal(
    rows[1].remote_search.query.split("\n")[0],
    "process name: Example product; 示例产品; Purified; At plant",
  );
});

for (const type of ["flow", "process"] as const) {
  test(`${type} identity queries use the dataset's legal fourth name field`, (t) => {
    const legal = type === "flow" ? "flowProperties" : "functionalUnitFlowProperties";
    const other = type === "flow" ? "functionalUnitFlowProperties" : "flowProperties";
    const rows = buildQueries(t, type, [
      {
        baseName: { "#text": "Bag" },
        treatmentStandardsRoutes: "Woven",
        mixAndLocationTypes: { "#text": "At gate" },
        [legal]: "0.12 kg per bag",
        [other]: "Wrong dataset field",
      },
      {
        baseName: "Bag",
        treatmentStandardsRoutes: { "#text": "Woven" },
        mixAndLocationTypes: "At gate",
        [legal]: [{ "#text": "0.12 kg per bag", "@xml:lang": "en" }],
        [other]: [{ "#text": "Wrong dataset field" }],
      },
    ]);
    for (const row of rows) {
      assert.equal(
        row.remote_search.query.split("\n")[0],
        `${type} name: Bag; Woven; At gate; 0.12 kg per bag`,
      );
      assert.doesNotMatch(row.remote_search.query.split("\n")[0], /Wrong dataset field/u);
    }
  });

  test(`${type} multilingual queries preserve deterministic order, noise filtering and bounds`, (t) => {
    const names = [
      {
        baseName: [
          { "#text": " First name " },
          "FIRST NAME",
          { "#text": "第二名称", "@xml:lang": "zh" },
        ],
        treatmentStandardsRoutes: [null, { "#text": "Not specified" }, { "#text": "Purified" }],
        mixAndLocationTypes: [{ "#text": "At plant" }],
      },
      {
        baseName: Array.from({ length: 8 }, (_, index) => ({
          "#text": `Name${index} ${"x".repeat(300)}`,
          "@xml:lang": "en",
        })),
        treatmentStandardsRoutes: [],
        mixAndLocationTypes: [],
      },
      {
        baseName: [
          { "#text": "Not specified" },
          { "@xml:lang": "en", value: "Attribute-only name" },
          { "#text": "<null>" },
          { "#text": { value: "Non-text content" } },
        ],
        treatmentStandardsRoutes: [],
        mixAndLocationTypes: [],
      },
    ];
    const rows = buildQueries(t, type, names);
    const repeated = buildQueries(t, type, names);
    assert.deepEqual(
      rows.map((row) => row.remote_search.query),
      repeated.map((row) => row.remote_search.query),
    );
    assert.equal(
      rows[0].remote_search.query.split("\n")[0],
      `${type} name: First name; 第二名称; Purified; At plant`,
    );
    const longNames = rows[1].remote_search.query.split("\n")[0].split(": ")[1].split("; ");
    assert.equal(longNames.length, 4);
    for (const [index, value] of longNames.entries()) {
      assert.ok(value.startsWith(`Name${index} `));
      assert.ok(value.endsWith("…"));
      assert.equal(value.length, type === "flow" ? 180 : 220);
    }
    assert.doesNotMatch(rows[1].remote_search.query.split("\n")[0], /Name4 /u);
    assert.doesNotMatch(rows[2].remote_search.query, /^(?:flow|process) name:/mu);
    for (const row of rows) {
      assert.ok(row.remote_search.query.length <= 1800);
      assert.doesNotMatch(
        row.remote_search.query,
        /Not specified|<null>|Attribute-only name|Non-text content|@xml:lang/u,
      );
    }
  });
}
