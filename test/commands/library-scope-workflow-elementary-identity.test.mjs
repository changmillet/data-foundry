import test from "node:test";
import { createLibraryScopeWorkflowCommands } from "../../scripts/commands/library-scope-workflow.mjs";
import { assert, fs, path, testTmpRoot } from "../fixtures/foundry-core.mjs";

const fixtureRoot = testTmpRoot("library-scope-workflow-elementary-identity-test");

const ensureArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const asText = (value) => (value == null ? "" : String(value).trim());

const { libraryScopeWorkflowTestHooks } = createLibraryScopeWorkflowCommands({
  asText,
  booleanOption: (value) => Boolean(value),
  bundleClassificationPath: () => null,
  cloneJson: (value) => JSON.parse(JSON.stringify(value)),
  datasetIdentity: () => ({}),
  directoryExists: (p) => Boolean(p) && fs.existsSync(p) && fs.statSync(p).isDirectory(),
  ensureArray,
  fileExists: (p) => Boolean(p) && fs.existsSync(p),
  flowTypeOfDataSet: () => "",
  jsonSha256: () => "",
  nowIso: () => "2026-01-01T00:00:00Z",
  positiveIntegerOption: (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  },
  readJson: (p) => JSON.parse(fs.readFileSync(p, "utf8")),
  readJsonLines: () => [],
  repoRelativeMaybe: (p) => p ?? null,
  repoRelativePath: (p) => p,
  resolveRepoPath: (p) => (p ? p : null),
  sha256Text: () => "",
  textValue: asText,
  writeJson: () => {},
  writeJsonLines: () => {},
});

const { evaluateElementaryIdentityDecision } = libraryScopeWorkflowTestHooks;

function sourceFileWithTrace({ category, subCategory }) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const file = path.join(
    fixtureRoot,
    `flow-${category.replace(/[^a-z]/gu, "")}-${subCategory.replace(/[^a-z.]/gu, "")}-${Math.abs(
      [...`${category}|${subCategory}`].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7) % 99991,
    )}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      flowDataSet: {
        flowInformation: {
          dataSetInformation: {
            "common:other": {
              "tidasimport:sourceTrace": {
                payload: { sourceClassification: { category, subCategory } },
              },
            },
          },
        },
      },
    }),
  );
  return file;
}

function candidate({ names, cas = null, flowProperty = "Mass", categories }) {
  return {
    id: `cand-${names[0].replace(/[^a-z0-9]/giu, "")}-${categories.join("").length}`,
    version: "03.00.004",
    names,
    fields: {
      type_of_dataset: "Elementary flow",
      cas,
      flow_property: flowProperty,
      reference_unit: null,
      categories,
    },
  };
}

test("elementary identity evaluator recovers compartment from the source trace", () => {
  const sourceFile = sourceFileWithTrace({ category: "emissions to water", subCategory: "river" });
  const evaluation = evaluateElementaryIdentityDecision({
    entity: {
      dataset_id: "t1",
      name: "Beryllium; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Beryllium"],
        fields: {
          cas: "007440-41-7",
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["beryllium"],
          cas: "7440-41-7",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
        candidate({
          names: ["beryllium"],
          cas: "7440-41-7",
          categories: ["Emissions", "Emissions to water", "Emissions to fresh water"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.deepEqual(evaluation.candidate.fields.categories, [
    "Emissions",
    "Emissions to water",
    "Emissions to fresh water",
  ]);
});

test("elementary identity evaluator refuses a candidate that extends the target name without CAS", () => {
  const sourceFile = sourceFileWithTrace({
    category: "emissions to air",
    subCategory: "unspecified",
  });
  const evaluation = evaluateElementaryIdentityDecision({
    entity: {
      dataset_id: "t2",
      name: "Ethane; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Ethane"],
        fields: {
          cas: null,
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["1,2-dibromoethane"],
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
        candidate({
          names: ["ethane"],
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.deepEqual(evaluation.candidate.names, ["ethane"]);
});

test("elementary identity evaluator matches inverted chemical names via token permutation", () => {
  const sourceFile = sourceFileWithTrace({
    category: "emissions to air",
    subCategory: "unspecified",
  });
  const evaluation = evaluateElementaryIdentityDecision({
    entity: {
      dataset_id: "t3",
      name: "Ethane, 1,1,2,2-tetrachloro-; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in kg" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Ethane, 1,1,2,2-tetrachloro-"],
        fields: {
          cas: null,
          flow_property: "Amount in kg",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["1,1,2,2-tetrachloroethane"],
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.deepEqual(evaluation.candidate.names, ["1,1,2,2-tetrachloroethane"]);
});

test("elementary identity evaluator keeps mid-name token runs on manual review", () => {
  const sourceFile = sourceFileWithTrace({ category: "resource, land", subCategory: "" });
  const evaluation = evaluateElementaryIdentityDecision({
    entity: {
      dataset_id: "t4",
      name: "Occupation, dump site, benthos; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Area*time" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Occupation, dump site, benthos"],
        fields: {
          cas: null,
          flow_property: "Area*time",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["dump site"],
          flowProperty: "Area*time",
          categories: ["Land use", "Land occupation"],
        }),
      ],
    },
    usage: { input: 1, output: 0, other: 0, process_ids: [] },
  });
  assert.equal(evaluation.decision, "block_unresolved");
});

test("elementary identity evaluator overrides a mislabeled flow-property text on exact name and compartment", () => {
  const sourceFile = sourceFileWithTrace({
    category: "emissions to air",
    subCategory: "low. pop.",
  });
  const evaluation = evaluateElementaryIdentityDecision({
    entity: {
      dataset_id: "t5",
      name: "Heat, waste; source-described route; source-described geography",
      source_file: sourceFile,
      flow_property_refs: [{ short_description: "Amount in MJ" }],
    },
    report: {
      status: "needs_review",
      decision: "manual_review",
      target: {
        names: ["Heat, waste"],
        fields: {
          cas: null,
          flow_property: "Amount in MJ",
          categories: ["Emissions", "Emissions to air", "Emissions to air, unspecified"],
        },
      },
      candidates: [
        candidate({
          names: ["waste heat"],
          flowProperty: "Radioactivity",
          categories: ["Emissions", "Emissions to non-urban air or from high stacks"],
        }),
        candidate({
          names: ["waste heat"],
          flowProperty: "Radioactivity",
          categories: ["Emissions", "Emissions to water", "Emissions to water, unspecified"],
        }),
      ],
    },
    usage: null,
  });
  assert.equal(evaluation.decision, "reuse_existing_reference");
  assert.match(evaluation.candidate.fields.categories.join(" "), /non-urban air/u);
  assert.equal(evaluation.evidence.selected_candidate.flow_property_label_overridden, true);
});
