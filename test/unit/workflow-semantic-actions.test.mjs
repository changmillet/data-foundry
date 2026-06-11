import assert from "node:assert/strict";
import test from "node:test";
import { namePlanQualityFindings } from "../../scripts/lib/import-curation/internal/workflow-semantic-actions.mjs";

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
  });
  const sourceLocatorFindings = citationFindings.filter(
    (finding) => finding.code === "semantic_name_source_locator_in_name",
  );
  assert.equal(sourceLocatorFindings.length, 1);
  assert.equal(sourceLocatorFindings[0].field, "baseName");
  assert.ok(sourceLocatorFindings[0].detected_segments.includes("latin-author-year"));
});
