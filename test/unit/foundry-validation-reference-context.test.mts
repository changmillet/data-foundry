import assert from "node:assert/strict";
import test from "node:test";
import {
  projectFoundryValidationReferences,
  selectedFoundryExternalFlowReferences,
} from "../../scripts/lib/foundry-validation-reference-context.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { flowRow } from "../fixtures/row-builders.ts";
const id = "77777777-7777-4777-8777-777777777777";
const flow = {
  ...flowRow(id),
  flowDataSet: {
    ...flowRow(id).flowDataSet,
    modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
  },
};
const json = {
  processDataSet: {
    processInformation: {
      dataSetInformation: { "common:UUID": "66666666-6666-4666-8666-666666666666" },
    },
    administrativeInformation: {
      publicationAndOwnership: { "common:dataSetVersion": "00.00.001" },
    },
    exchanges: {
      exchange: { referenceToFlowDataSet: { "@refObjectId": id, "@version": "00.00.001" } },
    },
  },
};
const row = {
  id: "66666666-6666-4666-8666-666666666666",
  version: "00.00.001",
  json,
  owner: "fixture",
};

test("validation-only references preserve complete scientific row identity and original bytes", () => {
  const before = JSON.stringify(row);
  const projected = projectFoundryValidationReferences(
    [row],
    [{ json_ordered: flow }],
  ) as (typeof row)[];
  assert.equal(JSON.stringify(row), before);
  assert.deepEqual(projected[0].json, json);
  assert.equal(projected[0].id, row.id);
  assert.equal(projected[0].version, row.version);
  assert.equal(projected[0].owner, row.owner);
  assert.deepEqual((projected[0] as unknown as { semantic_context: unknown }).semantic_context, {
    flow_documents: [flow],
  });
  assert.equal(sha256Json(projected[0].json), sha256Json(row.json));
});

test("no selection, wrong exact version and metadata-only identity cannot synthesize complete evidence", () => {
  const wrong = structuredClone(flow);
  wrong.flowDataSet.administrativeInformation.publicationAndOwnership["common:dataSetVersion"] =
    "00.00.002";
  for (const refs of [
    [],
    [wrong],
    [{ id, version: "00.00.001" }],
    [{ id, version: "00.00.001", json: wrong }],
  ]) {
    const projected = projectFoundryValidationReferences([row], refs) as Array<{
      semantic_context: { flow_documents: unknown[] };
    }>;
    assert.deepEqual(projected[0].semantic_context.flow_documents, []);
  }
});

test("exact Flow body conflicts and conflicts with original context fail closed", () => {
  const different = structuredClone(flow);
  different.flowDataSet.modellingAndValidation.LCIMethod.typeOfDataSet = "Elementary flow";
  assert.throws(
    () => projectFoundryValidationReferences([row], [flow, different]),
    /conflicting complete bodies/u,
  );
  const contextual = { ...row, semantic_context: { flow_documents: [different] } };
  assert.throws(
    () => projectFoundryValidationReferences([contextual], [flow]),
    /conflicts with original/u,
  );
});

test("a wrong Flow type is retained verbatim for SDK judgment, never rewritten to Product flow", () => {
  const wrong = structuredClone(flow);
  wrong.flowDataSet.modellingAndValidation.LCIMethod.typeOfDataSet = "Elementary flow";
  const projected = projectFoundryValidationReferences([row], [wrong]) as Array<{
    semantic_context: { flow_documents: unknown[] };
  }>;
  assert.deepEqual(projected[0].semantic_context.flow_documents, [wrong]);
});

test("queue references require every selected exact Flow version in complete payloads", () => {
  const versionTwo = structuredClone(flow);
  versionTwo.flowDataSet.administrativeInformation.publicationAndOwnership[
    "common:dataSetVersion"
  ] = "00.00.002";
  const process = {
    processDataSet: {
      ...json.processDataSet,
      exchanges: {
        exchange: [
          json.processDataSet.exchanges.exchange,
          { referenceToFlowDataSet: { "@refObjectId": id, "@version": "00.00.002" } },
        ],
      },
    },
  };
  assert.deepEqual(selectedFoundryExternalFlowReferences([process], [flow]), []);
  assert.deepEqual(selectedFoundryExternalFlowReferences([process], [flow, versionTwo]), [
    { id, version: "00.00.001", source: "selected_read_only_qa_reference" },
    { id, version: "00.00.002", source: "selected_read_only_qa_reference" },
  ]);
  const missing = structuredClone(versionTwo) as Record<string, unknown>;
  const root = missing.flowDataSet as Record<string, unknown>;
  const publication = (root.administrativeInformation as Record<string, unknown>)
    .publicationAndOwnership as Record<string, unknown>;
  delete publication["common:dataSetVersion"];
  for (const document of [flow, missing])
    assert.deepEqual(
      selectedFoundryExternalFlowReferences(
        [process],
        [flow, { id, version: "00.00.002", json: document }],
      ),
      [],
      "wrapper metadata cannot supply the wrong or absent payload version",
    );
});

test("published CLI 0.1.28 keeps real SDK allocation outcomes for projected exact evidence", async (t) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { describeCliRuntime } = await import("@tiangong-lca/cli/runtime");
  const { captureFoundryInput } = await import("../../scripts/lib/foundry-runtime-context.ts");
  const { readPreparationCliEvidence } =
    await import("../../scripts/lib/foundry-preparation-cli-validation.ts");
  assert.equal(describeCliRuntime().package.version, "0.1.28");
  const fixture = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  );
  fixture.payload.processDataSet.exchanges.exchange[0].allocations.allocation[
    "@internalReferenceToCoProduct"
  ] = "1";
  const base = { json: fixture.payload };
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "readonly-flow-validation-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.resolve(
    import.meta.dirname,
    "../../node_modules/@tiangong-lca/cli/bin/tiangong-lca.js",
  );
  const original = JSON.stringify(base);
  for (const kind of ["complete", "missing", "wrong-version", "wrong-type"] as const) {
    await t.test(kind, () => {
      const documents = structuredClone(fixture.context.flow_documents);
      if (kind === "wrong-version")
        documents[0].flowDataSet.administrativeInformation.publicationAndOwnership[
          "common:dataSetVersion"
        ] = "01.00.001";
      if (kind === "wrong-type")
        documents[0].flowDataSet.modellingAndValidation.LCIMethod.typeOfDataSet = "Elementary flow";
      const rows = projectFoundryValidationReferences([base], kind === "missing" ? [] : documents);
      const input = path.join(root, `${kind}.json`),
        output = path.join(root, kind);
      fs.writeFileSync(input, JSON.stringify(rows));
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "dataset",
          "validate",
          "--input",
          input,
          "--type",
          "process",
          "--out-dir",
          output,
          "--json",
        ],
        { encoding: "utf8" },
      );
      assert.ok([0, 1].includes(result.status ?? -1), result.stderr);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(
        report,
        JSON.parse(fs.readFileSync(path.join(output, "outputs/validation-report.json"), "utf8")),
      );
      assert.equal(report.input_path, input);
      const semantic = report.rows[0].allocation_semantics;
      assert.equal(semantic.profile, "tidas.process-allocation-reference.v1");
      assert.equal(semantic.candidate_sha256, sha256Json(fixture.payload));
      assert.equal(JSON.stringify(base), original);
      const receipt = {
        report: path.join(output, "outputs/validation-report.json"),
        exit: result.status!,
        input: captureFoundryInput(input),
      };
      const sourceInput = path.join(root, "process-source.rows.json");
      assert.deepEqual(readPreparationCliEvidence(receipt, [base], sourceInput).rows, report.rows);
      assert.throws(
        () =>
          readPreparationCliEvidence(
            { report: receipt.report, exit: receipt.exit },
            [base],
            sourceInput,
          ),
        /Owner CLI validation/u,
        "a validation wrapper cannot substitute for unbound source rows",
      );
      if (kind === "complete") {
        assert.equal(semantic.status, "passed", JSON.stringify(semantic));
        assert.equal(semantic.dependencies.length, 1);
        assert.equal(semantic.dependencies[0].content_sha256, sha256Json(documents[0]));
      } else {
        assert.notEqual(semantic.status, "passed", JSON.stringify(semantic));
        assert.ok(semantic.issues.length > 0);
      }
    });
  }
});
