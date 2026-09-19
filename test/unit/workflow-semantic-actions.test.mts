import assert from "node:assert/strict";
import test from "node:test";
import {
  collectNamePlanQualitySemanticActions,
  namePlanQualityFindings,
} from "../../scripts/lib/import-curation/internal/workflow-semantic-actions.ts";

interface TestNameFinding {
  code: string;
  field?: unknown;
  detected_segments?: unknown;
}

test("name-plan actions bind public premises without changing Foundry findings", () => {
  for (const [datasetType, rootKey, expectedRule] of [
    ["flow", "flowDataSet", "tidas.flow.name.base-name.technical"],
    ["process", "processDataSet", "tidas.process.name.qualifiers.structured"],
  ]) {
    const informationKey = datasetType === "flow" ? "flowInformation" : "processInformation";
    const actions = collectNamePlanQualitySemanticActions(
      {
        [rootKey]: {
          [informationKey]: { dataSetInformation: { name: { baseName: "Electricity, at plant" } } },
        },
      },
      datasetType,
    );
    const action = actions.find(
      (item) => item.code === "semantic_name_base_contains_unsplit_segments",
    );
    assert.ok(action);
    const evidence = action.evidence as Record<string, unknown>;
    assert.deepEqual(evidence.public_rule_refs, [expectedRule]);
    assert.match(
      String(evidence.public_rule_source),
      /tidas-spec@ea4a5898.*public-rules\.v1\.json/u,
    );
    assert.equal(action.action_kind, "ai_authoring");
    assert.equal(action.required_owner, "foundry_ai_authoring");
  }

  const localOnly = collectNamePlanQualitySemanticActions(
    {
      flowDataSet: {
        flowInformation: {
          dataSetInformation: { name: { baseName: "Steel, Frischknecht 2012" } },
        },
      },
    },
    "flow",
  ).find((item) => item.code === "semantic_name_source_locator_in_name");
  assert.ok(localOnly);
  assert.deepEqual((localOnly.evidence as Record<string, unknown>).public_rule_refs, []);
});

test("name-plan QA treats season-year scope as temporal, not a source citation", () => {
  const seasonScopedFindings = namePlanQualityFindings({
    baseName: "Electricity",
    treatmentStandardsRoutes: "hydropower, at pumped storage plant, ENTSO, summer 2018",
  });
  assert.equal(
    seasonScopedFindings.some((finding) => finding.code === "semantic_name_source_locator_in_name"),
    false,
  );

  const citationFindings = namePlanQualityFindings({
    baseName: "Steel sheet, Frischknecht 2012, at plant",
  }) as unknown as TestNameFinding[];
  const sourceLocatorFindings = citationFindings.filter(
    (finding) => finding.code === "semantic_name_source_locator_in_name",
  );
  assert.equal(sourceLocatorFindings.length, 1);
  assert.equal(sourceLocatorFindings[0].field, "baseName");
  const detectedSegments = sourceLocatorFindings[0].detected_segments;
  assert.ok(Array.isArray(detectedSegments));
  assert.ok(detectedSegments.includes("latin-author-year"));
});

test("name-plan QA ignores a trailing location brace that restates mixAndLocationTypes", () => {
  // "{RER}" merely restates the dataset location (already carried in mixAndLocationTypes),
  // so it must NOT raise an unsplit-segment finding — otherwise the name-split step is forced
  // to split "Tyre wear emissions, passenger car" and fails (bafu_name_split_unsupported).
  const redundantLocationFindings = namePlanQualityFindings({
    baseName: "Tyre wear emissions, passenger car {RER}",
    mixAndLocationTypes: "RER",
  });
  assert.equal(
    redundantLocationFindings.some(
      (finding) => finding.code === "semantic_name_base_contains_unsplit_segments",
    ),
    false,
  );

  // A trailing brace whose code does NOT match the dataset location is still flagged.
  const mismatchedLocationFindings = namePlanQualityFindings({
    baseName: "Tyre wear emissions, passenger car {GLO}",
    mixAndLocationTypes: "RER",
  }) as unknown as TestNameFinding[];
  assert.ok(
    mismatchedLocationFindings.some(
      (finding) =>
        finding.code === "semantic_name_base_contains_unsplit_segments" &&
        Array.isArray(finding.detected_segments) &&
        finding.detected_segments.includes("braced_location_or_qualifier"),
    ),
  );

  // Without mixAndLocationTypes there is nothing to compare against, so the brace stays flagged.
  const noMixFindings = namePlanQualityFindings({
    baseName: "Tyre wear emissions, passenger car {RER}",
  });
  assert.ok(
    noMixFindings.some(
      (finding) => finding.code === "semantic_name_base_contains_unsplit_segments",
    ),
  );
});
