import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  foundryCiTestConcurrency,
  loadFoundryTestPlan,
  foundryPlatformTestShards,
  foundryCiTestMatrix,
  planFoundryTestShards,
  selectFoundryCiMode,
} from "../../scripts/lib/foundry-ci-plan.ts";

const files = [
  "test/unit/a.test.mts",
  "test/unit/b.test.mts",
  "test/scenarios/c.test.mts",
  "test/scenarios/d.test.mts",
];
// Planning allowances over measured durations; the actual hosted deadline stays 40 minutes.
const fitsWindowsBudget = (seconds: number) => seconds * 1.2 + 90 < 40 * 60;

test("CI partitions every test file once and balances measured heavy cases", () => {
  const plan = planFoundryTestShards(
    files,
    { [files[0]]: 10, [files[1]]: 9, [files[2]]: 2, [files[3]]: 1 },
    2,
  );
  assert.deepEqual(
    plan.shards.map((shard) => shard.estimatedSeconds),
    [11, 11],
  );
  assert.deepEqual(plan.shards.flatMap((shard) => shard.files).sort(), [...files].sort());
  assert.equal(new Set(plan.shards.flatMap((shard) => shard.files)).size, files.length);
  assert.deepEqual(
    plan.shards.map(({ index, total }) => [index, total]),
    [
      [1, 2],
      [2, 2],
    ],
  );
});

test("wall estimates model the runner's lexical two-worker queue instead of serial work or work/2", () => {
  const lexical = ["a", "b", "z"].map((name) => `test/unit/${name}.test.mts`);
  const durations = { [lexical[0]]: 1, [lexical[1]]: 1, [lexical[2]]: 100 };
  const plan = planFoundryTestShards([...lexical].reverse(), durations, 1);
  assert.equal(foundryCiTestConcurrency, 2);
  assert.equal(plan.shards[0].estimatedSeconds, 102);
  assert.equal(plan.shards[0].estimatedWallSeconds, 101);
  assert.deepEqual(plan, planFoundryTestShards(lexical, durations, 1));
  const overlong = planFoundryTestShards(lexical, { ...durations, [lexical[2]]: 2401 }, 1);
  assert.equal(overlong.shards[0].estimatedWallSeconds, 2402);
  assert.equal(fitsWindowsBudget(overlong.shards[0].estimatedWallSeconds), false);
  const singleOverlong = planFoundryTestShards([lexical[2]], { [lexical[2]]: 2401 }, 1);
  assert.equal(fitsWindowsBudget(singleOverlong.shards[0].estimatedWallSeconds), false);
  const parallel = planFoundryTestShards(
    lexical.slice(0, 2),
    {
      [lexical[0]]: 1700,
      [lexical[1]]: 1700,
    },
    1,
  );
  assert.equal(parallel.shards[0].estimatedSeconds, 3400);
  assert.equal(fitsWindowsBudget(parallel.shards[0].estimatedWallSeconds), true);
  for (const nearDeadline of [1925, 2000, 2399]) {
    assert.ok(nearDeadline < 40 * 60);
    assert.equal(
      fitsWindowsBudget(nearDeadline),
      false,
      "raw wall fit must retain the planning reserve",
    );
  }
});

test("measured deadline envelope rejects eight/nine shards and keeps all files within ten-shard reserve", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const profile = JSON.parse(
    fs.readFileSync(path.join(root, "specs/ci/test-durations.json"), "utf8"),
  ) as {
    weights_seconds: Record<string, number>;
    deadline_refresh: {
      transferred_files: number;
      retained_prior_weights: Array<{ file: string; seconds: number; reason: string }>;
    };
  };
  const plan = loadFoundryTestPlan(root);
  const inventory = plan.shards.flatMap((shard) => shard.files).sort();
  for (const count of [8, 9]) {
    const old = planFoundryTestShards(inventory, profile.weights_seconds, count);
    assert.ok(old.shards.some((shard) => !fitsWindowsBudget(shard.estimatedWallSeconds)));
    assert.deepEqual(old.shards.flatMap((shard) => shard.files).sort(), inventory);
  }
  const windows = foundryPlatformTestShards(plan, "win32-x64");
  assert.equal(windows.length, 10);
  assert.ok(windows.every((shard) => fitsWindowsBudget(shard.estimatedWallSeconds)));
  assert.deepEqual(windows.flatMap((shard) => shard.files).sort(), inventory);
  assert.equal(new Set(windows.flatMap((shard) => shard.files)).size, inventory.length);
  assert.equal(
    profile.deadline_refresh.transferred_files +
      profile.deadline_refresh.retained_prior_weights.length,
    inventory.length,
  );
  for (const retained of profile.deadline_refresh.retained_prior_weights) {
    assert.equal(profile.weights_seconds[retained.file], retained.seconds);
    assert.ok(retained.reason.length > 0);
  }
});

test("Node admits the lexical first two files despite heavy-first argument order", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ci-lexical-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = path.join(root, "events.jsonl");
  const selected = ["a", "b", "z"].map((name) => {
    const file = path.join(root, `${name}.test.mts`);
    fs.writeFileSync(
      file,
      `
import fs from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
test(${JSON.stringify(name)}, async () => {
  const events = ${JSON.stringify(events)};
  fs.appendFileSync(events, ${JSON.stringify(name + "\n")});
  if (${JSON.stringify(name)} !== "z") {
    const deadline = Date.now() + 10000;
    while (!["a", "b"].every(name => fs.readFileSync(events, "utf8").split("\\n").includes(name))) {
      if (Date.now() > deadline) throw new Error("Lexical workers did not both start.");
      await delay(10);
    }
  }
});
`,
    );
    return file;
  });
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_OPTIONS;
  const result = spawnSync(
    process.execPath,
    ["--test", `--test-concurrency=${foundryCiTestConcurrency}`, ...selected.reverse()],
    {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 15000,
      shell: false,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const started = fs.readFileSync(events, "utf8").trim().split("\n");
  assert.deepEqual(started.slice(0, 2).sort(), ["a", "b"]);
  assert.equal(started[2], "z");
});

test("CI partition is independent of discovery and duration-map insertion order", () => {
  const first = planFoundryTestShards(files, { [files[0]]: 10, [files[1]]: 9 }, 2);
  const second = planFoundryTestShards([...files].reverse(), { [files[1]]: 9, [files[0]]: 10 }, 2);
  assert.deepEqual(first, second);
  assert.notEqual(
    first.planSha256,
    planFoundryTestShards(files, { [files[0]]: 11, [files[1]]: 9 }, 2).planSha256,
  );
});

test("CI partition includes new unprofiled tests instead of silently omitting them", () => {
  const plan = planFoundryTestShards(files, { [files[0]]: 10 }, 2);
  assert.deepEqual(plan.unprofiledFiles, files.slice(1).sort());
  assert.equal(
    plan.shards.reduce((sum, shard) => sum + shard.files.length, 0),
    4,
  );
});

test("CI partition refuses duplicate, unsafe or non-test paths and stale duration entries", () => {
  for (const bad of [
    "../outside.test.mts",
    "test/../outside.test.mts",
    "/tmp/outside.test.mts",
    "test\\unit\\a.test.mts",
    "test/unit/a.ts",
    "test/unit/a\n.test.mts",
  ]) {
    assert.throws(() => planFoundryTestShards([files[0], bad], {}, 2), /test path/);
  }
  assert.throws(() => planFoundryTestShards([files[0], files[0]], {}, 2), /duplicate/);
  assert.throws(
    () => planFoundryTestShards(files, { "test/unit/removed.test.mts": 1 }, 2),
    /unknown/,
  );
  for (const duration of [0, -1, NaN, Infinity])
    assert.throws(() => planFoundryTestShards(files, { [files[0]]: duration }, 2), /duration/);
});

test("CI partition refuses empty shards rather than accidentally running the whole suite", () => {
  for (const count of [0, -1, 1.5, 5, NaN])
    assert.throws(() => planFoundryTestShards(files, {}, count), /shard count/);
  assert.throws(() => planFoundryTestShards([], {}, 1), /shard count/);
});

test("hosted Windows timings keep heavy object, native and repair scenarios within each shard budget", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const plan = loadFoundryTestPlan(root);
  const windows = foundryPlatformTestShards(plan, "win32-x64");
  const heavy = [
    "foundry-public-reference-recovery",
    "foundry-public-reference-input",
    "foundry-public-native-reuse",
    "foundry-public-trace-unrelated-change",
    "foundry-public-trace-acceptance",
    "foundry-public-native-draft",
    "foundry-object-interaction-workflow",
    "foundry-public-repair",
    "foundry-repair-successor",
  ].map((name) => `test/scenarios/${name}.test.mts`);
  for (const file of heavy)
    assert.ok(!plan.unprofiledFiles.includes(file), `${file} needs hosted duration evidence`);
  for (const name of [
    "foundry-public-finalization-flow-evidence",
    "foundry-quality-review-template",
    "foundry-quality-review",
    "foundry-public-approval-current-trace",
    "foundry-package-preparation-targets",
    "foundry-package-preparation-unresolved",
  ])
    assert.ok(!plan.unprofiledFiles.includes(`test/scenarios/${name}.test.mts`));
  assert.ok(
    windows.every((shard) => heavy.filter((file) => shard.files.includes(file)).length <= 3),
    "heavy Windows cases must not converge on one timed-out partition",
  );
  assert.ok(
    windows.every((shard) => fitsWindowsBudget(shard.estimatedWallSeconds)),
    "every lexical two-worker wall estimate plus 20% and 90 seconds must fit the unchanged 40-minute job budget",
  );
});

import {
  validateFoundryReleaseChange,
  type ReleaseFileChange,
} from "../../scripts/lib/foundry-release-contract.ts";
import {
  foundryReleaseVersionPaths,
  projectFoundryReleaseVersion,
} from "../../scripts/lib/foundry-release-version.ts";

function versionChanges(): ReleaseFileChange[] {
  const root = path.resolve(import.meta.dirname, "../..");
  const before = Object.fromEntries(
    foundryReleaseVersionPaths.map((file) => [
      file,
      fs.readFileSync(path.join(root, file), "utf8"),
    ]),
  );
  const version = JSON.parse(before["package.json"]).version as string;
  const next = version.split(".");
  next[2] = String(Number(next[2]) + 1);
  const projection = projectFoundryReleaseVersion(before, next.join("."));
  return foundryReleaseVersionPaths.map((file) => ({
    path: file,
    before: before[file],
    after: projection.replacements[file],
    beforeMode: "100644",
    afterMode: "100644",
  }));
}

test("only strictly inspected version PRs receive the bounded gate", () => {
  const inspection = validateFoundryReleaseChange(versionChanges());
  assert.equal(selectFoundryCiMode("pull_request", undefined, inspection), "version-only");
  for (const event of ["push", "workflow_dispatch", "workflow_call", "unknown"])
    assert.equal(selectFoundryCiMode(event, undefined, inspection), "full");
  assert.equal(selectFoundryCiMode("pull_request", "a".repeat(40), inspection), "full");
  assert.equal(
    selectFoundryCiMode("pull_request", undefined, {
      release: false,
      changedPaths: ["scripts/runtime-entry.ts"],
    }),
    "full",
  );
});

test("version gate never admits dependency changes, mixed source or changed document bodies", () => {
  const classify = (changes: ReleaseFileChange[]) =>
    selectFoundryCiMode("pull_request", undefined, validateFoundryReleaseChange(changes));
  for (const extra of [
    { path: "pnpm-lock.yaml", before: "old", after: "new" },
    { path: "scripts/runtime-entry.ts", before: "old", after: "new" },
    {
      path: "README.md",
      before: "---\nlastReviewedAt: old\n---\nOld body\n",
      after: "---\nlastReviewedAt: new\n---\nNew body\n",
    },
  ])
    assert.throws(
      () =>
        classify([...versionChanges(), { ...extra, beforeMode: "100644", afterMode: "100644" }]),
      /release-only/,
    );
  const changed = versionChanges();
  changed[0] = {
    ...changed[0],
    after: changed[0].after!.replace(
      '"dependencies": {',
      '"dependencies": { "unexpected": "1.0.0",',
    ),
  };
  assert.throws(() => classify(changed), /projection/);
  assert.equal(classify(versionChanges().slice(1)), "full");
  assert.throws(
    () => classify(versionChanges().filter((_, index) => index !== 1)),
    /Missing release version/,
  );
});

test("host-specific shard matrix covers every file once with Windows10 and unchanged other4", () => {
  const plan = loadFoundryTestPlan(path.resolve(import.meta.dirname, "../.."));
  const matrix = foundryCiTestMatrix(plan).include;
  assert.equal(matrix.length, 22);
  assert.deepEqual(
    matrix.slice(0, 10).map(({ platform }) => platform),
    Array(10).fill("win32-x64"),
  );
  const inventory = plan.shards.flatMap(({ files }) => files).sort();
  for (const platform of ["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64"]) {
    const shards = foundryPlatformTestShards(plan, platform);
    assert.equal(shards.length, platform === "win32-x64" ? 10 : 4);
    const selected = shards.flatMap(({ files }) => files);
    assert.equal(new Set(selected).size, inventory.length);
    assert.deepEqual(selected.sort(), inventory);
    assert.deepEqual(
      matrix.filter((row) => row.platform === platform).map((row) => row.shard),
      shards.map((row) => row.index),
    );
  }
  assert.throws(() => foundryPlatformTestShards(plan, "darwin-x64"), /Unsupported/);
});

test("global CI digest binds all platform counts and rejects malformed mappings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ci-platform-plan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "test"));
  fs.mkdirSync(path.join(root, "specs/ci"), { recursive: true });
  for (let index = 0; index < 10; index++)
    fs.writeFileSync(path.join(root, `test/${index}.test.mts`), "");
  const counts = { "linux-x64": 4, "linux-arm64": 4, "darwin-arm64": 4, "win32-x64": 10 };
  const write = (mapping: unknown) =>
    fs.writeFileSync(
      path.join(root, "specs/ci/test-durations.json"),
      JSON.stringify({
        schema: "tiangong-foundry.ci-test-durations.v1",
        weights_seconds: {},
        shards_by_platform: mapping,
      }),
    );
  write(counts);
  const original = loadFoundryTestPlan(root);
  write({ ...counts, "win32-x64": 4 });
  assert.notEqual(loadFoundryTestPlan(root).planSha256, original.planSha256);
  for (const mapping of [
    undefined,
    [],
    { "linux-x64": 4 },
    { ...counts, "darwin-x64": 4 },
    { ...counts, "win32-x64": "10" },
    { ...counts, "win32-x64": 11 },
    { ...counts, "linux-x64": 9 },
    { ...counts, "win32-x64": 0 },
    { ...counts, "win32-x64": 7.5 },
  ]) {
    write(mapping);
    assert.throws(() => loadFoundryTestPlan(root), /shard count/);
  }
});
