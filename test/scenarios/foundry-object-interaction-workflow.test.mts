import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createFoundryFacade } from "../../scripts/foundry-facade.ts";
import { sha256Json } from "../../scripts/lib/identity-preflight-proof.ts";
import { workflowFixture } from "../fixtures/foundry-public-workflow.ts";
import { processRowWithInvalidLocation } from "../fixtures/row-builders.ts";

const firstId = "66666666-6666-4666-8666-666666666666";
const secondId = "77777777-7777-4777-8777-777777777777";
const actorId = "object-scope-actor";
const moduleUrl = new URL("../../scripts/runtime-entry.ts", import.meta.url).href;
const fileSha256 = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
const readRowSet = <T,>(file: string): T[] => {
  const contents = fs.readFileSync(file, "utf8").trim();
  return contents.startsWith("[")
    ? (JSON.parse(contents) as T[])
    : contents.split(/\r?\n/u).map((line) => JSON.parse(line) as T);
};

function fileArtifact(
  result: Awaited<ReturnType<ReturnType<typeof workflowFixture>["facade"]["resume"]>>,
  role: string,
) {
  const artifact = result.artifacts.findLast((item) => item.role === role && item.kind === "file");
  assert.ok(artifact?.kind === "file", `Missing registered ${role}`);
  return artifact;
}

test("one Process question permits another Process patch, then binds only its own answer", async (t) => {
  const { root, workspace, facade, runtimeSelection } = workflowFixture(t, false, "decisions");
  const rows = [firstId, secondId].map((id) => {
    const json = processRowWithInvalidLocation(id);
    json.processDataSet.processInformation.dataSetInformation.classificationInformation[
      "common:classification"
    ]["common:class"][0]["@classId"] = "INVALID";
    return { id, version: "00.00.001", json };
  });
  const seed = path.join(root, "two-processes.json");
  const specFile = path.join(root, "request.json");
  const interactionFile = path.join(root, "interaction.json");
  const semanticFile = path.join(root, "semantic.json");
  fs.writeFileSync(seed, JSON.stringify({ rows }));
  fs.writeFileSync(
    specFile,
    JSON.stringify({
      schema: "tiangong-foundry.task-start.v1",
      request_id: "two-process-object-scope",
      actor_id: actorId,
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
  assert.equal(started.status, "ready");
  assert.ok(started.task_id);
  const invocation = { taskId: started.task_id, actorId };
  await facade.resume(invocation);
  const materialized = await facade.resume(invocation);
  const rowsReport = fileArtifact(materialized, "foundry-rows.json");
  const rowManifest = readJson(rowsReport.path) as {
    sets: Array<{ type: string; file: string }>;
  };
  const processRows = rowManifest.sets.find((set) => set.type === "process");
  assert.ok(processRows);
  const registeredRows = readRowSet<(typeof rows)[number]>(processRows.file);
  assert.deepEqual(
    registeredRows.map((row) => row.id),
    [firstId, secondId],
  );
  const firstScope = {
    entity_id: firstId,
    version: registeredRows[0].version,
    row_sha256: sha256Json(registeredRows[0]),
  };
  const writeInteraction = (expected: string | null, events: unknown[]) =>
    fs.writeFileSync(
      interactionFile,
      JSON.stringify({
        schema: "tiangong-foundry.interaction-input.v1",
        task_id: invocation.taskId,
        actor_id: actorId,
        expected_state_sha256: expected,
        events,
      }),
    );
  const question = {
    kind: "question",
    id: "p1-classification-evidence",
    dataset_type: "process",
    object_scope: firstScope,
    missing: "P1 lacks a reviewed classification source.",
    impact: "P1 cannot use a scientific category without that evidence.",
    recommendation: "Check the controlled source before classifying P1.",
    ask: "Which evidenced category should P1 use?",
    choices: ["Use the evidenced category", "Investigate the source first"],
    evidence_sha256: [fileSha256(seed)],
    supersedes: null,
  };
  const index = path.join(
    workspace,
    ".foundry/workspaces",
    invocation.taskId,
    "artifact-index.jsonl",
  );
  const beforeTamper = fs.readFileSync(index);
  writeInteraction(null, [
    { ...question, object_scope: { ...firstScope, row_sha256: "0".repeat(64) } },
  ]);
  const tampered = await facade.resume({ ...invocation, interactionInputFile: interactionFile });
  assert.equal(tampered.status, "blocked");
  assert.equal(tampered.blockers[0]?.code, "interaction_input_invalid");
  assert.deepEqual(fs.readFileSync(index), beforeTamper);
  writeInteraction(null, [question]);
  const pending = await facade.resume({ ...invocation, interactionInputFile: interactionFile });
  assert.equal(pending.status, "needs_input");
  assert.equal(pending.permissions.state, "not_required");
  const humanQuestion = pending.next_actions.find(
    (action) => action.kind === "human" && action.code === "answer_current_question",
  );
  assert.ok(humanQuestion?.kind === "human");
  for (const detail of [question.missing, question.impact, question.recommendation, question.ask])
    assert.ok(humanQuestion.instructions.includes(detail));
  assert.ok(humanQuestion.instructions.includes(firstId), "show which Process needs an answer");
  const partialRecap = pending.artifacts.find((artifact) => artifact.role === "decision_recap");
  assert.ok(partialRecap?.kind === "inline");
  const partial = partialRecap.value as {
    completion_proven: boolean;
    unresolved_questions: Array<{ id: string; object_scope?: { entity_id: string } }>;
  };
  assert.equal(partial.completion_proven, false);
  assert.deepEqual(
    partial.unresolved_questions.map((item) => item.id),
    [question.id],
  );
  assert.deepEqual(partial.unresolved_questions[0]?.object_scope, firstScope);
  const state = fileArtifact(pending, "current_interaction_state");

  const assessed = await facade.resume(invocation);
  const assessmentArtifact = fileArtifact(assessed, "foundry-assessment.json");
  const assessment = readJson(assessmentArtifact.path) as {
    owner_base: string;
    sets: Array<{
      type: string;
      rows: string;
      authoring_manifest: string;
    }>;
  };
  const processSet = assessment.sets.find((set) => set.type === "process");
  assert.ok(processSet);
  const manifest = readJson(processSet.authoring_manifest) as {
    tasks: Array<{
      entity: { entity_id: string; version: string };
      status: string;
      files: { task_json: string; authoring_package: string };
      action_items: Array<{ code: string; path: string | null }>;
    }>;
  };
  assert.deepEqual(
    manifest.tasks.map((item) => item.entity.entity_id),
    [firstId, secondId],
  );
  const firstWork = manifest.tasks[0],
    secondWork = manifest.tasks[1];
  assert.equal(firstWork.status, "ready_for_ai_authoring");
  assert.equal(secondWork.status, "ready_for_ai_authoring");
  const secondTaskFile = path.resolve(assessment.owner_base, secondWork.files.task_json);
  const secondPatchFile = path.join(root, "p2-patch.json");
  const secondPatch = {
    schema_version: 1,
    patch_status: "completed",
    patch_sets: [
      {
        dataset_id: secondId,
        version: secondWork.entity.version,
        authoring_package: path.basename(secondWork.files.authoring_package),
        operations: [
          {
            op: "add",
            path: "/json/processDataSet/processInformation/dataSetInformation/common:generalComment",
            value: { "@xml:lang": "en", "#text": "Controlled P2 heat production boundary." },
            basis: "The selected P2 fixture identifies this as an onsite heat production boundary.",
            evidence: {
              source: seed,
              field_path: "/processDataSet/processInformation/dataSetInformation/name/baseName",
              quote_or_trace: "Heat, from natural gas",
            },
            resolution: {
              mode: "evidence_backed_completion",
              used_context_kinds: [
                "schema",
                "methodology_yaml",
                "ruleset",
                "classification_schema",
                "location_schema",
              ],
            },
            closes_action_items: secondWork.action_items.map((item) => ({
              code: item.code,
              path: item.path,
            })),
          },
        ],
      },
    ],
  };
  fs.writeFileSync(secondPatchFile, JSON.stringify(secondPatch));
  const writeSemantic = (
    assessmentSha: string,
    interactionSha: string,
    work: typeof secondWork,
    patchFile: string,
    decisionIds?: string[],
  ) => {
    const workFile = path.resolve(assessment.owner_base, work.files.task_json);
    fs.writeFileSync(
      semanticFile,
      JSON.stringify({
        schema: "tiangong-foundry.semantic-input.v1",
        task_id: invocation.taskId,
        actor_id: actorId,
        assessment_sha256: assessmentSha,
        interaction_sha256: interactionSha,
        submissions: [
          {
            kind: "patch",
            authoring_task_sha256: fileSha256(workFile),
            file: patchFile,
            sha256: fileSha256(patchFile),
            ...(decisionIds ? { decision_ids: decisionIds } : {}),
          },
        ],
      }),
    );
  };
  assert.ok(fs.existsSync(secondTaskFile));
  writeSemantic(assessmentArtifact.sha256, state.sha256, secondWork, secondPatchFile);
  const appliedSecond = await facade.resume({ ...invocation, semanticInputFile: semanticFile });
  assert.equal(appliedSecond.status, "needs_input", "P1 still needs a human answer");
  const adoptionSecond = fileArtifact(appliedSecond, "semantic-result.json");
  const adoptedSecond = readJson(adoptionSecond.path) as {
    adopted_decisions: Array<{ decision_ids: string[]; object_scope?: { entity_id: string } }>;
  };
  assert.deepEqual(adoptedSecond.adopted_decisions[0]?.decision_ids, []);
  assert.equal(adoptedSecond.adopted_decisions[0]?.object_scope?.entity_id, secondId);
  const afterSecondRows = readJson(fileArtifact(appliedSecond, "foundry-rows.json").path) as {
    sets: Array<{ type: string; file: string }>;
  };
  const afterSecondProcess = afterSecondRows.sets.find((set) => set.type === "process");
  assert.ok(afterSecondProcess);
  const updatedRows = readRowSet<(typeof rows)[number]>(afterSecondProcess.file);
  assert.deepEqual(updatedRows[0], registeredRows[0], "P2 work cannot rewrite P1");
  assert.notDeepEqual(updatedRows[1], registeredRows[1], "P2 work must update only P2");
  assert.equal(appliedSecond.permissions.state, "not_required");

  const beforeDuplicate = fs.readFileSync(index);
  const duplicate = await facade.resume({ ...invocation, semanticInputFile: semanticFile });
  assert.deepEqual(duplicate.artifacts, appliedSecond.artifacts);
  assert.deepEqual(fs.readFileSync(index), beforeDuplicate);

  const afterSecondReview = await facade.resume(invocation);
  const baselineAssessment = fileArtifact(afterSecondReview, "foundry-assessment.json");
  const baselineReport = readJson(baselineAssessment.path) as typeof assessment;
  const baselineProcess = baselineReport.sets.find((set) => set.type === "process");
  assert.ok(baselineProcess);
  const baselineManifest = readJson(baselineProcess.authoring_manifest) as typeof manifest;
  const baselineSecondWork = baselineManifest.tasks.find(
    (item) => item.entity.entity_id === secondId,
  );
  assert.ok(baselineSecondWork);
  const baselineSecondTaskSha = fileSha256(
    path.resolve(baselineReport.owner_base, baselineSecondWork.files.task_json),
  );

  writeInteraction(state.sha256, [
    {
      kind: "answer",
      question_id: question.id,
      decision_id: "p1-controlled-category",
      supersedes_decision_id: null,
      raw_answer: "Use the documented controlled category for P1.",
      adopted_decision: "Classify P1 using the documented controlled source.",
      disposition: "decided",
      evidence_sha256: [fileSha256(seed)],
    },
  ]);
  const answered = await facade.resume({ ...invocation, interactionInputFile: interactionFile });
  const answeredState = fileArtifact(answered, "current_interaction_state");
  const answerRecap = answered.artifacts.find((artifact) => artifact.role === "decision_recap");
  assert.ok(answerRecap?.kind === "inline");
  const recap = answerRecap.value as {
    completion_proven: boolean;
    user_decisions: Array<{ decision_id: string; object_scope?: { entity_id: string } }>;
  };
  assert.equal(recap.completion_proven, false);
  assert.deepEqual(
    recap.user_decisions.map((item) => item.decision_id),
    ["p1-controlled-category"],
  );
  assert.deepEqual(recap.user_decisions[0]?.object_scope, firstScope);
  assert.equal(fileArtifact(answered, "foundry-assessment.json").sha256, baselineAssessment.sha256);

  const beforeStale = fs.readFileSync(index);
  writeInteraction(state.sha256, [
    {
      kind: "answer",
      question_id: question.id,
      decision_id: "stale-p1-answer",
      supersedes_decision_id: "p1-controlled-category",
      raw_answer: "A late answer against the old state.",
      adopted_decision: "Do not accept a stale replacement.",
      disposition: "decided",
      evidence_sha256: [],
    },
  ]);
  const stale = await facade.resume({ ...invocation, interactionInputFile: interactionFile });
  assert.equal(stale.status, "blocked");
  assert.ok(
    ["interaction_input_invalid", "interaction_state_changed"].includes(stale.blockers[0]?.code),
  );
  assert.deepEqual(fs.readFileSync(index), beforeStale);

  writeInteraction(answeredState.sha256, [
    {
      kind: "answer",
      question_id: question.id,
      decision_id: "p1-corrected-category",
      supersedes_decision_id: "p1-controlled-category",
      raw_answer: "Correction: use the evidenced electricity and heat category D for P1.",
      adopted_decision: "Classify only P1 as the controlled electricity and heat category D.",
      disposition: "decided",
      evidence_sha256: [fileSha256(seed)],
    },
  ]);
  const corrected = await facade.resume({ ...invocation, interactionInputFile: interactionFile });
  const correctedState = fileArtifact(corrected, "current_interaction_state");
  assert.equal(
    fileArtifact(corrected, "foundry-assessment.json").sha256,
    baselineAssessment.sha256,
  );
  const correctedRecap = corrected.artifacts.find((artifact) => artifact.role === "decision_recap");
  assert.ok(correctedRecap?.kind === "inline");
  const correctedDecisions = (
    correctedRecap.value as { user_decisions: Array<{ decision_id: string }> }
  ).user_decisions;
  assert.deepEqual(
    correctedDecisions.map((item) => item.decision_id),
    ["p1-corrected-category"],
  );
  const afterCorrectionReport = readJson(
    fileArtifact(corrected, "foundry-assessment.json").path,
  ) as typeof assessment;
  const afterCorrectionProcess = afterCorrectionReport.sets.find((set) => set.type === "process");
  assert.ok(afterCorrectionProcess);
  const afterCorrectionManifest = readJson(
    afterCorrectionProcess.authoring_manifest,
  ) as typeof manifest;
  const afterCorrectionSecondWork = afterCorrectionManifest.tasks.find(
    (item) => item.entity.entity_id === secondId,
  );
  assert.ok(afterCorrectionSecondWork);
  assert.equal(
    fileSha256(
      path.resolve(afterCorrectionReport.owner_base, afterCorrectionSecondWork.files.task_json),
    ),
    baselineSecondTaskSha,
    "changing P1 answer must reuse P2 authoring work",
  );

  const restoredFacade = createFoundryFacade({
    moduleUrl,
    workspace,
    cacheBase: path.join(root, "cache"),
    runtimeSelection,
  });
  const restored = await restoredFacade.status(invocation);
  assert.deepEqual(fileArtifact(restored, "current_interaction_state"), correctedState);
  assert.equal(restored.permissions.state, "not_required");
  assert.ok(
    restored.artifacts.every(
      (artifact) =>
        !["foundry-authorization.json", "owner-execution-request.json", "consumed.json"].includes(
          artifact.role,
        ),
    ),
  );

  const currentFirstWork = afterCorrectionManifest.tasks.find(
    (item) => item.entity.entity_id === firstId,
  );
  assert.ok(currentFirstWork);
  const firstPatchFile = path.join(root, "p1-patch.json");
  const firstPatch = {
    schema_version: 1,
    patch_status: "completed",
    patch_sets: [
      {
        dataset_id: firstId,
        version: currentFirstWork.entity.version,
        authoring_package: path.basename(currentFirstWork.files.authoring_package),
        operations: [
          {
            ...secondPatch.patch_sets[0].operations[0],
            value: { "@xml:lang": "en", "#text": "Controlled P1 heat production boundary." },
            closes_action_items: currentFirstWork.action_items.map((item) => ({
              code: item.code,
              path: item.path,
            })),
          },
          {
            op: "replace",
            path: "/json/processDataSet/processInformation/dataSetInformation/classificationInformation/common:classification/common:class/0/@classId",
            value: "D",
            basis:
              "The corrected P1 answer selects category D from controlled classification context.",
            evidence: {
              source: seed,
              field_path:
                "/processDataSet/processInformation/dataSetInformation/classificationInformation/common:classification/common:class/0",
              quote_or_trace: "Electricity, gas, steam and air conditioning supply",
            },
            resolution: {
              mode: "evidence_backed_completion",
              used_context_kinds: [
                "schema",
                "methodology_yaml",
                "ruleset",
                "classification_schema",
                "location_schema",
              ],
            },
            closes_action_items: [],
          },
        ],
      },
    ],
  };
  fs.writeFileSync(firstPatchFile, JSON.stringify(firstPatch));
  writeSemantic(baselineAssessment.sha256, correctedState.sha256, currentFirstWork, firstPatchFile);
  const missingDecision = await facade.resume({ ...invocation, semanticInputFile: semanticFile });
  assert.equal(missingDecision.status, "blocked");
  assert.equal(missingDecision.blockers[0]?.code, "semantic_interaction_invalid");
  writeSemantic(
    baselineAssessment.sha256,
    correctedState.sha256,
    currentFirstWork,
    firstPatchFile,
    ["p1-corrected-category"],
  );
  const appliedFirst = await facade.resume({ ...invocation, semanticInputFile: semanticFile });
  assert.notEqual(appliedFirst.status, "blocked");
  const firstAdoption = readJson(fileArtifact(appliedFirst, "semantic-result.json").path) as {
    adopted_decisions: Array<{ decision_ids: string[]; object_scope?: { entity_id: string } }>;
  };
  assert.deepEqual(firstAdoption.adopted_decisions[0]?.decision_ids, ["p1-corrected-category"]);
  assert.equal(firstAdoption.adopted_decisions[0]?.object_scope?.entity_id, firstId);
  const afterFirstManifest = readJson(fileArtifact(appliedFirst, "foundry-rows.json").path) as {
    sets: Array<{ type: string; file: string }>;
  };
  const afterFirstProcess = afterFirstManifest.sets.find((set) => set.type === "process");
  assert.ok(afterFirstProcess);
  const afterFirstRows = readRowSet<(typeof rows)[number]>(afterFirstProcess.file);
  assert.deepEqual(afterFirstRows[1], updatedRows[1], "P1 work cannot rewrite P2");
  assert.equal(
    afterFirstRows[0].json.processDataSet.processInformation.dataSetInformation
      .classificationInformation["common:classification"]["common:class"][0]["@classId"],
    "D",
  );
  assert.equal(appliedFirst.permissions.state, "not_required");
});
