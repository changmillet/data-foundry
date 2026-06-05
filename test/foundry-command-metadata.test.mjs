import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  commandCategories,
  commandMetadata,
  commandMetadataEntries,
} from "../scripts/lib/foundry-command-metadata.mjs";
import {
  datasetPolicyCommands,
  knownCommands,
  publicCommands,
} from "../scripts/lib/foundry-command-registry.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const allowedCategories = new Set(commandCategories);

function repoFileExists(filePath) {
  return fs.existsSync(path.join(repoRoot, filePath));
}

function readRepoFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

test("foundry command metadata covers every registered command", () => {
  const metadataCommands = Object.keys(commandMetadata).sort();
  assert.deepEqual(metadataCommands, [...knownCommands].sort());
  assert.equal(commandMetadataEntries().length, knownCommands.length);
});

test("foundry command metadata classifies public and dataset commands", () => {
  for (const command of publicCommands) {
    assert.equal(
      commandMetadata[command].category,
      "public",
      `${command} should remain classified as a public command`,
    );
  }
  for (const command of datasetPolicyCommands) {
    assert.notEqual(
      commandMetadata[command].category,
      "public",
      `${command} should not be classified as a public command`,
    );
  }
});

test("foundry command metadata is navigable and evidence backed", () => {
  for (const entry of commandMetadataEntries()) {
    assert.ok(
      allowedCategories.has(entry.category),
      `${entry.command} has unknown category ${entry.category}`,
    );
    assert.ok(entry.ownerModule, `${entry.command} is missing ownerModule`);
    assert.ok(repoFileExists(entry.ownerModule), `${entry.command} owner module is missing`);
    assert.ok(entry.ownerExport, `${entry.command} is missing ownerExport`);
    assert.deepEqual(
      entry.navigationPath,
      ["scripts/foundry.mjs", "scripts/lib/foundry-cli.mjs", entry.ownerModule],
      `${entry.command} navigation path should be entrypoint -> dispatcher -> owner`,
    );
    assert.ok(entry.navigationPath.every(repoFileExists), `${entry.command} navigation path has a missing file`);
    assert.ok(entry.inputs.length > 0, `${entry.command} should declare input artifacts`);
    assert.ok(entry.outputs.length > 0, `${entry.command} should declare output artifacts`);
    assert.ok(entry.keyTests.length > 0, `${entry.command} should declare key tests`);
    assert.ok(entry.workflowEntry, `${entry.command} should declare workflowEntry audit state`);
    assert.ok(entry.workflowEntry.status, `${entry.command} workflowEntry should declare status`);
    assert.ok(entry.workflowEntry.entry_kind, `${entry.command} workflowEntry should declare entry_kind`);
    if (entry.category === "candidate-deprecate") {
      assert.equal(entry.workflowEntry.status, "candidate-deprecate");
      assert.ok(
        entry.deprecation?.deletionConditions?.length > 0,
        `${entry.command} candidate-deprecate command should declare deletion conditions`,
      );
    } else {
      assert.equal(entry.workflowEntry.status, "active", `${entry.command} should have active workflow audit state`);
      assert.equal(entry.deprecation, null, `${entry.command} active command should not carry deprecation conditions`);
    }
    for (const keyTest of entry.keyTests) {
      if (keyTest.path) {
        assert.ok(repoFileExists(keyTest.path), `${entry.command} key test path is missing: ${keyTest.path}`);
      }
      assert.ok(keyTest.kind, `${entry.command} key test is missing kind`);
    }
  }
});

test("public command implementation paths are at most two jumps from the CLI entrypoint", () => {
  for (const command of publicCommands) {
    const pathLength = commandMetadata[command].navigationPath.length;
    assert.ok(
      pathLength <= 3,
      `${command} should be reachable as foundry.mjs -> foundry-cli.mjs -> owner`,
    );
  }
});

test("command owners do not depend on bulk workflow implementation files", () => {
  for (const entry of commandMetadataEntries()) {
    const source = readRepoFile(entry.ownerModule);
    assert.equal(
      source.includes("legacy-implementation.mjs"),
      false,
      `${entry.command} owner must not import removed legacy implementation`,
    );
    assert.equal(
      source.includes("internal/workflow-domain.mjs"),
      false,
      `${entry.command} owner should import a semantic workflow facet instead of workflow-domain.mjs`,
    );
  }
});
