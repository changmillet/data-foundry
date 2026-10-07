import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FoundryOperationResult } from "../../scripts/lib/foundry-operation-result.ts";
import { supportFlowPropertyRow, supportUnitGroupRow } from "../fixtures/support-row-builders.ts";
type Json = Record<string, unknown>;
const object = (value: unknown) => value as Json;
const rowsAt = (file: string): Json[] => {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".jsonl"))
    return text
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const value = JSON.parse(text);
  return Array.isArray(value) ? value : [value];
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** Actual packaged Foundry operations over the managed host; no validator reconstruction. */
export async function verifyManagedProcessPreparation(
  root: string,
  run: (argv: string[]) => Promise<FoundryOperationResult>,
) {
  const original = JSON.parse(
    fs.readFileSync(new URL("../fixtures/managed-allocation-input.json", import.meta.url), "utf8"),
  );
  const receipts: Json[] = [];
  for (const [name, direction, flowType, expectedSemantic, annual] of [
    ["annual-invalid", "Input", "Product flow", "passed", "200000 kg"],
    ["input-product", "Input", "Product flow", "passed", "200000 kg/year"],
    ["output-product", "Output", "Product flow", "passed", "200000 kg/year"],
    ["input-waste", "Input", "Waste flow", "passed", "200000 kg/year"],
    ["output-waste", "Output", "Waste flow", "passed", "200000 kg/year"],
    ["elementary", "Input", "Elementary flow", "failed", "200000 kg/year"],
    ["unresolved", "Input", "Product flow", "unresolved", "200000 kg/year"],
    ["wrong-version", "Input", "Product flow", "unresolved", "200000 kg/year"],
    ["undeclared", "Input", "Product flow", "passed", "200000 kg/year"],
    ["scalar-empty", "Input", "Product flow", "passed", "200000 kg/year"],
    ["legacy-full", "Input", "Product flow", "passed", "200000 kg/year"],
    ["legacy-percent", "Input", "Product flow", "passed", "200000 kg/year"],
    ["legacy-output-share", "Input", "Product flow", "passed", "200000 kg/year"],
    ["annual-unknown", "Input", "Product flow", "passed", null],
  ] as const) {
    const selected = structuredClone(original);
    const process = selected.payload.processDataSet;
    process.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume =
      annual
        ? [
            { "@xml:lang": "en", "#text": annual },
            {
              "@xml:lang": "zh",
              "#text": annual === "200000 kg" ? "200000 千克" : "200000 千克/年",
            },
          ]
        : [];
    process.processInformation.quantitativeReference.functionalUnitOrOther = {
      "@xml:lang": "en",
      "#text": "1 kg synthetic product",
    };
    process.exchanges.exchange[1].exchangeDirection = direction;
    if (name === "undeclared") delete process.exchanges.exchange[0].allocations;
    if (name === "scalar-empty") process.exchanges.exchange[0].allocations = { allocation: {} };
    if (name === "legacy-output-share")
      process.exchanges.exchange[0].allocations = { allocation: { "@allocatedFraction": "100" } };
    if (name === "legacy-full" || name === "legacy-percent") {
      delete process.exchanges.exchange[0].allocations;
      process.exchanges.exchange[1].allocations = {
        allocation: { "@allocatedFraction": name === "legacy-full" ? "100" : "100%" },
      };
    }
    const flow = selected.context.flow_documents[0].flowDataSet;
    flow.modellingAndValidation.LCIMethod.typeOfDataSet = flowType;
    if (name === "wrong-version")
      flow.administrativeInformation.publicationAndOwnership["common:dataSetVersion"] = "00.00.002";
    if (name === "unresolved") selected.context.flow_documents = [];
    const propertyId = "93a60a56-a3c8-11da-a746-0800200b9a66";
    const unitGroupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const units = supportUnitGroupRow(unitGroupId);
    units.unitGroupDataSet.units.unit[0].name = "kg";
    const source = path.join(root, `managed-preparation-${name}.json`);
    fs.writeFileSync(
      source,
      JSON.stringify({
        source_evidence: {
          annual_quantity: annual ? "200000 kg" : "unknown",
          reporting_period: annual ? "one year" : "unknown",
        },
        rows: [
          { json_ordered: selected.payload, semantic_context: selected.context },
          ...selected.context.flow_documents,
          supportFlowPropertyRow(propertyId, unitGroupId),
          units,
        ],
      }),
    );
    const sourceBytes = fs.readFileSync(source);
    const spec = path.join(root, `managed-preparation-${name}-request.json`);
    fs.writeFileSync(
      spec,
      JSON.stringify({
        schema: "tiangong-foundry.task-start.v1",
        request_id: `managed-preparation-${name}`,
        actor_id: "preparation-actor",
        lane: "source-evidence-dataset-development",
        profile_id: "generic",
        target_entities: ["process", "flow", "flowproperty", "unitgroup"],
        sources: [{ path: source }],
        seed: { path: source },
        account_intent: null,
        preparation: null,
      }),
    );
    let result = await run(["task", "start", "--spec", spec, "--json"]);
    const taskId = result.task_id;
    assert.ok(taskId);
    const jobArtifact = result.artifacts.find(
      (item) => item.kind === "file" && item.role === "foundry_job",
    );
    assert.ok(jobArtifact?.kind === "file");
    const job = object(JSON.parse(fs.readFileSync(jobArtifact.path, "utf8")));
    assert.equal(job.actor_id, "preparation-actor");
    assert.equal(job.task_id, taskId);
    assert.deepEqual(job.write_policy, { mode: "dry-run", remote_state_code: 0 });

    let evidence: { file: string; value: Json } | undefined;
    for (let i = 0; i < 10; i++) {
      result = await run([
        "task",
        "resume",
        "--task",
        taskId,
        "--actor",
        "preparation-actor",
        "--json",
      ]);
      assert.equal(result.task_id, taskId);
      const artifact = result.artifacts.findLast(
        (item) => item.kind === "file" && path.basename(item.path) === "foundry-assessment.json",
      );
      if (artifact?.kind === "file") {
        const value = object(JSON.parse(fs.readFileSync(artifact.path, "utf8")));
        if (
          value.status === "completed" &&
          (value.sets as Json[]).some((set) => set.type === "process")
        ) {
          evidence = { file: artifact.path, value };
          break;
        }
      }
    }
    assert.ok(evidence, JSON.stringify(result.blockers));
    const set = (evidence.value.sets as Json[]).find((item) => item.type === "process");
    assert.ok(set);
    const reportBytes = fs.readFileSync(String(set.cli_validation_report));
    assert.equal(hash(reportBytes), set.cli_validation_report_sha256);
    const report = object(JSON.parse(reportBytes.toString()));
    const row = object((report.rows as Json[])[0]);
    const semantics = object(row.allocation_semantics);
    assert.equal(semantics.status, expectedSemantic, name);
    assert.equal(row.payload_sha256, semantics.candidate_sha256);
    const annualIssues = object(object(row.validation_layers).authoring_evidence).issues as Json[];
    assert.equal(
      annualIssues.some((issue) =>
        String(issue.code).startsWith("annual_supply_or_production_volume"),
      ),
      name.startsWith("annual-"),
      name,
    );
    const gate = object(JSON.parse(fs.readFileSync(String(set.curation_report), "utf8")));
    const entity = (gate.entities as Json[])[0];
    const authoring = object(
      JSON.parse(
        fs.readFileSync(
          path.resolve(String(evidence.value.owner_base), String(entity.authoring_package)),
          "utf8",
        ),
      ),
    );
    assert.deepEqual(object(authoring.cli_validation).row, row);
    assert.equal(object(authoring.cli_validation).report_sha256, hash(reportBytes));
    const actions = authoring.action_items as Json[];
    if (name.startsWith("annual-"))
      assert.ok(
        actions.some(
          (item) => item.validation_layer === "authoring_evidence" && item.ai_required === true,
        ),
      );
    if (expectedSemantic !== "passed")
      assert.ok(
        actions.some(
          (item) => item.validation_layer === "allocation_semantics" && item.ai_required === true,
        ),
      );
    if (name === "annual-invalid") {
      const manifest = object(JSON.parse(fs.readFileSync(String(set.authoring_manifest), "utf8")));
      const task = object((manifest.tasks as Json[])[0]);
      const files = object(task.files);
      const taskFile = path.resolve(String(evidence.value.owner_base), String(files.task_json));
      const currentRows = JSON.parse(fs.readFileSync(String(set.rows), "utf8")) as Json[];
      const current = currentRows[0];
      const payloadKey = ["process", "json_ordered", "jsonOrdered", "json", "payload"].find(
        (key) => current[key],
      );
      assert.ok(payloadKey);
      const annualPath = `/${payloadKey}/processDataSet/modellingAndValidation/dataSourcesTreatmentAndRepresentativeness/annualSupplyOrProductionVolume`;
      const patchFile = path.join(root, "managed-annual-repair.json");
      const submissionFile = path.join(root, "managed-annual-repair-submission.json");
      const annualActions = actions
        .filter(
          (item) =>
            item.validation_layer === "authoring_evidence" &&
            String(item.code).startsWith("annual_supply_or_production_volume"),
        )
        .map((item) => ({ code: item.code, path: item.path }));
      fs.writeFileSync(
        patchFile,
        JSON.stringify({
          schema_version: 1,
          patch_status: "completed",
          patch_sets: [
            {
              dataset_id: object(task.entity).entity_id,
              version: object(task.entity).version,
              authoring_package: path.basename(String(files.authoring_package)),
              operations: ["200000 kg/year", "200000 千克/年"].map((value, index) => ({
                op: "replace",
                path: `${annualPath}/${index}/#text`,
                value,
                basis: "Selected synthetic source records 200000 kg over one year.",
                evidence: {
                  source,
                  field_path: annualPath,
                  quote_or_trace: "annual_quantity 200000 kg; reporting_period one year",
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
                closes_action_items: annualActions,
              })),
            },
          ],
        }),
      );
      fs.writeFileSync(
        submissionFile,
        JSON.stringify({
          schema: "tiangong-foundry.semantic-input.v1",
          task_id: taskId,
          actor_id: "preparation-actor",
          assessment_sha256: hash(fs.readFileSync(evidence.file)),
          submissions: [
            {
              kind: "patch",
              authoring_task_sha256: hash(fs.readFileSync(taskFile)),
              file: patchFile,
              sha256: hash(fs.readFileSync(patchFile)),
            },
          ],
        }),
      );
      result = await run([
        "task",
        "resume",
        "--task",
        taskId,
        "--actor",
        "preparation-actor",
        "--semantic-input",
        submissionFile,
        "--json",
      ]);
      const collected = result.artifacts.findLast(
        (item) => item.kind === "file" && item.role === "authoring-patch-collect-report.json",
      );
      assert.ok(collected?.kind === "file", JSON.stringify(result.blockers));
      const collection = object(JSON.parse(fs.readFileSync(collected.path, "utf8")));
      assert.equal(collection.status, "ready_for_patch_apply", JSON.stringify(collection));
      const rowsArtifact = result.artifacts.findLast(
        (item) => item.kind === "file" && path.basename(item.path) === "foundry-rows.json",
      );
      assert.ok(rowsArtifact?.kind === "file");
      const repairedSet = (
        object(JSON.parse(fs.readFileSync(rowsArtifact.path, "utf8"))).sets as Json[]
      ).find((item) => item.type === "process");
      assert.ok(repairedSet);
      const repairedRows = rowsAt(String(repairedSet.file));
      const expected = structuredClone(selected.payload);
      expected.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume[0][
        "#text"
      ] = "200000 kg/year";
      expected.processDataSet.modellingAndValidation.dataSourcesTreatmentAndRepresentativeness.annualSupplyOrProductionVolume[1][
        "#text"
      ] = "200000 千克/年";
      assert.deepEqual(repairedRows[0][payloadKey], expected);
      assert.deepEqual(repairedRows[0].semantic_context, selected.context);
      let fixedRow: Json | undefined;
      for (let i = 0; i < 10; i++) {
        result = await run([
          "task",
          "resume",
          "--task",
          taskId,
          "--actor",
          "preparation-actor",
          "--json",
        ]);
        const artifact = result.artifacts.findLast(
          (item) => item.kind === "file" && path.basename(item.path) === "foundry-assessment.json",
        );
        if (artifact?.kind !== "file") continue;
        const value = object(JSON.parse(fs.readFileSync(artifact.path, "utf8")));
        const refreshed = (value.sets as Json[]).find(
          (item) => item.type === "process" && item.rows === repairedSet.file,
        );
        if (refreshed) {
          fixedRow = (
            object(JSON.parse(fs.readFileSync(String(refreshed.cli_validation_report), "utf8")))
              .rows as Json[]
          )[0];
          break;
        }
      }
      assert.ok(fixedRow);
      assert.deepEqual(object(object(fixedRow.validation_layers).authoring_evidence).issues, []);
      const fixedBytes = fs.readFileSync(String(repairedSet.file));
      await run([
        "task",
        "resume",
        "--task",
        taskId,
        "--actor",
        "preparation-actor",
        "--semantic-input",
        submissionFile,
        "--json",
      ]);
      assert.deepEqual(fs.readFileSync(String(repairedSet.file)), fixedBytes);
    }
    assert.deepEqual(fs.readFileSync(source), sourceBytes);
    assert.equal(result.permissions.state, "not_required");
    receipts.push({
      case: name,
      task_id: taskId,
      runtime_identity: result.runtime_identity,
      source_sha256: hash(sourceBytes),
      assessment: evidence.file,
      report_sha256: hash(reportBytes),
      candidate_sha256: row.payload_sha256,
      allocation_status: expectedSemantic,
      cli_validation_layers: row.validation_layers,
      allocation_semantics: row.allocation_semantics,
      native_report_sha256: hash(fs.readFileSync(String(set.schema_report))),
      native_contract: object(JSON.parse(fs.readFileSync(String(set.schema_report), "utf8")))
        .rust_contract,
      native_counts: object(JSON.parse(fs.readFileSync(String(set.schema_report), "utf8"))).counts,
      annual_repair_and_old_submission_immutability: name === "annual-invalid",
      remote_authority: "not_required",
    });
  }
  fs.writeFileSync(
    path.join(root, "managed-process-preparation-receipt.json"),
    JSON.stringify(receipts, null, 2),
  );
}
