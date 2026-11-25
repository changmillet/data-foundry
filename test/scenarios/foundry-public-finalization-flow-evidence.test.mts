import { createFoundryFacade, type FoundryOperationResult } from "../../src/public-api.ts";
import { collectDatasetReferences } from "../../src/lib/import-curation/internal/workflow-reference-closure.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import {
  finalizationProcessFixture,
  typedFinalizationProcessFixture,
  finalizationProcessSeed,
  finalizationProcessAccount,
  runPublicFinalizationProcessWorkflow,
} from "../fixtures/finalization-process.ts";
import {
  datasetIdentity,
  unwrapDatasetPayload,
} from "../../src/lib/import-curation/internal/dataset-payload.ts";
import { readRows } from "../../src/lib/import-curation/internal/runtime-io.ts";
import { sha256Json } from "../../src/lib/identity-preflight-proof.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../src/lib/foundry-runtime-utils.ts";

import { runFoundryTypedDatasetQa } from "../../src/lib/foundry-typed-flow-qa.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
  writeFoundryArtifact,
} from "../../src/lib/foundry-runtime-context.ts";
import { qualifyFoundryRuntime } from "../../src/lib/foundry-runtime-qualification.ts";

type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;
const read = (file: string) => object(JSON.parse(fs.readFileSync(file, "utf8")));
const account = finalizationProcessAccount;

async function registeredProcess(t: TestContext, requestId: string) {
  const { root, workspace, facade: baseline, facadeOptions } = workflowFixture(t);
  const typed = resolveInstalledTiangongLcaCliPackage().packageVersion === "0.4.0";
  const fixture = typed ? typedFinalizationProcessFixture() : finalizationProcessFixture();
  let facade = baseline;
  let edgeReadReference: ((table: string, id: string, version: string) => unknown) | undefined;
  if (typed) {
    const origin = `https://${account.project_ref}.supabase.co`;
    const token = "process-evidence-fixture-token";
    facade = createFoundryFacade({
      ...facadeOptions,
      authentication: {
        mode: "headless",
        apiBaseUrl: origin,
        accessToken: token,
        publishableKey: "process-evidence-fixture-key",
      },
    });
    const references = collectDatasetReferences(fixture.process);
    edgeReadReference = (table, id, version) => {
      if (
        !references.some((ref) => ref.table === table && ref.id === id && ref.version === version)
      )
        return undefined;
      return table === "flows" ? fixture.flow : { fixture_dependency: id };
    };
    t.mock.method(globalThis, "fetch", (url: URL, init: RequestInit) => {
      assert.equal(url.href, `${origin}/functions/v1/process_hybrid_search`);
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
      return Response.json({ data: [] });
    });
  }
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
  return { root, workspace, facade, fixture, seed, originalSource, invocation, edgeReadReference };
}

function finalizedProcess(result: FoundryOperationResult) {
  const artifact = result.artifacts.findLast((item) => item.role === "foundry-finalize.json");
  assert.ok(artifact?.kind === "file");
  const finalization = read(artifact.path);
  const scope = (finalization.sets as Json[]).find((item) => item.type === "process");
  assert.ok(scope);
  return { finalization, scope };
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

test("CLI 0.4 validates the exact allocated Process and Foundry keeps its mass balance evidence", async (t) => {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion !== "0.4.0")
    return t.skip("requires the exact CLI 0.4.0 candidate");
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const fixture = typedFinalizationProcessFixture();

  const write = (name: string, value: unknown) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const seed = write("process.json", finalizationProcessSeed(fixture));
  const refs = write("references.json", [fixture.flow, fixture.property, fixture.group]);
  const wrongFlow = structuredClone(fixture.flow);
  object(object(object(wrongFlow.flowDataSet).administrativeInformation).publicationAndOwnership)[
    "common:dataSetVersion"
  ] = "01.00.001";
  const wrongRefs = write("wrong-version.json", [wrongFlow, fixture.property, fixture.group]);
  const spec = write("task.json", {
    schema: "tiangong-foundry.task-start.v1",
    request_id: "typed-process-exact-reference",
    actor_id: "validation-author",
    lane: "source-evidence-dataset-development",
    profile_id: "generic",
    target_entities: ["process"],
    sources: [seed, refs, wrongRefs].map((file) => ({ path: file })),
    seed: { path: seed },
    account_intent: null,
    preparation: null,
  });
  const started = await facade.start({ specFile: spec });
  assert.ok(started.task_id);
  const context = createFoundryRuntimeContext({
    moduleUrl: new URL("../../src/runtime-entry.ts", import.meta.url).href,
    workspace,
    cacheBase: path.join(root, "cache"),
    taskId: started.task_id,
    actorId: "validation-author",
    inputs: [seed, refs, wrongRefs].map(captureFoundryInput),
  });
  const qualified = qualifyFoundryRuntime(context, runtimeSelection);
  const run = (file: string, output: string) =>
    runFoundryTypedDatasetQa(
      context,
      qualified,
      root,
      (location, value) => writeFoundryArtifact(context, location, JSON.stringify(value) + "\n"),
      "process",
      seed,
      output,
      { referenceFiles: [file] },
    );
  const valid = run(refs, "outputs/candidate-process-qa-pass");
  const validation = object((read(valid.validationReportFile).rows as Json[])[0]);
  assert.equal(valid.exit, 0, JSON.stringify(validation));
  assert.equal(validation.payload_sha256, sha256Json(fixture.process));
  assert.equal(object(validation.allocation_semantics).status, "passed");
  assert.equal(object(validation.flow_reference_names).status, "passed");
  const balance = (read(valid.reportFile).mass_balance as Json[])[0];
  assert.equal(balance.status, "applicable");
  assert.equal(balance.delta, 0);
  const invalid = run(wrongRefs, "outputs/candidate-process-qa-wrong-version");
  assert.equal(invalid.exit, 1);
  const invalidValidation = object((read(invalid.validationReportFile).rows as Json[])[0]);
  assert.equal(invalidValidation.status, "incomplete");
  assert.equal(object(invalidValidation.allocation_semantics).status, "unresolved");
  assert.equal((read(invalid.reportFile).mass_balance as Json[])[0].status, "unresolved");
});

test("public selected Flow evidence survives identity apply, cleanup and Process validation", async (t) => {
  const input = await registeredProcess(t, "finalization-flow-evidence");
  const { root, facade, fixture, seed, originalSource, invocation, edgeReadReference } = input;
  const { result, saveReports, counters, references, originalReferences, originalSpawn } =
    await runPublicFinalizationProcessWorkflow(t, input);
  const { finalization, scope } = finalizedProcess(result);
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
  const finalFile = String(scope.final_rows);
  assert.equal(typeof scope.final_rows, "string");
  const finalRow = object(readRows(finalFile)[0]);
  assert.deepEqual(object(finalRow.semantic_context).flow_documents, [fixture.flow]);
  if (!edgeReadReference) {
    const dry = saveReports[0];
    assert.ok(dry, "public finalization must reach the genuine CLI dry-run");
    assert.equal(dry.status, "completed", JSON.stringify(dry));
    assert.equal(dry.input_path, finalFile);
    const processValidation = object((dry.processes as Json[])[0].validation);
    for (const layer of Object.values(object(processValidation.validation_layers)))
      assert.equal(object(layer).status, "passed");
    assert.equal(object(processValidation.allocation_semantics).status, "passed");
    assert.equal(processValidation.payload_sha256, sha256Json(fixture.process));
  }
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
  const snapshot = result.artifacts.findLast((item) => item.role === "qa-0.json");
  assert.ok(snapshot?.kind === "file");
  const bytes = fs.readFileSync(snapshot.path);
  fs.writeFileSync(snapshot.path, "[]");
  const refused = await facade.status(invocation);
  assert.equal(refused.blockers[0]?.code, "workflow_assessment_changed");
  assert.notEqual(refused.status, "completed");
  fs.writeFileSync(snapshot.path, bytes);
  if (edgeReadReference) return;

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
    (
      ...args: [
        path: fs.PathOrFileDescriptor,
        options?: fs.ReadFileSyncOptions | BufferEncoding | null,
      ]
    ) => {
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
  const { result, references, originalReferences } = await runPublicFinalizationProcessWorkflow(
    t,
    input,
  );
  const { scope } = finalizedProcess(result);
  const row = object(readRows(String(scope.final_rows))[0]);
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

test("CLI 0.4 Process preserves reviewed exact references and resumes with only readback", async (t) => {
  if (resolveInstalledTiangongLcaCliPackage().packageVersion !== "0.4.0")
    return t.skip("requires the exact CLI 0.4.0 candidate");
  const { root, facadeOptions } = workflowFixture(t);
  const origin = `https://${account.project_ref}.supabase.co`;
  const facade = createFoundryFacade({
    ...facadeOptions,
    authentication: {
      mode: "headless",
      apiBaseUrl: origin,
      accessToken: "process-test-token",
      publishableKey: "process-test-key",
    },
  });
  const fixture = typedFinalizationProcessFixture();
  const processRoot = object(fixture.process.processDataSet);
  object(object(processRoot.administrativeInformation).dataEntryBy)["common:timeStamp"] =
    "1970-01-01T08:00:00.000+08:00";

  const remote = new Map<string, unknown>();
  const key = (table: string, id: string, version: string) => `${table}/${id}/${version}`;
  for (const ref of collectDatasetReferences(fixture.process)) {
    assert.ok(ref.table && ref.version);
    remote.set(
      key(ref.table, ref.id, ref.version),
      ref.table === "flows" ? fixture.flow : { fixture_dependency: ref.id },
    );
  }
  const readRef = (table: string, id: string, version: string) =>
    remote.get(key(table, id, version));
  const selectedFlow = datasetIdentity(fixture.flow, 0, "flow");
  const latest = structuredClone(fixture.flow);
  const reviewedLatestVersion = "99.00.001";
  object(object(object(latest.flowDataSet).administrativeInformation).publicationAndOwnership)[
    "common:dataSetVersion"
  ] = reviewedLatestVersion;
  remote.set(key("flows", selectedFlow.id, reviewedLatestVersion), latest);
  let latestVersion = reviewedLatestVersion;
  let writes = 0,
    identityQueries = 0,
    afterReads = 0;
  let disconnected = true;
  let stored: Json | null = null;
  const requests: Array<{ endpoint: string; body: Json }> = [];
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(url.origin, origin);
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer process-test-token");
    const endpoint = url.pathname.split("/").at(-1)!;
    const body = object(JSON.parse(String(options.body)));
    requests.push({ endpoint, body });
    if (endpoint === "process_hybrid_search") {
      identityQueries++;
      return Response.json({ data: [] });
    }
    if (endpoint === "app_dataset_create") {
      assert.equal(body.table, "processes");
      assert.equal(++writes, 1);
      stored = object(body.jsonOrdered);
      throw new Error("connection lost after commit");
    }
    assert.equal(endpoint, "app_dataset_verify_remote");
    if (body.rootPolicy === "existing") {
      afterReads++;
      if (disconnected) throw new Error("readback connection unavailable");
    }
    const checks = (body.references as Json[]).map((ref, index) => {
      const isRoot = ref.role === "root";
      const payload = isRoot
        ? stored
        : readRef(String(ref.table), String(ref.id), String(ref.version));
      const hash = payload ? sha256Json(payload) : null;
      const latestVisible = !isRoot && ref.id === selectedFlow.id ? latestVersion : ref.version;
      return {
        index,
        table: ref.table,
        id: ref.id,
        version: ref.version,
        role: ref.role,
        status: !payload
          ? "candidate_root"
          : String(latestVisible) > String(ref.version)
            ? "version_outdated"
            : hash === ref.expectedJsonSha256
              ? "ok"
              : "payload_mismatch",
        exact_version: payload ? ref.version : null,
        latest_version: payload ? latestVisible : null,
        payload_present: !!payload,
        user_id: payload ? account.user_id : null,
        state_code: payload ? (isRoot ? 0 : 100) : null,
        actual_json_sha256: hash,
      };
    });
    return Response.json({
      command: "dataset_verify_remote",
      data: { root_policy: body.rootPolicy, checks },
    });
  });
  const write = (name: string, value: unknown) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const seed = write("process.json", finalizationProcessSeed(fixture));
  const actorId = "process-edge-author";
  const started = await facade.start({
    specFile: write("task.json", {
      schema: "tiangong-foundry.task-start.v1",
      request_id: "process-edge-disconnect",
      actor_id: actorId,
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: account,
      preparation: null,
    }),
  });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId };
  const prepared = await runPublicFinalizationProcessWorkflow(t, {
    root,
    facade,
    invocation,
    seed,
    fixture,
    account,
    edgeReadReference: readRef,
    edgeReadLatestReference: (table, id) => ({
      version: latestVersion,
      content: readRef(table, id, latestVersion),
    }),
  });
  const selectArtifact = (result: typeof prepared.result, role: string) => {
    const artifact = result.artifacts.findLast((entry) => entry.role === role);
    assert.ok(
      artifact?.kind === "file",
      JSON.stringify({ status: result.status, blockers: result.blockers, role }),
    );
    return artifact;
  };
  const finalization = (result: typeof prepared.result) => {
    const artifact = selectArtifact(result, "foundry-finalize.json");
    return {
      artifact,
      scope: (read(artifact.path).sets as Json[]).find((entry) => entry.type === "process")!,
    };
  };
  const initial = finalization(prepared.result);
  const expected = unwrapDatasetPayload(readRows(String(initial.scope.final_rows))[0], "process");
  const processIdentity = datasetIdentity(expected, 0, "process");
  const snapshot = (version: string, payload: unknown) => ({
    table: "flows",
    id: selectedFlow.id,
    version,
    payload_sha256: sha256Json(payload),
    user_id: account.user_id,
    state_code: 100,
  });
  const selectedSnapshot = snapshot(selectedFlow.version, fixture.flow);
  const review = write("flow-review.json", {
    schema_version: "dataset-exact-reference-review.v1",
    decision: "use_selected_exact",
    reason: "Preserve the Flow version independently reviewed for these exchanges.",
    selected: selectedSnapshot,
    latest: snapshot(reviewedLatestVersion, latest),
  });
  const fileSelection = (file: string) => ({ file, sha256: captureFoundryInput(file).sha256 });
  const referencePaths = collectDatasetReferences(expected).filter(
    (ref) => ref.id === selectedFlow.id,
  );
  assert.ok(referencePaths.length);
  const intent = write("reference-intent.json", {
    schema_version: "dataset-exact-reference-intent.v1",
    project_ref: account.project_ref,
    actor_user_id: account.user_id,
    consumers: [
      {
        row_index: 0,
        table: "processes",
        id: processIdentity.id,
        version: processIdentity.version,
        payload_sha256: sha256Json(expected),
      },
    ],
    references: referencePaths.map(({ path }) => ({
      row_index: 0,
      path,
      selected: selectedSnapshot,
      review: fileSelection(review),
    })),
  });
  const descriptor = write("reviewed-reference-input.json", {
    ...read(prepared.referenceInput),
    intent: fileSelection(intent),
    review_files: [fileSelection(review)],
  });
  let result = await facade.resume({ ...invocation, referenceInputFile: descriptor });
  assert.ok(
    result.artifacts.some((artifact) => artifact.role === "intent.json"),
    JSON.stringify(result.blockers),
  );
  for (let step = 0; step < 7; step++) {
    if (finalization(result).artifact.sha256 !== initial.artifact.sha256) break;
    result = await facade.resume(invocation);
  }
  const { artifact: finalized, scope } = finalization(result);
  assert.notEqual(finalized.sha256, initial.artifact.sha256, JSON.stringify(result.blockers));
  const refresh = selectArtifact(prepared.result, "finalize-identity-refresh.json");
  const refreshed = read(refresh.path);
  assert.equal(refreshed.status, "completed_with_identity_findings");
  assert.equal(object(refreshed.counts).skipped_existing_report, 0);
  assert.equal(object(refreshed.counts).completed, 1);
  assert.ok(refreshed.edge_report, "the cleaned timestamp binds a fresh audited query");
  assert.ok(identityQueries > 0);
  assert.equal(
    scope.status,
    "ready_for_remote_write",
    JSON.stringify(read(String(scope.report)).blockers),
  );
  assert.equal(writes, 0);
  const selected = (scope.authorization_inputs as Json[]).find(
    (entry) => entry.input_kind === "final_rows",
  )!;
  const evidence = path.join(root, "operator-approval.txt");
  fs.writeFileSync(evidence, "Approve this exact synthetic Process draft.");
  const evidenceSha = captureFoundryInput(evidence).sha256;
  const grant = write("grant.json", {
    schema: "tiangong-foundry.task-authorization.v1",
    binding: selected.binding,
    issued_at_utc: new Date(Date.now() - 1_000).toISOString(),
    expires_at_utc: new Date(Date.now() + 3600_000).toISOString(),
    remote_state_code: 0,
    allowed_actions: [],
    qa_waivers: [],
    evidence: [
      {
        id: "approval",
        kind: "user-decision",
        reference: fs.realpathSync(evidence),
        sha256: evidenceSha,
      },
    ],
  });
  const approval = write("approval.json", {
    schema: "tiangong-foundry.authorization-input.v1",
    task_id: invocation.taskId,
    actor_id: actorId,
    finalization_sha256: finalized.sha256,
    dataset_type: "process",
    input_kind: "final_rows",
    input_sha256: selected.sha256,
    expected_previous_sha256: null,
    grant: { file: grant, sha256: captureFoundryInput(grant).sha256 },
    evidence: [{ id: "approval", kind: "user-decision", file: evidence, sha256: evidenceSha }],
  });
  let current = await facade.resume({ ...invocation, authorizationInputFile: approval });
  for (let step = 0; step < 6; step++) {
    if (writes > 0) break;
    current = await facade.resume(invocation);
  }
  assert.equal(writes, 1, JSON.stringify(current.blockers));
  assert.notEqual(current.status, "completed");
  assert.deepEqual(stored, expected);
  const original = selectArtifact(current, "owner-execution-request.json");
  const countAtDisconnect = requests.length;
  const readsAtDisconnect = afterReads;
  disconnected = false;
  stored = { ...object(stored), unexpected_remote_content: true };
  const stale = await facade.resume(invocation);
  assert.notEqual(
    stale.status,
    "completed",
    "same remote identifier with different bytes remains unresolved",
  );
  assert.equal(writes, 1);
  assert.ok(afterReads > readsAtDisconnect);
  stored = object(expected);
  latestVersion = "99.00.002";
  const changedLatest = await facade.resume(invocation);
  assert.notEqual(
    changedLatest.status,
    "completed",
    "the reviewed latest version changed after dispatch",
  );
  assert.equal(writes, 1);
  latestVersion = reviewedLatestVersion;
  for (let step = 0; step < 5 && current.status !== "completed"; step++)
    current = await facade.resume(invocation);
  assert.equal(current.status, "completed", JSON.stringify(current.blockers));
  assert.equal(writes, 1);
  assert.ok(afterReads > readsAtDisconnect);
  assert.deepEqual(
    new Set(requests.slice(countAtDisconnect).map((entry) => entry.endpoint)),
    new Set(["app_dataset_verify_remote"]),
  );
  assert.equal(selectArtifact(current, "owner-execution-request.json").sha256, original.sha256);
  const proof = selectArtifact(current, "owner-readback.json");
  assert.equal(read(proof.path).status, "verified");
  assert.equal((read(proof.path).reference_evidence as unknown[]).length, 3);
  assert.equal(
    read(proof.path).edge_plan_sha256,
    object(object(read(original.path).content).commit).sha256,
  );
});
