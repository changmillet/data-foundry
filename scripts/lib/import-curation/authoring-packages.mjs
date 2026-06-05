import path from "node:path";
import {
  asText,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  sanitizeFileName,
} from "./internal/runtime-io.mjs";
import {
  authoringPackageEntriesFromGate,
  buildDatasetAuthoringTaskFromPackage,
  writeAuthoringTaskBatchManifest,
} from "./internal/legacy-implementation.mjs";

export function runDatasetAuthoringTaskBuild({ repoRoot, options = {} } = {}) {
  if (options.help) {
    return {
      schema_version: 1,
      status: "help",
      command: "dataset-authoring-task-build",
      usage: [
        "node scripts/foundry.mjs dataset-authoring-task-build --authoring-package <package.json> --out-dir <task-dir>",
        "node scripts/foundry.mjs dataset-authoring-task-build --curation-gate-report <dataset-curation-gate-report.json> --out-dir <tasks-dir> [--shared-context-cache-dir <cache-dir>]",
        "node scripts/foundry.mjs dataset-authoring-task-build --package ./curation-gate/ai-authoring-packages/process-<uuid>.authoring-package.json --out-dir ./authoring-task",
      ],
      purpose:
        "Build Codex/skill-facing authoring tasks and strict patch templates from Foundry AI authoring packages. This command is local-only and never writes the database.",
    };
  }

  const curationGateReportInput =
    options.curationGateReport ?? options.gateReport ?? options.report;
  const curationGateReportPath = resolveRepoPath(
    repoRoot,
    curationGateReportInput,
  );
  if (curationGateReportPath) {
    if (!fileExists(curationGateReportPath)) {
      throw new Error(
        "--curation-gate-report must point to dataset-curation-gate-report.json.",
      );
    }
    const outDir = resolveRepoPath(
      repoRoot,
      options.outDir || ".foundry/workspaces/dataset-authoring-tasks",
    );
    const sharedContextCacheDir = resolveRepoPath(
      repoRoot,
      options.sharedContextCacheDir || options.contextCacheDir,
    );
    const includeReady =
      options.includeReady === true || options.includeReady === "true";
    const entries = authoringPackageEntriesFromGate(
      repoRoot,
      curationGateReportPath,
      includeReady,
    );
    const missingPackages = entries.filter(
      (entry) => !entry.package_path || !fileExists(entry.package_path),
    );
    if (missingPackages.length > 0) {
      return {
        schema_version: 1,
        generated_at_utc: nowIso(),
        status: "blocked_missing_authoring_packages",
        curation_gate_report: repoRelativePath(
          repoRoot,
          curationGateReportPath,
        ),
        missing_packages: missingPackages.map((entry) => ({
          entity: entry.entity,
          authoring_package: entry.package_ref,
        })),
      };
    }
    const tasks = entries.map((entry) =>
      buildDatasetAuthoringTaskFromPackage({
        repoRoot,
        packagePath: entry.package_path,
        outDir: path.join(outDir, entry.task_dir_name),
        options: {},
      }),
    );
    return writeAuthoringTaskBatchManifest(
      repoRoot,
      outDir,
      tasks,
      {
        curation_gate_report: repoRelativePath(repoRoot, curationGateReportPath),
        include_ready: includeReady,
      },
      {
        sharedContextCacheDir,
      },
    );
  }

  const authoringPackageInput =
    options.authoringPackage ?? options.package ?? options.input;
  const packagePath = resolveRepoPath(repoRoot, authoringPackageInput);
  const packagePayload =
    packagePath && fileExists(packagePath) ? readJson(packagePath) : null;
  const datasetType = asText(packagePayload?.dataset_type);
  const entityId = asText(
    packagePayload?.entity_id ?? packagePayload?.process_id,
  );
  const defaultOut = `.foundry/workspaces/dataset-authoring-task/${datasetType || "dataset"}-${sanitizeFileName(entityId || "entity")}`;
  const outDir = resolveRepoPath(repoRoot, options.outDir || defaultOut);
  return buildDatasetAuthoringTaskFromPackage({
    repoRoot,
    packagePath,
    outDir,
    options,
  });
}
