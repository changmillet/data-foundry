import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import {
  readFoundryRepairCensus,
  type FoundryRepairCensusQuery,
} from "../../scripts/lib/foundry-repair-census.ts";

type Row = Record<string, unknown>;
const actor = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const revision = "00.00.001";
const id = (prefix: string, value: number) =>
  `${prefix}-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const rootId = id("11110000", 1),
  peerId = id("11110000", 2);
const product = id("44440000", 1),
  elementary = id("44440000", 2);
const ref = (flow: string, version: string | null = revision) => ({
  "@refObjectId": flow,
  ...(version === null ? {} : { "@version": version }),
});
function processRow(pid: string, flows: string[]): Row {
  return {
    id: pid,
    version: revision,
    user_id: owner,
    state_code: 100,
    model_id: null,
    model_version: null,
    team_id: null,
    review_id: null,
    json: {
      processDataSet: {
        private_prose: "PRIVATE_NONSELECTED_BODY",
        exchanges: {
          exchange: flows.map((flow) => ({
            referenceToFlowDataSet: ref(flow),
            private_comment: "PRIVATE_EXCHANGE_COMMENT",
          })),
        },
      },
    },
  };
}
function flowRow(fid: string, type: string): Row {
  return {
    id: fid,
    version: revision,
    user_id: owner,
    state_code: 100,
    json: { flowDataSet: { modellingAndValidation: { LCIMethod: { typeOfDataSet: type } } } },
  };
}
function selected(row: Row, dataset_type: string): Row {
  const { id, version, json, ...metadata } = row;
  return {
    identity: { dataset_type, id, version },
    document: json,
    document_sha256: "checked-by-native-owner",
    ...metadata,
  };
}
function fixture(total = 2) {
  const processes = [
    processRow(rootId, [product, elementary]),
    processRow(peerId, [product, elementary]),
  ];
  for (let index = 0; index < total - 2; index++)
    processes.push(processRow(id("aaaa0000", index), [id("bbbb0000", index), elementary]));
  const flows = [flowRow(product, "Product flow"), flowRow(elementary, "Elementary flow")];
  const data: Record<string, Row[]> = { processes, lifecyclemodels: [], flows };
  const input: Row = {
    baseline: {
      documents: [
        selected(processes[0], "process"),
        selected(processes[1], "process"),
        ...flows.map((row) => selected(row, "flow")),
      ],
      models: [],
      omitted_flow_resolutions: [],
    },
    overlays: [],
  };
  const queries: FoundryRepairCensusQuery[] = [];
  let hook = (_query: FoundryRepairCensusQuery) => {};
  const read = async (query: FoundryRepairCensusQuery) => {
    queries.push(query);
    hook(query);
    const all = (data[query.table] ?? [])
      .filter(
        (row) =>
          (query.state === undefined || row.state_code === query.state) &&
          (query.owner === undefined || row.user_id === query.owner) &&
          (query.id === undefined || row.id === query.id) &&
          (query.ids === undefined || query.ids.includes(String(row.id))) &&
          (query.version === undefined || row.version === query.version),
      )
      .sort((left, right) =>
        `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`, "en"),
      );
    const rows = all.slice(query.offset, query.offset + query.limit).map((row) => {
      if (!query.projection) return row;
      const { json, ...metadata } = row;
      const document = json as Row;
      if (query.table === "processes")
        return {
          ...metadata,
          exchanges: ((document.processDataSet as Row).exchanges as Row)?.exchange ?? null,
        };
      if (query.table === "flows")
        return {
          ...metadata,
          declared_type: (
            ((document.flowDataSet as Row).modellingAndValidation as Row).LCIMethod as Row
          ).typeOfDataSet,
        };
      const info = (document.lifeCycleModelDataSet as Row).lifeCycleModelInformation as Row;
      return {
        ...metadata,
        result_process: (info.dataSetInformation as Row)?.referenceToResultingProcess ?? null,
        process_instances: ((info.technology as Row)?.processes as Row)?.processInstance ?? null,
      };
    });
    return {
      status: 200,
      raw: JSON.stringify(rows),
      contentRange: all.length
        ? `${query.offset}-${query.offset + rows.length - 1}/${all.length}`
        : "*/0",
    };
  };
  return {
    input,
    data,
    queries,
    read,
    setHook(value: typeof hook) {
      hook = value;
    },
  };
}

test("17573-row directory admits an exact two-Process family and retains compact evidence", async (t) => {
  const f = fixture(17_573);
  const started = performance.now();
  const result = await readFoundryRepairCensus(f.input, actor, f.read);
  assert.equal(result.proof.directory_process_rows, 17_573);
  assert.equal(result.proof.process_rows, 2);
  assert.equal(result.proof.exact_support_rows, 2);
  assert.equal(result.proof.body_scope, "closed_conservative_family");
  assert.equal(result.proof.directory_complete, true);
  assert.equal(result.proof.transaction_snapshot, false);
  assert.ok(
    f.queries
      .filter((q) => !q.projection && q.table === "processes")
      .every((q) => q.ids?.length === 2),
  );
  const directoryEvidence = result.observations.filter((o) => o.query.projection);
  assert.ok(directoryEvidence.length > 350);
  assert.ok(
    directoryEvidence.every(
      (o) =>
        !o.page.raw.includes("PRIVATE_NONSELECTED_BODY") &&
        !o.page.raw.includes("PRIVATE_EXCHANGE_COMMENT"),
    ),
  );
  t.diagnostic(
    JSON.stringify({
      observation_schema: "tiangong-foundry.family-scale-observation.v1",
      synthetic: true,
      total_process_rows: 17_573,
      frozen_process_rows: result.proof.process_rows,
      missing_unrelated_dependencies: 17_571,
      milliseconds: performance.now() - started,
      max_rss_kib: process.resourceUsage().maxRSS,
      ...result.proof,
    }),
  );
});

test("a connected peer and a newly referenced overlay neighbor cannot be omitted", async () => {
  for (const variant of ["peer", "overlay", "other"]) {
    const f = fixture(3);
    const baseline = f.input.baseline as Row;
    if (variant === "peer") (baseline.documents as Row[]).splice(1, 1);
    if (variant === "other") {
      (f.data.flows[1].json as Row).flowDataSet = {
        modellingAndValidation: { LCIMethod: { typeOfDataSet: "Other flow" } },
      };
      (baseline.documents as Row[])[3] = selected(f.data.flows[1], "flow");
    }
    if (variant === "overlay") {
      const candidate = processRow(rootId, [id("bbbb0000", 0)]).json;
      f.input.overlays = [
        {
          identity: { dataset_type: "process", id: rootId, version: revision },
          document: candidate,
        },
      ];
    }
    await assert.rejects(
      readFoundryRepairCensus(f.input, actor, f.read),
      { code: "repair_census_unproven" },
      variant,
    );
  }
});

test("historical Process and Model revisions participate in conservative family membership", async () => {
  const f = fixture(3);
  const outside = f.data.processes[2];
  const historical = { ...outside, version: "00.00.000" };
  f.data.processes.push(historical);
  const modelId = id("55550000", 1);
  const model = (version: string): Row => ({
    id: modelId,
    version,
    user_id: owner,
    state_code: 100,
    json: {
      lifeCycleModelDataSet: {
        lifeCycleModelInformation: {
          dataSetInformation: { referenceToResultingProcess: ref(rootId) },
          technology: {
            processes: { processInstance: [{ referenceToProcess: ref(String(outside.id)) }] },
          },
        },
      },
    },
  });
  f.data.lifecyclemodels = [model("00.00.000"), model(revision)];
  const baseline = f.input.baseline as Row;
  (baseline.documents as Row[]).push(selected(outside, "process"), selected(historical, "process"));
  baseline.models = f.data.lifecyclemodels.map((row) => {
    const { json, ...metadata } = row;
    return { ...metadata, document: json, document_sha256: "native" };
  });
  assert.equal((await readFoundryRepairCensus(f.input, actor, f.read)).proof.process_rows, 4);
  (baseline.documents as Row[]).pop();
  await assert.rejects(readFoundryRepairCensus(f.input, actor, f.read), /historical revision/u);
  (baseline.documents as Row[]).push(selected(historical, "process"));
  (baseline.models as Row[]).shift();
  await assert.rejects(readFoundryRepairCensus(f.input, actor, f.read), /historical revision/u);
});

test("projection changes, missing aliases and exact nonselected-revision drift fail closed", async () => {
  for (const variant of ["new-edge", "flow-type", "family-body", "historical"]) {
    const f = fixture(3);
    let passes = 0,
      exactPasses = 0;
    if (variant === "historical") {
      const historical = { ...f.data.processes[0], version: "00.00.000" };
      f.data.processes.push(historical);
      ((f.input.baseline as Row).documents as Row[]).push(selected(historical, "process"));
    }
    f.setHook((query) => {
      if (
        query.projection &&
        query.table === "processes" &&
        query.state === 100 &&
        query.offset === 0
      )
        passes++;
      if (!query.projection && query.table === "processes" && query.state === 100) exactPasses++;
      if (variant === "new-edge" && passes === 2)
        f.data.processes[2].json = processRow(String(f.data.processes[2].id), [product]).json;
      if (variant === "flow-type" && passes === 2)
        f.data.flows[1].json = flowRow(elementary, "Product flow").json;
      if (variant === "family-body" && exactPasses === 2)
        f.data.processes[1].json = { processDataSet: { changed: "scientific content" } };
      if (variant === "historical" && exactPasses === 2)
        f.data.processes.at(-1)!.json = { processDataSet: { changed: "historical content" } };
    });
    await assert.rejects(
      readFoundryRepairCensus(f.input, actor, f.read),
      { code: "repair_census_unproven" },
      variant,
    );
  }
  const f = fixture();
  await assert.rejects(
    readFoundryRepairCensus(f.input, actor, async (query) => {
      const page = await f.read(query);
      if (!query.projection || query.table !== "processes") return page;
      const rows = JSON.parse(page.raw) as Row[];
      for (const row of rows) delete row.exchanges;
      return { ...page, raw: JSON.stringify(rows) };
    }),
    { code: "repair_census_unproven" },
  );
});

test("an omitted Flow's nonselected visible revision cannot change between directory passes", async () => {
  const f = fixture();
  const baseline = f.input.baseline as Row;
  baseline.omitted_flow_resolutions = [{ id: product, version: revision }];
  let flowPasses = 0;
  f.setHook((query) => {
    if (query.projection && query.table === "flows" && query.state === 100 && query.offset === 0) {
      flowPasses++;
      if (flowPasses === 2) f.data.flows.push({ ...f.data.flows[0], version: "00.00.002" });
    }
  });
  await assert.rejects(readFoundryRepairCensus(f.input, actor, f.read), {
    code: "repair_census_unproven",
  });
});

test("omitted nullable Worker row metadata remains compatible and real lineage still binds", async () => {
  const f = fixture();
  const documents = (f.input.baseline as Row).documents as Row[];
  f.data.processes[0].user_id = actor;
  f.data.processes[0].state_code = 0;
  documents[0].user_id = actor;
  documents[0].state_code = 0;
  for (const item of documents.filter((item) => (item.identity as Row).dataset_type === "process"))
    for (const key of ["model_id", "model_version", "team_id", "review_id"]) delete item[key];
  f.input.overlays = [
    {
      identity: { dataset_type: "process", id: rootId, version: revision },
      document: f.data.processes[0].json,
    },
  ];
  assert.equal((await readFoundryRepairCensus(f.input, actor, f.read)).proof.process_rows, 2);
  f.data.processes[0].model_version = "00.00.002";
  await assert.rejects(
    readFoundryRepairCensus(f.input, actor, f.read),
    /lineage or collaboration metadata/u,
  );
});

test("public null owners may use omitted Worker Option fields but real owner drift is rejected", async () => {
  const f = fixture();
  const baseline = f.input.baseline as Row;
  const documents = baseline.documents as Row[];
  f.data.processes[1].user_id = null;
  delete documents[1].user_id;
  f.data.flows[0].user_id = null;
  delete documents[2].user_id;
  const modelId = id("55550000", 5);
  const document = {
    lifeCycleModelDataSet: {
      lifeCycleModelInformation: {
        dataSetInformation: { referenceToResultingProcess: ref(rootId) },
      },
    },
  };
  f.data.lifecyclemodels = [
    { id: modelId, version: revision, user_id: null, state_code: 100, json: document },
  ];
  baseline.models = [
    { id: modelId, version: revision, state_code: 100, document, document_sha256: "native" },
  ];
  assert.equal((await readFoundryRepairCensus(f.input, actor, f.read)).proof.model_rows, 1);
  for (const row of [f.data.processes[1], f.data.flows[0], f.data.lifecyclemodels[0]]) {
    row.user_id = owner;
    await assert.rejects(readFoundryRepairCensus(f.input, actor, f.read), {
      code: "repair_census_unproven",
    });
    row.user_id = null;
  }
});

test("nested Model reference identities cannot conceal a connected family member", async () => {
  const f = fixture(3);
  const modelId = id("55550000", 6);
  f.data.lifecyclemodels = [
    {
      id: modelId,
      version: revision,
      user_id: owner,
      state_code: 100,
      json: {
        lifeCycleModelDataSet: {
          lifeCycleModelInformation: {
            dataSetInformation: {
              referenceToResultingProcess: {
                ...ref(rootId),
                nested: ref(String(f.data.processes[2].id)),
              },
            },
          },
        },
      },
    },
  ];
  await assert.rejects(readFoundryRepairCensus(f.input, actor, f.read), {
    code: "repair_census_unproven",
  });
});
