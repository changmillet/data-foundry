import path from "node:path";
import { bundleRowTypeOrder, bundleRowTypes, type BundleRowType } from "../bundle-row-types.ts";
import type {
  BundleSampleDependencies,
  BundleSelection,
  CanonicalSupportCache,
  DatasetIdentity,
  IdentityPreflightArtifacts,
  LooseRecord,
  SelectedBundle,
  SemanticSummary,
  SourceReferenceRow,
} from "./types.ts";
import type { buildProcessScopeLedger } from "./process-scope-ledger.ts";

/** Synthesizes downstream stage commands for materialized bundle row types. */
export function buildBundleSampleCommands({
  deps,
  outDir,
  profile,
  cliBin,
  rowFiles,
  classificationQueuePath,
  locationQueuePath,
  identityPreflightArtifacts,
}: {
  deps: Pick<BundleSampleDependencies, "resolveRepoPath" | "shellQuote">;
  outDir: string;
  profile: string;
  cliBin: string[];
  rowFiles: Partial<Record<BundleRowType | "support", string>>;
  classificationQueuePath: string;
  locationQueuePath: string;
  identityPreflightArtifacts: IdentityPreflightArtifacts;
}): Record<string, Record<string, unknown>> {
  const { resolveRepoPath, shellQuote } = deps;
  const cleanupRowsPath = (type: BundleRowType) =>
    path.join(outDir, "cleanup", type, `${bundleRowTypes[type].plural}.cleaned.jsonl`);
  const cleanupCommand = (
    type: BundleRowType | "support",
    inputFile = resolveRepoPath(rowFiles[type]),
  ) =>
    [
      "node",
      "src/dev-cli.ts",
      "dataset-curation-cleanup",
      "--type",
      type,
      "--rows-file",
      inputFile,
      "--out-dir",
      path.join(outDir, "cleanup", type),
    ]
      .map(shellQuote)
      .join(" ");
  const schemaValidateCommand = (
    type: BundleRowType,
    inputFile = resolveRepoPath(rowFiles[type]),
  ) =>
    [
      "node",
      "src/dev-cli.ts",
      "dataset-tidas-validate",
      "--rows-file",
      inputFile,
      "--type",
      type,
      "--out-dir",
      path.join(outDir, "validate", type),
    ]
      .map(shellQuote)
      .join(" ");
  const contextPackCommand = (type: BundleRowType) =>
    [
      ...cliBin,
      "dataset",
      "context-pack",
      "--type",
      type,
      "--profile",
      "ai-import",
      "--out-dir",
      path.join(outDir, "context", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" ");
  const qaReportPath = (type: BundleRowType) =>
    type === "flow"
      ? path.join(outDir, "qa", type, "flow_qa_report.json")
      : path.join(outDir, "qa", type, "process-qa-report.json");
  const qaCommand = (type: BundleRowType, inputFile = resolveRepoPath(rowFiles[type])) =>
    [
      ...cliBin,
      "qa",
      type,
      "--rows-file",
      inputFile,
      "--out-dir",
      path.join(outDir, "qa", type),
      "--json",
    ]
      .map(shellQuote)
      .join(" ");
  const curationGateCommand = (type: BundleRowType) =>
    [
      "node",
      "src/dev-cli.ts",
      "dataset-curation-gate",
      "--type",
      type,
      "--profile",
      profile,
      "--rows-file",
      resolveRepoPath(rowFiles[type]),
      "--schema-report",
      path.join(outDir, "validate", type, "outputs", "validation-report.json"),
      "--qa-report",
      qaReportPath(type),
      "--schema-file",
      path.join(outDir, "context", type, "outputs", "schema.json"),
      "--yaml-file",
      path.join(outDir, "context", type, "outputs", "methodology.yaml"),
      "--ruleset-file",
      path.join(outDir, "context", type, "outputs", "runtime-ruleset.json"),
      "--classification-queue",
      classificationQueuePath,
      "--location-queue",
      locationQueuePath,
      "--identity-preflight-index",
      identityPreflightArtifacts.indexPath,
      "--out-dir",
      path.join(outDir, "curation-gate", type),
    ]
      .map(shellQuote)
      .join(" ");
  const saveDraftCommand = (
    type: BundleRowType,
    mode: "commit" | "validate",
    inputFile = cleanupRowsPath(type),
  ) => {
    const modeFlag = mode === "commit" ? "--commit" : "--dry-run";
    if (type === "lifecyclemodel") {
      return [
        ...cliBin,
        "lifecyclemodel",
        "save-draft",
        "--input",
        inputFile,
        "--out-dir",
        path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
        modeFlag,
        "--json",
      ]
        .map(shellQuote)
        .join(" ");
    }
    return [
      ...cliBin,
      "dataset",
      "save-draft",
      "--input",
      inputFile,
      "--type",
      type,
      "--out-dir",
      path.join(outDir, mode === "commit" ? "commit" : "dry-run", type),
      modeFlag,
      "--json",
    ]
      .map(shellQuote)
      .join(" ");
  };

  const commands: Record<string, Record<string, unknown>> = Object.fromEntries(
    bundleRowTypeOrder
      .filter((type) => !["unitgroup", "flowproperty"].includes(type))
      .map((type) => [
        type,
        {
          context_pack: contextPackCommand(type),
          schema_validate: schemaValidateCommand(type),
          qa: ["process", "flow"].includes(type) ? qaCommand(type) : null,
          curation_gate: ["process", "flow"].includes(type) ? curationGateCommand(type) : null,
          cleanup: cleanupCommand(type),
          dry_run: saveDraftCommand(type, "validate"),
          commit: saveDraftCommand(type, "commit"),
          prerequisites: [
            "Raw rows are authoring inputs, not commit-ready rows.",
            "Run schema_validate, QA where available, and dataset-curation-gate on raw rows before AI authoring.",
            "Run dataset-curation-cleanup only after curation source trace has been captured and AI/deterministic apply evidence is complete.",
            "Run dry_run/commit only on cleanup output rows after all gate blockers are closed.",
          ],
        },
      ]),
  );
  commands.unitgroup = {
    context_pack: null,
    schema_validate: null,
    qa: null,
    curation_gate: null,
    cleanup: null,
    dry_run: null,
    commit: null,
    policy: "reference_only_existing_database_rows",
  };
  commands.flowproperty = {
    context_pack: null,
    schema_validate: null,
    qa: null,
    curation_gate: null,
    cleanup: null,
    dry_run: null,
    commit: null,
    policy: "reference_only_existing_database_rows",
  };
  commands.support = {
    context_pack: null,
    schema_validate: null,
    qa: null,
    curation_gate: null,
    cleanup: cleanupCommand("support", resolveRepoPath(rowFiles.support)),
    dry_run: [
      ...cliBin,
      "dataset",
      "save-draft",
      "--input",
      path.join(outDir, "cleanup", "support", "support.cleaned.jsonl"),
      "--type",
      "auto",
      "--out-dir",
      path.join(outDir, "dry-run", "support"),
      "--dry-run",
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    commit: [
      ...cliBin,
      "dataset",
      "save-draft",
      "--input",
      path.join(outDir, "cleanup", "support", "support.cleaned.jsonl"),
      "--type",
      "auto",
      "--out-dir",
      path.join(outDir, "commit", "support"),
      "--commit",
      "--json",
    ]
      .map(shellQuote)
      .join(" "),
    prerequisites: [
      "Support rows are contact/source only; unitgroup and flowproperty stay reference-only.",
      "Run cleanup before support dry_run/commit.",
      "Commit support only when dependent process/flow scopes have passed reference closure planning.",
    ],
  };
  return commands;
}

/** Assembles and writes the dataset-bundle-sample-rows summary report. */
export function writeBundleSampleReport({
  deps,
  outDir,
  profile,
  bundlesDir,
  allBundleDirs,
  selection,
  selectedBundles,
  libraryContact,
  libraryContactIdentity,
  libraryContactName,
  rewriteStats,
  canonicalSupportCache,
  canonicalSupportScalingRequirements,
  blockOnUnscaledCanonicalSupport,
  blockers,
  processScopeProjection,
  traceRows,
  classificationQueueRows,
  locationQueueRows,
  elementaryFlowReuseRows,
  identityPreflightArtifacts,
  sourceSemanticsRows,
  sourceClassificationRepairRows,
  omittedSourceSemanticsRows,
  processSourceReferenceQueueRows,
  sourceReferenceRewriteRows,
  canonicalSupportRewriteRows,
  countsByType,
  sanitizeStats,
  rowFiles,
  processScopeLedgerPath,
  traceQueuePath,
  classificationQueuePath,
  locationQueuePath,
  elementaryFlowReuseQueuePath,
  sourceSemanticsPath,
  sourceClassificationRepairsPath,
  processSourceReferencesPath,
  sourceReferenceRewritesPath,
  canonicalSupportRewritesPath,
  canonicalSupportScalingPath,
  commands,
}: {
  deps: Pick<
    BundleSampleDependencies,
    "nowIso" | "repoRelativeMaybe" | "repoRelativePath" | "resolveRepoPath" | "writeJson"
  >;
  outDir: string;
  profile: string;
  bundlesDir: unknown;
  allBundleDirs: string[];
  selection: BundleSelection;
  selectedBundles: SelectedBundle[];
  libraryContact: LooseRecord;
  libraryContactIdentity: DatasetIdentity;
  libraryContactName: string;
  rewriteStats: {
    rewritten: number;
    previous_ids: Set<string>;
    previous_descriptions: Set<string>;
  };
  canonicalSupportCache: CanonicalSupportCache;
  canonicalSupportScalingRequirements: LooseRecord[];
  blockOnUnscaledCanonicalSupport: boolean;
  blockers: LooseRecord[];
  processScopeProjection: ReturnType<typeof buildProcessScopeLedger>;
  traceRows: LooseRecord[];
  classificationQueueRows: LooseRecord[];
  locationQueueRows: LooseRecord[];
  elementaryFlowReuseRows: LooseRecord[];
  identityPreflightArtifacts: IdentityPreflightArtifacts;
  sourceSemanticsRows: SemanticSummary[];
  sourceClassificationRepairRows: LooseRecord[];
  omittedSourceSemanticsRows: SemanticSummary[];
  processSourceReferenceQueueRows: SourceReferenceRow[];
  sourceReferenceRewriteRows: LooseRecord[];
  canonicalSupportRewriteRows: LooseRecord[];
  countsByType: Record<string, number>;
  sanitizeStats: Record<string, number>;
  rowFiles: Partial<Record<BundleRowType | "support", string>>;
  processScopeLedgerPath: string;
  traceQueuePath: string;
  classificationQueuePath: string;
  locationQueuePath: string;
  elementaryFlowReuseQueuePath: string;
  sourceSemanticsPath: string;
  sourceClassificationRepairsPath: string;
  processSourceReferencesPath: string;
  sourceReferenceRewritesPath: string;
  canonicalSupportRewritesPath: string;
  canonicalSupportScalingPath: string;
  commands: Record<string, Record<string, unknown>>;
}) {
  const { nowIso, repoRelativeMaybe, repoRelativePath, resolveRepoPath, writeJson } = deps;
  const reportPath = path.join(outDir, "dataset-bundle-sample-rows-report.json");
  const report = {
    schema_version: 1,
    generated_at_utc: nowIso(),
    status: blockers.length === 0 ? "ready" : "blocked",
    command: "dataset-bundle-sample-rows",
    profile,
    source_bundles_dir: repoRelativeMaybe(resolveRepoPath(bundlesDir)),
    sample: {
      seed: selection.seed,
      requested_count: selection.selected.length + selection.missing_process_ids.length,
      selected_count: selection.selected.length,
      selected_bundles: selectedBundles,
      missing_process_ids: selection.missing_process_ids,
    },
    library_contact: {
      id: libraryContactIdentity.id,
      version: libraryContactIdentity.version,
      name: libraryContactName,
      website:
        libraryContact.contactDataSet?.contactInformation?.dataSetInformation?.WWWAddress ?? null,
      policy: "one_shared_contact_per_source_library",
      replaced_contact_ids: [...rewriteStats.previous_ids].sort(),
      replaced_contact_descriptions: [...rewriteStats.previous_descriptions].sort(),
    },
    policy: {
      raw_sample_rows_are_not_write_ready: true,
      required_multilang_english_before_write: true,
      preserve_source_language_variants: true,
      tidas_tools_conversion_boundary:
        "The converter may emit a generic conversion contact; Foundry replaces it during library import materialization.",
      support_rows_before_process_rows: true,
      source_rows_only_true_sources: true,
      unitgroup_rows_reference_only: true,
      flowproperty_rows_reference_only: true,
      canonical_support_cache: repoRelativeMaybe(canonicalSupportCache.cachePath),
      source_rows_exclude:
        "Converted data-format, compliance-system, placeholder, and Not specified support sources are omitted from source/support rows; they remain only in source-semantics provenance.",
      unitgroup_flowproperty_write_policy:
        "Unit Groups and Flow Properties are selected from existing canonical database rows. Converted rows may be kept for audit, but support.jsonl and generated commit commands never write them to My Data.",
      elementary_flow_write_policy:
        "Elementary flows are selected from existing TianGong database rows and are never written as BAFU-owned flow rows. Unresolved elementary matches remain in elementary-flow-reuse-queue.jsonl and block referencing process writes.",
      identity_preflight_search_policy:
        "Process and flow matching uses CLI identity-preflight with complete fielded search briefs. The CLI sends query, filter, match_count, page_size, and data_source to process_hybrid_search or flow_hybrid_search, then applies deterministic local identity decisions to returned candidates.",
      canonical_flow_property_reference_rewrite:
        "Flow referenceToFlowPropertyDataSet values are rewritten from converted package-local Amount-in-unit rows to canonical Flow Property rows listed in the local support cache.",
      ...(canonicalSupportScalingRequirements.length > 0 || blockOnUnscaledCanonicalSupport
        ? {
            canonical_support_amount_scaling:
              "Canonical support rewrites never convert amounts. Scale!=1 requirements remain explicit local evidence; under --block-on-unscaled-canonical-support, known positive factors use canonical_support_amount_scaling_required while missing, non-finite, zero, or negative factors use canonical_support_amount_scale_unresolved.",
          }
        : {}),
      true_source_classification_repair:
        "Report/publication sources with sourceCitation and converted Other source types classification are repaired to TIDAS Publications and communications before dry-run/write planning.",
      true_source_identity_repair:
        "Report/publication sources with generic EcoSpold compatibility names are repaired from sourceDescriptionOrComment metadata before dry-run/write planning.",
      true_source_description_repair:
        "Report/publication sources with empty or generic sourceDescriptionOrComment values are repaired from sourceCitation/shortName evidence before dry-run/write planning.",
      true_source_reference_description_repair:
        "Process data source reference shortDescription values are synchronized to curated true source row names before dry-run/write planning.",
      process_context_source_repair:
        "When process context contains a clear Original source with DOI that is more specific than the converted source reference, Foundry creates a process-context source row, rewrites referenceToDataSource to it, and omits unreferenced converted source rows from support writes.",
      canonical_source_reference_rewrite:
        "referenceToDataSetFormat and referenceToComplianceSystem are rewritten to public canonical source references before dry-run/write planning.",
      rust_tidas_validation_before_remote_write:
        "Raw materialized rows are authoring inputs. Capture curation context first, close AI/deterministic gates, run dataset-curation-cleanup, then validate the cleanup output through dataset-tidas-validate before save-draft dry-run/commit. Remote CLI commands keep their own defensive validation.",
    },
    counts: {
      blockers: blockers.length,
      total_available_bundles: allBundleDirs.length,
      selected_bundles: selection.selected.length,
      process_scopes_ready: processScopeProjection.summary.ready,
      process_scopes_needs_ai_authoring: processScopeProjection.summary.needs_ai_authoring,
      process_scopes_blocked_deferred: processScopeProjection.summary.blocked_deferred,
      rewritten_contact_refs: rewriteStats.rewritten,
      import_trace_queue_rows: traceRows.length,
      classification_authoring_queue_rows: classificationQueueRows.length,
      location_authoring_queue_rows: locationQueueRows.length,
      elementary_flow_reuse_queue_rows: elementaryFlowReuseRows.length,
      identity_preflight_request_rows: identityPreflightArtifacts.rows.length,
      source_semantics_rows: sourceSemanticsRows.length,
      source_classification_repair_rows: sourceClassificationRepairRows.length,
      true_source_rows: sourceSemanticsRows.filter((row) => row.kind === "true_source").length,
      format_support_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "format_support_source",
      ).length,
      compliance_support_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "compliance_support_source",
      ).length,
      placeholder_or_unspecified_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "placeholder_or_unspecified_source",
      ).length,
      omitted_non_true_source_rows: omittedSourceSemanticsRows.length,
      process_source_reference_rows: processSourceReferenceQueueRows.length,
      source_reference_rewrite_rows: sourceReferenceRewriteRows.length,
      canonical_support_rewrite_rows: canonicalSupportRewriteRows.length,
      ...(canonicalSupportScalingRequirements.length > 0
        ? {
            canonical_support_amount_scaling_rows: canonicalSupportScalingRequirements.length,
          }
        : {}),
      materialized_true_source_rows: sourceSemanticsRows.filter(
        (row) => row.kind === "true_source" && row.materialized_as_source_row !== false,
      ).length,
      reference_only_unitgroup_rows: countsByType.unitgroup,
      reference_only_flowproperty_rows: countsByType.flowproperty,
      true_source_identity_repairs: sanitizeStats.true_source_identity_repairs,
      true_source_description_repairs: sanitizeStats.true_source_description_repairs,
      true_source_reference_description_repairs:
        sanitizeStats.true_source_reference_description_repairs,
      ...sanitizeStats,
      ...Object.fromEntries(
        Object.entries(countsByType).map(([type, count]) => [`${type}_rows`, count]),
      ),
    },
    process_scope_summary: processScopeProjection.summary,
    ...(canonicalSupportScalingRequirements.length > 0
      ? { amount_scaling_requirements: canonicalSupportScalingRequirements }
      : {}),
    files: {
      report: repoRelativePath(reportPath),
      rows: rowFiles,
      process_scope_ledger: repoRelativePath(processScopeLedgerPath),
      import_traces: repoRelativePath(traceQueuePath),
      classification_authoring_queue: repoRelativePath(classificationQueuePath),
      location_authoring_queue: repoRelativePath(locationQueuePath),
      elementary_flow_reuse_queue: repoRelativePath(elementaryFlowReuseQueuePath),
      identity_preflight_requests: repoRelativePath(identityPreflightArtifacts.indexPath),
      source_semantics: repoRelativePath(sourceSemanticsPath),
      source_classification_repairs: repoRelativePath(sourceClassificationRepairsPath),
      process_source_references: repoRelativePath(processSourceReferencesPath),
      source_reference_rewrites: repoRelativePath(sourceReferenceRewritesPath),
      canonical_support_rewrites: repoRelativePath(canonicalSupportRewritesPath),
      ...(canonicalSupportScalingRequirements.length > 0
        ? { canonical_support_amount_scaling: repoRelativePath(canonicalSupportScalingPath) }
        : {}),
    },
    commands,
    blockers,
  };
  writeJson(reportPath, report);
  return report;
}
