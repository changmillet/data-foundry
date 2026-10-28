import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

interface UriOptions {
  reference?: "suffix";
  scheme?: string;
}

interface UriResolver {
  parse(value: string): { scheme?: string; host?: string; error?: string };
  normalize(value: string, options?: UriOptions): string;
  resolve(base: string, reference: string): string;
  equal(left: string, right: string): boolean;
}

// Resolve through the real consumer so a second, safer root copy cannot mask
// the implementation that Ajv uses for schema identifiers and references.
const require = createRequire(import.meta.url);
const ajvRequire = createRequire(require.resolve("ajv/package.json"));
const uri = ajvRequire("fast-uri") as UriResolver;

test("Ajv's URI resolver does not activate percent-encoded schemes", () => {
  for (const value of [
    "%6Aavascript:alert(1)",
    "%u006Aavascript:alert(1)",
    "j%61vascript:alert(1)",
  ]) {
    assert.match(uri.parse(value).error ?? "", /scheme is malformed/u);
    assert.equal(uri.normalize(value), value);
    assert.equal(uri.equal(value, value), false);
    assert.throws(() => uri.resolve("https://schemas.example/app/", value), /scheme is malformed/u);
  }
  assert.equal(uri.equal("%68ttp://schemas.example/", "http://schemas.example/"), false);
});

test("Ajv's URI resolver rejects ambiguous hosts instead of rewriting their authority", () => {
  for (const value of [
    "http://a@b@evil.example/",
    "https://ev\til.example/",
    "https://ev\r\nil.example/",
  ]) {
    assert.match(uri.parse(value).error ?? "", /host is malformed/u);
    assert.equal(uri.normalize(value), value);
    assert.equal(uri.equal(value, value), false);
    assert.throws(() => uri.resolve("https://schemas.example/", value), /host is malformed/u);
  }
});

test("normalizing relative schema references preserves their resolution target", () => {
  const base = "https://schemas.example/contracts/process/request.json";
  for (const reference of [
    "../common.json",
    "a/../common.json",
    "./../common.json",
    ".//common.json",
  ]) {
    assert.equal(uri.resolve(base, uri.normalize(reference)), uri.resolve(base, reference));
  }
  assert.equal(uri.normalize("../common.json"), "../common.json");
  assert.equal(uri.equal("../common.json", "common.json"), false);
  assert.equal(
    uri.normalize("https://SCHEMAS.example/a/../common.json"),
    "https://schemas.example/common.json",
  );
});

test("suffix normalization keeps a colon-first path relative", () => {
  const normalized = uri.normalize("a/../javascript:alert(1)", {
    reference: "suffix",
    scheme: "x",
  });
  assert.equal(normalized, "./javascript:alert(1)");
  assert.equal(uri.parse(normalized).scheme, undefined);
});

test("the installed Ajv consumer retains local relative-reference validation", () => {
  const runtime = ajvRequire("ajv/dist/runtime/uri.js") as { default: UriResolver };
  assert.equal(runtime.default, uri);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema({
    $id: "https://schemas.example/contracts/common/quantity.json",
    type: "object",
    properties: { amount: { type: "number", exclusiveMinimum: 0 } },
    required: ["amount"],
    additionalProperties: false,
  });
  const validate = ajv.compile({
    $id: "https://schemas.example/contracts/process/request.json",
    type: "object",
    properties: { quantity: { $ref: "../common/quantity.json" } },
    required: ["quantity"],
    additionalProperties: false,
  });
  assert.equal(validate({ quantity: { amount: 1.25 } }), true);
  assert.equal(validate({ quantity: { amount: 0 } }), false);
  assert.equal(
    validate.errors?.some(
      (error) => error.instancePath === "/quantity/amount" && error.keyword === "exclusiveMinimum",
    ),
    true,
  );
  assert.equal(validate({ quantity: { amount: 1, extra: true } }), false);
  assert.equal(
    validate.errors?.some((error) => error.keyword === "additionalProperties"),
    true,
  );
});

test("Foundry's actual public input schemas still compile and reject incomplete inputs", () => {
  for (const filename of [
    "foundry-semantic-input.schema.json",
    "foundry-reference-input.schema.json",
    "foundry-quality-review-input.schema.json",
  ]) {
    const schema = JSON.parse(
      readFileSync(new URL(`../../specs/schemas/${filename}`, import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    assert.equal(ajv.validateSchema(schema), true, filename);
    const validate = ajv.compile(schema);
    assert.equal(validate({}), false, filename);
    assert.equal(
      validate.errors?.some((error) => error.keyword === "required"),
      true,
      filename,
    );
  }
});
