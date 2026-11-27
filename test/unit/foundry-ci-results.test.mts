import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  loadFoundryTestPlan,
  foundryPlatformTestShards,
  planFoundryTestShards,
} from "../../devops/ci/foundry-ci-plan.ts";
import { foundryCiPlatforms, verifyFoundryTestShards } from "../../devops/ci/foundry-ci-results.ts";
const source = "a".repeat(40);
const plan = planFoundryTestShards(["test/unit/a.test.mts", "test/unit/b.test.mts"], {}, 2);
function receipts(): Record<string, unknown>[] {
  return foundryCiPlatforms.flatMap((platform) =>
    plan.shards.map((shard) => ({
      schema: "tiangong-foundry.ci-test-shard.v1",
      status: "passed",
      source,
      platform,
      plan_sha256: plan.planSha256,
      index: shard.index,
      total: shard.total,
      files: shard.files,
      errors: [],
      counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0 },
    })),
  );
}
test("CI aggregation requires the complete partition on every supported host", () => {
  const result = verifyFoundryTestShards(receipts(), source, plan);
  assert.equal(result.files_per_platform, 2);
  for (const platform of foundryCiPlatforms) assert.equal(result.platforms[platform].passed, 2);
  assert.throws(() => verifyFoundryTestShards(receipts().slice(1), source, plan), /Incomplete/);
  const duplicate = receipts();
  duplicate[1] = duplicate[0];
  assert.throws(() => verifyFoundryTestShards(duplicate, source, plan), /Duplicate/);
});
test("CI aggregation rejects stale, skipped, foreign and mixed execution evidence", () => {
  for (const change of [
    { source: "b".repeat(40) },
    { plan_sha256: "b".repeat(64) },
    { status: "failed" },
    { status: "skipped" },
    { platform: "darwin-x64" },
    { files: [] },
    { errors: ["missing file"] },
    { total: 3 },
  ]) {
    const input = receipts();
    input[0] = { ...input[0], ...change };
    assert.throws(() => verifyFoundryTestShards(input, source, plan), /differs/);
  }
  const input = receipts();
  input[0].counts = {
    tests: 1,
    passed: 0,
    failed: 0,
    cancelled: 1,
    skipped: 0,
    todo: 0,
    suites: 0,
  };
  assert.throws(() => verifyFoundryTestShards(input, source, plan), /finish/);
});

test("CI aggregation requires all host-specific receipts and rejects cross-platform substitution", () => {
  const plan = loadFoundryTestPlan(path.resolve(import.meta.dirname, "../.."));
  const rows = foundryCiPlatforms.flatMap((platform) =>
    foundryPlatformTestShards(plan, platform).map((shard) => ({
      schema: "tiangong-foundry.ci-test-shard.v1",
      status: "passed",
      source,
      platform,
      plan_sha256: plan.planSha256,
      index: shard.index,
      total: shard.total,
      files: shard.files,
      errors: [],
      counts: {
        tests: shard.files.length,
        passed: shard.files.length,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        todo: 0,
        suites: 0,
      },
    })),
  );
  assert.equal(rows.length, 32);
  assert.equal(rows.at(-1)?.platform, "win32-x64");
  assert.equal(rows.at(-1)?.index, 14);
  verifyFoundryTestShards(rows, source, plan);
  assert.throws(() => verifyFoundryTestShards(rows.slice(0, -1), source, plan), /Incomplete/);
  const duplicate = structuredClone(rows);
  duplicate[duplicate.length - 1] = duplicate[duplicate.length - 2];
  assert.throws(() => verifyFoundryTestShards(duplicate, source, plan), /Duplicate/);
  const foreign = structuredClone(rows);
  foreign[foreign.length - 1].platform = "linux-x64";
  foreign[foreign.length - 1].index = 1;
  foreign[foreign.length - 1].total = 8;
  assert.throws(() => verifyFoundryTestShards(foreign, source, plan), /differs/);
  const undeclared = structuredClone(rows);
  undeclared[0].index = 10;
  assert.throws(() => verifyFoundryTestShards(undeclared, source, plan), /differs/);
  const stale = structuredClone(rows);
  stale[0].plan_sha256 = "f".repeat(64);
  assert.throws(() => verifyFoundryTestShards(stale, source, plan), /differs/);
  const linuxOnly = rows.filter((row) => row.platform === "linux-x64");
  assert.equal(linuxOnly.length, 8);
  const fastSummary = verifyFoundryTestShards(linuxOnly, source, plan, ["linux-x64"]);
  assert.deepEqual(Object.keys(fastSummary.platforms), ["linux-x64"]);
  assert.throws(
    () => verifyFoundryTestShards(linuxOnly, source, plan),
    /Incomplete/,
    "Four-platform verification must never accept a linux-only pr-fast shard set.",
  );
  assert.throws(
    () => verifyFoundryTestShards(linuxOnly.slice(1), source, plan, ["linux-x64"]),
    /Incomplete/,
  );
  assert.throws(() => verifyFoundryTestShards(rows, source, plan, ["linux-x64"]), /Incomplete/);
});
