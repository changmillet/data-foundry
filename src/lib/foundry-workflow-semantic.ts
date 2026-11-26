import fs from "node:fs";
import path from "node:path";
import { registeredAssessmentSetProducerBase } from "./foundry-assessment-producer.ts";
import {
  captureFoundryInput,
  readFoundryInput,
  resolveFoundryOutput,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import {
  assertQualifiedFoundryRuntime,
  type QualifiedFoundryRuntime,
} from "./foundry-runtime-qualification.ts";
import {
  assertSelectedSemanticInput,
  readSelectedSemanticBytes,
  type SelectedSemanticInput,
} from "./foundry-semantic-input.ts";
import {
  currentWorkflowState,
  workflowObject,
  type WorkflowRowSet,
} from "./foundry-workflow-state.ts";
import { runFoundryTaskOperation } from "./foundry-task-store.ts";
import type { ArtifactEntry } from "./foundry-task-types.ts";
import {
  createWorkflowStageDirectory,
  createWorkflowDirectory,
  registerWorkflowStageFiles,
  runWorkflowLocalCliResult,
} from "./foundry-workflow-io.ts";
import { applyFoundryTypedAuthoringPatch } from "./foundry-typed-authoring-patch.ts";
import { runDatasetAuthoringPatchCollect } from "./import-curation/patch-collect.ts";
import { readJsonOrJsonl, ensureArray, readRows } from "./import-curation/internal/runtime-io.ts";
import { createFoundryDecisionOwners } from "./foundry-decision-owners.ts";
import { applyFoundryIdentityDecisions } from "./foundry-workflow-identity-apply.ts";
import { currentFoundryInteractionState } from "./foundry-interaction-input.ts";
import {
  verifyFoundrySemanticInteraction,
  type SemanticSelectedScope,
} from "./foundry-semantic-interaction.ts";
import {
  currentFoundryObjectScopes,
  currentFoundryNarrowObjects,
  requireCurrentFoundryObject,
  requireCurrentFoundryObjectScope,
} from "./foundry-workflow-object-scope.ts";
import {
  operationFullContextEvidenceBlockers,
  operationUsedContextKinds,
  patchPayloadPatchSets,
  patchSetOperations,
  taskRequiredContextKinds,
} from "./import-curation/internal/workflow-authoring-tasks.ts";
import {
  failSemantic as fail,
  findPriorSemanticApplication,
  indexedFoundryAdoptionRows,
  indexedFoundryDecisionWorkObjects,
  registeredDecisionWorkObjects,
  semanticText as text,
  verifySemanticNarrowObjectAdoptions,
} from "./foundry-workflow-semantic-scope.ts";

export { indexedFoundryAdoptionRows, indexedFoundryDecisionWorkObjects };

export async function applyFoundrySemanticInput(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  entries: readonly ArtifactEntry[],
  submission: SelectedSemanticInput,
) {
  assertSelectedSemanticInput(submission);
  assertQualifiedFoundryRuntime(context, qualified);
  const interaction = currentFoundryInteractionState(context, entries);
  if ((submission.spec.interaction_sha256 ?? null) !== (interaction?.entry.sha256 ?? null))
    fail("semantic_interaction_changed", "Submit against the current registered task decisions.");
  const prior = findPriorSemanticApplication(context, entries, submission);
  if (prior) return prior;
  const state = currentWorkflowState(context, entries);
  if (
    !state.rows ||
    !state.assessment ||
    state.assessment.entry.sha256 !== submission.spec.assessment_sha256
  )
    fail("semantic_assessment_mismatch", "Submit against the current assessed row version.");
  const rows = state.rows,
    assessment = state.assessment;
  const selected = new Map(
    submission.spec.submissions.map((part, index) => [
      part.authoring_task_sha256,
      { part, fact: submission.files[index] },
    ]),
  );
  const used = new Set<string>();
  const decisionWork: Array<{
    kind: "classification" | "location" | "identity";
    type: string;
    rows: string;
    task: string;
    queue: string | null;
    sha: string;
    fact: typeof submission.descriptor;
  }> = [];
  const work: Array<{
    set: Record<string, unknown>;
    manifest: Record<string, unknown>;
    manifestFile: string;
    ownerBase: string;
    tasks: Array<{
      task: Record<string, unknown>;
      sha: string;
      fact: typeof submission.descriptor;
    }>;
  }> = [];
  for (const set of assessment.value.sets) {
    const ownerBase = registeredAssessmentSetProducerBase(context, entries, set);
    const manifestFile = text(set.authoring_manifest, "Authoring manifest");
    const manifest = workflowObject(
      JSON.parse(readFoundryInput(context, manifestFile).toString("utf8")),
    );
    if (!Array.isArray(manifest.tasks))
      fail("semantic_work_invalid", "Authoring tasks are missing.");
    const tasks: (typeof work)[number]["tasks"] = [];
    for (const raw of manifest.tasks) {
      const task = workflowObject(raw),
        files = workflowObject(task.files);
      const taskFile = path.resolve(ownerBase, text(files.task_json, "Authoring task"));
      const entry = entries.find(
        (candidate) => resolveFoundryOutput(context, candidate.path) === taskFile,
      );
      if (!entry)
        fail("semantic_work_unregistered", "Authoring work is not registered in this task.");
      const chosen = selected.get(entry.sha256);
      if (!chosen || chosen.part.kind !== "patch") continue;
      readFoundryInput(context, taskFile);
      if (task.status !== "ready_for_ai_authoring" || Number(task.action_item_count ?? 0) < 1)
        fail(
          "semantic_work_not_patchable",
          "The selected item requires its dedicated decision owner or more context.",
        );
      if (used.has(entry.sha256))
        fail("semantic_work_ambiguous", "A submitted work item is ambiguous.");
      used.add(entry.sha256);
      tasks.push({ task, sha: entry.sha256, fact: chosen.fact });
    }
    if (tasks.length) work.push({ set, manifest, manifestFile, ownerBase, tasks });
    for (const raw of Array.isArray(set.decisions) ? set.decisions : []) {
      const decision = workflowObject(raw);
      if (
        decision.kind !== "classification" &&
        decision.kind !== "location" &&
        decision.kind !== "identity"
      )
        continue;
      const taskFile = text(decision.task, "Decision task");
      const entry = entries.find(
        (candidate) => resolveFoundryOutput(context, candidate.path) === taskFile,
      );
      if (!entry) fail("semantic_work_unregistered", "Decision work is not registered.");
      const chosen = selected.get(entry.sha256);
      if (!chosen) continue;
      if (chosen.part.kind !== decision.kind || used.has(entry.sha256))
        fail("semantic_work_mismatch", "Submission kind differs from the current decision owner.");
      if (decision.status !== `ready_for_ai_${decision.kind}_decisions`)
        fail(
          "semantic_work_not_ready",
          "Decision work requires its missing context before submission.",
        );
      used.add(entry.sha256);
      decisionWork.push({
        kind: decision.kind,
        type: text(set.type, "Dataset type"),
        rows: text(set.rows, "Rows"),
        task: taskFile,
        queue: decision.kind === "identity" ? null : text(decision.queue, "Decision queue"),
        sha: entry.sha256,
        fact: chosen.fact,
      });
    }
  }
  if (used.size !== selected.size)
    fail(
      "semantic_work_mismatch",
      "Every submitted digest must identify current registered authoring work.",
    );
  const rowOwners = new Set(work.map((group) => text(group.set.type, "Dataset type")));
  if (
    decisionWork.some((item) => item.kind === "identity") &&
    (decisionWork.length !== 1 || work.length)
  )
    fail(
      "task_semantic_owner_conflict",
      "Submit one identity task at a time; reference rewrites may affect multiple row types.",
    );
  for (const item of decisionWork) {
    if (rowOwners.has(item.type))
      fail(
        "task_semantic_owner_conflict",
        "Submit one decision/patch owner per row set, then reassess before the next owner.",
      );
    rowOwners.add(item.type);
  }
  const narrowObjects = interaction ? currentFoundryNarrowObjects(interaction.state) : [];
  const narrowTypes = new Set(narrowObjects.map((item) => item.dataset_type));
  const currentObjects = narrowTypes.size ? currentFoundryObjectScopes(context, entries) : null;
  const selectedScopes = new Map<string, SemanticSelectedScope>();
  for (const group of work)
    for (const item of group.tasks) {
      const type = text(group.set.type, "Dataset type");
      if (!narrowTypes.has(type)) {
        selectedScopes.set(item.sha, type);
        continue;
      }
      const entity = workflowObject(item.task.entity);
      if (entity.dataset_type !== type)
        fail(
          "semantic_work_invalid",
          "Authoring task entity type differs from its assessed row set.",
        );
      const entityId = text(entity.entity_id, "Authoring entity id");
      const version = text(entity.version, "Authoring entity version");
      if (interaction)
        requireCurrentFoundryObjectScope(
          context,
          entries,
          interaction.state,
          currentObjects!,
          type,
          entityId,
          version,
        );
      else requireCurrentFoundryObject(currentObjects!, type, entityId, version);
      selectedScopes.set(item.sha, { dataset_type: type, entity_id: entityId, version });
    }
  for (const item of decisionWork) {
    if (!narrowTypes.has(item.type) && !(item.kind === "identity" && narrowTypes.size)) {
      selectedScopes.set(item.sha, item.type);
      continue;
    }
    const objects = registeredDecisionWorkObjects(context, entries, item);
    if (
      item.kind === "identity" &&
      narrowTypes.has("process") &&
      objects.some((object) => object.dataset_type === "flow")
    )
      fail(
        "semantic_identity_scope_unverifiable",
        "Flow identity may rewrite Process references with active object decisions. Review or separate those Process objects before submitting this identity task.",
      );
    for (const object of objects)
      requireCurrentFoundryObjectScope(
        context,
        entries,
        interaction!.state,
        currentObjects!,
        object.dataset_type,
        object.entity_id,
        object.version,
      );
    selectedScopes.set(item.sha, objects);
  }
  const adoptedDecisions = verifyFoundrySemanticInteraction(
    submission.spec,
    interaction ? { sha256: interaction.entry.sha256, state: interaction.state } : null,
    selectedScopes,
  );
  return runFoundryTaskOperation(
    context,
    {
      command: "dataset-semantic-apply",
      options: {
        submission: submission.descriptor,
        files: submission.files,
        assessment: assessment.entry.sha256,
        ...(interaction
          ? { interaction: interaction.entry.sha256, adopted_decisions: adoptedDecisions }
          : {}),
      },
      validateCurrent(index) {
        const current = currentWorkflowState(context, index);
        if (
          current.assessment?.entry.sha256 !== assessment.entry.sha256 ||
          current.rows?.entry.sha256 !== rows.entry.sha256 ||
          (currentFoundryInteractionState(context, index)?.entry.sha256 ?? null) !==
            (interaction?.entry.sha256 ?? null)
        )
          fail(
            "semantic_assessment_changed",
            "Assessment advanced before this submission acquired the task lock.",
          );
      },
    },
    (operation) => {
      assertSelectedSemanticInput(submission);
      assertQualifiedFoundryRuntime(context, qualified);
      for (const input of context.inputs) readFoundryInput(context, input.path);
      const output = createWorkflowStageDirectory(context, operation, "semantic");
      fs.mkdirSync(resolveFoundryOutput(context, "tmp"), { recursive: true, mode: 0o700 });
      const temporary = createWorkflowDirectory(context, path.join(context.tempRoot, "semantic-"));
      const updated = new Map<string, WorkflowRowSet>();
      const identityReports = [...rows.value.identity_reports],
        rewriteReports = [...rows.value.identity_rewrite_reports];
      const results: Array<Record<string, unknown>> = [];
      const blockers: Array<Record<string, unknown>> = [];
      try {
        operation.writeText(
          path.join(output, "submission.json"),
          readSelectedSemanticBytes(submission.descriptor),
        );
        for (const group of work) {
          const type = text(group.set.type, "Dataset type");
          const previousBlockers = blockers.length;
          const projected = structuredClone(group.manifest);
          projected.tasks = group.tasks.map(({ task, sha, fact }) => {
            const snapshot = path.join(output, "inputs", `${sha}.json`);
            const bytes = readSelectedSemanticBytes(fact);
            operation.writeText(snapshot, bytes);
            const strictTask = {
              ...task,
              context: {
                ...workflowObject(task.context),
                full_context_ai_completion: { required: true },
              },
            };
            const requiredKinds = taskRequiredContextKinds(task);
            let payload: unknown;
            try {
              payload = JSON.parse(bytes.toString("utf8"));
            } catch {
              blockers.push({ code: "semantic_patch_json_invalid", type, work_item: sha });
            }
            for (const patch of patchPayloadPatchSets(payload)) {
              for (const patchOperation of patchSetOperations(patch) ?? []) {
                if (patchOperation.op === "test") continue;
                blockers.push(
                  ...operationFullContextEvidenceBlockers({
                    operation: patchOperation,
                    task: strictTask,
                  }),
                );
                const usedKinds = operationUsedContextKinds(patchOperation);
                if (requiredKinds.some((kind) => !usedKinds.includes(kind)))
                  blockers.push({
                    code: "semantic_context_evidence_missing",
                    type,
                    work_item: sha,
                  });
              }
            }
            return {
              ...structuredClone(task),
              files: { ...workflowObject(task.files), output_patch_file: snapshot },
            };
          });
          const projectedFile = path.join(output, type, "selected-work.json");
          operation.writeJson(projectedFile, projected);
          if (blockers.length !== previousBlockers) continue;
          const collection = runDatasetAuthoringPatchCollect({
            repoRoot: group.ownerBase,
            options: {
              taskManifest: projectedFile,
              outDir: path.join(output, type, "collect"),
              out: path.join(output, type, "collected-patches.json"),
            },
          });
          if (
            collection.status !== "ready_for_patch_apply" ||
            !Array.isArray(collection.blockers) ||
            collection.blockers.length
          ) {
            blockers.push({ code: "semantic_patch_invalid", type, collection });
            continue;
          }
          const originalRows = text(group.set.rows, "Assessed rows");
          const packageDirectories = new Set(
            group.tasks.map(({ task }) =>
              path.dirname(
                path.resolve(
                  group.ownerBase,
                  text(workflowObject(task.files).authoring_package, "Authoring package"),
                ),
              ),
            ),
          );
          if (packageDirectories.size !== 1)
            fail(
              "semantic_work_invalid",
              "Selected work must share its registered package snapshot directory.",
            );
          const repaired = path.join(output, type, "repaired.rows.jsonl");
          const patch = path.join(output, type, "collected-patches.json");
          const directory = path.join(output, type, "apply");
          const typed = qualified.cli.expectation.package_version === "0.4.0";
          const typedResult = typed
            ? applyFoundryTypedAuthoringPatch(context, qualified, temporary, {
                type,
                input: originalRows,
                patch,
                directory,
                output: repaired,
                packageDirectory: [...packageDirectories][0],
                writeJson: (file, value) => operation.writeJson(file, value),
                writeText: (file, value) => operation.writeText(file, value),
              })
            : null;
          const legacyResult = typed
            ? null
            : runWorkflowLocalCliResult(context, qualified, temporary, [
                "dataset",
                "patch",
                "apply",
                "--input",
                originalRows,
                "--patch",
                patch,
                "--out",
                repaired,
                "--out-dir",
                directory,
                "--authoring-package-dir",
                [...packageDirectories][0],
                "--require-authoring-package",
                "--require-action-item-closure",
                "--json",
              ]);
          const applied = typedResult ?? legacyResult!;
          const original = rows.value.sets.find(
            (set) => set.type === type && set.file === originalRows,
          );
          const check = () => {
            if (
              !["completed", "blocked"].includes(String(applied.report.status)) ||
              !Array.isArray(applied.report.blockers)
            )
              fail(
                "semantic_apply_invalid",
                "Patch application returned no completed or blocked owner report.",
              );
            const reportFile = workflowObject(applied.report.files).report;
            if (typeof reportFile !== "string")
              fail("semantic_apply_invalid", "Patch application returned no report locator.");
            legacyResult?.verifyReportFile(reportFile);
            if (
              applied.exit !== 0 ||
              applied.report.status !== "completed" ||
              applied.report.blockers.length
            )
              return null;
            if (!original || Number(applied.report.row_count) !== original.count)
              fail(
                "semantic_row_scope_changed",
                "Patch application changed the assessed row scope.",
              );
            captureFoundryInput(repaired);
            return original;
          };
          const completed = legacyResult ? legacyResult.validate(check) : check();
          if (!completed) {
            blockers.push({ code: "semantic_apply_blocked", type, report: applied.report });
            continue;
          }
          updated.set(type, { ...completed, file: repaired });
          results.push({
            type,
            original_rows: originalRows,
            repaired_rows: repaired,
            applied_operations: applied.report.applied_operation_count,
            closed_actions: applied.report.closed_action_item_count,
          });
        }
        const decisionOwners = createFoundryDecisionOwners(context, qualified, temporary);
        for (const item of decisionWork) {
          const beforeCount = blockers.length;
          const bytes = readSelectedSemanticBytes(item.fact);
          operation.writeText(path.join(output, "inputs", `${item.sha}.submitted`), bytes);
          const task = workflowObject(
            JSON.parse(readFoundryInput(context, item.task).toString("utf8")),
          );
          const requiredKinds = taskRequiredContextKinds({
            context: { contract_context_files: task.contract_context_files },
          });
          let decisions: unknown[] = [];
          try {
            decisions = ensureArray(readJsonOrJsonl(item.fact.path, () => bytes.toString("utf8")));
          } catch {
            blockers.push({ code: "semantic_decisions_invalid_json", type: item.type });
          }
          for (const value of decisions) {
            const decision = workflowObject(value);
            blockers.push(
              ...operationFullContextEvidenceBlockers({
                operation: decision,
                task: { context: { full_context_ai_completion: { required: true } } },
              }),
            );
            const kinds = Array.isArray(decision.used_context_kinds)
              ? decision.used_context_kinds
              : [];
            if (requiredKinds.some((kind) => !kinds.includes(kind)))
              blockers.push({ code: "semantic_context_evidence_missing", type: item.type });
          }
          if (blockers.length !== beforeCount) continue;
          if (item.kind === "identity") {
            const applied = applyFoundryIdentityDecisions(context, qualified, temporary, {
              task,
              decisions,
              sets: rows.value.sets,
              output: path.join(output, "identity"),
            });
            blockers.push(...applied.blockers);
            identityReports.push(...applied.reports);
            rewriteReports.push(...applied.rewriteReports);
            for (const set of applied.sets) updated.set(set.type, set);
            results.push({
              kind: "identity",
              reports: applied.reports,
              rewrite_reports: applied.rewriteReports,
            });
            continue;
          }
          const decisionFile = path.join(output, item.type, `${item.kind}-decisions.jsonl`);
          operation.writeText(
            decisionFile,
            decisions.map((value) => JSON.stringify(value)).join("\n") + "\n",
          );
          const repaired = path.join(output, item.type, "repaired.rows.jsonl");
          const options = {
            [`${item.kind}Queue`]: item.queue,
            decisions: decisionFile,
            decisionTask: item.task,
            rowsFile: item.rows,
            out: repaired,
            outDir: path.join(output, item.type, item.kind),
          };
          const applied = workflowObject(
            decisionOwners.invoke(() =>
              item.kind === "classification"
                ? decisionOwners.classification.runDatasetClassificationDecisionsApply(options)
                : decisionOwners.location.runDatasetLocationDecisionsApply(options),
            ),
          );
          if (
            applied.status !== "completed" ||
            !Array.isArray(applied.blockers) ||
            applied.blockers.length
          ) {
            blockers.push({
              code: "semantic_decision_apply_blocked",
              type: item.type,
              kind: item.kind,
              report: applied,
            });
            continue;
          }
          const original = rows.value.sets.find(
            (set) => set.type === item.type && set.file === item.rows,
          );
          if (!original || !fs.existsSync(repaired) || readRows(repaired).length !== original.count)
            fail("semantic_row_scope_changed", "Decision application changed row scope.");
          updated.set(item.type, { ...original, file: repaired });
          results.push({
            kind: item.kind,
            type: item.type,
            original_rows: item.rows,
            repaired_rows: repaired,
            report: applied,
          });
        }
        assertSelectedSemanticInput(submission);
        for (const input of context.inputs) readFoundryInput(context, input.path);
        assertQualifiedFoundryRuntime(context, qualified);
        const rowAdoptions = verifySemanticNarrowObjectAdoptions({
          context,
          blockers,
          decisionWork,
          narrowObjects,
          currentObjects,
          adoptedDecisions,
          originalSets: rows.value.sets,
          updated,
        });
        registerWorkflowStageFiles(context, operation, output);
        if (!blockers.length)
          operation.writeJson(path.join(output, "foundry-rows.json"), {
            schema: "tiangong-foundry.rows-stage.v1",
            status: "completed",
            predecessor: rows.file,
            sets: rows.value.sets
              .map((set) => updated.get(set.type) ?? set)
              .filter((set) => set.count > 0),
            identity_reports: identityReports,
            identity_rewrite_reports: rewriteReports,
          });
        const report = {
          schema: "tiangong-foundry.semantic-result.v1",
          status: blockers.length ? "blocked" : "completed",
          submission_sha256: submission.descriptor.sha256,
          assessment_sha256: assessment.entry.sha256,
          work_items: [...used],
          ...(interaction
            ? {
                interaction_sha256: interaction.entry.sha256,
                adopted_decisions: adoptedDecisions,
                ...(rowAdoptions.length ? { row_adoptions: rowAdoptions } : {}),
              }
            : {}),
          results,
          blockers,
        };
        operation.writeJson(path.join(output, "semantic-result.json"), report);
        return report;
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
  );
}
