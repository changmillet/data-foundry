import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before, after, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { copyTrustedRuntimeManifestBytes, describeCliRuntime } from "@tiangong-lca/cli/runtime";
import { spawn, spawnSync } from "node:child_process";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import { createFoundryRuntimeAdoptionQualification } from "../../scripts/public-api.ts";
import {
  createFoundryPackageDescriptor,
  captureFoundryPackageFile,
} from "../../scripts/lib/foundry-package-contract.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { createFoundryRuntime } from "../../scripts/foundry-runtime.ts";
import {
  currentAdoptionRuntime,
  readFoundryTaskRuntimeAdoptionChain,
  adoptionSuccessorPath,
} from "../../scripts/lib/foundry-task-runtime-adoption.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";
import { bytes, digest } from "../../scripts/lib/foundry-task-io.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { runFoundryPublicCommand } from "../../scripts/runtime-entry.ts";
import { copyCliProductionClosure } from "../helpers/managed-adoption-fixture.mts";
import { runFoundryTaskOperation } from "../../scripts/lib/foundry-task-store.ts";

// Build once in a test-owned root: the package-consumer scenario rebuilds the repo's stage concurrently.
let buildRoot: string;
let packageRoot: string;
let moduleUrl: string;
before(async () => {
  buildRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-adoption-build-")));
  const repo = path.resolve(import.meta.dirname, "../..");
  for (const selected of [
    "scripts",
    "specs",
    "docs",
    "package.json",
    "tsconfig.json",
    "tsconfig.package.json",
    "README.md",
    "LICENSE",
  ])
    fs.cpSync(path.join(repo, selected), path.join(buildRoot, selected), { recursive: true });
  fs.symlinkSync(
    path.join(repo, "node_modules"),
    path.join(buildRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const built = spawnSync(
    process.execPath,
    [path.join(buildRoot, "scripts/build-foundry-package.ts")],
    { cwd: buildRoot, encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr || built.stdout);
  packageRoot = path.join(buildRoot, "package-stage");
  const cli = describeCliRuntime();
  const ownedCli = path.join(packageRoot, "node_modules/@tiangong-lca/cli");
  await copyCliProductionClosure(cli.package.root, path.join(packageRoot, "node_modules"));
  for (const file of cli.files)
    assert.equal(
      fs.statSync(path.join(ownedCli, file.path)).nlink,
      1,
      "The initial successor must own its retained CLI payload independently of the pnpm store",
    );
  moduleUrl = pathToFileURL(path.join(packageRoot, "package-dist/scripts/package-entry.js")).href;
});
after(() => {
  if (buildRoot) fs.rmSync(buildRoot, { recursive: true, force: true });
});
const json = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

for (const [captureOrdinal, caught] of [
  [1, false],
  [2, false],
  [2, true],
] as const) {
  test(`existing-output capture rejects retained CLI drift after pass ${captureOrdinal}${caught ? " even when caught" : ""}`, async (t) => {
    const f = await fixture(t);
    const plan = await f.plan();
    const adopted = await f.successor().adoptTaskRuntime({
      ...f.invocation,
      mode: "apply",
      plan,
    });
    assert.equal(adopted.status, "completed", JSON.stringify(adopted));
    const artifact = path.join(f.taskRoot, "outputs", "capture-cli-drift.bin");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "owned unchanged output\n");
    const originalIndex = fs.readFileSync(path.join(f.taskRoot, "artifact-index.jsonl"));
    const open = fs.openSync;
    const close = fs.closeSync;
    let descriptor: number | undefined;
    let changed = false;
    let captures = 0;
    t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
      const fd = open(...args);
      if (!changed && typeof args[0] === "string" && path.resolve(args[0]) === artifact)
        descriptor = fd;
      return fd;
    });
    t.mock.method(fs, "closeSync", (fd: number) => {
      close(fd);
      if (!changed && fd === descriptor) {
        descriptor = undefined;
        captures++;
        if (captures === captureOrdinal) {
          changed = true;
          fs.appendFileSync(path.join(f.oldCliRoot, "package.json"), "\n");
        }
      }
    });
    let operationId = "";
    await assert.rejects(
      () =>
        runFoundryTaskOperation(
          f.context,
          { command: "dataset-workflow-assessment", options: { capture_cli_drift: true } },
          (operation) => {
            operationId = operation.operationId;
            const report = { status: "reported-before-capture" };
            operation.writeJson("outputs/capture-cli-drift-report.json", report);
            if (caught)
              assert.throws(
                () => operation.registerExistingFiles([artifact]),
                (error: unknown) =>
                  Boolean(
                    error &&
                    typeof error === "object" &&
                    "code" in error &&
                    error.code === "runtime_adoption_dependency_changed",
                  ),
              );
            else operation.registerExistingFiles([artifact]);
            return report;
          },
        ),
      (error: unknown) =>
        Boolean(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "runtime_adoption_dependency_changed",
        ),
    );
    assert.equal(changed, true, "The first fresh output capture reached the owned CLI drift hook.");
    assert.ok(operationId);
    assert.equal(fs.existsSync(path.join(f.taskRoot, `checkpoints/${operationId}.json`)), false);
    assert.deepEqual(fs.readFileSync(path.join(f.taskRoot, "artifact-index.jsonl")), originalIndex);
    assert.equal(fs.readFileSync(artifact, "utf8"), "owned unchanged output\n");
  });
}

async function fixture(t: TestContext, sameSummary = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-task-adoption-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldRoot = path.join(root, "old-package");
  fs.cpSync(packageRoot, oldRoot, { recursive: true });
  const oldEntry = path.join(oldRoot, "package-dist/scripts/package-entry.js");
  fs.appendFileSync(
    sameSummary
      ? path.join(oldRoot, "package-dist/scripts/lib/foundry-task-runtime-adoption.js")
      : oldEntry,
    "\n// immutable earlier package fixture\n",
  );
  const descriptorFile = path.join(oldRoot, "package-dist/assets/foundry-package-descriptor.json");
  const oldDescriptor = JSON.parse(fs.readFileSync(descriptorFile, "utf8")) as {
    files: { path: string }[];
  };
  json(
    descriptorFile,
    createFoundryPackageDescriptor(
      oldDescriptor.files.map((fact) => captureFoundryPackageFile(oldRoot, fact.path)),
    ),
  );
  const cli = describeCliRuntime();
  const oldCliRoot = path.join(oldRoot, "node_modules/@tiangong-lca/cli");
  fs.cpSync(cli.package.root, oldCliRoot, { recursive: true });
  const oldCliPackage = path.join(oldCliRoot, "package.json");
  const oldCliManifest = JSON.parse(fs.readFileSync(oldCliPackage, "utf8")) as Record<
    string,
    unknown
  >;
  // Synthetic exact package difference; actual old/new release qualification is a separate installed test.
  json(oldCliPackage, { ...oldCliManifest, version: sameSummary ? cli.package.version : "0.1.24" });
  const oldFiles = cli.files.map((file) => ({
    ...captureFoundryInput(path.join(oldCliRoot, file.path)),
    path: file.path,
  }));
  const expectation = {
    schema: "tiangong-lca.cli-runtime-expectation.v1",
    package_version: cli.package.version,
    platform: cli.platform,
    content_sha256: cli.content_sha256,
    node_version: cli.node.version,
    node_sha256: cli.node.sha256,
  };
  const manifest = workspaceManifestFixture({
    write: ["migration-adoption-v1", "registered-tasks-v2"],
  });
  const oldManifest = path.join(root, "old-manifest.json"),
    newManifest = path.join(root, "new-manifest.json");
  fs.writeFileSync(oldManifest, copyTrustedRuntimeManifestBytes(manifest));
  fs.writeFileSync(newManifest, copyTrustedRuntimeManifestBytes(manifest));
  const workspace = path.join(root, "workspace"),
    cacheBase = path.join(root, "cache");
  const runtimeSelection = workflowFixture(t).runtimeSelection;
  const options = {
    moduleUrl,
    workspace,
    cacheBase,
    runtimeSelection,
    workspaceAccess: { manifest, access: "write" as const },
  };
  const old = createFoundryFacade({ ...options, moduleUrl: pathToFileURL(oldEntry).href });
  assert.equal(old.initialize().status, "ready");
  const seed = path.join(root, "seed.json");
  json(seed, {
    rows: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        version: "00.00.001",
        json: { flowDataSet: {} },
      },
    ],
  });
  const spec = path.join(root, "task.json");
  json(spec, {
    schema: "tiangong-foundry.task-start.v1",
    request_id: "same-original-task",
    actor_id: "original-writer",
    lane: "source-evidence-dataset-development",
    profile_id: "generic",
    target_entities: ["flow"],
    sources: [{ path: seed }],
    seed: { path: seed },
    account_intent: null,
    preparation: null,
  });
  const started = await old.start({ specFile: spec });
  assert.equal(started.status, "ready", JSON.stringify(started));
  const invocation = { taskId: started.task_id!, actorId: "original-writer" };
  const context = createFoundryRuntimeContext({
    ...options,
    ...invocation,
    inputs: [captureFoundryInput(seed)],
  });
  const taskRoot = context.taskRoot!;
  const registrationPath = path.join(
    workspace,
    ".foundry/state/task-registrations",
    `${invocation.taskId}.json`,
  );
  const registration = JSON.parse(fs.readFileSync(registrationPath, "utf8")) as {
    job: { runtime_identity: unknown };
  };
  const report = path.join(root, "independent-report.json"),
    authorization = path.join(root, "authorization.json"),
    handoff = path.join(root, "writer-stopped.json");
  json(report, { result: "reviewed compatible fixture", boundary: "synthetic only" });
  json(authorization, { scope: "test local adoption only" });
  json(handoff, { writer: invocation.actorId, stopped: true });
  const oldTidas = path.join(root, "old-tidas"),
    newTidas = runtimeSelection.tidasExecutable;
  fs.copyFileSync(newTidas, oldTidas);
  const q = {
    schema: "tiangong-foundry.runtime-adoption-qualification.v1",
    original_descriptor_sha256: captureFoundryInput(descriptorFile).sha256,
    successor_descriptor_sha256: captureFoundryInput(
      path.join(packageRoot, "package-dist/assets/foundry-package-descriptor.json"),
    ).sha256,
    original_runtime: registration.job.runtime_identity,
    successor_runtime: currentAdoptionRuntime(context),
    original_manifest_sha256: captureFoundryInput(oldManifest).sha256,
    successor_manifest_sha256: captureFoundryInput(newManifest).sha256,
    original_cli: {
      expectation: {
        ...expectation,
        package_version: sameSummary ? cli.package.version : "0.1.24",
        content_sha256: digest(JSON.stringify(oldFiles)),
      },
      files: oldFiles,
    },
    successor_cli: { expectation, files: cli.files },
    tidas: [captureFoundryInput(oldTidas), captureFoundryInput(newTidas)],
    reviewer: "independent-fixture-reviewer",
    evidence: [captureFoundryInput(report)],
    allowed_changes: ["foundry", "cli"],
    runtime_manifests: [captureFoundryInput(oldManifest), captureFoundryInput(newManifest)],
  };
  const trusted = () => {
    const bytes = Buffer.from(JSON.stringify(q));
    return createFoundryRuntimeAdoptionQualification({ bytes, expectedSha256: digest(bytes) });
  };
  const selection = {
    schema: "tiangong-foundry.task-runtime-compatibility-selection.v1",
    scope: [
      {
        task_id: invocation.taskId,
        registration_sha256: captureFoundryInput(registrationPath).sha256,
      },
    ],
    original_entry: captureFoundryInput(oldEntry),
    original_descriptor: captureFoundryInput(descriptorFile),
    original_runtime: registration.job.runtime_identity,
    successor_runtime: currentAdoptionRuntime(context),
    qualification: q,
    authorization: captureFoundryInput(authorization),
    writer_handoff: {
      schema: "tiangong-foundry.runtime-adoption-handoff.v1",
      task_id: invocation.taskId,
      actor_id: invocation.actorId,
      registration_sha256: captureFoundryInput(registrationPath).sha256,
      writer_stopped: true,
      evidence: captureFoundryInput(handoff),
    },
  };
  const successor = () =>
    createFoundryFacade({ ...options, runtimeAdoptionQualification: trusted() });
  const plan = async () => {
    const result = await successor().adoptTaskRuntime({ ...invocation, mode: "plan", selection });
    assert.equal(result.status, "ready", JSON.stringify(result));
    const artifact = result.artifacts[0];
    assert.equal(artifact.kind, "inline");
    return artifact.kind === "inline" ? artifact.value : null;
  };
  const snapshot = () =>
    [
      registrationPath,
      "foundry-job.json",
      "source-manifest.json",
      "profile-lock.json",
      "seed-manifest.json",
      "artifact-index.jsonl",
    ].map((name) => captureFoundryInput(path.isAbsolute(name) ? name : path.join(taskRoot, name)));
  return {
    root,
    oldRoot,
    oldEntry,
    oldCliRoot,
    old,
    options,
    invocation,
    context,
    taskRoot,
    seed,
    selection,
    q,
    trusted,
    successor,
    plan,
    snapshot,
    newTidas,
  };
}

async function retainedAssessmentHistory(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  const originalContext = createFoundryRuntimeContext({
    ...f.options,
    ...f.invocation,
    moduleUrl: pathToFileURL(f.oldEntry).href,
    inputs: [captureFoundryInput(f.seed)],
  });
  // Synthetic assessment-sized outputs, registered by the real original-owner transaction.
  // These exercise complete producer history, not scientific assessment acceptance.
  const content = Buffer.from(JSON.stringify({ evidence: "x".repeat(2 * 1024 * 1024 - 15) }));
  assert.equal(content.length, 2 * 1024 * 1024);
  const files: string[] = [];
  for (let generation = 0; generation < count / 4; generation++) {
    const directory = `outputs/assessment-history/${generation}`;
    await runFoundryTaskOperation(
      originalContext,
      { command: "dataset-workflow-assessment", options: { retained_generation: generation } },
      (operation) => {
        const batch = Array.from({ length: 4 }, (_, index) =>
          path.join(f.taskRoot, directory, `evidence-${index}.json`),
        );
        fs.mkdirSync(path.dirname(batch[0]), { recursive: true });
        for (const file of batch) fs.writeFileSync(file, content);
        operation.registerExistingFiles(batch);
        const report = { generation, status: "retained-synthetic-assessment" };
        operation.writeJson(`${directory}/report.json`, report);
        files.push(...batch);
        return report;
      },
    );
  }
  return files.map((file) => captureFoundryInput(file));
}

test("same-task adoption preserves complete registered assessment history above 64 MiB", async (t) => {
  const f = await fixture(t);
  const retained = await retainedAssessmentHistory(f, 80);
  const before = f.snapshot();
  const plan = await f.plan();
  assert.ok(plan && typeof plan === "object" && "witness" in plan);
  const witness = plan.witness as { path: string; bytes: number; sha256: string }[];
  assert.ok(witness.reduce((sum, fact) => sum + fact.bytes, 0) > 160 * 1024 * 1024);
  assert.equal(new Set(witness.map((fact) => fact.path)).size, witness.length);
  for (const fact of retained)
    assert.deepEqual(
      witness.find((item) => path.join(f.taskRoot, item.path) === fact.path),
      { ...fact, path: path.relative(f.taskRoot, fact.path).split(path.sep).join("/") },
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
    assert.equal(result.status, "completed", JSON.stringify(result));
  }
  const audit = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "audit" });
  assert.equal(audit.status, "completed", JSON.stringify(audit));
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(
    retained.map((fact) => captureFoundryInput(fact.path)),
    retained,
  );
});

function assertNoAdoption(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(fs.existsSync(path.join(f.taskRoot, "runtime-adoptions")), false);
  assert.equal(
    fs.existsSync(
      path.join(f.context.stateRoot, "task-runtime-adoptions", `${f.invocation.taskId}.json`),
    ),
    false,
  );
}

for (const mode of ["plan", "apply"] as const) {
  test(`same-task adoption rejects more than 256 MiB of unique history during ${mode}`, async (t) => {
    const f = await fixture(t);
    const plan = mode === "apply" ? await f.plan() : null;
    await retainedAssessmentHistory(f, 128);
    const before = f.snapshot();
    const result = await f.successor().adoptTaskRuntime({
      ...f.invocation,
      mode,
      ...(mode === "plan" ? { selection: f.selection } : { plan }),
    });
    assert.equal(result.blockers[0]?.code, "runtime_adoption_limit", JSON.stringify(result));
    assert.equal(result.blockers[0]?.message, "Task witness exceeds 256 MiB.");
    assert.deepEqual(f.snapshot(), before);
    assertNoAdoption(f);
  });
}

for (const changed of ["artifact", "producer-receipt", "producer-plan", "missing", "oversized"]) {
  test(`late retained history ${changed} is still verified above 64 MiB`, async (t) => {
    const f = await fixture(t);
    const retained = await retainedAssessmentHistory(f, 40);
    const plan = await f.plan();
    let target = retained.at(-1)!.path;
    if (changed.startsWith("producer-")) {
      const entries = fs
        .readFileSync(path.join(f.taskRoot, "artifact-index.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              path: string;
              receipt: { path: string };
            },
        );
      const entry = entries.find((item) => path.join(f.taskRoot, item.path) === target)!;
      target = path.join(f.taskRoot, entry.receipt.path);
      if (changed === "producer-plan") {
        const receipt = JSON.parse(fs.readFileSync(target, "utf8")) as { plan: { path: string } };
        target = path.join(f.taskRoot, receipt.plan.path);
      }
    }
    if (changed === "missing") fs.unlinkSync(target);
    else if (changed === "oversized") fs.writeFileSync(target, Buffer.alloc(8 * 1024 * 1024 + 1));
    else fs.appendFileSync(target, " ");
    const before = f.snapshot();
    for (const mode of ["apply", "plan"] as const) {
      const result = await f.successor().adoptTaskRuntime({
        ...f.invocation,
        mode,
        ...(mode === "plan" ? { selection: f.selection } : { plan }),
      });
      assert.equal(
        result.blockers[0]?.code,
        changed === "missing"
          ? "runtime_operation_failed"
          : changed === "oversized"
            ? "task_document_invalid"
            : "runtime_adoption_evidence_changed",
        JSON.stringify(result),
      );
      assert.deepEqual(f.snapshot(), before);
      assertNoAdoption(f);
    }
  });
}

test("large retained history rejects conflicting facts, unsafe paths and another actor", async (t) => {
  const f = await fixture(t);
  await retainedAssessmentHistory(f, 40);
  const plan = await f.plan();
  const indexFile = path.join(f.taskRoot, "artifact-index.jsonl");
  const originalIndex = fs.readFileSync(indexFile, "utf8");
  const last = JSON.parse(originalIndex.trim().split("\n").at(-1)!) as {
    sequence: number;
    record_sha256: string;
    path: string;
    sha256: string;
  };
  for (const unsafe of [false, true]) {
    const { record_sha256: previous, ...entry } = last;
    const unsigned = {
      ...entry,
      sequence: last.sequence + 1,
      previous_sha256: previous,
      ...(unsafe ? { path: "../outside.json" } : { sha256: "0".repeat(64) }),
    };
    fs.appendFileSync(
      indexFile,
      `${JSON.stringify({ ...unsigned, record_sha256: sha256Json(unsigned) })}\n`,
    );
    try {
      const result = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
      assert.equal(
        result.blockers[0]?.code,
        unsafe ? "task_index_invalid" : "runtime_adoption_evidence_changed",
        JSON.stringify(result),
      );
      assertNoAdoption(f);
    } finally {
      fs.writeFileSync(indexFile, originalIndex);
    }
  }
  const wrongActor = await f.successor().adoptTaskRuntime({
    ...f.invocation,
    actorId: "unrelated-writer",
    mode: "apply",
    plan,
  });
  assert.equal(wrongActor.blockers[0]?.code, "task_actor_mismatch", JSON.stringify(wrongActor));
  assertNoAdoption(f);
});

test("large retained history rejects a linked ancestor without publishing adoption", async (t) => {
  const f = await fixture(t);
  const retained = await retainedAssessmentHistory(f, 40);
  const plan = await f.plan();
  const directory = path.dirname(retained.at(-1)!.path);
  const outside = path.join(f.root, "relocated-history");
  fs.renameSync(directory, outside);
  try {
    fs.symlinkSync(outside, directory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (
      process.platform === "win32" &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EPERM"
    ) {
      t.skip("This Windows host does not permit a directory junction.");
      return;
    }
    throw error;
  }
  const result = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
  assert.equal(result.blockers[0]?.code, "symlink_not_allowed", JSON.stringify(result));
  assertNoAdoption(f);
});

test("large retained history rejects changed bytes returned during witness reading", async (t) => {
  const f = await fixture(t);
  const retained = await retainedAssessmentHistory(f, 40);
  const plan = await f.plan();
  const target = retained.at(-1)!.path;
  const read = fs.readFileSync;
  let observed = false;
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    const content = read(...args);
    if (
      typeof args[0] === "string" &&
      path.resolve(args[0]) === target &&
      Buffer.isBuffer(content)
    ) {
      observed = true;
      content[0] ^= 1;
    }
    return content;
  });
  const result = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
  assert.equal(observed, true);
  assert.equal(
    result.blockers[0]?.code,
    "runtime_adoption_evidence_changed",
    JSON.stringify(result),
  );
  assertNoAdoption(f);
});

function nextRuntime(
  f: Awaited<ReturnType<typeof fixture>>,
  previous: ReturnType<typeof createFoundryRuntimeContext>,
  predecessor: string,
  label: string,
  sameSummary = false,
) {
  const runtimeRoot = path.join(f.root, label);
  fs.cpSync(previous.runtimeRoot, runtimeRoot, { recursive: true });
  const entry = path.join(runtimeRoot, "package-dist/scripts/package-entry.js");
  fs.appendFileSync(
    sameSummary
      ? path.join(runtimeRoot, "package-dist/scripts/lib/foundry-task-runtime-adoption.js")
      : entry,
    `\n// exact successor fixture ${label}\n`,
  );
  const descriptor = path.join(runtimeRoot, "package-dist/assets/foundry-package-descriptor.json");
  const declared = JSON.parse(fs.readFileSync(descriptor, "utf8")) as { files: { path: string }[] };
  json(
    descriptor,
    createFoundryPackageDescriptor(
      declared.files.map((fact) => captureFoundryPackageFile(runtimeRoot, fact.path)),
    ),
  );
  const cli = describeCliRuntime();
  if (!fs.existsSync(path.join(runtimeRoot, "node_modules/@tiangong-lca/cli/package.json")))
    fs.cpSync(cli.package.root, path.join(runtimeRoot, "node_modules/@tiangong-lca/cli"), {
      recursive: true,
    });
  assert.equal(
    fs.realpathSync(path.join(runtimeRoot, "node_modules/@tiangong-lca/cli")),
    path.join(runtimeRoot, "node_modules/@tiangong-lca/cli"),
    "Every drift fixture must own regular CLI bytes rather than a shared dependency link",
  );
  const options = { ...f.options, moduleUrl: pathToFileURL(entry).href };
  const context = createFoundryRuntimeContext({
    ...options,
    ...f.invocation,
    inputs: [captureFoundryInput(f.seed)],
  });
  const stopped = path.join(f.root, `${label}-writer-stopped.json`);
  json(stopped, {
    writer: f.invocation.actorId,
    stopped: true,
    predecessor_plan_sha256: predecessor,
  });
  const nextManifest = path.join(f.root, `${label}-manifest.json`);
  fs.copyFileSync(f.q.runtime_manifests[1].path, nextManifest);
  const previousTidas = path.join(f.root, `${label}-previous-tidas`);
  fs.copyFileSync(f.newTidas, previousTidas);
  const q = {
    ...f.q,
    original_runtime: currentAdoptionRuntime(previous),
    successor_runtime: currentAdoptionRuntime(context),
    original_descriptor_sha256: captureFoundryInput(
      path.join(previous.runtimeRoot, "package-dist/assets/foundry-package-descriptor.json"),
    ).sha256,
    successor_descriptor_sha256: captureFoundryInput(descriptor).sha256,
    original_manifest_sha256: f.q.successor_manifest_sha256,
    original_cli: f.q.successor_cli,
    runtime_manifests: [f.q.runtime_manifests[1], captureFoundryInput(nextManifest)],
    tidas: [captureFoundryInput(previousTidas), captureFoundryInput(f.newTidas)],
  };
  const selection = {
    ...f.selection,
    original_entry: captureFoundryInput(
      path.join(previous.runtimeRoot, "package-dist/scripts/package-entry.js"),
    ),
    original_descriptor: captureFoundryInput(
      path.join(previous.runtimeRoot, "package-dist/assets/foundry-package-descriptor.json"),
    ),
    original_runtime: currentAdoptionRuntime(previous),
    successor_runtime: currentAdoptionRuntime(context),
    qualification: q,
    writer_handoff: {
      ...f.selection.writer_handoff,
      schema: "tiangong-foundry.runtime-adoption-handoff.v2",
      predecessor_plan_sha256: predecessor,
      evidence: captureFoundryInput(stopped),
    },
  };
  const trusted = () => {
    const data = Buffer.from(JSON.stringify(q));
    return createFoundryRuntimeAdoptionQualification({ bytes: data, expectedSha256: digest(data) });
  };
  const facade = () => createFoundryFacade({ ...options, runtimeAdoptionQualification: trusted() });
  const plan = async () => {
    const result = await facade().adoptTaskRuntime({ ...f.invocation, mode: "plan", selection });
    assert.equal(result.status, "ready", JSON.stringify(result));
    const artifact = result.artifacts[0];
    assert.equal(artifact.kind, "inline");
    return artifact.kind === "inline" ? (artifact.value as Record<string, unknown>) : {};
  };
  return { context, options, q, selection, trusted, facade, plan };
}

test("three same-version transitions bind full inventories when all four legacy identity fields stay equal", async (t) => {
  const f = await fixture(t, true);
  assert.deepEqual(f.selection.original_runtime, f.selection.successor_runtime);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const second = nextRuntime(f, f.context, String(first.plan_sha256), "same-summary-second", true);
  assert.deepEqual(second.selection.original_runtime, second.selection.successor_runtime);
  const secondPlan = await second.plan();
  assert.equal(
    (await second.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: secondPlan }))
      .status,
    "completed",
  );
  const third = nextRuntime(
    f,
    second.context,
    String(secondPlan.plan_sha256),
    "same-summary-third",
    true,
  );
  assert.deepEqual(third.selection.original_runtime, third.selection.successor_runtime);
  const thirdPlan = await third.plan();
  assert.equal(
    (await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: thirdPlan }))
      .status,
    "completed",
  );
  assert.equal((await f.old.status(f.invocation)).status, "blocked");
  assert.equal((await f.successor().status(f.invocation)).status, "blocked");
  assert.equal((await second.facade().status(f.invocation)).status, "blocked");
  assert.equal(
    (await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "audit" })).status,
    "completed",
  );
});

test("a retained v1 first receipt and its anchor remain unchanged while later context facts accumulate", async (t) => {
  const f = await fixture(t);
  assert.notEqual((await f.old.resume(f.invocation)).status, "failed");
  const current = (await f.plan()) as Record<string, unknown>;
  const {
    plan_sha256: _sha,
    predecessor_plan_sha256: _predecessor,
    successor_entry: _entry,
    successor_descriptor: _descriptor,
    ...legacyPayload
  } = current;
  const payload = { ...legacyPayload, schema: "tiangong-foundry.task-runtime-adoption-plan.v1" };
  const first = { ...payload, plan_sha256: sha256Json(payload) };
  const receiptPath = path.join(f.taskRoot, "runtime-adoptions", `${first.plan_sha256}.json`);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, bytes(first));
  const anchorPath = path.join(
    f.context.stateRoot,
    "task-runtime-adoptions",
    `${f.invocation.taskId}.json`,
  );
  json(anchorPath, {
    schema: "tiangong-foundry.task-runtime-adoption-anchor.v1",
    workspace_id: f.context.workspaceId,
    task_id: f.invocation.taskId,
    plan_sha256: first.plan_sha256,
    receipt_sha256: digest(bytes(first)),
  });
  const originalReceipt = captureFoundryInput(receiptPath),
    originalAnchor = captureFoundryInput(anchorPath);
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "audit" })).status,
    "completed",
  );
  assert.notEqual((await f.successor().resume(f.invocation)).status, "failed");
  const next = nextRuntime(f, f.context, first.plan_sha256, "legacy-next");
  const nextPlan = await next.plan();
  assert.equal(
    (await next.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: nextPlan }))
      .status,
    "completed",
  );
  const chain = readFoundryTaskRuntimeAdoptionChain(next.context)!;
  assert.equal(chain.plans.length, 2);
  assert.equal(chain.plans[0].schema, "tiangong-foundry.task-runtime-adoption-plan.v1");
  assert.equal(chain.prior_context_reports.length, 2);
  assert.deepEqual(captureFoundryInput(receiptPath), originalReceipt);
  assert.deepEqual(captureFoundryInput(anchorPath), originalAnchor);
});

test("second and third qualified runtime transitions retain the original same-Task anchor and receipts", async (t) => {
  const f = await fixture(t);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const original = f.snapshot();
  const anchor = path.join(
    f.context.stateRoot,
    "task-runtime-adoptions",
    `${f.invocation.taskId}.json`,
  );
  const firstAnchor = captureFoundryInput(anchor);
  const second = nextRuntime(f, f.context, String(first.plan_sha256), "second-package");
  const secondPlan = await second.plan();
  assert.equal(secondPlan.predecessor_plan_sha256, first.plan_sha256);
  assert.equal(
    (await second.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: secondPlan }))
      .status,
    "completed",
  );
  const third = nextRuntime(f, second.context, String(secondPlan.plan_sha256), "third-package");
  const thirdPlan = await third.plan();
  assert.equal(thirdPlan.predecessor_plan_sha256, secondPlan.plan_sha256);
  assert.equal(
    (await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: thirdPlan }))
      .status,
    "completed",
  );
  assert.equal(
    (await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "audit" })).status,
    "completed",
  );
  assert.deepEqual(captureFoundryInput(anchor), firstAnchor);
  assert.deepEqual(f.snapshot(), original);
  for (const plan of [first, secondPlan, thirdPlan])
    assert.ok(
      fs.existsSync(path.join(f.taskRoot, "runtime-adoptions", `${plan.plan_sha256}.json`)),
    );
  assert.equal((await f.successor().status(f.invocation)).status, "blocked");
  assert.equal((await second.facade().status(f.invocation)).status, "blocked");
  assert.equal((await third.facade().status(f.invocation)).task_id, f.invocation.taskId);
  const chain = readFoundryTaskRuntimeAdoptionChain(third.context)!;
  assert.equal(chain.plans.length, 3);
  assert.deepEqual(chain.retained_runtime_roots, [
    f.oldRoot,
    f.context.runtimeRoot,
    second.context.runtimeRoot,
    third.context.runtimeRoot,
  ]);
  assert.equal(
    readFoundryTaskRuntimeAdoptionChain(f.context)?.tip.plan_sha256,
    thirdPlan.plan_sha256,
    "historical inspection does not permit obsolete continuation",
  );
});

test("successive adoption rejects an independently qualified pair that skips the current predecessor", async (t) => {
  const f = await fixture(t);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const next = nextRuntime(f, f.context, String(first.plan_sha256), "skipped-predecessor");
  next.selection.writer_handoff.predecessor_plan_sha256 = "0".repeat(64);
  const stoppedPoint = await next
    .facade()
    .adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: next.selection });
  assert.equal(stoppedPoint.blockers[0]?.code, "runtime_adoption_predecessor_mismatch");
  next.selection.writer_handoff.predecessor_plan_sha256 = String(first.plan_sha256);
  next.q.original_runtime = {
    ...currentAdoptionRuntime(f.context),
    ...(f.selection.original_runtime as Record<string, string>),
  };
  next.q.original_descriptor_sha256 = f.selection.original_descriptor.sha256;
  next.q.original_cli = f.q.original_cli;
  next.selection.original_runtime = next.q.original_runtime;
  next.selection.original_entry = f.selection.original_entry;
  next.selection.original_descriptor = f.selection.original_descriptor;
  const result = await next
    .facade()
    .adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: next.selection });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers[0]?.code, "runtime_adoption_scope_mismatch");
  assert.equal(readFoundryTaskRuntimeAdoptionChain(f.context)?.plans.length, 1);
});

test("successive pair qualification cannot relabel a changed Toolkit as the preceding runtime", async (t) => {
  const f = await fixture(t);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const next = nextRuntime(f, f.context, String(first.plan_sha256), "toolkit-pair");
  const changedToolkit = path.join(f.root, "changed-toolkit.ts"),
    previousCopy = path.join(f.root, "changed-previous-toolkit.ts");
  fs.copyFileSync(f.newTidas, changedToolkit);
  fs.appendFileSync(changedToolkit, "\n// independently qualified different Toolkit bytes\n");
  fs.copyFileSync(changedToolkit, previousCopy);
  const current = captureFoundryInput(changedToolkit);
  next.options.runtimeSelection = {
    ...next.options.runtimeSelection,
    tidasExecutable: changedToolkit,
    tidasExpectation: {
      ...next.options.runtimeSelection.tidasExpectation,
      executable: { bytes: current.bytes, sha256: current.sha256 },
    },
  };
  next.q.tidas = [captureFoundryInput(previousCopy), current];
  const result = await next
    .facade()
    .adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: next.selection });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers[0]?.code, "runtime_adoption_predecessor_mismatch");
  assert.equal(readFoundryTaskRuntimeAdoptionChain(f.context)?.plans.length, 1);
});

test("a competing successor plan becomes stale after the immediately preceding adoption changes", async (t) => {
  const f = await fixture(t);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const winner = nextRuntime(f, f.context, String(first.plan_sha256), "cas-winner");
  const loser = nextRuntime(f, f.context, String(first.plan_sha256), "cas-loser");
  const winnerPlan = await winner.plan(),
    loserPlan = await loser.plan();
  assert.equal(
    (await winner.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: winnerPlan }))
      .status,
    "completed",
  );
  const result = await loser
    .facade()
    .adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: loserPlan });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers[0]?.code, "runtime_adoption_plan_stale");
  assert.equal(
    readFoundryTaskRuntimeAdoptionChain(winner.context)?.tip.plan_sha256,
    winnerPlan.plan_sha256,
  );
  assert.equal(
    fs.existsSync(path.join(f.taskRoot, "runtime-adoptions", `${loserPlan.plan_sha256}.json`)),
    false,
  );
});

test("concurrent qualified successors publish exactly one immutable transition", async (t) => {
  const f = await fixture(t);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const left = nextRuntime(f, f.context, String(first.plan_sha256), "concurrent-left");
  const right = nextRuntime(f, f.context, String(first.plan_sha256), "concurrent-right");
  const leftPlan = await left.plan(),
    rightPlan = await right.plan();
  const results = await Promise.all([
    left.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: leftPlan }),
    right.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: rightPlan }),
  ]);
  assert.equal(results.filter((result) => result.status === "completed").length, 1);
  const chain = readFoundryTaskRuntimeAdoptionChain(left.context)!;
  assert.equal(chain.plans.length, 2);
  assert.ok([leftPlan.plan_sha256, rightPlan.plan_sha256].includes(chain.tip.plan_sha256));
  assert.equal(fs.readdirSync(path.join(f.taskRoot, "runtime-adoptions")).length, 2);
  assert.equal(
    fs.readdirSync(path.dirname(adoptionSuccessorPath(f.context, String(first.plan_sha256))))
      .length,
    1,
  );
});

test("successive adoption retains consumed and UNKNOWN history and cannot clear original-owner recovery", async (t) => {
  const f = await fixture(t);
  const attempted = path.join(f.taskRoot, "attempts/unknown.json");
  json(attempted, { state: "UNKNOWN_DO_NOT_REPLAY", consumed: true });
  const retained = captureFoundryInput(attempted);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const next = nextRuntime(f, f.context, String(first.plan_sha256), "unknown-successor");
  const plan = await next.plan();
  assert.equal(plan.continuation, "original_owner_recovery");
  assert.equal(
    (await next.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan })).status,
    "completed",
  );
  const status = await next.facade().status(f.invocation);
  assert.equal(status.blockers[0]?.code, "runtime_adoption_original_recovery_required");
  assert.ok(status.next_actions.every((action) => action.kind !== "command"));
  assert.deepEqual(captureFoundryInput(attempted), retained);
});

test("historical receipt, immutable successor link and retained installed bytes are rechecked", async (t) => {
  const f = await fixture(t);
  const first = (await f.plan()) as Record<string, unknown>;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: first })).status,
    "completed",
  );
  const second = nextRuntime(f, f.context, String(first.plan_sha256), "drift-second");
  const secondPlan = await second.plan();
  assert.equal(
    (await second.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: secondPlan }))
      .status,
    "completed",
  );
  const third = nextRuntime(f, second.context, String(secondPlan.plan_sha256), "drift-third");
  const thirdPlan = await third.plan();
  assert.equal(
    (await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan: thirdPlan }))
      .status,
    "completed",
  );
  for (const file of [
    path.join(f.taskRoot, "runtime-adoptions", `${first.plan_sha256}.json`),
    adoptionSuccessorPath(f.context, String(first.plan_sha256)),
    path.join(second.context.runtimeRoot, "package-dist/scripts/package-entry.js"),
    path.join(second.context.runtimeRoot, "node_modules/@tiangong-lca/cli/package.json"),
  ]) {
    const original = fs.readFileSync(file);
    fs.appendFileSync(file, " ");
    try {
      const result = await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "audit" });
      assert.notEqual(result.status, "completed", file);
    } finally {
      fs.writeFileSync(file, original);
    }
  }
  assert.equal(
    (await third.facade().adoptTaskRuntime({ ...f.invocation, mode: "audit" })).status,
    "completed",
  );
});

test("qualified exact CLI transition retains the same Task and preparation lineage", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await createFoundryFacade(f.options).status(f.invocation)).blockers[0]?.code,
    "task_runtime_changed",
  );
  // Build actual old-owner context/rows/assessment, then preserve their bytes across adoption.
  for (let step = 0; step < 3; step++) await f.old.resume(f.invocation);
  const oldIndex = fs.readFileSync(path.join(f.taskRoot, "artifact-index.jsonl"), "utf8");
  const before = f.snapshot(),
    plan = await f.plan();
  const applied = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
  assert.equal(applied.status, "completed", JSON.stringify(applied));
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan })).status,
    "completed",
  );
  assert.deepEqual(f.snapshot(), before);
  assert.notEqual((await f.successor().status(f.invocation)).status, "failed");
  // This helper clones successor code; its blocked state is not predecessor inspection proof.
  const oldStatus = await f.old.status(f.invocation);
  assert.equal(oldStatus.status, "blocked");
  assert.equal(oldStatus.blockers[0]?.code, "task_runtime_changed");
  const resumed = await f.successor().resume(f.invocation);
  assert.notEqual(resumed.status, "failed", JSON.stringify(resumed));
  const index = fs
    .readFileSync(path.join(f.taskRoot, "artifact-index.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { command: string; path: string });
  assert.equal(
    index.filter(
      (entry) =>
        entry.command === "dataset-context-pack" &&
        path.basename(entry.path) === "contract-report.json",
    ).length,
    2,
  );
  for (let step = 0; step < 3; step++) await f.successor().resume(f.invocation);
  const updated = fs.readFileSync(path.join(f.taskRoot, "artifact-index.jsonl"), "utf8");
  assert.ok(updated.startsWith(oldIndex));
  const assessments = updated
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { command: string; path: string })
    .filter(
      (entry) =>
        entry.command === "dataset-workflow-assessment" &&
        path.basename(entry.path) === "foundry-assessment.json",
    )
    .map(
      (entry) =>
        JSON.parse(fs.readFileSync(path.join(f.taskRoot, entry.path), "utf8")) as {
          owner_base: string;
        },
    );
  assert.ok(assessments.some((report) => report.owner_base === f.oldRoot));
  assert.ok(assessments.some((report) => report.owner_base === f.context.assetRoot));
  const rows = await createFoundryRuntime(f.context).materializeRows([f.seed]);
  assert.equal(rows.status, "completed", JSON.stringify(rows));
  assert.equal((await f.successor().status(f.invocation)).task_id, f.invocation.taskId);
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "audit" })).status,
    "completed",
  );
});

test("ordinary input and forged or changed host qualifications cannot permit adoption", async (t) => {
  const f = await fixture(t);
  const noHost = createFoundryFacade(f.options);
  assert.equal(
    (await noHost.adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: f.selection }))
      .blockers[0]?.code,
    "runtime_adoption_qualification_untrusted",
  );
  const forged = createFoundryFacade({
    ...f.options,
    runtimeAdoptionQualification: { ...f.trusted() },
  });
  assert.equal(
    (await forged.adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: f.selection }))
      .blockers[0]?.code,
    "runtime_adoption_qualification_untrusted",
  );
  const altered = structuredClone(f.selection);
  altered.qualification.allowed_changes.push("tidas");
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: altered }))
      .blockers[0]?.code,
    "runtime_adoption_qualification_untrusted",
  );
  assert.throws(
    () =>
      createFoundryRuntimeAdoptionQualification({
        bytes: Buffer.from(JSON.stringify(f.q)),
        expectedSha256: "0".repeat(64),
      }),
    /independently reviewed/u,
  );
  const file = path.join(f.root, "selection.json");
  json(file, f.selection);
  let output = "";
  await runFoundryPublicCommand(
    [
      process.execPath,
      "entry",
      "task",
      "adopt-runtime",
      "--workspace",
      f.options.workspace,
      "--task",
      f.invocation.taskId,
      "--actor",
      f.invocation.actorId,
      "--dry-run",
      "--selection",
      file,
      "--json",
    ],
    {
      workspaceAccess: f.options.workspaceAccess,
      cacheBase: f.options.cacheBase,
      writeStdout: (value) => {
        output += value;
      },
      setExitCode: () => undefined,
    },
  );
  const result = JSON.parse(output) as { blockers: { code: string }[] };
  assert.equal(result.blockers[0]?.code, "runtime_adoption_qualification_untrusted");
});

test("writer stop, exact input and plan-history CAS remain mandatory", async (t) => {
  const f = await fixture(t);
  const unstopped = structuredClone(f.selection);
  unstopped.writer_handoff.writer_stopped = false;
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: unstopped }))
      .blockers[0]?.code,
    "runtime_adoption_writer_not_stopped",
  );
  const plan = await f.plan();
  const attempt = path.join(f.taskRoot, "attempts/unknown.json");
  json(attempt, { state: "UNKNOWN_DO_NOT_REPLAY" });
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan })).blockers[0]
      ?.code,
    "runtime_adoption_plan_stale",
  );
  fs.appendFileSync(f.seed, " ");
  assert.equal(
    (
      await f
        .successor()
        .adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: f.selection })
    ).blockers[0]?.code,
    "runtime_adoption_evidence_changed",
  );
});

test("consumed and unknown attempts survive adoption and retain original recovery barriers", async (t) => {
  const f = await fixture(t);
  const attempted = path.join(f.taskRoot, "attempts/unknown.json");
  json(attempted, {
    state: "UNKNOWN_DO_NOT_REPLAY",
    consumed: true,
    operation_id: "same-owner-attempt",
  });
  const before = captureFoundryInput(attempted),
    plan = await f.plan();
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan })).status,
    "completed",
  );
  assert.deepEqual(captureFoundryInput(attempted), before);
  const status = await f.successor().status(f.invocation);
  assert.equal(
    status.blockers[0]?.code,
    "runtime_adoption_original_recovery_required",
    JSON.stringify(status),
  );
  assert.ok(status.next_actions.every((action) => action.kind !== "command"));
  assert.deepEqual(captureFoundryInput(attempted), before);
  const readonly = createFoundryFacade({
    ...f.options,
    workspaceAccess: { ...f.options.workspaceAccess, access: "read" },
  });
  assert.equal(
    (await readonly.status(f.invocation)).blockers[0]?.code,
    "mutation_readback_required",
  );
  assert.deepEqual(captureFoundryInput(attempted), before);
});

test("dependency drift and a live original owner lock reject adoption", async (t) => {
  const f = await fixture(t);
  const plan = await f.plan();
  const scope = sha256Json({ task: f.invocation.taskId, type: "flow" });
  const runPath = path.join(
    f.context.stateRoot,
    `owner-locks/${f.invocation.taskId}-${scope}.json`,
  );
  const code = `import {withBatchRunLock} from "@tiangong-lca/cli/batch"; await withBatchRunLock(${JSON.stringify({ runPath, identity: { task: f.invocation.taskId, scope }, reason: "live original fixture writer" })}, async()=>{process.stdout.write("ready\\n"); await new Promise(resolve=>process.stdin.once("data", resolve));});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("exit", (code) => reject(new Error(`lock child exited ${code}`)));
      child.once("error", reject);
    });
    const result = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
    assert.notEqual(result.status, "completed");
  } finally {
    child.stdin.end("release");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
  fs.appendFileSync(f.newTidas, "tampered");
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan })).blockers[0]
      ?.code,
    "runtime_tidas_unqualified",
  );
});

test("qualified but unselected Toolkit is refused before adoption and during continuation", async (t) => {
  const f = await fixture(t);
  const substitute = path.join(f.root, "different-qualified-toolkit.ts");
  fs.copyFileSync(f.newTidas, substitute);
  fs.chmodSync(substitute, 0o755);
  const other = createFoundryFacade({
    ...f.options,
    runtimeSelection: { ...f.options.runtimeSelection, tidasExecutable: substitute },
    runtimeAdoptionQualification: f.trusted(),
  });
  assert.equal(
    (await other.adoptTaskRuntime({ ...f.invocation, mode: "plan", selection: f.selection }))
      .blockers[0]?.code,
    "runtime_adoption_dependency_changed",
  );
  const plan = await f.plan();
  assert.equal(
    (await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan })).status,
    "completed",
  );
  assert.equal(
    (await other.status(f.invocation)).blockers[0]?.code,
    "runtime_adoption_dependency_changed",
  );
});

test("installed public API host adopts without private context and returns the same-task continuation", async (t) => {
  const f = await fixture(t);
  const retained = await retainedAssessmentHistory(f, 40);
  const before = f.snapshot();
  const apiUrl = pathToFileURL(path.join(packageRoot, "package-dist/scripts/public-api.js")).href;
  const installed = (await import(apiUrl)) as typeof import("../../scripts/public-api.ts");
  const qualificationBytes = Buffer.from(JSON.stringify(f.q));
  const manifestBytes = copyTrustedRuntimeManifestBytes(f.options.workspaceAccess.manifest);
  const facade = installed.createFoundryFacade({
    workspace: f.options.workspace,
    cacheBase: f.options.cacheBase,
    workspaceAccess: installed.createFoundryWorkspaceAccess({
      manifestBytes,
      expectedSha256: digest(manifestBytes),
      access: "write",
    }),
    runtimeSelection: f.options.runtimeSelection,
    runtimeAdoptionQualification: installed.createFoundryRuntimeAdoptionQualification({
      bytes: qualificationBytes,
      expectedSha256: digest(qualificationBytes),
    }),
  });
  const planned = await facade.adoptTaskRuntime({
    ...f.invocation,
    mode: "plan",
    selection: f.selection,
  });
  assert.equal(planned.status, "ready", JSON.stringify(planned));
  const artifact = planned.artifacts[0];
  assert.equal(artifact.kind, "inline");
  const applied = await facade.adoptTaskRuntime({
    ...f.invocation,
    mode: "apply",
    plan: artifact.kind === "inline" ? artifact.value : null,
  });
  assert.equal(applied.status, "completed", JSON.stringify(applied));
  assert.equal(
    (await facade.adoptTaskRuntime({ ...f.invocation, mode: "audit" })).status,
    "completed",
  );
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(
    retained.map((fact) => captureFoundryInput(fact.path)),
    retained,
  );
  const status = await facade.status(f.invocation);
  assert.equal(status.task_id, f.invocation.taskId);
  assert.ok(
    status.next_actions.some(
      (action) => action.kind === "command" && action.argv.includes(f.invocation.taskId),
    ),
  );
  // Production uses this same package through its qualified managed prefix to obtain IPC-bound actions.
  // No command action or remote mutation is executed by this test.
});

for (const changed of ["assessment", "rows", "producer-receipt", "producer-plan"]) {
  test(`indexed ${changed} body drift rejects apply before receipt or anchor`, async (t) => {
    const f = await fixture(t);
    for (let step = 0; step < 3; step++) await f.old.resume(f.invocation);
    const plan = await f.plan();
    const index = fs
      .readFileSync(path.join(f.taskRoot, "artifact-index.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            path: string;
            receipt: { path: string };
          },
      );
    const entry = index.findLast(
      (item) =>
        path.basename(item.path) ===
        (changed === "rows" ? "flow.rows.json" : "foundry-assessment.json"),
    );
    assert.ok(entry);
    let target = entry.path;
    if (changed.startsWith("producer-")) {
      target = entry.receipt.path;
      if (changed === "producer-plan") {
        const receipt = JSON.parse(fs.readFileSync(path.join(f.taskRoot, target), "utf8")) as {
          plan: { path: string };
        };
        target = receipt.plan.path;
      }
    }
    fs.appendFileSync(path.join(f.taskRoot, target), " ");
    const before = f.snapshot();
    const result = await f.successor().adoptTaskRuntime({ ...f.invocation, mode: "apply", plan });
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.blockers[0]?.code, "runtime_adoption_evidence_changed");
    assert.deepEqual(f.snapshot(), before);
    assert.ok(!fs.existsSync(path.join(f.taskRoot, "runtime-adoptions")));
    assert.ok(
      !fs.existsSync(
        path.join(f.context.stateRoot, "task-runtime-adoptions", `${f.invocation.taskId}.json`),
      ),
    );
    const replanned = await f.successor().adoptTaskRuntime({
      ...f.invocation,
      mode: "plan",
      selection: f.selection,
    });
    assert.equal(replanned.status, "blocked", "drift cannot become a new accepted preimage");
  });
}
