import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  inspectFoundryRelease,
  readFoundryReleaseGit as git,
} from "../release/foundry-release-contract.ts";
import {
  foundryCiTestConcurrencyForPlatform,
  isFoundryDocsOnlyPath,
  loadFoundryTestPlan,
} from "./foundry-ci-plan.ts";
import { resolvePackageManagerCommand } from "../../src/lib/package-manager-command.ts";

const root = path.resolve(import.meta.dirname, "../..");

const docsOnlyContractTests = [
  "test/unit/foundry-package-contract.test.mts",
  "test/unit/foundry-cli-spine.test.mts",
  "test/unit/foundry-command-metadata.test.mts",
  "test/unit/surface-audit-typescript.test.mts",
  "test/unit/worldsteel-support-mint-truth.test.mts",
  "test/unit/zero-javascript-ratchet.test.mts",
  "test/unit/orchestration-module-budget.test.mts",
  "test/unit/type-safety-ratchet.test.mts",
] as const;

function run(executable: string, argv: readonly string[]): void {
  const result = spawnSync(executable, argv, { cwd: root, shell: false, stdio: "inherit" });
  if (result.status !== 0 || result.error) throw new Error("Docs-only CI check failed.");
}

function main(): void {
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "pull_request" ||
    process.env.FOUNDRY_CI_SOURCE_SHA ||
    process.env.FOUNDRY_CI_FORCE_FULL === "true"
  )
    throw new Error("The bounded docs-only gate is only available to an inspected pull request.");
  if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim())
    throw new Error("Docs-only CI requires a clean checkout.");
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (head !== process.env.GITHUB_SHA)
    throw new Error("Docs-only CI source differs from the pull request checkout.");
  const inspection = inspectFoundryRelease(root, process.env.FOUNDRY_CI_BASE_SHA ?? "", head);
  if (
    inspection.release ||
    !inspection.changedPaths.length ||
    !inspection.changedPaths.every(isFoundryDocsOnlyPath)
  )
    throw new Error("This pull request is not eligible for the bounded docs-only gate.");
  for (const command of [
    "lint",
    "test:toolchain",
    "surface:audit",
    "package:build",
    "package:check",
  ]) {
    const invocation = resolvePackageManagerCommand("pnpm", [command]);
    run(invocation.executable, invocation.argv);
  }
  const available = new Set(loadFoundryTestPlan(root).shards.flatMap((shard) => shard.files));
  for (const file of docsOnlyContractTests) {
    if (!available.has(file))
      throw new Error(`Docs-only CI required contract test is missing: ${file}`);
  }
  const concurrency = foundryCiTestConcurrencyForPlatform(`${process.platform}-${process.arch}`);
  run(process.execPath, ["--test", `--test-concurrency=${concurrency}`, ...docsOnlyContractTests]);
  const after = inspectFoundryRelease(root, process.env.FOUNDRY_CI_BASE_SHA ?? "", head);
  if (
    after.release ||
    after.tree !== inspection.tree ||
    !after.changedPaths.length ||
    !after.changedPaths.every(isFoundryDocsOnlyPath) ||
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim()
  )
    throw new Error("Docs-only source changed during qualification.");
  process.stdout.write(
    `${JSON.stringify({
      schema: "tiangong-foundry.ci-docs-qualification.v1",
      status: "passed",
      source: head,
      tree: inspection.tree,
      changedPaths: inspection.changedPaths,
      tests: docsOnlyContractTests,
    })}\n`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Docs-only CI failed."}\n`);
    process.exitCode = 1;
  }
}
