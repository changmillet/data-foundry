import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readFoundryAdoptionReviewInput,
  verifyFoundryAdoptionReview,
} from "../../scripts/lib/foundry-release-adoption.ts";
import { adoptionFileFact } from "../../scripts/lib/foundry-release-adoption-facts.ts";
import {
  foundryComponentHash as hash,
  foundryComponentJson as json,
} from "../../scripts/lib/foundry-release-component-io.ts";
import { parseFoundryRuntimePreparationArgs } from "../../scripts/release-prepare-runtime.ts";

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-adoption-review-")));
  const evidence = path.join(root, "independent-findings.txt");
  fs.writeFileSync(
    evidence,
    "Independent synthetic review-input contract evidence. Not native compatibility acceptance.\n",
  );
  const original = { synthetic: "original" },
    successor = { synthetic: "successor" };
  const request = {
    schema: "tiangong-foundry.runtime-adoption-review-request.v1",
    original,
    successor,
    original_facts_sha256: hash(json(original)),
    successor_facts_sha256: hash(json(successor)),
  };
  const requestPath = path.join(root, "request.json");
  fs.writeFileSync(requestPath, json(request));
  const requestFact = adoptionFileFact(requestPath);
  const review = {
    schema: "tiangong-foundry.runtime-adoption-compatibility-review.v1",
    request: requestFact,
    reviewer: "independent-input-fixture",
    conclusion: "compatible",
    original_facts_sha256: request.original_facts_sha256,
    successor_facts_sha256: request.successor_facts_sha256,
    allowed_changes: ["foundry", "cli"],
    evidence: [adoptionFileFact(evidence)],
  };
  const reviewPath = path.join(root, "review.json");
  const write = (value: unknown) => {
    fs.writeFileSync(reviewPath, json(value));
    return adoptionFileFact(reviewPath);
  };
  return { root, request, requestFact, review, write, evidence };
}

test("adoption uses paired exact original selection and stays unavailable to published mode", () => {
  const selected = parseFoundryRuntimePreparationArgs([
    "--output",
    "/candidate",
    "--adoption-original",
    "/old.json",
    "--adoption-original-sha256",
    "1".repeat(64),
  ]);
  assert.deepEqual(selected.adoptionOriginal, { path: "/old.json", sha256: "1".repeat(64) });
  for (const args of [
    ["--output", "/candidate", "--adoption-original", "/old.json"],
    ["--output", "/candidate", "--adoption-original-sha256", "1".repeat(64)],
    [
      "--output",
      "/candidate",
      "--published",
      "--adoption-original",
      "/old.json",
      "--adoption-original-sha256",
      "1".repeat(64),
    ],
  ])
    assert.throws(() => parseFoundryRuntimePreparationArgs(args), /Usage/u);
});

test("review input requires an actual conclusion, reviewer, evidence and exact complete-facts bindings", () => {
  const f = fixture();
  try {
    assert.doesNotThrow(() => readFoundryAdoptionReviewInput(f.write(f.review), f.requestFact));
    for (const change of [
      { conclusion: "pending" },
      { conclusion: "passed" },
      { reviewer: " " },
      { evidence: [] },
      { original_facts_sha256: "0".repeat(64) },
      { successor_facts_sha256: "0".repeat(64) },
      { allowed_changes: ["foundry", "cli", "tidas"] },
      { request: { ...f.requestFact, sha256: "0".repeat(64) } },
      { author_approval: true },
    ])
      assert.throws(() =>
        readFoundryAdoptionReviewInput(f.write({ ...f.review, ...change }), f.requestFact),
      );
    // Passing the input shape cannot manufacture a native qualification from invented runtime facts.
    assert.throws(() => verifyFoundryAdoptionReview(f.write(f.review), f.requestFact), /object/u);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("retained review evidence and complete request bytes are rechecked instead of trusting serialized facts", () => {
  const f = fixture();
  try {
    const review = f.write(f.review);
    fs.appendFileSync(f.evidence, "changed");
    assert.throws(() => readFoundryAdoptionReviewInput(review, f.requestFact), /changed/u);
    fs.writeFileSync(
      f.requestFact.path,
      json({ ...f.request, successor: { synthetic: "different" } }),
    );
    const current = adoptionFileFact(f.requestFact.path);
    assert.throws(
      () => readFoundryAdoptionReviewInput(f.write({ ...f.review, request: current }), current),
      /exact native request/u,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("compatibility facts preserve the managed access ceiling and the exact Node/Toolkit combination", async () => {
  const { assertFoundryAdoptionCompatibleDependencies } =
    await import("../../scripts/lib/foundry-release-adoption-facts.ts");
  const original = {
    access_ceiling: [
      { id: "foundry", access: "write", target: null },
      { id: "foundry-read", access: "read", target: null },
    ],
    cli: { expectation: { platform: "darwin-arm64", node_version: "24.19.0" } },
    node: { bytes: 100, sha256: "1".repeat(64) },
    toolkit: {
      executable: { bytes: 200, sha256: "2".repeat(64) },
      expectation: { binary_version: "0.3.4", validation: "unchanged" },
    },
  } as unknown as import("../../scripts/lib/foundry-release-adoption-facts.ts").FoundryAdoptionRuntimeFacts;
  assert.doesNotThrow(() => assertFoundryAdoptionCompatibleDependencies(original, original));
  for (const changed of [
    { ...original, access_ceiling: [{ id: "foundry-read", access: "write", target: null }] },
    { ...original, node: { ...original.node, sha256: "3".repeat(64) } },
    {
      ...original,
      cli: {
        ...original.cli,
        expectation: { ...original.cli.expectation, node_version: "26.0.0" },
      },
    },
    {
      ...original,
      toolkit: {
        ...original.toolkit,
        executable: { ...original.toolkit.executable, sha256: "4".repeat(64) },
      },
    },
    {
      ...original,
      toolkit: {
        ...original.toolkit,
        expectation: { ...original.toolkit.expectation, binary_version: "0.3.5" },
      },
    },
  ])
    assert.throws(() => assertFoundryAdoptionCompatibleDependencies(original, changed));
});

test("native child doctor must match the complete independently selected package/CLI/Node/Toolkit identity", async () => {
  const { assertFoundryAdoptionNativeIdentity } =
    await import("../../scripts/lib/foundry-release-adoption.ts");
  const expected = {
    runtime: {
      package_name: "@tiangong-lca/foundry",
      package_version: "0.1.17",
      manifest_sha256: "1".repeat(64),
      entry_sha256: "2".repeat(64),
    },
    cli: {
      expectation: {
        schema: "tiangong-lca.cli-runtime-expectation.v1",
        package_version: "0.1.28",
        platform: "darwin-arm64",
        content_sha256: "3".repeat(64),
        node_version: "24.19.0",
        node_sha256: "4".repeat(64),
      },
    },
    toolkit: {
      expectation: {
        binary_version: "0.3.4",
        executable: { bytes: 200, sha256: "5".repeat(64) },
        validation: {
          asset_fingerprint: "6".repeat(64),
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: ["tidas.validation-final-event.v1"],
        },
      },
    },
  } as unknown as import("../../scripts/lib/foundry-release-adoption-facts.ts").FoundryAdoptionRuntimeFacts;
  const { schema: _schema, ...cli } = expected.cli.expectation;
  const identity = {
    foundry: {
      package_name: expected.runtime.package_name,
      package_version: expected.runtime.package_version,
      package_manifest_sha256: expected.runtime.manifest_sha256,
      entry_sha256: expected.runtime.entry_sha256,
    },
    qualification: {
      status: "ready",
      identity: {
        cli,
        tidas: {
          binary_version: "0.3.4",
          executable: expected.toolkit.expectation.executable,
          asset_fingerprint: "6".repeat(64),
          protocols: ["document-validation-batch.v1"],
          event_schema_versions: ["tidas.validation-final-event.v1"],
        },
      },
    },
  };
  assert.doesNotThrow(() => assertFoundryAdoptionNativeIdentity(identity, expected));
  for (const changed of [
    { ...identity, foundry: { ...identity.foundry, entry_sha256: "7".repeat(64) } },
    { ...identity, qualification: { ...identity.qualification, status: "required" } },
    {
      ...identity,
      qualification: {
        ...identity.qualification,
        identity: {
          ...identity.qualification.identity,
          cli: { ...cli, content_sha256: "8".repeat(64) },
        },
      },
    },
    {
      ...identity,
      qualification: {
        ...identity.qualification,
        identity: {
          ...identity.qualification.identity,
          cli: { ...cli, node_sha256: "9".repeat(64) },
        },
      },
    },
    {
      ...identity,
      qualification: {
        ...identity.qualification,
        identity: {
          ...identity.qualification.identity,
          tidas: { ...identity.qualification.identity.tidas, asset_fingerprint: "0".repeat(64) },
        },
      },
    },
  ])
    assert.throws(
      () => assertFoundryAdoptionNativeIdentity(changed, expected),
      /different exact runtime/u,
    );
});
