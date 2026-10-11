import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { workflowFixture, digestFile } from "../fixtures/foundry-public-workflow.ts";
import { flowRow } from "../fixtures/row-builders.ts";
import {
  createFoundryRuntimeContext,
  captureFoundryInput,
} from "../../scripts/lib/foundry-runtime-context.ts";
import {
  readVerifiedTaskSnapshot,
  runFoundryTaskOperation,
} from "../../scripts/lib/foundry-task-store.ts";
import { currentWorkflowState } from "../../scripts/lib/foundry-workflow-state.ts";
import {
  verifyRegisteredAssessmentProducer,
  registeredAssessmentSetProducerBase,
} from "../../scripts/lib/foundry-assessment-producer.ts";

test("public same-task status preserves the registered assessment producer across runtime roots", async (t) => {
  const { root, workspace, facade } = workflowFixture(t);
  const seed = path.join(root, "seed.json"),
    specFile = path.join(root, "request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({ rows: [flowRow("77777777-7777-4777-8777-777777777777")] }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "retained-producer",
      actor_id: "producer-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "producer-actor" };
  for (let i = 0; i < 3; i++) await facade.resume(invocation);
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    ...invocation,
    inputs: [captureFoundryInput(seed)],
  };
  const base = createFoundryRuntimeContext(options),
    snapshot = readVerifiedTaskSnapshot(base);
  const context = createFoundryRuntimeContext({
    ...options,
    inputs: [
      ...snapshot.task.sources,
      ...snapshot.index.map((entry) =>
        captureFoundryInput(path.resolve(base.taskRoot!, entry.path)),
      ),
    ],
  });
  const assessed = currentWorkflowState(context, snapshot.index).assessment!;
  const retainedBase = path.join(fs.realpathSync(root), "retained-original-package");
  fs.mkdirSync(retainedBase);
  fs.copyFileSync(
    path.join(context.assetRoot, "package.json"),
    path.join(retainedBase, "package.json"),
  );
  const entryPath = path.join(retainedBase, context.runtime.entryRepoRelativePath);
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.copyFileSync(context.runtime.entryPath, entryPath);
  const output = path.join(context.taskRoot!, "outputs", "retained-assessment-producer");
  const raw = JSON.parse(fs.readFileSync(assessed.file, "utf8"));
  await runFoundryTaskOperation(
    context,
    {
      command: "dataset-workflow-assessment",
      options: { fixture_producer: "retained-original-package" },
    },
    (operation) => {
      const sets = raw.sets.map((set: Record<string, unknown>) => {
        const manifest = JSON.parse(fs.readFileSync(String(set.authoring_manifest), "utf8"));
        for (const task of manifest.tasks)
          for (const [key, value] of Object.entries(task.files)) {
            if (typeof value === "string")
              task.files[key] = path.relative(retainedBase, path.resolve(context.assetRoot, value));
          }
        const manifestFile = path.join(output, String(set.type), "authoring-task-manifest.json");
        operation.writeJson(manifestFile, manifest);
        return { ...set, authoring_manifest: manifestFile };
      });
      const report = {
        ...raw,
        owner_base: retainedBase,
        sets,
        previous_assessment: assessed.file,
        previous_assessment_sha256: assessed.entry.sha256,
        assessed_type: sets[0].type,
      };
      operation.writeJson(path.join(output, "foundry-assessment.json"), report);
      return report;
    },
  );
  const originalFacts = readVerifiedTaskSnapshot(context).index.map((entry) => ({
    path: path.resolve(context.taskRoot!, entry.path),
    sha256: entry.sha256,
  }));
  const calls: unknown[] = [];
  const originalSpawn = childProcess.spawnSync;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    const argv = args[1];
    if (
      Array.isArray(argv) &&
      String(argv[0]).endsWith("tidas-runtime.ts") &&
      (argv[1] === "version" || (argv[1] === "validate" && argv[2] === "--describe"))
    )
      return Reflect.apply(originalSpawn, childProcess, args);
    calls.push(argv);
    throw new Error(`status cannot execute data work: ${JSON.stringify(argv)}`);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const status = await facade.status(invocation);
  assert.equal(status.task_id, invocation.taskId);
  assert.ok(
    !status.blockers.some((item) => item.code === "workflow_assessment_invalid"),
    JSON.stringify(status.blockers),
  );
  assert.ok(
    !status.blockers.some(
      (item) => item.code.includes("runtime") || item.code.includes("qualification"),
    ),
    JSON.stringify(status.blockers),
  );
  const latest = currentWorkflowState(context, readVerifiedTaskSnapshot(context).index).assessment!;
  assert.equal(latest.value.owner_base, retainedBase);
  assert.equal(
    registeredAssessmentSetProducerBase(
      context,
      readVerifiedTaskSnapshot(context).index,
      latest.value.sets[0],
    ),
    retainedBase,
  );
  const index = readVerifiedTaskSnapshot(context).index;
  const nativeValue = JSON.parse(fs.readFileSync(latest.file, "utf8"));
  assert.equal(
    verifyRegisteredAssessmentProducer(context, latest.entry, nativeValue, index),
    retainedBase,
  );
  for (const changed of [
    { ...nativeValue, owner_base: root },
    { ...nativeValue, owner_base: context.assetRoot },
    { ...nativeValue, owner_base: path.join(root, "foreign") },
  ])
    assert.throws(
      () => verifyRegisteredAssessmentProducer(context, latest.entry, changed, index),
      /not proven/u,
    );
  fs.appendFileSync(entryPath, "\n// changed old producer\n");
  assert.throws(
    () => verifyRegisteredAssessmentProducer(context, latest.entry, nativeValue, index),
    /not proven/u,
  );
  assert.deepEqual(calls, []);
  for (const item of originalFacts)
    assert.equal(digestFile(item.path), item.sha256, "all native producer facts remain unchanged");
});
