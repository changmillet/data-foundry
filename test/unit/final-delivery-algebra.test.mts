import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAssertion, evaluateOperand } from "../../scripts/lib/final-delivery-algebra.ts";
import type { ArtifactRuntime } from "../../scripts/lib/final-delivery-rows.ts";

function runtime(artifactId: string, actualRows: number | null, json?: unknown): ArtifactRuntime {
  return {
    descriptor: { artifact_id: artifactId, row_count: { kind: "csv" }, schema: "s" },
    buffer: null,
    parsed:
      json === undefined ? { rows: actualRows, scanText: "x" } : { json, rows: 1, scanText: "x" },
    actualRows,
    path: null,
  };
}

function artifacts(...entries: ArtifactRuntime[]): Map<string, ArtifactRuntime> {
  return new Map(entries.map((entry) => [entry.descriptor.artifact_id ?? "", entry]));
}

function evaluate(
  left: unknown,
  operator: string,
  right: unknown,
  map: Map<string, ArtifactRuntime>,
) {
  return evaluateAssertion({ check_id: "c", left, operator, right } as never, map);
}

test("algebra rejects implicit numeric coercion from non-numeric JSON values", () => {
  const map = artifacts(
    runtime("j", 1, { nullv: null, boolv: true, empty: "", arr: [1], obj: {} }),
  );
  for (const pointer of ["/nullv", "/boolv", "/empty", "/arr", "/obj"]) {
    assert.throws(
      () => evaluateOperand({ artifact_json: { artifact_id: "j", pointer } }, map),
      /not a finite number/u,
      pointer,
    );
  }
});

test("algebra accepts a real number and a strict numeric string from JSON", () => {
  const map = artifacts(runtime("j", 1, { num: 3.5, str: "42", exp: "1.5E2", neg: -2 }));
  assert.equal(evaluateOperand({ artifact_json: { artifact_id: "j", pointer: "/num" } }, map), 3.5);
  assert.equal(evaluateOperand({ artifact_json: { artifact_id: "j", pointer: "/str" } }, map), 42);
  assert.equal(evaluateOperand({ artifact_json: { artifact_id: "j", pointer: "/exp" } }, map), 150);
  assert.equal(evaluateOperand({ artifact_json: { artifact_id: "j", pointer: "/neg" } }, map), -2);
  assert.throws(
    () =>
      evaluateOperand(
        { artifact_json: { artifact_id: "j", pointer: "/str" } },
        artifacts(runtime("j", 1, { str: " 42 " })),
      ),
    /not a finite number/u,
    "whitespace-padded numeric text is not an explicit number",
  );
});

test("algebra rejects non-numeric literals instead of coercing them", () => {
  const map = artifacts(runtime("a", 1));
  for (const literal of [true, false, "", "1", null, [1], {}]) {
    assert.throws(() => evaluateOperand({ literal }, map), /finite/u, JSON.stringify(literal));
  }
});

test("algebra sum overflow cannot pass an equality or bound check", () => {
  const map = artifacts(runtime("a", 1));
  const overflow = { sum: [{ literal: 1e308 }, { literal: 1e308 }] };
  assert.equal(Number.isFinite(1e308 + 1e308), false, "the fixture must overflow");
  assert.throws(() => evaluateOperand(overflow, map), /finite/u);
  assert.throws(() => evaluate(overflow, "eq", overflow, map), /finite/u);
  assert.throws(() => evaluate({ artifact_rows: "a" }, "lte", overflow, map), /finite/u);
});

test("algebra rejects unsafe row counts and unsafe intermediate sums", () => {
  assert.throws(
    () =>
      evaluateOperand({ artifact_rows: "a" }, artifacts(runtime("a", Number.MAX_SAFE_INTEGER + 2))),
    /safe integer/u,
  );
  assert.throws(
    () => evaluateOperand({ artifact_rows: "a" }, artifacts(runtime("a", null))),
    /unavailable/u,
  );
  assert.throws(
    () =>
      evaluateOperand(
        { sum: [{ literal: Number.MAX_SAFE_INTEGER }, { literal: 2 }] },
        artifacts(runtime("a", 1)),
      ),
    /safe integer/u,
  );
});

test("algebra keeps the legitimate equality, bound, and sum contract", () => {
  const map = artifacts(runtime("a", 2), runtime("b", 3));
  assert.equal(evaluate({ artifact_rows: "a" }, "eq", { literal: 2 }, map).passed, true);
  assert.equal(evaluate({ artifact_rows: "a" }, "lte", { literal: 3 }, map).passed, true);
  assert.equal(evaluate({ artifact_rows: "b" }, "gte", { literal: 3 }, map).passed, true);
  assert.equal(evaluate({ artifact_rows: "a" }, "eq", { literal: 3 }, map).passed, false);
  assert.equal(
    evaluateOperand({ sum: [{ artifact_rows: "a" }, { artifact_rows: "b" }, { literal: 1 }] }, map),
    6,
  );
});
