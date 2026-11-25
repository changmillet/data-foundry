import assert from "node:assert/strict";
import test from "node:test";
import {
  readFoundryRepairCensus,
  type FoundryRepairCensusQuery,
  type FoundryRepairCensusPage,
} from "../../src/lib/foundry-repair-census.ts";

const actor = "22222222-2222-4222-8222-222222222222";
const publicOwner = "33333333-3333-4333-8333-333333333333";
const pid = "11111111-1111-4111-8111-111111111111";
const fid = "44444444-4444-4444-8444-444444444444";
const mid = "55555555-5555-4555-8555-555555555555";
const processDocument = {
  processDataSet: {
    value: 1,
    exchanges: {
      exchange: [{ referenceToFlowDataSet: { "@refObjectId": fid, "@version": "00.00.001" } }],
    },
  },
};
const flowDocument = {
  flowDataSet: {
    value: 2,
    modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
  },
};
const modelDocument = {
  lifeCycleModelDataSet: {
    value: 3,
    lifeCycleModelInformation: {
      dataSetInformation: {
        referenceToResultingProcess: { "@refObjectId": pid, "@version": "00.00.002" },
      },
    },
  },
};
function fixture() {
  const processes = [
    {
      id: pid,
      version: "00.00.001",
      state_code: 100,
      user_id: publicOwner,
      json: processDocument,
      model_id: null,
      model_version: null,
      team_id: null,
      review_id: null,
    },
    {
      id: pid,
      version: "00.00.002",
      state_code: 0,
      user_id: actor,
      json: processDocument,
      model_id: mid,
      model_version: "00.00.001",
      team_id: null,
      review_id: null,
    },
  ];
  const models = [
    { id: mid, version: "00.00.001", state_code: 100, user_id: publicOwner, json: modelDocument },
  ];
  const flows = [
    { id: fid, version: "00.00.001", state_code: 100, user_id: publicOwner, json: flowDocument },
  ];
  const input = {
    baseline: {
      documents: [
        ...processes.map(({ json, id, version, ...row }) => ({
          identity: { dataset_type: "process", id, version },
          document: json,
          document_sha256: "native-byte-digest",
          ...row,
        })),
        ...flows.map(({ json, id, version, ...row }) => ({
          identity: { dataset_type: "flow", id, version },
          document: json,
          document_sha256: "native-byte-digest",
          ...row,
        })),
      ],
      models: models.map(({ json, ...row }) => ({
        ...row,
        document: json,
        document_sha256: "native-byte-digest",
      })),
    },
  };
  const data: { [key: string]: Record<string, unknown>[] } = {
    processes,
    lifecyclemodels: models,
    flows,
  };
  const queries: FoundryRepairCensusQuery[] = [];
  const read = async (query: FoundryRepairCensusQuery): Promise<FoundryRepairCensusPage> => {
    queries.push(query);
    const all = (data[query.table] ?? []).filter(
      (row) =>
        (query.state === undefined || row.state_code === query.state) &&
        (query.owner === undefined || row.user_id === query.owner) &&
        (query.id === undefined || row.id === query.id) &&
        (query.ids === undefined || query.ids.includes(String(row.id))) &&
        (query.version === undefined || row.version === query.version),
    );
    const rows = all.slice(query.offset, query.offset + 1);
    return {
      status: 200,
      raw: JSON.stringify(rows),
      contentRange: all.length
        ? `${query.offset}-${query.offset + rows.length - 1}/${all.length}`
        : "*/0",
    };
  };
  return { input, data, queries, read };
}

test("repair census proves all public/owner draft versions, models and exact support in two complete passes", async () => {
  const { input, queries, read } = fixture();
  const result = await readFoundryRepairCensus(input, actor, read);
  assert.equal(result.proof.status, "verified");
  assert.equal(result.proof.process_rows, 2);
  assert.equal(result.proof.model_rows, 1);
  assert.equal(result.proof.exact_support_rows, 1);
  assert.equal(result.proof.transaction_snapshot, false);
  assert.equal(result.proof.double_scan, true);
  assert.ok(queries.some((query) => query.state === 0 && query.owner === actor));
  assert.ok(queries.every((query) => query.state !== 100 || query.owner === undefined));
});

test("exact public supporting Sources may be state 200 while numeric Flows keep their visibility predicate", async () => {
  const { input, data, read } = fixture();
  const source = { ...data.flows[0], state_code: 200 };
  data.sources = [source];
  const flow = input.baseline.documents.at(-1)!;
  input.baseline.documents.push({
    ...flow,
    identity: { ...flow.identity, dataset_type: "source" },
    state_code: 200,
  });
  assert.equal((await readFoundryRepairCensus(input, actor, read)).proof.exact_support_rows, 2);
  data.flows[0].state_code = 200;
  flow.state_code = 200;
  await assert.rejects(readFoundryRepairCensus(input, actor, read), /eligibility/u);
});

test("versionless Flow references bind the latest visible version across public and owner drafts", async () => {
  const { input, data, read } = fixture();
  const selected = {
    baseline: {
      ...input.baseline,
      omitted_flow_resolutions: [{ id: fid, version: "00.00.001" }],
    },
  };
  data.flows.push({ ...data.flows[0], version: "00.00.002", state_code: 0, user_id: publicOwner });
  assert.equal((await readFoundryRepairCensus(selected, actor, read)).proof.status, "verified");
  data.flows[1].user_id = actor;
  await assert.rejects(readFoundryRepairCensus(selected, actor, read), /latest visible Flow/u);
  data.flows[1].user_id = publicOwner;
  data.flows[1].state_code = 100;
  await assert.rejects(readFoundryRepairCensus(selected, actor, read), /latest visible Flow/u);
});

test("repair census rejects missing public candidates, foreign drafts, changed lineage and exact support drift", async () => {
  for (const mutation of ["missing", "foreign", "lineage", "support", "owner", "missing-lineage"]) {
    const { input, data, read } = fixture();
    if (mutation === "missing")
      data.processes.push({ ...data.processes[0], id: "66666666-6666-4666-8666-666666666666" });
    if (mutation === "foreign") data.processes[1].user_id = publicOwner;
    if (mutation === "lineage") data.processes[1].model_version = "00.00.002";
    if (mutation === "support") data.flows[0].json = { flowDataSet: { value: 9 } };
    if (mutation === "owner") data.processes[0].user_id = actor;
    if (mutation === "missing-lineage") delete data.processes[0].model_id;
    await assert.rejects(
      readFoundryRepairCensus(input, actor, read),
      { code: "repair_census_unproven" },
      mutation,
    );
  }
});

test("repair census rejects invalid ranges, missing pages, duplicates, count drift and between-pass changes", async () => {
  for (const mutation of ["range", "missing-page", "duplicate", "total", "second-pass"]) {
    const { input, read } = fixture();
    let pages = 0;
    const changed = async (query: FoundryRepairCensusQuery) => {
      const page = await read(query);
      pages++;
      if (query.table !== "processes" || query.state !== 100) return page;
      if (mutation === "range") return { ...page, contentRange: "1-1/1" };
      if (mutation === "missing-page") return { ...page, raw: "[]", contentRange: "*/1" };
      if (mutation === "duplicate")
        return {
          ...page,
          raw: JSON.stringify([...JSON.parse(page.raw), ...JSON.parse(page.raw)]),
          contentRange: "0-1/2",
        };
      if (mutation === "total") return { ...page, contentRange: "0-0/100001" };
      if (mutation === "second-pass" && pages > 5) {
        const rows = JSON.parse(page.raw);
        rows[0].json = { processDataSet: { value: 7 } };
        return { ...page, raw: JSON.stringify(rows) };
      }
      return page;
    };
    await assert.rejects(
      readFoundryRepairCensus(input, actor, changed),
      { code: "repair_census_unproven" },
      mutation,
    );
  }
});

test("repair census refuses an exact total that changes between otherwise valid pages", async () => {
  const { input, data, read } = fixture();
  const extra = { ...data.processes[0], id: "66666666-6666-4666-8666-666666666666" };
  data.processes.push(extra);
  const baseline = input.baseline.documents;
  baseline.push({ ...baseline[0], identity: { ...baseline[0].identity, id: extra.id } });
  await assert.rejects(
    readFoundryRepairCensus(input, actor, async (query) => {
      const page = await read(query);
      return query.table === "processes" && query.state === 100 && query.offset === 1
        ? { ...page, contentRange: "1-1/3" }
        : page;
    }),
    {
      code: "repair_census_unproven",
      message: "Repair census membership count changed during pagination.",
    },
  );
});

test("postwrite census observes only the approved overlay and rejects peer drift", async () => {
  const { input, data, read } = fixture();
  const candidate = { processDataSet: { value: 1.2 } };
  const selected = {
    ...input,
    overlays: [
      {
        identity: { dataset_type: "process", id: pid, version: "00.00.002" },
        document: candidate,
        candidate_sha256: "native-owned-candidate-hash",
      },
    ],
  };
  data.processes[1].json = candidate;
  const verified = await readFoundryRepairCensus(selected, actor, read, "after");
  assert.equal(verified.proof.observation_phase, "after");
  assert.deepEqual(input.baseline.documents[1].document, processDocument);
  data.processes[0].json = { processDataSet: { value: 9 } };
  await assert.rejects(readFoundryRepairCensus(selected, actor, read, "after"), {
    code: "repair_census_unproven",
  });
});
