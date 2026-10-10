import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import report, { foundryCiReporterUrl } from "../../scripts/ci-test-reporter.ts";
import { loadFoundryTestPlan } from "../../scripts/lib/foundry-ci-plan.ts";

async function collect(items: unknown[]): Promise<unknown[]> {
  async function* events() {
    yield* items;
  }
  const output: unknown[] = [];
  for await (const row of report(events())) output.push(JSON.parse(row));
  return output;
}

test("CI reporter retains native runner counters and excludes arbitrary test output", async () => {
  const items = await collect([
    { type: "test:stdout", data: { message: "must-not-copy-raw-output" } },
    { type: "test:diagnostic", data: { message: "must-not-copy-diagnostic-payload" } },
    {
      type: "test:fail",
      data: {
        name: "failure",
        file: "/test/file.test.mts",
        nesting: 0,
        details: {
          type: "test",
          duration_ms: 3,
          error: { message: "must-not-copy-error-payload" },
        },
      },
    },
    {
      type: "test:summary",
      data: {
        success: false,
        duration_ms: 5,
        counts: { tests: 2, passed: 0, failed: 1, cancelled: 0, skipped: 1, todo: 0, suites: 0 },
      },
    },
  ]);
  assert.equal(items.length, 2);
  assert.equal(JSON.stringify(items).includes("must-not-copy"), false);
  assert.deepEqual((items[1] as { counts: unknown }).counts, {
    tests: 2,
    passed: 0,
    failed: 1,
    cancelled: 0,
    skipped: 1,
    todo: 0,
    suites: 0,
  });
  await assert.rejects(
    collect([
      { type: "test:summary", data: { success: true, duration_ms: 1, counts: { tests: "2" } } },
    ]),
    /measurement/,
  );
});

test("actual Node reporter integration preserves passed and platform-skipped cases", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ci-report-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "fixture.test.mjs");
  fs.writeFileSync(
    fixture,
    'import test from "node:test"; test("retained pass", () => {}); test("platform skip", {skip: true}, () => {});\n',
  );
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_OPTIONS;
  const result = spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${foundryCiReporterUrl}`, fixture],
    {
      env: environment,
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const records = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const summary = records.findLast((row) => row.type === "summary" && row.file === undefined);
  assert.equal(summary?.success, true);
  assert.deepEqual(summary?.counts, {
    tests: 2,
    passed: 1,
    failed: 0,
    cancelled: 0,
    skipped: 1,
    todo: 0,
    suites: 0,
  });
  assert.equal(records.filter((row) => row.type === "case").length, 2);
});

test(
  "CI shard retains TAP assertion details while another test file is still running",
  { timeout: 30000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-ci-streaming-diagnostics-"));
    let cleanupChild = async () => {};
    t.after(async () => {
      try {
        await cleanupChild();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
    const sourceRoot = path.resolve(import.meta.dirname, "../..");
    const fixtureRoot = path.join(directory, "source");
    const scripts = path.join(fixtureRoot, "scripts");
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "test"));
    fs.mkdirSync(path.join(fixtureRoot, "specs/ci"), { recursive: true });
    // Execute the real runner and reporter bytes. The other owners are reused unchanged;
    // only the external Git clean-check boundary is supplied by the synthetic source fixture.
    for (const file of ["ci-test-shard.ts", "ci-test-reporter.ts"])
      fs.copyFileSync(path.join(sourceRoot, "scripts", file), path.join(scripts, file));
    fs.symlinkSync(path.join(sourceRoot, "scripts/lib"), path.join(scripts, "lib"), "junction");
    const source = "a".repeat(40);
    const gitFixture = path.join(directory, "git-fixture.mjs");
    fs.writeFileSync(
      gitFixture,
      `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  if (command !== "git") return original(command, args, options);
  let output;
  if (args.includes("rev-parse") && args.includes("HEAD")) output = ${JSON.stringify(source + "\n")};
  else if (args.includes("status")) output = "";
  else throw new Error("Unexpected Git operation in CI diagnostic fixture.");
  return { status: 0, signal: null, stdout: Buffer.from(output), stderr: Buffer.alloc(0) };
};
syncBuiltinESMExports();
`,
    );
    const startedFile = path.join(directory, "second-started");
    const releaseFile = path.join(directory, "release-second");
    const finishedFile = path.join(directory, "second-finished");
    const assertionMessage = "early assertion diagnostic remains available";
    fs.writeFileSync(
      path.join(fixtureRoot, "test/00-failing.test.mts"),
      `
import assert from "node:assert/strict";
import test from "node:test";
test("early fixture failure", () => assert.deepEqual({ value: "actual" }, { value: "expected" }, ${JSON.stringify(assertionMessage)}));
`,
    );
    fs.writeFileSync(
      path.join(fixtureRoot, "test/01-pending.test.mts"),
      `
import fs from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
test("second file awaits explicit release", async () => {
  fs.writeFileSync(${JSON.stringify(startedFile)}, "started");
  while (!fs.existsSync(${JSON.stringify(releaseFile)})) await delay(20);
  fs.writeFileSync(${JSON.stringify(finishedFile)}, "finished");
});
`,
    );
    for (const index of [2, 3])
      fs.writeFileSync(
        path.join(fixtureRoot, `test/0${index}-passed.test.mts`),
        'import test from "node:test"; test("fixture pass", () => {});\n',
      );
    fs.writeFileSync(
      path.join(fixtureRoot, "specs/ci/test-durations.json"),
      JSON.stringify({
        schema: "tiangong-foundry.ci-test-durations.v1",
        weights_seconds: {},
        shards_by_platform: { "linux-x64": 1, "linux-arm64": 1, "darwin-arm64": 1, "win32-x64": 1 },
      }),
    );
    const output = path.join(directory, "reports");
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    delete environment.NODE_OPTIONS;
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(gitFixture).href,
        path.join(scripts, "ci-test-shard.ts"),
        "--index",
        "1",
        "--plan-sha256",
        loadFoundryTestPlan(fixtureRoot).planSha256,
        "--source-sha",
        source,
        "--output",
        output,
      ],
      { env: environment, stdio: ["ignore", "pipe", "pipe"], shell: false },
    );
    let stdout = "",
      stderr = "",
      closed = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        closed = true;
        resolve(code);
      });
    });
    const boundedCompletion = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          completion,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("CI diagnostic child did not close.")), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    cleanupChild = async () => {
      fs.writeFileSync(releaseFile, "release");
      try {
        await boundedCompletion();
      } catch {
        child.kill();
        await boundedCompletion();
      }
    };
    const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
    const eventsFile = path.join(output, "test-events.jsonl");
    const records = () =>
      read(eventsFile)
        .split("\n")
        .slice(0, -1)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    const until = async (condition: () => boolean, milliseconds: number) => {
      const deadline = Date.now() + milliseconds;
      while (!condition() && Date.now() < deadline) {
        if (closed) break;
        await delay(20);
      }
      assert.equal(
        condition(),
        true,
        stderr || "CI diagnostics were not available before completion.",
      );
    };
    await until(
      () =>
        fs.existsSync(startedFile) &&
        records().some((row) => row.type === "case" && row.passed === false),
      15000,
    );
    const diagnosticFile = path.join(output, "test-diagnostics.tap");
    await until(() => read(diagnosticFile).includes(assertionMessage), 5000);
    const diagnostic = read(diagnosticFile);
    assert.match(diagnostic, /ERR_ASSERTION/u);
    assert.match(diagnostic, /expected:/u);
    assert.match(diagnostic, /actual:/u);
    assert.equal(fs.existsSync(finishedFile), false, "second file has not completed");
    assert.equal(closed, false, "runner has not reached terminal completion");
    assert.equal(
      records().some((row) => row.type === "summary" && row.file === undefined),
      false,
    );
    assert.equal(
      stdout.includes(assertionMessage),
      false,
      "spec assertion detail remains deferred",
    );
    assert.equal(
      read(eventsFile).includes(assertionMessage),
      false,
      "proof JSONL omits error payloads",
    );
    fs.writeFileSync(releaseFile, "release");
    assert.equal(
      await boundedCompletion(),
      1,
      "the genuine assertion failure still fails the shard",
    );
    const receipt = JSON.parse(read(path.join(output, "test-shard.json"))) as {
      status: string;
      counts: unknown;
    };
    const summary = records().findLast((row) => row.type === "summary" && row.file === undefined);
    assert.equal(receipt.status, "failed");
    assert.deepEqual(receipt.counts, summary?.counts);
    assert.equal(summary?.success, false);
    assert.equal(read(eventsFile).includes(assertionMessage), false);
  },
);
