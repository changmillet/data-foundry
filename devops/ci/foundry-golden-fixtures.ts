import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export type FixturePaths = {
  processRows: string;
  supportRows: string;
  processSchemaReport: string;
  processQaReport: string;
  bundlesDir: string;
  authoringPackage: string;
};

export const GOLDEN_PROCESS_ID = "22222222-3333-5444-8555-666666666666";
export const GOLDEN_SOURCE_ID = "33333333-4444-5555-8666-777777777777";
export const GOLDEN_CONTACT_ID = "11111111-2222-5333-8444-555555555555";

export function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath: string, rows: unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function ml(text: string): { "@xml:lang": "en"; "#text": string } {
  return { "@xml:lang": "en", "#text": text };
}

function contactRef(id = GOLDEN_CONTACT_ID, text = "Fixture Data Steward"): JsonRecord {
  return {
    "@type": "contact data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../contacts/${id}.json`,
    "common:shortDescription": ml(text),
  };
}

function sourceRef(id = GOLDEN_SOURCE_ID, text = "Fixture source report"): JsonRecord {
  return {
    "@type": "source data set",
    "@refObjectId": id,
    "@version": "00.00.001",
    "@uri": `../sources/${id}.json`,
    "common:shortDescription": ml(text),
  };
}

function supportRows(): JsonRecord[] {
  return [
    {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: {
            "common:UUID": GOLDEN_CONTACT_ID,
            "common:name": ml("Fixture Data Steward"),
            "common:shortName": ml("Fixture Data Steward"),
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
            "common:referenceToOwnershipOfDataSet": contactRef(),
          },
        },
      },
    },
    {
      sourceDataSet: {
        sourceInformation: {
          dataSetInformation: {
            "common:UUID": GOLDEN_SOURCE_ID,
            "common:shortName": ml("Fixture source report"),
            sourceCitation: "Fixture source report, 2026",
            classificationInformation: {
              "common:classification": {
                "common:class": {
                  "@level": "0",
                  "@classId": "6",
                  "#text": "Publications and communications",
                },
              },
            },
          },
        },
        administrativeInformation: {
          publicationAndOwnership: {
            "common:dataSetVersion": "00.00.001",
            "common:referenceToOwnershipOfDataSet": contactRef(),
          },
        },
      },
    },
  ];
}

function processRow(): JsonRecord {
  return {
    processDataSet: {
      processInformation: {
        dataSetInformation: {
          "common:UUID": GOLDEN_PROCESS_ID,
          name: { baseName: ml("Fixture process") },
          classificationInformation: {
            "common:classification": {
              "common:class": [{ "@level": "0", "@classId": "1", "#text": "Agriculture" }],
            },
          },
        },
      },
      administrativeInformation: {
        dataEntryBy: {
          "common:referenceToPersonOrEntityEnteringTheData": contactRef(),
        },
        publicationAndOwnership: {
          "common:dataSetVersion": "00.00.001",
          "common:referenceToOwnershipOfDataSet": contactRef(),
        },
      },
      modellingAndValidation: {
        dataSourcesTreatmentAndRepresentativeness: {
          referenceToDataSource: sourceRef(),
        },
      },
    },
  };
}

function authoringPackage(root: string): string {
  const contextDir = path.join(root, "context");
  const contextFiles = [
    ["schema", "schema.json", "{}"],
    ["methodology_yaml", "methodology.yaml", "process:\n  required: true\n"],
    ["ruleset", "runtime-ruleset.json", '{"rules":[]}'],
    ["classification_schema", "tidas_processes_category.json", '{"oneOf":[]}'],
    ["location_schema", "tidas_locations_category.json", '{"oneOf":[]}'],
  ].map(([kind, fileName, text]) => {
    const filePath = path.join(contextDir, fileName);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text);
    return { kind, path: filePath, text };
  });
  const packagePath = path.join(root, "authoring", "process.authoring-package.json");
  writeJson(packagePath, {
    schema_version: 2,
    profile: "bafu",
    dataset_type: "process",
    entity_id: GOLDEN_PROCESS_ID,
    version: "00.00.001",
    source_rows_file: "tmp/source/processes.jsonl",
    contract_context_files: contextFiles,
    full_context_ai_completion: {
      required: true,
      required_context_kinds: [
        "schema",
        "methodology_yaml",
        "ruleset",
        "classification_schema",
        "location_schema",
      ],
      required_context_file_patterns: [
        "schema.json",
        "methodology.yaml",
        "runtime-ruleset.json",
        "tidas_processes_category.json",
        "tidas_locations_category.json",
      ],
    },
    missing_context_files: [],
    action_items: [
      {
        code: "process_placeholder_content",
        path: "processDataSet.processInformation.quantitativeReference.functionalUnitOrOther",
        message: "Functional unit placeholder requires evidence-backed completion.",
        allowed_resolution_modes: ["evidence_backed_completion", "deferred_to_common_other"],
      },
    ],
    source_row: processRow(),
    entity_payload: processRow(),
  });
  return packagePath;
}

export function prepareGoldenFixtures(fixtureRoot: string): FixturePaths {
  const rowsDir = path.join(fixtureRoot, "rows");
  const reportsDir = path.join(fixtureRoot, "reports");
  writeJsonLines(path.join(rowsDir, "processes.jsonl"), [processRow()]);
  writeJsonLines(path.join(rowsDir, "support.jsonl"), supportRows());
  writeJson(path.join(reportsDir, "schema-process.json"), {
    schema_version: 1,
    status: "completed",
    rows: [{ id: GOLDEN_PROCESS_ID, version: "00.00.001", status: "valid", issues: [] }],
  });
  writeJson(path.join(reportsDir, "qa-process.json"), {
    schema_version: 1,
    status: "passed",
    findings: [],
  });
  const bundleDir = path.join(fixtureRoot, "process-bundles", GOLDEN_PROCESS_ID);
  writeJson(
    path.join(bundleDir, "tidas", "contacts", `${GOLDEN_CONTACT_ID}.json`),
    supportRows()[0],
  );
  writeJson(path.join(bundleDir, "tidas", "sources", `${GOLDEN_SOURCE_ID}.json`), supportRows()[1]);
  writeJson(path.join(bundleDir, "tidas", "processes", `${GOLDEN_PROCESS_ID}.json`), processRow());
  writeJson(path.join(bundleDir, "manifest.json"), {
    schema_version: 1,
    process_id: GOLDEN_PROCESS_ID,
    files: {
      contacts: [`tidas/contacts/${GOLDEN_CONTACT_ID}.json`],
      sources: [`tidas/sources/${GOLDEN_SOURCE_ID}.json`],
      unitgroups: [],
      flowproperties: [],
      flows: [],
      processes: [`tidas/processes/${GOLDEN_PROCESS_ID}.json`],
    },
    unresolved_references: [],
  });
  return {
    processRows: path.join(rowsDir, "processes.jsonl"),
    supportRows: path.join(rowsDir, "support.jsonl"),
    processSchemaReport: path.join(reportsDir, "schema-process.json"),
    processQaReport: path.join(reportsDir, "qa-process.json"),
    bundlesDir: path.join(fixtureRoot, "process-bundles"),
    authoringPackage: authoringPackage(fixtureRoot),
  };
}

export function writeGoldenStubCliScript(tempRoot: string): string {
  const cliPath = path.join(tempRoot, "stub-tiangong-lca.mjs");
  writeFileSync(
    cliPath,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function option(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\\n");
}
function readRows(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\\r?\\n/u).filter(Boolean).map((line) => JSON.parse(line));
}
function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return "";
}
function identity(row, fallbackType = "process") {
  const root = row.contactDataSet || row.sourceDataSet || row.processDataSet || row.flowDataSet || row.lifecycleModelDataSet || row;
  const type = row.contactDataSet ? "contact" : row.sourceDataSet ? "source" : fallbackType;
  const info = root.contactInformation || root.sourceInformation || root.processInformation || root.flowInformation || {};
  const data = info.dataSetInformation || {};
  const admin = root.administrativeInformation || {};
  const publication = admin.publicationAndOwnership || {};
  return {
    id: text(data["common:UUID"] || row.id || row.dataset_id),
    version: text(publication["common:dataSetVersion"] || row.version || row.dataset_version) || "00.00.001",
    type,
  };
}

const args = process.argv.slice(2);
const outDir = option("--out-dir") || ".";
const input = option("--input") || option("--input-file");

if (args[0] === "dataset" && args[1] === "validate") {
  const rows = readRows(input);
  const report = {
    schema_version: 1,
    status: "completed",
    input_path: input,
    rows: rows.map((row) => {
      const item = identity(row, option("--type") || "process");
      return { id: item.id, version: item.version, status: "valid", issues: [] };
    }),
  };
  const reportPath = path.join(outDir, "outputs", "validation-report.json");
  writeJson(reportPath, report);
  console.log(JSON.stringify({ ...report, files: { report: reportPath } }));
} else if (args[0] === "dataset" && args[1] === "classification" && args[2] === "audit") {
  const report = { schema_version: 1, status: "passed", blockers: [] };
  const reportPath = path.join(outDir, "outputs", "location-audit-report.json");
  writeJson(reportPath, report);
  console.log(JSON.stringify({ ...report, files: { report: reportPath } }));
} else if (args[0] === "dataset" && args[1] === "save-draft") {
  const rows = readRows(input);
  const progressPath = path.join(outDir, "outputs", "dataset-save-draft", "progress.jsonl");
  const failuresPath = path.join(outDir, "outputs", "dataset-save-draft", "failures.jsonl");
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, rows.map((row) => {
    const item = identity(row, option("--type") || "support");
    return JSON.stringify({ id: item.id, version: item.version, type: item.type, status: "prepared", operation: "save_draft_prepared" });
  }).join("\\n") + (rows.length ? "\\n" : ""));
  fs.writeFileSync(failuresPath, "");
  const summaryPath = path.join(outDir, "outputs", "dataset-save-draft", "summary.json");
  const summary = {
    schema_version: 1,
    status: "completed",
    mode: args.includes("--commit") ? "commit" : "dry-run",
    input_path: input,
    rows_file: input,
    files: {
      progress_jsonl: progressPath,
      failures_jsonl: failuresPath,
      summary_json: summaryPath
    },
    counts: { prepared: rows.length, failures: 0 },
  };
  writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary));
} else {
  console.error("Unhandled stub tiangong-lca command: " + args.join(" "));
  process.exit(2);
}
`,
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
}
