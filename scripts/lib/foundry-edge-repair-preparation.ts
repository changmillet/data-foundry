import fs from "node:fs";
import path from "node:path";
import {
  captureFoundryInput,
  FoundryContextError,
  readFoundryInput,
  writeFoundryArtifact,
  type FoundryInputFact,
  type FoundryRuntimeContext,
} from "./foundry-runtime-context.ts";
import type { QualifiedFoundryRuntime } from "./foundry-runtime-qualification.ts";
import { createFoundryEdgeActor } from "./foundry-edge-session.ts";
import { buildEdgeSupportPlan } from "./foundry-edge-support-plan.ts";
import { planFoundryEdgeSupportStage } from "./foundry-edge-support-planning.ts";
import { verifyFoundryEdgeSupport } from "./foundry-edge-support.ts";
import {
  createFoundryAuthenticationEnvironment,
  type FoundryAuthentication,
} from "./foundry-authentication-environment.ts";
import { runFoundryTypedDatasetQa } from "./foundry-typed-flow-qa.ts";
import { readRows } from "./import-curation/internal/runtime-io.ts";
import {
  parseFoundryRepairValidateReport,
  type FoundryRepairExpectation,
} from "./foundry-repair-preflight.ts";
import { sha256Json } from "./identity-preflight-proof.ts";
import { workflowObject } from "./foundry-workflow-state.ts";
import { runTidasRowsValidation } from "./tidas-adapter.ts";
import { createFoundryIsolatedChildEnvironment } from "./foundry-runtime-environment.ts";
import { runDatasetCurationCleanup } from "./import-curation/curation-cleanup.ts";
import { runDatasetCurationGate } from "./import-curation/curation-gate.ts";
import { projectFoundryValidationReferences } from "./foundry-validation-reference-context.ts";
import { datasetIdentity, detectDatasetType } from "./import-curation/internal/dataset-payload.ts";
import type { ScientificRepairEvidence } from "./foundry-scientific-repair.ts";

const invalid = (message: string) =>
  new FoundryContextError("repair_edge_preflight_invalid", message);

export function readEdgeRepairValidation(
  report: Record<string, unknown>,
  expectation: FoundryRepairExpectation,
) {
  if (report.schema !== "tiangong-foundry.typed-process-qa.v1" || !Array.isArray(report.rows))
    throw invalid("Expected the full typed Process validation evidence.");
  parseFoundryRepairValidateReport(report, expectation);
  const verification: Record<string, boolean> = {};
  for (const raw of report.rows) {
    const row = workflowObject(raw);
    if (
      workflowObject(row.allocation_semantics).status !== "passed" ||
      workflowObject(row.flow_reference_names).status !== "passed" ||
      !Array.isArray(row.issues) ||
      row.issues.some(
        (issue) => workflowObject(issue).code !== "annual_supply_or_production_volume_missing",
      )
    )
      throw invalid(
        "Repair must preserve qualified allocation, exact Flow names and all validation checks except the bounded unknown annual-volume gap.",
      );
    verification[String(row.payload_sha256)] = row.status === "passed";
  }
  return verification;
}

export async function prepareEdgeProcessRepair(
  context: FoundryRuntimeContext,
  qualified: QualifiedFoundryRuntime,
  authentication: FoundryAuthentication,
  expectation: FoundryRepairExpectation,
  files: {
    before: string;
    candidate: string;
    temporary: string;
    directory: string;
    scientific?: ScientificRepairEvidence;
  },
) {
  const { before, candidate, temporary, directory } = files;
  const actor = await createFoundryEdgeActor(context, qualified, authentication);
  const receiptFile = path.join(directory, "identity-receipt.json");
  const save = (file: string, value: unknown) =>
    writeFoundryArtifact(context, file, JSON.stringify(value, null, 2) + "\n");
  save(receiptFile, actor.receipt);
  const candidateFact = captureFoundryInput(candidate);
  const referenceDir = path.join(directory, "references");
  const environment = createFoundryAuthenticationEnvironment(
    authentication,
    context.accountIntent?.sessionReference,
    process.env,
  );
  const references = (() => {
    try {
      return planFoundryEdgeSupportStage(
        context,
        qualified,
        environment,
        "process",
        "repair_preflight",
        ["--input", candidate, "--out-dir", referenceDir],
        true,
        receiptFile,
        candidateFact,
      );
    } finally {
      delete environment.TIANGONG_LCA_ACCESS_TOKEN;
    }
  })();
  if (references.exit_code !== 0 || !references.referenceDocuments)
    throw invalid("Every exact repair dependency must be independently readable.");
  const referenceReport = references.report.files.report;
  if (typeof referenceReport !== "string") throw invalid("Repair dependency evidence is missing.");
  const documents = path.join(directory, "validation-references.json");
  let validationReferences = references.referenceDocuments;
  if (files.scientific) {
    const input = JSON.parse(
      readFoundryInput(context, files.scientific.worker_input.path, 64 * 1024 * 1024).toString(
        "utf8",
      ),
    );
    const frozen = workflowObject(input.baseline).documents;
    if (!Array.isArray(frozen))
      throw invalid(
        "Scientific repair requires its complete census-verified native source inventory.",
      );
    const additional = frozen
      .map(workflowObject)
      .filter((entry) =>
        ["flow", "flowproperty", "unitgroup"].includes(
          String(workflowObject(entry.identity).dataset_type),
        ),
      )
      .map((entry) => entry.document);
    const byIdentity = new Map<string, unknown>();
    for (const row of [...validationReferences, ...additional]) {
      const type = detectDatasetType(row);
      if (!type || !["flow", "flowproperty", "unitgroup"].includes(type))
        throw invalid(
          "Scientific QA references must be exact Flow, FlowProperty or UnitGroup bodies.",
        );
      const identity = datasetIdentity(row, 0, type);
      const key = `${type}:${identity.id}@${identity.version}`;
      const prior = byIdentity.get(key);
      if (prior && sha256Json(prior) !== sha256Json(identity.payload))
        throw invalid("Scientific QA references contain competing exact source bodies.");
      byIdentity.set(key, identity.payload);
    }
    validationReferences = [...byIdentity.values()];
  }
  save(documents, validationReferences);
  const validate = (file: string, directory: string) => {
    const validation = runFoundryTypedDatasetQa(
      context,
      qualified,
      temporary,
      save,
      "process",
      file,
      directory,
      {
        referenceFiles: [documents],
        readRowsFile: (file) =>
          file === documents
            ? fs.readFileSync(documents, "utf8")
            : readFoundryInput(context, file).toString("utf8"),
      },
    );
    return JSON.parse(fs.readFileSync(validation.validationReportFile, "utf8"));
  };
  const complete = validate(candidate, path.join(directory, "validation"));
  const ruleVerification = readEdgeRepairValidation(complete, expectation);
  if (files.scientific && Object.values(ruleVerification).some((passed) => !passed))
    throw invalid(
      "Scientific repair requires every candidate validation layer to pass before authorization.",
    );
  const requiresBeforeValidation = Object.values(ruleVerification).includes(false);
  let scientificGates: Record<string, unknown> | null = null;
  if (files.scientific) {
    const cleanupDirectory = path.join(directory, "cleanup");
    const cleanup = runDatasetCurationCleanup({
      repoRoot: context.assetRoot,
      options: { type: "process", rowsFile: candidate, outDir: cleanupDirectory },
    });
    const cleanedFile = cleanup.cleaned_rows_file;
    if (cleanup.status !== "completed" || typeof cleanedFile !== "string")
      throw invalid("Scientific repair cleanup must complete before validation and curation.");
    if (sha256Json(readRows(candidate)) !== sha256Json(readRows(cleanedFile)))
      throw invalid(
        "Cleanup changed the selected scientific candidate. Review and register that complete candidate as a new immutable repair scope.",
      );
    const schemaRows = path.join(directory, "schema-validation-rows.jsonl");
    const projected = projectFoundryValidationReferences(readRows(candidate), validationReferences);
    writeFoundryArtifact(
      context,
      schemaRows,
      projected.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const schema = runTidasRowsValidation({
      repoRoot: context.assetRoot,
      options: {
        type: "process",
        rowsFile: schemaRows,
        outDir: path.join(directory, "schema"),
        tidasBin: qualified.tidas.executable_path,
      },
      environment: createFoundryIsolatedChildEnvironment({
        tempRoot: path.join(temporary, "science-schema-runtime"),
      }),
    });
    if (typeof schema.report_file !== "string")
      throw invalid("Scientific repair requires the qualified native schema report.");
    const gateDirectory = path.join(directory, "curation");
    const gate = runDatasetCurationGate({
      repoRoot: context.assetRoot,
      cliValidation: {
        report: path.join(directory, "validation", "outputs", "validation-report.json"),
        exit: 0,
      },
      options: {
        type: "process",
        rowsFile: candidate,
        schemaReport: schema.report_file,
        qaReport: path.join(directory, "validation", "process-qa-report.json"),
        cleanupReport: path.join(cleanupDirectory, "dataset-curation-cleanup-report.json"),
        outDir: gateDirectory,
        profile: "generic",
        includeExecutionCommands: false,
      },
    });
    if (gate.status !== "ready")
      throw invalid(
        "Scientific repair requires the exact candidate to pass the existing Foundry curation gate without unresolved authoring or cleanup findings.",
      );
    scientificGates = {
      schema: captureFoundryInput(schema.report_file),
      schema_projection: captureFoundryInput(schemaRows),
      cleanup: captureFoundryInput(
        path.join(cleanupDirectory, "dataset-curation-cleanup-report.json"),
      ),
      curation: captureFoundryInput(path.join(gateDirectory, "dataset-curation-gate-report.json")),
    };
  }
  const beforeEvidence = requiresBeforeValidation
    ? validate(before, path.join(directory, "before-validation"))
    : null;
  if (beforeEvidence) {
    const beforeRules = readEdgeRepairValidation(beforeEvidence, {
      ...expectation,
      actions: expectation.actions.map((action) => ({
        ...action,
        desired_sha256: action.before_sha256,
      })),
    });
    if (
      expectation.actions.some(
        (action) => !ruleVerification[action.desired_sha256] && beforeRules[action.before_sha256],
      )
    )
      throw invalid(
        "The unknown annual-volume gap must already exist in the selected before draft.",
      );
  }
  const read = (fact: FoundryInputFact) =>
    readRows(fact.path, (file) => readFoundryInput(context, file).toString("utf8"));
  const candidateRows = read(candidateFact);
  const beforeFact = captureFoundryInput(before);
  const target = { project_ref: expectation.project_ref, user_id: expectation.owner_user_id };
  const plan = buildEdgeSupportPlan("process", candidateFact, target, candidateRows, {
    fact: captureFoundryInput(referenceReport),
    report: references.report,
  });
  const beforePlan = buildEdgeSupportPlan("process", beforeFact, target, read(beforeFact));
  const expected = new Map(expectation.actions.map((item) => [`${item.id}@${item.version}`, item]));
  const roots = plan.roots.map((root) => {
    const prior = beforePlan.roots.find(
      (item) => item.id === root.id && item.version === root.version,
    );
    const action = expected.get(`${root.id}@${root.version}`);
    if (
      !prior ||
      !action ||
      prior.payload_sha256 !== action.before_sha256 ||
      root.payload_sha256 !== action.desired_sha256
    )
      throw invalid("Guarded update roots must match the exact reviewed contract.");
    return { ...root, payload_sha256: prior.payload_sha256 };
  });
  // The repair scope has already bound every exact reference occurrence in both documents.
  // An older visible dependency can be retained with the same content, owner and state.
  const checked = await verifyFoundryEdgeSupport(actor, { ...plan, roots }, "after", true);
  save(path.join(directory, "edge-before.json"), checked.responses);
  if (checked.blockers.length)
    throw invalid("Current draft or a dependency differs from the exact before snapshot.");
  const report = {
    schema: "tiangong-foundry.edge-repair-preflight.v1",
    input_path: candidate,
    before: beforeFact,
    contract_sha256: expectation.contract_sha256,
    validation_sha256: sha256Json(complete),
    before_validation_sha256: beforeEvidence ? sha256Json(beforeEvidence) : null,
    rule_verification: ruleVerification,
    reference_evidence: captureFoundryInput(referenceReport),
    remote_before_sha256: sha256Json(checked.responses),
    ...(scientificGates ? { scientific_gates: scientificGates } : {}),
  };
  save(path.join(directory, "owner-report.json"), report);
  return report;
}
