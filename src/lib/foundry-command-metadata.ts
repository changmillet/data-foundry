import { knownCommands } from "./foundry-command-registry.ts";
import {
  buildCoreInternalStageMetadata,
  type CommandCategory,
  type CommandKeyTest,
  type CommandMetadataBuilders,
  type CommandWorkflowEntry,
  type FoundryCommandMetadata,
  type FoundryInternalStageMetadata,
  type InternalStageCategory,
  type MetadataInput,
} from "./foundry-command-metadata-core.ts";
import { buildDecisionInternalStageMetadata } from "./foundry-command-metadata-decisions.ts";
import { buildWorkflowInternalStageMetadata } from "./foundry-command-metadata-workflows.ts";

export type {
  CommandCategory,
  CommandKeyTest,
  CommandWorkflowEntry,
  FoundryCommandMetadata,
  FoundryInternalStageMetadata,
  InternalStageCategory,
  MetadataInput,
};

export const commandCategories: CommandCategory[] = ["public", "workflow-internal"];

const commandSmoke = (command: string): CommandKeyTest => ({
  kind: "command-smoke",
  command: `node src/dev-cli.ts ${command}`,
});

const goldenDiff: CommandKeyTest = {
  kind: "golden-diff",
  path: "devops/ci/foundry-golden-diff.ts",
};

const nodeTest = (path: string, assertion: string): CommandKeyTest => ({
  kind: "node-test",
  path,
  assertion,
});

const importCurationEntryContract = nodeTest(
  "test/unit/import-curation-entry-barrels-migration.test.mts",
  "import-curation entry preserves the complete owner namespace and live references",
);

const coreCommandContract = nodeTest(
  "test/unit/core-command-factory.test.mts",
  "core runtime, diagnostics, route artifacts, native errors, and exact help remain stable",
);
const identityPreflightRunCommandContract = nodeTest(
  "test/unit/identity-preflight-run-command-factory.test.mts",
  "identity-preflight receipt, binding, cache, disk, failure, argv, and help contracts remain stable",
);
const postAuthoringFinalizeCommandContract = nodeTest(
  "test/unit/post-authoring-finalize-command-factory.test.mts",
  "post-authoring rewrite, evidence, gate, manifest, handoff order, and help remain stable",
);

const commandOwnerModules = {
  core: "src/commands/core.ts",
  tasks: "src/commands/tasks.ts",
  tidasWorkflow: "src/commands/tidas-workflow.ts",
  executionCapsule: "src/commands/execution-capsule.ts",
  finalDeliveryPromotion: "src/commands/final-delivery-promotion.ts",
  incrementalChangeSet: "src/commands/incremental-change-set.ts",
  topologyConvergence: "src/commands/topology-convergence.ts",
  cliWrappers: "src/commands/cli-wrappers.ts",
  authoringPlan: "src/commands/authoring-plan.ts",
  identityDecisionTask: "src/commands/identity-decision-task.ts",
  classificationDecisions: "src/commands/classification-decisions.ts",
  bafuLeafClassificationTasks: "src/commands/bafu-leaf-classification-tasks.ts",
  bafuAutoAuthoring: "src/commands/bafu-auto-authoring.ts",
  locationDecisions: "src/commands/location-decisions.ts",
  supportCache: "src/commands/support-cache.ts",
  bundleSampleRows: "src/commands/bundle-sample-rows.ts",
  identityPreflightRun: "src/commands/identity-preflight-run.ts",
  libraryScopeWorkflow: "src/commands/library-scope-workflow.ts",
  bafuProcessScopeE2e: "src/commands/bafu-process-scope-e2e.ts",
  bafuBatchImportRun: "src/commands/bafu-batch-import-run.ts",
  uslciBatchImportRun: "src/commands/uslci-batch-import-run.ts",
  worldsteelBatchImportRun: "src/commands/worldsteel-batch-import-run.ts",
  identityReferenceRewrites: "src/commands/identity-reference-rewrites.ts",
  identityDecisions: "src/commands/identity-decisions.ts",
  postAuthoringFinalize: "src/commands/post-authoring-finalize.ts",
  commitHandoff: "src/commands/commit-handoff.ts",
  postWriteCloseout: "src/commands/post-write-closeout.ts",
  importCompletion: "src/commands/import-completion.ts",
  importLedger: "src/commands/import-ledger.ts",
  libraryBatchImport: "src/commands/library-batch-import.ts",
} as const;

const commandTestFiles = {
  executionCapsule: "test/commands/execution-capsule.test.mts",
  finalDeliveryPromotion: "test/commands/final-delivery-promotion.test.mts",
  incrementalChangeSet: "test/commands/incremental-change-set.test.mts",
  topologyConvergence: "test/commands/topology-convergence.test.mts",
  authoringPlan: "test/commands/authoring-plan.test.mts",
  authoringTaskContext: "test/commands/authoring-task-context.test.mts",
  classificationDecisions: "test/commands/classification-decisions.test.mts",
  bafuLeafClassificationTasks: "test/commands/bafu-leaf-classification-tasks.test.mts",
  bafuAutoAuthoring: "test/commands/bafu-auto-authoring.test.mts",
  locationDecisions: "test/commands/location-decisions.test.mts",
  supportCache: "test/commands/support-cache.test.mts",
  bundleSampleRows: "test/commands/bundle-sample-rows.test.mts",
  libraryScopeWorkflowElementaryIdentity:
    "test/commands/library-scope-workflow-elementary-identity.test.mts",
  bafuProcessScopeE2e: "test/commands/bafu-process-scope-e2e.test.mts",
  bafuBatchImportRun: "test/commands/bafu-batch-import-run.test.mts",
  importLedger: "test/commands/import-ledger.test.mts",
  libraryBatchImport: "test/commands/library-batch-import.test.mts",
} as const;

const typedImportOwner = (moduleName: string): string => `src/lib/import-curation/${moduleName}.ts`;

function workflowEntryForCategory(category: string): CommandWorkflowEntry {
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

function metadata<Category extends InternalStageCategory>({
  category,
  ownerModule,
  ownerExport,
  inputs,
  outputs,
  keyTests,
  workflowEntry,
}: MetadataInput<Category>): Omit<FoundryInternalStageMetadata, "category"> & {
  category: Category;
} {
  return {
    category,
    ownerModule,
    ownerExport,
    navigationPath: ["src/dev-cli.ts", "src/lib/foundry-cli.ts", ownerModule],
    inputs,
    outputs,
    keyTests,
    workflowEntry: workflowEntry ?? workflowEntryForCategory(category),
  };
}

const builders: CommandMetadataBuilders = {
  metadata,
  commandSmoke,
  goldenDiff,
  nodeTest,
  importCurationEntryContract,
  coreCommandContract,
  identityPreflightRunCommandContract,
  postAuthoringFinalizeCommandContract,
  typedImportOwner,
  owners: commandOwnerModules,
  tests: commandTestFiles,
};

export const internalStageMetadata: Record<string, FoundryInternalStageMetadata> = {
  ...buildCoreInternalStageMetadata(builders),
  ...buildDecisionInternalStageMetadata(builders),
  ...buildWorkflowInternalStageMetadata(builders),
};

const libraryBatchImportMetadata = metadata({
  category: "workflow-internal",
  ownerModule: commandOwnerModules.libraryBatchImport,
  ownerExport: "createLibraryBatchImportCommands().runLibraryBatchImport",
  inputs: [
    "--profile <bafu|uslci|worldsteel>",
    "ready-scopes.jsonl",
    "process-bundles directory",
    "profile run directory with context and library decisions",
    "target user id when --commit is used",
  ],
  outputs: [
    "profile batch import run report JSON",
    "scope-checkpoints.jsonl",
    "import-ledger/* resumable ledgers",
  ],
  keyTests: [
    commandSmoke("library-batch-import --help"),
    nodeTest(
      commandTestFiles.libraryBatchImport,
      "library-batch-import dispatches bafu, uslci, and worldsteel profiles and blocks missing or unknown profiles",
    ),
  ],
});

const allMetadataByCommand: Record<string, FoundryInternalStageMetadata> = {
  ...internalStageMetadata,
  "library-batch-import": libraryBatchImportMetadata,
};

export const commandMetadata: Record<string, FoundryCommandMetadata> = Object.fromEntries(
  knownCommands.map((command) => {
    const entry = allMetadataByCommand[command];
    if (!entry || entry.category === "cli-wrapper") {
      throw new Error(`Missing flat CLI command metadata for ${command}`);
    }
    return [command, entry as FoundryCommandMetadata];
  }),
);

export function commandMetadataEntries(): Array<FoundryCommandMetadata & { command: string }> {
  return Object.entries(commandMetadata).map(([command, value]) => ({
    command,
    ...value,
  }));
}

export function commandMetadataFor(command: string): FoundryCommandMetadata | null {
  return commandMetadata[command] ?? null;
}

export function internalStageMetadataEntries(): Array<
  FoundryInternalStageMetadata & { command: string }
> {
  return Object.entries(internalStageMetadata).map(([command, value]) => ({
    command,
    ...value,
  }));
}

export function internalStageMetadataFor(command: string): FoundryInternalStageMetadata | null {
  return internalStageMetadata[command] ?? null;
}
