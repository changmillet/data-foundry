import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { datasetIdentity } from "../../scripts/lib/import-curation/internal/dataset-payload.ts";
import { readRows } from "../../scripts/lib/import-curation/internal/runtime-io.ts";
import { resolveInstalledTiangongLcaCliPackage } from "../../scripts/lib/foundry-runtime-utils.ts";
import { testAuthIdentityReceipt } from "../fixtures/auth-identity-receipt.ts";
import { digestFile, workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { flowRow } from "../fixtures/row-builders.ts";

type Assessment = {
  owner_base: string;
  sets: Array<{
    rows: string;
    decisions: Array<{ kind: string; task: string; status: string }>;
  }>;
};

test("ordinary public resume refreshes identity after three accepted Flow rows become current JSONL", async (t) => {
  const { root, facade } = workflowFixture(t);
  const ids = [
    "71717171-7171-4171-8171-717171717171",
    "72727272-7272-4272-8272-727272727272",
    "73737373-7373-4373-8373-737373737373",
  ];
  const seedRows = ids.map((id, index) => {
    const base = flowRow(id);
    const payload = {
      flowDataSet: {
        ...base.flowDataSet,
        flowInformation: {
          dataSetInformation: {
            ...base.flowDataSet.flowInformation.dataSetInformation,
            name: {
              ...base.flowDataSet.flowInformation.dataSetInformation.name,
              mixAndLocationTypes: { "@xml:lang": "en", "#text": "Swiss market" },
            },
            classificationInformation: {
              "common:classification": {
                "common:class": [
                  { "@level": "0", "@classId": "06", "#text": "Crude petroleum and natural gas" },
                ],
              },
            },
            "common:other": {
              "@xmlns:tidasimport": "https://example.invalid/tidas-import",
              "tidasimport:sourceTrace": {
                payload: {
                  attributes: [
                    { name: "name", value: `Synthetic source trace ${index + 1}` },
                    { name: "location", value: "CH" },
                  ],
                },
              },
            },
          },
        },
        modellingAndValidation: { LCIMethod: { typeOfDataSet: "Product flow" } },
        flowProperties: {
          flowProperty: [
            {
              "@dataSetInternalID": "0",
              referenceToFlowPropertyDataSet: {
                "@refObjectId": "93a60a56-a3c8-11da-a746-0800200b9a66",
                "@version": "03.00.003",
                "common:shortDescription": { "@xml:lang": "en", "#text": "Mass" },
              },
              meanValue: "1",
            },
          ],
        },
      },
    };
    return { id, version: "00.00.001", json: payload };
  });
  const payloadById = new Map(seedRows.map((row) => [row.id, row.json]));
  const seed = path.join(root, "three-flow-seed.json");
  const specFile = path.join(root, "three-flow-request.json");
  fs.writeFileSync(seed, JSON.stringify({ rows: seedRows }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "three-flow-jsonl-identity",
      actor_id: "three-flow-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: {
        project_ref: "qgzvkongdjqiiamzbbts",
        user_id: "c536ee37-64ab-427b-b7e3-4e2bb4fdffb7",
        session_reference: null,
      },
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "three-flow-actor" };
  const originalSpawn = childProcess.spawnSync;
  const queriedTargets: unknown[] = [];
  let childFailure: unknown;
  t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
    try {
      const argv = Array.isArray(args[1]) ? args[1] : [];
      if (!argv.includes("identity-receipt") && !argv.includes("identity-preflight")) {
        assert.ok(!argv.includes("--commit"), "the regression cannot enter a write stage");
        return Reflect.apply(originalSpawn, childProcess, args);
      }
      assert.equal(args[0], process.execPath);
      assert.equal(argv[0], resolveInstalledTiangongLcaCliPackage().binPath);
      assert.notEqual(args[2]?.shell, true);
      if (argv.includes("identity-receipt"))
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify(testAuthIdentityReceipt()),
          stderr: "",
          pid: 1,
          output: [],
        };
      const input = argv[argv.indexOf("--input") + 1];
      const outDir = argv[argv.indexOf("--out-dir") + 1];
      const request = JSON.parse(fs.readFileSync(input, "utf8")) as { target: unknown };
      const identity = datasetIdentity(request.target, 0, "flow");
      assert.deepEqual(request.target, payloadById.get(identity.id));
      queriedTargets.push(request.target);
      const reportFile = path.join(outDir, "outputs", "identity-decision.json");
      const report = {
        schema_version: 1,
        generated_at_utc: new Date().toISOString(),
        kind: "flow",
        status: "needs_review",
        decision: "manual_review",
        target: { id: identity.id, version: identity.version },
        input_path: input,
        out_dir: outDir,
        files: { identity_decision: reportFile },
        candidates: [],
        candidate_sources: [],
        findings: [],
        blockers: [],
        next_action: "queue_manual_review",
        ok: true,
      };
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, JSON.stringify(report) + "\n");
      const tick = new Date(Date.now() + 1);
      fs.utimesSync(reportFile, tick, tick);
      // Successful synthetic transport isolates the source-format/semantic contract.
      // Diagnostic exit-1 admission is a separate facilities dependency (PR #240).
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify(report),
        stderr: "",
        pid: 1,
        output: [],
      };
    } catch (error) {
      childFailure = error;
      throw error;
    }
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  for (let step = 0; step < 3; step++) await facade.resume(invocation);
  const identified = await facade.resume(invocation);
  if (childFailure) throw childFailure;
  assert.equal(identified.status, "ready", JSON.stringify(identified));
  assert.equal(queriedTargets.length, 3);
  const reviewed = await facade.resume(invocation);
  assert.equal(reviewed.status, "needs_input", JSON.stringify(reviewed));
  const assessmentFile = reviewed.artifacts.findLast(
    (item) => item.role === "foundry-assessment.json",
  );
  assert.ok(assessmentFile?.kind === "file");
  const assessment = JSON.parse(fs.readFileSync(assessmentFile.path, "utf8")) as Assessment;
  const work = assessment.sets[0].decisions.find((item) => item.kind === "identity");
  assert.equal(work?.status, "ready_for_ai_identity_decisions");
  assert.ok(work);
  const task = JSON.parse(fs.readFileSync(work.task, "utf8")) as { files: { template: string } };
  const template = readRows(path.resolve(assessment.owner_base, task.files.template)) as Array<
    Record<string, unknown>
  >;
  assert.equal(template.length, 3);
  for (const decision of template) {
    decision.identity_decision = "create_new";
    decision.canonical = null;
    decision.basis = "Explicit create_new review of the controlled complete synthetic Flow.";
    decision.used_context_kinds = [
      "schema",
      "methodology_yaml",
      "ruleset",
      "classification_schema",
      "location_schema",
    ];
    decision.evidence = {
      ...(decision.evidence as Record<string, unknown>),
      quote_or_trace: "Controlled source trace retained with this accepted semantic decision.",
    };
  }
  const decisions = path.join(root, "three-flow-decisions.jsonl");
  const submission = path.join(root, "three-flow-semantic.json");
  fs.writeFileSync(decisions, template.map((item) => JSON.stringify(item)).join("\n") + "\n");
  fs.writeFileSync(
    submission,
    JSON.stringify({
      schema: "tiangong-foundry.semantic-input.v1",
      task_id: invocation.taskId,
      actor_id: invocation.actorId,
      assessment_sha256: assessmentFile.sha256,
      submissions: [
        {
          kind: "identity",
          authoring_task_sha256: digestFile(work.task),
          file: decisions,
          sha256: digestFile(decisions),
        },
      ],
    }),
  );
  const retained = reviewed.artifacts.filter((item) => item.kind === "file");
  const applied = await facade.resume({ ...invocation, semanticInputFile: submission });
  assert.equal(applied.status, "ready", JSON.stringify(applied));
  const currentRowsFile = applied.artifacts.findLast((item) => item.role === "foundry-rows.json");
  assert.ok(currentRowsFile?.kind === "file");
  const currentRows = JSON.parse(fs.readFileSync(currentRowsFile.path, "utf8")) as {
    sets: Array<{ file: string; count: number }>;
    identity_reports: string[];
  };
  const jsonl = currentRows.sets[0].file;
  assert.ok(jsonl.endsWith(".jsonl"));
  assert.equal(fs.readFileSync(jsonl, "utf8").trim().split("\n").length, 3);
  assert.deepEqual(
    readRows(jsonl),
    seedRows,
    "create_new preserves every UUID, version, payload and embedded trace",
  );
  assert.equal(currentRows.identity_reports.length, 1);
  const acceptedOwnerReport = currentRows.identity_reports[0];
  const acceptedOwnerSha = digestFile(acceptedOwnerReport);
  const ownerReport = JSON.parse(fs.readFileSync(acceptedOwnerReport, "utf8")) as {
    status: string;
    counts: {
      input_rows: number;
      input_decisions: number;
      output_rows: number;
      reference_rows: number;
      blockers: number;
    };
  };
  assert.equal(ownerReport.status, "completed");
  assert.equal(ownerReport.counts.input_rows, 3);
  assert.equal(ownerReport.counts.input_decisions, 3);
  assert.equal(ownerReport.counts.output_rows, 3);
  assert.equal(ownerReport.counts.reference_rows, 0);
  assert.equal(ownerReport.counts.blockers, 0);
  const semanticFile = applied.artifacts.findLast((item) => item.role === "semantic-result.json");
  assert.ok(semanticFile?.kind === "file");
  const acceptedSha = digestFile(semanticFile.path);
  assert.deepEqual(
    (await facade.resume({ ...invocation, semanticInputFile: submission })).artifacts,
    applied.artifacts,
    "duplicate accepted semantic submission cannot mutate or reapply the rows",
  );
  const reassessed = await facade.resume(invocation);
  assert.equal(reassessed.status, "ready", JSON.stringify(reassessed));
  assert.equal(queriedTargets.length, 3, "reassessment does not dispatch identity reads");
  t.diagnostic(
    JSON.stringify({
      accepted_create_new: 3,
      current_jsonl_lines: 3,
      next_operation: "ordinary public task resume",
    }),
  );
  const refreshed = await facade.resume(invocation);
  if (childFailure) throw childFailure;
  assert.equal(refreshed.status, "ready", JSON.stringify(refreshed));
  assert.equal(
    queriedTargets.length,
    6,
    "the refreshed lineage performs one read per current Flow",
  );
  assert.deepEqual(
    queriedTargets.slice(3),
    seedRows.map((row) => row.json),
  );
  for (const item of retained) {
    assert.ok(item.kind === "file");
    assert.equal(digestFile(item.path), item.sha256, "predecessor evidence remains immutable");
  }
  assert.equal(digestFile(semanticFile.path), acceptedSha);
  assert.equal(digestFile(acceptedOwnerReport), acceptedOwnerSha);
  const identityFile = refreshed.artifacts.findLast(
    (item) => item.role === "foundry-identity.json",
  );
  assert.ok(identityFile?.kind === "file");
  const identityReport = JSON.parse(fs.readFileSync(identityFile.path, "utf8")) as {
    index: string;
  };
  const index = readRows(identityReport.index) as Array<{
    dataset_id: string;
    dataset_version: string;
    source_file: string;
    target_sha256: string;
    request_file: string;
  }>;
  assert.deepEqual(
    index.map((item) => item.dataset_id),
    ids,
  );
  for (const item of index) {
    assert.equal(item.dataset_version, "00.00.001");
    assert.equal(
      item.target_sha256,
      createHash("sha256")
        .update(JSON.stringify(payloadById.get(item.dataset_id)))
        .digest("hex"),
    );
    assert.ok(
      item.source_file.endsWith(path.basename(jsonl)),
      "identity binds the current JSONL source",
    );
  }
  const pending = await facade.resume(invocation);
  assert.equal(
    pending.status,
    "ready",
    "the exact successor lineage retains its explicit accepted create_new decisions",
  );
  const pendingAssessment = pending.artifacts.findLast(
    (item) => item.role === "foundry-assessment.json",
  );
  assert.ok(pendingAssessment?.kind === "file");
  const pendingReport = JSON.parse(fs.readFileSync(pendingAssessment.path, "utf8")) as Assessment;
  assert.equal(
    pendingReport.sets[0].decisions.some(
      (item) => item.kind === "identity" && item.status === "ready_for_ai_identity_decisions",
    ),
    false,
    "unchanged accepted identities do not ask for a duplicate semantic decision",
  );
  assert.deepEqual(readRows(jsonl), seedRows);
  assert.equal(digestFile(acceptedOwnerReport), acceptedOwnerSha);
  assert.equal(digestFile(semanticFile.path), acceptedSha);
  assert.equal(queriedTargets.length, 6);
  assert.ok(
    pending.artifacts.every(
      (item) =>
        !["foundry-authorization.json", "owner-execution-request.json", "consumed.json"].includes(
          item.role,
        ),
    ),
  );
});
