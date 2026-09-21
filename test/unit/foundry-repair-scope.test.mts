import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256BatchJson, canonicalBatchJson, type BatchJsonValue } from "@tiangong-lca/cli/batch";
import {
  classifyRepairMetadataDiff,
  collectRepairChangedPaths,
  parseFoundryRepairSelection,
  readFoundryRepairScope,
} from "../../scripts/lib/foundry-repair-scope.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const projectRef = "abcdefghijklmnopqrst";
const processId = "22222222-2222-4222-8222-222222222222";
const processVersion = "01.00.000";

test("repair scope accepts the real single-reference single-language shape", () => {
  const before = {
    processDataSet: {
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          referenceToDataSource: {
            "@refObjectId": "33333333-3333-4333-8333-333333333333",
            "common:shortDescription": { "@xml:lang": "en", "#text": "Previous source title" },
          },
        },
      },
    },
  };
  const after = structuredClone(before);
  after.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.referenceToDataSource[
    "common:shortDescription"
  ]["#text"] = "Current source title";
  assert.equal(classifyRepairMetadataDiff(before, after).allowed, true);
});

test("empty-container type changes are observable and cannot masquerade as a no-op", () => {
  for (const [before, after] of [
    [null, {}],
    [{}, []],
    [[], null],
  ]) {
    const left = { processDataSet: { exchanges: before } };
    const right = { processDataSet: { exchanges: after } };
    assert.notEqual(collectRepairChangedPaths(left, right).length, 0);
    assert.equal(classifyRepairMetadataDiff(left, right).allowed, false);
  }
});

type Json = Record<string, unknown>;

/** Navigate fixture JSON without scattering assertions: both helpers assert the shape they claim. */
function recordValue(value: Json, key: string): Json {
  const entry = value[key];
  assert.equal(
    typeof entry === "object" && entry !== null && !Array.isArray(entry),
    true,
    `${key} must be a JSON object`,
  );
  return entry as Json;
}

function arrayValue(value: Json, key: string): Json[] {
  const entry = value[key];
  assert.equal(Array.isArray(entry), true, `${key} must be a JSON array`);
  return entry as Json[];
}

function languageNodes(values: readonly [string, string][]): Json[] {
  return values.map(([lang, text]) => ({ "@xml:lang": lang, "#text": text }));
}

function processPayload(overrides: { source?: string; ownership?: string } = {}): Json {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": processId,
          name: { baseName: languageNodes([["en", "Steel production"]]) },
          classificationInformation: {
            "common:classification": { "common:class": [{ "@classId": "1", "#text": "Metals" }] },
          },
        },
        geography: { locationOfOperationSupplyOrProduction: { "@location": "CN" } },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          annualSupplyOrProductionVolume: [],
          referenceToDataSource: [
            {
              "@dataSetInternalID": "1",
              "common:shortDescription": languageNodes([
                ["en", "Original source"],
                ["zh", "原始来源"],
              ]),
            },
          ],
        },
      },
      administrativeInformation: {
        publicationAndOwnership: {
          "common:dataSetVersion": processVersion,
          "common:referenceToOwnershipOfDataSet": [
            {
              "@dataSetInternalID": "2",
              "common:shortDescription": languageNodes([["en", overrides.ownership ?? "Owner A"]]),
            },
          ],
        },
      },
      exchanges: {
        exchange: [{ "@dataSetInternalID": "3", meanAmount: "1.5", resultingAmount: "1.5" }],
      },
    },
  };
}

function sourceRegion(payload: Json): Json[] {
  const dataSources = ((payload.processDataSet as Json).modellingAndValidation as Json)
    .dataSourcesTreatmentAndRepresentativeness as Json;
  return dataSources.referenceToDataSource as Json[];
}

function sourceNode(payload: Json): Json {
  return sourceRegion(payload)[0];
}

function description(node: Json): Json[] {
  return arrayValue(node, "common:shortDescription");
}

function setEnglishText(nodes: Json[], text: string): void {
  const entry = nodes.find((candidate) => candidate["@xml:lang"] === "en");
  assert.ok(entry, "the fixture must carry an English node");
  entry["#text"] = text;
}

function scopeFixture(): { dir: string; contract: Json; before: Json; candidate: Json } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-repair-scope-"));
  const before = processPayload();
  const candidate = structuredClone(before);
  setEnglishText(description(sourceNode(candidate)), "Renamed source");
  const contract: Json = {
    schema_version: "dataset-save-draft-execution-contract.v1",
    execution_id: "exec-repair-1",
    project_ref: projectRef,
    target_mode: "owner_draft",
    owner: { user_id: ownerId, email: "owner@example.com", state_code: 0 },
    actions: [
      {
        action_id: "repair-1",
        desired_sha256: sha256Json(candidate),
        expected_operation: "save_draft",
        table: "processes",
        id: processId,
        version: processVersion,
        before_sha256: sha256Json(before),
        dependency_action_ids: [],
      },
    ],
  };
  return { dir, contract, before, candidate };
}

function writeScope(dir: string, fixture: { contract: Json; before: Json; candidate: Json }) {
  const contractFile = path.join(dir, "contract.json");
  const beforeFile = path.join(dir, "before.jsonl");
  const candidateFile = path.join(dir, "candidate.jsonl");
  fs.writeFileSync(contractFile, `${JSON.stringify(fixture.contract, null, 2)}\n`);
  fs.writeFileSync(beforeFile, `${JSON.stringify(fixture.before)}\n`);
  fs.writeFileSync(candidateFile, `${JSON.stringify(fixture.candidate)}\n`);
  return { contractFile, beforeFile, candidateFile };
}

function readScope(files: {
  contractFile: string;
  beforeFile: string;
  candidateFile: string;
  datasetType?: string;
}) {
  return readFoundryRepairScope({
    contractFile: files.contractFile,
    beforeFile: files.beforeFile,
    candidateFile: files.candidateFile,
    datasetType: files.datasetType ?? "process",
    targetUserId: ownerId,
    verifiedProjectRef: projectRef,
    stateCode: "0",
    relativePath: (file) => file,
  });
}

test("repair metadata diff admits only existing language-node #text edits", () => {
  const before = processPayload();
  const sourceEdit = structuredClone(before);
  setEnglishText(description(sourceNode(sourceEdit)), "Renamed source");
  assert.equal(classifyRepairMetadataDiff(before, sourceEdit).allowed, true);

  const ownershipEdit = structuredClone(before);
  const ownership = recordValue(
    recordValue(recordValue(ownershipEdit, "processDataSet"), "administrativeInformation"),
    "publicationAndOwnership",
  );
  setEnglishText(
    description(arrayValue(ownership, "common:referenceToOwnershipOfDataSet")[0]),
    "Owner B",
  );
  assert.equal(classifyRepairMetadataDiff(before, ownershipEdit).allowed, true);
  assert.deepEqual(collectRepairChangedPaths(before, ownershipEdit), [
    "processDataSet.administrativeInformation.publicationAndOwnership" +
      ".common:referenceToOwnershipOfDataSet.0.common:shortDescription.0.#text",
  ]);

  const noChange = classifyRepairMetadataDiff(before, structuredClone(before));
  assert.equal(noChange.allowed, true);
  assert.deepEqual(noChange.blockers, []);
});

test("repair metadata diff blocks node, language, identity and order changes", () => {
  const before = processPayload();

  const addedNode = structuredClone(before);
  description(sourceNode(addedNode)).push({ "@xml:lang": "de", "#text": "Neu" });
  assert.equal(classifyRepairMetadataDiff(before, addedNode).allowed, false);

  const removedNode = structuredClone(before);
  description(sourceNode(removedNode)).pop();
  assert.equal(classifyRepairMetadataDiff(before, removedNode).allowed, false);

  const retagged = structuredClone(before);
  description(sourceNode(retagged))[0]["@xml:lang"] = "fr";
  assert.equal(classifyRepairMetadataDiff(before, retagged).allowed, false);

  const reidentified = structuredClone(before);
  sourceNode(reidentified)["@dataSetInternalID"] = "9";
  assert.equal(classifyRepairMetadataDiff(before, reidentified).allowed, false);

  const reordered = structuredClone(before);
  const nodes = description(sourceNode(reordered));
  sourceNode(reordered)["common:shortDescription"] = [nodes[1], nodes[0]];
  assert.equal(classifyRepairMetadataDiff(before, reordered).allowed, false);
});

test("repair metadata diff blocks every scientific and provider-impact surface", () => {
  const before = processPayload();
  const mutations: Array<[string, (payload: Json) => void, string]> = [
    [
      "exchange amount",
      (payload) => {
        const exchange = recordValue(recordValue(payload, "processDataSet"), "exchanges");
        arrayValue(exchange, "exchange")[0].meanAmount = "2.5";
      },
      "provider_impact_diagnostics_missing",
    ],
    [
      "annual volume",
      (payload) => {
        const dataSources = ((payload.processDataSet as Json).modellingAndValidation as Json)
          .dataSourcesTreatmentAndRepresentativeness as Json;
        dataSources.annualSupplyOrProductionVolume = languageNodes([["en", "3.6 MJ/year"]]);
      },
      "provider_impact_diagnostics_missing",
    ],
    [
      "name",
      (payload) => {
        const info = ((payload.processDataSet as Json).processInformation as Json)
          .dataSetInformation as Json;
        info.name = { baseName: languageNodes([["en", "Other name"]]) };
      },
      "provider_impact_diagnostics_missing",
    ],
    [
      "classification",
      (payload) => {
        const info = ((payload.processDataSet as Json).processInformation as Json)
          .dataSetInformation as Json;
        (info.classificationInformation as Json)["common:classification"] = {
          "common:class": [{ "@classId": "2", "#text": "Plastics" }],
        };
      },
      "provider_impact_diagnostics_missing",
    ],
    [
      "geography",
      (payload) => {
        const processInformation = (payload.processDataSet as Json).processInformation as Json;
        (processInformation.geography as Json).locationOfOperationSupplyOrProduction = {
          "@location": "DE",
        };
      },
      "provider_impact_diagnostics_missing",
    ],
    [
      "version",
      (payload) => {
        const ownership = ((payload.processDataSet as Json).administrativeInformation as Json)
          .publicationAndOwnership as Json;
        ownership["common:dataSetVersion"] = "01.00.001";
      },
      "provider_impact_diagnostics_missing",
    ],
    [
      "unrelated administrative text",
      (payload) => {
        const processInformation = (payload.processDataSet as Json).processInformation as Json;
        (processInformation.dataSetInformation as Json)["common:other"] = { note: "changed" };
      },
      "provider_impact_diagnostics_missing",
    ],
  ];
  for (const [label, mutate, reason] of mutations) {
    const after = structuredClone(before);
    mutate(after);
    const verdict = classifyRepairMetadataDiff(before, after);
    assert.equal(verdict.allowed, false, `${label} must block`);
    assert.equal(verdict.blockers[0]?.reason, reason, `${label} blocker reason`);
  }
});

test("repair selection parsing enforces three selected sources and predecessor binding", () => {
  const sources = [
    { path: "inputs/contract.json" },
    { path: "inputs/before.jsonl" },
    { path: "inputs/candidate.jsonl" },
  ];
  const selection = {
    kind: "existing-owner-draft-metadata",
    contract: "inputs/contract.json",
    before: "inputs/before.jsonl",
    candidate: "inputs/candidate.jsonl",
    predecessor: null,
  };
  assert.equal(parseFoundryRepairSelection(selection, sources).predecessor, null);
  assert.throws(() =>
    parseFoundryRepairSelection({ ...selection, before: "inputs/other.jsonl" }, sources),
  );
  assert.throws(() =>
    parseFoundryRepairSelection({ ...selection, contract: "inputs/before.jsonl" }, sources),
  );
  assert.throws(() => parseFoundryRepairSelection({ ...selection, unexpected: true }, sources));
  assert.throws(() =>
    parseFoundryRepairSelection(
      { ...selection, predecessor: { task_id: "t", receipt_sha256: "short" } },
      sources,
    ),
  );
});

test("repair scope dispatches an allowlisted metadata repair of the exact draft", () => {
  const fixture = scopeFixture();
  const files = writeScope(fixture.dir, fixture);
  const scope = readScope(files);
  assert.equal(scope.status, "dispatchable");
  assert.equal(scope.actions.length, 1);
  assert.equal(scope.actions[0]?.id, processId);
  assert.equal(scope.actions[0]?.version, processVersion);
  assert.equal(scope.actions[0]?.table, "processes");
  assert.match(scope.contract_sha256, /^[0-9a-f]{64}$/u);
  // Repeated preparation of the same three sources is stable.
  assert.deepEqual(readScope(files), scope);
});

test("repair scope records a local no-op without any dispatchable change", () => {
  const fixture = scopeFixture();
  const identical = structuredClone(fixture.before);
  const contract = structuredClone(fixture.contract);
  arrayValue(contract, "actions")[0].desired_sha256 = sha256Json(identical);
  const files = writeScope(fixture.dir, { ...fixture, candidate: identical, contract });
  const scope = readScope(files);
  assert.equal(scope.status, "satisfied");
  assert.deepEqual(scope.changed_paths, []);
  // A local no-op verdict never claims remote completion; the caller must not treat it as a write.
  assert.equal(Object.hasOwn(scope, "remote_verified"), false);
});

test("repair scope rejects wrong before content, minted identities and insert actions", () => {
  const fixture = scopeFixture();
  const wrongBefore = structuredClone(fixture.contract);
  arrayValue(wrongBefore, "actions")[0].before_sha256 = "f".repeat(64);
  assert.throws(
    () => readScope(writeScope(fixture.dir, { ...fixture, contract: wrongBefore })),
    (error: unknown) => (error as { code?: string }).code === "repair_before_content_mismatch",
  );

  const insertContract = structuredClone(fixture.contract);
  const insertAction = arrayValue(insertContract, "actions")[0];
  insertAction.expected_operation = "insert";
  insertAction.before_sha256 = null;
  assert.throws(
    () => readScope(writeScope(fixture.dir, { ...fixture, contract: insertContract })),
    (error: unknown) => (error as { code?: string }).code === "repair_insert_not_allowed",
  );

  // A minted version can never satisfy the repair scope: the before rows stay at the current version.
  const minted = structuredClone(fixture.candidate);
  recordValue(
    recordValue(recordValue(minted, "processDataSet"), "administrativeInformation"),
    "publicationAndOwnership",
  )["common:dataSetVersion"] = "02.00.000";
  const mintedContract = structuredClone(fixture.contract);
  const mintedAction = arrayValue(mintedContract, "actions")[0];
  mintedAction.desired_sha256 = sha256Json(minted);
  mintedAction.version = "02.00.000";
  assert.throws(
    () =>
      readScope(
        writeScope(fixture.dir, { ...fixture, contract: mintedContract, candidate: minted }),
      ),
    (error: unknown) => (error as { code?: string }).code === "repair_scope_identity_mismatch",
  );

  const extraBefore = `${JSON.stringify(fixture.before)}\n${JSON.stringify(
    structuredClone(fixture.before),
  )}\n`;
  const files = writeScope(fixture.dir, fixture);
  fs.writeFileSync(files.beforeFile, extraBefore);
  assert.throws(
    () => readScope(files),
    (error: unknown) =>
      ["repair_scope_identity_mismatch", "repair_insert_not_allowed"].includes(
        (error as { code?: string }).code ?? "",
      ),
  );
});

test("repair scope blocks scientific diffs and non-Process dataset types", () => {
  const fixture = scopeFixture();
  const scientific = structuredClone(fixture.candidate);
  const scientificRoot = recordValue(recordValue(scientific, "processDataSet"), "exchanges");
  const exchange = arrayValue(scientificRoot, "exchange");
  exchange[0].meanAmount = "9.9";
  const contract = structuredClone(fixture.contract);
  arrayValue(contract, "actions")[0].desired_sha256 = sha256Json(scientific);
  assert.throws(
    () => readScope(writeScope(fixture.dir, { ...fixture, contract, candidate: scientific })),
    (error: unknown) =>
      (error as { code?: string }).code === "repair_provider_impact_diagnostics_missing",
  );

  const unsupported = structuredClone(fixture.candidate);
  const dataSources = recordValue(
    recordValue(recordValue(unsupported, "processDataSet"), "modellingAndValidation"),
    "dataSourcesTreatmentAndRepresentativeness",
  );
  dataSources["common:other"] = { text: "x" };
  const contract2 = structuredClone(fixture.contract);
  const contract2Actions = arrayValue(contract2, "actions");
  contract2Actions[0].desired_sha256 = sha256Json(unsupported);
  assert.throws(
    () =>
      readScope(
        writeScope(fixture.dir, { ...fixture, contract: contract2, candidate: unsupported }),
      ),
    (error: unknown) =>
      ["repair_metadata_scope_blocked", "repair_provider_impact_diagnostics_missing"].includes(
        (error as { code?: string }).code ?? "",
      ),
  );

  const files = writeScope(fixture.dir, fixture);
  assert.throws(
    () => readScope({ ...files, datasetType: "flow" }),
    (error: unknown) => (error as { code?: string }).code === "repair_scope_unsupported",
  );
});

test("canonical payload hashing matches the installed public CLI batch contract", () => {
  const fixtures: unknown[] = [
    processPayload(),
    { b: 1, a: [3, 2, 1], c: { z: null, y: true, x: "中文测试" } },
    { nested: { deep: { deeper: [{ k: 1.5 }, { k: -0 }, { k: 1e21 }] } } },
    { empty: {}, list: [], text: "", zero: 0, neg: -1.25 },
    { unicode: "Ω≈ç√∫˜µ≤≥÷", escaped: 'quote " backslash \\ newline \n' },
  ];
  for (const [index, value] of fixtures.entries()) {
    assert.equal(
      sha256Json(value as never),
      sha256BatchJson(value as BatchJsonValue),
      `sha256Json parity for fixture ${index}`,
    );
  }
  const payload = processPayload();
  assert.equal(sha256Json(payload), sha256BatchJson(payload as BatchJsonValue));
  assert.equal(canonicalBatchJson({ b: 1, a: 2 }), canonicalBatchJson({ a: 2, b: 1 }));
});

test("candidate bytes cannot change between native contract admission and metadata diff", (t) => {
  const fixture = scopeFixture();
  t.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const files = writeScope(fixture.dir, fixture);
  const read = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === files.candidateFile && ++reads === 2)
      return JSON.stringify(fixture.before) + "\n";
    return read(...args);
  });
  assert.throws(() => readScope(files), /Candidate bytes changed/u);
});
