import { taskAuthorizationAllows } from "../task-authorization.ts";
import {
  verifiedReferenceLedgerProof,
  writeMutationManifestReport,
  type ArtifactEnvelope,
  type MutationManifestArgs,
} from "./internal/mutation-manifest-report.ts";
import * as mutationManifestWorkflow from "./internal/mutation-manifest-workflow.ts";
import { type JsonRecord } from "./internal/workflow-context-types.ts";

const {
  asText,
  buildEvidenceScopeBlockers,
  buildFullContextAiCompletionBlockers,
  buildReferenceClosureBlockers,
  buildReferenceReuseItems,
  buildWriteCandidateItem,
  datasetTypeFromOptions,
  decisionApplyContextRelevantToRowsFile,
  ensureArray,
  evidenceScopeBlocker,
  fileExists,
  fullContextAiCompletionRequirement,
  identityDecisionApplyReportOptionValues,
  identityDecisionUnresolvedReferenceKeys,
  identityKey,
  identityReferenceRewriteProofKeys,
  mapCurationEntities,
  mapRowsByIdentity,
  mapSchemaRows,
  plannedRootReferenceIds,
  plannedRootReferenceKeys,
  profileFor,
  publicCanonicalSourceReferenceKeys,
  readCanonicalSupportRewriteContext,
  readClassificationDecisionApplyContext,
  readCleanupTransformContext,
  readDatasetSaveDraftDryRunArtifacts,
  readFileArtifactIfOption,
  readFlowDryRunArtifacts,
  readIdentityDecisionApplyContexts,
  readIdentityReferenceRewriteContext,
  readJsonArtifactsIfOption,
  readJsonIfOption,
  readLifecyclemodelDryRunArtifacts,
  readLocationDecisionApplyContext,
  readPatchApplyContext,
  readProcessDryRunArtifacts,
  readRows,
  readRowsIfExists,
  readSourceContactRewriteContext,
  readSourceReferenceRewriteContext,
  readUnresolvedExchangeExternalizationContext,
  remoteVerifyBlockerKeys,
  repoRelativePath,
  resolveRepoPath,
  sourceContactRewriteSemanticEvidenceCount,
  sourceContactSupportCanonicalUnitGroupProofKeys,
  sourceContactSupportTrueSourceProofKeys,
  sourceReferenceRewriteProofKeys,
  supportDatasetTypes,
} = mutationManifestWorkflow;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function runDatasetMutationManifest({
  repoRoot,
  options = {},
}: MutationManifestArgs = {}): JsonRecord {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-mutation-manifest",
      usage: [
        "node src/dev-cli.ts dataset-mutation-manifest --type flow --rows-file <ready-flow-rows.jsonl> --schema-report <validation-report.json> --dry-run-report <flow-publish-report.json> --target-user-id <uuid>",
        "node src/dev-cli.ts dataset-mutation-manifest --type process --rows-file <ready-processes.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --remote-verify-report <remote-verification-report.json> --target-user-id <uuid>",
        "node src/dev-cli.ts dataset-mutation-manifest --type lifecyclemodel --rows-file <ready-lifecyclemodels.jsonl> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node src/dev-cli.ts dataset-mutation-manifest --type flow --rows-file <classified-flows.jsonl> --classification-decision-apply-report <classification-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node src/dev-cli.ts dataset-mutation-manifest --type process --rows-file <located-processes.jsonl> --location-decision-apply-report <location-decisions-apply-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
        "node src/dev-cli.ts dataset-mutation-manifest --type process --rows-file <patched-cleaned-rows.jsonl> --patch-collect-report <authoring-patch-collect-report.json> --require-patch-collect-report --patch-apply-report <dataset-patch-apply-report.json> --cleanup-report <dataset-curation-cleanup-report.json> --schema-report <validation-report.json> --dry-run-report <save-draft-summary.json> --target-user-id <uuid>",
      ],
      purpose:
        "Build a prewrite mutation manifest that separates write/update candidates, reusable existing references, and blocked rows before any commit.",
    };
  }

  const root = repoRoot!;
  const rowsFile = resolveRepoPath(root, options.rowsFile || options.input);
  const referenceRowsFile = resolveRepoPath(
    root,
    options.referenceRowsFile || options.referenceRows || options.reuseRowsFile,
  );
  const schemaReportArtifact = readJsonIfOption(
    root,
    options.schemaReport,
  ) as ArtifactEnvelope | null;
  const curationGateArtifact = readJsonIfOption(
    root,
    options.curationGateReport,
  ) as ArtifactEnvelope | null;
  const dryRunReportArtifact = readJsonIfOption(
    root,
    options.dryRunReport,
  ) as ArtifactEnvelope | null;
  const remoteVerifyArtifact = readJsonIfOption(
    root,
    options.remoteVerifyReport,
  ) as ArtifactEnvelope | null;
  const cleanupArtifact = readJsonIfOption(root, options.cleanupReport) as ArtifactEnvelope | null;
  const patchApplyArtifact = readJsonIfOption(
    root,
    options.patchApplyReport,
  ) as ArtifactEnvelope | null;
  const patchCollectArtifact = readJsonIfOption(
    root,
    options.patchCollectReport ?? options.authoringPatchCollectReport,
  ) as ArtifactEnvelope | null;
  const classificationDecisionApplyArtifact = readJsonIfOption(
    root,
    options.classificationDecisionApplyReport ?? options.classificationDecisionsApplyReport,
  ) as ArtifactEnvelope | null;
  const locationDecisionApplyArtifact = readJsonIfOption(
    root,
    options.locationDecisionApplyReport ?? options.locationDecisionsApplyReport,
  ) as ArtifactEnvelope | null;
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    root,
    identityDecisionApplyReportOptionValues(options),
  ) as ArtifactEnvelope[];
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const patchEvidenceFile = readFileArtifactIfOption(
    root,
    options.patchEvidenceFile || options.patchEvidence,
  );
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-mutation-manifest`;
  const outDir = resolveRepoPath(root, options.outDir || defaultOut)!;
  const targetUserId = asText(
    options.targetUserId ??
      options.targetOwnerId ??
      dryRunReportArtifact?.value?.target_user_id_override ??
      process.env.FOUNDRY_TARGET_USER_ID,
  );
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(root, profileId, options);
  const fullContextRequirement = fullContextAiCompletionRequirement(profile, datasetType, root);
  const classificationDecisionApplyContext = classificationDecisionApplyArtifact
    ? readClassificationDecisionApplyContext(root, classificationDecisionApplyArtifact)
    : null;
  const locationDecisionApplyContext = locationDecisionApplyArtifact
    ? readLocationDecisionApplyContext(root, locationDecisionApplyArtifact)
    : null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    root,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    root,
    options.unresolvedExchangeExternalizationReport,
  ) as ArtifactEnvelope | null;
  const unresolvedExchangeExternalizationContext = readUnresolvedExchangeExternalizationContext(
    root,
    unresolvedExchangeExternalizationArtifact,
  );
  const canonicalSupportRewriteArtifact = readJsonIfOption(
    root,
    options.canonicalSupportRewriteReport || options.canonicalSupportRewritesReport,
  ) as ArtifactEnvelope | null;
  const canonicalSupportRewriteContext = readCanonicalSupportRewriteContext(
    root,
    canonicalSupportRewriteArtifact,
  );
  const sourceContactRewriteArtifact = readJsonIfOption(
    root,
    options.sourceContactRewriteReport ?? options.sourceContactRewritesReport,
  ) as ArtifactEnvelope | null;
  const sourceContactRewriteContext = readSourceContactRewriteContext(
    root,
    sourceContactRewriteArtifact,
  );
  const cleanupContext = readCleanupTransformContext(root, cleanupArtifact);
  const sourceContactRewriteSemanticEvidenceEntries = sourceContactRewriteSemanticEvidenceCount({
    repoRoot: root,
    datasetType,
    rowsFile,
    sourceContactRewriteContext,
    canonicalSupportRewriteContext,
    cleanupContext,
  });
  const hasClassificationDecisionProof =
    classificationDecisionApplyContext?.status === "completed" &&
    classificationDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot: root,
      rowsFile: rowsFile!,
      cleanupArtifact,
      context: classificationDecisionApplyContext,
    });
  const hasLocationDecisionProof =
    locationDecisionApplyContext?.status === "completed" &&
    locationDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot: root,
      rowsFile: rowsFile!,
      cleanupArtifact,
      context: locationDecisionApplyContext,
    });
  const hasIdentityDecisionProof =
    identityDecisionApplyContext?.status === "completed" &&
    identityDecisionApplyContext.decisions.length > 0 &&
    decisionApplyContextRelevantToRowsFile({
      repoRoot: root,
      rowsFile: rowsFile!,
      cleanupArtifact,
      context: identityDecisionApplyContext,
    });
  const requirePatchCollectReport =
    options.requirePatchCollectReport === true ||
    options.requirePatchCollectReport === "true" ||
    (Boolean(fullContextRequirement) &&
      !hasClassificationDecisionProof &&
      !hasLocationDecisionProof &&
      !hasIdentityDecisionProof &&
      sourceContactRewriteSemanticEvidenceEntries <= 0);

  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to JSON/JSONL write-candidate rows.");
  }
  if (!schemaReportArtifact) {
    throw new Error("--schema-report is required for mutation manifest generation.");
  }

  const rows = readRows(rowsFile);
  const referenceRows = readRowsIfExists(referenceRowsFile);
  const schemaRows = mapSchemaRows(schemaReportArtifact.value);
  const curationEntities = mapCurationEntities(curationGateArtifact?.value);
  const writeRows = mapRowsByIdentity(rows, datasetType);
  const writeCandidateKeys = new Set(writeRows.keys());
  const sourceReferenceRewriteContext = readSourceReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options,
    writeRows,
  });
  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options,
    writeRows,
    referenceRows,
    datasetType,
  });
  const verifiedReferenceProof = verifiedReferenceLedgerProof(root, options);
  const plannedRootKeys = plannedRootReferenceKeys(rows, datasetType);
  const plannedRootIds = plannedRootReferenceIds(rows, datasetType);
  const remoteVerifyBlockers = remoteVerifyBlockerKeys(remoteVerifyArtifact?.value, {
    plannedRootKeys,
    plannedRootIds,
  });
  const patchApplyContext =
    patchApplyArtifact || patchEvidenceFile
      ? readPatchApplyContext(root, patchApplyArtifact, patchEvidenceFile)
      : null;
  const evidenceScopeBlockers = buildEvidenceScopeBlockers({
    repoRoot: root,
    rowsFile,
    schemaReportArtifact,
    curationGateArtifact,
    dryRunReportArtifact,
    cleanupArtifact,
    patchApplyArtifact,
    patchApplyContext,
    patchCollectArtifact,
    requirePatchCollectReport,
    remoteVerifyArtifact,
    identityDecisionApplyContext,
    requireCurationGate:
      options.requireCurationGate === undefined
        ? !(datasetType === "support" || supportDatasetTypes.has(datasetType))
        : options.requireCurationGate === true || options.requireCurationGate === "true",
    identityReferenceRewriteContext,
    unresolvedExchangeExternalizationContext,
    canonicalSupportRewriteContext,
  });
  evidenceScopeBlockers.push(
    ...buildFullContextAiCompletionBlockers({
      repoRoot: root,
      profile,
      datasetType,
      curationGateArtifact,
      rowsFile,
      patchApplyArtifact,
      patchApplyContext,
      patchCollectArtifact,
      cleanupArtifact,
      classificationDecisionApplyArtifact,
      classificationDecisionApplyContext,
      locationDecisionApplyArtifact,
      locationDecisionApplyContext,
      identityDecisionApplyArtifact,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    }),
  );
  evidenceScopeBlockers.push(
    ...buildReferenceClosureBlockers({
      repoRoot: root,
      rows,
      datasetType,
      remoteVerifyArtifact,
      provenReferenceKeys: new Set([
        ...identityReferenceRewriteProofKeys(identityReferenceRewriteContext),
        ...sourceReferenceRewriteProofKeys(sourceReferenceRewriteContext),
        // FIX C: true sources the source/contact-rewrite stage committed into THIS
        // scope's support set (including review-report sources defensively harvested
        // even when their kind did not classify as true_source). The first
        // process.finalize must pass closure for these once they are in the support
        // commit. Only sources actually committed by that stage are surfaced here, so
        // this cannot loosen closure for any source not in the scope's support set.
        ...sourceContactSupportTrueSourceProofKeys(sourceContactRewriteContext),
        // CLASS 1 fix: a minted (account-local) Flow Property whose reference Unit Group
        // is a public canonical UG keeps the canonical UG as a remote reference (the
        // FP's referenceToReferenceUnitGroup was rewritten to the canonical published
        // version, and the canonical UG is never written). Prove that canonical UG
        // id@published-version so closure passes for the FP->UG edge without writing the
        // UG. Only UGs the source/contact-rewrite stage proved against the canonical
        // support cache are surfaced, so this cannot prove a non-canonical UG.
        ...sourceContactSupportCanonicalUnitGroupProofKeys(sourceContactRewriteContext),
        // Direct references to the well-known public canonical sources (ILCD
        // format + compliance-system) are always reusable from remote, even when
        // they were not produced by an in-scope rewrite mapping — e.g. minted
        // account-local FP/UG (P1a) reference the canonical compliance source
        // directly. Without this, their closure blocked on a source that is in
        // fact a fixed public canonical dataset.
        ...publicCanonicalSourceReferenceKeys,
        ...verifiedReferenceProof.keys,
      ]),
      unresolvedReferenceKeys: identityDecisionUnresolvedReferenceKeys(
        identityDecisionApplyContext,
      ),
      allowAccountLocalSupportAndElementary:
        taskAuthorizationAllows(profile.authorization, "flowproperty_write") &&
        taskAuthorizationAllows(profile.authorization, "unitgroup_write"),
    }),
  );
  if (
    dryRunReportArtifact?.value?.mode === "commit" ||
    dryRunReportArtifact?.value?.commit === true
  ) {
    evidenceScopeBlockers.push(
      evidenceScopeBlocker({
        code: "dry_run_report_is_commit_report",
        stage: "dry_run",
        message:
          "dataset-mutation-manifest --dry-run-report must point to a dry-run summary, not a commit summary. Keep commit reports as post-write evidence alongside dataset verify-remote.",
        expected: null,
        actual: null,
        artifact: null,
        repoRoot: root,
      }),
    );
  }
  const dryRun = {
    flow:
      datasetType === "flow" && dryRunReportArtifact
        ? readFlowDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
    process:
      datasetType === "process" && dryRunReportArtifact
        ? readProcessDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
    lifecyclemodel:
      datasetType === "lifecyclemodel" && dryRunReportArtifact
        ? readLifecyclemodelDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
    datasetSaveDraft:
      (datasetType === "support" || supportDatasetTypes.has(datasetType)) && dryRunReportArtifact
        ? readDatasetSaveDraftDryRunArtifacts(root, dryRunReportArtifact.value)
        : null,
  };

  const writeEntries = [...writeRows.values()];
  for (const entry of writeEntries) {
    (entry.identity as typeof entry.identity & { sourceRowsFile?: string }).sourceRowsFile =
      repoRelativePath(root, rowsFile);
  }

  const writeItems = writeEntries.map(({ row, identity, index }) => {
    const itemDatasetType = identity.dataset_type || datasetType;
    const key = identityKey(identity);
    return buildWriteCandidateItem({
      repoRoot: root,
      datasetType: itemDatasetType,
      row,
      identity,
      rowIndex: index,
      schemaRow: schemaRows.get(key) ?? schemaRows.get(identity.id) ?? null,
      curationEntity: curationEntities.get(key) ?? curationEntities.get(identity.id) ?? null,
      curationWaivedQaCodes: ensureArray(
        asRecord(curationGateArtifact?.value?.policy).waived_qa_codes,
      ),
      curationGateProvided: Boolean(curationGateArtifact),
      dryRun,
      remoteVerifyBlockers,
      targetUserId,
      cleanupStatus: cleanupArtifact?.value?.status ?? "not_provided",
      patchApplyContext,
      sourceReferenceRewritesByKey: sourceReferenceRewriteContext.byIdentity,
      identityReferenceRewritesByKey: identityReferenceRewriteContext.byIdentity,
      identityDecisionApplyContext,
      cleanupContext,
      evidenceScopeBlockers,
      allowAccountLocalSupportAndElementary:
        itemDatasetType === "flow"
          ? taskAuthorizationAllows(profile.authorization, "elementary_flow_write")
          : itemDatasetType === "flowproperty"
            ? taskAuthorizationAllows(profile.authorization, "flowproperty_write") &&
              taskAuthorizationAllows(profile.authorization, "canonical_support_local_mint")
            : itemDatasetType === "unitgroup"
              ? taskAuthorizationAllows(profile.authorization, "unitgroup_write") &&
                taskAuthorizationAllows(profile.authorization, "canonical_support_local_mint")
              : false,
      profile,
    });
  });
  const referenceItems = buildReferenceReuseItems({
    repoRoot: root,
    datasetType,
    rows: referenceRows,
    writeCandidateKeys,
    identityReferenceRewritesByKey: identityReferenceRewriteContext.byIdentity,
  });

  return writeMutationManifestReport({
    root,
    outDir,
    datasetType,
    rowsFile,
    referenceRowsFile,
    referenceRows,
    targetUserId,
    profile,
    fullContextRequirement,
    schemaReportArtifact,
    curationGateArtifact,
    curationEntities,
    dryRunReportArtifact,
    remoteVerifyArtifact,
    cleanupArtifact,
    patchApplyArtifact,
    patchApplyContext,
    patchCollectArtifact,
    requirePatchCollectReport,
    classificationDecisionApplyArtifact,
    classificationDecisionApplyContext,
    locationDecisionApplyArtifact,
    locationDecisionApplyContext,
    identityDecisionApplyArtifact,
    identityDecisionApplyArtifacts,
    identityDecisionApplyContext,
    canonicalSupportRewriteContext,
    unresolvedExchangeExternalizationContext,
    sourceReferenceRewriteContext,
    identityReferenceRewriteContext,
    verifiedReferenceProof,
    sourceContactRewriteSemanticEvidenceEntries,
    evidenceScopeBlockers,
    writeEntries,
    writeItems,
    referenceItems,
  });
}
