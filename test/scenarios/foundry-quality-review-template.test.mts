import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { qualityReviewFixture } from "../fixtures/foundry-quality-review.ts";
import { digestFile } from "../fixtures/foundry-public-workflow.ts";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import type {
  FoundryQualityReviewInput,
  FoundryQualityReview,
  FoundryQualityReviewEvidence,
} from "../../scripts/lib/foundry-quality-review-input.ts";

type Draft = Omit<FoundryQualityReviewInput, "schema" | "reviews" | "evidence"> & {
  schema: string;
  reviews: (FoundryQualityReview & { disposition: string | null })[];
  evidence: Omit<FoundryQualityReviewEvidence, "sha256">[];
};

test("public quality template binds the assessed scope and hashes selected evidence without preaccepting a decision", async (t) => {
  const f = await qualityReviewFixture(t);
  const template = f.assessed.artifacts.find(
    (item) => item.role === "quality_review_input_template",
  );
  assert.ok(template?.kind === "inline", "assessment must generate the mechanical review input");
  const draft = template.value as Draft;
  const schema = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-quality-review-draft.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.equal(schema(draft), false, "an unfilled generated template is not a valid submission");
  assert.equal(draft.schema, "tiangong-foundry.quality-review-draft.v1");
  assert.equal(draft.assessment_sha256, f.scope.assessment_sha256);
  assert.equal(draft.qa_report_sha256, f.scope.qa_report_sha256);
  assert.deepEqual(draft.binding, f.scope.binding);
  assert.equal(draft.reviews.length, 2);
  assert.ok(
    draft.reviews.every(
      (item) =>
        item.disposition === null && item.rationale === "" && item.evidence_ids.length === 0,
    ),
  );
  assert.deepEqual(draft.evidence, []);
  const submit = async (value: unknown) => {
    fs.writeFileSync(f.descriptorFile, JSON.stringify(value));
    return f.facade.resume({ ...f.invocation, qualityReviewInputFile: f.descriptorFile });
  };
  const untouched = await submit(draft);
  assert.ok(untouched.blockers.some((item) => item.code === "quality_review_input_invalid"));
  const complete: Draft = {
    ...draft,
    reviews: draft.reviews
      .filter((item) => item.id === f.ids.a)
      .map((item) => ({
        ...item,
        disposition: "accept-interpretation",
        rationale: f.descriptor.reviews[0].rationale,
        evidence_ids: ["approval", "model"],
      })),
    evidence: f.descriptor.evidence.map(({ sha256: _hash, ...selection }) => selection),
  };
  assert.equal(schema(complete), true, JSON.stringify(schema.errors));
  for (const changed of [
    { assessment_sha256: "0".repeat(64) },
    { binding: { ...complete.binding, user_id: "55555555-5555-4555-8555-555555555555" } },
    { reviews: [{ ...complete.reviews[0], disposition: null }] },
    { reviews: [{ ...complete.reviews[0], rationale: " " }] },
    { reviews: [{ ...complete.reviews[0], id: f.ids.b }] },
    { evidence: [{ ...complete.evidence[0], sha256: "0".repeat(64) }, complete.evidence[1]] },
  ]) {
    const rejected = await submit({ ...complete, ...changed });
    assert.ok(
      rejected.blockers.some((item) => item.code.startsWith("quality_review_")),
      JSON.stringify(rejected),
    );
    assert.ok(!rejected.artifacts.some((item) => item.role === "foundry-quality-review.json"));
  }
  const accepted = await submit(complete);
  const artifact = accepted.artifacts.find((item) => item.role === "foundry-quality-review.json");
  assert.ok(artifact?.kind === "file", JSON.stringify(accepted.blockers));
  const receipt = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
    input: FoundryQualityReviewInput;
    grants_permission: boolean;
  };
  assert.equal(receipt.input.schema, "tiangong-foundry.quality-review-input.v1");
  assert.deepEqual(
    receipt.input.evidence.map((item) => item.sha256),
    complete.evidence.map((item) => digestFile(item.file)),
  );
  assert.equal(receipt.grants_permission, false);
  const identical = await submit(complete);
  assert.equal(
    identical.artifacts.find((item) => item.role === "foundry-quality-review.json")?.sha256,
    artifact.sha256,
    "an unchanged generated draft and unchanged selected evidence reuse the original receipt",
  );
  const modelFile = complete.evidence.find((item) => item.kind === "source-model")!.file;
  const acceptedModel = fs.readFileSync(modelFile);
  fs.writeFileSync(modelFile, JSON.stringify({ physical_residual_kg: 60 }));
  const changedEvidence = await submit(complete);
  assert.ok(
    changedEvidence.blockers.some((item) => item.code === "quality_review_scope_invalid"),
    "same draft bytes cannot hide drift in the actual selected scientific evidence",
  );
  fs.writeFileSync(modelFile, acceptedModel);
  // Reload verifies retained selected bytes even after the original external evidence disappears.
  complete.evidence.forEach((item) => fs.unlinkSync(item.file));
  const reloaded = await createFoundryFacade({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: f.workspace,
    cacheBase: f.root + "/cache",
    runtimeSelection: f.runtimeSelection,
  }).status(f.invocation);
  assert.ok(
    reloaded.artifacts.some((item) => item.role === "foundry-quality-review.json"),
    JSON.stringify(reloaded.blockers),
  );
  assert.ok(!reloaded.blockers.some((item) => item.code.startsWith("quality_review_")));
});
