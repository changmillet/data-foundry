import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createManagedDiagnostics,
  managedChildEnvironment,
  managedDiagnosticsEnvironment,
  prepareManagedDiagnostics,
  projectManagedSubprocess,
} from "../fixtures/managed-adoption-diagnostics.mts";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "managed-feedback-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "output");
  fs.mkdirSync(output);
  const diagnosticRoot = prepareManagedDiagnostics(output, {
    source: "a".repeat(40),
    platform: "win32-x64",
    plan_sha256: "b".repeat(64),
    shard: 1,
  });
  return { root, output, diagnosticRoot };
}

test("feedback preserves negative exits, null counts and unknown returned-action observations", () => {
  const projected = projectManagedSubprocess({
    role: "actual-managed-returned-action",
    status: -1,
    error: null,
    owned_child: { pid: 123, synchronous_return_observed: true },
    stdout: JSON.stringify({
      status: "needs_input",
      artifacts: [
        {
          role: "explicit_readonly_identity_stage",
          value: {
            status: "blocked",
            counts: {
              admitted_targets: 4,
              accepted_targets: 0,
              cli_invocations: null,
              underlying_retrievals: null,
            },
          },
        },
      ],
    }),
  });
  assert.equal(projected.status, -1);
  assert.deepEqual(projected.counts, {
    admitted_targets: 4,
    accepted_targets: 0,
    cli_invocations: null,
    underlying_retrievals: null,
  });
  assert.equal(projected.timed_out, null, "missing observation stays unknown");
  assert.equal(projected.owned_child.close_observed, null);
  assert.equal(projected.owned_child.synchronous_return_observed, true);
});

test("unknown, nonobject and mixed call records cannot become proven zero calls", (t) => {
  const f = fixture(t);
  for (const content of [
    '{"kind":"unknown-private-kind"}\n',
    "null\n",
    '{"kind":"flow"}\n{"kind":"unknown-private-kind"}\n',
  ]) {
    const feedback = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
    const input = fs.mkdtempSync(path.join(f.root, "input-"));
    fs.writeFileSync(path.join(input, "synthetic-calls.jsonl"), content);
    feedback.failure(input);
    const serialized = fs.readFileSync(path.join(feedback.directory, "failure.json"), "utf8"),
      result = JSON.parse(serialized);
    assert.equal(result.synthetic_call_counts, null);
    assert.equal(result.calls_read, "unrecognized");
    assert.equal(serialized.includes("unknown-private-kind"), false);
  }
});

test("diagnostic initialization failures leave the original body, outcome and cleanup intact", (t) => {
  const f = fixture(t),
    helper = pathToFileURL(
      path.resolve(import.meta.dirname, "../fixtures/managed-adoption-diagnostics.mts"),
    ).href;
  for (const mode of ["missing", "malformed", "unwritable"]) {
    const parent = path.join(f.root, mode);
    fs.mkdirSync(parent);
    const root = prepareManagedDiagnostics(parent, {
      source: "a".repeat(40),
      platform: "win32-x64",
      plan_sha256: "b".repeat(64),
      shard: 1,
    });
    if (mode === "missing") fs.unlinkSync(path.join(root, "context.json"));
    if (mode === "malformed")
      fs.writeFileSync(path.join(root, "context.json"), "private-malformed-context");
    const body = path.join(parent, "body"),
      cleanup = path.join(parent, "cleanup");
    const script = `import fs from "node:fs"; import test from "node:test"; import { startManagedDiagnostics } from ${JSON.stringify(helper)};
      if (${JSON.stringify(mode)} === "unwritable") { const original = fs.mkdtempSync; fs.mkdtempSync = (prefix, ...rest) => { if (String(prefix).startsWith(${JSON.stringify(root)})) throw Object.assign(new Error("private-permission-message"), {code:"EACCES"}); return original(prefix, ...rest); }; }
      test("original body", t => { t.after(() => fs.writeFileSync(${JSON.stringify(cleanup)}, "cleaned")); const result = startManagedDiagnostics(${JSON.stringify(root)}, "unknown-case"); fs.writeFileSync(${JSON.stringify(body)}, result.omission ?? "no-omission"); });`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    assert.equal(result.status, 0, "feedback failure must not change the original test outcome");
    assert.equal(fs.readFileSync(body, "utf8"), "initialization-unavailable");
    assert.equal(fs.readFileSync(cleanup, "utf8"), "cleaned");
    assert.equal(result.stdout.includes("private-"), false);
  }
});

test("safe completion export drops credentials and rejects poisoned enums", (t) => {
  const f = fixture(t),
    diagnostic = createManagedDiagnostics(f.diagnosticRoot, "credential-in-case-name")!;
  const secret = "credential-value-must-never-be-exported";
  diagnostic.completion({
    status: 3,
    error: { name: secret, code: secret, message: secret },
    argv: [secret],
    cwd: secret,
    environment: { password: secret },
    stdout: JSON.stringify({
      status: secret,
      account: { access_token: secret },
      artifacts: [
        {
          role: "explicit_readonly_identity_stage",
          value: {
            status: "blocked",
            auth: { refresh_token: secret },
            counts: {
              admitted_targets: 4,
              accepted_targets: 0,
              cli_invocations: null,
              underlying_retrievals: -1,
            },
          },
        },
      ],
    }),
    stderr: secret,
    stdout_bytes: 42,
    stderr_bytes: secret.length,
    timed_out: false,
  });
  const serialized = fs.readFileSync(path.join(diagnostic.directory, "command-001.json"), "utf8"),
    data = JSON.parse(serialized);
  assert.equal(serialized.includes(secret), false);
  assert.equal(data.status, 3);
  assert.equal(data.operation_status, "unrecognized");
  assert.equal(data.error.code, "unrecognized");
  assert.equal(data.counts.accepted_targets, 0);
  assert.equal(data.counts.underlying_retrievals, null);
  assert.equal(
    fs
      .readFileSync(path.join(diagnostic.directory, "fixture.json"), "utf8")
      .includes("credential-in-case-name"),
    false,
  );
});

test("failure feedback keeps absent run proof and observed zero calls with timestamp-only receipt data", (t) => {
  const f = fixture(t),
    diagnostic = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
  const work = path.join(f.root, "failed-fixture"),
    dispatch = path.join(
      work,
      "workspace/.foundry/workspaces/task/outputs/identity-stage/stage/dispatch/target",
    );
  fs.mkdirSync(dispatch, { recursive: true });
  const write = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value));
  write(path.join(dispatch, "dispatch.json"), {
    schema: "tiangong-foundry.identity-stage-dispatch.v1",
    dispatch_state: "CLAIMED_OUTCOME_UNPROVEN",
    claimed_at_utc: "2026-10-10T12:01:05.000Z",
    auth_receipt: { path: "../../../../private-account.json" },
  });
  write(path.join(dispatch, "identity-receipt.json"), {
    schema: "tiangong-lca.auth-identity-receipt.v1",
    status: "passed",
    captured_at_utc: "2026-10-10T12:00:00.000Z",
    project: { project_ref: "private-project" },
    identity: { user_id: "private-user" },
    token: "private-token",
  });
  fs.writeFileSync(path.join(work, "synthetic-calls.jsonl"), "");
  diagnostic.failure(work);
  const serialized = fs.readFileSync(path.join(diagnostic.directory, "failure.json"), "utf8"),
    data = JSON.parse(serialized);
  assert.equal(data.disposition, "failed-or-incomplete");
  assert.equal(data.completed_records, 0);
  assert.equal(
    data.proofs.find((item: { kind: string }) => item.kind === "run-report").read,
    "missing",
  );
  assert.deepEqual(data.synthetic_call_counts, {
    auth: 0,
    flow: 0,
    process: 0,
    "forbidden-write": 0,
  });
  const receipt = data.proofs.find((item: { kind: string }) => item.kind === "receipt-time");
  assert.equal(receipt.observed_gap_ms, 65000, "observation is not an authentication decision");
  for (const forbidden of [
    "private-account",
    "private-project",
    "private-user",
    "private-token",
    "auth_receipt",
  ])
    assert.equal(serialized.includes(forbidden), false);
});

test("diagnostic inputs reject junctions, oversize and malformed files without exporting payloads", (t) => {
  const f = fixture(t),
    diagnostic = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
  const work = path.join(f.root, "failed-fixture"),
    base = path.join(
      work,
      "workspace/.foundry/workspaces/task/outputs/identity-stage/stage/dispatch",
    );
  fs.mkdirSync(path.join(base, "large/run"), { recursive: true });
  fs.writeFileSync(
    path.join(base, "large/run/dataset-identity-preflight-run-report.json"),
    "x".repeat(1024 * 1024 + 1),
  );
  fs.mkdirSync(path.join(base, "bad/run"), { recursive: true });
  fs.writeFileSync(
    path.join(base, "bad/run/dataset-identity-preflight-run-report.json"),
    "malformed-private-token",
  );
  const foreign = path.join(f.root, "outside-private");
  fs.mkdirSync(foreign);
  fs.writeFileSync(
    path.join(foreign, "dispatch.json"),
    JSON.stringify({ status: "private-token" }),
  );
  fs.symlinkSync(foreign, path.join(base, "link"), "junction");
  fs.writeFileSync(path.join(work, "synthetic-calls.jsonl"), "malformed-private-token");
  diagnostic.failure(work);
  const serialized = fs.readFileSync(path.join(diagnostic.directory, "failure.json"), "utf8"),
    data = JSON.parse(serialized);
  assert.equal(serialized.includes("private-token"), false);
  const states = data.proofs.map((item: { read: string }) => item.read);
  for (const state of ["oversized", "malformed", "rejected-link"])
    assert.ok(states.includes(state));
  assert.equal(data.synthetic_call_counts, null);
});

test("feedback writes are exclusive and diagnostic destination never reaches the managed child", (t) => {
  const f = fixture(t),
    diagnostic = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
  const file = path.join(diagnostic.directory, "command-001.json");
  fs.writeFileSync(file, "original-evidence");
  assert.throws(() => diagnostic.completion({ status: 0 }), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), "original-evidence");
  assert.throws(
    () =>
      prepareManagedDiagnostics(f.output, {
        source: "a".repeat(40),
        platform: "win32-x64",
        plan_sha256: "b".repeat(64),
        shard: 1,
      }),
    { code: "EEXIST" },
  );
  const parent = {
    [managedDiagnosticsEnvironment]: f.diagnosticRoot,
    HOME: "original-home",
    TIANGONG_LCA_ACCESS_TOKEN: "process-only-credential",
  };
  assert.deepEqual(managedChildEnvironment(parent), {
    HOME: "original-home",
    TIANGONG_LCA_ACCESS_TOKEN: "process-only-credential",
  });
  assert.equal(parent[managedDiagnosticsEnvironment], f.diagnosticRoot);
});

test("proof discovery is capped without materializing an unbounded directory", (t) => {
  const f = fixture(t),
    feedback = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
  const input = path.join(f.root, "input"),
    checkpoints = path.join(input, "workspace/.foundry/workspaces/task/checkpoints");
  fs.mkdirSync(checkpoints, { recursive: true });
  for (let at = 0; at < 140; at++)
    fs.writeFileSync(path.join(checkpoints, `${at}.plan.json`), "{}");
  const original = fs.readdirSync;
  fs.readdirSync = ((directory: fs.PathLike, ...args: unknown[]) => {
    if (String(directory) === checkpoints)
      throw new Error("unbounded directory allocation unavailable");
    return Reflect.apply(original, fs, [directory, ...args]);
  }) as typeof fs.readdirSync;
  try {
    feedback.failure(input);
  } finally {
    fs.readdirSync = original;
  }
  const result = JSON.parse(fs.readFileSync(path.join(feedback.directory, "failure.json"), "utf8"));
  assert.ok(
    result.omissions.some(
      (item: { role: string; state: string }) =>
        item.role === "checkpoints" && item.state === "entry-limit",
    ),
  );
});

test("ancestor aliases and replaced output destinations cannot escape the owned root", (t) => {
  const f = fixture(t),
    alias = path.join(f.root, "alias");
  fs.symlinkSync(f.output, alias, "junction");
  assert.throws(
    () => createManagedDiagnostics(path.join(alias, "managed-adoption"), "unknown-case"),
    /unavailable/u,
  );
  const feedback = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!,
    saved = path.join(f.root, "saved");
  fs.renameSync(feedback.directory, saved);
  const outside = path.join(f.root, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, feedback.directory, "junction");
  assert.throws(() => feedback.completion({ status: 0 }), /physical/u);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("input parent rebinding between validation and open cannot preserve accepted leaf proof", (t) => {
  const f = fixture(t),
    feedback = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
  const input = path.join(f.root, "input"),
    checkpoints = path.join(input, "workspace/.foundry/workspaces/task/checkpoints");
  fs.mkdirSync(checkpoints, { recursive: true });
  const file = path.join(checkpoints, "phase.plan.json");
  fs.writeFileSync(file, JSON.stringify({ command: "dataset-context-pack" }));
  const original = fs.openSync,
    moved = path.join(f.root, "outside-moved");
  let swapped = false;
  fs.openSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
    if (String(candidate) === file && !swapped) {
      swapped = true;
      fs.renameSync(checkpoints, moved);
      fs.symlinkSync(moved, checkpoints, "junction");
    }
    return Reflect.apply(original, fs, [candidate, ...args]);
  }) as typeof fs.openSync;
  try {
    feedback.failure(input);
  } finally {
    fs.openSync = original;
  }
  assert.equal(swapped, true);
  const result = JSON.parse(fs.readFileSync(path.join(feedback.directory, "failure.json"), "utf8"));
  assert.notEqual(
    result.proofs.find((item: { kind: string }) => item.kind === "plan").read,
    "ok",
    "same leaf inode cannot excuse a rebound parent",
  );
});

test("ordinary concurrent directory writes do not invalidate stable input proof", (t) => {
  const f = fixture(t),
    feedback = createManagedDiagnostics(f.diagnosticRoot, "unknown-case")!;
  const input = path.join(f.root, "input"),
    checkpoints = path.join(input, "workspace/.foundry/workspaces/task/checkpoints");
  fs.mkdirSync(checkpoints, { recursive: true });
  const file = path.join(checkpoints, "phase.plan.json");
  fs.writeFileSync(file, JSON.stringify({ command: "dataset-context-pack" }));
  const original = fs.openSync;
  fs.openSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
    if (String(candidate) === file)
      fs.writeFileSync(path.join(checkpoints, "concurrent-other-output"), "new sibling");
    return Reflect.apply(original, fs, [candidate, ...args]);
  }) as typeof fs.openSync;
  try {
    feedback.failure(input);
  } finally {
    fs.openSync = original;
  }
  const result = JSON.parse(fs.readFileSync(path.join(feedback.directory, "failure.json"), "utf8"));
  assert.equal(result.proofs.find((item: { kind: string }) => item.kind === "plan").read, "ok");
});
