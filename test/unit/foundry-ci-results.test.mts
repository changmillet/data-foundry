import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs";
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
  assert.equal(rows.length, 26);
  assert.equal(rows.at(-1)?.platform, "win32-x64");
  assert.equal(rows.at(-1)?.index, 10);
  verifyFoundryTestShards(rows, source, plan);
  assert.throws(() => verifyFoundryTestShards(rows.slice(0, -1), source, plan), /Incomplete/);
  const duplicate = structuredClone(rows);
  duplicate[duplicate.length - 1] = duplicate[duplicate.length - 2];
  assert.throws(() => verifyFoundryTestShards(duplicate, source, plan), /Duplicate/);
  const foreign = structuredClone(rows);
  foreign[foreign.length - 1].platform = "linux-x64";
  foreign[foreign.length - 1].index = 1;
  foreign[foreign.length - 1].total = 4;
  assert.throws(() => verifyFoundryTestShards(foreign, source, plan), /differs/);
  const undeclared = structuredClone(rows);
  undeclared[0].index = 10;
  assert.throws(() => verifyFoundryTestShards(undeclared, source, plan), /differs/);
  const stale = structuredClone(rows);
  stale[0].plan_sha256 = "f".repeat(64);
  assert.throws(() => verifyFoundryTestShards(stale, source, plan), /differs/);
});

import {
  captureFoundryCiTestHost,
  type FoundryCiTestHostContext,
} from "../../scripts/lib/foundry-ci-test-host.ts";

const hostFacts: Record<string, unknown> = {
  runner_os: "Windows",
  image_os: "win25-vs2026",
  image_version: "20261116.315.1",
  os_release: "10.0.26100",
  architecture: "x64",
  cpu_models: ["AMD EPYC 9V45 96-Core Processor                "],
  logical_cpus: 4,
  available_parallelism: 4,
  node_version: "v24.19.0",
  node_sha256: "a".repeat(64),
  pnpm_version: "11.24.0",
  pnpm_sha256: "b".repeat(64),
  lock_sha256: "c".repeat(64),
  run_id: "44579391487",
  attempt: "1",
};
const hostContext: FoundryCiTestHostContext = {
  source,
  plan_sha256: plan.planSha256,
  index: 1,
  outcome: "passed",
};
const observeHost = (facts = hostFacts, context = hostContext) =>
  captureFoundryCiTestHost("/not-an-output-path", context, (field) => facts[field]);

test("ordinary Windows observations bind the actual partition and preserve the 13 host fields", () => {
  const result = observeHost();
  assert.equal(result.schema, "tiangong-foundry.ci-test-host.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.qualification, false);
  assert.equal(result.source, source);
  assert.equal(result.plan_sha256, plan.planSha256);
  assert.equal(result.index, 1);
  assert.equal(result.run_id, "44579391487");
  assert.equal(result.attempt, 1);
  const { run_id: _run, attempt: _attempt, ...expected } = hostFacts;
  assert.deepEqual(result.host, expected);
  assert.deepEqual(result.omissions, []);
  assert.equal(result.outcome, "passed");
});

test("missing or disallowed host facts are unknown without leaking paths or arbitrary input", () => {
  for (const [field, value, reason] of [
    ["cpu_models", undefined, "missing"],
    ["image_version", undefined, "missing"],
    ["image_os", "/private/token", "invalid"],
    ["cpu_models", ["C:\\private\\token"], "invalid"],
    ["node_version", "v24.19.0\nsecret", "invalid"],
    ["pnpm_sha256", "secret", "invalid"],
    ["logical_cpus", 0, "invalid"],
    ["available_parallelism", 1.5, "invalid"],
    ["run_id", "old/private/run", "invalid"],
    ["attempt", "0", "invalid"],
  ] as const) {
    const result = observeHost({ ...hostFacts, [field]: value, SECRET: "secret" });
    assert.equal(result.status, "partial");
    assert.ok(result.omissions.some((item) => item.field === field && item.reason === reason));
    assert.ok(!JSON.stringify(result).includes("private"));
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
  const result = captureFoundryCiTestHost("/private/token", hostContext, () => {
    throw new Error("/private/token secret");
  });
  assert.equal(result.status, "partial");
  assert.ok(result.omissions.every((item) => item.reason === "unavailable"));
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("host observations retain failure and cancellation and never qualify shard outcomes", () => {
  for (const outcome of ["passed", "failed", "cancelled"] as const) {
    const observed = observeHost(hostFacts, { ...hostContext, outcome });
    assert.equal(observed.outcome, outcome);
    const input = receipts();
    for (const row of input) row.host_observation = observed;
    assert.deepEqual(
      verifyFoundryTestShards(input, source, plan),
      verifyFoundryTestShards(receipts(), source, plan),
    );
    input[0].status = "failed";
    assert.throws(() => verifyFoundryTestShards(input, source, plan), /differs/);
  }
});

test("host collection follows the original elapsed snapshot and is Windows-only in the ordinary entry", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const entry = fs.readFileSync(path.join(root, "scripts/ci-test-shard.ts"), "utf8");
  assert.ok(entry.includes('process.platform === "win32"'));
  assert.ok(
    entry.indexOf("elapsed_ms: performance.now() - started") <
      entry.indexOf("receipt.host_observation = captureFoundryCiTestHost"),
  );
  assert.ok(
    entry.indexOf("receipt.host_observation = captureFoundryCiTestHost") <
      entry.indexOf('fs.writeFileSync(path.join(output, "test-shard.json")'),
  );
});

test("a new source, plan, partition or run remains a different observation", () => {
  const original = observeHost();
  const next = observeHost(
    { ...hostFacts, run_id: "44594367373", attempt: "2" },
    {
      ...hostContext,
      source: "b".repeat(40),
      plan_sha256: "d".repeat(64),
      index: 3,
    },
  );
  assert.notEqual(next.source, original.source);
  assert.notEqual(next.plan_sha256, original.plan_sha256);
  assert.notEqual(next.index, original.index);
  assert.notEqual(next.run_id, original.run_id);
  assert.notEqual(next.attempt, original.attempt);
  assert.deepEqual(next.host, original.host);
});
