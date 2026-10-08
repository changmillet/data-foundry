import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  loadFoundryTestPlan,
  foundryPlatformTestShards,
  planFoundryTestShards,
} from "../../scripts/lib/foundry-ci-plan.ts";
import {
  foundryCiPlatforms,
  verifyFoundryTestShards,
} from "../../scripts/lib/foundry-ci-results.ts";
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

test("CI aggregation requires all20 host-specific receipts and rejects cross-platform substitution", () => {
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
  assert.equal(rows.length, 20);
  verifyFoundryTestShards(rows, source, plan);
  assert.throws(() => verifyFoundryTestShards(rows.slice(0, -1), source, plan), /Incomplete/);
  const duplicate = structuredClone(rows);
  duplicate[duplicate.length - 1] = duplicate[duplicate.length - 2];
  assert.throws(() => verifyFoundryTestShards(duplicate, source, plan), /Duplicate/);
  const foreign = structuredClone(rows);
  foreign[foreign.length - 1].platform = "linux-x64";
  assert.throws(() => verifyFoundryTestShards(foreign, source, plan), /differs/);
  const stale = structuredClone(rows);
  stale[0].plan_sha256 = "f".repeat(64);
  assert.throws(() => verifyFoundryTestShards(stale, source, plan), /differs/);
});
