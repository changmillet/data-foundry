import type {
  CommandMetadataBuilders,
  FoundryInternalStageMetadata,
} from "./foundry-command-metadata-core.ts";

export function buildDecisionInternalStageMetadata(
  builders: CommandMetadataBuilders,
): Record<string, FoundryInternalStageMetadata> {
  const {
    metadata,
    goldenDiff,
    nodeTest,
    importCurationEntryContract,
    identityPreflightRunCommandContract,
    typedImportOwner,
    owners,
    tests,
  } = builders;

  return {
    "dataset-identity-decision-task-build": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityDecisionTask,
      ownerExport: "createIdentityDecisionTaskCommands().runDatasetIdentityDecisionTaskBuild",
      inputs: ["curation gate report", "identity-preflight context"],
      outputs: [
        "identity-decision-task.json",
        "identity-decision-task.md",
        "identity-decisions.template.jsonl",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/identity-curation-context.test.mts",
          "identity decision task deduplicates repeated targets and keeps source evidence",
        ),
      ],
    }),
    "dataset-classification-decision-task-build": metadata({
      category: "workflow-internal",
      ownerModule: owners.classificationDecisions,
      ownerExport:
        "createClassificationDecisionCommands().runDatasetClassificationDecisionTaskBuild",
      inputs: ["classification-authoring-queue.jsonl", "classification schemas", "context files"],
      outputs: [
        "classification-decision-task.json",
        "classification-decision-task.md",
        "classification-decisions.template.jsonl",
      ],
      keyTests: [
        nodeTest(
          tests.classificationDecisions,
          "classification decision task and apply route AI choices through CLI classification apply",
        ),
      ],
    }),
    "dataset-library-classification-decisions-project": metadata({
      category: "workflow-internal",
      ownerModule: owners.classificationDecisions,
      ownerExport:
        "createClassificationDecisionCommands().runDatasetLibraryClassificationDecisionsProject",
      inputs: [
        "classification-authoring-queue.jsonl",
        "library classification-decisions.jsonl",
        "classification-decision-task.json",
      ],
      outputs: [
        "dataset-library-classification-decisions-project-report.json",
        "classification-decisions.jsonl",
        "classification-decisions.manual-review.jsonl",
      ],
      keyTests: [
        nodeTest(
          tests.classificationDecisions,
          "library classification decisions project into task-bound apply decisions",
        ),
      ],
    }),
    "dataset-bafu-leaf-classification-tasks-prepare": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuLeafClassificationTasks,
      ownerExport:
        "createBafuLeafClassificationTaskCommands().runDatasetBafuLeafClassificationTasksPrepare",
      inputs: [
        "library-entity-index.jsonl",
        "scope-projection.jsonl",
        "blocked-scope-ledger.jsonl",
        "optional library classification-decisions.jsonl",
      ],
      outputs: [
        "leaf-process-classification-task-report.json",
        "leaf-process-classification-tasks.jsonl",
        "classification-decisions.template.jsonl",
        "sharded leaf process classification task/template JSONL",
      ],
      keyTests: [
        nodeTest(
          tests.bafuLeafClassificationTasks,
          "BAFU leaf classification helper prepares sharded process authoring tasks",
        ),
      ],
    }),
    "dataset-bafu-leaf-classification-category-map-project": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuLeafClassificationTasks,
      ownerExport:
        "createBafuLeafClassificationTaskCommands().runDatasetBafuLeafClassificationCategoryMapProject",
      inputs: [
        "leaf-process-classification-tasks.jsonl",
        "category-map-decisions/*.jsonl",
        "source decisions directory",
        "tidas_processes_category.json",
      ],
      outputs: [
        "classification-decisions.jsonl",
        "classification-decisions.manual-review.jsonl",
        "category-map-decisions.manual-review.jsonl",
        "process-leaf-classification-candidates.jsonl",
        "flow-product-classification-candidates.jsonl",
        "bafu-leaf-category-map-project-report.json",
      ],
      keyTests: [
        nodeTest(
          tests.bafuLeafClassificationTasks,
          "BAFU leaf category-map projection writes task-bound decisions and non-authoritative candidates separately",
        ),
      ],
    }),
    "dataset-bafu-identity-decisions-autofill": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuAutoAuthoring,
      ownerExport: "createBafuAutoAuthoringCommands().runDatasetBafuIdentityDecisionsAutofill",
      inputs: ["identity-decision-task.json"],
      outputs: ["identity-decisions.jsonl", "bafu-identity-decisions-autofill-report.json"],
      keyTests: [
        nodeTest(
          tests.bafuAutoAuthoring,
          "BAFU identity autofill creates product-flow create_new decisions only when candidates are not identity-equivalent",
        ),
      ],
    }),
    "dataset-bafu-authoring-patches-autofill": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuAutoAuthoring,
      ownerExport: "createBafuAutoAuthoringCommands().runDatasetBafuAuthoringPatchesAutofill",
      inputs: ["authoring-task-manifest.json", "authoring-package-snapshots"],
      outputs: ["per-task ai-patches.json", "bafu-authoring-patches-autofill-report.json"],
      keyTests: [
        nodeTest(
          tests.bafuAutoAuthoring,
          "BAFU patch autofill writes collectable name-plan and flowProperties patches",
        ),
        nodeTest(
          tests.bafuAutoAuthoring,
          "BAFU patch autofill splits disposal/incineration and transport route names",
        ),
      ],
    }),
    "dataset-classification-decisions-apply": metadata({
      category: "workflow-internal",
      ownerModule: owners.classificationDecisions,
      ownerExport: "createClassificationDecisionCommands().runDatasetClassificationDecisionsApply",
      inputs: ["classification queue", "AI classification decisions", "decision task proof"],
      outputs: ["classification-decisions-apply-report.json", "classified rows or queue outputs"],
      keyTests: [
        nodeTest(
          tests.classificationDecisions,
          "classification decision task and apply route AI choices through CLI classification apply",
        ),
      ],
    }),
    "dataset-location-decision-task-build": metadata({
      category: "workflow-internal",
      ownerModule: owners.locationDecisions,
      ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionTaskBuild",
      inputs: ["location-authoring-queue.jsonl", "tidas_locations_category.json", "context files"],
      outputs: [
        "location-decision-task.json",
        "location-decision-task.md",
        "location-decisions.template.jsonl",
      ],
      keyTests: [
        nodeTest(
          tests.locationDecisions,
          "location decision task and apply route AI location choices through CLI location apply",
        ),
      ],
    }),
    "dataset-location-decisions-suggest": metadata({
      category: "workflow-internal",
      ownerModule: owners.locationDecisions,
      ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionsSuggest",
      inputs: [
        "location-authoring-queue.jsonl",
        "location-decision-task.json",
        "tidas_locations_category.json",
      ],
      outputs: [
        "location-decisions.jsonl",
        "location-decisions.manual-review.jsonl",
        "dataset-location-decisions-suggest-report.json",
      ],
      keyTests: [
        nodeTest(
          tests.locationDecisions,
          "location decisions suggest creates task-bound decisions for unique valid candidates",
        ),
      ],
    }),
    "dataset-location-decisions-apply": metadata({
      category: "workflow-internal",
      ownerModule: owners.locationDecisions,
      ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionsApply",
      inputs: ["location queue", "AI location decisions", "decision task proof"],
      outputs: ["location-decisions-apply-report.json", "location-coded rows or queue outputs"],
      keyTests: [
        nodeTest(
          tests.locationDecisions,
          "location decision task and apply route AI location choices through CLI location apply",
        ),
      ],
    }),
    "dataset-curation-cleanup": metadata({
      category: "workflow-internal",
      ownerModule: typedImportOwner("curation-cleanup"),
      ownerExport: "runDatasetCurationCleanup",
      inputs: ["curated rows file", "profile cleanup policy"],
      outputs: [
        "dataset-curation-cleanup-report.json",
        "completed: cleaned rows file",
        "blocked_invalid_datetime_metadata: ordered blockers, null cleaned rows, and every pre-existing stale output preserved",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/curation-cleanup-quality-gates.test.mts",
          "curation cleanup normalizes placeholder annual supply to the supported unknown array",
        ),
        nodeTest(
          "test/scenarios/curation-cleanup-quality-gates.test.mts",
          "curation cleanup CLI exits nonzero and emits only blocker evidence for an impossible datetime",
        ),
        nodeTest(
          "test/unit/curation-cleanup-runner-contract.test.mts",
          "impossible datetime blocks the whole cleanup before partial transforms or cleaned-row output",
        ),
        importCurationEntryContract,
      ],
    }),
    "dataset-patch-apply": metadata({
      category: "cli-wrapper",
      ownerModule: owners.cliWrappers,
      ownerExport: "createCliWrapperCommands().runDatasetPatchApply",
      inputs: ["rows file", "AI patch file", "authoring package proof"],
      outputs: ["patched rows file", "dataset-patch-apply-report.json", "patch-evidence.jsonl"],
      keyTests: [
        nodeTest(
          "test/scenarios/flow-reference-reuse-and-traces.test.mts",
          "identity decision apply closes flow identity curation and counts as full-context evidence",
        ),
        nodeTest(
          tests.authoringTaskContext,
          "authoring patch collect blocks AI patches without completed status",
        ),
      ],
    }),
    "dataset-support-cache-refresh": metadata({
      category: "workflow-internal",
      ownerModule: owners.supportCache,
      ownerExport: "createSupportCacheCommands().runDatasetSupportCacheRefresh",
      inputs: [
        "intent-bound CLI support export artifacts",
        "public canonical support mapping policy",
      ],
      outputs: [
        "specs/canonical-support/flow-properties-unit-groups.json",
        "support cache refresh report",
      ],
      keyTests: [
        nodeTest(
          "test/unit/cli-support-export.test.mts",
          "support bridge delegates to one trusted CLI in an isolated credential-free cwd",
        ),
        nodeTest(
          "test/unit/support-cache-command-factory.test.mts",
          "support refresh preserves exported row order, summaries and mappings through the owner CLI",
        ),
      ],
    }),
    "dataset-canonical-support-mappings-autofill": metadata({
      category: "workflow-internal",
      ownerModule: owners.supportCache,
      ownerExport: "createSupportCacheCommands().runDatasetCanonicalSupportMappingsAutofill",
      inputs: [
        "canonical-support-mappings.template.jsonl",
        "specs/canonical-support/flow-properties-unit-groups.json",
      ],
      outputs: [
        "canonical-support-mappings.jsonl",
        "canonical-support-blocked.manual-review.jsonl",
        "canonical-support-mappings-report.json",
      ],
      keyTests: [
        nodeTest(
          tests.supportCache,
          "canonical support mapping autofill maps only proven units and reports unresolved units",
        ),
      ],
    }),
    "dataset-bundle-sample-rows": metadata({
      category: "workflow-internal",
      ownerModule: owners.bundleSampleRows,
      ownerExport: "createBundleSampleRowsCommands().runDatasetBundleSampleRows",
      inputs: ["process-bundles directory", "sample selection options", "canonical support cache"],
      outputs: [
        "sample rows JSONL",
        "classification-authoring-queue.jsonl",
        "location-authoring-queue.jsonl",
        "identity-preflight-requests.jsonl",
        "process-scope-ledger.jsonl",
        "canonical-support-amount-scaling.jsonl when scale conversion is required",
        "dataset-bundle-sample-rows-report.json",
      ],
      keyTests: [
        goldenDiff,
        nodeTest(
          "test/unit/foundry-stage-contract.test.mts",
          "complex workflow commands publish AI-readable stage contracts",
        ),
        nodeTest(
          tests.bundleSampleRows,
          "dataset-bundle-sample-rows writes executable identity preflight requests for process and elementary flow matching",
        ),
        nodeTest(
          tests.bundleSampleRows,
          "dataset-bundle-sample-rows projects process geography into referenced flow location evidence",
        ),
        nodeTest(
          tests.bundleSampleRows,
          "dataset-bundle-sample-rows retains and blocks canonical amount scaling requirements",
        ),
      ],
    }),
    "dataset-identity-preflight-requests-build": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityPreflightRun,
      ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightRequestsBuild",
      inputs: ["current process or flow rows file", "optional source identity-preflight index"],
      outputs: [
        "identity-preflight-requests/identity-preflight-requests.jsonl",
        "dataset-identity-preflight-requests-build-report.json",
      ],
      keyTests: [
        identityPreflightRunCommandContract,
        nodeTest(
          tests.bundleSampleRows,
          "dataset-identity-preflight-requests-build creates a fresh exact-row request index",
        ),
      ],
    }),
    "dataset-identity-preflight-query-audit": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityPreflightRun,
      ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightQueryAudit",
      inputs: ["identity-preflight-requests.jsonl"],
      outputs: [
        "identity-preflight-query-audit.jsonl",
        "dataset-identity-preflight-query-audit-report.json",
      ],
      keyTests: [
        identityPreflightRunCommandContract,
        nodeTest(
          tests.bundleSampleRows,
          "dataset-identity-preflight-query-audit passes complete fielded edge queries",
        ),
      ],
    }),
    "dataset-identity-preflight-run": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityPreflightRun,
      ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightRun",
      inputs: ["identity-preflight-requests.jsonl", "published tiangong-lca CLI"],
      outputs: [
        "identity-preflight-run-results.jsonl",
        "dataset-identity-preflight-run-report.json",
      ],
      keyTests: [
        identityPreflightRunCommandContract,
        nodeTest(
          "test/unit/foundry-stage-contract.test.mts",
          "complex workflow commands publish AI-readable stage contracts",
        ),
        nodeTest(
          tests.bundleSampleRows,
          "dataset-identity-preflight-run executes request indexes and preserves identity blockers as evidence",
        ),
        nodeTest(
          "test/scenarios/identity-preflight-run-and-merge.test.mts",
          "identity preflight batch runner records timed-out CLI rows without hanging",
        ),
      ],
    }),
    "dataset-identity-preflight-index-merge": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityPreflightRun,
      ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightIndexMerge",
      inputs: ["base identity-preflight index", "refreshed current-scope identity-preflight index"],
      outputs: [
        "identity-preflight-requests.jsonl",
        "dataset-identity-preflight-index-merge-report.json",
      ],
      keyTests: [
        identityPreflightRunCommandContract,
        nodeTest(
          "test/scenarios/identity-preflight-run-and-merge.test.mts",
          "identity preflight index merge preserves dependency rows while refreshing current scope",
        ),
      ],
    }),
  };
}
