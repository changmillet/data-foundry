import assert from "node:assert/strict";
import test from "node:test";
import {
  managedPreparationCases,
  managedPreparationGroups,
} from "../helpers/managed-process-preparation.mts";
import {
  registeredPreparationCases,
  registeredPreparationGroups,
} from "../helpers/registered-process-preparation.mts";

test("installed preparation groups preserve the exact fourteen public managed case identities once", () => {
  const expected = [
    "annual-invalid",
    "annual-unknown",
    "input-product",
    "output-product",
    "input-waste",
    "output-waste",
    "elementary",
    "unresolved",
    "wrong-version",
    "undeclared",
    "scalar-empty",
    "legacy-full",
    "legacy-percent",
    "legacy-output-share",
  ].sort();
  const names = Object.values(managedPreparationGroups).flat();
  assert.equal(new Set(names).size, expected.length);
  assert.deepEqual([...names].sort(), expected);
  assert.deepEqual(managedPreparationCases.map(([name]) => name).sort(), expected);
});
test("registered preparation groups preserve exact ten owner CLI case identities once", () => {
  const expected = [
    "nonannual",
    "unknown",
    "fixed",
    "allocation-input-product",
    "allocation-output-product",
    "allocation-input-waste",
    "allocation-output-waste",
    "allocation-elementary",
    "allocation-absent",
    "allocation-wrong-version",
  ].sort();
  const names = Object.values(registeredPreparationGroups).flat();
  assert.equal(new Set(names).size, expected.length);
  assert.deepEqual([...names].sort(), expected);
  assert.deepEqual(registeredPreparationCases.map(([name]) => name).sort(), expected);
});
