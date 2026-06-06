export const commandCategories = [
  "public",
  "workflow-internal",
  "cli-wrapper",
];

const commandSmoke = (command) => ({
  kind: "command-smoke",
  command: `node scripts/foundry.mjs ${command}`,
});

const goldenDiff = {
  kind: "golden-diff",
  path: "scripts/foundry-golden-diff.mjs",
};

const nodeTest = (path, assertion) => ({
  kind: "node-test",
  path,
  assertion,
});

const coreOwner = "scripts/commands/core.mjs";
const taskOwner = "scripts/commands/tasks.mjs";
const importOwner = (moduleName) =>
  `scripts/lib/import-curation/${moduleName}.mjs`;

function workflowEntryForCategory(category) {
  switch (category) {
    case "public":
      return {
        status: "active",
        entry_kind: "operator_control_surface",
      };
    case "workflow-internal":
      return {
        status: "active",
        entry_kind: "dataset_import_workflow_stage",
      };
    case "cli-wrapper":
      return {
        status: "active",
        entry_kind: "sibling_cli_policy_wrapper",
      };
    default:
      return {
        status: "unknown",
        entry_kind: "unknown",
      };
  }
}

function metadata({
  category,
  ownerModule,
  ownerExport,
  inputs,
  outputs,
  keyTests,
  workflowEntry,
}) {
  return {
    category,
    ownerModule,
    ownerExport,
    navigationPath: [
      "scripts/foundry.mjs",
      "scripts/lib/foundry-cli.mjs",
      ownerModule,
    ],
    inputs,
    outputs,
    keyTests,
    workflowEntry: workflowEntry ?? workflowEntryForCategory(category),
  };
}

export const commandMetadata = {
  init: metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().initRuntime",
    inputs: ["repo root runtime directory policy"],
    outputs: [".foundry/logs", ".foundry/state", ".foundry/workspaces", "tasks/*"],
    keyTests: [commandSmoke("init"), commandSmoke("doctor")],
  }),
  doctor: metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().doctor",
    inputs: ["WORKFLOW.md", "docs/file-location-registry.json", ".env.example", "specs/import-profiles.json", "command metadata", "script import graph"],
    outputs: ["doctor JSON status report"],
    keyTests: [goldenDiff, commandSmoke("doctor")],
  }),
  "env-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().envCheck",
    inputs: [".env.example"],
    outputs: ["env_example_surface JSON status report"],
    keyTests: [commandSmoke("env-check"), commandSmoke("doctor")],
  }),
  "workflow-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().workflowCheck",
    inputs: ["WORKFLOW.md"],
    outputs: ["workflow_check JSON status report"],
    keyTests: [commandSmoke("workflow-check"), commandSmoke("doctor")],
  }),
  "storage-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().storageCheck",
    inputs: ["docs/file-location-registry.json"],
    outputs: ["storage_check JSON status report"],
    keyTests: [commandSmoke("storage-check"), commandSmoke("doctor")],
  }),
  "surface-audit": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().surfaceAuditCheck",
    inputs: ["command registry", "command metadata", "docs/**/*.md", "scripts/**/*.mjs"],
    outputs: ["surface audit JSON status report"],
    keyTests: [commandSmoke("surface-audit"), commandSmoke("doctor")],
  }),
  "acceptance-check": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().acceptanceCheck",
    inputs: ["task workspace checkpoints"],
    outputs: ["acceptance JSON status report"],
    keyTests: [commandSmoke("acceptance-check")],
  }),
  "workspace-map": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().workspaceMap",
    inputs: ["docs/workspace-project-map.md", "specs/workspace-capability-adapters.md"],
    outputs: ["workspace map JSON report"],
    keyTests: [commandSmoke("workspace-map")],
  }),
  "capabilities-list": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().capabilitiesList",
    inputs: ["specs/automated-lca-capability-registry.json"],
    outputs: ["capability registry JSON report"],
    keyTests: [goldenDiff, commandSmoke("capabilities-list")],
  }),
  "profiles-list": metadata({
    category: "public",
    ownerModule: importOwner("profiles"),
    ownerExport: "listImportProfiles",
    inputs: ["specs/import-profiles.json"],
    outputs: ["import profile JSON report"],
    keyTests: [goldenDiff, commandSmoke("profiles-list")],
  }),
  "route-task": metadata({
    category: "public",
    ownerModule: coreOwner,
    ownerExport: "createCoreCommands().buildRoutePlan",
    inputs: ["task metadata options", "capability registry"],
    outputs: ["route plan JSON artifact"],
    keyTests: [goldenDiff, commandSmoke("route-task")],
  }),
  "tasks-list": metadata({
    category: "public",
    ownerModule: taskOwner,
    ownerExport: "createTaskCommands().tasksList",
    inputs: ["tasks/inbox", "tasks/active", "tasks/done"],
    outputs: ["task list JSON report"],
    keyTests: [commandSmoke("tasks-list")],
  }),
  "tasks-check": metadata({
    category: "public",
    ownerModule: taskOwner,
    ownerExport: "createTaskCommands().tasksCheck",
    inputs: ["tasks/inbox", "tasks/active", "tasks/done"],
    outputs: ["task storage consistency JSON report"],
    keyTests: [commandSmoke("tasks-check"), commandSmoke("doctor")],
  }),
  "task-complete": metadata({
    category: "public",
    ownerModule: taskOwner,
    ownerExport: "createTaskCommands().runTaskComplete",
    inputs: ["tasks/active/<task-id>.md", "task completion options"],
    outputs: ["tasks/done/<task-id>.md", "task completion JSON report"],
    keyTests: [commandSmoke("task-complete")],
  }),
  "dataset-curation-queue-build": metadata({
    category: "cli-wrapper",
    ownerModule: "scripts/commands/cli-wrappers.mjs",
    ownerExport: "createCliWrapperCommands().runDatasetCurationQueueBuild",
    inputs: ["converted process/flow/support/lifecyclemodel rows"],
    outputs: ["CLI curation queue directory", "Foundry wrapper JSON report"],
    keyTests: [
      nodeTest("test/scenarios/identity-curation-context.test.mjs", "curation queue build is used before full-context authoring"),
    ],
  }),
  "dataset-curation-gate": metadata({
    category: "workflow-internal",
    ownerModule: importOwner("curation-gate"),
    ownerExport: "runDatasetCurationGate",
    inputs: ["rows file", "schema report", "QA report", "profile", "context files", "queue artifacts"],
    outputs: ["dataset-curation-gate-report.json", "ai-authoring-packages/*"],
    keyTests: [
      goldenDiff,
      nodeTest("test/scenarios/identity-curation-context.test.mjs", "curation gate authoring package carries full contract text and queue dependency rows"),
    ],
  }),
  "dataset-authoring-plan": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/authoring-plan.mjs",
    ownerExport: "createAuthoringPlanCommands().runDatasetAuthoringPlan",
    inputs: ["curation gate reports", "authoring task manifests", "decision task manifests"],
    outputs: ["dataset-authoring-plan JSON report"],
    keyTests: [
      nodeTest("test/unit/foundry-stage-contract.test.mjs", "complex workflow commands publish AI-readable stage contracts"),
      nodeTest("test/commands/authoring-plan.test.mjs", "dataset-authoring-plan aggregates missing AI task builds from curation gate"),
    ],
  }),
  "dataset-authoring-task-build": metadata({
    category: "workflow-internal",
    ownerModule: importOwner("authoring-packages"),
    ownerExport: "runDatasetAuthoringTaskBuild",
    inputs: ["curation gate report", "AI authoring package"],
    outputs: ["ai-authoring-task.json", "ai-authoring-task.md", "patch-template.json", "authoring-task-manifest.json"],
    keyTests: [
      goldenDiff,
      nodeTest("test/commands/authoring-task-context.test.mjs", "authoring task build blocks AI patch authoring when full context is incomplete"),
    ],
  }),
  "dataset-authoring-patch-collect": metadata({
    category: "workflow-internal",
    ownerModule: importOwner("patch-collect"),
    ownerExport: "runDatasetAuthoringPatchCollect",
    inputs: ["authoring task manifest", "AI patch files", "authoring packages"],
    outputs: ["authoring-patch-collect-report.json", "ai-patches.batch.json"],
    keyTests: [
      nodeTest("test/commands/authoring-task-context.test.mjs", "authoring patch collect blocks stale manifests that lack full-context task proof"),
    ],
  }),
  "dataset-identity-decision-task-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-decision-task.mjs",
    ownerExport: "createIdentityDecisionTaskCommands().runDatasetIdentityDecisionTaskBuild",
    inputs: ["curation gate report", "identity-preflight context"],
    outputs: ["identity-decision-task.json", "identity-decision-task.md", "identity-decisions.template.jsonl"],
    keyTests: [
      nodeTest("test/scenarios/identity-curation-context.test.mjs", "identity decision task deduplicates repeated targets and keeps source evidence"),
    ],
  }),
  "dataset-classification-decision-task-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/classification-decisions.mjs",
    ownerExport: "createClassificationDecisionCommands().runDatasetClassificationDecisionTaskBuild",
    inputs: ["classification-authoring-queue.jsonl", "classification schemas", "context files"],
    outputs: ["classification-decision-task.json", "classification-decision-task.md", "classification-decisions.template.jsonl"],
    keyTests: [
      nodeTest("test/commands/classification-decisions.test.mjs", "classification decision task and apply route AI choices through CLI classification apply"),
    ],
  }),
  "dataset-classification-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/classification-decisions.mjs",
    ownerExport: "createClassificationDecisionCommands().runDatasetClassificationDecisionsApply",
    inputs: ["classification queue", "AI classification decisions", "decision task proof"],
    outputs: ["classification-decisions-apply-report.json", "classified rows or queue outputs"],
    keyTests: [
      nodeTest("test/commands/classification-decisions.test.mjs", "classification decision task and apply route AI choices through CLI classification apply"),
    ],
  }),
  "dataset-location-decision-task-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/location-decisions.mjs",
    ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionTaskBuild",
    inputs: ["location-authoring-queue.jsonl", "tidas_locations_category.json", "context files"],
    outputs: ["location-decision-task.json", "location-decision-task.md", "location-decisions.template.jsonl"],
    keyTests: [
      nodeTest("test/commands/location-decisions.test.mjs", "location decision task and apply route AI location choices through CLI location apply"),
    ],
  }),
  "dataset-location-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/location-decisions.mjs",
    ownerExport: "createLocationDecisionCommands().runDatasetLocationDecisionsApply",
    inputs: ["location queue", "AI location decisions", "decision task proof"],
    outputs: ["location-decisions-apply-report.json", "location-coded rows or queue outputs"],
    keyTests: [
      nodeTest("test/commands/location-decisions.test.mjs", "location decision task and apply route AI location choices through CLI location apply"),
    ],
  }),
  "dataset-curation-cleanup": metadata({
    category: "workflow-internal",
    ownerModule: importOwner("curation-cleanup"),
    ownerExport: "runDatasetCurationCleanup",
    inputs: ["curated rows file", "profile cleanup policy"],
    outputs: ["dataset-curation-cleanup-report.json", "cleaned rows file"],
    keyTests: [
      nodeTest("test/scenarios/curation-cleanup-quality-gates.test.mjs", "curation cleanup fills placeholder annual supply with searchable sentinel"),
    ],
  }),
  "dataset-patch-apply": metadata({
    category: "cli-wrapper",
    ownerModule: "scripts/commands/cli-wrappers.mjs",
    ownerExport: "createCliWrapperCommands().runDatasetPatchApply",
    inputs: ["rows file", "AI patch file", "authoring package proof"],
    outputs: ["patched rows file", "dataset-patch-apply-report.json", "patch-evidence.jsonl"],
    keyTests: [
      nodeTest("test/scenarios/flow-reference-reuse-and-traces.test.mjs", "identity decision apply closes flow identity curation and counts as full-context evidence"),
      nodeTest("test/commands/authoring-task-context.test.mjs", "authoring patch collect blocks AI patches without completed status"),
    ],
  }),
  "dataset-support-cache-refresh": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/support-cache.mjs",
    ownerExport: "createSupportCacheCommands().runDatasetSupportCacheRefresh",
    inputs: ["CLI support lookup command", "canonical support mapping policy"],
    outputs: ["specs/canonical-support/flow-properties-unit-groups.json", "support cache refresh report"],
    keyTests: [commandSmoke("dataset-support-cache-refresh --help")],
  }),
  "dataset-bundle-sample-rows": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/bundle-sample-rows.mjs",
    ownerExport: "createBundleSampleRowsCommands().runDatasetBundleSampleRows",
    inputs: ["process-bundles directory", "sample selection options", "canonical support cache"],
    outputs: ["sample rows JSONL", "classification-authoring-queue.jsonl", "location-authoring-queue.jsonl", "identity-preflight-requests.jsonl", "dataset-bundle-sample-rows-report.json"],
    keyTests: [
      goldenDiff,
      nodeTest("test/unit/foundry-stage-contract.test.mjs", "complex workflow commands publish AI-readable stage contracts"),
      nodeTest("test/commands/bundle-sample-rows.test.mjs", "dataset-bundle-sample-rows writes executable identity preflight requests for process and elementary flow matching"),
    ],
  }),
  "dataset-identity-preflight-requests-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.mjs",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightRequestsBuild",
    inputs: ["current process or flow rows file", "optional source identity-preflight index"],
    outputs: ["identity-preflight-requests/identity-preflight-requests.jsonl", "dataset-identity-preflight-requests-build-report.json"],
    keyTests: [
      nodeTest("test/commands/bundle-sample-rows.test.mjs", "dataset-identity-preflight-requests-build creates a fresh exact-row request index"),
    ],
  }),
  "dataset-identity-preflight-query-audit": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.mjs",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightQueryAudit",
    inputs: ["identity-preflight-requests.jsonl"],
    outputs: ["identity-preflight-query-audit.jsonl", "dataset-identity-preflight-query-audit-report.json"],
    keyTests: [
      nodeTest("test/commands/bundle-sample-rows.test.mjs", "dataset-identity-preflight-query-audit passes complete fielded edge queries"),
    ],
  }),
  "dataset-identity-preflight-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.mjs",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightRun",
    inputs: ["identity-preflight-requests.jsonl", "published tiangong-lca CLI"],
    outputs: ["identity-preflight-run-results.jsonl", "dataset-identity-preflight-run-report.json"],
    keyTests: [
      nodeTest("test/unit/foundry-stage-contract.test.mjs", "complex workflow commands publish AI-readable stage contracts"),
      nodeTest("test/commands/bundle-sample-rows.test.mjs", "dataset-identity-preflight-run executes request indexes and preserves identity blockers as evidence"),
      nodeTest("test/scenarios/identity-preflight-run-and-merge.test.mjs", "identity preflight batch runner records timed-out CLI rows without hanging"),
    ],
  }),
  "dataset-identity-preflight-index-merge": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-preflight-run.mjs",
    ownerExport: "createIdentityPreflightRunCommands().runDatasetIdentityPreflightIndexMerge",
    inputs: ["base identity-preflight index", "refreshed current-scope identity-preflight index"],
    outputs: ["identity-preflight-requests.jsonl", "dataset-identity-preflight-index-merge-report.json"],
    keyTests: [
      nodeTest("test/scenarios/identity-preflight-run-and-merge.test.mjs", "identity preflight index merge preserves dependency rows while refreshing current scope"),
    ],
  }),
  "dataset-library-index-build": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.mjs",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryIndexBuild",
    inputs: ["root TIDAS library directory", "process-bundles/index.json"],
    outputs: ["library-entity-index.jsonl", "scope-projection.jsonl", "dataset-library-index-build-report.json"],
    keyTests: [
      nodeTest("test/scenarios/library-scope-workflow.test.mjs", "library index deduplicates root TIDAS entities and projects shared dependencies to process scopes"),
    ],
  }),
  "dataset-library-authoring-plan": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.mjs",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryAuthoringPlan",
    inputs: ["library-entity-index.jsonl", "scope-projection.jsonl"],
    outputs: ["identity-decisions.template.jsonl", "classification-decisions.template.jsonl", "canonical-support-mappings.template.jsonl"],
    keyTests: [
      nodeTest("test/scenarios/library-scope-workflow.test.mjs", "library authoring plan emits deduplicated semantic decision templates"),
    ],
  }),
  "dataset-library-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.mjs",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryDecisionsApply",
    inputs: ["library index", "identity decisions", "classification decisions", "canonical support mappings"],
    outputs: ["library-resolution.json", "scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl", "blocked-scope-report.json", "exchange-reference-rewrites.jsonl"],
    keyTests: [
      nodeTest("test/scenarios/library-scope-workflow.test.mjs", "library decisions apply rewrites only elementary flow references and defers unresolved scopes"),
    ],
  }),
  "dataset-process-scope-run": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/library-scope-workflow.mjs",
    ownerExport: "createLibraryScopeWorkflowCommands().runDatasetProcessScopeRun",
    inputs: ["process-bundles directory", "library-resolution.json", "scope file"],
    outputs: ["scope-checkpoints.jsonl", "blocked-scope-ledger.jsonl", "blocked-scope-report.json", "dataset-process-scope-run-report.json"],
    keyTests: [
      nodeTest("test/scenarios/library-scope-workflow.test.mjs", "process scope runner plans only ready scopes and keeps blocked scopes out of the queue"),
    ],
  }),
  "dataset-identity-reference-rewrites-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-reference-rewrites.mjs",
    ownerExport: "createIdentityReferenceRewriteCommands().runDatasetIdentityReferenceRewritesApply",
    inputs: ["process rows file", "identity-preflight index or identity decision rewrites"],
    outputs: ["rewritten rows file", "identity-reference-rewrites-apply-report.json", "reference reuse rows"],
    keyTests: [
      nodeTest("test/scenarios/flow-identity-decisions.test.mjs", "identity duplicate flow rewrites require high-confidence preflight evidence"),
    ],
  }),
  "dataset-identity-decisions-apply": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/identity-decisions.mjs",
    ownerExport: "createIdentityDecisionCommands().runDatasetIdentityDecisionsApply",
    inputs: ["rows file", "AI identity decisions", "identity decision task proof"],
    outputs: ["identity-decisions-apply-report.json", "write candidate rows", "reference reuse rows", "reference rewrites"],
    keyTests: [
      nodeTest("test/commands/authoring-plan.test.mjs", "dataset-identity-decisions-apply filters mixed decisions by requested type"),
      nodeTest("test/scenarios/flow-identity-decisions.test.mjs", "AI identity decisions apply split flow rows into writes and reference reuse"),
    ],
  }),
  "dataset-post-authoring-finalize": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/post-authoring-finalize.mjs",
    ownerExport: "createPostAuthoringFinalizeCommands().runDatasetPostAuthoringFinalize",
    inputs: ["patched or decision-applied rows", "profile", "queue artifacts", "schema/context files", "decision/patch evidence"],
    outputs: ["final rows file", "schema report", "cleanup report", "dry-run report", "post-authoring-finalize report"],
    keyTests: [
      goldenDiff,
      nodeTest("test/unit/foundry-stage-contract.test.mjs", "complex workflow commands publish AI-readable stage contracts"),
      nodeTest("test/scenarios/post-authoring-finalize-gates.test.mjs", "post-authoring finalize declares external process flow refs for remote proof"),
    ],
  }),
  "dataset-commit-handoff-plan": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/commit-handoff.mjs",
    ownerExport: "createCommitHandoffCommands().runDatasetCommitHandoffPlan",
    inputs: ["mutation manifest", "finalize report", "location audit evidence"],
    outputs: ["commit handoff plan JSON report"],
    keyTests: [
      nodeTest("test/scenarios/full-context-completion-closeout.test.mjs", "commit handoff blocks nonzero location audit blockers"),
    ],
  }),
  "dataset-post-write-closeout": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/post-write-closeout.mjs",
    ownerExport: "createPostWriteCloseoutCommands().runDatasetPostWriteCloseout",
    inputs: ["final rows", "write result", "trace queues", "readback/verify evidence"],
    outputs: ["post-write-closeout-report.json"],
    keyTests: [
      nodeTest("test/scenarios/full-context-completion-closeout.test.mjs", "post-write closeout requires common:other trace queues to match final rows"),
    ],
  }),
  "dataset-import-completion-report": metadata({
    category: "workflow-internal",
    ownerModule: "scripts/commands/import-completion.mjs",
    ownerExport: "createImportCompletionCommands().runDatasetImportCompletionReport",
    inputs: ["task manifest", "post-write closeout reports", "mutation manifests"],
    outputs: ["dataset-import-completion-report.json"],
    keyTests: [
      nodeTest("test/scenarios/full-context-completion-closeout.test.mjs", "full-context import completion gates block missing proof and pass evidenced BAFU scopes"),
    ],
  }),
  "dataset-mutation-manifest": metadata({
    category: "workflow-internal",
    ownerModule: importOwner("mutation-manifest"),
    ownerExport: "runDatasetMutationManifest",
    inputs: ["final rows", "schema report", "cleanup report", "dry-run report", "decision/patch evidence", "remote verify reports"],
    outputs: ["dataset-mutation-manifest.json", "write candidates", "reference reuse items", "blockers"],
    keyTests: [
      goldenDiff,
      nodeTest("test/scenarios/mutation-full-context-evidence.test.mjs", "mutation manifest requires full-context AI evidence and preserves deferred trace queues"),
      nodeTest("test/scenarios/mutation-manifest-reference-closure.test.mjs", "mutation manifest blocks process writes when referenced datasets are not proven"),
    ],
  }),
};

export function commandMetadataEntries() {
  return Object.entries(commandMetadata).map(([command, value]) => ({
    command,
    ...value,
  }));
}

export function commandMetadataFor(command) {
  return commandMetadata[command] ?? null;
}
