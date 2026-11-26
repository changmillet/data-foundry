export type InternalStageCategory = "public" | "workflow-internal" | "cli-wrapper";
export type CommandCategory = "public" | "workflow-internal";

export type CommandKeyTest =
  | { kind: "command-smoke"; command: string }
  | { kind: "golden-diff"; path: string }
  | { kind: "node-test"; path: string; assertion: string };

export type CommandWorkflowEntry = {
  status: string;
  entry_kind: string;
};

export type FoundryInternalStageMetadata = {
  category: InternalStageCategory;
  ownerModule: string;
  ownerExport: string;
  navigationPath: string[];
  inputs: string[];
  outputs: string[];
  keyTests: CommandKeyTest[];
  workflowEntry: CommandWorkflowEntry;
};

export type FoundryCommandMetadata = Omit<FoundryInternalStageMetadata, "category"> & {
  category: CommandCategory;
};

export type MetadataInput<Category extends InternalStageCategory = InternalStageCategory> = Omit<
  FoundryInternalStageMetadata,
  "category" | "navigationPath" | "workflowEntry"
> & {
  category: Category;
  workflowEntry?: CommandWorkflowEntry;
};

export type CommandMetadataBuilders = {
  metadata: <Category extends InternalStageCategory>(
    input: MetadataInput<Category>,
  ) => Omit<FoundryInternalStageMetadata, "category"> & { category: Category };
  commandSmoke: (command: string) => CommandKeyTest;
  goldenDiff: CommandKeyTest;
  nodeTest: (path: string, assertion: string) => CommandKeyTest;
  importCurationEntryContract: CommandKeyTest;
  coreCommandContract: CommandKeyTest;
  identityPreflightRunCommandContract: CommandKeyTest;
  postAuthoringFinalizeCommandContract: CommandKeyTest;
  typedImportOwner: (moduleName: string) => string;
  owners: {
    core: string;
    tasks: string;
    tidasWorkflow: string;
    executionCapsule: string;
    finalDeliveryPromotion: string;
    incrementalChangeSet: string;
    topologyConvergence: string;
    cliWrappers: string;
    authoringPlan: string;
    identityDecisionTask: string;
    classificationDecisions: string;
    bafuLeafClassificationTasks: string;
    bafuAutoAuthoring: string;
    locationDecisions: string;
    supportCache: string;
    bundleSampleRows: string;
    identityPreflightRun: string;
    libraryScopeWorkflow: string;
    bafuProcessScopeE2e: string;
    bafuBatchImportRun: string;
    uslciBatchImportRun: string;
    worldsteelBatchImportRun: string;
    identityReferenceRewrites: string;
    identityDecisions: string;
    postAuthoringFinalize: string;
    commitHandoff: string;
    postWriteCloseout: string;
    importCompletion: string;
    importLedger: string;
    libraryBatchImport: string;
  };
  tests: {
    executionCapsule: string;
    finalDeliveryPromotion: string;
    incrementalChangeSet: string;
    topologyConvergence: string;
    authoringPlan: string;
    authoringTaskContext: string;
    classificationDecisions: string;
    bafuLeafClassificationTasks: string;
    bafuAutoAuthoring: string;
    locationDecisions: string;
    supportCache: string;
    bundleSampleRows: string;
    libraryScopeWorkflowElementaryIdentity: string;
    bafuProcessScopeE2e: string;
    bafuBatchImportRun: string;
    importLedger: string;
    libraryBatchImport: string;
  };
};

export function buildCoreInternalStageMetadata(
  builders: CommandMetadataBuilders,
): Record<string, FoundryInternalStageMetadata> {
  const {
    metadata,
    commandSmoke,
    goldenDiff,
    nodeTest,
    importCurationEntryContract,
    coreCommandContract,
    typedImportOwner,
    owners,
    tests,
  } = builders;

  return {
    init: metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().initRuntime",
      inputs: ["repo root runtime directory policy"],
      outputs: [".foundry/logs", ".foundry/state", ".foundry/workspaces", "tasks/*"],
      keyTests: [coreCommandContract, commandSmoke("doctor")],
    }),
    doctor: metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().doctor",
      inputs: [
        "WORKFLOW.md",
        "docs/file-location-registry.json",
        ".env.example",
        "specs/import-profiles.json",
        "command metadata",
        "script import graph",
      ],
      outputs: ["doctor JSON status report"],
      keyTests: [coreCommandContract, goldenDiff, commandSmoke("doctor")],
    }),
    "env-check": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().envCheck",
      inputs: [".env.example"],
      outputs: ["env_example_surface JSON status report"],
      keyTests: [coreCommandContract, commandSmoke("env-check"), commandSmoke("doctor")],
    }),
    "workflow-check": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().workflowCheck",
      inputs: ["WORKFLOW.md"],
      outputs: ["workflow_check JSON status report"],
      keyTests: [coreCommandContract, commandSmoke("workflow-check"), commandSmoke("doctor")],
    }),
    "storage-check": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().storageCheck",
      inputs: ["docs/file-location-registry.json"],
      outputs: ["storage_check JSON status report"],
      keyTests: [coreCommandContract, commandSmoke("storage-check"), commandSmoke("doctor")],
    }),
    "surface-audit": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().surfaceAuditCheck",
      inputs: [
        "command registry",
        "command metadata",
        "docs/**/*.md",
        "src/**/*.{ts,mts,cts}",
        "devops/**/*.{ts,mts,cts}",
      ],
      outputs: ["surface audit JSON status report"],
      keyTests: [coreCommandContract, commandSmoke("surface-audit"), commandSmoke("doctor")],
    }),
    "acceptance-check": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().acceptanceCheck",
      inputs: ["task workspace checkpoints"],
      outputs: ["acceptance JSON status report"],
      keyTests: [coreCommandContract],
    }),
    "workspace-map": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().workspaceMap",
      inputs: ["docs/workspace-project-map.md", "specs/workspace-capability-adapters.md"],
      outputs: ["workspace map JSON report"],
      keyTests: [coreCommandContract, commandSmoke("workspace-map")],
    }),
    "capabilities-list": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().capabilitiesList",
      inputs: ["specs/automated-lca-capability-registry.json"],
      outputs: ["capability registry JSON report"],
      keyTests: [coreCommandContract, goldenDiff, commandSmoke("capabilities-list")],
    }),
    "profiles-list": metadata({
      category: "public",
      ownerModule: typedImportOwner("profiles"),
      ownerExport: "listImportProfiles",
      inputs: ["specs/import-profiles.json"],
      outputs: ["import profile JSON report"],
      keyTests: [
        goldenDiff,
        commandSmoke("profiles-list"),
        importCurationEntryContract,
        nodeTest(
          "test/unit/task-profile-authority.test.mts",
          "a new task inherits rules but no historical account-local or QA authority",
        ),
      ],
    }),
    "route-task": metadata({
      category: "public",
      ownerModule: owners.core,
      ownerExport: "createCoreCommands().buildRoutePlan",
      inputs: ["task metadata options", "capability registry"],
      outputs: ["route plan JSON artifact"],
      keyTests: [coreCommandContract, goldenDiff],
    }),
    "tidas-handshake": metadata({
      category: "public",
      ownerModule: owners.tidasWorkflow,
      ownerExport: "createTidasWorkflowCommands().runTidasHandshake",
      inputs: ["Rust tidas executable", "optional TIDAS_CONFIG"],
      outputs: ["compatible 0.2.x or 0.3.x binary and tidas.operation-report.v1 handshake"],
      keyTests: [
        nodeTest(
          "test/unit/tidas-adapter.test.mts",
          "0.2.x version and operation-report handshake",
        ),
      ],
    }),
    "dataset-tidas-import": metadata({
      category: "cli-wrapper",
      ownerModule: owners.tidasWorkflow,
      ownerExport: "createTidasWorkflowCommands().runTidasImport",
      inputs: ["supported external LCA package", "Rust tidas executable"],
      outputs: [
        "tidas.operation-report.v1",
        "tidas.import-execution-report.v1",
        "validated TIDAS package and process-bundles",
      ],
      keyTests: [
        nodeTest(
          "test/unit/tidas-adapter.test.mts",
          "native import, stable exit mapping, cancellation, and cleanup",
        ),
      ],
    }),
    "dataset-tidas-validate": metadata({
      category: "cli-wrapper",
      ownerModule: owners.tidasWorkflow,
      ownerExport: "createTidasWorkflowCommands().runTidasPackageValidation",
      inputs: ["TIDAS package or JSON/JSONL rows", "Rust tidas executable"],
      outputs: [
        "tidas validation report/events",
        "Foundry validation compatibility report and valid/invalid rows",
      ],
      keyTests: [
        nodeTest(
          "test/unit/tidas-adapter.test.mts",
          "official batch validation report mapping and rollback cleanup",
        ),
      ],
    }),
    "tasks-list": metadata({
      category: "public",
      ownerModule: owners.tasks,
      ownerExport: "createTaskCommands().tasksList",
      inputs: ["tasks/inbox", "tasks/active", "tasks/done"],
      outputs: ["task list JSON report"],
      keyTests: [
        nodeTest(
          "test/unit/handoff-identity-task-command-factories.test.mts",
          "task commands preserve lifecycle checks",
        ),
      ],
    }),
    "tasks-check": metadata({
      category: "public",
      ownerModule: owners.tasks,
      ownerExport: "createTaskCommands().tasksCheck",
      inputs: ["tasks/inbox", "tasks/active", "tasks/done"],
      outputs: ["task storage consistency JSON report"],
      keyTests: [commandSmoke("doctor")],
    }),
    "task-complete": metadata({
      category: "public",
      ownerModule: owners.tasks,
      ownerExport: "createTaskCommands().runTaskComplete",
      inputs: ["tasks/active/<task-id>.md", "task completion options"],
      outputs: ["tasks/done/<task-id>.md", "task completion JSON report"],
      keyTests: [
        nodeTest(
          "test/unit/handoff-identity-task-command-factories.test.mts",
          "task commands preserve lifecycle checks",
        ),
      ],
    }),
    "execution-capsule-admit": metadata({
      category: "workflow-internal",
      ownerModule: owners.executionCapsule,
      ownerExport: "createExecutionCapsuleCommands().runExecutionCapsuleAdmit",
      inputs: [
        "foundry-execution-capsule-stage.v1 manifest",
        "content-addressed stage leaves",
        "materialized consumer boundary contract",
      ],
      outputs: [
        "execution-capsule-stage-revision.json",
        "execution-capsule-admission-ledger.jsonl",
        "execution-capsule-admission-report.json",
        "execution-capsule-seal.json when all checks pass",
      ],
      keyTests: [
        nodeTest(
          tests.executionCapsule,
          "execution capsule admission seals exact offline evidence and rejects mutation vectors",
        ),
        nodeTest(
          "test/unit/execution-capsule-attempt-state.test.mts",
          "attempt dispositions distinguish unattempted, recovered success, and unknown no-replay states",
        ),
      ],
    }),
    "final-delivery-promote": metadata({
      category: "workflow-internal",
      ownerModule: owners.finalDeliveryPromotion,
      ownerExport: "createFinalDeliveryPromotionCommands().runFinalDeliveryPromote",
      inputs: [
        "foundry-final-delivery-manifest.v1",
        "content-bound local delivery artifacts",
        "declarative algebra and workbook policies",
        "independent reviewer reports",
      ],
      outputs: [
        "final-delivery-manifest-snapshot.json",
        "final-delivery-promotion-ledger.jsonl",
        "final-delivery-promotion-report.json",
        "final-delivery-promotion-seal.json when all checks pass",
      ],
      keyTests: [
        nodeTest(
          tests.finalDeliveryPromotion,
          "final delivery promotion validates exact content, rows, algebra, workbook, redaction, review, and immutable seal behavior",
        ),
      ],
    }),
    "dataset-incremental-change-set-compose": metadata({
      category: "workflow-internal",
      ownerModule: owners.incrementalChangeSet,
      ownerExport: "createIncrementalChangeSetCommands().runDatasetIncrementalChangeSetCompose",
      inputs: [
        "SHA-bound incremental change-set request",
        "old/candidate comparison JSONL",
        "owner-draft SELECT-only snapshot JSONL",
        "explicit JSON Pointer preservation policy",
        "optional terminal action exclusions",
      ],
      outputs: [
        "incremental-change-set-request.snapshot.json",
        "incremental-change-set-conversion-events.jsonl",
        "incremental-change-set-delta.jsonl",
        "incremental-change-set-no-write.jsonl",
        "incremental-change-set-holds.jsonl",
        "incremental-change-set-dependency-closure.json",
        "dataset-save-draft-input.jsonl",
        "dataset-save-draft-execution-contract.json",
        "incremental-change-set-report.json",
        "incremental-change-set-manifest.json",
      ],
      keyTests: [
        nodeTest(
          "test/unit/incremental-change-set.test.mts",
          "three-way merge and canonical CLI hashes preserve owner changes only through explicit policy",
        ),
        nodeTest(
          tests.incrementalChangeSet,
          "every conversion receives one terminal event and outputs satisfy action/no-write/hold algebra",
        ),
      ],
    }),
    "dataset-topology-convergence-compose": metadata({
      category: "workflow-internal",
      ownerModule: owners.topologyConvergence,
      ownerExport: "createTopologyConvergenceCommands().runDatasetTopologyConvergenceCompose",
      inputs: [
        "SHA-bound topology convergence request",
        "candidate flow/process file indexes",
        "fresh owner/public/foreign SELECT-only census",
        "audited target classifications and multilingual overlays",
        "fresh admission receipt with fixed CLI fingerprint",
      ],
      outputs: [
        "F flow-create input and execution contract",
        "P process save-draft input and execution contract",
        "D zero-inbound delete candidate scope",
        "append-only conversion events and no-write/hold ledgers",
        "dependency closure, independent audit, report, and manifest",
      ],
      keyTests: [
        nodeTest(
          "test/unit/topology-convergence.test.mts",
          "occurrence keys and language overlays prevent global flow-id replacement",
        ),
        nodeTest(
          tests.topologyConvergence,
          "F/P/D artifacts satisfy exact topology algebra and trust boundaries",
        ),
      ],
    }),
    "dataset-curation-queue-build": metadata({
      category: "cli-wrapper",
      ownerModule: owners.cliWrappers,
      ownerExport: "createCliWrapperCommands().runDatasetCurationQueueBuild",
      inputs: ["converted process/flow/support/lifecyclemodel rows"],
      outputs: ["CLI curation queue directory", "Foundry wrapper JSON report"],
      keyTests: [
        nodeTest(
          "test/scenarios/identity-curation-context.test.mts",
          "curation queue build is used before full-context authoring",
        ),
      ],
    }),
    "dataset-curation-gate": metadata({
      category: "workflow-internal",
      ownerModule: typedImportOwner("curation-gate"),
      ownerExport: "runDatasetCurationGate",
      inputs: [
        "rows file",
        "schema report",
        "QA report",
        "profile",
        "context files",
        "queue artifacts",
        "optional task-indexed exact-object preparation quality review",
      ],
      outputs: [
        "dataset-curation-gate-report.json (raw QA plus separately reviewed findings)",
        "ai-authoring-packages/*",
      ],
      keyTests: [
        goldenDiff,
        nodeTest(
          "test/scenarios/identity-curation-context.test.mts",
          "curation gate authoring package carries full contract text and queue dependency rows",
        ),
        importCurationEntryContract,
      ],
    }),
    "dataset-authoring-plan": metadata({
      category: "workflow-internal",
      ownerModule: owners.authoringPlan,
      ownerExport: "createAuthoringPlanCommands().runDatasetAuthoringPlan",
      inputs: ["curation gate reports", "authoring task manifests", "decision task manifests"],
      outputs: ["dataset-authoring-plan JSON report"],
      keyTests: [
        nodeTest(
          "test/unit/foundry-stage-contract.test.mts",
          "complex workflow commands publish AI-readable stage contracts",
        ),
        nodeTest(
          tests.authoringPlan,
          "dataset-authoring-plan aggregates missing AI task builds from curation gate",
        ),
      ],
    }),
    "dataset-authoring-task-build": metadata({
      category: "workflow-internal",
      ownerModule: typedImportOwner("authoring-packages"),
      ownerExport: "runDatasetAuthoringTaskBuild",
      inputs: ["curation gate report", "AI authoring package"],
      outputs: [
        "ai-authoring-task.json",
        "ai-authoring-task.md",
        "patch-template.json",
        "authoring-task-manifest.json",
      ],
      keyTests: [
        goldenDiff,
        nodeTest(
          tests.authoringTaskContext,
          "authoring task build blocks AI patch authoring when full context is incomplete",
        ),
        importCurationEntryContract,
      ],
    }),
    "dataset-authoring-patch-collect": metadata({
      category: "workflow-internal",
      ownerModule: typedImportOwner("patch-collect"),
      ownerExport: "runDatasetAuthoringPatchCollect",
      inputs: ["authoring task manifest", "AI patch files", "authoring packages"],
      outputs: ["authoring-patch-collect-report.json", "ai-patches.batch.json"],
      keyTests: [
        nodeTest(
          tests.authoringTaskContext,
          "authoring patch collect blocks stale manifests that lack full-context task proof",
        ),
        importCurationEntryContract,
      ],
    }),
  };
}
