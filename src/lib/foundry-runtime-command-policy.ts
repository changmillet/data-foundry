import {
  internalStageCommands,
  type FoundryInternalStageCommand,
} from "./foundry-command-registry.ts";
import { internalStageMetadata, type InternalStageCategory } from "./foundry-command-metadata.ts";
import { FoundryContextError } from "./foundry-runtime-context.ts";

export type FoundryRuntimeDisposition =
  | "facade-adapter"
  | "developer-maintenance"
  | "task-control"
  | "native-runtime-stage"
  | "task-stage";

export interface FoundryRuntimeCommandPolicy {
  readonly command: FoundryInternalStageCommand;
  readonly source_category: InternalStageCategory;
  readonly disposition: FoundryRuntimeDisposition;
  readonly distribution: "public-facade" | "internal-only" | "excluded";
  readonly facade_operation: "workspace.init" | "doctor" | null;
  readonly asset_root: "runtime";
  readonly input_root: "none" | "workspace-selection" | "task-lineage";
  readonly output_root: "none" | "workspace-state" | "task-artifacts";
  readonly child_process: "none" | "tidas" | "cli-or-owner";
  readonly runtime_qualification: "not-required" | "required-before-child";
  readonly authorization: "not-required" | "required-before-restricted-action";
  readonly declared_inputs: readonly string[];
  readonly declared_outputs: readonly string[];
}

const developerMaintenance = new Set<FoundryInternalStageCommand>([
  "env-check",
  "workflow-check",
  "storage-check",
  "surface-audit",
  "workspace-map",
  "capabilities-list",
]);
const facadeAdapters = new Set<FoundryInternalStageCommand>(["init", "doctor"]);
const taskControl = new Set<FoundryInternalStageCommand>([
  "profiles-list",
  "route-task",
  "tasks-list",
  "tasks-check",
  "task-complete",
  "acceptance-check",
]);
const nativeRuntime = new Set<FoundryInternalStageCommand>([
  "tidas-handshake",
  "dataset-tidas-import",
  "dataset-tidas-validate",
]);
const taskStages = new Set<FoundryInternalStageCommand>([
  "execution-capsule-admit",
  "dataset-incremental-change-set-compose",
  "dataset-topology-convergence-compose",
  "final-delivery-promote",
  "dataset-curation-queue-build",
  "dataset-curation-gate",
  "dataset-authoring-plan",
  "dataset-authoring-task-build",
  "dataset-authoring-patch-collect",
  "dataset-identity-decision-task-build",
  "dataset-classification-decision-task-build",
  "dataset-library-classification-decisions-project",
  "dataset-bafu-leaf-classification-tasks-prepare",
  "dataset-bafu-leaf-classification-category-map-project",
  "dataset-bafu-identity-decisions-autofill",
  "dataset-bafu-authoring-patches-autofill",
  "dataset-classification-decisions-apply",
  "dataset-location-decision-task-build",
  "dataset-location-decisions-suggest",
  "dataset-location-decisions-apply",
  "dataset-curation-cleanup",
  "dataset-patch-apply",
  "dataset-support-cache-refresh",
  "dataset-canonical-support-mappings-autofill",
  "dataset-bundle-sample-rows",
  "dataset-identity-preflight-requests-build",
  "dataset-identity-preflight-query-audit",
  "dataset-identity-preflight-run",
  "dataset-identity-preflight-index-merge",
  "dataset-library-index-build",
  "dataset-library-authoring-plan",
  "dataset-library-identity-decisions-from-preflight",
  "dataset-library-decisions-apply",
  "dataset-process-scope-run",
  "dataset-bafu-process-scope-e2e",
  "dataset-bafu-batch-import-run",
  "dataset-uslci-batch-import-run",
  "dataset-worldsteel-batch-import-run",
  "dataset-bafu-universe-coverage-report",
  "dataset-identity-reference-rewrites-apply",
  "dataset-identity-decisions-apply",
  "dataset-post-authoring-finalize",
  "dataset-commit-handoff-plan",
  "dataset-post-write-closeout",
  "dataset-import-completion-report",
  "dataset-import-ledger-report",
  "dataset-mutation-manifest",
]);

const cliChildStages = new Set<FoundryInternalStageCommand>([
  "dataset-curation-queue-build",
  "dataset-patch-apply",
  "dataset-support-cache-refresh",
  "dataset-identity-preflight-run",
  "dataset-post-authoring-finalize",
  "dataset-process-scope-run",
  "dataset-bafu-process-scope-e2e",
  "dataset-bafu-batch-import-run",
  "dataset-uslci-batch-import-run",
  "dataset-worldsteel-batch-import-run",
]);

const restrictedStages = new Set<FoundryInternalStageCommand>([
  "dataset-identity-decisions-apply",
  "dataset-library-decisions-apply",
  "dataset-bundle-sample-rows",
  "dataset-post-authoring-finalize",
  "dataset-commit-handoff-plan",
  "dataset-mutation-manifest",
  "dataset-process-scope-run",
  "dataset-bafu-process-scope-e2e",
  "dataset-bafu-batch-import-run",
  "dataset-uslci-batch-import-run",
  "dataset-worldsteel-batch-import-run",
]);

const explicitlyClassified = [
  ...facadeAdapters,
  ...developerMaintenance,
  ...taskControl,
  ...nativeRuntime,
  ...taskStages,
];
if (
  explicitlyClassified.length !== internalStageCommands.length ||
  new Set(explicitlyClassified).size !== internalStageCommands.length ||
  internalStageCommands.some((command) => !explicitlyClassified.includes(command))
)
  throw new FoundryContextError(
    "runtime_command_policy_missing",
    "Every internal command requires one explicit runtime ownership disposition.",
  );

function disposition(command: FoundryInternalStageCommand): FoundryRuntimeDisposition {
  if (facadeAdapters.has(command)) return "facade-adapter";
  if (developerMaintenance.has(command)) return "developer-maintenance";
  if (taskControl.has(command)) return "task-control";
  if (nativeRuntime.has(command)) return "native-runtime-stage";
  if (taskStages.has(command)) return "task-stage";
  throw new FoundryContextError(
    "runtime_command_policy_missing",
    "Every internal command requires one explicit runtime ownership disposition.",
  );
}

function build(command: FoundryInternalStageCommand): FoundryRuntimeCommandPolicy {
  const metadata = internalStageMetadata[command];
  if (!metadata)
    throw new FoundryContextError(
      "runtime_command_policy_missing",
      "Every internal command requires one explicit runtime ownership disposition.",
    );
  const selected = disposition(command);
  const childProcess =
    selected === "native-runtime-stage"
      ? "tidas"
      : cliChildStages.has(command) || metadata.category === "cli-wrapper"
        ? "cli-or-owner"
        : "none";
  const policy: FoundryRuntimeCommandPolicy = Object.freeze({
    command,
    source_category: metadata.category,
    disposition: selected,
    distribution:
      selected === "facade-adapter"
        ? "public-facade"
        : selected === "developer-maintenance"
          ? "excluded"
          : "internal-only",
    facade_operation:
      command === "init" ? "workspace.init" : command === "doctor" ? "doctor" : null,
    asset_root: "runtime",
    input_root:
      selected === "developer-maintenance" || command === "doctor" || command === "tidas-handshake"
        ? "none"
        : selected === "facade-adapter" || selected === "task-control"
          ? "workspace-selection"
          : "task-lineage",
    output_root:
      selected === "developer-maintenance" || command === "doctor" || command === "tidas-handshake"
        ? "none"
        : selected === "facade-adapter" || selected === "task-control"
          ? "workspace-state"
          : "task-artifacts",
    child_process: childProcess,
    runtime_qualification: childProcess === "none" ? "not-required" : "required-before-child",
    authorization: restrictedStages.has(command)
      ? "required-before-restricted-action"
      : "not-required",
    declared_inputs: Object.freeze([...metadata.inputs]),
    declared_outputs: Object.freeze([...metadata.outputs]),
  });
  return policy;
}

export const foundryRuntimeCommandPolicies: readonly FoundryRuntimeCommandPolicy[] = Object.freeze(
  internalStageCommands.map(build),
);

const policyByCommand = new Map(
  foundryRuntimeCommandPolicies.map((policy) => [policy.command, policy] as const),
);

export function foundryRuntimeCommandPolicy(command: string): FoundryRuntimeCommandPolicy {
  if (!Object.hasOwn(internalStageMetadata, command))
    throw new FoundryContextError(
      "runtime_command_unknown",
      "Unknown or inherited command names have no runtime authority.",
    );
  const policy = policyByCommand.get(command as FoundryInternalStageCommand);
  if (!policy)
    throw new FoundryContextError(
      "runtime_command_policy_missing",
      "The selected command has no runtime ownership disposition.",
    );
  return policy;
}
