import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import {
  finalizationProcessFixture,
  finalizationProcessSeed,
  finalizationProcessAccount,
  runPublicFinalizationProcessWorkflow,
} from "../fixtures/finalization-process.ts";
import { unwrapDatasetPayload } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;
const read = (file: string) => object(JSON.parse(fs.readFileSync(file, "utf8")));
const account = finalizationProcessAccount;

async function registeredProcess(t: TestContext, requestId: string) {
  const { root, workspace, facade } = workflowFixture(t);
  const fixture = finalizationProcessFixture();
  const seed = path.join(root, "process-source.json");
  const request = path.join(root, "request.json");
  fs.writeFileSync(seed, JSON.stringify(finalizationProcessSeed(fixture)));
  const originalSource = fs.readFileSync(seed);
  fs.writeFileSync(
    request,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: requestId,
      actor_id: "finalization-author",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: account,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile: request });
  assert.ok(started.task_id, JSON.stringify(started));
  const invocation = { taskId: started.task_id, actorId: "finalization-author" };
  return { root, workspace, facade, fixture, seed, originalSource, invocation };
}

function beforeCandidateCleanup(input: Awaited<ReturnType<typeof registeredProcess>>) {
  const finalizationRoot = path.join(
    input.workspace,
    ".foundry/workspaces",
    input.invocation.taskId,
    "outputs/finalize",
  );
  return () =>
    fs.existsSync(finalizationRoot) &&
    fs.readdirSync(finalizationRoot).some((generation) => {
      const processRoot = path.join(finalizationRoot, generation, "process");
      return fs.existsSync(processRoot) && !fs.existsSync(path.join(processRoot, "cleanup"));
    });
}

test("public selected Flow evidence survives identity apply, cleanup and real Process save-equivalent validation", async (t) => {
  const { root, facade, fixture, seed, originalSource, invocation } = await registeredProcess(
    t,
    "finalization-flow-evidence",
  );
  const { result, saveReports, counters, references, originalReferences, originalSpawn } =
    await runPublicFinalizationProcessWorkflow(t, {
      root,
      facade,
      invocation,
      seed,
      fixture,
      account,
    });
  const preflights = counters.preflights;
  const summary = { preflights, saveReports, status: result.status, blockers: result.blockers };
  const evidenceRoot = process.env.FOUNDRY_TEST_EVIDENCE_DIR;
  if (evidenceRoot) {
    fs.mkdirSync(evidenceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceRoot, "public-finalization-save-evidence.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
    if (saveReports.length) {
      fs.copyFileSync(
        String(saveReports[0].input_path),
        path.join(evidenceRoot, "processes.cleaned.jsonl"),
      );
      fs.copyFileSync(seed, path.join(evidenceRoot, "process-source.json"));
      fs.copyFileSync(references, path.join(evidenceRoot, "readonly-references.json"));
    }
  }
  t.diagnostic(
    JSON.stringify({ preflights, saveStatus: saveReports[0]?.status, blockers: result.blockers }),
  );
  assert.ok(saveReports.length, "public finalization must reach the genuine CLI dry-run");
  const dry = saveReports[0];
  assert.equal(dry.status, "completed", JSON.stringify(dry));
  const finalFile = String(dry.input_path);
  const finalRow = object(readRows(finalFile)[0]);
  assert.deepEqual(object(finalRow.semantic_context).flow_documents, [fixture.flow]);
  const processValidation = object((dry.processes as Json[])[0].validation);
  for (const layer of Object.values(object(processValidation.validation_layers)))
    assert.equal(object(layer).status, "passed");
  assert.equal(object(processValidation.allocation_semantics).status, "passed");
  assert.equal(processValidation.payload_sha256, sha256Json(fixture.process));
  const finalized = result.artifacts.findLast((item) => item.role === "foundry-finalize.json");
  assert.ok(finalized?.kind === "file");
  const finalization = read(finalized.path);
  const scope = (finalization.sets as Json[]).find((item) => item.type === "process")!;
  assert.equal(scope.final_rows, finalFile);
  const owner = read(String(scope.report));
  const files = object(owner.files);
  const ownerBase = String(finalization.owner_base);
  const cleanup = read(path.resolve(ownerBase, String(files.cleanup_report)));
  assert.equal(path.resolve(ownerBase, String(cleanup.cleaned_rows_file)), finalFile);
  const mutation = read(path.resolve(ownerBase, String(files.mutation_manifest)));
  assert.equal(path.resolve(ownerBase, String(mutation.rows_file)), finalFile);
  assert.equal(sha256Json(unwrapDatasetPayload(finalRow, "process")), sha256Json(fixture.process));
  assert.deepEqual(fs.readFileSync(seed), originalSource);
  assert.deepEqual(fs.readFileSync(references), originalReferences);
  const runSave = (row: unknown, name: string, dataset: boolean) => {
    const input = path.join(root, `${name}.json`);
    const output = path.join(root, `save-${name}`);
    fs.writeFileSync(input, JSON.stringify([row]));
    const argv = [
      resolveInstalledTiangongLcaCliPackage().binPath,
      ...(dataset ? ["dataset", "save-draft", "--type", "process"] : ["process", "save-draft"]),
      "--input",
      input,
      "--out-dir",
      output,
      "--dry-run",
      "--json",
    ];
    const result = originalSpawn(process.execPath, argv, { encoding: "utf8" });
    assert.ok([0, 1].includes(result.status ?? -1), result.stderr);
    const report = object(JSON.parse(result.stdout));
    if (evidenceRoot)
      fs.writeFileSync(
        path.join(evidenceRoot, `${name}-save-report.json`),
        JSON.stringify(report, null, 2) + "\n",
      );
    return report;
  };
  const datasetSave = runSave(finalRow, "dataset-positive", true);
  assert.equal(datasetSave.status, "completed");
  assert.equal(object((datasetSave.rows as Json[])[0].validation).ok, true);
  for (const kind of [
    "missing",
    "wrong-version",
    "wrong-type",
    "conflict",
    "stale-binding",
  ] as const) {
    await t.test(`real save-draft rejects ${kind} evidence`, () => {
      const candidate = structuredClone(finalRow);
      const context = object(candidate.semantic_context);
      const documents = context.flow_documents as Json[];
      if (kind === "missing") context.flow_documents = [];
      if (kind === "wrong-version")
        object(
          object(object(documents[0].flowDataSet).administrativeInformation)
            .publicationAndOwnership,
        )["common:dataSetVersion"] = "01.00.001";
      if (kind === "wrong-type")
        object(
          object(object(documents[0].flowDataSet).modellingAndValidation).LCIMethod,
        ).typeOfDataSet = "Elementary flow";
      if (kind === "conflict") {
        const contradictory = structuredClone(documents[0]);
        object(
          object(object(contradictory.flowDataSet).modellingAndValidation).LCIMethod,
        ).typeOfDataSet = "Elementary flow";
        documents.push(contradictory);
      }
      if (kind === "stale-binding") context.candidate_sha256 = "0".repeat(64);
      for (const dataset of [false, true]) {
        const report = runSave(candidate, `${kind}-${dataset ? "dataset" : "process"}`, dataset);
        assert.equal(report.status, "completed_with_failures", JSON.stringify(report));
        const selected = object(((dataset ? report.rows : report.processes) as Json[])[0]);
        assert.equal(object(selected.validation).ok, false);
      }
    });
  }
  const snapshot = result.artifacts.findLast((item) => item.role === "qa-0.json");
  assert.ok(snapshot?.kind === "file");
  const bytes = fs.readFileSync(snapshot.path);
  fs.writeFileSync(snapshot.path, "[]");
  const refused = await facade.status(invocation);
  assert.equal(refused.blockers[0]?.code, "workflow_assessment_changed");
  assert.notEqual(refused.status, "completed");
  fs.writeFileSync(snapshot.path, bytes);
});

test("public finalization parses the same captured reference bytes whose hash it records", async (t) => {
  const input = await registeredProcess(t, "finalization-reference-capture");
  const originalRead = fs.readFileSync;
  const beforeCleanup = beforeCandidateCleanup(input);
  const alternate = structuredClone(input.fixture.flow);
  object(object(object(alternate.flowDataSet).administrativeInformation).dataEntryBy)[
    "common:timeStamp"
  ] = "2025-02-01T08:00:00+08:00";
  assert.notEqual(sha256Json(alternate), sha256Json(input.fixture.flow));
  const readMock = t.mock.method(
    fs,
    "readFileSync",
    (...args: Parameters<typeof fs.readFileSync>) => {
      const value = Reflect.apply(originalRead, fs, args);
      if (
        typeof args[0] === "string" &&
        path.basename(args[0]) === "qa-0.json" &&
        args[1] === "utf8" &&
        beforeCleanup()
      ) {
        // Model A -> B -> A across separate opens. Captured Buffer reads see A,
        // while a later text-parser open sees B. The selected disk bytes stay A.
        const rows: unknown = JSON.parse(String(value));
        assert.ok(Array.isArray(rows));
        return JSON.stringify(
          rows.map((row: unknown) => (object(row).flowDataSet ? alternate : row)),
        );
      }
      return value;
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    readMock.mock.restore();
    syncBuiltinESMExports();
  });
  const { saveReports, references, originalReferences } =
    await runPublicFinalizationProcessWorkflow(t, input);
  assert.equal(saveReports[0]?.status, "completed");
  const row = object(readRows(String(saveReports[0].input_path))[0]);
  assert.deepEqual(
    object(row.semantic_context).flow_documents,
    [input.fixture.flow],
    "the projected body must come from the captured bytes, not a separate open",
  );
  assert.deepEqual(fs.readFileSync(references), originalReferences);
  assert.deepEqual(fs.readFileSync(input.seed), input.originalSource);
});

test("public finalization rejects a capture that differs from its registered reference fact", async (t) => {
  const input = await registeredProcess(t, "finalization-reference-fact");
  const beforeCleanup = beforeCandidateCleanup(input);
  const originalRead = fs.readFileSync;
  const originalOpen = fs.openSync;
  const descriptors = new Map<number, string>();
  const alternate = structuredClone(input.fixture.flow);
  const entry = object(object(object(alternate.flowDataSet).administrativeInformation).dataEntryBy);
  const timestamp = String(entry["common:timeStamp"]);
  entry["common:timeStamp"] = timestamp.replace(
    /^\d{4}/u,
    timestamp.startsWith("2024") ? "2028" : "2024",
  );
  assert.notEqual(sha256Json(alternate), sha256Json(input.fixture.flow));
  const openMock = t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const fd = Reflect.apply(originalOpen, fs, args);
    descriptors.set(fd, typeof args[0] === "string" ? args[0] : "");
    return fd;
  });
  const readMock = t.mock.method(
    fs,
    "readFileSync",
    (...args: Parameters<typeof fs.readFileSync>) => {
      const value = Reflect.apply(originalRead, fs, args);
      const file = typeof args[0] === "number" ? descriptors.get(args[0]) : args[0];
      if (typeof file === "string" && path.basename(file) === "qa-0.json" && beforeCleanup()) {
        // B is visible throughout capture, while selected-fact and later checks see A.
        const rows: unknown = JSON.parse(String(value));
        assert.ok(Array.isArray(rows));
        const changed = JSON.stringify(
          rows.map((row: unknown) => (object(row).flowDataSet ? alternate : row)),
        );
        assert.equal(Buffer.byteLength(changed), Buffer.byteLength(value));
        return Buffer.isBuffer(value) ? Buffer.from(changed) : changed;
      }
      return value;
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    readMock.mock.restore();
    openMock.mock.restore();
    syncBuiltinESMExports();
  });
  const rejected = new Error("Observed public input_changed refusal");
  let sawRefusal = false;
  await assert.rejects(
    runPublicFinalizationProcessWorkflow(t, {
      ...input,
      facade: {
        status: input.facade.status,
        resume: async (request) => {
          const result = await input.facade.resume(request);
          if (result.blockers.some((blocker) => blocker.code === "input_changed")) {
            assert.equal(result.task_id, input.invocation.taskId);
            assert.equal(result.permissions.state, "not_required");
            sawRefusal = true;
            throw rejected;
          }
          return result;
        },
      },
    }),
    (error: unknown) => error === rejected,
  );
  assert.equal(sawRefusal, true);
  assert.deepEqual(fs.readFileSync(input.seed), input.originalSource);
});
