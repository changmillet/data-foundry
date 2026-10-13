import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { flowRow, processRowWithFlowRef } from "../fixtures/row-builders.ts";
import { qualityReviewFixture } from "../fixtures/foundry-quality-review.ts";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import { runFoundryPublicCommand } from "../../scripts/runtime-entry.ts";
import {
  captureFoundryInput,
  createFoundryRuntimeContext,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { readVerifiedTaskSnapshot } from "../../scripts/lib/foundry-task-store.ts";
import { qualifyFoundryRuntime } from "../../scripts/lib/foundry-runtime-qualification.ts";
import {
  foundryQualityReviewScope,
  loadFoundryQualityReview,
  reviewedFoundryQualityFindings,
} from "../../scripts/lib/foundry-quality-review.ts";
import { currentWorkflowState } from "../../scripts/lib/foundry-workflow-state.ts";
import { readQaFindings } from "../../scripts/lib/import-curation/internal/artifact-inputs.ts";
import { runWorkflowLocalCli } from "../../scripts/lib/foundry-workflow-io.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";

test("non-Process quality projection reuses its verified workflow snapshot without reading artifacts again", async (t) => {
  const f = workflowFixture(t);
  const seed = path.join(f.root, "flow-seed.json"),
    specFile = path.join(f.root, "flow-request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({ rows: [flowRow("77777777-7777-4777-8777-777777777777")] }),
  );
  const account = {
    project_ref: "qgzvkongdjqiiamzbbts",
    user_id: "44444444-4444-4444-8444-444444444444",
    session_reference: null,
  };
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "quality-review-flow-projection",
      actor_id: "reviewer",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["flow"],
      sources: [{ path: seed }],
      seed: { path: seed },
      preparation: null,
      account_intent: account,
    }),
  );
  const started = await f.facade.start({ specFile });
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId: "reviewer" };
  await f.facade.resume(invocation);
  await f.facade.resume(invocation);
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: f.workspace,
    cacheBase: path.join(f.root, "cache"),
    ...invocation,
    accountIntent: { projectRef: account.project_ref, userId: account.user_id },
  };
  const base = createFoundryRuntimeContext(options);
  const snapshot = readVerifiedTaskSnapshot(base);
  const context = createFoundryRuntimeContext({
    ...options,
    inputs: snapshot.index.map((entry) =>
      captureFoundryInput(path.resolve(base.taskRoot!, entry.path)),
    ),
  });
  const workflow = currentWorkflowState(context, snapshot.index);
  assert.deepEqual(
    workflow.rows?.value.sets.map((set) => set.type),
    ["flow"],
  );
  const qualification = qualifyFoundryRuntime(context, f.runtimeSelection);
  const reads = t.mock.method(fs, "readFileSync", () => {
    throw new Error("Projection reread a verified workflow snapshot");
  });
  try {
    assert.equal(
      foundryQualityReviewScope(
        context,
        qualification.qualification_sha256,
        snapshot.index,
        workflow,
      ),
      null,
    );
    assert.equal(reads.mock.callCount(), 0);
  } finally {
    reads.mock.restore();
  }
});

test("public preparation review rejects an unbound decision before advancing the task", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t);
  const seed = path.join(root, "seed.json");
  const specFile = path.join(root, "request.json");
  fs.writeFileSync(
    seed,
    JSON.stringify({
      rows: [
        processRowWithFlowRef(
          "66666666-6666-4666-8666-666666666666",
          "77777777-7777-4777-8777-777777777777",
        ),
      ],
    }),
  );
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "quality-review",
      actor_id: "quality-review-actor",
      lane: "source-evidence-dataset-development",
      profile_id: "generic",
      target_entities: ["process"],
      sources: [{ path: seed }],
      seed: { path: seed },
      account_intent: null,
      preparation: null,
    }),
  );
  const started = await facade.start({ specFile });
  assert.ok(started.task_id);
  const descriptor = path.join(root, "review.json");
  fs.writeFileSync(
    descriptor,
    JSON.stringify({ code: "process_material_balance_deviation", accept: true }),
  );
  const request = {
    taskId: started.task_id,
    actorId: "quality-review-actor",
    qualityReviewInputFile: descriptor,
  };
  const result = await facade.resume(request);
  assert.equal(result.blockers[0]?.code, "quality_review_input_invalid");
  assert.equal(result.permissions.state, "not_required");
  assert.ok(!result.artifacts.some((item) => item.role === "foundry-context.json"));
  const output: string[] = [];
  await runFoundryPublicCommand(
    [
      process.execPath,
      "tiangong-foundry",
      "task",
      "resume",
      "--workspace",
      workspace,
      "--task",
      request.taskId,
      "--actor",
      request.actorId,
      "--quality-review-input",
      descriptor,
      "--json",
    ],
    {
      runtimeSelection,
      cacheBase: path.join(root, "cache"),
      writeStdout: (value) => {
        output.push(value);
      },
      setExitCode: () => {},
    },
  );
  assert.equal(output.length, 1);
  assert.equal(JSON.parse(output[0]).blockers[0]?.code, "quality_review_input_invalid");
});

test("one exact preparation review survives reload and reassessment without accepting another Process or granting a write", async (t) => {
  const f = await qualityReviewFixture(t);
  const originalQa = fs.readFileSync(f.scope.qa.path);
  for (const changed of [
    { binding: { ...f.descriptor.binding, input_scope_sha256: "0".repeat(64) } },
    { binding: { ...f.descriptor.binding, user_id: "55555555-5555-4555-8555-555555555555" } },
    { rows_manifest_sha256: "0".repeat(64) },
    { context_sha256: "0".repeat(64) },
    { reference_inputs_sha256: "0".repeat(64) },
    { runtime_qualification_sha256: "0".repeat(64) },
    { qa_report_sha256: "0".repeat(64) },
    { qa_findings_sha256: "0".repeat(64) },
    { reviews: [{ ...f.descriptor.reviews[0], id: f.ids.b }] },
    { reviews: [{ ...f.descriptor.reviews[0], payload_sha256: "0".repeat(64) }] },
    {
      issued_at_utc: new Date(Date.now() - 7200_000).toISOString(),
      expires_at_utc: new Date(Date.now() - 3600_000).toISOString(),
    },
  ]) {
    fs.writeFileSync(f.descriptorFile, JSON.stringify({ ...f.descriptor, ...changed }));
    const rejected = await f.facade.resume({
      ...f.invocation,
      qualityReviewInputFile: f.descriptorFile,
    });
    assert.ok(
      rejected.blockers.some((item) => item.code.startsWith("quality_review_")),
      JSON.stringify(rejected),
    );
    assert.ok(!rejected.artifacts.some((item) => item.role === "foundry-quality-review.json"));
  }
  fs.writeFileSync(f.descriptorFile, JSON.stringify(f.descriptor));
  const accepted = await f.facade.resume({
    ...f.invocation,
    qualityReviewInputFile: f.descriptorFile,
  });
  assert.ok(
    accepted.artifacts.some((item) => item.role === "foundry-quality-review.json"),
    JSON.stringify(accepted.blockers),
  );
  assert.equal(accepted.permissions.state, "not_required");
  const reloaded = createFoundryFacade({
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: f.workspace,
    cacheBase: path.join(f.root, "cache"),
    runtimeSelection: f.runtimeSelection,
  });
  const reassessed = await reloaded.resume(f.invocation);
  assert.equal(reassessed.status, "needs_input", JSON.stringify(reassessed.blockers));
  const artifact = reassessed.artifacts.findLast(
    (item) => item.role === "dataset-curation-gate-report.json",
  );
  assert.ok(artifact?.kind === "file", JSON.stringify(reassessed));
  const report = JSON.parse(fs.readFileSync(artifact.path, "utf8")) as {
    entities: Array<{
      entity_id: string;
      reviewed_finding_count?: number;
      waived_finding_count: number;
      action_item_count: number;
    }>;
    policy: { waived_qa_codes: unknown[] };
  };
  const a = report.entities.find((item) => item.entity_id === f.ids.a)!;
  const b = report.entities.find((item) => item.entity_id === f.ids.b)!;
  assert.equal(a.reviewed_finding_count, 1);
  assert.equal(a.waived_finding_count, 0);
  assert.equal(b.reviewed_finding_count, undefined);
  assert.ok(b.action_item_count > 0);
  assert.deepEqual(report.policy.waived_qa_codes, []);
  assert.deepEqual(fs.readFileSync(f.scope.qa.path), originalQa);
  const taskRoot = path.join(f.workspace, ".foundry", "workspaces", f.invocation.taskId);
  assert.equal(fs.existsSync(path.join(taskRoot, "authorization.json")), false);
  assert.ok(
    !reassessed.artifacts.some((item) =>
      /owner-execution-request|execution-context/.test(item.role),
    ),
  );
  const index = path.join(taskRoot, "artifact-index.jsonl"),
    before = fs.readFileSync(index);
  const repeated = await reloaded.resume({
    ...f.invocation,
    qualityReviewInputFile: f.descriptorFile,
  });
  assert.equal(repeated.status, "needs_input", JSON.stringify(repeated.blockers));
  assert.deepEqual(fs.readFileSync(index), before);

  const contextOptions = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: f.workspace,
    cacheBase: path.join(f.root, "cache"),
    ...f.invocation,
    accountIntent: {
      projectRef: f.descriptor.binding.project_ref,
      userId: f.descriptor.binding.user_id,
    },
  };
  const base = createFoundryRuntimeContext(contextOptions);
  const snapshot = readVerifiedTaskSnapshot(base);
  const context = createFoundryRuntimeContext({
    ...contextOptions,
    inputs: snapshot.index.map((entry) =>
      captureFoundryInput(path.resolve(base.taskRoot!, entry.path)),
    ),
  });
  const review = loadFoundryQualityReview(
    context,
    qualifyFoundryRuntime(context, f.runtimeSelection),
    snapshot.index,
  );
  assert.ok(review);
  const qa = JSON.parse(originalQa.toString("utf8")) as Record<string, unknown>;
  const findings = readQaFindings(context.assetRoot, qa, f.scope.qa.path, "process");
  assert.equal(
    reviewedFoundryQualityFindings(
      review,
      f.scope.input.path,
      { ...qa, generated_at_utc: "2030-01-01T00:00:00.000Z" },
      findings,
    ).length,
    1,
  );
  assert.throws(() =>
    reviewedFoundryQualityFindings({ ...review }, f.scope.input.path, qa, findings),
  );
  assert.throws(() =>
    reviewedFoundryQualityFindings(
      review,
      f.scope.input.path,
      { ...qa, logic_version: "different" },
      findings,
    ),
  );
  assert.throws(() =>
    reviewedFoundryQualityFindings(
      review,
      f.scope.input.path,
      { ...qa, extra_observation: true },
      findings,
    ),
  );
  const changedFindings = structuredClone(findings);
  changedFindings[0].message = "Changed observation";
  assert.throws(() =>
    reviewedFoundryQualityFindings(review, f.scope.input.path, qa, changedFindings),
  );
  const changedRows = path.join(f.root, "changed-rows.json");
  fs.writeFileSync(
    changedRows,
    JSON.stringify(JSON.parse(fs.readFileSync(f.scope.input.path, "utf8")).reverse()),
  );
  assert.throws(() => reviewedFoundryQualityFindings(review, changedRows, qa, findings));

  const contextArtifact = f.assessed.artifacts.find(
    (item) => item.sha256 === f.scope.context_sha256,
  );
  const receiptArtifact = accepted.artifacts.findLast(
    (item) => item.role === "foundry-quality-review.json",
  );
  assert.ok(contextArtifact?.kind === "file" && receiptArtifact?.kind === "file");
  const contextFiles = JSON.parse(fs.readFileSync(contextArtifact.path, "utf8")).files as Record<
    string,
    string
  >;
  const receipt = JSON.parse(fs.readFileSync(receiptArtifact.path, "utf8")) as {
    evidence: Array<{ path: string }>;
  };
  for (const file of [
    (qa.files as Record<string, string>).rule_findings,
    contextFiles.methodology,
    receipt.evidence[0].path,
  ]) {
    const retained = fs.readFileSync(file);
    fs.appendFileSync(file, "\n");
    try {
      const corrupted = await reloaded.status(f.invocation);
      assert.ok(
        corrupted.blockers.some((item) => item.code === "quality_review_scope_invalid"),
        JSON.stringify(corrupted),
      );
      assert.throws(() =>
        loadFoundryQualityReview(
          context,
          qualifyFoundryRuntime(context, f.runtimeSelection),
          snapshot.index,
        ),
      );
    } finally {
      fs.writeFileSync(file, retained);
    }
  }

  // An expired decision cannot keep an old, successful disposition current. Reassessment
  // retains the old receipts and restores the original actionable QA observation.
  const actualNow = Date.now;
  t.mock.method(Date, "now", () => actualNow() + 7200_000);
  const expired = await reloaded.resume(f.invocation);
  t.mock.restoreAll();
  const expiredReport = expired.artifacts.findLast(
    (item) => item.role === "dataset-curation-gate-report.json",
  );
  assert.ok(expiredReport?.kind === "file", JSON.stringify(expired.blockers));
  const restored = JSON.parse(fs.readFileSync(expiredReport.path, "utf8")) as typeof report;
  assert.equal(
    restored.entities.find((item) => item.entity_id === f.ids.a)?.reviewed_finding_count,
    undefined,
  );
  assert.ok(
    restored.entities.find((item) => item.entity_id === f.ids.a)!.action_item_count >
      a.action_item_count,
  );
  assert.equal(fs.existsSync(path.join(taskRoot, "authorization.json")), false);
});

test("competing preparation reviews have one winner and a new reference selection invalidates its acceptance", async (t) => {
  const f = await qualityReviewFixture(t);
  const competitor = path.join(f.root, "competing-review.json");
  fs.writeFileSync(
    competitor,
    JSON.stringify({
      ...f.descriptor,
      reviews: [
        {
          ...f.descriptor.reviews[0],
          rationale: "A separately submitted review of the same exact observation.",
        },
      ],
    }),
  );
  const results = await Promise.all(
    [f.descriptorFile, competitor].map((qualityReviewInputFile) =>
      f.facade.resume({ ...f.invocation, qualityReviewInputFile }),
    ),
  );
  assert.equal(
    results.filter((result) =>
      result.artifacts.some((item) => item.role === "foundry-quality-review.json"),
    ).length,
    1,
  );
  assert.ok(
    results.some((result) =>
      result.blockers.some((item) => item.code.startsWith("quality_review_")),
    ),
    JSON.stringify(results),
  );
  const assessed = await f.facade.resume(f.invocation);
  const reference = assessed.artifacts.findLast(
    (item) => item.role === "foundry-reference-input.json",
  );
  assert.ok(reference?.kind === "file");
  const source = JSON.parse(fs.readFileSync(reference.path, "utf8")) as {
    qa_files: Array<{ path: string; sha256: string }>;
  };
  const descriptor = path.join(f.root, "new-reference-selection.json");
  fs.writeFileSync(
    descriptor,
    JSON.stringify({
      schema: "tiangong-foundry.reference-input.v1",
      task_id: f.invocation.taskId,
      actor_id: f.invocation.actorId,
      rows_manifest_sha256: f.scope.rows_manifest_sha256,
      dataset_type: "process",
      qa_reference_rows: source.qa_files.map((fact) => ({ file: fact.path, sha256: fact.sha256 })),
      intent: null,
      review_files: [],
    }),
  );
  await f.facade.resume({ ...f.invocation, referenceInputFile: descriptor });
  const changed = await f.facade.resume(f.invocation);
  const report = changed.artifacts.findLast(
    (item) => item.role === "dataset-curation-gate-report.json",
  );
  assert.ok(report?.kind === "file", JSON.stringify(changed.blockers));
  const current = JSON.parse(fs.readFileSync(report.path, "utf8")) as {
    entities: Array<{ entity_id: string; reviewed_finding_count?: number }>;
  };
  assert.equal(
    current.entities.find((item) => item.entity_id === f.ids.a)?.reviewed_finding_count,
    undefined,
  );
});

test("a changed Process object interpretation invalidates a prior quality review even when rows and raw QA stay unchanged", async (t) => {
  const f = await qualityReviewFixture(t);
  await f.facade.resume({ ...f.invocation, qualityReviewInputFile: f.descriptorFile });
  await f.facade.resume(f.invocation);
  const rows = JSON.parse(fs.readFileSync(f.scope.input.path, "utf8")) as unknown[];
  const input = path.join(f.root, "changed-interpretation.json");
  fs.writeFileSync(
    input,
    JSON.stringify({
      schema: "tiangong-foundry.interaction-input.v1",
      task_id: f.invocation.taskId,
      actor_id: f.invocation.actorId,
      expected_state_sha256: null,
      events: [
        {
          kind: "assumption",
          id: "changed-interpretation",
          dataset_type: "process",
          object_scope: {
            entity_id: f.ids.a,
            version: "00.00.001",
            row_sha256: sha256Json(rows[0]),
          },
          statement: "The source-model interpretation requires another applicability review.",
          impact: "The prior mass observation review cannot supply the new interpretation.",
          evidence_sha256: [],
          supersedes: null,
        },
      ],
    }),
  );
  const selected = await f.facade.resume({ ...f.invocation, interactionInputFile: input });
  assert.ok(
    selected.artifacts.some((item) => item.role === "current_interaction_state"),
    JSON.stringify(selected.blockers),
  );
  const reassessed = await f.facade.resume(f.invocation);
  const assessment = reassessed.artifacts.findLast(
    (item) => item.role === "foundry-assessment.json",
  );
  assert.ok(assessment?.kind === "file", JSON.stringify(reassessed.blockers));
  const sets = JSON.parse(fs.readFileSync(assessment.path, "utf8")).sets as Array<{
    type: string;
    curation_report: string;
  }>;
  const processSet = sets.find((set) => set.type === "process");
  assert.ok(processSet);
  const current = JSON.parse(fs.readFileSync(processSet.curation_report, "utf8")) as {
    entities: Array<{ entity_id: string; reviewed_finding_count?: number }>;
  };
  const processA = current.entities.find((item) => item.entity_id === f.ids.a);
  assert.ok(processA);
  assert.equal(processA.reviewed_finding_count, undefined);
});

test("reviewed finalization repeats the exact QA reference scope of a mixed local-row assessment", async (t) => {
  const f = await qualityReviewFixture(t);
  await f.facade.resume({ ...f.invocation, qualityReviewInputFile: f.descriptorFile });
  const options = {
    moduleUrl: new URL("../../scripts/runtime-entry.ts", import.meta.url).href,
    workspace: f.workspace,
    cacheBase: path.join(f.root, "cache"),
    ...f.invocation,
    accountIntent: {
      projectRef: f.descriptor.binding.project_ref,
      userId: f.descriptor.binding.user_id,
    },
  };
  const base = createFoundryRuntimeContext(options);
  const snapshot = readVerifiedTaskSnapshot(base);
  const context = createFoundryRuntimeContext({
    ...options,
    inputs: snapshot.index.map((entry) =>
      captureFoundryInput(path.resolve(base.taskRoot!, entry.path)),
    ),
  });
  const qualified = qualifyFoundryRuntime(context, f.runtimeSelection);
  const review = loadFoundryQualityReview(context, qualified, snapshot.index);
  assert.ok(review);
  const temporary = path.join(f.root, "final-qa-runtime");
  fs.mkdirSync(temporary);
  const qa = runWorkflowLocalCli(context, qualified, temporary, [
    "qa",
    "process",
    "--rows-file",
    f.scope.input.path,
    "--out-dir",
    path.join(f.root, "final-qa"),
    "--json",
    ...review.qaReferenceRows.flatMap((file) => ["--reference-rows-file", file]),
  ]);
  const reportFile = (qa.files as Record<string, string>).report;
  const findings = readQaFindings(context.assetRoot, qa, reportFile, "process");
  assert.equal(reviewedFoundryQualityFindings(review, f.scope.input.path, qa, findings).length, 1);
  assert.deepEqual(
    qa.reference_evidence,
    JSON.parse(fs.readFileSync(f.scope.qa.path, "utf8")).reference_evidence,
  );
  assert.ok(review.qaReferenceRows.length >= 3, "keep each local Flow, property and unit scope");
  const referenceBytes = fs.readFileSync(review.qaReferenceRows[0]);
  fs.appendFileSync(review.qaReferenceRows[0], " ");
  assert.throws(() => review.validate(), /reference|indexed evidence/u);
  fs.writeFileSync(review.qaReferenceRows[0], referenceBytes);
  review.validate();
});
