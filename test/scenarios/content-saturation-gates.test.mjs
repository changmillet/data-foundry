import test from "node:test";
import { locationCodeFromOperation } from "../../scripts/lib/import-curation/internal/workflow-patch-evidence.mjs";
import {
  assert,
  fs,
  path,
  readJson,
  rel,
  repoRoot,
  runFoundry,
  writeJson,
  writeJsonLines,
} from "../fixtures/foundry-core.mjs";
import { writeContextPackFiles } from "../fixtures/full-context-fixtures.mjs";

const fixtureRoot = path.join(repoRoot, "tmp", "content-saturation-gates-test");

function ml(text, lang = "en") {
  return { "@xml:lang": lang, "#text": text };
}

function sourceTrace(payload) {
  return {
    "@xmlns:tidasimport": "https://tiangong.earth/tidas/import-trace/1.0",
    "tidasimport:sourceTrace": {
      "@marker": "TIDAS_IMPORT_TRACE_V1",
      payload,
    },
  };
}

function classification() {
  return {
    "common:classification": {
      "common:class": [{ "@level": "0", "@classId": "D", "#text": "Energy" }],
    },
  };
}

function writeGateInputs(root, datasetType, rows) {
  fs.rmSync(root, { recursive: true, force: true });
  const context = writeContextPackFiles(root);
  const rowsFile = path.join(root, "rows.jsonl");
  const schemaReport = path.join(root, "schema-report.json");
  const qaReport = path.join(root, "qa-report.json");
  writeJsonLines(rowsFile, rows);
  writeJson(schemaReport, {
    status: "completed",
    rows: rows.map((row) => {
      const payload =
        row.processDataSet ?? row.flowDataSet ?? row.sourceDataSet ?? row.contactDataSet;
      const info =
        payload?.processInformation?.dataSetInformation ??
        payload?.flowInformation?.dataSetInformation ??
        payload?.sourceInformation?.dataSetInformation ??
        payload?.contactInformation?.dataSetInformation;
      return {
        id: info?.["common:UUID"],
        status: "valid",
        issues: [],
      };
    }),
  });
  writeJson(qaReport, {
    status: "completed",
    findings: [],
    blockers: [],
  });
  return { ...context, rowsFile, schemaReport, qaReport, datasetType };
}

function runGate(input) {
  const result = runFoundry([
    "dataset-curation-gate",
    "--type",
    input.datasetType,
    "--profile",
    "bafu",
    "--rows-file",
    rel(input.rowsFile),
    "--schema-report",
    rel(input.schemaReport),
    "--qa-report",
    rel(input.qaReport),
    "--schema-file",
    rel(input.schemaFile),
    "--yaml-file",
    rel(input.yamlFile),
    "--ruleset-file",
    rel(input.rulesetFile),
    "--out-dir",
    rel(path.join(path.dirname(input.rowsFile), "curation-gate")),
  ]);
  assert.equal(result.code, 1);
  return result.json;
}

function actionCodesFor(report) {
  const packagePath = path.join(repoRoot, report.entities[0].authoring_package);
  return readJson(packagePath).action_items.map((item) => item.code);
}

test("BAFU process curation gate blocks when source-backed content fields are not saturated", () => {
  const processId = "aaaaaaaa-1111-4222-8333-444444444444";
  const input = writeGateInputs(path.join(fixtureRoot, "process"), "process", [
    {
      processDataSet: {
        processInformation: {
          dataSetInformation: {
            "common:UUID": processId,
            name: { baseName: ml("Electricity, lignite, at power plant") },
            classificationInformation: classification(),
            "common:other": sourceTrace({
              referenceFunction: {
                name: "referenceFunction",
                attributes: [{ name: "localName", value: "Strom, ab Braunkohlekraftwerk" }],
              },
              dataSetInformation: {
                name: "dataSetInformation",
                attributes: [{ name: "localLanguageCode", value: "de" }],
              },
              representativeness: {
                name: "representativeness",
                attributes: [
                  { name: "percent", value: "100.0" },
                  { name: "uncertaintyAdjustments", value: "none" },
                ],
              },
            }),
          },
        },
        modellingAndValidation: {
          dataSourcesTreatmentAndRepresentativeness: {},
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);

  const report = runGate(input);

  assert.equal(report.status, "blocked_needs_foundry_ai_authoring");
  const codes = actionCodesFor(report);
  assert.equal(codes.includes("semantic_content_saturation_process_synonyms_missing"), true);
  assert.equal(codes.includes("semantic_content_saturation_process_percentage_missing"), true);
  assert.equal(
    codes.includes("semantic_content_saturation_process_uncertainty_adjustments_missing"),
    true,
  );
});

test("BAFU flow curation gate blocks when source-backed flow descriptors are not saturated", () => {
  const flowId = "bbbbbbbb-1111-4222-8333-444444444444";
  const input = writeGateInputs(path.join(fixtureRoot, "flow"), "flow", [
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:UUID": flowId,
            name: { baseName: ml("Lignite, burned in power plant") },
            classificationInformation: classification(),
            "common:other": sourceTrace({
              exchange: {
                name: "exchange",
                attributes: [
                  { name: "location", value: "DE" },
                  {
                    name: "generalComment",
                    value: "Calculated from IEA Extended World Energy Balances for 2019.",
                  },
                ],
              },
            }),
          },
        },
        modellingAndValidation: {
          LCIMethod: { typeOfDataSet: "Product flow" },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
        flowProperties: {
          flowProperty: {
            referenceToFlowPropertyDataSet: {
              "common:shortDescription": ml("Net calorific value"),
            },
          },
        },
      },
    },
  ]);

  const report = runGate(input);

  assert.equal(report.status, "blocked_needs_foundry_ai_authoring");
  const codes = actionCodesFor(report);
  assert.equal(codes.includes("semantic_content_saturation_flow_location_of_supply_missing"), true);
  assert.equal(
    codes.includes("semantic_content_saturation_flow_quantitative_properties_missing"),
    true,
  );
  assert.equal(codes.includes("semantic_content_saturation_flow_general_comment_missing"), true);
});

test("BAFU support curation gate blocks incomplete source bibliographic descriptions", () => {
  const sourceId = "cccccccc-1111-4222-8333-444444444444";
  const input = writeGateInputs(path.join(fixtureRoot, "support-source"), "support", [
    {
      sourceDataSet: {
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": sourceId,
            "common:shortName": ml("2023 - LCI solid fossil fuel - Itten"),
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "5",
                  "#text": "Publications and communications",
                },
              },
            },
            sourceCitation: "Itten R., 2023 - LCI solid fossil fuel - Itten, 2023",
            sourceDescriptionOrComment: ml("Report"),
            "common:other": sourceTrace({
              source: {
                name: "source",
                attributes: [
                  { name: "firstAuthor", value: "Itten R." },
                  { name: "additionalAuthors", value: "Oberschelp C., Kroehnert H., Stucki M." },
                  { name: "year", value: "2023" },
                  { name: "title", value: "2023 - LCI solid fossil fuel - Itten" },
                  { name: "titleOfAnthology", value: "Project report" },
                  { name: "placeOfPublications", value: "Waedenswil, CH" },
                  { name: "publisher", value: "ZHAW" },
                ],
              },
            }),
          },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);

  const report = runGate(input);

  assert.equal(report.status, "blocked_needs_foundry_ai_authoring");
  const codes = actionCodesFor(report);
  assert.equal(codes.includes("semantic_content_saturation_source_description_incomplete"), true);
});

test("BAFU contact curation gate blocks incomplete official contact fields", () => {
  const contactId = "dddddddd-1111-4222-8333-444444444444";
  const input = writeGateInputs(path.join(fixtureRoot, "contact"), "contact", [
    {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: {
            "common:UUID": contactId,
            "common:shortName": ml("BAFU"),
            "common:name": ml("Federal Office for the Environment FOEN"),
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "1",
                  "#text": "Organisations",
                },
              },
            },
          },
        },
        administrativeInformation: {
          publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
        },
      },
    },
  ]);

  const report = runGate(input);

  assert.equal(report.status, "blocked_needs_foundry_ai_authoring");
  const codes = actionCodesFor(report);
  assert.equal(codes.includes("semantic_content_saturation_bafu_contact_incomplete"), true);
});

test("location decision patch validation accepts locationOfSupply multilingual code text", () => {
  assert.equal(
    locationCodeFromOperation({
      value: {
        "@xml:lang": "en",
        "#text": "DE",
      },
    }),
    "DE",
  );
});
