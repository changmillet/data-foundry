import fs from "node:fs";
import path from "node:path";
import {
  executionContract,
  independentAudit,
  makePaths,
  topologyCommandHelp,
  validateAdmission,
} from "./admission-and-audit.ts";
import { loadClassifications, loadGermanSynonyms, loadMappings } from "./exchange-and-overlay.ts";
import {
  reconcileFlowsAndDeleteCandidates,
  reconcileProcessesAndAlgebra,
} from "./stage-compose.ts";
import {
  ConversionEventWriter,
  EVENT_SCHEMA,
  JsonlWriter,
  MANIFEST_SCHEMA,
  REPORT_SCHEMA,
  REQUEST_SCHEMA,
  SAVE_DRAFT_CONTRACT_SCHEMA,
  artifactFacts,
  assertSchema,
  buildSnapshotIndex,
  closeSnapshotIndex,
  compareText,
  createSchemaRuntime,
  entityKey,
  readCandidateIndex,
  resolveFreshOutput,
  resolveInside,
  sha256Json,
  verifyArtifactRef,
  writeJson,
  type ActionRow,
  type AdmissionReceipt,
  type ComposeOptions,
  type JsonObject,
  type TopologyRequest,
  type VerifiedArtifact,
} from "./types-and-io.ts";

/** Creates the topology convergence compose runner backed by modular stage helpers. */
export function createTopologyConvergenceRunner({ repoRoot }: { repoRoot: string }) {
  async function runDatasetTopologyConvergenceCompose(options: ComposeOptions = {}) {
    if (options.help) return topologyCommandHelp();
    const runtime = createSchemaRuntime(repoRoot);
    const requestPath = resolveInside(repoRoot, options.request, "--request");
    const outDir = resolveFreshOutput(repoRoot, options.outDir);
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8")) as TopologyRequest;
    assertSchema(runtime.request, request, "topology convergence request");
    const candidatePackagePath = resolveInside(
      repoRoot,
      request.candidate_package.path,
      "candidate_package.path",
    );
    const candidatePackageFacts = artifactFacts(candidatePackagePath, 1, "candidate-package");
    if (
      candidatePackageFacts.sha256 !== request.candidate_package.sha256 ||
      candidatePackageFacts.bytes !== request.candidate_package.bytes
    ) {
      throw new Error("Candidate package SHA-256 or byte binding mismatch.");
    }

    const refs = Object.fromEntries(
      Object.entries(request.input_artifacts).map(([name, ref]) => [
        name,
        verifyArtifactRef(repoRoot, ref, name, name === "admission_receipt"),
      ]),
    ) as Record<string, VerifiedArtifact>;
    const receipt = JSON.parse(
      fs.readFileSync(refs.admission_receipt.filePath, "utf8"),
    ) as AdmissionReceipt;
    assertSchema(runtime.admissionReceipt, receipt, "fresh admission receipt");
    validateAdmission(receipt, request, refs);

    const candidateFlows = readCandidateIndex(
      repoRoot,
      refs.candidate_flows,
      "flows",
      runtime.candidateIndexRow,
    );
    const candidateProcesses = readCandidateIndex(
      repoRoot,
      refs.candidate_processes,
      "processes",
      runtime.candidateIndexRow,
    );
    const classifications = loadClassifications(
      refs.target_classifications,
      runtime.classificationRow,
    );
    const german = loadGermanSynonyms(refs.german_synonyms);
    const mappings = loadMappings(refs.flow_mappings);
    const ownerFlows = buildSnapshotIndex(refs.owner_flows, "flows", "owner", request);
    const publicFlows = buildSnapshotIndex(refs.public_flows, "flows", "public", request);
    const foreignFlows = buildSnapshotIndex(refs.foreign_flows, "flows", "foreign", request);
    const ownerProcesses = buildSnapshotIndex(refs.owner_processes, "processes", "owner", request);

    fs.mkdirSync(outDir, { recursive: false, mode: 0o700 });
    fs.chmodSync(outDir, 0o700);
    const paths = makePaths(outDir);
    writeJson(paths.request, request);
    const writers = {
      events: new ConversionEventWriter(paths.events),
      flowCreate: new JsonlWriter(paths.flowCreate),
      flowNoWrite: new JsonlWriter(paths.flowNoWrite),
      processInput: new JsonlWriter(paths.processInput),
      processNoWrite: new JsonlWriter(paths.processNoWrite),
      deleteCandidates: new JsonlWriter(paths.deleteCandidates),
      protectedNoWrite: new JsonlWriter(paths.protectedNoWrite),
      holds: new JsonlWriter(paths.holds),
      ambiguity: new JsonlWriter(paths.ambiguity),
    };
    const flowActions: ActionRow[] = [];
    const processActions: ActionRow[] = [];
    const targetFlowKeys = new Set(candidateFlows.map((row) => entityKey(row.entity)));
    const targetFlowIds = new Set(candidateFlows.map((row) => row.entity.id));
    const findings: JsonObject[] = [];
    const counts: Record<string, number> = {
      candidate_flows: candidateFlows.length,
      flow_create: 0,
      flow_owner_no_write: 0,
      flow_public_reuse: 0,
      flow_hold: 0,
      obsolete_flow_delete_candidates: 0,
      processes: candidateProcesses.length,
      exchanges: 0,
      flow_reference_changes: 0,
      exchange_add: 0,
      exchange_delete: 0,
      direction_changes: 0,
      amount_changes: 0,
      german_synonyms: german.size,
      chinese_descriptions: 0,
      process_update: 0,
      process_insert: 0,
      process_no_write: 0,
      process_hold: 0,
      protected_no_write: 0,
      conversion_events: 0,
      machine_translation: 0,
      public_foreign_mutations: 0,
    };

    try {
      reconcileFlowsAndDeleteCandidates({
        request,
        candidateFlows,
        classifications,
        ownerFlows,
        publicFlows,
        foreignFlows,
        writers,
        flowActions,
        targetFlowKeys,
        findings,
        counts,
      });
      const { processFlowEdges, exactChecks } = reconcileProcessesAndAlgebra({
        request,
        candidateProcesses,
        ownerProcesses,
        german,
        mappings,
        protectedNoWriteRef: refs.protected_no_write,
        targetFlowKeys,
        targetFlowIds,
        writers,
        processActions,
        findings,
        counts,
      });
      for (const [name, passed] of Object.entries(exactChecks)) {
        if (!passed)
          findings.push({ severity: "P1", code: `ALGEBRA_${name.toUpperCase()}_FAILED` });
      }
      const algebra = { ...exactChecks, passed: Object.values(exactChecks).every(Boolean) };
      const p0 = findings.filter((finding) => finding.severity === "P0").length;
      const p1 = findings.filter((finding) => finding.severity === "P1").length;
      const status = p0 === 0 && p1 === 0 ? "ready_for_admission" : "rejected";

      for (const writer of Object.values(writers)) writer.close();
      writeJson(paths.dependencies, {
        schema_version: "foundry-topology-dependency-closure.v1",
        phase_order: ["F", "P", "D"],
        candidate_flow_identities: [...targetFlowKeys].sort(compareText),
        flow_create_action_ids: flowActions.map((action) => action.action_id),
        process_reference_edges: processFlowEdges,
        delete_barrier: "all-visible-process inbound_ref_count must equal zero after P",
      });
      if (status === "ready_for_admission" && flowActions.length) {
        writeJson(paths.flowContract, executionContract(request, "F", flowActions));
      }
      if (status === "ready_for_admission" && processActions.length) {
        writeJson(paths.processContract, executionContract(request, "P", processActions));
      }

      writeJson(paths.report, {
        schema_version: REPORT_SCHEMA,
        status,
        production_authority: false,
        campaign_id: request.campaign_id,
        counts,
        findings,
        algebra,
        execution_order: ["F", "P", "D"],
        delete_gate: "Fresh all-visible-process zero-inbound proof is required after P.",
        next_gate:
          "Independent review and execution-capsule admission of this exact package are required before the separately authorized fixed CLI may dispatch owner-session DML.",
        remote_write_mode: "read-only",
        dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
      });

      const artifacts = [
        artifactFacts(paths.request, 1, REQUEST_SCHEMA),
        writers.events.facts(EVENT_SCHEMA),
        writers.flowCreate.facts("tidas-flow-payload-jsonl.v1"),
        writers.flowNoWrite.facts("foundry-topology-flow-no-write.v1"),
        writers.processInput.facts("tidas-process-payload-jsonl.v1"),
        writers.processNoWrite.facts("foundry-topology-process-no-write.v1"),
        writers.deleteCandidates.facts("foundry-topology-flow-delete-candidate.v1"),
        writers.protectedNoWrite.facts("foundry-topology-protected-no-write.v1"),
        writers.holds.facts("foundry-topology-hold.v1"),
        writers.ambiguity.facts("foundry-topology-ambiguity-recovery.v1"),
        artifactFacts(
          paths.dependencies,
          processFlowEdges.length,
          "foundry-topology-dependency-closure.v1",
        ),
        ...(fs.existsSync(paths.flowContract)
          ? [artifactFacts(paths.flowContract, flowActions.length, SAVE_DRAFT_CONTRACT_SCHEMA)]
          : []),
        ...(fs.existsSync(paths.processContract)
          ? [
              artifactFacts(
                paths.processContract,
                processActions.length,
                SAVE_DRAFT_CONTRACT_SCHEMA,
              ),
            ]
          : []),
        artifactFacts(paths.report, 1, REPORT_SCHEMA),
      ];
      writeJson(paths.auditInput, {
        schema_version: "foundry-topology-independent-audit-input.v1",
        campaign_id: request.campaign_id,
        expected: request.expected,
        counts,
        p0,
        p1,
        findings,
        algebra,
        artifact_facts: artifacts,
        event_terminal_sha256: writers.events.previous,
      });
      artifacts.push(
        artifactFacts(paths.auditInput, 1, "foundry-topology-independent-audit-input.v1"),
      );
      const audit = independentAudit(artifacts, paths.events, algebra, p0, p1);
      writeJson(paths.audit, audit);
      artifacts.push(artifactFacts(paths.audit, 1, "foundry-topology-independent-audit.v1"));
      writeJson(paths.manifest, {
        schema_version: MANIFEST_SCHEMA,
        status,
        production_authority: false,
        campaign_id: request.campaign_id,
        candidate_package: request.candidate_package,
        cli_fingerprint: request.cli_fingerprint,
        input_artifacts: Object.fromEntries(
          Object.entries(request.input_artifacts).map(([name, ref]) => [name, ref]),
        ),
        output_artifacts: artifacts,
        output_binding_sha256: sha256Json(artifacts),
        counts,
        p0,
        p1,
        independent_audit: audit.status,
      });
      const manifestFacts = artifactFacts(paths.manifest, 1, MANIFEST_SCHEMA);
      return {
        status,
        production_authority: false,
        out_dir: path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep),
        counts,
        p0,
        p1,
        independent_audit: audit.status,
        manifest: manifestFacts,
        remote_write_mode: "read-only",
        dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
      };
    } finally {
      for (const writer of Object.values(writers)) writer.close();
      closeSnapshotIndex(ownerFlows);
      closeSnapshotIndex(publicFlows);
      closeSnapshotIndex(foreignFlows);
      closeSnapshotIndex(ownerProcesses);
    }
  }

  return { runDatasetTopologyConvergenceCompose };
}
