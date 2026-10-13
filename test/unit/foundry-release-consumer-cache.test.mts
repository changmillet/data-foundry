import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFoundryRetainedConsumerCache,
  assertFoundryRetainedConsumerCache,
  discardFoundryRetainedConsumerCache,
  type FoundryRetainedConsumerCache,
} from "../../scripts/lib/foundry-release-consumer-cache.ts";
import {
  createFoundryRuntimeCandidateEntry,
  type qualifyFoundryRuntimeComponents,
} from "../../scripts/lib/foundry-release-runtime-qualification.ts";
import type { PreparedFoundryRuntimeComponents } from "../../scripts/lib/foundry-release-components.ts";

test("candidate cache is exclusive and cannot be rebound through a copied receipt or changed directory", () => {
  const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retained-cache-")));
  try {
    const binding = createFoundryRetainedConsumerCache(output);
    assertFoundryRetainedConsumerCache(binding);
    assert.throws(() => createFoundryRetainedConsumerCache(output), /exist/u);
    assert.throws(
      () => assertFoundryRetainedConsumerCache({ ...binding }),
      /process-local original path binding/u,
    );
    const old = path.join(output, "previous-cache");
    fs.renameSync(binding.path, old);
    fs.mkdirSync(binding.path);
    fs.writeFileSync(path.join(binding.path, "foreign-file"), "preserve");
    assert.throws(
      () => assertFoundryRetainedConsumerCache(binding),
      /changed its original physical path binding/u,
    );
    discardFoundryRetainedConsumerCache(binding);
    assert.equal(fs.readFileSync(path.join(binding.path, "foreign-file"), "utf8"), "preserve");
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("a retained cache symlink is rejected and never removed as an owned cache", () => {
  const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-retained-cache-")));
  try {
    const binding = createFoundryRetainedConsumerCache(output);
    const old = path.join(output, "previous-cache");
    fs.renameSync(binding.path, old);
    fs.symlinkSync(old, binding.path, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => assertFoundryRetainedConsumerCache(binding), /physical path binding/u);
    discardFoundryRetainedConsumerCache(binding);
    assert.equal(fs.lstatSync(binding.path).isSymbolicLink(), true);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("serialized qualification can never manufacture a candidate entry or a retained cache selection", () => {
  const restored = JSON.parse(
    '{"status":"passed","consumer_cache":{"path":"/tmp/chosen"}}',
  ) as Awaited<ReturnType<typeof qualifyFoundryRuntimeComponents>>;
  assert.throws(
    () =>
      createFoundryRuntimeCandidateEntry(
        JSON.parse("{}") as PreparedFoundryRuntimeComponents,
        restored,
      ),
    /fresh in-process qualification/u,
  );
  assert.throws(
    () =>
      assertFoundryRetainedConsumerCache(
        JSON.parse('{"path":"/tmp/chosen"}') as FoundryRetainedConsumerCache,
      ),
    /process-local original path binding/u,
  );
});
