import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureImmutableComponentFile,
  clearImmutableDigestCacheForTest,
  immutableDigestCacheSizeForTest,
  snapshotImmutableDirectoryTree,
} from "../../src/lib/immutable-digest-cache.ts";

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

test("captureImmutableComponentFile caches stable files and invalidates on content, mtime, chmod, or symlink tamper", (t) => {
  clearImmutableDigestCacheForTest();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-immutable-digest-cache-"));
  t.after(() => {
    clearImmutableDigestCacheForTest();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const target = path.join(root, "component.bin");
  const initialPayload = Buffer.from("immutable-component-payload-v1\n", "utf8");
  fs.writeFileSync(target, initialPayload, { mode: 0o644 });
  // Backdate mtime past filesystem clock granularity window to exercise steady-state cache hits.
  const pastSeconds = (Date.now() - 5_000) / 1000;
  fs.utimesSync(target, pastSeconds, pastSeconds);

  const first = captureImmutableComponentFile(target);
  assert.equal(first.bytes, initialPayload.length);
  assert.equal(first.sha256, sha256(initialPayload));
  assert.equal(first.stableForCache, true);
  assert.equal(immutableDigestCacheSizeForTest(), 1);

  const second = captureImmutableComponentFile(target);
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.fingerprint, first.fingerprint);

  // Same-length byte overwrite updates mtime/content and must never return stale digest.
  const replacedSameLength = Buffer.from("immutable-component-payload-v2\n", "utf8");
  assert.equal(replacedSameLength.length, initialPayload.length);
  fs.writeFileSync(target, replacedSameLength, { mode: 0o644 });
  const third = captureImmutableComponentFile(target);
  assert.equal(third.sha256, sha256(replacedSameLength));
  assert.notEqual(third.sha256, first.sha256);

  // Symlink replacement must fail closed.
  const outside = path.join(root, "outside.txt");
  fs.writeFileSync(outside, "outside\n");
  const linkPath = path.join(root, "linked.bin");
  fs.symlinkSync(outside, linkPath);
  let invalidReason: string | null = null;
  assert.throws(() =>
    captureImmutableComponentFile(linkPath, {
      onInvalid: (reason) => {
        invalidReason = reason;
        throw new Error(`rejected:${reason}`);
      },
    }),
  );
  assert.equal(invalidReason, "missing_or_linked");
});

test("snapshotImmutableDirectoryTree detects added, removed, modified, and symlinked entries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-immutable-tree-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules/ignored.js"), "ignored\n");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  const fileA = path.join(root, "a.json");
  const fileB = path.join(root, "sub/b.js");
  fs.writeFileSync(fileA, '{"ok":true}\n');
  fs.writeFileSync(fileB, "export const x = 1;\n");
  const pastSeconds = (Date.now() - 5_000) / 1000;
  fs.utimesSync(fileA, pastSeconds, pastSeconds);
  fs.utimesSync(fileB, pastSeconds, pastSeconds);

  const skip = new Set(["node_modules"]);
  const snap1 = snapshotImmutableDirectoryTree(root, { skipTopLevelDirectories: skip });
  const snap2 = snapshotImmutableDirectoryTree(root, { skipTopLevelDirectories: skip });
  assert.deepEqual(snap1.files, ["a.json", "sub/b.js"]);
  assert.equal(snap1.allFilesStableForCache, true);
  assert.equal(snap1.treeFingerprint, snap2.treeFingerprint);

  // Touching a file changes treeFingerprint immediately.
  fs.writeFileSync(fileB, "export const x = 2;\n");
  const snap3 = snapshotImmutableDirectoryTree(root, { skipTopLevelDirectories: skip });
  assert.notEqual(snap3.treeFingerprint, snap1.treeFingerprint);

  // Adding a file changes both files list and treeFingerprint.
  fs.writeFileSync(path.join(root, "extra.txt"), "extra\n");
  const snap4 = snapshotImmutableDirectoryTree(root, { skipTopLevelDirectories: skip });
  assert.deepEqual(snap4.files, ["a.json", "extra.txt", "sub/b.js"]);
  assert.notEqual(snap4.treeFingerprint, snap3.treeFingerprint);

  // Adding a symlink inside the tree fails closed.
  fs.symlinkSync(fileA, path.join(root, "sub/link.json"));
  assert.throws(() => snapshotImmutableDirectoryTree(root, { skipTopLevelDirectories: skip }));
});
