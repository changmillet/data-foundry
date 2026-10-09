import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

const read = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`../../specs/schemas/${name}`, import.meta.url), "utf8"));
test("managed adoption control is a strict component reference contract, never task authority", () => {
  const validate = new Ajv2020({ strict: true })
    .addSchema(read("tidas-runtime-expectation.schema.json"))
    .addSchema(read("foundry-managed-runtime.schema.json"))
    .compile(read("foundry-managed-adoption.schema.json"));
  const value = {
    schema: "tiangong-foundry.managed-adoption.v1",
    platform: "darwin-arm64",
    successor_manifest: { component: "control", path: "metadata/successor.json" },
    launches: [
      {
        id: "foundry",
        qualification: { component: "control", path: "metadata/qualification.json" },
      },
      { id: "foundry-read", qualification: null },
    ],
  };
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  for (const invalid of [
    { ...value, schema: "tiangong-foundry.managed-adoption.v999" },
    { ...value, qualification_sha256: "a".repeat(64) },
    { ...value, engineering_generation: 2 },
    { ...value, launches: [] },
    { ...value, launches: [value.launches[0], value.launches[0]] },
    { ...value, launches: [{ id: "foundry", qualification: { self_reviewed: true } }] },
    { ...value, successor_manifest: { component: "control", path: "../task/qualification.json" } },
    { ...value, successor_manifest: { component: "control", path: "/untrusted.json" } },
  ])
    assert.equal(validate(invalid), false, JSON.stringify(invalid));
});
