import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

import {
  createTypedContextCommand,
  projectTypedContext,
} from "../../scripts/lib/foundry-typed-context.ts";

const output = path.resolve("typed-contract.json");
const schema = '{"type":"object"}';
const methodology = "method: example\n";
const ruleset = { rules: [] };

function describe(text: string) {
  return {
    bytes: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function response(type = "flow", { includeRules = true } = {}) {
  const contract = {
    source: "sdk-contract-api",
    manifest: {
      kind: type,
      profile: "default",
      schema: describe(schema),
      methodology: includeRules ? describe(methodology) : null,
      ruleset: includeRules ? describe(JSON.stringify(ruleset, null, 2)) : null,
    },
    components: {
      schema,
      methodology: includeRules ? methodology : null,
      ruleset: includeRules ? ruleset : null,
    },
    unavailable: includeRules ? [] : ["methodology", "ruleset"],
  };
  const bytes = Buffer.from(JSON.stringify(contract));
  return {
    contract,
    bytes,
    report: {
      schemaVersion: 1,
      operation: `dataset ${type === "lifecyclemodel" ? "model" : type} contract`,
      status: "completed",
      outcome: "contract_read",
      artifacts: [{ path: output, purpose: "complete_result", bytes: bytes.length }],
    },
  };
}

test("typed contracts use the Model route and retain the dataset type for task artifacts", () => {
  assert.deepEqual(createTypedContextCommand("lifecyclemodel", output), [
    "dataset",
    "model",
    "contract",
    "--include",
    "schema,methodology,ruleset",
    "--output",
    output,
    "--json",
  ]);
  const { report, bytes } = response("lifecyclemodel", { includeRules: false });
  const projected = projectTypedContext("lifecyclemodel", output, report, bytes);
  assert.deepEqual(
    projected.files.map(({ key }) => key),
    ["schema"],
  );
  assert.equal(projected.manifest.kind, "lifecyclemodel");
  assert.equal(projected.profile, "default");
});

test("typed Flow context projects the exact CLI components for task validation", () => {
  const { report, bytes } = response();
  const projected = projectTypedContext("flow", output, report, bytes);
  assert.deepEqual(projected.files, [
    { key: "schema", name: "schema.json", text: schema },
    { key: "methodology", name: "methodology.yaml", text: methodology },
    { key: "ruleset", name: "runtime-ruleset.json", text: JSON.stringify(ruleset, null, 2) },
  ]);
});

test("typed context rejects a wrong identity, unbound output, changed content or incomplete Flow", () => {
  const { report, contract, bytes } = response();
  assert.throws(() => projectTypedContext("process", output, report, bytes), /contract receipt/);
  assert.throws(
    () => projectTypedContext("flow", `${output}.other`, report, bytes),
    /contract receipt/,
  );
  assert.throws(
    () =>
      projectTypedContext(
        "flow",
        output,
        report,
        Buffer.from(
          JSON.stringify({
            ...contract,
            components: { ...contract.components, schema: schema.replace("object", "string") },
          }),
        ),
      ),
    /schema digest/,
  );
  const missing = response("flow", { includeRules: false });
  assert.throws(
    () => projectTypedContext("flow", output, missing.report, missing.bytes),
    /missing methodology/,
  );
});
