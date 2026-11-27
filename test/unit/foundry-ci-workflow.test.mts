import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parseDocument } from "yaml";
import {
  loadFoundryTestPlan,
  foundryCiTestMatrix,
  planFoundryTestShards,
} from "../../devops/ci/foundry-ci-plan.ts";
import { foundryCiPlatforms, verifyFoundryTestShards } from "../../devops/ci/foundry-ci-results.ts";
import {
  inventoryCapsuleFiles,
  type CapsuleExpectation,
} from "../../devops/ci/foundry-ci-capsule.ts";
import { validateStageEvidence } from "../../devops/ci/foundry-ci-stage.ts";

const root = path.resolve(import.meta.dirname, "../..");
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function workflow(file: string): Record<string, unknown> {
  const document = parseDocument(
    fs.readFileSync(path.join(root, ".github/workflows", file), "utf8"),
    { uniqueKeys: true },
  );
  assert.deepEqual(document.errors, []);
  return object(document.toJS());
}
function steps(job: Record<string, unknown>): Record<string, unknown>[] {
  assert.ok(Array.isArray(job.steps));
  return job.steps.map(object);
}

test("Dependabot PR authors cannot seal qualification after reopen or human rerun", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  const planner = steps(object(jobs.plan)).find((step) => step.id === "plan");
  assert.ok(planner);
  const expression = String(object(planner.env).FOUNDRY_CI_CAN_SEAL);
  const github = {
    repository: "tiangong-lca/foundry",
    repository_id: "1260957221",
    repository_owner_id: "327771381",
    event_name: "pull_request",
    actor: "dependabot[bot]",
    triggering_actor: "dependabot[bot]",
    event: {
      action: "opened",
      pull_request: {
        user: { login: "dependabot[bot]" },
        head: { repo: { full_name: "tiangong-lca/foundry" } },
      },
    },
  };
  // Evaluate the workflow's actual boolean expression with immutable PR facts;
  // changing a rerun actor must never turn that bot-authored source into authority.
  const canSeal = (context: Record<string, unknown>): unknown =>
    runInNewContext(expression.slice(3, -2), { github: context }, { timeout: 100 });
  const sealCondition = String(object(jobs["seal-qualification"]).if)
    .slice(3, -2)
    .replaceAll("needs.qualification-gate", 'needs["qualification-gate"]');
  const canRunPrivilegedSeal = (context: Record<string, unknown>): unknown =>
    runInNewContext(
      sealCondition,
      {
        github: context,
        cancelled: () => false,
        // Even a planner output that requests sealing cannot grant it to bot source.
        needs: {
          plan: { outputs: { mode: "full", sealable: "true" } },
          "qualification-gate": { result: "success" },
        },
      },
      { timeout: 100 },
    );
  for (const actor of ["dependabot[bot]", "human-maintainer"]) {
    for (const action of ["opened", "synchronize", "reopened"]) {
      const context = {
        ...github,
        actor,
        triggering_actor: actor,
        event: { ...github.event, action },
      };
      assert.equal(canSeal(context), false, `Bot PR ${action} rerun by ${actor} cannot seal.`);
      assert.equal(canRunPrivilegedSeal(context), false);
    }
  }
  const human = {
    ...github,
    actor: "human-maintainer",
    event: {
      ...github.event,
      pull_request: { ...github.event.pull_request, user: { login: "human-maintainer" } },
    },
  };
  assert.equal(canSeal(human), true);
  assert.equal(canRunPrivilegedSeal(human), true);
  assert.equal(
    canSeal({
      ...human,
      event: {
        ...human.event,
        pull_request: {
          ...human.event.pull_request,
          head: { repo: { full_name: "contributor/foundry" } },
        },
      },
    }),
    false,
  );
  for (const event_name of ["workflow_dispatch", "push", "workflow_call"]) {
    assert.equal(canSeal({ ...human, event_name, event: {} }), true);
    assert.equal(canRunPrivilegedSeal({ ...human, event_name, event: {} }), true);
  }
  assert.equal(canSeal({ ...human, repository_id: "foreign" }), false);
  assert.equal(canSeal({ ...human, repository_owner_id: "foreign" }), false);
  assert.deepEqual(object(workflow("quality-gate.yml").permissions), {
    contents: "read",
    actions: "read",
    attestations: "read",
  });
});

test("public bootstrap seals only its completed proof and keeps disposable directories outside the capsule", (t) => {
  const job = object(object(workflow("publish.yml").jobs)["qualify-bootstrap-public"]);
  const selected = steps(job);
  const staging = selected.find((step) => step.name === "Stage completed bootstrap proof");
  assert.ok(staging, "Public bootstrap needs a separate proof boundary before sealing.");
  const qualify = selected.find((step) => String(step.run).includes("release:qualify-bootstrap"));
  assert.ok(qualify);
  assert.equal(object(qualify.env).BOOTSTRAP_OUTPUT, object(staging.env).BOOTSTRAP_WORK);
  assert.notEqual(object(staging.env).BOOTSTRAP_WORK, object(staging.env).BOOTSTRAP_PROOF);
  assert.equal(staging.if, "steps.restore.outputs.reused != 'true'");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-proof-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const work = path.join(temporary, "qualification work"),
    proof = path.join(temporary, "proof");
  fs.mkdirSync(path.join(work, "home", "empty"), { recursive: true });
  const expected: CapsuleExpectation = {
    stage: "bootstrap",
    platform: "win32-x64",
    purpose: "release",
    input_sha256: "f".repeat(64),
    identity: {
      repository: { id: "123", owner_id: "456" },
      source: { commit: "a".repeat(40), tree: "b".repeat(40) },
      package: { name: "@tiangong-lca/foundry", version: "0.1.5" },
      toolchain: {
        node: "24.19.0",
        pnpm: "11.24.0",
        typescript: "7.0.2",
        lock_sha256: "c".repeat(64),
      },
      runtime_inputs_sha256: "d".repeat(64),
      test_plan_sha256: "e".repeat(64),
    },
  };
  const report = {
    schema: "tiangong-foundry.bootstrap-qualification.v1",
    status: "passed",
    source: {
      repository: "https://github.com/tiangong-lca/data-foundry",
      ...expected.identity.source,
    },
    platform: expected.platform,
    mode: "public",
    manifest_sha256: expected.input_sha256,
    cache_status: "ready",
    initial_cache: "empty",
    checks: [
      ["initial", 0],
      ["warm", 0],
      ["task-start", 0],
      ["returned-action", 0],
      ["developer-command-rejected", 2],
      ["changed-script-rejected", 1],
      ["changed-base-index-rejected", 1],
    ].map(([phase, exit]) => ({ phase, exit, milliseconds: 1 })),
  };
  const bytes = Buffer.from(JSON.stringify(report));
  fs.writeFileSync(path.join(work, "bootstrap-qualification.json"), bytes);
  assert.throws(() => inventoryCapsuleFiles(work), /empty capsule directory/u);
  const execute = () =>
    spawnSync("bash", ["-eu", "-c", String(staging.run)], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        BOOTSTRAP_WORK: work,
        BOOTSTRAP_PROOF: proof,
      },
    });
  const result = execute();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(proof), ["bootstrap-qualification.json"]);
  assert.deepEqual(fs.readFileSync(path.join(proof, "bootstrap-qualification.json")), bytes);
  assert.equal(inventoryCapsuleFiles(proof).length, 1);
  validateStageEvidence(proof, expected);
  assert.notEqual(execute().status, 0, "Existing completed evidence must not be overwritten.");
  fs.writeFileSync(
    path.join(proof, "bootstrap-qualification.json"),
    JSON.stringify({ ...report, status: "failed" }),
  );
  assert.throws(() => validateStageEvidence(proof, expected), /Incomplete or failed bootstrap/u);
  fs.mkdirSync(path.join(proof, "unexpected-empty"));
  assert.throws(() => inventoryCapsuleFiles(proof), /empty capsule directory/u);
});

test("full CI runs all platforms with independent tests and native qualification before their final join", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  const tests = object(jobs["test-shards"]),
    native = object(jobs["quality-gate"]);
  assert.equal(object(tests.strategy).matrix, "${{ fromJSON(needs.plan.outputs.test_matrix) }}");
  assert.equal(tests["timeout-minutes"], 40);
  assert.equal(object(tests.strategy)["max-parallel"], 32);
  const testMatrix = foundryCiTestMatrix(loadFoundryTestPlan(root)),
    nativeMatrix = object(object(native.strategy).matrix);
  assert.ok(Array.isArray(testMatrix.include) && Array.isArray(nativeMatrix.include));
  const testHosts = testMatrix.include.map(object),
    nativeHosts = nativeMatrix.include.map(object);
  assert.deepEqual(
    [...new Set(testHosts.map((host) => host.platform))].sort(),
    [...foundryCiPlatforms].sort(),
  );
  assert.deepEqual(nativeHosts.map((host) => host.platform).sort(), [...foundryCiPlatforms].sort());
  assert.equal(testHosts.length, 32);
  assert.match(String(native.if), /mode == 'full'/u);
  assert.match(String(native.if), /needs\.build-package\.result == 'success'/u);
  assert.ok(Array.isArray(native.needs));
  for (const requirement of ["plan", "build-package"])
    assert.ok(native.needs.includes(requirement));
  assert.ok(!native.needs.includes("verify-tests"));
  assert.ok(!(object(jobs["aggregate-runtime"]).needs as string[]).includes("verify-tests"));
  assert.ok((object(jobs["qualification-gate"]).needs as string[]).includes("verify-tests"));
  assert.match(String(object(jobs["aggregate-runtime"]).if), /mode == 'full'/u);
  assert.match(String(object(jobs["pr-checks"]).if), /mode == 'pr-fast'/u);
  assert.match(String(object(jobs["docs-pr"]).if), /mode == 'docs-only'/u);
});

test("publication consumes signed complete source qualification and retains every release dependency", () => {
  const quality = workflow("quality-gate.yml"),
    publish = workflow("publish.yml");
  const caller = object(object(publish.jobs)["release-qualification"]);
  assert.equal(caller.uses, "./.github/workflows/quality-gate.yml");
  assert.equal(object(caller.with).source_sha, "${{ needs.release-context.outputs.release_head }}");
  const call = object(object(quality.on).workflow_call);
  assert.equal(object(object(call.inputs).source_sha).required, true);
  const outputs = object(call.outputs);
  assert.match(
    String(object(outputs.package_sha256).value),
    /jobs\.build-package\.outputs\.package_sha256/u,
  );
  for (const id of ["npm-package", "prepare-runtime"]) {
    const job = object(object(publish.jobs)[id]);
    assert.ok(Array.isArray(job.needs) && job.needs.includes("release-qualification"));
    const consumer = steps(job).find(
      (step) => object(step.env ?? {}).FOUNDRY_QUALIFICATION_CAPSULE !== undefined,
    );
    assert.ok(consumer);
    const env = object(consumer.env);
    assert.equal(env.FOUNDRY_QUALIFICATION_CAPSULE, "${{ runner.temp }}/qualified-source");
    assert.equal(env.FOUNDRY_CI_PACKAGE_DIR, undefined);
    assert.equal(env.GH_TOKEN, "${{ github.token }}");
  }
});

test("full qualification cannot succeed when aggregation or copied bootstrap was skipped", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  for (const id of ["aggregate-runtime", "qualify-bootstrap-cached"]) {
    const job = object(jobs[id]);
    assert.match(String(job.if), /!cancelled\(\)/u);
    assert.match(String(job.if), /result == 'success'/u);
    assert.match(String(job.if), /mode == 'full'/u);
  }
  const complete = object(jobs["qualification-gate"]);
  assert.equal(complete.if, "always()");
  assert.ok(Array.isArray(complete.needs));
  for (const id of [
    "plan",
    "build-package",
    "verify-tests",
    "pr-checks",
    "docs-pr",
    "version-pr",
    "quality-gate",
    "aggregate-runtime",
    "qualify-bootstrap-cached",
  ])
    assert.ok(complete.needs.includes(id));
  const guard = String(steps(complete)[0].run);
  for (const key of [
    "PLAN_RESULT",
    "BUILD_RESULT",
    "TEST_RESULT",
    "PR_CHECKS_RESULT",
    "DOCS_RESULT",
    "NATIVE_RESULT",
    "AGGREGATE_RESULT",
    "BOOTSTRAP_RESULT",
    "VERSION_RESULT",
  ])
    assert.ok(guard.includes(`test "$${key}" = success`));
});

function executeGuard(job: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync("bash", ["-eu", "-c", String(steps(job)[0].run)], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).status;
}
test("real shell qualification guards reject each failed, cancelled or skipped requirement across all lanes", () => {
  const jobs = object(workflow("quality-gate.yml").jobs);
  const valid = {
    MODE: "full",
    PLAN_RESULT: "success",
    BUILD_RESULT: "success",
    TEST_RESULT: "success",
    PR_CHECKS_RESULT: "skipped",
    DOCS_RESULT: "skipped",
    VERSION_RESULT: "skipped",
    NATIVE_RESULT: "success",
    AGGREGATE_RESULT: "success",
    BOOTSTRAP_RESULT: "success",
    REUSE_VERIFIED: "false",
  };
  assert.equal(executeGuard(object(jobs["qualification-gate"]), valid), 0);
  for (const key of [
    "PLAN_RESULT",
    "BUILD_RESULT",
    "TEST_RESULT",
    "NATIVE_RESULT",
    "AGGREGATE_RESULT",
    "BOOTSTRAP_RESULT",
  ]) {
    for (const result of ["failure", "cancelled", "skipped", ""])
      assert.notEqual(
        executeGuard(object(jobs["qualification-gate"]), { ...valid, [key]: result }),
        0,
        `${key}=${result}`,
      );
  }
  const validPrFast = {
    ...valid,
    MODE: "pr-fast",
    PR_CHECKS_RESULT: "success",
    NATIVE_RESULT: "skipped",
    AGGREGATE_RESULT: "skipped",
    BOOTSTRAP_RESULT: "skipped",
  };
  assert.equal(executeGuard(object(jobs["qualification-gate"]), validPrFast), 0);
  for (const key of ["PLAN_RESULT", "BUILD_RESULT", "TEST_RESULT", "PR_CHECKS_RESULT"]) {
    for (const result of ["failure", "cancelled", "skipped", ""])
      assert.notEqual(
        executeGuard(object(jobs["qualification-gate"]), { ...validPrFast, [key]: result }),
        0,
        `pr-fast ${key}=${result}`,
      );
  }
  const validDocs = {
    ...valid,
    MODE: "docs-only",
    BUILD_RESULT: "skipped",
    TEST_RESULT: "skipped",
    DOCS_RESULT: "success",
    NATIVE_RESULT: "skipped",
    AGGREGATE_RESULT: "skipped",
    BOOTSTRAP_RESULT: "skipped",
  };
  assert.equal(executeGuard(object(jobs["qualification-gate"]), validDocs), 0);
  for (const key of ["PLAN_RESULT", "DOCS_RESULT"]) {
    for (const result of ["failure", "cancelled", "skipped", ""])
      assert.notEqual(
        executeGuard(object(jobs["qualification-gate"]), { ...validDocs, [key]: result }),
        0,
        `docs-only ${key}=${result}`,
      );
  }
  const final = object(jobs["complete-qualification"]);
  const complete = {
    MODE: "full",
    PLAN_RESULT: "success",
    GATE_RESULT: "success",
    SEALABLE: "true",
    SEAL_RESULT: "success",
    REUSE_VERIFIED: "false",
  };
  assert.equal(executeGuard(final, complete), 0);
  assert.equal(
    executeGuard(final, { ...complete, SEALABLE: "false", SEAL_RESULT: "skipped" }),
    0,
    "A bot PR retains complete validation without running a privileged seal.",
  );
  for (const mode of ["pr-fast", "docs-only", "version-only"]) {
    assert.equal(
      executeGuard(final, { ...complete, MODE: mode, SEALABLE: "false", SEAL_RESULT: "skipped" }),
      0,
      `${mode} passes only when sealing is skipped`,
    );
    assert.notEqual(
      executeGuard(final, { ...complete, MODE: mode, SEALABLE: "true", SEAL_RESULT: "success" }),
      0,
      `${mode} must never seal qualification`,
    );
  }
  for (const key of ["PLAN_RESULT", "GATE_RESULT"]) {
    for (const result of ["failure", "cancelled", "skipped", ""])
      assert.notEqual(
        executeGuard(final, {
          ...complete,
          SEALABLE: "false",
          SEAL_RESULT: "skipped",
          [key]: result,
        }),
        0,
        `An unsealable PR cannot omit ${key}=${result}.`,
      );
  }
  assert.notEqual(executeGuard(final, { ...complete, SEAL_RESULT: "skipped" }), 0);
  assert.notEqual(executeGuard(final, { ...complete, MODE: "reused", SEAL_RESULT: "skipped" }), 0);
  assert.equal(
    executeGuard(final, {
      ...complete,
      MODE: "reused",
      SEAL_RESULT: "skipped",
      REUSE_VERIFIED: "true",
    }),
    0,
  );
});

test("bounded docs-only and pr-fast verifiers fail closed outside ordinary pull requests", () => {
  const docsNonPr = spawnSync(process.execPath, [path.join(root, "devops/ci/ci-docs-gate.ts")], {
    cwd: root,
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "workflow_call",
      FOUNDRY_CI_SOURCE_SHA: "a".repeat(40),
    },
    encoding: "utf8",
  });
  assert.notEqual(docsNonPr.status, 0);
  assert.match(docsNonPr.stderr, /inspected pull request/u);

  const verifyNonPr = spawnSync(
    process.execPath,
    [
      path.join(root, "devops/ci/ci-verify-tests.ts"),
      "--input",
      path.join(os.tmpdir(), "missing-shards"),
      "--plan-sha256",
      "a".repeat(64),
      "--source-sha",
      "a".repeat(40),
      "--output",
      path.join(os.tmpdir(), "missing-out.json"),
      "--mode",
      "pr-fast",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "workflow_call",
        FOUNDRY_CI_SOURCE_SHA: "a".repeat(40),
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(verifyNonPr.status, 0);
  assert.match(verifyNonPr.stderr, /ordinary pull requests/u);
});
test("publication stages restore required proofs and diagnostics have no publication credentials", () => {
  const jobs = object(workflow("publish.yml").jobs);
  for (const id of ["publish-components", "publish-runtime-manifest"]) {
    const restore = steps(object(jobs[id])).filter((s) =>
      String(s.run).includes("ci:stage restore"),
    );
    assert.equal(restore.length, id === "publish-components" ? 4 : 5);
    for (const s of restore) assert.match(String(s.run), /--required true/u);
  }
  const native = steps(object(jobs["prepare-runtime"]));
  assert.ok(native.some((s) => String(s.run).includes("ci:stage restore")));
  assert.match(
    String(native.find((s) => String(s.run).includes("release:prepare-runtime"))?.if),
    /reused != 'true'/u,
  );
  const diagnose = object(jobs["diagnose-platform"]);
  assert.equal(object(diagnose.permissions)["id-token"], undefined);
  assert.equal(object(diagnose.permissions).contents, "read");
  const caller = object(jobs["release-qualification"]);
  assert.ok((caller.needs as string[]).includes("release-preflight"));
});

const hostSource = "a".repeat(40);
const hostPlan = planFoundryTestShards(["test/unit/a.test.mts", "test/unit/b.test.mts"], {}, 2);
function hostReceipts(): Record<string, unknown>[] {
  return foundryCiPlatforms.flatMap((platform) =>
    hostPlan.shards.map((shard) => ({
      schema: "tiangong-foundry.ci-test-shard.v1",
      status: "passed",
      source: hostSource,
      platform,
      plan_sha256: hostPlan.planSha256,
      index: shard.index,
      total: shard.total,
      files: shard.files,
      errors: [],
      counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0 },
    })),
  );
}

import {
  captureFoundryCiTestHost,
  foundryCiObservedTestOutcome,
  type FoundryCiTestHostContext,
} from "../../devops/ci/foundry-ci-test-host.ts";

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
  source: hostSource,
  plan_sha256: hostPlan.planSha256,
  index: 1,
  outcome: "passed",
  signal: null,
};
const observeHost = (facts = hostFacts, context = hostContext) =>
  captureFoundryCiTestHost("/not-an-output-path", context, (field) => facts[field]);

test("ordinary Windows observations bind the actual partition and preserve the 13 host fields", () => {
  const result = observeHost();
  assert.equal(result.schema, "tiangong-foundry.ci-test-host.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.qualification, false);
  assert.equal(result.source, hostSource);
  assert.equal(result.plan_sha256, hostPlan.planSha256);
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
  for (const outcome of ["passed", "failed", "cancelled", "signalled"] as const) {
    const observed = observeHost(hostFacts, { ...hostContext, outcome });
    assert.equal(observed.outcome, outcome);
    const input = hostReceipts();
    for (const row of input) row.host_observation = observed;
    assert.deepEqual(
      verifyFoundryTestShards(input, hostSource, hostPlan),
      verifyFoundryTestShards(hostReceipts(), hostSource, hostPlan),
    );
    input[0].status = "failed";
    assert.throws(() => verifyFoundryTestShards(input, hostSource, hostPlan), /differs/);
  }
});

test("signals and Node cancellation counts do not relabel an observed test failure", () => {
  assert.equal(foundryCiObservedTestOutcome("passed", { failed: 0, cancelled: 0 }, null), "passed");
  assert.equal(foundryCiObservedTestOutcome("failed", { failed: 1, cancelled: 1 }, null), "failed");
  assert.equal(
    foundryCiObservedTestOutcome("failed", { failed: 1, cancelled: 1 }, "SIGABRT"),
    "failed",
  );
  assert.equal(
    foundryCiObservedTestOutcome("failed", { failed: 0, cancelled: 1 }, null),
    "cancelled",
  );
  for (const signal of ["SIGSEGV", "SIGABRT", "SIGKILL", "SIGTERM"] as const) {
    assert.equal(foundryCiObservedTestOutcome("failed", null, signal), "signalled");
    const observed = observeHost(hostFacts, { ...hostContext, outcome: "signalled", signal });
    assert.equal(observed.signal, signal);
  }
  assert.equal(foundryCiObservedTestOutcome("failed", null, null), "failed");
});

test("host collection follows the original elapsed snapshot and is Windows-only in the ordinary entry", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const entry = fs.readFileSync(path.join(root, "devops/ci/ci-test-shard.ts"), "utf8");
  assert.ok(
    entry.includes('process.platform === "win32" && process.env.GITHUB_ACTIONS === "true"'),
  );
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
