import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { projectFoundryValidationReferences } from "../../src/lib/foundry-validation-reference-context.ts";
import { typedFinalizationProcessFixture } from "../fixtures/finalization-process.ts";

type Json = Record<string, unknown>;
type Result = { status: number | null; stdout: string; stderr: string };
const object = (value: unknown) => value as Json;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const contentHash = (value: unknown) => hash(JSON.stringify(canonical(value)));

/** Actual installed CLI in the same verified cache as the genuine Foundry IPC host. */
export async function verifyManagedAllocationConsumer(
  root: string,
  packageVersion: string,
  run: (argv: string[]) => Promise<Result>,
) {
  const typed = packageVersion === "0.4.0";
  const original = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  ) as { payload: Json; context: { flow_documents: Json[] } };
  let processEvidence: { input: string; report: string } | undefined;
  for (const [name, direction, type, expected] of [
    ["input-product", "Input", "Product flow", "passed"],
    ["output-product", "Output", "Product flow", "passed"],
    ["input-waste", "Input", "Waste flow", "passed"],
    ["output-waste", "Output", "Waste flow", "passed"],
    ["elementary", "Input", "Elementary flow", "failed"],
    ["missing-context", "Input", "Product flow", "unresolved"],
  ] as const) {
    const typedFixture = typed ? typedFinalizationProcessFixture() : null;
    const fixture = typedFixture
      ? { payload: typedFixture.process, context: { flow_documents: [typedFixture.flow] } }
      : structuredClone(original);
    const exchanges = object(object(fixture.payload.processDataSet).exchanges).exchange as Json[];
    exchanges[1].exchangeDirection = direction;
    const flow = fixture.context.flow_documents[0];
    object(object(object(flow.flowDataSet).modellingAndValidation).LCIMethod).typeOfDataSet = type;
    const input = path.join(root, `allocation-${name}.json`);
    const out = path.join(root, `allocation-${name}-report`);
    fs.writeFileSync(
      input,
      JSON.stringify({
        json_ordered: fixture.payload,
        semantic_context: name === "missing-context" ? { flow_documents: [] } : fixture.context,
      }),
    );
    const before = hash(fs.readFileSync(input));
    const typedInput = path.join(root, `allocation-${name}-content.json`);
    const typedReport = path.join(root, `allocation-${name}-validation.json`);
    const referenceDocuments = path.join(root, `allocation-${name}-references.json`);
    if (typedFixture) {
      const references =
        name === "missing-context" ? [] : [flow, typedFixture.property, typedFixture.group];
      const [projected] = projectFoundryValidationReferences(
        [{ json: fixture.payload }],
        references,
      );
      fs.writeFileSync(
        typedInput,
        JSON.stringify({
          ...fixture.payload,
          json: fixture.payload,
          semantic_context: object(projected).semantic_context,
        }),
      );
      fs.writeFileSync(
        referenceDocuments,
        JSON.stringify({
          documents: references,
        }),
      );
    }
    const result = await run(
      typed
        ? [
            "dataset",
            "process",
            "validate",
            "--input",
            typedInput,
            "--checks",
            "schema,business",
            "--output",
            typedReport,
            ...(name === "missing-context" ? [] : ["--reference-documents", referenceDocuments]),
            "--json",
          ]
        : [
            "dataset",
            "validate",
            "--input",
            input,
            "--type",
            "process",
            "--out-dir",
            out,
            "--json",
          ],
    );
    assert.equal(result.stderr, "", result.stdout);
    assert.equal(result.status, expected === "passed" ? 0 : 1, result.stdout);
    const envelope = object(JSON.parse(result.stdout));
    const reportFile = typed ? typedReport : object(envelope.files).report;
    assert.equal(typeof reportFile, "string");
    if (name === "input-waste") processEvidence = { input, report: reportFile as string };
    const report = object(JSON.parse(fs.readFileSync(reportFile as string, "utf8")));
    const row = typed ? report : object((report.rows as unknown[])[0]);
    assert.ok(row.allocation_semantics, "Installed managed CLI must expose allocation semantics.");
    const semantics = object(row.allocation_semantics);
    assert.equal(semantics.profile, "tidas.process-allocation-reference.v1");
    assert.equal(semantics.tolerance, 0.0010000001);
    assert.equal(semantics.status, expected, name);
    assert.equal(semantics.candidate_sha256, contentHash(fixture.payload));
    assert.equal(
      semantics.options_sha256,
      contentHash({
        profile: "tidas.process-allocation-reference.v1",
        tolerance: 0.0010000001,
      }),
    );
    assert.ok(Array.isArray(semantics.coverage));
    if (expected !== "passed")
      assert.ok(
        (semantics.coverage as Json[]).some(
          (check) => check.status === (expected === "failed" ? "invalid" : "unresolved"),
        ),
      );
    if (name !== "missing-context") {
      const information = object(
        object(object(flow.flowDataSet).flowInformation).dataSetInformation,
      );
      const publication = object(
        object(object(flow.flowDataSet).administrativeInformation).publicationAndOwnership,
      );
      assert.deepEqual(semantics.dependencies, [
        {
          uuid: information["common:UUID"],
          version: publication["common:dataSetVersion"],
          content_sha256: contentHash(flow),
        },
      ]);
    } else {
      assert.deepEqual(semantics.dependencies, []);
    }
    if (name === "elementary")
      assert.ok(JSON.stringify(row).includes("allocation_target_flow_type_invalid"));
    assert.equal(
      hash(fs.readFileSync(input)),
      before,
      "Validation must preserve authored candidate bytes.",
    );
  }
  assert.ok(processEvidence);
  return processEvidence;
}
