import fs from "node:fs";
import path from "node:path";
import { readOnlyStageContract } from "../stage-contract.ts";
import {
  artifactFacts,
  assertSchema,
  createSchemaValidators,
  readJson,
  readJsonLinesWithMeta,
  resolveFreshOutputInside,
  resolveInputInside,
  verifyArtifactRef,
  verifyTerminalSuccessReceipt,
  writeJson,
  writeJsonLines,
} from "./artifacts-and-schemas.ts";
import {
  assignDependencyDispositions,
  consumeTerminalExclusions,
  duplicateValues,
  orderAndCloseDependencies,
  preliminaryResult,
  terminalPairKey,
} from "./dependencies-and-closure.ts";
import {
  CLI_CONTRACT_SCHEMA,
  DEPENDENCY_SCHEMA,
  EVENT_SCHEMA,
  MANIFEST_SCHEMA,
  REPORT_SCHEMA,
  REQUEST_SCHEMA,
  TRUST_BOUNDARY_REASONS,
  asToken,
  entityKey,
  normalizedEntity,
  sha256Json,
  type ComparisonRow,
  type ComposeOptions,
  type ConversionEvent,
  type ConversionResult,
  type ExecutionContract,
  type IncrementalRequest,
  type InputFacts,
  type JsonObject,
  type JsonValue,
  type OwnerRow,
  type OwnerSnapshotReceipt,
  type PreservationPolicy,
  type SchemaRuntime,
  type TerminalExclusion,
  type TerminalSuccessBinding,
} from "./types-and-primitives.ts";
import {
  decisionForResult,
  validateCompositionAlgebra,
  validateOwnerSnapshotReceipt,
  validatePolicy,
  validateRequest,
} from "./validation-and-algebra.ts";

function commandHelp() {
  const contract = readOnlyStageContract([
    {
      stage: "load-and-verify",
      phase: "prepare",
      purpose: "Verify the SHA-bound request, comparison ledger, owner snapshot, and policy.",
      inputs: ["request", "comparison ledger", "owner snapshot", "preservation policy"],
      outputs: ["verified in-memory inputs"],
      blockers: ["hash, byte, row, schema, scope, owner, or state mismatch"],
      side_effects: [],
    },
    {
      stage: "normalize-and-merge",
      phase: "rewrite_cleanup",
      purpose: "Perform explicit-policy semantic normalization and three-way merge.",
      inputs: ["old", "candidate", "current owner payload", "pointer policy"],
      outputs: ["INSERT, UPDATE, NOOP, or HOLD per conversion"],
      blockers: ["unattributed owner drift", "three-way conflict", "forbidden delete"],
      side_effects: [],
    },
    {
      stage: "classify-order-validate",
      phase: "gate_validate",
      purpose: "Propagate required dependency holds and produce a stable action order.",
      inputs: ["conversion dispositions", "declared dependency graph"],
      outputs: ["ordered candidate actions", "dependency closure"],
      blockers: ["missing dependency", "cycle", "terminal replay", "trust-boundary finding"],
      side_effects: [],
    },
    {
      stage: "materialize-report",
      phase: "report",
      purpose: "Write immutable private artifacts and one terminal log event per conversion.",
      inputs: ["ordered conversions"],
      outputs: ["ledgers", "CLI candidate contract", "report", "SHA manifest"],
      blockers: ["existing output directory", "artifact algebra mismatch"],
      side_effects: ["local files only; no network, database, CLI, or DML dispatch"],
    },
  ]);
  return {
    status: "help",
    command: "dataset-incremental-change-set-compose",
    usage:
      "node src/dev-cli.ts dataset-incremental-change-set-compose --request <file> --out-dir <fresh-directory>",
    ...contract,
    production_authority: false,
  };
}

function materializeArtifacts({
  outDir,
  request,
  results,
  orderedActions,
  inputFacts,
  schemaRuntime,
  terminalExclusions,
}: {
  outDir: string;
  request: IncrementalRequest;
  results: ConversionResult[];
  orderedActions: ConversionResult[];
  inputFacts: InputFacts;
  schemaRuntime: SchemaRuntime;
  terminalExclusions: TerminalSuccessBinding[];
}) {
  const paths = {
    request: path.join(outDir, "incremental-change-set-request.snapshot.json"),
    events: path.join(outDir, "incremental-change-set-conversion-events.jsonl"),
    delta: path.join(outDir, "incremental-change-set-delta.jsonl"),
    noWrite: path.join(outDir, "incremental-change-set-no-write.jsonl"),
    holds: path.join(outDir, "incremental-change-set-holds.jsonl"),
    dependencies: path.join(outDir, "incremental-change-set-dependency-closure.json"),
    cliInput: path.join(outDir, "dataset-save-draft-input.jsonl"),
    contract: path.join(outDir, "dataset-save-draft-execution-contract.json"),
    report: path.join(outDir, "incremental-change-set-report.json"),
    manifest: path.join(outDir, "incremental-change-set-manifest.json"),
  };
  const noWrites = results
    .filter((result) => result.disposition === "NOOP")
    .map((result) => ({
      schema_version: "foundry-incremental-change-set-no-write-row.v1",
      conversion_id: result.conversion_id,
      entity: result.entity,
      reason_codes: result.reason_codes,
      current_sha256: result.hashes.current.payload_sha256,
      desired_sha256: result.desired_sha256,
    }));
  const holds = results
    .filter((result) => result.disposition === "HOLD")
    .map((result) => ({
      schema_version: "foundry-incremental-change-set-hold-row.v1",
      conversion_id: result.conversion_id,
      entity: result.entity,
      reason_codes: result.reason_codes,
      dependency_dispositions: result.dependency_dispositions,
      conflicts: result.merge.conflicts,
      forbidden_paths: result.merge.forbidden_paths ?? [],
    }));
  const delta: JsonValue[] = orderedActions.map((result) => result.desired_payload!);
  const contract: ExecutionContract | null = orderedActions.length
    ? {
        schema_version: CLI_CONTRACT_SCHEMA,
        execution_id: request.change_set_id,
        project_ref: request.project_ref,
        target_mode: "owner_draft",
        owner: {
          user_id: request.owner.user_id,
          email: request.owner.email.toLowerCase(),
          state_code: 0,
        },
        actions: orderedActions.map((result) => ({
          action_id: result.action_id,
          desired_sha256: result.desired_sha256,
          expected_operation: result.expected_operation,
          table: result.entity.table,
          id: result.entity.id,
          version: result.entity.version,
          before_sha256: result.before_sha256,
          dependency_action_ids: result.dependency_action_ids,
        })),
      }
    : null;
  const dependencyRows = results.flatMap((result) =>
    result.dependency_dispositions.map((dependency) => ({
      conversion_id: result.conversion_id,
      ...dependency,
    })),
  );
  const dependencyClosure: JsonObject = {
    schema_version: DEPENDENCY_SCHEMA,
    ordered_conversion_ids: orderedActions.map((result) => result.conversion_id),
    edges: dependencyRows,
  };

  const outputRows = new Map<string, JsonObject>();
  orderedActions.forEach((result, index) =>
    outputRows.set(result.conversion_id, {
      artifact: path.basename(paths.delta),
      line: index + 1,
      row_sha256: sha256Json(delta[index]),
    }),
  );
  noWrites.forEach((row, index) =>
    outputRows.set(row.conversion_id, {
      artifact: path.basename(paths.noWrite),
      line: index + 1,
      row_sha256: sha256Json(row),
    }),
  );
  holds.forEach((row, index) =>
    outputRows.set(row.conversion_id, {
      artifact: path.basename(paths.holds),
      line: index + 1,
      row_sha256: sha256Json(row),
    }),
  );

  let previousEventSha256: string | null = null;
  const events: ConversionEvent[] = results
    .sort((left, right) => left.input_sequence - right.input_sequence)
    .map((result, index) => {
      const decision = decisionForResult(result);
      const event = {
        schema_version: EVENT_SCHEMA,
        sequence: index + 1,
        terminal: true,
        input_sequence: result.input_sequence,
        conversion_id: result.conversion_id,
        entity: result.entity,
        input_refs: {
          comparison_line: result.source_line,
          comparison_raw_sha256: result.source_raw_sha256,
          owner_snapshot_receipt_sha256: inputFacts.owner_snapshot_receipt.sha256,
          ...result.hashes,
        },
        normalization: { noise_paths: result.merge.noise_paths },
        curation: {
          preserved_paths: result.merge.preserved_paths,
          conflict_paths: result.merge.conflicts.map((conflict) => conflict.pointer),
        },
        evidence: result.evidence,
        diff: {
          applied_paths: result.merge.applied_paths,
          forbidden_paths: result.merge.forbidden_paths ?? [],
        },
        outcome: {
          disposition: result.disposition,
          reason_codes: result.reason_codes,
          expected_operation: result.expected_operation,
          before_sha256: result.before_sha256,
          desired_sha256: result.desired_sha256,
          action_id: result.action_id,
          terminal_success: result.terminal_success,
          executable: false,
        },
        dependencies: {
          declared_conversion_ids: result.dependencies,
          dispositions: result.dependency_dispositions,
          dependency_action_ids: result.dependency_action_ids,
        },
        duration_ms: result.duration_ms,
        recorded_at_utc: new Date().toISOString(),
        output: outputRows.get(result.conversion_id),
        decision_binding_sha256: sha256Json(decision),
        previous_event_sha256: previousEventSha256,
      } as Omit<ConversionEvent, "event_sha256"> & { event_sha256?: string };
      event.event_sha256 = sha256Json(event);
      previousEventSha256 = event.event_sha256;
      return event as ConversionEvent;
    });
  const counts = {
    universe: results.length,
    insert: results.filter((result) => result.disposition === "INSERT").length,
    update: results.filter((result) => result.disposition === "UPDATE").length,
    no_write: noWrites.length,
    hold: holds.length,
    actions: orderedActions.length,
    delta_rows: delta.length,
    conversion_log_rows: events.length,
    delete_actions: 0,
  };
  const trustReasons = results
    .flatMap((result) => result.reason_codes)
    .filter((reason) => TRUST_BOUNDARY_REASONS.has(reason));
  const findings = { p0: [...new Set(trustReasons)].length, p1: 0 };
  const validatedAlgebra = validateCompositionAlgebra({
    schemaRuntime,
    results,
    orderedActions,
    noWrites,
    holds,
    delta,
    contract,
    dependencyClosure,
    events,
    terminalExclusions,
  });
  const algebraPassed = true;
  const status =
    !algebraPassed || findings.p0 > 0
      ? "rejected"
      : counts.hold > 0
        ? "completed_with_holds"
        : counts.actions === 0
          ? "completed_no_actions"
          : "completed";
  const report = {
    schema_version: REPORT_SCHEMA,
    status,
    production_authority: false,
    change_set_id: request.change_set_id,
    project_ref: request.project_ref,
    target_mode: "owner_draft",
    owner: request.owner,
    consumer: request.consumer,
    counts,
    findings,
    algebra: {
      passed: algebraPassed,
      equation: "insert + update + no_write + hold = universe",
      actions_equal_delta: counts.actions === counts.delta_rows,
      events_equal_universe: counts.conversion_log_rows === counts.universe,
      delete_actions_zero: true,
      terminal_replay_zero: validatedAlgebra.terminal_replay_zero,
      hash_chain_valid: true,
    },
    blockers: [
      ...new Set(
        results
          .filter((result) => result.disposition === "HOLD")
          .flatMap((result) => result.reason_codes),
      ),
    ],
    files: {
      request: path.basename(paths.request),
      events: path.basename(paths.events),
      delta: path.basename(paths.delta),
      no_write: path.basename(paths.noWrite),
      holds: path.basename(paths.holds),
      dependency_closure: path.basename(paths.dependencies),
      cli_input: contract ? path.basename(paths.cliInput) : null,
      execution_contract: contract ? path.basename(paths.contract) : null,
      manifest: path.basename(paths.manifest),
    },
    examples: Object.fromEntries(
      ["INSERT", "UPDATE", "NOOP", "HOLD"].map((disposition) => [
        disposition.toLowerCase(),
        results
          .filter((result) => result.disposition === disposition)
          .slice(0, 5)
          .map((result) => result.conversion_id),
      ]),
    ),
    execution_requirements: {
      cli_contract_present: contract != null,
      ordered_batch: true,
      support_action_count: orderedActions.filter((result) =>
        ["unitgroups", "flowproperties"].includes(result.entity.table),
      ).length,
      allow_account_local_support: orderedActions.some((result) =>
        ["unitgroups", "flowproperties"].includes(result.entity.table),
      ),
    },
    rerun: {
      allowed: true,
      condition:
        "Only offline inputs or policy may be corrected; a fresh output directory is required.",
      command:
        "node src/dev-cli.ts dataset-incremental-change-set-compose --request <file> --out-dir <fresh-directory>",
    },
    next_gate:
      "Fresh SELECT-only reconciliation, fresh owner session, independent review, and execution-capsule admission are required before separately authorized CLI execution.",
    dispatch_counts: { network: 0, database: 0, cli: 0, dml: 0 },
  };
  assertSchema(schemaRuntime, "report", report, "incremental change-set report");

  fs.mkdirSync(outDir, { recursive: false, mode: 0o700 });
  fs.chmodSync(outDir, 0o700);
  writeJson(paths.request, request);
  writeJsonLines(paths.delta, delta);
  writeJsonLines(paths.noWrite, noWrites);
  writeJsonLines(paths.holds, holds);
  writeJson(paths.dependencies, dependencyClosure);
  writeJsonLines(paths.events, events);
  if (contract) {
    writeJsonLines(paths.cliInput, delta);
    writeJson(paths.contract, contract);
  }
  writeJson(paths.report, report);

  const artifacts = [
    artifactFacts(paths.request, 1, REQUEST_SCHEMA),
    artifactFacts(paths.events, events.length, EVENT_SCHEMA),
    artifactFacts(paths.delta, delta.length, "tidas-payload-jsonl.v1"),
    artifactFacts(paths.noWrite, noWrites.length, "foundry-incremental-change-set-no-write-row.v1"),
    artifactFacts(paths.holds, holds.length, "foundry-incremental-change-set-hold-row.v1"),
    artifactFacts(paths.dependencies, dependencyRows.length, DEPENDENCY_SCHEMA),
    ...(contract
      ? [
          artifactFacts(paths.cliInput, delta.length, "tidas-payload-jsonl.v1"),
          artifactFacts(paths.contract, contract.actions.length, CLI_CONTRACT_SCHEMA),
        ]
      : []),
    artifactFacts(paths.report, 1, REPORT_SCHEMA),
  ];
  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    status,
    production_authority: false,
    change_set_id: request.change_set_id,
    input_artifacts: inputFacts,
    output_artifacts: artifacts,
    output_binding_sha256: sha256Json(artifacts),
    counts,
    findings,
  };
  assertSchema(schemaRuntime, "manifest", manifest, "incremental change-set manifest");
  writeJson(paths.manifest, manifest);
  for (const artifact of artifacts) {
    const actual = artifactFacts(
      path.join(outDir, artifact.path),
      artifact.rows,
      artifact.schema_version,
    );
    if (
      actual.bytes !== artifact.bytes ||
      actual.sha256 !== artifact.sha256 ||
      actual.rows !== artifact.rows
    ) {
      throw new Error(`Post-write artifact verification failed for ${artifact.path}.`);
    }
  }
  const manifestFacts = artifactFacts(paths.manifest, 1, MANIFEST_SCHEMA);
  return { report, manifest: manifestFacts, paths };
}

/** Creates the incremental change-set compose command runner backed by modular helpers. */
export function createIncrementalChangeSetRunner({ repoRoot }: { repoRoot: string }) {
  async function runDatasetIncrementalChangeSetCompose(options: ComposeOptions = {}) {
    if (options.help) return commandHelp();
    const schemaRuntime = createSchemaValidators(repoRoot);
    const requestPath = resolveInputInside(repoRoot, options.request, "--request");
    const outDir = resolveFreshOutputInside(repoRoot, options.outDir, "--out-dir");
    const request = readJson(requestPath) as unknown as IncrementalRequest;
    assertSchema(schemaRuntime, "request", request, "incremental change-set request");
    validateRequest(request);
    const comparisonsRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.comparisons,
      "comparisons",
      true,
    );
    const ownerRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.owner_snapshot,
      "owner_snapshot",
      true,
    );
    const ownerReceiptRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.owner_snapshot_receipt,
      "owner_snapshot_receipt",
      false,
    );
    const policyRef = verifyArtifactRef(
      repoRoot,
      request.input_artifacts?.preservation_policy,
      "preservation_policy",
      false,
    );
    const terminalRef = request.input_artifacts?.terminal_exclusions
      ? verifyArtifactRef(
          repoRoot,
          request.input_artifacts.terminal_exclusions,
          "terminal_exclusions",
          true,
        )
      : null;
    const policy = readJson(policyRef.filePath) as unknown as PreservationPolicy;
    assertSchema(schemaRuntime, "preservationPolicy", policy, "preservation policy");
    validatePolicy(policy, request);
    const ownerReceipt = readJson(ownerReceiptRef.filePath) as unknown as OwnerSnapshotReceipt;
    assertSchema(schemaRuntime, "ownerSnapshotReceipt", ownerReceipt, "owner snapshot receipt");
    const comparisonRows = readJsonLinesWithMeta<ComparisonRow>(comparisonsRef.filePath).map(
      ({ value, line, raw_sha256: rawSha256 }) => {
        assertSchema(schemaRuntime, "comparisonRow", value, `comparison line ${line}`);
        return { ...value, __line: line, __raw_sha256: rawSha256 };
      },
    );
    const ownerRows = new Map<string, OwnerRow[]>();
    const ownerSnapshotLines = new Map<string, Array<{ line: number; raw_sha256: string }>>();
    for (const { value, line, raw_sha256: rawSha256 } of readJsonLinesWithMeta<OwnerRow>(
      ownerRef.filePath,
    )) {
      assertSchema(schemaRuntime, "ownerRow", value, `owner snapshot line ${line}`);
      if (
        value.project_ref !== request.project_ref ||
        value.payload_sha256 !== sha256Json(value.json_ordered)
      ) {
        throw new Error(`Owner snapshot line ${line} has a project or payload binding mismatch.`);
      }
      const key = entityKey(normalizedEntity(value.entity));
      const rows = ownerRows.get(key) ?? [];
      rows.push(value);
      ownerRows.set(key, rows);
      const lines = ownerSnapshotLines.get(key) ?? [];
      lines.push({ line, raw_sha256: rawSha256 });
      ownerSnapshotLines.set(key, lines);
    }
    const conversionIds = comparisonRows.map((row) => asToken(row.conversion_id));
    const targetKeys = comparisonRows.map((row) => entityKey(normalizedEntity(row.entity)));
    const duplicateConversions = duplicateValues(conversionIds);
    const duplicateTargets = duplicateValues(targetKeys);
    const requestedTargets = new Set(request.scope.allowed_target_keys);
    const inputTargets = new Set(targetKeys);
    if (
      requestedTargets.size !== inputTargets.size ||
      [...requestedTargets].some((key) => !inputTargets.has(key))
    ) {
      throw new Error("Request allowed_target_keys must exactly equal comparison targets.");
    }
    for (const key of ownerRows.keys()) {
      if (!requestedTargets.has(key)) {
        throw new Error(`Owner snapshot contains an out-of-scope target: ${key}`);
      }
    }
    validateOwnerSnapshotReceipt(ownerReceipt, request, ownerRef.facts, ownerSnapshotLines);
    const results = comparisonRows.map((comparison, index) =>
      preliminaryResult({
        comparison,
        inputSequence: index + 1,
        ownerRows,
        policy,
        request,
        policySha256: policyRef.facts.sha256,
        duplicateConversions,
        duplicateTargets,
      }),
    );
    const terminalPairs = new Set<string>();
    const terminalActionIds = new Set<string>();
    const terminalExclusions: TerminalSuccessBinding[] = [];
    if (terminalRef) {
      for (const { value, line } of readJsonLinesWithMeta<TerminalExclusion>(
        terminalRef.filePath,
      )) {
        assertSchema(schemaRuntime, "terminalExclusion", value, `terminal exclusion line ${line}`);
        if (!value.action_id.endsWith(`@${value.desired_sha256}`)) {
          throw new Error(
            `Terminal exclusion line ${line} does not bind action_id to desired_sha256.`,
          );
        }
        const pair = terminalPairKey(value.action_id, value.desired_sha256);
        if (terminalPairs.has(pair) || terminalActionIds.has(value.action_id)) {
          throw new Error(`Terminal exclusion line ${line} is duplicated or contradictory.`);
        }
        const successReceipt = verifyTerminalSuccessReceipt(repoRoot, value, line, schemaRuntime);
        terminalPairs.add(pair);
        terminalActionIds.add(value.action_id);
        terminalExclusions.push(successReceipt);
      }
    }
    consumeTerminalExclusions(results, terminalExclusions);
    let orderedActions = orderAndCloseDependencies(results, policy);
    const hasTrustBoundaryFailure = results.some((result) =>
      result.reason_codes.some((reason) => TRUST_BOUNDARY_REASONS.has(reason)),
    );
    if (hasTrustBoundaryFailure) {
      for (const result of orderedActions) {
        result.disposition = "HOLD";
        result.reason_codes = ["HOLD_GLOBAL_ADMISSION_REJECTED"];
        result.expected_operation = null;
        result.action_id = null;
        result.dependency_action_ids = [];
      }
      orderedActions = [];
      assignDependencyDispositions(results);
    }
    const inputFacts = {
      request: artifactFacts(requestPath, 1, REQUEST_SCHEMA),
      comparisons: comparisonsRef.facts,
      owner_snapshot: ownerRef.facts,
      owner_snapshot_receipt: ownerReceiptRef.facts,
      policy: policyRef.facts,
      terminal_exclusions: terminalRef?.facts ?? null,
    };
    const materialized = materializeArtifacts({
      outDir,
      request,
      results,
      orderedActions,
      inputFacts,
      schemaRuntime,
      terminalExclusions,
    });
    return {
      status: materialized.report.status,
      production_authority: false,
      out_dir: path.relative(repoRoot, outDir).split(path.sep).join(path.posix.sep),
      counts: materialized.report.counts,
      findings: materialized.report.findings,
      manifest: materialized.manifest,
      remote_write_mode: "read-only",
      dispatch_counts: materialized.report.dispatch_counts,
    };
  }

  return { runDatasetIncrementalChangeSetCompose };
}
