import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  FOUNDRY_AUTHORIZATION_INPUT_SCHEMA,
  parseFoundryAuthorizationInput,
} from "../../scripts/lib/foundry-authorization-input.ts";

const taskId = `task-${"a".repeat(64)}-r0001`;
const sha = (seed: string) => seed.repeat(64).slice(0, 64);
const preparation = { file: "outputs/repair/report.json", sha256: sha("d") };

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: FOUNDRY_AUTHORIZATION_INPUT_SCHEMA,
    task_id: taskId,
    actor_id: "identity-actor",
    finalization_sha256: sha("d"),
    dataset_type: "process",
    input_kind: "repair_rows",
    input_sha256: sha("b"),
    expected_previous_sha256: null,
    execution_contract: { file: "repair-inputs/contract.json", sha256: sha("c") },
    repair_preparation: preparation,
    grant: { file: "grant.json", sha256: sha("e") },
    evidence: [
      { id: "approval-1", kind: "user-decision", file: "decision.json", sha256: sha("f") },
    ],
    ...overrides,
  };
}

test("a repair scope is the repair_rows kind bound to its registered preparation report", () => {
  const parsed = parseFoundryAuthorizationInput(descriptor());
  assert.equal(parsed.input_kind, "repair_rows");
  assert.deepEqual(parsed.repair_preparation, preparation);
  assert.equal(Object.isFrozen(parsed.repair_preparation), true);
});

test("an ordinary descriptor still parses byte-identically without any repair key", () => {
  const ordinary: Record<string, unknown> = descriptor();
  delete ordinary.repair_preparation;
  ordinary.input_kind = "final_rows";
  delete ordinary.execution_contract;
  const parsed = parseFoundryAuthorizationInput(ordinary);
  assert.equal(parsed.input_kind, "final_rows");
  assert.equal(Object.hasOwn(parsed, "repair_preparation"), false);
  assert.equal(Object.hasOwn(parsed, "execution_contract"), false);
});

test("a repair scope never passes a finalization digest as its authority", () => {
  assert.throws(
    () => parseFoundryAuthorizationInput(descriptor({ finalization_sha256: sha("9") })),
    /preparation report digest/u,
  );
});

test("the repair kind and the preparation reference must appear together", () => {
  const withoutKind = descriptor({ input_kind: "final_rows" });
  assert.throws(() => parseFoundryAuthorizationInput(withoutKind), /repair_rows input kind/u);
  const withoutPreparation = descriptor();
  delete withoutPreparation.repair_preparation;
  assert.throws(
    () => parseFoundryAuthorizationInput(withoutPreparation),
    /repair_rows input kind/u,
  );
});

test("a repair scope admits only Process and always carries the native contract", () => {
  assert.throws(
    () => parseFoundryAuthorizationInput(descriptor({ dataset_type: "flow" })),
    /Process owner drafts/u,
  );
  const withoutContract = descriptor();
  delete withoutContract.execution_contract;
  assert.throws(
    () => parseFoundryAuthorizationInput(withoutContract),
    /always carries the selected native execution contract/u,
  );
});

test("the published descriptor schema agrees with the repair parser", () => {
  const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
    compile: (schema: unknown) => (value: unknown) => boolean;
  };
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(
      fs.readFileSync(
        new URL("../../specs/schemas/foundry-authorization-input.schema.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.equal(validate(descriptor()), true);
  const ordinary = descriptor();
  delete ordinary.repair_preparation;
  ordinary.input_kind = "final_rows";
  assert.equal(validate(ordinary), true, "the ordinary native descriptor stays valid unchanged");
  for (const [label, change] of [
    ["a repair scope is Process-only", { dataset_type: "flow" }],
    ["the repair kind always carries its preparation", { repair_preparation: undefined }],
    ["the repair kind always carries its native contract", { execution_contract: undefined }],
    ["an ordinary kind never carries a repair preparation", { input_kind: "current_rows" }],
  ] as const) {
    const value = descriptor(change);
    assert.equal(validate(value), false, label);
    assert.throws(() => parseFoundryAuthorizationInput(value), label);
  }
});

test("an unsupported input kind or malformed preparation reference is refused", () => {
  assert.throws(
    () => parseFoundryAuthorizationInput(descriptor({ input_kind: "repair" })),
    /current task, scope, finalization and explicit evidence/u,
  );
  for (const bad of [
    { file: "outputs/repair/report.json" },
    { file: "", sha256: sha("d") },
    { file: "outputs/repair/report.json", sha256: "not-a-hash" },
    { file: "outputs/repair/report.json", sha256: sha("d"), extra: 1 },
  ])
    assert.throws(
      () => parseFoundryAuthorizationInput(descriptor({ repair_preparation: bad })),
      /Authorization input has missing or unsupported fields|Authorization file reference is invalid/u,
      JSON.stringify(bad),
    );
});
