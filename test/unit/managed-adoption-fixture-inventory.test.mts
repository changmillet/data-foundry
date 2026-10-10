import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { managedInventory } from "../helpers/managed-adoption-fixture.mts";

test("declared native fixture executables retain portable archive modes without host execute bits", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-portable-native-inventory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "bin"));
  const executables = ["bin/node.exe", "bin/tidas.ts"];
  for (const file of [...executables, "metadata.json"]) {
    fs.writeFileSync(path.join(root, file), file);
    fs.chmodSync(path.join(root, file), 0o644);
  }
  const observed = managedInventory(root);
  assert.ok(observed.every((file) => file.mode === 420));
  const portable = managedInventory(root, "", true, executables);
  assert.deepEqual(
    portable.map((file) => ({ path: file.path, mode: file.mode })),
    [
      { path: "bin/node.exe", mode: 493 },
      { path: "bin/tidas.ts", mode: 493 },
      { path: "metadata.json", mode: 420 },
    ],
  );
  assert.deepEqual(
    portable.map(({ mode: _mode, ...file }) => file),
    observed.map(({ mode: _mode, ...file }) => file),
  );
  assert.deepEqual(managedInventory(root), observed);
});
