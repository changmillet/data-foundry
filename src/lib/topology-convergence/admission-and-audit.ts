import path from "node:path";
import { readOnlyStageContract } from "../stage-contract.ts";
import { upsertLanguage } from "./exchange-and-overlay.ts";
import {
  ADMISSION_SCHEMA,
  SAVE_DRAFT_CONTRACT_SCHEMA,
  artifactFacts,
  asToken,
  jsonLines,
  sha256Json,
  stableJson,
  type ActionRow,
  type AdmissionReceipt,
  type ArtifactFacts,
  type Entity,
  type GermanSynonym,
  type JsonObject,
  type TopologyRequest,
  type VerifiedArtifact,
} from "./types-and-io.ts";

export function admissionRequestBinding(request: TopologyRequest): string {
  const { admission_receipt: ignored, ...inputArtifacts } = request.input_artifacts ?? {};
  void ignored;
  return sha256Json({
    schema_version: "foundry-topology-admission-request-binding.v1",
    campaign_id: request.campaign_id,
    production_authority: request.production_authority,
    candidate_package: request.candidate_package,
    scope: request.scope,
    input_artifacts: inputArtifacts,
    canonical_support: request.canonical_support,
    classification_policy: request.classification_policy,
    expected: request.expected,
    cli_fingerprint: request.cli_fingerprint,
  });
}

export function validateAdmission(
  receipt: AdmissionReceipt,
  request: TopologyRequest,
  refs: Record<string, VerifiedArtifact>,
): void {
  if (receipt?.schema_version !== ADMISSION_SCHEMA || !receipt?.select_only) {
    throw new Error("Admission receipt is not a fresh SELECT-only receipt.");
  }
  if (!receipt.fresh_owner_session || receipt.captured_at_utc == null) {
    throw new Error("Admission receipt does not bind a fresh owner session.");
  }
  if (stableJson(receipt.scope) !== stableJson(request.scope)) {
    throw new Error("Admission receipt scope does not match the request.");
  }
  if (receipt.candidate_package_sha256 !== request.candidate_package.sha256) {
    throw new Error("Admission receipt candidate package binding mismatch.");
  }
  if (receipt.request_binding_sha256 !== admissionRequestBinding(request)) {
    throw new Error("Admission receipt request binding mismatch.");
  }
  for (const [name, ref] of Object.entries(request.input_artifacts)) {
    if (name === "admission_receipt") continue;
    if (receipt.input_artifact_sha256?.[name] !== ref.sha256) {
      throw new Error(`Admission receipt does not bind ${name}.`);
    }
  }
  if (stableJson(receipt.cli_fingerprint) !== stableJson(request.cli_fingerprint)) {
    throw new Error("Admission receipt CLI fingerprint mismatch.");
  }
  for (const name of ["deployment", "rpc", "query"]) {
    if (!/^[a-f0-9]{64}$/u.test(receipt.fingerprints?.[name] ?? "")) {
      throw new Error(`Admission receipt ${name} fingerprint is missing.`);
    }
  }
  for (const name of ["queue", "fence", "residue", "p0", "p1"]) {
    if (receipt.guards?.[name] !== 0)
      throw new Error(`Admission receipt guard ${name} is not zero.`);
  }
  void refs;
}

export function executionContract(
  request: TopologyRequest,
  suffix: string,
  actions: ActionRow[],
): JsonObject {
  return {
    schema_version: SAVE_DRAFT_CONTRACT_SCHEMA,
    execution_id: `${request.campaign_id}-${suffix}`,
    project_ref: request.scope.project_ref,
    target_mode: "owner_draft",
    owner: {
      user_id: request.scope.user_id,
      email: request.scope.email.toLowerCase(),
      state_code: 0,
    },
    actions,
  };
}

export function actionId(entity: Entity, desiredSha: string): string {
  return `${entity.table}/${entity.id}@${entity.version}#topology@${desiredSha}`;
}

export function conversionActionId(
  entity: Entity,
  kind: string,
  key: { number: string; occurrence: number } | null,
  desiredSha: string | null,
): string {
  const exchange = key ? `#${key.number}:${key.occurrence}` : "";
  return `${entity.table}/${entity.id}@${entity.version}${exchange}#${kind}@${desiredSha ?? "absent"}`;
}

export function addProcessLanguage(payload: JsonObject, german: GermanSynonym | undefined): void {
  if (!german) return;
  const information = payload.processDataSet!.processInformation!.dataSetInformation!;
  information["common:synonyms"] = upsertLanguage(
    information["common:synonyms"],
    "de",
    german.value,
  );
}

export function makePaths(outDir: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      request: "topology-request.snapshot.json",
      events: "topology-conversion-events.jsonl",
      flowCreate: "flow-create-input.jsonl",
      flowNoWrite: "flow-no-write.jsonl",
      processInput: "process-save-draft-input.jsonl",
      processNoWrite: "process-no-write.jsonl",
      deleteCandidates: "flow-delete-candidates.jsonl",
      protectedNoWrite: "protected-no-write.jsonl",
      holds: "topology-holds.jsonl",
      ambiguity: "topology-ambiguity-recovery-registry.jsonl",
      dependencies: "topology-dependency-closure.json",
      flowContract: "flow-create-execution-contract.json",
      processContract: "process-execution-contract.json",
      auditInput: "topology-independent-audit-input.json",
      audit: "topology-independent-audit.json",
      report: "topology-report.json",
      manifest: "topology-manifest.json",
    }).map(([key, file]) => [key, path.join(outDir, file)]),
  );
}

function auditEventChain(filePath: string): {
  rows: number;
  terminal_event_sha256: string | null;
} {
  let previous: string | null = null;
  let rows = 0;
  for (const { value, line } of jsonLines(filePath)) {
    const recorded = asToken(value.event_sha256);
    const body = { ...value };
    delete body.event_sha256;
    if (body.previous_event_sha256 !== previous || sha256Json(body) !== recorded) {
      throw new Error(`Conversion event chain mismatch at line ${line}.`);
    }
    for (const field of [
      "action_id",
      "entity",
      "exchange_key",
      "mapping_kind",
      "reason",
      "before_sha",
      "desired_sha",
    ]) {
      if (!Object.hasOwn(value, field))
        throw new Error(`Conversion event line ${line} lacks ${field}.`);
    }
    previous = recorded;
    rows += 1;
  }
  return { rows, terminal_event_sha256: previous };
}

export function independentAudit(
  artifacts: ArtifactFacts[],
  eventPath: string,
  algebra: { passed: boolean } & Record<string, unknown>,
  p0: number,
  p1: number,
): Record<string, unknown> {
  for (const artifact of artifacts) {
    const actual = artifactFacts(
      path.join(path.dirname(eventPath), artifact.path),
      artifact.rows,
      artifact.schema_version,
    );
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Independent audit artifact drift: ${artifact.path}`);
    }
  }
  const chain = auditEventChain(eventPath);
  return {
    schema_version: "foundry-topology-independent-audit.v1",
    status: algebra.passed && p0 === 0 && p1 === 0 ? "PASS" : "FAIL",
    artifact_count: artifacts.length,
    conversion_event_chain: chain,
    algebra,
    remote_write_mode: "read-only",
    dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
  };
}

export function topologyCommandHelp(): unknown {
  return {
    status: "help",
    command: "dataset-topology-convergence-compose",
    usage:
      "node src/dev-cli.ts dataset-topology-convergence-compose --request <request.json> --out-dir <fresh-directory>",
    production_authority: false,
    ...readOnlyStageContract([
      {
        stage: "bind-inputs",
        phase: "prepare",
        purpose:
          "Verify the candidate, fresh owner census, classifications, languages, and CLI fingerprint.",
        inputs: ["SHA-bound request", "fresh SELECT-only admission receipt"],
        outputs: ["verified input bindings"],
        blockers: ["scope drift", "hash drift", "nonzero admission guard"],
      },
      {
        stage: "compose-topology",
        phase: "rewrite_cleanup",
        purpose:
          "Build F/P/D candidates with occurrence-aware exchanges and approved language preservation.",
        inputs: ["candidate topology", "owner rows", "audited classifications"],
        outputs: ["flow creates", "process saves", "zero-inbound delete candidates"],
        blockers: ["foreign target", "content conflict", "unresolved classification"],
      },
      {
        stage: "audit-algebra",
        phase: "gate_validate",
        purpose:
          "Check exact topology algebra, event chain, owner isolation, and support references.",
        inputs: ["composed artifacts", "expected counts"],
        outputs: ["independent audit"],
        blockers: ["count mismatch", "chain mismatch", "out-of-closure reference"],
      },
      {
        stage: "seal-package",
        phase: "report",
        purpose: "Write immutable content-addressed handoff artifacts without dispatching DML.",
        inputs: ["audited topology package"],
        outputs: ["report", "manifest", "separate F/P contracts"],
        blockers: ["P0/P1 finding"],
      },
    ]),
  };
}
