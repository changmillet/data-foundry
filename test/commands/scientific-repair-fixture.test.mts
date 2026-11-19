import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { createFoundryIsolatedChildEnvironment } from "../../scripts/lib/foundry-runtime-environment.ts";
import { projectFoundryValidationReferences } from "../../scripts/lib/foundry-validation-reference-context.ts";
import { foundryProcessQa } from "../../scripts/lib/foundry-process-qa.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import type { MassReferenceEvidence } from "../../scripts/lib/foundry-process-mass-balance.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;
test("scientific repair fixture passes the published CLI schema/business checks and exact mass-unit QA", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-scientific-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = object(
    JSON.parse(
      fs.readFileSync(
        new URL("../fixtures/scientific-repair-provider-input.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const baseline = object(input.baseline);
  const rows = (baseline.documents as Json[]).filter((row) =>
    ["flow", "flowproperty", "unitgroup"].includes(String(object(row.identity).dataset_type)),
  );
  const documents = rows.map((row) => object(row.document));
  const candidate = object((input.overlays as Json[])[0].document);
  const projected = object(projectFoundryValidationReferences([candidate], documents)[0]);
  const file = path.join(root, "candidate.json");
  fs.writeFileSync(file, JSON.stringify({ ...candidate, ...projected }));
  const references = path.join(root, "references.json");
  fs.writeFileSync(references, JSON.stringify({ documents }));
  const command = resolveInstalledTiangongLcaCliPackage();
  const run = spawnSync(
    process.execPath,
    [
      command.binPath,
      "dataset",
      "process",
      "validate",
      "--input",
      file,
      "--checks",
      "schema,business",
      "--reference-documents",
      references,
      "--output",
      path.join(root, "validation.json"),
      "--json",
    ],
    {
      cwd: root,
      env: createFoundryIsolatedChildEnvironment({ tempRoot: path.join(root, "runtime") }),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = object(JSON.parse(run.stdout));
  assert.equal(report.status, "completed", JSON.stringify(report));
  assert.equal(object(object(report.data).validation).status, "passed");
  const evidence: MassReferenceEvidence = {
    rows: new Map(
      rows.map((row) => {
        const identity = object(row.identity);
        const payload = object(row.document);
        return [
          `${identity.dataset_type}/${identity.id}/${identity.version}`,
          { payload, sha256: sha256Json(payload) },
        ];
      }),
    ),
  };
  const qa = foundryProcessQa([candidate], evidence);
  assert.deepEqual(qa.findings, []);
  assert.equal(qa.mass_balance[0].input_mass_kg, 1.2);
  assert.equal(qa.mass_balance[0].output_mass_kg, 1.2);
  assert.equal(qa.mass_balance[0].delta, 0);
  const unbalanced = structuredClone(candidate);
  const exchanges = object(object(unbalanced.processDataSet).exchanges).exchange as Json[];
  exchanges[0].meanAmount = "1";
  exchanges[0].resultingAmount = "1";
  assert.ok(
    foundryProcessQa([unbalanced], evidence).findings.some(
      (finding) => finding.code === "process_material_balance_deviation",
    ),
  );
});
