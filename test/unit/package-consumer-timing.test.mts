import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { foundryCiReporterUrl } from "../../scripts/ci-test-reporter.ts";
import {
  createPackageConsumerTiming,
  packageConsumerPhases,
} from "../helpers/package-consumer-timing.mts";

test("package consumer checkpoints emit only bounded phase measurements", () => {
  let clock = 0;
  const lines: string[] = [];
  const timing = createPackageConsumerTiming(
    (line) => lines.push(line),
    () => clock,
  );
  for (const phase of packageConsumerPhases) {
    timing.checkpoint(phase);
    clock += 1.25;
  }
  timing.finish();
  timing.finish();
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    packageConsumerPhases.map((phase) => ({
      schema: "tiangong-foundry.package-consumer-phase.v1",
      phase,
      duration_ms: 1.25,
    })),
  );
  assert.throws(() => timing.checkpoint("setup"), /finished/u);
});

test("awaited work remains inside its phase and unentered phases are absent", async () => {
  let clock = 1;
  const lines: string[] = [];
  const timing = createPackageConsumerTiming(
    (line) => lines.push(line),
    () => clock,
  );
  timing.checkpoint("managed-cache");
  await Promise.resolve().then(() => {
    clock = 9;
  });
  timing.finish();
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [
      {
        schema: "tiangong-foundry.package-consumer-phase.v1",
        phase: "managed-cache",
        duration_ms: 8,
      },
    ],
  );
});

test("unsafe phases and invalid clocks never echo caller data", () => {
  for (const value of ["/private/sentinel", "setup\nTOKEN=sentinel", "unknown", {}, null]) {
    const lines: string[] = [];
    const timing = createPackageConsumerTiming(
      (line) => lines.push(line),
      () => 1,
    );
    assert.throws(() => Reflect.apply(timing.checkpoint, timing, [value]), {
      message: "Invalid package consumer timing phase.",
    });
    assert.deepEqual(lines, []);
  }
  for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "sentinel", null]) {
    const lines: string[] = [];
    const timing = createPackageConsumerTiming(
      (line) => lines.push(line),
      () => value as number,
    );
    assert.throws(() => timing.checkpoint("setup"), {
      message: "Invalid package consumer timing clock.",
    });
    assert.deepEqual(lines, []);
  }
});

test("backwards clock and duplicate phases fail while zero duration is valid", () => {
  let clock = 2;
  const lines: string[] = [];
  const timing = createPackageConsumerTiming(
    (line) => lines.push(line),
    () => clock,
  );
  timing.checkpoint("setup");
  assert.throws(() => timing.checkpoint("setup"), /duplicate/iu);
  clock = 1;
  assert.throws(() => timing.finish(), /clock/iu);
  assert.equal(lines.length, 0);
  const zero = createPackageConsumerTiming(
    (line) => lines.push(line),
    () => 0,
  );
  zero.checkpoint("setup");
  zero.finish();
  assert.equal(JSON.parse(lines[0]).duration_ms, 0);
});

test("cleanup still executes when measurement or diagnostic emission fails", () => {
  for (const failure of ["clock", "diagnostic"]) {
    let clock = 0;
    let cleaned = false;
    const timing = createPackageConsumerTiming(
      () => {
        if (failure === "diagnostic") throw new Error("diagnostic failed");
      },
      () => clock,
    );
    timing.checkpoint("setup");
    if (failure === "clock") clock = NaN;
    assert.throws(() =>
      timing.cleanup(() => {
        cleaned = true;
      }),
    );
    assert.equal(cleaned, true);
  }
});

test("cleanup preserves the exact original thrown value over measurement failures", () => {
  for (const original of [new Error("cleanup failure"), undefined, "cleanup rejection"]) {
    const timing = createPackageConsumerTiming(
      () => {
        throw new Error("diagnostic failed");
      },
      () => 1,
    );
    timing.checkpoint("setup");
    let thrown = false;
    try {
      timing.cleanup(() => {
        throw original;
      });
    } catch (error) {
      thrown = true;
      assert.equal(error, original);
    }
    assert.equal(thrown, true);
  }
});

const timingUrl = new URL("../helpers/package-consumer-timing.mts", import.meta.url).href;

const scenarios = [
  { name: "success", operation: "timing.checkpoint('missing-cli');", failed: false },
  {
    name: "thrown error",
    operation: "throw new Error('original-operation-failure');",
    failed: true,
  },
  {
    name: "non-Error rejection",
    operation: "await Promise.reject('original-operation-failure');",
    failed: true,
  },
  {
    name: "nonzero child exit",
    operation:
      "const result = spawnSync(process.execPath, ['-e', 'process.exit(7)']); assert.equal(result.status, 0, 'original-operation-failure');",
    failed: true,
  },
  {
    name: "child timeout",
    operation:
      "const result = spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {timeout: 100}); assert.equal(result.error?.code, 'ETIMEDOUT'); throw result.error;",
    failed: true,
  },
  {
    name: "child signal",
    operation:
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (status, signal) => resolve({status, signal})); child.once('spawn', () => child.kill('SIGTERM')); }); assert.equal(result.signal, 'SIGTERM'); assert.equal(result.status, 0, 'original-operation-failure');",
    failed: true,
  },
];

for (const scenario of scenarios) {
  test(`actual dual reporters retain safe timing and the original ${scenario.name}`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-phase 中文-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const fixture = path.join(directory, "fixture.test.mjs");
    const cleanupMarker = path.join(directory, "cleaned");
    const events = path.join(directory, "events.jsonl");
    fs.writeFileSync(
      fixture,
      `
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createPackageConsumerTiming } from ${JSON.stringify(timingUrl)};
test('original scenario', async (t) => {
  let now = 0;
  const timing = createPackageConsumerTiming((line) => t.diagnostic(line), () => now);
  timing.checkpoint('setup');
  const owned = ${JSON.stringify(path.join(directory, "owned"))};
  const readonlyFile = ${JSON.stringify(path.join(directory, "owned", "readonly"))};
  fs.mkdirSync(owned);
  fs.writeFileSync(readonlyFile, 'retained test input');
  fs.chmodSync(readonlyFile, 0o444);
  t.after(() => timing.cleanup(() => {
    fs.chmodSync(readonlyFile, 0o644);
    fs.rmSync(owned, {recursive: true, force: true});
    fs.writeFileSync(${JSON.stringify(cleanupMarker)}, 'done');
  }));
  now = 2;
  timing.checkpoint('managed-host');
  await Promise.resolve();
  now = 5;
  ${scenario.operation}
});
`,
    );
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        `--test-reporter=${foundryCiReporterUrl}`,
        `--test-reporter-destination=${events}`,
        fixture,
      ],
      { encoding: "utf8", env: environment, timeout: 30000, shell: false },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, scenario.failed ? 1 : 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(cleanupMarker, "utf8"), "done");
    assert.equal(fs.existsSync(path.join(directory, "owned")), false);
    const records = result.stdout
      .split("\n")
      .filter((line) => line.includes('"schema":"tiangong-foundry.package-consumer-phase.v1"'))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
    assert.deepEqual(
      records.map((row) => row.phase),
      scenario.failed
        ? ["setup", "managed-host", "cleanup"]
        : ["setup", "managed-host", "missing-cli", "cleanup"],
    );
    for (const row of records)
      assert.deepEqual(Object.keys(row), ["schema", "phase", "duration_ms"]);
    const machine = fs.readFileSync(events, "utf8");
    assert.equal(machine.includes("package-consumer-phase"), false);
    assert.equal(machine.includes("original-operation-failure"), false);
    const summary = machine
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .findLast((row) => row.type === "summary" && row.file === undefined);
    assert.equal(summary.success, !scenario.failed);
    assert.equal(summary.counts.failed, scenario.failed ? 1 : 0);
    if (scenario.failed) assert.match(result.stdout, /original-operation-failure|ETIMEDOUT/u);
  });
}
