import path from "node:path";
import {
  preparationValidationActions,
  readPreparationCliEvidence,
} from "../foundry-preparation-cli-validation.ts";
import { reviewedFoundryQualityFindings } from "../foundry-quality-review.ts";
import {
  buildQueueGateItems,
  writeCurationGateReport,
  writeEntityAuthoringPackage,
  type CurationGateArgs,
} from "./internal/curation-gate-report.ts";
import * as curationGateWorkflow from "./internal/curation-gate-workflow.ts";
import { type JsonRecord } from "./internal/workflow-context-types.ts";

const {
  authoringQueueRowsForIdentity,
  buildIdentityPreflightAuthoringContext,
  buildQueueAuthoringContext,
  classificationQueueActionItem,
  classificationQueueRowStillNeedsAuthoring,
  collectBundledSchemaContextFiles,
  collectContextDirFiles,
  collectExplicitContextFiles,
  collectProfileSemanticActionItems,
  datasetIdentity,
  datasetTypeFromOptions,
  ensureArray,
  entityIdFromFinding,
  fileExists,
  fullContextAiCompletionRequirement,
  fullContextGateItems,
  identityDecisionApplyContextDecisionsForIdentity,
  identityDecisionApplyReportOptionValues,
  identityKey,
  identityPreflightAuthoringActionItems,
  identityPreflightGateItems,
  locationQueueActionItem,
  locationQueueRowStillNeedsAuthoring,
  mapRowsByIdentity,
  profileFor,
  qaFindingCode,
  qaFindingCurationAction,
  readAuthoringQueueContext,
  readCanonicalSupportRewriteContext,
  readClassificationDecisionApplyContext,
  readCleanupTransformContext,
  readContextFiles,
  readCurationQueueContext,
  readIdentityDecisionApplyContexts,
  readIdentityPreflightContext,
  readIdentityReferenceRewriteContext,
  readJson,
  readJsonArtifactsIfOption,
  readJsonIfOption,
  readQaFindings,
  readRows,
  readSourceContactRewriteContext,
  readUnresolvedExchangeExternalizationContext,
  resolveRepoPath,
  schemaIssueCurationAction,
  unresolvedExchangeExternalizationRowsForIdentity,
} = curationGateWorkflow;

function asJsonRecord(value: unknown): JsonRecord {
  return value as JsonRecord;
}

export function runDatasetCurationGate({
  repoRoot,
  options = {},
  routeAction,
  requireIdentityPreflight = false,
  cliValidation,
}: CurationGateArgs = {}): JsonRecord {
  const datasetType = datasetTypeFromOptions(options);
  if (options.help) {
    return {
      schema_version: 2,
      status: "help",
      command: "dataset-curation-gate",
      usage: [
        "node src/dev-cli.ts dataset-curation-gate --type process --rows-file <rows.jsonl> --schema-report <dataset-validate-report.json> --qa-report <qa-report.json> --queue-dir <curation-queue-dir> --classification-queue <classification-authoring-queue.jsonl> --location-queue <location-authoring-queue.jsonl>",
        "node src/dev-cli.ts dataset-curation-gate --type process --rows-file ./rows/processes.jsonl --schema-report ./schema/report.json --qa-report ./qa/report.json --schema-file ./context/schema.json --yaml-file ./context/methodology.yaml --queue-dir ./curation-queue --classification-queue ./classification-authoring-queue.jsonl --location-queue ./location-authoring-queue.jsonl --identity-preflight-index ./identity-preflight-requests/identity-preflight-requests.jsonl",
      ],
      context: {
        queue_dir: "optional but required by the Foundry import workflow after queue build",
        classification_queue:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages and converted into classification action items",
        location_queue:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages and converted into location-code action items",
        identity_preflight_index:
          "optional JSONL from dataset-bundle-sample-rows; attached to authoring packages with read-only hybrid-search request/result evidence for process and flow reuse decisions",
        require_identity_preflight:
          "explicit hard-gate flag for profiles that require identity-preflight result artifacts for current entities and process dependencies",
        ai_authoring_package:
          "includes source row, schema/QA blockers, contract/profile context, queue task, closure, dependency rows, and support rows when --queue-dir is provided",
      },
    };
  }
  const root = repoRoot!;
  const rowsFile = resolveRepoPath(root, options.rowsFile || options.input);
  const schemaReportPath = resolveRepoPath(root, options.schemaReport);
  const qaReportPath = resolveRepoPath(root, options.qaReport);
  const defaultOut = `.foundry/workspaces/${datasetType}-dataset-curation-gate`;
  const outDir = resolveRepoPath(root, options.outDir || defaultOut)!;
  const profileId = String(options.profile || "generic")
    .trim()
    .toLowerCase();
  const profile = profileFor(root, profileId, options);
  if (!rowsFile || !fileExists(rowsFile)) {
    throw new Error("--rows-file is required and must point to a JSON/JSONL dataset row file.");
  }
  if (!schemaReportPath || !fileExists(schemaReportPath)) {
    throw new Error(
      "--schema-report is required and must point to dataset-tidas-validate compatibility report JSON.",
    );
  }
  if (!qaReportPath || !fileExists(qaReportPath)) {
    throw new Error("--qa-report is required and must point to a QA report JSON.");
  }

  const rows = readRows(rowsFile);
  const cliEvidence = cliValidation
    ? readPreparationCliEvidence(cliValidation, rows, rowsFile)
    : null;
  const cliValidationRows = cliEvidence?.rows;
  const cliValidationReportSha256 = cliEvidence?.sha256;
  const schemaReport = readJson<JsonRecord>(schemaReportPath);
  const qaReport = readJson<JsonRecord>(qaReportPath);
  const qaFindings = readQaFindings(root, qaReport, qaReportPath, datasetType);
  const qualityReviews =
    options.qualityReview && datasetType === "process"
      ? reviewedFoundryQualityFindings(
          options.qualityReview,
          rowsFile,
          qaReport,
          qaFindings,
          options.cleanupReport,
        )
      : [];
  const profileContext = readContextFiles(
    root,
    profile.docs.map((filePath): [string, string | null | undefined] => [
      "profile",
      filePath as string | null | undefined,
    ]),
  );
  const contractContext = readContextFiles(root, [
    ...(collectExplicitContextFiles(options) as Array<[string, string | null | undefined]>),
    ...collectContextDirFiles(root, options.contextDir),
    ...collectBundledSchemaContextFiles(root),
  ]);
  const fullContextRequirement = fullContextAiCompletionRequirement(profile, datasetType, root);
  const fullContextItems = fullContextGateItems({
    contractContext,
    requirement: fullContextRequirement,
  });
  const queueContext = readCurationQueueContext(root, options);
  const requireQueueContext =
    options.requireQueueContext === true ||
    options.requireQueueContext === "true" ||
    options.requireCurationQueueContext === true ||
    options.requireCurationQueueContext === "true";
  const classificationQueueContext = readAuthoringQueueContext(
    root,
    options.classificationQueue ?? options.classificationQueueFile,
    "classification",
  );
  const locationQueueContext = readAuthoringQueueContext(
    root,
    options.locationQueue ?? options.locationQueueFile,
    "location",
  );
  const identityPreflightContext = readIdentityPreflightContext(root, options, rowsFile);
  const classificationDecisionApplyArtifact = readJsonIfOption(
    root,
    options.classificationDecisionApplyReport ?? options.classificationDecisionsApplyReport,
  );
  const classificationDecisionApplyContext = classificationDecisionApplyArtifact
    ? readClassificationDecisionApplyContext(root, classificationDecisionApplyArtifact)
    : null;
  const identityDecisionApplyArtifacts = readJsonArtifactsIfOption(
    root,
    identityDecisionApplyReportOptionValues(options),
  );
  const identityDecisionApplyArtifact = identityDecisionApplyArtifacts[0] ?? null;
  const identityDecisionApplyContext = readIdentityDecisionApplyContexts(
    root,
    identityDecisionApplyArtifacts,
  );
  const unresolvedExchangeExternalizationArtifact = readJsonIfOption(
    root,
    options.unresolvedExchangeExternalizationReport,
  );
  const unresolvedExchangeExternalizationContext = readUnresolvedExchangeExternalizationContext(
    root,
    unresolvedExchangeExternalizationArtifact,
  );
  const sourceContactRewriteArtifact = readJsonIfOption(
    root,
    options.sourceContactRewriteReport ?? options.sourceContactRewritesReport,
  );
  const sourceContactRewriteContext = readSourceContactRewriteContext(
    root,
    sourceContactRewriteArtifact,
  );
  const canonicalSupportRewriteArtifact = readJsonIfOption(
    root,
    options.canonicalSupportRewriteReport ?? options.canonicalSupportRewritesReport,
  );
  const canonicalSupportRewriteContext = readCanonicalSupportRewriteContext(
    root,
    canonicalSupportRewriteArtifact,
  );
  const cleanupArtifact = readJsonIfOption(root, options.cleanupReport);
  const cleanupContext = readCleanupTransformContext(root, cleanupArtifact);
  const writeRows = mapRowsByIdentity(rows, datasetType);
  const identityReferenceRewriteContext = readIdentityReferenceRewriteContext({
    repoRoot: root,
    rowsFile,
    options,
    writeRows,
  });
  const waivedQaCodes = new Set(
    (profile.waivedQaCodesByType?.[datasetType] ?? []) as Iterable<unknown>,
  );
  const schemaRowsById = new Map<string, JsonRecord>(
    ensureArray(schemaReport.rows).map((value) => {
      const row = asJsonRecord(value);
      return [String(row.id ?? row.dataset_id ?? ""), row];
    }),
  );
  const qaFindingsById = new Map<string, JsonRecord[]>();
  for (const finding of qaFindings) {
    const id = entityIdFromFinding(finding, datasetType);
    if (!id) continue;
    if (!qaFindingsById.has(id)) qaFindingsById.set(id, []);
    qaFindingsById.get(id)!.push(finding);
  }

  const packageDir = path.join(outDir, "ai-authoring-packages");
  const entityReports = rows.map((row, index) => {
    const identity = datasetIdentity(row, index, datasetType);
    const curationQueueContext = buildQueueAuthoringContext(
      root,
      queueContext,
      datasetType,
      identity,
    );
    const identityPreflightAuthoringContext = buildIdentityPreflightAuthoringContext({
      context: identityPreflightContext,
      datasetType,
      identity,
      curationQueueContext,
      repoRoot: root,
      classificationDecisionApplyContext,
      identityDecisionApplyContext,
      identityReferenceRewriteContext,
      unresolvedExchangeExternalizationContext,
      sourceContactRewriteContext,
      canonicalSupportRewriteContext,
      cleanupContext,
    });
    const unresolvedExchangeExternalizationRows = unresolvedExchangeExternalizationRowsForIdentity(
      unresolvedExchangeExternalizationContext,
      identity,
    );
    const identityReferenceRewrites =
      identityReferenceRewriteContext.byIdentity.get(identityKey(identity)) ?? [];
    const identityDecisionApplyRows = identityDecisionApplyContextDecisionsForIdentity({
      context: identityDecisionApplyContext,
      datasetType,
      id: identity.id,
      version: identity.version,
    });
    const identityPreflightGateItemsForEntity = identityPreflightGateItems({
      required:
        (Boolean(fullContextRequirement) || requireIdentityPreflight) &&
        ["flow", "process"].includes(datasetType),
      context: identityPreflightContext,
      authoringContext: identityPreflightAuthoringContext,
      datasetType,
      identity,
      curationQueueContext,
      profile,
    });
    const identityPreflightActionItems = identityPreflightAuthoringActionItems({
      required:
        (Boolean(fullContextRequirement) || requireIdentityPreflight) &&
        ["flow", "process"].includes(datasetType),
      authoringContext: identityPreflightAuthoringContext,
      datasetType,
      identity,
      identityDecisionApplyContext,
    });
    const classificationAuthoringRows = authoringQueueRowsForIdentity(
      classificationQueueContext,
      identity,
    );
    const locationAuthoringRows = authoringQueueRowsForIdentity(locationQueueContext, identity);
    const unresolvedClassificationAuthoringRows = classificationAuthoringRows.filter((item) =>
      classificationQueueRowStillNeedsAuthoring({
        repoRoot: root,
        datasetType,
        payload: identity.payload,
        row: item,
      }),
    );
    const unresolvedLocationAuthoringRows = locationAuthoringRows.filter((item) =>
      locationQueueRowStillNeedsAuthoring({
        repoRoot: root,
        payload: identity.payload,
        row: item,
      }),
    );
    const schemaRow = schemaRowsById.get(identity.id) ?? null;
    const schemaIssues = ensureArray(schemaRow?.issues);
    const entityQaFindings = qaFindingsById.get(identity.id) ?? [];
    const waivedFindings = entityQaFindings.filter((finding) =>
      waivedQaCodes.has(qaFindingCode(finding)),
    );
    const reviewedFindings = qualityReviews.filter(
      (review) =>
        review.row_index === index &&
        review.id === identity.id &&
        review.version === identity.version,
    );
    const actionableQaFindings = entityQaFindings.filter(
      (finding) =>
        !waivedQaCodes.has(qaFindingCode(finding)) &&
        !reviewedFindings.some((review) => review.finding === finding),
    );
    const schemaActionItems = schemaIssues.map((issue) => schemaIssueCurationAction(issue));
    const qaActionItems = actionableQaFindings.map((finding) =>
      qaFindingCurationAction(finding, datasetType),
    );
    const semanticActionItems = collectProfileSemanticActionItems({
      profile,
      datasetType,
      payload: identity.payload,
      hasClassificationQueueContext: unresolvedClassificationAuthoringRows.length > 0,
    });
    const classificationQueueActionItems = unresolvedClassificationAuthoringRows.map(
      classificationQueueActionItem,
    );
    const locationQueueActionItems = unresolvedLocationAuthoringRows.map(locationQueueActionItem);
    const actionItems = [
      ...schemaActionItems.filter((item) => item.ai_required),
      ...(cliValidationRows
        ? preparationValidationActions(cliValidationRows[index], {
            report_file: cliValidation!.report,
            report_sha256: cliValidationReportSha256,
          })
        : []),
      ...qaActionItems,
      ...identityPreflightActionItems,
      ...classificationQueueActionItems,
      ...locationQueueActionItems,
      ...semanticActionItems,
    ].map((item) =>
      routeAction ? routeAction(asJsonRecord(item), datasetType, identity.payload) : item,
    );
    const queueGateItems = buildQueueGateItems({
      requireQueueContext,
      queueContext,
      curationQueueContext,
    });
    const deterministicCleanupItems = [
      ...schemaActionItems.filter((item) => !item.ai_required),
      ...queueGateItems,
      ...fullContextItems,
      ...identityPreflightGateItemsForEntity,
    ];
    return writeEntityAuthoringPackage({
      root,
      packageDir,
      datasetType,
      rowsFile,
      options,
      profile,
      profileContext,
      contractContext,
      fullContextRequirement,
      row,
      index,
      identity,
      schemaRow,
      schemaIssues,
      cliValidation,
      cliValidationRows,
      cliValidationReportSha256,
      entityQaFindings,
      reviewedFindings,
      waivedFindings,
      actionItems,
      identityPreflightActionItems,
      identityDecisionApplyRows,
      semanticActionItems,
      classificationQueueActionItems,
      locationQueueActionItems,
      deterministicCleanupItems,
      curationQueueContext,
      identityPreflightAuthoringContext,
      unresolvedExchangeExternalizationContext,
      unresolvedExchangeExternalizationRows,
      identityReferenceRewriteContext,
      identityReferenceRewrites,
      identityDecisionApplyContext,
      identityDecisionApplyArtifact,
      classificationQueueContext,
      classificationAuthoringRows,
      locationQueueContext,
      locationAuthoringRows,
    });
  });

  return writeCurationGateReport({
    root,
    outDir,
    packageDir,
    datasetType,
    rowsFile,
    schemaReportPath,
    qaReportPath,
    profile,
    profileContext,
    contractContext,
    fullContextRequirement,
    waivedQaCodes,
    cliValidation,
    cliValidationReportSha256,
    qualityReviews,
    queueContext,
    requireQueueContext,
    classificationQueueContext,
    locationQueueContext,
    unresolvedExchangeExternalizationContext,
    identityPreflightContext,
    identityReferenceRewriteContext,
    identityDecisionApplyContext,
    identityDecisionApplyArtifact,
    entityReports,
  });
}
